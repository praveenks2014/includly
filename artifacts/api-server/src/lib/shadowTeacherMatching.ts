// Shared matching helpers for shadow-teacher candidate surfacing — used by
// both the routes (initial surfacing/refill in shadowTeacher.ts) and the
// candidate-refresh hooks (candidateRefresh.ts). Extracted from
// shadowTeacher.ts verbatim, not reimplemented, so both call sites stay
// behaviorally identical.
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  db,
  adminSettingsTable,
  childrenTable,
  shadowTeacherEngagementsTable,
  tutorEngagementsTable,
  tutorEngagementSessionsTable,
  therapistEngagementsTable,
  therapistEngagementSessionsTable,
  sessionBookingsTable,
} from "@workspace/db";
import { overlaps } from "./scheduleConflict";
import { haversineKm } from "./geo";
import type { TierDef } from "./shadowTeacherScoring";

export async function getSettings() {
  const [s] = await db.select().from(adminSettingsTable).limit(1);
  return s ?? { matchingFeeInr: 500, matchingFeeRefundable: true, tiersJson: null, trialFeeInr: 500, noticePeriodDays: 30 };
}

export function parseTiers(tiersJson: string | null): TierDef[] {
  if (!tiersJson) return [];
  try { return JSON.parse(tiersJson) as TierDef[]; } catch { return []; }
}

export interface SchoolHoursFilterResult {
  passedIds: number[];
  // Surfaced alongside passedIds so callers that already need to look up a
  // child's school hours for scoring (scoreScheduleOverlap) don't have to
  // run a second, identical childrenTable query -- this function already
  // looks them up internally to run the exclusion itself. Null when the
  // child has no school hours on file (same case where the exclusion
  // itself is skipped below).
  schoolStartTime: string | null;
  schoolEndTime: string | null;
}

/**
 * School-hours EXCLUSION for shadow-teacher matching (Rule 1). See the
 * original comment in shadowTeacher.ts's git history for the full
 * reasoning — unchanged here, just relocated.
 */
