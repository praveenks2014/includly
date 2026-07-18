import { and, desc, eq, isNull } from "drizzle-orm";
import Razorpay from "razorpay";
import {
  db,
  adminSettingsTable,
  shadowTeacherMatchesTable,
  shadowTeacherEngagementsTable,
  shadowMatchCandidatesTable,
  paymentsTable,
  professionalProfilesTable,
  refundResolutionLogTable,
} from "@workspace/db";
import { creditWallet } from "./ledger";
import { createInAppNotification } from "./notificationService";
import { onProfessionalBecameEligible } from "./candidateRefresh";

/**
 * Lazy-evaluation resolver for stuck shadow-teacher engagements — no cron.
 * Called at the top of any read path either party (or an admin view) hits
 * for a given match (GET my-request, my-candidacies, engagement detail).
 * Resolves in place if a configured timeout has passed; otherwise a no-op.
 *
 * KNOWN GAP (accepted for launch): if neither party nor an admin ever reads
 * this match again after the timeout passes, it stays unresolved and the
 * parent's money stays frozen indefinitely — there is no proactive push.
 * The only real fix is a scheduled job, which was explicitly ruled out here.
 * Piggybacking this same resolver onto admin list views (in addition to the
 * parent/professional read paths) widens coverage but does not close the gap.
 */

async function getSettings() {
  const [s] = await db.select().from(adminSettingsTable).limit(1);
  return (
    s ?? {
      commitResponseTimeoutDays: 7,
      activationFeeTimeoutDays: 7,
      otpStartTimeoutDays: 7,
      otpEndTimeoutDays: 7,
      shadowTeacherEngagementChoiceTimeoutDays: 7,
    }
  );
}

function getRazorpay(): Razorpay | null {
  const keyId = process.env["RAZORPAY_KEY_ID"];
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keyId || !keySecret) return null;
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Refunds a payment already recorded as a `payments` row (placement fee,
 * activation fee) — Razorpay source-refund first, wallet-credit fallback on
 * failure. Reuses the exact refund-then-persist pattern and creditWallet()
 * from the existing /shadow-teacher/:matchId/refund endpoint and the
 * teacher-decline path — not reimplemented.
 */
async function refundPaymentsTableRow(params: {
  paymentId: number;
  reason: string;
  matchId?: number;
  engagementId?: number;
}): Promise<number | null> {
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, params.paymentId));
  if (!payment || payment.status === "refunded") return null;

  const amountInr = Math.round(payment.amountPaise / 100);
  const razorpay = getRazorpay();
  let method: "razorpay_source" | "wallet_fallback" = "wallet_fallback";

  if (razorpay && payment.providerPaymentId) {
    try {
      await (razorpay.payments as unknown as { refund: (id: string, opts: object) => Promise<unknown> }).refund(
        payment.providerPaymentId,
        { amount: payment.amountPaise, notes: { reason: params.reason } },
      );
      method = "razorpay_source";
    } catch (err) {
      console.error(`[stuckEngagementResolver] Razorpay refund failed for payment ${payment.id}, falling back to wallet:`, err);
    }
  }

  if (method === "wallet_fallback") {
    await creditWallet(payment.userId, amountInr, "refund", payment.id, `Refund — ${params.reason}`);
  }

  await db.update(paymentsTable).set({ status: "refunded" }).where(eq(paymentsTable.id, payment.id));

  await db.insert(refundResolutionLogTable).values({
    reason: params.reason,
    matchId: params.matchId ?? null,
    engagementId: params.engagementId ?? null,
    refundedToUserId: payment.userId,
    amountInr,
    method,
    razorpayFeeAbsorbed: method === "razorpay_source",
  });

  return amountInr;
}

/**
 * Refunds a payment tracked directly on a match row (matching fee, trial
 * fee) rather than via a `payments` table row — same
 * razorpay-then-wallet-fallback pattern, adapted for that storage shape.
 */
async function refundMatchLevelPayment(params: {
  providerPaymentId: string | null;
  amountInr: number;
  refundToUserId: number;
  reason: string;
  matchId: number;
}): Promise<void> {
  if (params.amountInr <= 0) return;
  const razorpay = getRazorpay();
  let method: "razorpay_source" | "wallet_fallback" = "wallet_fallback";

  if (razorpay && params.providerPaymentId) {
    try {
      await (razorpay.payments as unknown as { refund: (id: string, opts: object) => Promise<unknown> }).refund(
        params.providerPaymentId,
        { amount: params.amountInr * 100, notes: { reason: params.reason } },
      );
      method = "razorpay_source";
    } catch (err) {
      console.error(`[stuckEngagementResolver] Razorpay refund failed for match ${params.matchId}, falling back to wallet:`, err);
    }
  }

  if (method === "wallet_fallback") {
    await creditWallet(params.refundToUserId, params.amountInr, "refund", params.matchId, `Refund — ${params.reason}`);
  }

  await db.insert(refundResolutionLogTable).values({
    reason: params.reason,
    matchId: params.matchId,
    refundedToUserId: params.refundToUserId,
    amountInr: params.amountInr,
    method,
    razorpayFeeAbsorbed: method === "razorpay_source",
  });
}

