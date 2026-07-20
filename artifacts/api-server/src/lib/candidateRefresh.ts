// Shadow-teacher candidate-list auto-refresh — triggered at discrete
// eligibility-changing events (never a poll/cron), for exactly one
// professional at a time:
//   - admin verification approval (both the primary and additional-offering
//     approve endpoints)
//   - paymentActivated flipping true (both set-points)
//   - an engagement transitioning to notice_period or ended (freeing a
//     previously-busy professional)
//
// Two distinct policies, deliberately using different `addedBy` markers so
// their caps never cross-contaminate:
//   - shortlist has >=3 active candidates: threshold-gated (must beat the
//     current best by admin_settings.shadowTeacherRefreshMinScoreGap),
//     capped at exactly ONE such addition ever, per match. addedBy = 'auto_refresh'.
//   - shortlist has <3 active candidates: no threshold, no cap — this is
//     filling an incomplete list, the same thing the manual dismiss->refill
//     flow already does, just triggered by these events instead of a
//     parent's dismiss action. addedBy = 'auto_refill'.
import { and, eq, or, isNull, isNotNull, inArray, sql } from "drizzle-orm";
import {
  db,
  shadowTeacherMatchesTable,
  shadowMatchCandidatesTable,
  shadowTeacherEngagementsTable,
  professionalProfilesTable,
  professionalOfferingsTable,
  identityVerificationsTable,
  negotiationOffersTable,
  interviewTimeOffersTable,
  shadowMatchMessagesTable,
  shadowMatchThreadsTable,
  childrenTable,
} from "@workspace/db";
import { getSettings, parseTiers, filterBySchoolHours, computeEffectiveAvailableFrom } from "./shadowTeacherMatching";
import { scoreCandidate, type MatchSnapshot, type ProfessionalForScoring } from "./shadowTeacherScoring";
import { createInAppNotification } from "./notificationService";

const REFRESH_ADDED_BY = "auto_refresh"; // >=3 case — threshold-gated, capped once per match
const REFILL_ADDED_BY = "auto_refill";   // <3 case — no threshold, no cap

/**
 * Has ANY interaction happened on this match yet? Grounded in real fields —
 * see the design notes: thread EXISTENCE is deliberately NOT checked here
 * (a thread is created merely by opening the chat drawer, a read action);
 * only an actual MESSAGE counts.
 */
async function hasInteractionStarted(matchId: number): Promise<boolean> {
  const [candidateInteraction] = await db
    .select({ id: shadowMatchCandidatesTable.id })
    .from(shadowMatchCandidatesTable)
    .where(and(
      eq(shadowMatchCandidatesTable.matchId, matchId),
      isNull(shadowMatchCandidatesTable.removedAt),
      or(
        sql`${shadowMatchCandidatesTable.requestStatus} != 'not_sent'`,
        isNotNull(shadowMatchCandidatesTable.interviewSlotsJson),
        isNotNull(shadowMatchCandidatesTable.interviewConfirmedSlot),
        isNotNull(shadowMatchCandidatesTable.interviewDoneAt),
        isNotNull(shadowMatchCandidatesTable.trialDaysRequested),
        isNotNull(shadowMatchCandidatesTable.trialDaysAccepted),
      )!,
    ))
    .limit(1);
  if (candidateInteraction) return true;

  const [negotiation] = await db
    .select({ id: negotiationOffersTable.id })
    .from(negotiationOffersTable)
    .innerJoin(shadowMatchCandidatesTable, eq(shadowMatchCandidatesTable.id, negotiationOffersTable.candidateId))
    .where(eq(shadowMatchCandidatesTable.matchId, matchId))
    .limit(1);
  if (negotiation) return true;

  // Interview-time offers replaced interviewSlotsJson above as the signal
  // for "an interview time has been proposed" — a pending (not yet
  // accepted) proposal wouldn't otherwise be caught by any of the checks
  // above, since interviewConfirmedSlot/interviewDoneAt only get set once
  // one side accepts.
  const [interviewTimeOffer] = await db
    .select({ id: interviewTimeOffersTable.id })
    .from(interviewTimeOffersTable)
    .innerJoin(shadowMatchCandidatesTable, eq(shadowMatchCandidatesTable.id, interviewTimeOffersTable.candidateId))
    .where(eq(shadowMatchCandidatesTable.matchId, matchId))
    .limit(1);
  if (interviewTimeOffer) return true;

  const [message] = await db
    .select({ id: shadowMatchMessagesTable.id })
    .from(shadowMatchMessagesTable)
    .innerJoin(shadowMatchThreadsTable, eq(shadowMatchThreadsTable.id, shadowMatchMessagesTable.threadId))
    .where(eq(shadowMatchThreadsTable.matchId, matchId))
    .limit(1);
  return !!message;
}