export async function filterBySchoolHours(
  professionals: { id: number }[],
  childId: number | null,
): Promise<SchoolHoursFilterResult> {
  if (!childId || professionals.length === 0) {
    return { passedIds: professionals.map((p) => p.id), schoolStartTime: null, schoolEndTime: null };
  }

  const [child] = await db
    .select({ schoolStartTime: childrenTable.schoolStartTime, schoolEndTime: childrenTable.schoolEndTime })
    .from(childrenTable)
    .where(eq(childrenTable.id, childId))
    .limit(1);

  if (!child?.schoolStartTime || !child?.schoolEndTime) {
    return { passedIds: professionals.map((p) => p.id), schoolStartTime: null, schoolEndTime: null };
  }

  const schoolStart = child.schoolStartTime;
  const schoolEnd   = child.schoolEndTime;
  const proIds      = professionals.map((p) => p.id);

  const ownEngagements = await db
    .select({
      professionalId: shadowTeacherEngagementsTable.professionalId,
      recurringScheduleJson: shadowTeacherEngagementsTable.recurringScheduleJson,
    })
    .from(shadowTeacherEngagementsTable)
    .where(and(
      inArray(shadowTeacherEngagementsTable.professionalId, proIds),
      sql`${shadowTeacherEngagementsTable.status} != 'ended'`,
    ));

  const overlapIds = new Set<number>();
  for (const eng of ownEngagements) {
    const slots = (eng.recurringScheduleJson as { dayOfWeek: number; startTime: string; endTime: string }[] | null) ?? [];
    for (const s of slots) {
      if (s.dayOfWeek >= 1 && s.dayOfWeek <= 5 && overlaps(s.startTime, s.endTime, schoolStart, schoolEnd)) {
        overlapIds.add(eng.professionalId);
        break;
      }
    }
  }

  // Tutor/therapist's own agreed weekly commitment (recurringScheduleJson) —
  // same exclusion as shadow-teacher's ownEngagements above, now that these
  // two verticals also capture a recurring pattern (previously only their
  // individually-scheduled sessions, checked below, were considered).
  const [tutorRecurring, therapistRecurring] = await Promise.all([
    db
      .select({ professionalId: tutorEngagementsTable.professionalId, recurringScheduleJson: tutorEngagementsTable.recurringScheduleJson })
      .from(tutorEngagementsTable)
      .where(and(
        inArray(tutorEngagementsTable.professionalId, proIds),
        sql`${tutorEngagementsTable.status} != 'ended'`,
      )),
    db
      .select({ professionalId: therapistEngagementsTable.professionalId, recurringScheduleJson: therapistEngagementsTable.recurringScheduleJson })
      .from(therapistEngagementsTable)
      .where(and(
        inArray(therapistEngagementsTable.professionalId, proIds),
        sql`${therapistEngagementsTable.status} != 'ended'`,
      )),
  ]);
  for (const eng of [...tutorRecurring, ...therapistRecurring]) {
    const slots = (eng.recurringScheduleJson as { dayOfWeek: number; startTime: string; endTime: string }[] | null) ?? [];
    for (const s of slots) {
      if (s.dayOfWeek >= 1 && s.dayOfWeek <= 5 && overlaps(s.startTime, s.endTime, schoolStart, schoolEnd)) {
        overlapIds.add(eng.professionalId);
        break;
      }
    }
  }

  const [tutorSessions, therapistSessions, bookings] = await Promise.all([
    db
      .select({ professionalId: tutorEngagementsTable.professionalId, date: tutorEngagementSessionsTable.sessionDate, startTime: tutorEngagementSessionsTable.startTime, endTime: tutorEngagementSessionsTable.endTime })
      .from(tutorEngagementSessionsTable)
      .innerJoin(tutorEngagementsTable, eq(tutorEngagementSessionsTable.engagementId, tutorEngagementsTable.id))
      .where(and(
        inArray(tutorEngagementsTable.professionalId, proIds),
        inArray(tutorEngagementSessionsTable.status, ["scheduled", "started"]),
        isNotNull(tutorEngagementSessionsTable.startTime),
        isNotNull(tutorEngagementSessionsTable.endTime),
      )),
    db
      .select({ professionalId: therapistEngagementsTable.professionalId, date: therapistEngagementSessionsTable.sessionDate, startTime: therapistEngagementSessionsTable.startTime, endTime: therapistEngagementSessionsTable.endTime })
      .from(therapistEngagementSessionsTable)
      .innerJoin(therapistEngagementsTable, eq(therapistEngagementSessionsTable.engagementId, therapistEngagementsTable.id))
      .where(and(
        inArray(therapistEngagementsTable.professionalId, proIds),
        inArray(therapistEngagementSessionsTable.status, ["scheduled", "started"]),
        isNotNull(therapistEngagementSessionsTable.startTime),
        isNotNull(therapistEngagementSessionsTable.endTime),
      )),
    db
      .select({ professionalId: sessionBookingsTable.professionalId, date: sessionBookingsTable.bookedDate, startTime: sessionBookingsTable.startTime, endTime: sessionBookingsTable.endTime })
      .from(sessionBookingsTable)
      .where(and(
        inArray(sessionBookingsTable.professionalId, proIds),
        eq(sessionBookingsTable.status, "confirmed"),
      )),
  ]);

  for (const row of [...tutorSessions, ...therapistSessions, ...bookings]) {
    if (!row.startTime || !row.endTime) continue;
    const dayOfWeek = new Date(row.date + "T00:00:00Z").getUTCDay();
    if (dayOfWeek >= 1 && dayOfWeek <= 5 && overlaps(row.startTime, row.endTime, schoolStart, schoolEnd)) {
      overlapIds.add(row.professionalId);
    }
  }

  return {
    passedIds: professionals.filter((p) => !overlapIds.has(p.id)).map((p) => p.id),
    schoolStartTime: schoolStart,
    schoolEndTime: schoolEnd,
  };
}