/** Shared reset: release the candidate, revert the match to shortlisted (mirrors the existing teacher-decline path exactly). */
async function releaseCandidateAndResetMatch(matchId: number, professionalId: number): Promise<void> {
  const [candidate] = await db
    .select({ id: shadowMatchCandidatesTable.id })
    .from(shadowMatchCandidatesTable)
    .where(
      and(
        eq(shadowMatchCandidatesTable.matchId, matchId),
        eq(shadowMatchCandidatesTable.professionalId, professionalId),
        isNull(shadowMatchCandidatesTable.removedAt),
      ),
    )
    .limit(1);

  if (candidate) {
    await db
      .update(shadowMatchCandidatesTable)
      .set({ removedAt: new Date() })
      .where(eq(shadowMatchCandidatesTable.id, candidate.id));
  }

  await db
    .update(shadowTeacherMatchesTable)
    .set({
      status: "shortlisted",
      selectedProfessionalId: null,
      matchedAt: null,
      matchedProfessionalId: null,
      updatedAt: new Date(),
    })
    .where(eq(shadowTeacherMatchesTable.id, matchId));
}

async function notifyBothParties(parentId: number, professionalId: number, parentBody: string, proBody: string, notifType: string, relatedId: number): Promise<void> {
  try {
    await createInAppNotification(parentId, { type: notifType, title: "Engagement auto-cancelled", body: parentBody, relatedType: "engagement", relatedId });
  } catch { /* non-blocking */ }
  try {
    const [pro] = await db.select({ userId: professionalProfilesTable.userId }).from(professionalProfilesTable).where(eq(professionalProfilesTable.id, professionalId));
    if (pro) {
      await createInAppNotification(pro.userId, { type: notifType, title: "Engagement auto-cancelled", body: proBody, relatedType: "engagement", relatedId });
    }
  } catch { /* non-blocking */ }
}

/** States 1 & 2 — pending_teacher_acceptance / pending_activation_fee timeout. Refund placement fee to parent only (teacher never paid anything in either state). */
async function resolvePlacementOnlyTimeout(eng: typeof shadowTeacherEngagementsTable.$inferSelect, reason: string): Promise<void> {
  await db
    .update(shadowTeacherEngagementsTable)
    .set({ status: "ended", endedReason: reason, updatedAt: new Date() })
    .where(eq(shadowTeacherEngagementsTable.id, eng.id));
  // Candidate-list auto-refresh — this teacher just became newly eligible again.
  try { await onProfessionalBecameEligible(eng.professionalId); } catch { /* non-blocking */ }

  if (eng.matchRequestId) {
    await releaseCandidateAndResetMatch(eng.matchRequestId, eng.professionalId);
  }

  let refundedInr: number | null = null;
  if (eng.placementFeePaymentId) {
    refundedInr = await refundPaymentsTableRow({
      paymentId: eng.placementFeePaymentId,
      reason,
      matchId: eng.matchRequestId ?? undefined,
      engagementId: eng.id,
    });
  }

  await notifyBothParties(
    eng.parentId,
    eng.professionalId,
    refundedInr
      ? `Your teacher didn't respond in time, so this engagement was auto-cancelled and your placement fee of ₹${refundedInr.toLocaleString("en-IN")} has been refunded. You can return to your enquiry to choose another teacher.`
      : "This engagement was auto-cancelled because your teacher didn't respond in time. You can return to your enquiry to choose another teacher.",
    "This engagement was auto-cancelled because it wasn't completed in time.",
    "engagement_auto_cancelled",
    eng.id,
  );
}

/**
 * #14/#15 reorder — pending_parent_payment timeout. The parent never
 * confirmed/paid after the teacher accepted. Nothing has been collected at
 * this point in the reordered flow, so there's no refund — just end the
 * engagement and release the candidate, same as an active decline but
 * tagged with a distinct endedReason so a timeout is never confused with
 * someone actively declining in the record.
 */
async function resolvePendingParentPaymentTimeout(eng: typeof shadowTeacherEngagementsTable.$inferSelect): Promise<void> {
  const reason = "parent_payment_timeout";

  await db
    .update(shadowTeacherEngagementsTable)
    .set({ status: "ended", endedReason: reason, updatedAt: new Date() })
    .where(eq(shadowTeacherEngagementsTable.id, eng.id));
  try { await onProfessionalBecameEligible(eng.professionalId); } catch { /* non-blocking */ }

  if (eng.matchRequestId) {
    await releaseCandidateAndResetMatch(eng.matchRequestId, eng.professionalId);
  }

  await notifyBothParties(
    eng.parentId,
    eng.professionalId,
    "This engagement was auto-cancelled because you didn't confirm and pay in time. You can return to your enquiry to choose another teacher.",
    "This engagement was auto-cancelled because the parent didn't confirm and pay in time.",
    "engagement_auto_cancelled",
    eng.id,
  );
}

