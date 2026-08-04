/**
 * Shadow-teacher scoring and contact-masking utilities.
 *
 * scoreCandidate() is a pure function — no DB calls, fully unit-testable.
 * maskBody()       applies server-side redaction before messages leave the API.
 */
import { haversineKm } from "./geo";

export interface WeeklyScheduleSlot {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface MatchSnapshot {
  childCity: string | null;
  childLat: number | null;
  childLng: number | null;
  childLanguages: string[] | null;
  childBudgetMinInr: number | null;
  childBudgetMaxInr: number | null;
  childPreferredModes: string[] | null;
  // Compatibility signal only — never excludes a candidate. See scoreStartDate.
  // Optional: tutor.ts/therapist.ts also reuse this scoring lib and don't
  // capture a desired start date — absent means neutral score for everyone.
  childDesiredStartDate?: string | null;
  // Piece B — parent's initial, non-negotiated desired weekly schedule (see
  // shadowTeacherMatchesTable.childDesiredWeeklyScheduleJson). Compatibility
  // signal only — never excludes. Optional for the same reason as
  // childDesiredStartDate above: tutor/therapist don't capture this.
  childDesiredWeeklyScheduleJson?: WeeklyScheduleSlot[] | null;
}

export interface ProfessionalForScoring {
  id: number;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  languages: string[] | null;
  pricingMinINR: number | null;
  pricingMaxINR: number | null;
  yearsExperience: number;
  offersHomeVisits: boolean;
  verificationStatus: string;
  averageRating: number | null;
  travelRadiusKm: number;
  // MAX(earliestStartDate, current notice_period engagement's endDate + 1
  // day) — computed by the caller (shadowTeacher.ts), null if neither input
  // is known. Never engaged -> just earliestStartDate. Optional for the same
  // reason as childDesiredStartDate: tutor/therapist matching doesn't
  // compute it, and absent scores neutrally.
  effectiveAvailableFrom?: string | null;
  // Piece A — professional's own descriptive general weekly availability
  // (professionalProfilesTable.generalAvailabilityJson), NOT a committed
  // schedule. Typed unknown (not WeeklyScheduleSlot[]) so every caller that
  // spreads a raw professionalProfilesTable row — most don't remap this
  // field at all — satisfies the type without a cast at each of the 5+
  // call sites across shadowTeacher.ts/tutor.ts/therapist.ts/
  // candidateRefresh.ts; narrowed once, inside scoreScheduleOverlap.
  generalAvailabilityJson?: unknown;
}

export interface TierDef {
  minSalaryInr: number;
  maxSalaryInr: number;
  minExperienceYears?: number;
}

function scoreCityGeo(snap: MatchSnapshot, pro: ProfessionalForScoring): number {
  if (snap.childLat && snap.childLng && pro.latitude && pro.longitude) {
    const km = haversineKm(snap.childLat, snap.childLng, pro.latitude, pro.longitude);
    if (km <= 5) return 30;
    if (km <= 10) return 20;
    if (km <= 20) return 10;
    return 0;
  }
  if (snap.childCity && pro.city) {
    return snap.childCity.trim().toLowerCase() === pro.city.trim().toLowerCase() ? 30 : 0;
  }
  return 0;
}

function scoreBudget(snap: MatchSnapshot, pro: ProfessionalForScoring): number {
  const { childBudgetMinInr: cMin, childBudgetMaxInr: cMax } = snap;
  const pMin = pro.pricingMinINR;
  const pMax = pro.pricingMaxINR;

  if (cMin == null || cMax == null) return 12;
  if (pMin == null || pMax == null) return 12;

  const overlapLow = Math.max(cMin, pMin);
  const overlapHigh = Math.min(cMax, pMax);
  if (overlapHigh < overlapLow) return 0;

  const childRange = cMax - cMin;
  const proRange = pMax - pMin;
  const overlap = overlapHigh - overlapLow;
  const fullOverlap = Math.min(childRange, proRange);
  return overlap >= fullOverlap ? 25 : 15;
}

function scoreExperience(snap: MatchSnapshot, pro: ProfessionalForScoring, tiers: TierDef[]): number {
  const { childBudgetMaxInr: cMax } = snap;

  if (cMax == null || tiers.length === 0) {
    return Math.min(pro.yearsExperience / 5, 1) * 20;
  }

  const sorted = [...tiers].sort((a, b) => a.maxSalaryInr - b.maxSalaryInr);
  const tier = sorted.find((t) => cMax <= t.maxSalaryInr) ?? sorted[sorted.length - 1]!;
  const required = tier.minExperienceYears ?? 0;

  if (pro.yearsExperience >= required) return 20;
  if (pro.yearsExperience >= required - 1) return 10;
  return 0;
}

function scoreLanguage(snap: MatchSnapshot, pro: ProfessionalForScoring): number {
  const childLangs = snap.childLanguages?.map((l) => l.toLowerCase()) ?? [];
  const proLangs = pro.languages?.map((l) => l.toLowerCase()) ?? [];

  if (childLangs.length === 0) return 8;
  if (proLangs.length === 0) return 8;

  return childLangs.some((l) => proLangs.includes(l)) ? 15 : 0;
}

function scoreHomeVisit(snap: MatchSnapshot, pro: ProfessionalForScoring): number {
  const modes = snap.childPreferredModes?.map((m) => m.toLowerCase()) ?? [];
  const wantsHome = modes.includes("home") || modes.includes("at-home") || modes.includes("at home");

  if (modes.length > 0) {
    return wantsHome ? (pro.offersHomeVisits ? 5 : 0) : pro.offersHomeVisits ? 3 : 2;
  }
  return pro.offersHomeVisits ? 3 : 2;
}

function scoreVerified(pro: ProfessionalForScoring): number {
  if (pro.verificationStatus === "verified") return 5;
  if (pro.verificationStatus === "pending") return 2;
  return 0;
}

// Compatibility scoring only — NEVER excludes a candidate (Rule 2). A
// candidate whose effective availability is later than the parent's desired
// start date just ranks lower, in proportion to the gap; a huge gap floors
// at 0 like every other scorer here, it doesn't remove them from the list.
// Missing data on either side scores a neutral default (~half of max),
// matching scoreLanguage's convention for "nothing to compare".
function scoreStartDate(snap: MatchSnapshot, pro: ProfessionalForScoring): number {
  if (!snap.childDesiredStartDate || !pro.effectiveAvailableFrom) return 8;
  if (pro.effectiveAvailableFrom <= snap.childDesiredStartDate) return 15;

  const gapDays = Math.round(
    (new Date(pro.effectiveAvailableFrom + "T00:00:00Z").getTime() -
      new Date(snap.childDesiredStartDate + "T00:00:00Z").getTime()) /
      86_400_000,
  );
  if (gapDays <= 7) return 10;
  if (gapDays <= 30) return 5;
  return 0;
}

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function overlapMinutes(a: WeeklyScheduleSlot, b: WeeklyScheduleSlot): number {
  const start = Math.max(toMinutes(a.startTime), toMinutes(b.startTime));
  const end = Math.min(toMinutes(a.endTime), toMinutes(b.endTime));
  return Math.max(0, end - start);
}

// Compatibility scoring only — NEVER excludes a candidate (Rule 2), same
// convention as scoreStartDate above. Measures what fraction of the
// parent's desired weekly schedule (childDesiredWeeklyScheduleJson) falls
// within the professional's stated general availability
// (generalAvailabilityJson) — both are descriptive/non-committed inputs,
// not the negotiated/committed schedule. Missing data on either side scores
// a neutral default (~half of max), matching every other dimension's
// convention for "nothing to compare".
function scoreScheduleOverlap(snap: MatchSnapshot, pro: ProfessionalForScoring): number {
  const desired = snap.childDesiredWeeklyScheduleJson;
  const available = pro.generalAvailabilityJson as WeeklyScheduleSlot[] | null | undefined;

  if (!desired || desired.length === 0) return 10;
  if (!available || available.length === 0) return 10;

  const totalMinutes = desired.reduce((sum, s) => sum + Math.max(0, toMinutes(s.endTime) - toMinutes(s.startTime)), 0);
  if (totalMinutes === 0) return 10;

  let coveredMinutes = 0;
  for (const d of desired) {
    for (const a of available) {
      if (d.dayOfWeek === a.dayOfWeek) coveredMinutes += overlapMinutes(d, a);
    }
  }
  const coverage = Math.min(coveredMinutes / totalMinutes, 1);

  if (coverage >= 1) return 20;
  if (coverage >= 0.5) return 12;
  if (coverage > 0) return 5;
  return 0;
}

export interface ScoredCandidate {
  professionalId: number;
  score: number;
  cityScore: number;
  budgetScore: number;
  experienceScore: number;
  languageScore: number;
  homeVisitScore: number;
  verifiedScore: number;
  startDateScore: number;
  scheduleOverlapScore: number;
  ratingBonus: number;
}

export function scoreCandidate(
  snap: MatchSnapshot,
  pro: ProfessionalForScoring,
  tiers: TierDef[],
): ScoredCandidate {
  const cityScore = scoreCityGeo(snap, pro);
  const budgetScore = scoreBudget(snap, pro);
  const experienceScore = scoreExperience(snap, pro, tiers);
  const languageScore = scoreLanguage(snap, pro);
  const homeVisitScore = scoreHomeVisit(snap, pro);
  const verifiedScore = scoreVerified(pro);
  const startDateScore = scoreStartDate(snap, pro);
  const scheduleOverlapScore = scoreScheduleOverlap(snap, pro);
  const ratingBonus = pro.averageRating != null ? (pro.averageRating / 5) * 5 : 0;

  const score =
    cityScore +
    budgetScore +
    experienceScore +
    languageScore +
    homeVisitScore +
    verifiedScore +
    startDateScore +
    scheduleOverlapScore;

  return {
    professionalId: pro.id,
    score: Math.round(score * 10) / 10,
    cityScore,
    budgetScore,
    experienceScore,
    languageScore,
    homeVisitScore,
    verifiedScore,
    startDateScore,
    scheduleOverlapScore,
    ratingBonus: Math.round(ratingBonus * 10) / 10,
  };
}

export function rankCandidates(
  snap: MatchSnapshot,
  professionals: ProfessionalForScoring[],
  tiers: TierDef[],
  topN = 3,
): ScoredCandidate[] {
  return professionals
    .map((p) => scoreCandidate(snap, p, tiers))
    .sort((a, b) => b.score - a.score || b.ratingBonus - a.ratingBonus)
    .slice(0, topN);
}

const CONTACT_PATTERNS: RegExp[] = [
  /(\+91[\s-]?)?[6-9]\d{9}/g,
  /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
  /https?:\/\/[^\s]+/gi,
  /wa\.me\/[^\s]*/gi,
  /\bupi\s*id\s*[:\-]?\s*\S+@\S+/gi,
  /\S+@\S+\.\S{2,}/g,
  /(whatsapp\s*(me|number|id|num|no|on)?|ping\s*me\s*on|call\s*me\s*(on|at)?|reach\s*me\s*(on|at)?|contact\s*me\s*(on|at)?|my\s*(number|num|no|contact|phone)\s*is?|message\s*me\s*on)[^.!?\n]{0,60}/gi,
];

export function maskBody(text: string): string {
  let result = text;
  for (const pattern of CONTACT_PATTERNS) {
    result = result.replace(pattern, "[contact removed]");
  }
  return result;
}