const GEO_EXCLUSION_RADIUS_KM = 20;

export type GeoFilterStatus = "applied" | "no_matches_in_radius" | "unavailable";

export interface GeoFilterResult {
  passedIds: number[];
  geoFilterStatus: GeoFilterStatus;
}

/**
 * School-distance EXCLUSION for shadow-teacher matching (Rule 3 — distinct
 * from this file's existing "Rule 2" label on computeEffectiveAvailableFrom
 * below, which is a scoring input, never an exclusion; naming kept
 * consistent with that established numbering rather than reusing "Rule 2"
 * for something that actually does exclude).
 *
 * Hard-excludes a candidate ONLY when both the school and the candidate
 * have real coordinates and the distance between them exceeds
 * GEO_EXCLUSION_RADIUS_KM. A candidate with no coordinates on their own
 * side is never excluded here — that's Tier 2, left entirely to
 * scoreCityGeo's city-string fallback, same weight as always, never
 * promoted to an exclusion (a missing coordinate is our own data gap, not
 * evidence the candidate is actually far away).
 *
 * geoFilterStatus: "unavailable" whenever the school itself has no
 * coordinates (most matches today — nothing to filter by); "applied" once
 * at least one candidate is CONFIRMED within radius; "no_matches_in_radius"
 * when the school has coordinates but nobody was confirmed within range —
 * the one state the parent-facing banner fires on.
 */
export function applyGeoFilter(
  schoolLat: number | null,
  schoolLng: number | null,
  professionals: { id: number; latitude: number | null; longitude: number | null }[],
): GeoFilterResult {
  if (schoolLat == null || schoolLng == null) {
    return { passedIds: professionals.map((p) => p.id), geoFilterStatus: "unavailable" };
  }

  const passedIds: number[] = [];
  let anyConfirmedWithinRadius = false;
  for (const p of professionals) {
    if (p.latitude == null || p.longitude == null) {
      // No coordinate on the candidate's side -- Tier 2, passes through to
      // scoreCityGeo's own string comparison, never excluded by this rule.
      passedIds.push(p.id);
      continue;
    }
    const km = haversineKm(schoolLat, schoolLng, p.latitude, p.longitude);
    if (km <= GEO_EXCLUSION_RADIUS_KM) {
      passedIds.push(p.id);
      anyConfirmedWithinRadius = true;
    }
  }

  return {
    passedIds,
    geoFilterStatus: anyConfirmedWithinRadius ? "applied" : "no_matches_in_radius",
  };
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function maxDateStr(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/**
 * Effective "available from" date per candidate (Rule 2 support) — never an
 * exclusion, purely a display/scoring input. MAX(earliestStartDate, current
 * notice_period engagement's endDate + 1 day). No non-ended engagement, or
 * one that's not in notice_period (those are still hard-excluded by
 * busyProfIds and never reach this call) -> just earliestStartDate.
 */
export async function computeEffectiveAvailableFrom(
  professionals: { id: number; earliestStartDate: string | null }[],
): Promise<Map<number, string | null>> {
  const proIds = professionals.map((p) => p.id);
  const noticeRows = proIds.length > 0
    ? await db
        .select({ professionalId: shadowTeacherEngagementsTable.professionalId, endDate: shadowTeacherEngagementsTable.endDate })
        .from(shadowTeacherEngagementsTable)
        .where(and(
          inArray(shadowTeacherEngagementsTable.professionalId, proIds),
          eq(shadowTeacherEngagementsTable.status, "notice_period"),
        ))
    : [];

  const noticeEndByPro = new Map<number, string | null>();
  for (const row of noticeRows) noticeEndByPro.set(row.professionalId, row.endDate);

  const result = new Map<number, string | null>();
  for (const p of professionals) {
    const noticeEnd = noticeEndByPro.get(p.id);
    const availableAfterNotice = noticeEnd ? addDays(noticeEnd, 1) : null;
    result.set(p.id, maxDateStr(p.earliestStartDate, availableAfterNotice));
  }
  return result;
}