/** State 3 — pending_start OTP timeout. Refund BOTH sides: no way to attribute fault for a stalled OTP exchange. */
async function resolvePendingStartTimeout(eng: typeof shadowTeacherEngagementsTable.$inferSelect): Promise<void> {
  const reason = "otp_start_timeout";

  await db
    .update(shadowTeacherEngagementsTable)
    .set({ status: "ended", endedReason: reason, updatedAt: new Date() })
    .where(eq(shadowTeacherEngagementsTable.id, eng.id));
  // Candidate-list auto-refresh — this teacher just became newly eligible again.
  try { await onProfessionalBecameEligible(eng.professionalId); } catch { /* non-blocking */ }

  if (eng.matchRequestId) {
    await releaseCandidateAndResetMatch(eng.matchRequestId, eng.professionalId);
  }

  let parentRefundInr: number | null = null;
  if (eng.placementFeePaymentId) {
    parentRefundInr = await refundPaymentsTableRow({
      paymentId: eng.placementFeePaymentId,
      reason,
      matchId: eng.matchRequestId ?? undefined,
      engagementId: eng.id,
    });
  }
  let teacherRefundInr: number | null = null;
  if (eng.activationFeePaymentId) {
    teacherRefundInr = await refundPaymentsTableRow({
      paymentId: eng.activationFeePaymentId,
      reason,
      matchId: eng.matchRequestId ?? undefined,
      engagementId: eng.id,
    });
  }

  await notifyBothParties(
    eng.parentId,
    eng.professionalId,
    parentRefundInr
      ? `The start code was never confirmed in time, so this engagement was auto-cancelled and your placement fee of ₹${parentRefundInr.toLocaleString("en-IN")} has been refunded. You can return to your enquiry to choose another teacher.`
      : "This engagement was auto-cancelled because the start code was never confirmed in time.",
    teacherRefundInr
      ? `The start code was never confirmed in time, so this engagement was auto-cancelled and your activation fee of ₹${teacherRefundInr.toLocaleString("en-IN")} has been refunded.`
      : "This engagement was auto-cancelled because the start code was never confirmed in time.",
    "engagement_auto_cancelled",
    eng.id,
  );
}

/** Resolves states 1-3 for a single engagement, if applicable. */
async function resolveEngagementTimeout(eng: typeof shadowTeacherEngagementsTable.$inferSelect): Promise<void> {
  const settings = await getSettings();

  if (eng.status === "pending_teacher_acceptance") {
    if (eng.createdAt < daysAgo(settings.commitResponseTimeoutDays)) {
      await resolvePlacementOnlyTimeout(eng, "commit_response_timeout");
    }
    return;
  }

  if (eng.status === "pending_parent_payment" && eng.pendingParentPaymentSince) {
    if (eng.pendingParentPaymentSince < daysAgo(settings.shadowTeacherEngagementChoiceTimeoutDays)) {
      await resolvePendingParentPaymentTimeout(eng);
    }
    return;
  }

  if (eng.status === "pending_activation_fee" && eng.pendingActivationFeeSince) {
    if (eng.pendingActivationFeeSince < daysAgo(settings.activationFeeTimeoutDays)) {
      await resolvePlacementOnlyTimeout(eng, "activation_fee_timeout");
    }
    return;
  }

  if (eng.status === "pending_start" && eng.pendingStartSince) {
    if (eng.pendingStartSince < daysAgo(settings.otpStartTimeoutDays)) {
      await resolvePendingStartTimeout(eng);
    }
    return;
  }
}

/** State 4 — trial_pending timeout. Trial never started; refund the trial fee to the parent. */
async function resolveTrialPendingTimeout(match: typeof shadowTeacherMatchesTable.$inferSelect): Promise<void> {
  const reason = "trial_pending_timeout";
  await releaseCandidateAndResetMatch(match.id, match.selectedProfessionalId!);

  if (match.trialFeePaidInr && match.trialFeePaidInr > 0) {
    await refundMatchLevelPayment({
      providerPaymentId: match.trialProviderPaymentId,
      amountInr: match.trialFeePaidInr,
      refundToUserId: match.parentId,
      reason,
      matchId: match.id,
    });
  }

  try {
    await createInAppNotification(match.parentId, {
      type: "trial_auto_cancelled",
      title: "Trial auto-cancelled",
      body: "Your trial day was never confirmed as started in time, so it was auto-cancelled and the trial fee has been refunded. You can return to your enquiry to choose another teacher.",
      relatedType: "match",
      relatedId: match.id,
    });
  } catch { /* non-blocking */ }
}