export async function onProfessionalBecameEligible(professionalId: number): Promise<void> {
  const settings = await getSettings();
  const shadowTeacherListingFeeEnabled = (settings as Record<string, unknown>)["shadowTeacherListingFeeEnabled"] as boolean | undefined;
  const platformSalaryEnabled = (settings as Record<string, unknown>)["platformSalaryEnabled"] as boolean | undefined;
  const minScoreGap = ((settings as Record<string, unknown>)["shadowTeacherRefreshMinScoreGap"] as number | undefined) ?? 20;

  // Base eligibility gate — IDENTICAL conditions to the bulk surfacing query
  // in shadowTeacher.ts's surfaceCandidatesForMatch, scoped to this one
  // professional. Re-verified here rather than trusted from the caller,
  // since e.g. admin-approval alone doesn't guarantee paymentActivated is
  // also true.
  const [eligibleRow] = await db
    .select({ profile: professionalProfilesTable, offering: professionalOfferingsTable })
    .from(professionalProfilesTable)
    .leftJoin(
      professionalOfferingsTable,
      and(
        eq(professionalOfferingsTable.professionalId, professionalProfilesTable.id),
        eq(professionalOfferingsTable.vertical, "shadow_teacher"),
      ),
    )
    .where(
      and(
        eq(professionalProfilesTable.id, professionalId),
        or(
          and(
            eq(professionalProfilesTable.specialty, "shadow_teacher"),
            eq(professionalProfilesTable.verificationStatus, "verified"),
            isNotNull(professionalProfilesTable.pricingMinINR),
            ...(shadowTeacherListingFeeEnabled ? [isNotNull(professionalProfilesTable.listingFeePaidAt)] : []),
          ),
          and(
            isNotNull(professionalOfferingsTable.id),
            eq(professionalOfferingsTable.verificationStatus, "verified"),
            isNotNull(professionalOfferingsTable.pricingMinINR),
            ...(shadowTeacherListingFeeEnabled ? [isNotNull(professionalOfferingsTable.listingFeePaidAt)] : []),
          ),
        )!,
        eq(professionalProfilesTable.paymentActivated, true),
        sql`EXISTS (SELECT 1 FROM ${identityVerificationsTable} iv WHERE iv.professional_id = ${professionalProfilesTable.id})`,
        // Same UPI-verified listability condition as surfaceCandidatesForMatch
        // — see that function's comment for the full reasoning.
        ...(!platformSalaryEnabled ? [isNotNull(professionalProfilesTable.upiVerifiedAt)] : []),
      ),
    );

  if (!eligibleRow) return; // not (yet) actually eligible — no-op, safe to call speculatively

  // busyProfIds check, scoped to this one professional — same two conditions
  // as the bulk query's hard-exclude set.
  const [engBusy] = await db
    .select({ id: shadowTeacherEngagementsTable.id })
    .from(shadowTeacherEngagementsTable)
    .where(and(
      eq(shadowTeacherEngagementsTable.professionalId, professionalId),
      sql`${shadowTeacherEngagementsTable.status} != 'ended' AND ${shadowTeacherEngagementsTable.status} != 'notice_period'`,
    ))
    .limit(1);
  if (engBusy) return;

  const [matchBusy] = await db
    .select({ id: shadowTeacherMatchesTable.id })
    .from(shadowTeacherMatchesTable)
    .where(and(
      eq(shadowTeacherMatchesTable.selectedProfessionalId, professionalId),
      inArray(shadowTeacherMatchesTable.status, ["pending_commitment", "trial_pending", "trial_started", "trial_done"]),
    ))
    .limit(1);
  if (matchBusy) return;

  const isPrimaryMatch = eligibleRow.profile.specialty === "shadow_teacher"
    && eligibleRow.profile.verificationStatus === "verified"
    && eligibleRow.profile.pricingMinINR != null;
  const proRow = isPrimaryMatch || !eligibleRow.offering
    ? eligibleRow.profile
    : {
        ...eligibleRow.profile,
        pricingMinINR: eligibleRow.offering.pricingMinINR,
        pricingMaxINR: eligibleRow.offering.pricingMaxINR,
        verificationStatus: eligibleRow.offering.verificationStatus,
      };

  const availabilityMap = await computeEffectiveAvailableFrom([{ id: proRow.id, earliestStartDate: proRow.earliestStartDate }]);
  const proForScoring: ProfessionalForScoring = {
    ...proRow,
    effectiveAvailableFrom: availabilityMap.get(proRow.id) ?? proRow.earliestStartDate,
  };

  const tiers = parseTiers(settings.tiersJson);
  const matches = await db.select().from(shadowTeacherMatchesTable).where(eq(shadowTeacherMatchesTable.status, "shortlisted"));

  for (const match of matches) {
    // "Ever shown" (regardless of removedAt) — don't re-surface someone the
    // parent already saw and/or dismissed, same semantics as the existing
    // manual-refill exclusion.
    const [everShown] = await db
      .select({ id: shadowMatchCandidatesTable.id })
      .from(shadowMatchCandidatesTable)
      .where(and(eq(shadowMatchCandidatesTable.matchId, match.id), eq(shadowMatchCandidatesTable.professionalId, professionalId)))
      .limit(1);
    if (everShown) continue;

    if (await hasInteractionStarted(match.id)) continue;

    const passedIds = await filterBySchoolHours([{ id: professionalId }], match.childId ?? null);
    if (!passedIds.includes(professionalId)) continue;

    const activeCandidates = await db
      .select()
      .from(shadowMatchCandidatesTable)
      .where(and(eq(shadowMatchCandidatesTable.matchId, match.id), isNull(shadowMatchCandidatesTable.removedAt)));

    const snap: MatchSnapshot = {
      childCity: match.childCity ?? null,
      childLat: null,
      childLng: null,
      childLanguages: match.childLanguages ?? null,
      childBudgetMinInr: match.childBudgetMinInr ?? null,
      childBudgetMaxInr: match.childBudgetMaxInr ?? null,
      childPreferredModes: match.childPreferredModes ?? null,
      childDesiredStartDate: match.childDesiredStartDate ?? null,
    };
    const scored = scoreCandidate(snap, proForScoring, tiers);

    const [maxRankRow] = await db
      .select({ maxRank: sql<number>`max(rank)` })
      .from(shadowMatchCandidatesTable)
      .where(eq(shadowMatchCandidatesTable.matchId, match.id));
    const nextRank = (maxRankRow?.maxRank ?? 0) + 1;

    if (activeCandidates.length < 3) {
      await db.insert(shadowMatchCandidatesTable).values({
        matchId: match.id,
        professionalId,
        score: scored.score,
        rank: nextRank,
        addedBy: REFILL_ADDED_BY,
      });
      await db
        .update(shadowTeacherMatchesTable)
        .set({ distinctTeachersShown: sql`${shadowTeacherMatchesTable.distinctTeachersShown} + 1`, updatedAt: new Date() })
        .where(eq(shadowTeacherMatchesTable.id, match.id));

      const [child] = match.childId
        ? await db.select({ name: childrenTable.name }).from(childrenTable).where(eq(childrenTable.id, match.childId)).limit(1)
        : [];
      await createInAppNotification(match.parentId, {
        type: "candidates_refreshed",
        title: "New shadow teacher matches found",
        body: `New shadow teacher matches found for ${child?.name ?? "your child"}.`,
        relatedType: "match",
        relatedId: match.id,
      }).catch(() => {});
    } else {
      const [alreadyRefreshed] = await db
        .select({ id: shadowMatchCandidatesTable.id })
        .from(shadowMatchCandidatesTable)
        .where(and(eq(shadowMatchCandidatesTable.matchId, match.id), eq(shadowMatchCandidatesTable.addedBy, REFRESH_ADDED_BY)))
        .limit(1);
      if (alreadyRefreshed) continue;

      const bestCurrentScore = activeCandidates.reduce((max, c) => Math.max(max, c.score ?? 0), 0);
      if (scored.score - bestCurrentScore < minScoreGap) continue;

      await db.insert(shadowMatchCandidatesTable).values({
        matchId: match.id,
        professionalId,
        score: scored.score,
        rank: nextRank,
        addedBy: REFRESH_ADDED_BY,
      });
      await db
        .update(shadowTeacherMatchesTable)
        .set({ distinctTeachersShown: sql`${shadowTeacherMatchesTable.distinctTeachersShown} + 1`, updatedAt: new Date() })
        .where(eq(shadowTeacherMatchesTable.id, match.id));
      // No push/in-app notification here by design — banner-only for the
      // >=3 threshold-triggered case, per the confirmed design.
    }
  }
}