/** State 5 — trial_started timeout. Trial DID happen (parent already used the service) — force-progress to trial_done rather than refund, so the match isn't stuck. */
async function resolveTrialStartedTimeout(match: typeof shadowTeacherMatchesTable.$inferSelect): Promise<void> {
  await db
    .update(shadowTeacherMatchesTable)
    // trialDoneSince stamped here too (not just mark-trial-done) — otherwise
    // a trial that auto-completes via this timeout path would never start
    // the clock for State 6's "teacher never chose engagement" timeout below.
    .set({ status: "trial_done", trialDoneSince: new Date(), updatedAt: new Date() })
    .where(eq(shadowTeacherMatchesTable.id, match.id));

  try {
    await createInAppNotification(match.parentId, {
      type: "trial_auto_completed",
      title: "Trial marked complete",
      body: "Your trial day has been automatically marked complete. You can now commit or choose another teacher.",
      relatedType: "match",
      relatedId: match.id,
    });
  } catch { /* non-blocking */ }
}

/**
 * #14/#15 reorder — State 6: trial_done timeout. The teacher never clicked
 * Choose Engagement. Treated as an auto-decline — no reason given, since
 * nobody actively declined — distinct from an active teacher decline via
 * removedReason ("timed_out_teacher_response" vs "teacher_declined").
 */
async function resolveTrialDoneChoiceTimeout(match: typeof shadowTeacherMatchesTable.$inferSelect): Promise<void> {
  if (!match.selectedProfessionalId) return;

  const [candidate] = await db
    .select({ id: shadowMatchCandidatesTable.id })
    .from(shadowMatchCandidatesTable)
    .where(and(
      eq(shadowMatchCandidatesTable.matchId, match.id),
      eq(shadowMatchCandidatesTable.professionalId, match.selectedProfessionalId),
      isNull(shadowMatchCandidatesTable.removedAt),
    ))
    .limit(1);

  if (candidate) {
    await db
      .update(shadowMatchCandidatesTable)
      .set({ removedAt: new Date(), removedReason: "timed_out_teacher_response" })
      .where(eq(shadowMatchCandidatesTable.id, candidate.id));
  }

  await db
    .update(shadowTeacherMatchesTable)
    .set({
      status: "shortlisted",
      selectedProfessionalId: null,
      matchedAt: null,
      matchedProfessionalId: null,
      trialDoneSince: null,
      updatedAt: new Date(),
    })
    .where(eq(shadowTeacherMatchesTable.id, match.id));

  try {
    await createInAppNotification(match.parentId, {
      type: "candidate_declined_engagement",
      title: "Teacher didn't respond in time",
      body: "Your shadow teacher didn't respond in time after the trial, so they've been removed from this match. You can choose another candidate from your shortlist.",
      relatedType: "match",
      relatedId: match.id,
    });
  } catch { /* non-blocking */ }
}

/**
 * Entry point — call this at the top of any read path for a shadow-teacher
 * match (GET my-request, my-candidacies, admin list views). Resolves any of
 * the 7 stuck states if their configured timeout has passed; a no-op
 * otherwise. Safe to call on every read — idempotent, cheap (a handful of
 * timestamp comparisons plus conditional writes).
 */
export async function resolveStuckShadowTeacherMatch(matchId: number): Promise<void> {
  const [match] = await db.select().from(shadowTeacherMatchesTable).where(eq(shadowTeacherMatchesTable.id, matchId));
  if (!match) return;

  const settings = await getSettings();

  if (match.status === "trial_pending" && match.trialPendingSince) {
    if (match.trialPendingSince < daysAgo(settings.otpStartTimeoutDays)) {
      await resolveTrialPendingTimeout(match);
    }
    return;
  }

  if (match.status === "trial_started" && match.trialStartedSince) {
    if (match.trialStartedSince < daysAgo(settings.otpEndTimeoutDays)) {
      await resolveTrialStartedTimeout(match);
    }
    return;
  }

  if (match.status === "trial_done" && match.trialDoneSince) {
    if (match.trialDoneSince < daysAgo(settings.shadowTeacherEngagementChoiceTimeoutDays)) {
      await resolveTrialDoneChoiceTimeout(match);
    }
    return;
  }

  if (match.status === "committed") {
    const [eng] = await db
      .select()
      .from(shadowTeacherEngagementsTable)
      .where(eq(shadowTeacherEngagementsTable.matchRequestId, matchId))
      .orderBy(desc(shadowTeacherEngagementsTable.id))
      .limit(1);
    if (eng) await resolveEngagementTimeout(eng);
  }
}
