import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, or, desc, isNull, isNotNull, sql, count, max, inArray, notInArray, gte, gt, lt } from "drizzle-orm";
import Razorpay from "razorpay";
import crypto from "crypto";
import {
  db,
  shadowTeacherMatchesTable,
  shadowMatchCandidatesTable,
  shadowMatchThreadsTable,
  shadowMatchMessagesTable,
  shadowTeacherEngagementsTable,
  usersTable,
  professionalProfilesTable,
  professionalOfferingsTable,
  childrenTable,
  negotiationOffersTable,
  professionalAvailabilityTable,
  connectThreadsTable,
  paymentsTable,
  identityVerificationsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { z } from "zod/v4";
import { rankCandidates, maskBody, type MatchSnapshot, type ProfessionalForScoring } from "../lib/shadowTeacherScoring";
import { notifyMatchShortlisted, notifyMatchChatMessage, notifyParentOnTrialDone, createInAppNotification } from "../lib/notificationService";
import { generateOtp } from "../lib/otp";
import { creditWallet } from "../lib/ledger";
import { resolveStuckShadowTeacherMatch } from "../lib/stuckEngagementResolver";
import { getSettings, parseTiers, filterBySchoolHours, computeEffectiveAvailableFrom } from "../lib/shadowTeacherMatching";
import { JITSI_CONFIG_SUFFIX } from "../lib/jitsi";

const router: IRouter = Router();

function getRazorpay() {
  const keyId = process.env["RAZORPAY_KEY_ID"];
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keyId || !keySecret) return null;
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

function maskProfile(
  profile: {
    fullName: string | null;
    phone: string | null;
    email: string | null;
    bio: string | null;
    [key: string]: unknown;
  },
  committed: boolean,
) {
  if (committed) return profile;
  const firstName = profile.fullName?.split(" ")[0] ?? null;
  return {
    ...profile,
    fullName: null,
    firstName,
    phone: null,
    email: null,
    bio: profile.bio,
  };
}

type MatchRow = typeof shadowTeacherMatchesTable.$inferSelect;

// ── Shared helper: surface candidates for a newly-shortlisted match ────────
// Called from both the paid verify-request-payment path and the waived request path.
// Returns the number of candidates surfaced.
async function surfaceCandidatesForMatch(match: MatchRow): Promise<number> {
  // Exclude shadow teachers who already have an engagement that isn't ended
  // AND isn't in notice_period — a notice_period engagement has a known
  // endDate, so those candidates are no longer hard-excluded; they're
  // listed (subject to Rule 1's overlap check) with their effective
  // availability computed and scored (Rule 2), not filtered by it.
  const engBusyRows = await db
    .select({ professionalId: shadowTeacherEngagementsTable.professionalId })
    .from(shadowTeacherEngagementsTable)
    .where(sql`${shadowTeacherEngagementsTable.status} != 'ended' AND ${shadowTeacherEngagementsTable.status} != 'notice_period'`);

  // Also exclude teachers selected in an in-flight match (no engagement created yet)
  const matchBusyRows = await db
    .select({ professionalId: shadowTeacherMatchesTable.selectedProfessionalId })
    .from(shadowTeacherMatchesTable)
    .where(and(
      isNotNull(shadowTeacherMatchesTable.selectedProfessionalId),
      inArray(shadowTeacherMatchesTable.status, [
        "pending_commitment",
        "trial_pending", "trial_started", "trial_done",
      ]),
    ));

  const busyProfIds = [...new Set([
    ...engBusyRows.map((r) => r.professionalId),
    ...matchBusyRows.map((r) => r.professionalId!),
  ])];

  const settings = await getSettings();
  const shadowTeacherListingFeeEnabled = (settings as Record<string, unknown>)["shadowTeacherListingFeeEnabled"] as boolean | undefined;

  // Run scoring and surface up to 3 candidates.
  //
  // A professional's PRIMARY vertical still lives directly on
  // professional_profiles (untouched — same columns as always). A professional
  // who added shadow-teaching as an ADDITIONAL offering (Prompt 1 multi-vertical
  // model) has their own separate verificationStatus/pricing in
  // professional_offerings — an RCI-verified therapist does NOT surface here
  // just because their PRIMARY profile is verified; their shadow-teacher
  // OFFERING must independently pass this same gate (verified + priced).
  //
  // CROSS-REFERENCE: the listability rule below (primary-row OR offering-row,
  // both requiring verificationStatus='verified') is DUPLICATED — not shared
  // code — with isOfferingListable()/resolveOffering() in
  // artifacts/api-server/src/lib/verificationRequirements.ts and
  // artifacts/api-server/src/lib/offeringResolver.ts. That single-professional
  // path can't be reused here directly (it would be an N+1 query against
  // hundreds of candidates per match); this bulk SQL JOIN encodes the same
  // rule instead. If what makes an offering "listable" ever changes (e.g. the
  // listing-fee gate), THIS query and THAT function must be updated together
  // — check both before assuming a change here is complete.
  const rows = await db
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
        or(
          // Primary offering — identical condition to before this change,
          // plus the listing-fee gate (no-op unless the toggle is on).
          and(
            eq(professionalProfilesTable.specialty, "shadow_teacher"),
            eq(professionalProfilesTable.verificationStatus, "verified"),
            isNotNull(professionalProfilesTable.pricingMinINR),
            ...(shadowTeacherListingFeeEnabled ? [isNotNull(professionalProfilesTable.listingFeePaidAt)] : []),
          ),
          // Additional (non-primary) shadow-teacher offering — gated
          // independently on ITS OWN verificationStatus/pricing/listing-fee.
          and(
            isNotNull(professionalOfferingsTable.id),
            eq(professionalOfferingsTable.verificationStatus, "verified"),
            isNotNull(professionalOfferingsTable.pricingMinINR),
            ...(shadowTeacherListingFeeEnabled ? [isNotNull(professionalOfferingsTable.listingFeePaidAt)] : []),
          ),
        )!,
        eq(professionalProfilesTable.paymentActivated, true),
        // Defense-in-depth: every candidate must have a government ID on file
        sql`EXISTS (SELECT 1 FROM ${identityVerificationsTable} iv WHERE iv.professional_id = ${professionalProfilesTable.id})`,
        ...(busyProfIds.length > 0 ? [notInArray(professionalProfilesTable.id, busyProfIds)] : []),
      ),
    );

  // Collapse the join back into profile-shaped rows, using the OFFERING's own
  // pricing/verificationStatus when the match came from a non-primary offering
  // (every other field — city, languages, experience, home visits, rating —
  // is shared identity data and always comes from the profile row).
  const allProfessionals = rows.map(({ profile, offering }: {
    profile: typeof professionalProfilesTable.$inferSelect;
    offering: typeof professionalOfferingsTable.$inferSelect | null;
  }) => {
    const isPrimaryMatch = profile.specialty === "shadow_teacher" && profile.verificationStatus === "verified" && profile.pricingMinINR != null;
    if (isPrimaryMatch || !offering) {
      return profile;
    }
    return {
      ...profile,
      pricingMinINR: offering.pricingMinINR,
      pricingMaxINR: offering.pricingMaxINR,
      verificationStatus: offering.verificationStatus,
    };
  });

  // School-hours exclusion (Rule 1): remove professionals whose ACTUAL
  // EXISTING commitment hours (own shadow-teaching schedule, or a booked
  // tutor/therapist session) overlap the child's school hours.
  const passedIds = await filterBySchoolHours(allProfessionals, match.childId ?? null);
  const passedSet = new Set(passedIds);
  const professionals = allProfessionals.filter((p) => passedSet.has(p.id));

  // Rule 2 support: effective availability per candidate, never an exclusion.
  const availabilityMap = await computeEffectiveAvailableFrom(
    professionals.map((p) => ({ id: p.id, earliestStartDate: p.earliestStartDate })),
  );
  const professionalsForScoring: ProfessionalForScoring[] = professionals.map((p) => ({
    ...p,
    effectiveAvailableFrom: availabilityMap.get(p.id) ?? p.earliestStartDate,
  }));

  const tiers = parseTiers(settings.tiersJson);
  // KNOWN GAP: childLat/childLng are hardcoded null here, so scoreCityGeo's
  // haversine branch never actually runs for matching today — it silently
  // falls back to exact-city-string matching. Not fixed as part of the D-day
  // candidate-card distance work; this is shadow-teacher's SCHOOL-distance
  // question (parked separately), not the tutor/therapist HOME-distance one.
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

  const ranked = rankCandidates(snap, professionalsForScoring, tiers, 3);
  let candidateCount = 0;

  if (ranked.length > 0) {
    await db.insert(shadowMatchCandidatesTable).values(
      ranked.map((c, i) => ({
        matchId: match.id,
        professionalId: c.professionalId,
        score: c.score,
        rank: i + 1,
        addedBy: "auto",
      })),
    );
    candidateCount = ranked.length;

    // Push + in-app notify teachers
    const teacherUserIds = professionals
      .filter((p) => ranked.some((r) => r.professionalId === p.id))
      .map((p) => p.userId);
    void notifyMatchShortlisted(teacherUserIds).catch(() => {});
    void Promise.allSettled(teacherUserIds.map((uid) =>
      createInAppNotification(uid, {
        type: "match_shortlisted",
        title: "A family is interested in you",
        body: "A parent has shortlisted you for their child. Log in to view details and chat.",
        relatedType: "match",
        relatedId: match.id,
      }),
    ));
  }

  // Set high-water-mark counter (never decrements from here)
  await db
    .update(shadowTeacherMatchesTable)
    .set({ distinctTeachersShown: candidateCount })
    .where(eq(shadowTeacherMatchesTable.id, match.id));

  return candidateCount;
}

// ── GET /shadow-teacher/pricing — public: returns matching fee + trial fee ────
router.get("/shadow-teacher/pricing", async (_req: Request, res: Response): Promise<void> => {
  const s = await getSettings();
  res.json({
    matchingFeeInr: s.matchingFeeInr,
    trialFeeInr: (s as Record<string, unknown>)["trialFeeInr"] as number ?? 500,
    noticePeriodDays: (s as Record<string, unknown>)["noticePeriodDays"] as number ?? 30,
  });
});

// ── GET /shadow-teacher/re-request-eligibility — waiver check for re-requests ─
router.get("/shadow-teacher/re-request-eligibility", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const childId = parseInt(req.query["childId"] as string, 10);
  if (isNaN(childId)) { res.status(400).json({ error: "childId required" }); return; }

  const [child] = await db
    .select()
    .from(childrenTable)
    .where(and(eq(childrenTable.id, childId), eq(childrenTable.parentId, req.userId!)));
  if (!child) { res.status(404).json({ error: "Child not found" }); return; }

  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  // Most recent qualifying paid match within 90 days (non-refunded)
  const [recentPaid] = await db
    .select()
    .from(shadowTeacherMatchesTable)
    .where(and(
      eq(shadowTeacherMatchesTable.parentId, req.userId!),
      eq(shadowTeacherMatchesTable.childId, childId),
      isNotNull(shadowTeacherMatchesTable.feePaidAt),
      gte(shadowTeacherMatchesTable.feePaidAt, since),
      gt(shadowTeacherMatchesTable.matchingFeeInr, 0),
      notInArray(shadowTeacherMatchesTable.status, ["refunded", "pending_payment", "payment_failed"]),
    ))
    .orderBy(desc(shadowTeacherMatchesTable.feePaidAt))
    .limit(1);

  // Most recent match (any status) — for pre-filling extra notes
  const [latestMatch] = await db
    .select()
    .from(shadowTeacherMatchesTable)
    .where(and(
      eq(shadowTeacherMatchesTable.parentId, req.userId!),
      eq(shadowTeacherMatchesTable.childId, childId),
    ))
    .orderBy(desc(shadowTeacherMatchesTable.createdAt))
    .limit(1);

  res.json({
    waived: !!recentPaid,
    childName: child.name,
    previousMatch: latestMatch ? {
      extraNotes: latestMatch.extraNotes ?? null,
      childGoalsAreas: latestMatch.childGoalsAreas ?? null,
      childPreferredModes: latestMatch.childPreferredModes ?? null,
    } : null,
  });
});

// ── POST /shadow-teacher/request — parent submits (deposit-at-request model) ─
const NewRequestBody = z.object({
  childId: z.number().int().positive(),
  extraNotes: z.string().max(2000).optional(),
});

router.post("/shadow-teacher/request", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const parsed = NewRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "childId (number) is required" });
    return;
  }

  const { childId, extraNotes } = parsed.data;

  // Load child (must belong to this parent)
  const [child] = await db
    .select()
    .from(childrenTable)
    .where(and(eq(childrenTable.id, childId), eq(childrenTable.parentId, req.userId!)));
  if (!child) {
    res.status(404).json({ error: "Child not found or does not belong to you" });
    return;
  }

  // Prevent duplicate active requests — scoped to THIS child only
  const existing = await db
    .select()
    .from(shadowTeacherMatchesTable)
    .where(
      and(
        eq(shadowTeacherMatchesTable.parentId, req.userId!),
        eq(shadowTeacherMatchesTable.childId, childId),
      )
    )
    .orderBy(desc(shadowTeacherMatchesTable.createdAt))
    .limit(1);

  if (existing[0] && !["cancelled", "refunded", "committed"].includes(existing[0].status)) {
    // Existing pending_payment match: return the existing order so the widget can reopen the modal
    if (
      existing[0].status === "pending_payment" &&
      existing[0].providerOrderId &&
      existing[0].matchingFeeInr > 0
    ) {
      res.status(409).json({
        error: "You already have an active shadow teacher request",
        matchId: existing[0].id,
        providerOrderId: existing[0].providerOrderId,
        amount: existing[0].matchingFeeInr * 100,
        keyId: process.env["RAZORPAY_KEY_ID"]!,
      });
      return;
    }
    res.status(409).json({ error: "You already have an active shadow teacher request", matchId: existing[0].id });
    return;
  }

  // ── Server-side waiver check — never trust frontend ──────────────────────
  // Waiver applies if the parent has a non-refunded paid match for THIS child
  // with fee_paid_at within the last 90 days.
  const waiverSince = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const [waiverRow] = await db
    .select({ id: shadowTeacherMatchesTable.id })
    .from(shadowTeacherMatchesTable)
    .where(and(
      eq(shadowTeacherMatchesTable.parentId, req.userId!),
      eq(shadowTeacherMatchesTable.childId, childId),
      isNotNull(shadowTeacherMatchesTable.feePaidAt),
      gte(shadowTeacherMatchesTable.feePaidAt, waiverSince),
      gt(shadowTeacherMatchesTable.matchingFeeInr, 0),
      notInArray(shadowTeacherMatchesTable.status, ["refunded", "pending_payment", "payment_failed"]),
    ))
    .limit(1);
  const isWaived = !!waiverRow;

  if (isWaived) {
    // Waived path: insert directly as shortlisted (no Razorpay), surface candidates immediately.
    // matchingFeeInr=0 ensures the refund guard correctly returns "no_payment_to_refund".
    const [waivedMatch] = await db
      .insert(shadowTeacherMatchesTable)
      .values({
        parentId:            req.userId!,
        status:              "shortlisted",
        matchingFeeInr:      0,
        providerOrderId:     null,
        providerPaymentId:   "waived_rematch",
        feePaidAt:           new Date(),
        childId:             child.id,
        childCity:           child.city ?? null,
        childConditions:     child.conditions ?? null,
        childLanguages:      child.languages ?? null,
        childBudgetMinInr:   child.budgetMinInr ?? null,
        childBudgetMaxInr:   child.budgetMaxInr ?? null,
        childGoalsAreas:     child.goalsAreas ?? null,
        childPreferredModes: child.preferredModes ?? null,
        extraNotes:          extraNotes ?? null,
      })
      .returning();
    await surfaceCandidatesForMatch(waivedMatch);
    res.status(201).json({ matchId: waivedMatch.id, waived: true });
    return;
  }

  const settings = await getSettings();
  const razorpay = getRazorpay();
  if (!razorpay) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  // Create Razorpay order for the matching fee
  const amount = settings.matchingFeeInr * 100;
  const order = await razorpay.orders.create({
    amount,
    currency: "INR",
    receipt: `streq_${Date.now()}`,
    notes: { childId: String(childId) },
  });

  // Insert match in pending_payment state (candidates surfaced only after payment verified)
  const [match] = await db
    .insert(shadowTeacherMatchesTable)
    .values({
      parentId: req.userId!,
      status: "pending_payment",
      matchingFeeInr: settings.matchingFeeInr,
      childId: child.id,
      childCity: child.city ?? null,
      childConditions: child.conditions ?? null,
      childLanguages: child.languages ?? null,
      childBudgetMinInr: child.budgetMinInr ?? null,
      childBudgetMaxInr: child.budgetMaxInr ?? null,
      childGoalsAreas: child.goalsAreas ?? null,
      childPreferredModes: child.preferredModes ?? null,
      extraNotes: extraNotes ?? null,
      providerOrderId: order.id as string,
    })
    .returning();

  res.status(201).json({
    matchId: match.id,
    orderId: order.id,
    amount,
    keyId: process.env["RAZORPAY_KEY_ID"]!,
  });
});

// ── POST /shadow-teacher/:matchId/verify-request-payment — HMAC verify, surface candidates ─
const VerifyRequestPaymentBody = z.object({
  razorpayOrderId: z.string(),
  razorpayPaymentId: z.string(),
  razorpaySignature: z.string(),
});

router.post("/shadow-teacher/:matchId/verify-request-payment", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }

  const parsed = VerifyRequestPaymentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keySecret) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = parsed.data;

  const [match] = await db
    .select()
    .from(shadowTeacherMatchesTable)
    .where(and(eq(shadowTeacherMatchesTable.id, matchId), eq(shadowTeacherMatchesTable.parentId, req.userId!)));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }
  if (match.status !== "pending_payment") { res.status(400).json({ error: "Match is not awaiting payment" }); return; }
  if (match.providerOrderId !== razorpayOrderId) { res.status(400).json({ error: "Order ID mismatch" }); return; }

  const expectedSig = crypto.createHmac("sha256", keySecret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest("hex");
  if (expectedSig !== razorpaySignature) { res.status(400).json({ error: "Payment signature verification failed" }); return; }

  // Payment confirmed — record fee paid timestamp and transition to shortlisted
  await db
    .update(shadowTeacherMatchesTable)
    .set({ status: "shortlisted", providerPaymentId: razorpayPaymentId, feePaidAt: new Date(), updatedAt: new Date() })
    .where(eq(shadowTeacherMatchesTable.id, matchId));

  const candidateCount = await surfaceCandidatesForMatch(match);
  res.json({ matchId: match.id, candidateCount });
});

// ── POST /shadow-teacher/verify-payment — legacy: confirm matching fee payment ─
const VerifyMatchPaymentBody = z.object({
  matchId: z.number().int().positive(),
  razorpayPaymentId: z.string(),
  razorpayOrderId: z.string(),
  razorpaySignature: z.string(),
});

router.post("/shadow-teacher/verify-payment", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const parsed = VerifyMatchPaymentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keySecret) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  const { matchId, razorpayPaymentId, razorpayOrderId, razorpaySignature } = parsed.data;

  const [match] = await db
    .select()
    .from(shadowTeacherMatchesTable)
    .where(and(eq(shadowTeacherMatchesTable.id, matchId), eq(shadowTeacherMatchesTable.parentId, req.userId!)));
  if (!match) { res.status(404).json({ error: "Match request not found" }); return; }
  if (match.providerOrderId !== razorpayOrderId) { res.status(400).json({ error: "Order ID mismatch" }); return; }

  const expectedSig = crypto.createHmac("sha256", keySecret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest("hex");
  if (expectedSig !== razorpaySignature) { res.status(400).json({ error: "Payment signature verification failed" }); return; }

  const [updated] = await db
    .update(shadowTeacherMatchesTable)
    .set({ status: "queued", providerPaymentId: razorpayPaymentId, updatedAt: new Date() })
    .where(eq(shadowTeacherMatchesTable.id, matchId))
    .returning();
  res.json(updated);
});

// ── GET /shadow-teacher/my-request — parent views their latest match + candidates ─
// Optional ?childId=N scopes the lookup to a specific child. Without it the
// most-recent match across all children is returned (backwards-compat).
router.get("/shadow-teacher/my-request", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const childIdParam = req.query["childId"];
  const childId = childIdParam ? parseInt(String(childIdParam), 10) : null;

  const whereClause =
    childId && !isNaN(childId)
      ? and(
          eq(shadowTeacherMatchesTable.parentId, req.userId!),
          eq(shadowTeacherMatchesTable.childId, childId),
        )
      : eq(shadowTeacherMatchesTable.parentId, req.userId!);

  const matches = await db
    .select()
    .from(shadowTeacherMatchesTable)
    .where(whereClause)
    .orderBy(desc(shadowTeacherMatchesTable.createdAt))
    .limit(1);

  if (!matches.length) { res.json([]); return; }
  let match = matches[0]!;

  // Stuck-engagement lazy-timeout resolution — resolve before building the
  // response, so the parent's read reflects post-resolution state
  // immediately (not stale "still pending"). See stuckEngagementResolver.ts.
  await resolveStuckShadowTeacherMatch(match.id);
  const [freshMatch] = await db.select().from(shadowTeacherMatchesTable).where(eq(shadowTeacherMatchesTable.id, match.id));
  if (freshMatch) match = freshMatch;

  const committed = match.status === "committed";

  // Load active (not removed) candidates
  const candidateRows = await db
    .select()
    .from(shadowMatchCandidatesTable)
    .where(
      and(
        eq(shadowMatchCandidatesTable.matchId, match.id),
        isNull(shadowMatchCandidatesTable.removedAt),
      ),
    )
    .orderBy(shadowMatchCandidatesTable.rank);

  const proIds = candidateRows.map((c) => c.professionalId);
  const profProfiles = proIds.length
    ? await db.select().from(professionalProfilesTable).where(
        sql`${professionalProfilesTable.id} = ANY(${sql.raw(`ARRAY[${proIds.join(",")}]::int[]`)})`,
      )
    : [];

  // Load thread IDs for each candidate
  const threads = match.id
    ? await db.select().from(shadowMatchThreadsTable).where(eq(shadowMatchThreadsTable.matchId, match.id))
    : [];

  // Effective availability per candidate (Rule 2 support) — for card display,
  // recomputed live rather than stored, since it can change whenever a
  // teacher's earliestStartDate or their engagement's notice-period status
  // changes.
  const availabilityMap = await computeEffectiveAvailableFrom(
    profProfiles.map((p) => ({ id: p.id, earliestStartDate: p.earliestStartDate })),
  );

  // Profile photo — a trust signal shown on the card like bio, not masked
  // pre-commitment the way fullName/phone/email are (a photo doesn't let
  // anyone bypass the platform's messaging/commission model the way direct
  // contact info would).
  const userIds = profProfiles.map((p) => p.userId);
  const avatarRows = userIds.length
    ? await db.select({ id: usersTable.id, avatarUrl: usersTable.avatarUrl }).from(usersTable).where(
        sql`${usersTable.id} = ANY(${sql.raw(`ARRAY[${userIds.join(",")}]::int[]`)})`,
      )
    : [];
  const avatarByUserId = new Map(avatarRows.map((r) => [r.id, r.avatarUrl]));

  const candidates = candidateRows.map((c) => {
    const pro = profProfiles.find((p) => p.id === c.professionalId);
    const thread = threads.find((t) => t.professionalId === c.professionalId);
    if (!pro) return null;

    const maskedPro = maskProfile(
      {
        fullName: pro.fullName,
        phone: pro.phone,
        email: pro.email,
        bio: pro.bio,
        specialty: pro.specialty,
        city: pro.city,
        displayArea: pro.displayArea,
        yearsExperience: pro.yearsExperience,
        offersHomeVisits: pro.offersHomeVisits,
        verificationStatus: pro.verificationStatus,
        averageRating: pro.averageRating,
        pricingMinINR: pro.pricingMinINR,
        pricingMaxINR: pro.pricingMaxINR,
        languages: pro.languages,
        avatarUrl: avatarByUserId.get(pro.userId) ?? null,
      },
      committed && match.selectedProfessionalId === pro.id,
    );

    return {
      id: c.id,
      professionalId: c.professionalId,
      score: c.score,
      rank: c.rank,
      addedBy: c.addedBy,
      profile: maskedPro,
      threadId: thread?.id ?? null,
      // Task 2c — expose expected salary range at top level for the parent UI
      expectedSalaryMin: pro.pricingMinINR,
      expectedSalaryMax: pro.pricingMaxINR,
      // Task 2a — redesigned-flow state fields so the UI can gate buttons
      // without a follow-up fetch
      requestStatus: c.requestStatus,
      rejectionNote: c.rejectionNote,
      interviewSlotsJson: c.interviewSlotsJson,
      interviewConfirmedSlot: c.interviewConfirmedSlot,
      meetLink: c.meetLink,
      interviewDoneAt: c.interviewDoneAt,
      trialDaysRequested: c.trialDaysRequested,
      trialDaysAccepted: c.trialDaysAccepted,
      // For the upcoming candidate-card display — never used to exclude.
      effectiveAvailableFrom: availabilityMap.get(pro.id) ?? pro.earliestStartDate,
    };
  }).filter(Boolean);

  res.json({ ...match, candidates });
});

// ── GET /shadow-teacher/my-candidacies — teacher sees matches they've been shortlisted for ─
router.get("/shadow-teacher/my-candidacies", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const [pro] = await db
    .select({ id: professionalProfilesTable.id })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, req.userId!));

  if (!pro) { res.status(404).json({ error: "Professional profile not found" }); return; }

  let candidates = await db
    .select({
      candidateId: shadowMatchCandidatesTable.id,
      matchId:     shadowMatchCandidatesTable.matchId,
      createdAt:   shadowMatchCandidatesTable.createdAt,
      matchStatus:            shadowTeacherMatchesTable.status,
      selectedProfessionalId: shadowTeacherMatchesTable.selectedProfessionalId,
      childCity:              shadowTeacherMatchesTable.childCity,
      childConditions:        shadowTeacherMatchesTable.childConditions,
      childPreferredModes:    shadowTeacherMatchesTable.childPreferredModes,
      childGoalsAreas:        shadowTeacherMatchesTable.childGoalsAreas,
      preMeetingRequested:    shadowTeacherMatchesTable.preMeetingRequested,
      preMeetingNote:         shadowTeacherMatchesTable.preMeetingNote,
      trialLocation:          shadowTeacherMatchesTable.trialLocation,
      trialMeetLink:          shadowTeacherMatchesTable.trialMeetLink,
      trialDirectPay:              shadowTeacherMatchesTable.trialDirectPay,
      trialDirectPayMarkedPaidAt:  shadowTeacherMatchesTable.trialDirectPayMarkedPaidAt,
      trialDirectPayConfirmedAt:   shadowTeacherMatchesTable.trialDirectPayConfirmedAt,
      // Redesigned journey (Task 3B) — request → interview → trial state on
      // the teacher's own candidate row.
      requestStatus:          shadowMatchCandidatesTable.requestStatus,
      rejectionNote:          shadowMatchCandidatesTable.rejectionNote,
      interviewSlotsJson:     shadowMatchCandidatesTable.interviewSlotsJson,
      interviewConfirmedSlot: shadowMatchCandidatesTable.interviewConfirmedSlot,
      meetLink:               shadowMatchCandidatesTable.meetLink,
      interviewDoneAt:        shadowMatchCandidatesTable.interviewDoneAt,
      trialDaysRequested:     shadowMatchCandidatesTable.trialDaysRequested,
      trialDaysAccepted:      shadowMatchCandidatesTable.trialDaysAccepted,
    })
    .from(shadowMatchCandidatesTable)
    .innerJoin(shadowTeacherMatchesTable, eq(shadowMatchCandidatesTable.matchId, shadowTeacherMatchesTable.id))
    .where(
      and(
        eq(shadowMatchCandidatesTable.professionalId, pro.id),
        isNull(shadowMatchCandidatesTable.removedAt),
      ),
    )
    .orderBy(desc(shadowMatchCandidatesTable.createdAt));

  if (candidates.length > 0) {
    // Stuck-engagement lazy-timeout resolution — resolve every distinct
    // match this professional has a live candidacy in, then re-fetch so the
    // response reflects post-resolution state. See stuckEngagementResolver.ts.
    const distinctMatchIds = [...new Set(candidates.map((c) => c.matchId))] as number[];
    await Promise.all(distinctMatchIds.map((id) => resolveStuckShadowTeacherMatch(id)));

    candidates = await db
      .select({
        candidateId: shadowMatchCandidatesTable.id,
        matchId:     shadowMatchCandidatesTable.matchId,
        createdAt:   shadowMatchCandidatesTable.createdAt,
        matchStatus:            shadowTeacherMatchesTable.status,
        selectedProfessionalId: shadowTeacherMatchesTable.selectedProfessionalId,
        childCity:              shadowTeacherMatchesTable.childCity,
        childConditions:        shadowTeacherMatchesTable.childConditions,
        childPreferredModes:    shadowTeacherMatchesTable.childPreferredModes,
        childGoalsAreas:        shadowTeacherMatchesTable.childGoalsAreas,
        preMeetingRequested:    shadowTeacherMatchesTable.preMeetingRequested,
        preMeetingNote:         shadowTeacherMatchesTable.preMeetingNote,
        trialLocation:          shadowTeacherMatchesTable.trialLocation,
        trialMeetLink:          shadowTeacherMatchesTable.trialMeetLink,
        trialDirectPay:              shadowTeacherMatchesTable.trialDirectPay,
        trialDirectPayMarkedPaidAt:  shadowTeacherMatchesTable.trialDirectPayMarkedPaidAt,
        trialDirectPayConfirmedAt:   shadowTeacherMatchesTable.trialDirectPayConfirmedAt,
        requestStatus:          shadowMatchCandidatesTable.requestStatus,
        rejectionNote:          shadowMatchCandidatesTable.rejectionNote,
        interviewSlotsJson:     shadowMatchCandidatesTable.interviewSlotsJson,
        interviewConfirmedSlot: shadowMatchCandidatesTable.interviewConfirmedSlot,
        meetLink:               shadowMatchCandidatesTable.meetLink,
        interviewDoneAt:        shadowMatchCandidatesTable.interviewDoneAt,
        trialDaysRequested:     shadowMatchCandidatesTable.trialDaysRequested,
        trialDaysAccepted:      shadowMatchCandidatesTable.trialDaysAccepted,
      })
      .from(shadowMatchCandidatesTable)
      .innerJoin(shadowTeacherMatchesTable, eq(shadowMatchCandidatesTable.matchId, shadowTeacherMatchesTable.id))
      .where(
        and(
          eq(shadowMatchCandidatesTable.professionalId, pro.id),
          isNull(shadowMatchCandidatesTable.removedAt),
        ),
      )
      .orderBy(desc(shadowMatchCandidatesTable.createdAt));
  }

  if (candidates.length === 0) { res.json([]); return; }

  const matchIds = candidates.map(c => c.matchId);
  const threads = await db
    .select({ matchId: shadowMatchThreadsTable.matchId, threadId: shadowMatchThreadsTable.id })
    .from(shadowMatchThreadsTable)
    .where(
      and(
        eq(shadowMatchThreadsTable.professionalId, pro.id),
        inArray(shadowMatchThreadsTable.matchId, matchIds),
      ),
    );

  const threadIds = threads.map(t => t.threadId);
  const msgCounts = threadIds.length > 0
    ? await db
        .select({
          threadId:      shadowMatchMessagesTable.threadId,
          messageCount:  count(shadowMatchMessagesTable.id),
          lastMessageAt: max(shadowMatchMessagesTable.createdAt),
        })
        .from(shadowMatchMessagesTable)
        .where(inArray(shadowMatchMessagesTable.threadId, threadIds))
        .groupBy(shadowMatchMessagesTable.threadId)
    : [];

  const threadByMatchId  = new Map(threads.map(t => [t.matchId, t]));
  const countByThreadId  = new Map(msgCounts.map(m => [m.threadId, m]));

  const result = candidates.map(c => {
    const thread = threadByMatchId.get(c.matchId);
    const counts = thread ? countByThreadId.get(thread.threadId) : undefined;
    return {
      candidateId:      c.candidateId,
      matchId:          c.matchId,
      matchStatus:      c.matchStatus,
      isSelected:       c.selectedProfessionalId === pro.id,
      childCity:        c.childCity,
      childConditions:  c.childConditions ?? [],
      // childBudgetMinInr/MaxInr deliberately excluded — the parent's stated
      // budget is an internal matching signal only (see scoreBudget() in
      // shadowTeacherScoring.ts) and must never reach the teacher's client.
      childPreferredModes: c.childPreferredModes ?? [],
      childGoalsAreas:        c.childGoalsAreas       ?? null,
      preMeetingRequested:    c.preMeetingRequested   ?? false,
      preMeetingNote:         c.preMeetingNote        ?? null,
      trialLocation:          c.trialLocation         ?? null,
      trialMeetLink:          c.trialMeetLink         ?? null,
      trialDirectPay:             c.trialDirectPay             ?? false,
      trialDirectPayMarkedPaidAt: c.trialDirectPayMarkedPaidAt ?? null,
      trialDirectPayConfirmedAt:  c.trialDirectPayConfirmedAt  ?? null,
      requestStatus:          c.requestStatus,
      rejectionNote:          c.rejectionNote          ?? null,
      interviewSlotsJson:     c.interviewSlotsJson     ?? null,
      interviewConfirmedSlot: c.interviewConfirmedSlot ?? null,
      meetLink:               c.meetLink               ?? null,
      interviewDoneAt:        c.interviewDoneAt        ?? null,
      trialDaysRequested:     c.trialDaysRequested     ?? null,
      trialDaysAccepted:      c.trialDaysAccepted      ?? null,
      threadId:        thread?.threadId ?? null,
      messageCount:    counts ? Number(counts.messageCount) : 0,
      lastMessageAt:   counts?.lastMessageAt ?? null,
      createdAt:       c.createdAt,
    };
  });

  res.json(result);
});

// ── GET /shadow-teacher/:matchId/thread/:candidateId — get/create thread, return messages ─
router.get("/shadow-teacher/:matchId/thread/:candidateId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  const candidateId = parseInt(req.params["candidateId"] as string, 10);
  if (isNaN(matchId) || isNaN(candidateId)) { res.status(400).json({ error: "Invalid params" }); return; }

  const [match] = await db.select().from(shadowTeacherMatchesTable).where(eq(shadowTeacherMatchesTable.id, matchId));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }

  const [candidate] = await db
    .select()
    .from(shadowMatchCandidatesTable)
    .where(
      and(
        eq(shadowMatchCandidatesTable.id, candidateId),
        eq(shadowMatchCandidatesTable.matchId, matchId),
        isNull(shadowMatchCandidatesTable.removedAt),
      ),
    );
  if (!candidate) { res.status(404).json({ error: "Candidate not found" }); return; }

  // Access check: must be the parent or the professional linked to candidate
  const [pro] = await db
    .select({ userId: professionalProfilesTable.userId })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, candidate.professionalId));
  const isParent = match.parentId === req.userId!;
  const isPro = pro?.userId === req.userId!;
  if (!isParent && !isPro) { res.status(403).json({ error: "Access denied" }); return; }

  // Get or create thread
  let [thread] = await db
    .select()
    .from(shadowMatchThreadsTable)
    .where(
      and(
        eq(shadowMatchThreadsTable.matchId, matchId),
        eq(shadowMatchThreadsTable.professionalId, candidate.professionalId),
      ),
    );
  if (!thread) {
    const [created] = await db.insert(shadowMatchThreadsTable).values({
      matchId,
      professionalId: candidate.professionalId,
    }).returning();
    thread = created!;
  }

  const committed = match.status === "committed" && match.selectedProfessionalId === candidate.professionalId;

  const messages = await db
    .select()
    .from(shadowMatchMessagesTable)
    .where(eq(shadowMatchMessagesTable.threadId, thread.id))
    .orderBy(shadowMatchMessagesTable.createdAt);

  const maskedMessages = committed
    ? messages
    : messages.map((m) => m.msgType === "location" ? m : { ...m, body: maskBody(m.body) });

  res.json({ threadId: thread.id, committed, messages: maskedMessages });
});

// ── POST /shadow-teacher/:matchId/thread/:candidateId — send message ─
const PHONE_LEAK_RE = /(\+?91[\s-]?)?[6-9]\d{9}/;
function looksLikePhone(s: string): boolean {
  return PHONE_LEAK_RE.test(s.replace(/[\s().\-]/g, ""));
}
const SendMessageBody = z.object({
  body: z.string().min(1).max(5000),
  type: z.enum(["text", "location"]).optional(),
  mapsUrl: z.string().max(1000).optional(),
});

router.post("/shadow-teacher/:matchId/thread/:candidateId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  const candidateId = parseInt(req.params["candidateId"] as string, 10);
  if (isNaN(matchId) || isNaN(candidateId)) { res.status(400).json({ error: "Invalid params" }); return; }

  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [match] = await db.select().from(shadowTeacherMatchesTable).where(eq(shadowTeacherMatchesTable.id, matchId));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }

  if (!["shortlisted", "pending_commitment", "committed", "trial_pending", "trial_started", "trial_done"].includes(match.status)) {
    res.status(400).json({ error: "Chat is not available for this match status" });
    return;
  }

  const [candidate] = await db
    .select()
    .from(shadowMatchCandidatesTable)
    .where(
      and(
        eq(shadowMatchCandidatesTable.id, candidateId),
        eq(shadowMatchCandidatesTable.matchId, matchId),
        isNull(shadowMatchCandidatesTable.removedAt),
      ),
    );
  if (!candidate) { res.status(404).json({ error: "Candidate not found" }); return; }

  const [pro] = await db
    .select({ userId: professionalProfilesTable.userId, fullName: professionalProfilesTable.fullName })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, candidate.professionalId));

  const isParent = match.parentId === req.userId!;
  const isPro = pro?.userId === req.userId!;
  if (!isParent && !isPro) { res.status(403).json({ error: "Access denied" }); return; }

  // Get or create thread
  let [thread] = await db
    .select()
    .from(shadowMatchThreadsTable)
    .where(
      and(
        eq(shadowMatchThreadsTable.matchId, matchId),
        eq(shadowMatchThreadsTable.professionalId, candidate.professionalId),
      ),
    );
  if (!thread) {
    const [created] = await db.insert(shadowMatchThreadsTable).values({
      matchId,
      professionalId: candidate.professionalId,
    }).returning();
    thread = created!;
  }

  const rawBody = parsed.data.body;
  const msgType = parsed.data.type ?? "text";
  const mapsUrl = parsed.data.mapsUrl;

  // Guard: location messages must not contain phone numbers
  if (msgType === "location") {
    const combined = (rawBody + " " + (mapsUrl ?? "")).replace(/[\s().\-]/g, "");
    if (looksLikePhone(combined)) {
      res.status(400).json({ error: "Location appears to contain a phone number. Contact details are shared only after you commit to this teacher." });
      return;
    }
  }

  const storedBody = msgType === "location"
    ? JSON.stringify({ text: rawBody, mapsUrl: mapsUrl ?? null })
    : rawBody;

  const [message] = await db
    .insert(shadowMatchMessagesTable)
    .values({ threadId: thread.id, senderId: req.userId!, body: storedBody, msgType })
    .returning();

  // Push notify recipient (fire-and-forget)
  const committed = match.status === "committed";
  if (isParent && pro?.userId) {
    void notifyMatchChatMessage(pro.userId, "A parent").catch(() => {});
  } else if (isPro) {
    const [parentUser] = await db
      .select({ fullName: usersTable.fullName })
      .from(usersTable)
      .where(eq(usersTable.id, match.parentId));
    void notifyMatchChatMessage(
      match.parentId,
      committed && pro?.fullName ? (pro.fullName.split(" ")[0] ?? "Your teacher") : "A shadow teacher",
    ).catch(() => {});
  }

  const body = (committed || message!.msgType === "location") ? message!.body : maskBody(message!.body);
  res.status(201).json({ ...message, body });
});

// ── Negotiation Offer Helpers ──────────────────────────────────────────────────

async function resolveNegotiationAccess(
  matchId: number,
  candidateId: number,
  userId: number,
  userRole: string,
): Promise<{ match: typeof shadowTeacherMatchesTable.$inferSelect; candidate: typeof shadowMatchCandidatesTable.$inferSelect; myRole: "parent" | "professional" } | null> {
  const [match] = await db.select().from(shadowTeacherMatchesTable)
    .where(eq(shadowTeacherMatchesTable.id, matchId)).limit(1);
  if (!match) return null;
  const [candidate] = await db.select().from(shadowMatchCandidatesTable)
    .where(and(eq(shadowMatchCandidatesTable.id, candidateId), eq(shadowMatchCandidatesTable.matchId, matchId), isNull(shadowMatchCandidatesTable.removedAt)))
    .limit(1);
  if (!candidate) return null;
  if (match.parentId === userId) return { match, candidate, myRole: "parent" };
  if (userRole === "professional") {
    const [pro] = await db.select({ id: professionalProfilesTable.id }).from(professionalProfilesTable)
      .where(eq(professionalProfilesTable.userId, userId)).limit(1);
    if (pro?.id === candidate.professionalId) return { match, candidate, myRole: "professional" };
  }
  if (userRole === "admin") return { match, candidate, myRole: "parent" };
  return null;
}

// ── GET /shadow-teacher/:matchId/candidates/:candidateId/offers ───────────────
router.get("/shadow-teacher/:matchId/candidates/:candidateId/offers", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  const candidateId = parseInt(req.params["candidateId"] as string, 10);
  if (isNaN(matchId) || isNaN(candidateId)) { res.status(400).json({ error: "Invalid params" }); return; }
  const ctx = await resolveNegotiationAccess(matchId, candidateId, req.userId!, req.userRole!);
  if (!ctx) { res.status(403).json({ error: "Access denied or not found" }); return; }
  const offers = await db.select().from(negotiationOffersTable)
    .where(and(eq(negotiationOffersTable.matchId, matchId), eq(negotiationOffersTable.candidateId, candidateId)))
    .orderBy(negotiationOffersTable.createdAt);
  res.json(offers);
});

// ── POST /shadow-teacher/:matchId/candidates/:candidateId/offers ──────────────
const OfferBody = z.object({
  amountInr: z.number().int().positive(),
  absenceRetainerPct: z.number().int().min(0).max(100).default(50),
  absenceFreeDaysPerMonth: z.number().int().min(0).max(30).default(4),
  summerRetainerPct: z.number().int().min(0).max(100).default(0),
  summerRetainerMonths: z.number().int().min(0).max(12).default(0),
  leaveTermsNotes: z.string().max(1000).nullable().default(null),
});

router.post("/shadow-teacher/:matchId/candidates/:candidateId/offers", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  const candidateId = parseInt(req.params["candidateId"] as string, 10);
  if (isNaN(matchId) || isNaN(candidateId)) { res.status(400).json({ error: "Invalid params" }); return; }
  const parsed = OfferBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const ctx = await resolveNegotiationAccess(matchId, candidateId, req.userId!, req.userRole!);
  if (!ctx) { res.status(403).json({ error: "Access denied or not found" }); return; }
  if (!["shortlisted", "trial_done"].includes(ctx.match.status)) {
    res.status(409).json({ error: "Offers can only be made while match is shortlisted or trial_done" }); return;
  }
  const [existingAccepted] = await db.select({ id: negotiationOffersTable.id })
    .from(negotiationOffersTable)
    .where(and(eq(negotiationOffersTable.matchId, matchId), eq(negotiationOffersTable.candidateId, candidateId), eq(negotiationOffersTable.status, "accepted")))
    .limit(1);
  if (existingAccepted) { res.status(409).json({ error: "A price has already been agreed for this candidate" }); return; }
  // Supersede-then-insert must be atomic AND mutually exclusive per
  // (matchId, candidateId): a bare transaction alone doesn't stop two
  // concurrent counters from each superseding the same prior offer and
  // then both inserting as pending (the second request's UPDATE never
  // sees the first request's not-yet-committed INSERT, since it only
  // re-checks rows it already matched). The advisory lock below
  // serializes concurrent submissions for this one negotiation so the
  // "at most one pending offer" invariant actually holds — required for
  // restore-on-withdraw below to have exactly one unambiguous predecessor.
  const [offer] = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${matchId}, ${candidateId})`);
    // Supersede ALL pending offers (from both parties) — a new offer/counter
    // implicitly rejects the other side's pending offer, so only one live
    // pending offer exists at a time.
    await tx.update(negotiationOffersTable)
      .set({ status: "superseded", updatedAt: new Date() })
      .where(and(
        eq(negotiationOffersTable.matchId, matchId),
        eq(negotiationOffersTable.candidateId, candidateId),
        eq(negotiationOffersTable.status, "pending"),
      ));
    return tx.insert(negotiationOffersTable).values({
      matchId, candidateId, raisedByUserId: req.userId!, raisedByRole: ctx.myRole,
      amountInr: parsed.data.amountInr,
      absenceRetainerPct: parsed.data.absenceRetainerPct,
      absenceFreeDaysPerMonth: parsed.data.absenceFreeDaysPerMonth,
      summerRetainerPct: parsed.data.summerRetainerPct,
      summerRetainerMonths: parsed.data.summerRetainerMonths,
      leaveTermsNotes: parsed.data.leaveTermsNotes,
      status: "pending",
    }).returning();
  });

  // Notify the other party about the new offer
  try {
    if (ctx.myRole === "parent") {
      // Notify teacher
      const [pro] = await db.select({ userId: professionalProfilesTable.userId })
        .from(professionalProfilesTable).where(eq(professionalProfilesTable.id, ctx.candidate.professionalId)).limit(1);
      if (pro) await createInAppNotification(pro.userId, {
        type: "offer_raised",
        title: "New salary offer from parent",
        body: `A parent proposed ₹${parsed.data.amountInr.toLocaleString("en-IN")}/month. Log in to respond.`,
        relatedType: "match", relatedId: matchId,
      });
    } else {
      // Notify parent
      await createInAppNotification(ctx.match.parentId, {
        type: "offer_raised",
        title: "Counter-offer from teacher",
        body: `Your teacher proposed ₹${parsed.data.amountInr.toLocaleString("en-IN")}/month. Log in to respond.`,
        relatedType: "match", relatedId: matchId,
      });
    }
  } catch { /* non-blocking */ }

  res.status(201).json(offer);
});

// ── PATCH /shadow-teacher/:matchId/candidates/:candidateId/offers/:offerId/accept ──
router.patch("/shadow-teacher/:matchId/candidates/:candidateId/offers/:offerId/accept", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  const candidateId = parseInt(req.params["candidateId"] as string, 10);
  const offerId = parseInt(req.params["offerId"] as string, 10);
  if (isNaN(matchId) || isNaN(candidateId) || isNaN(offerId)) { res.status(400).json({ error: "Invalid params" }); return; }
  const ctx = await resolveNegotiationAccess(matchId, candidateId, req.userId!, req.userRole!);
  if (!ctx) { res.status(403).json({ error: "Access denied or not found" }); return; }
  const [offer] = await db.select().from(negotiationOffersTable)
    .where(and(eq(negotiationOffersTable.id, offerId), eq(negotiationOffersTable.matchId, matchId), eq(negotiationOffersTable.candidateId, candidateId), eq(negotiationOffersTable.status, "pending")))
    .limit(1);
  if (!offer) { res.status(404).json({ error: "Pending offer not found" }); return; }
  if (offer.raisedByRole === ctx.myRole) { res.status(403).json({ error: "You cannot accept your own offer" }); return; }
  await db.update(negotiationOffersTable)
    .set({ status: "superseded", updatedAt: new Date() })
    .where(and(eq(negotiationOffersTable.matchId, matchId), eq(negotiationOffersTable.candidateId, candidateId), eq(negotiationOffersTable.status, "pending")));
  const [accepted] = await db.update(negotiationOffersTable)
    .set({ status: "accepted", updatedAt: new Date() })
    .where(eq(negotiationOffersTable.id, offerId))
    .returning();

  // Notify the person who raised the offer that it was accepted
  try {
    if (offer.raisedByUserId) {
      await createInAppNotification(offer.raisedByUserId, {
        type: "offer_accepted",
        title: "Offer accepted!",
        body: `Your proposed rate of ₹${offer.amountInr.toLocaleString("en-IN")}/month has been agreed. Proceed to commit.`,
        relatedType: "match", relatedId: matchId,
      });
    }
  } catch { /* non-blocking */ }

  res.json(accepted);
});

// ── DELETE /shadow-teacher/:matchId/candidates/:candidateId/offers/:offerId ───
router.delete("/shadow-teacher/:matchId/candidates/:candidateId/offers/:offerId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  const candidateId = parseInt(req.params["candidateId"] as string, 10);
  const offerId = parseInt(req.params["offerId"] as string, 10);
  if (isNaN(matchId) || isNaN(candidateId) || isNaN(offerId)) { res.status(400).json({ error: "Invalid params" }); return; }
  const ctx = await resolveNegotiationAccess(matchId, candidateId, req.userId!, req.userRole!);
  if (!ctx) { res.status(403).json({ error: "Access denied or not found" }); return; }
  const [offer] = await db.select().from(negotiationOffersTable)
    .where(and(eq(negotiationOffersTable.id, offerId), eq(negotiationOffersTable.matchId, matchId), eq(negotiationOffersTable.candidateId, candidateId)))
    .limit(1);
  if (!offer) { res.status(404).json({ error: "Offer not found" }); return; }
  if (offer.raisedByUserId !== req.userId) { res.status(403).json({ error: "You can only withdraw your own offer" }); return; }
  if (offer.status !== "pending") { res.status(409).json({ error: "Only pending offers can be withdrawn" }); return; }

  // Same advisory lock as POST /offers — withdrawing (and possibly restoring
  // the prior offer to pending) mutates the same "at most one pending offer"
  // invariant, so it must serialize against concurrent submissions the same way.
  const { withdrawn, restored } = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${matchId}, ${candidateId})`);
    const [withdrawnRow] = await tx.update(negotiationOffersTable)
      .set({ status: "withdrawn", updatedAt: new Date() })
      .where(eq(negotiationOffersTable.id, offerId))
      .returning();

    // Restore the offer this withdrawal's offer actually displaced, rather
    // than leaving the negotiation with no active offer — withdrawing a
    // counter means "never mind, back to what was there before," not
    // erasing the whole conversation. Only a "superseded" row qualifies: a
    // "withdrawn" row was a deliberate retraction by its own owner and must
    // never be resurrected by a later, unrelated withdraw. With the
    // advisory lock above closing the concurrent-insert race (see POST
    // /offers), the "at most one pending offer" invariant holds, so there's
    // always at most one unambiguous superseded predecessor to restore to.
    const [previous] = await tx.select().from(negotiationOffersTable)
      .where(and(
        eq(negotiationOffersTable.matchId, matchId),
        eq(negotiationOffersTable.candidateId, candidateId),
        eq(negotiationOffersTable.status, "superseded"),
        lt(negotiationOffersTable.createdAt, offer.createdAt),
      ))
      .orderBy(desc(negotiationOffersTable.createdAt))
      .limit(1);

    if (!previous) return { withdrawn: withdrawnRow, restored: null as typeof withdrawnRow | null };

    const [restoredRow] = await tx.update(negotiationOffersTable)
      .set({ status: "pending", updatedAt: new Date() })
      .where(eq(negotiationOffersTable.id, previous.id))
      .returning();
    return { withdrawn: withdrawnRow, restored: restoredRow };
  });

  // Notify the other party — either the negotiation is open again with
  // nothing pending, or a prior offer of theirs (or, rarely, the
  // withdrawer's own earlier offer — see restore query above) is active
  // again. Same non-blocking pattern as the offer_raised/offer_accepted
  // notifications above.
  try {
    const withdrawerLabel = ctx.myRole === "parent" ? "Parent" : "Teacher";
    let recipientUserId: number | null = null;
    if (ctx.myRole === "parent") {
      const [pro] = await db.select({ userId: professionalProfilesTable.userId })
        .from(professionalProfilesTable).where(eq(professionalProfilesTable.id, ctx.candidate.professionalId)).limit(1);
      recipientUserId = pro?.userId ?? null;
    } else {
      recipientUserId = ctx.match.parentId;
    }
    if (recipientUserId) {
      if (restored) {
        const ownerPhrase = restored.raisedByUserId === recipientUserId ? "Your" : "Their";
        await createInAppNotification(recipientUserId, {
          type: "offer_withdrawn",
          title: "Offer withdrawn — prior offer restored",
          body: `${withdrawerLabel} withdrew their offer. ${ownerPhrase} offer of ₹${restored.amountInr.toLocaleString("en-IN")}/month is active again.`,
          relatedType: "match", relatedId: matchId,
        });
      } else {
        await createInAppNotification(recipientUserId, {
          type: "offer_withdrawn",
          title: "Offer withdrawn",
          body: `${withdrawerLabel} withdrew their offer. Propose a new one anytime.`,
          relatedType: "match", relatedId: matchId,
        });
      }
    }
  } catch { /* non-blocking */ }

  res.json({ withdrawn, restored });
});

// ═══════════════════════════════════════════════════════════════════════════
// ── Redesigned parent↔teacher journey (Task 2) ────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
// Flow: parent sends request → teacher accepts/rejects → parent proposes
// interview slots → teacher confirms one → auto-Jitsi link generated → parent
// marks interview done → negotiation ping-pong (existing, unchanged) → parent
// requests trial days (1-3) → teacher accepts ≤ that number → match moves to
// 'trial_pending' (existing status).
//
// Each endpoint posts a structured chat message (msgType names below) into the
// existing masked shadow_match_messages thread and notifies the counterparty.
// Chat body is JSON with action-specific data; the GET messages endpoint
// already exempts non-'text' msgTypes from body masking.

async function postCandidateStructuredMessage(params: {
  matchId: number;
  candidateProfessionalId: number;
  senderId: number;
  msgType: string;
  data: Record<string, unknown>;
}): Promise<void> {
  let [thread] = await db
    .select()
    .from(shadowMatchThreadsTable)
    .where(and(
      eq(shadowMatchThreadsTable.matchId, params.matchId),
      eq(shadowMatchThreadsTable.professionalId, params.candidateProfessionalId),
    ));
  if (!thread) {
    const [created] = await db.insert(shadowMatchThreadsTable).values({
      matchId: params.matchId,
      professionalId: params.candidateProfessionalId,
    }).returning();
    thread = created!;
  }
  await db.insert(shadowMatchMessagesTable).values({
    threadId: thread.id,
    senderId: params.senderId,
    body: JSON.stringify(params.data),
    msgType: params.msgType,
  });
}

async function getTeacherUserIdForProfessional(professionalId: number): Promise<number | null> {
  const [row] = await db
    .select({ userId: professionalProfilesTable.userId })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, professionalId))
    .limit(1);
  return row?.userId ?? null;
}

// ── POST /shadow-teacher/:matchId/candidates/:candidateId/send-request ────
router.post("/shadow-teacher/:matchId/candidates/:candidateId/send-request", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  const candidateId = parseInt(req.params["candidateId"] as string, 10);
  if (isNaN(matchId) || isNaN(candidateId)) { res.status(400).json({ error: "Invalid params" }); return; }
  const ctx = await resolveNegotiationAccess(matchId, candidateId, req.userId!, req.userRole!);
  if (!ctx) { res.status(403).json({ error: "Access denied or not found" }); return; }
  if (ctx.myRole !== "parent") { res.status(403).json({ error: "Only the parent can send a request" }); return; }
  if (ctx.match.status !== "shortlisted") { res.status(409).json({ error: "Requests can only be sent while the match is shortlisted" }); return; }
  if (ctx.candidate.requestStatus !== "not_sent") { res.status(409).json({ error: "Request has already been sent for this candidate" }); return; }

  const [updated] = await db
    .update(shadowMatchCandidatesTable)
    .set({ requestStatus: "sent" })
    .where(eq(shadowMatchCandidatesTable.id, candidateId))
    .returning();

  await postCandidateStructuredMessage({
    matchId,
    candidateProfessionalId: ctx.candidate.professionalId,
    senderId: req.userId!,
    msgType: "request_sent",
    data: {},
  });

  const teacherUserId = await getTeacherUserIdForProfessional(ctx.candidate.professionalId);
  if (teacherUserId) {
    void notifyMatchChatMessage(teacherUserId, "A parent").catch(() => {});
    void createInAppNotification(teacherUserId, {
      type: "shadow_request_received",
      title: "A parent has sent you a request",
      body: "Log in to accept or decline this parent's request.",
      relatedType: "match",
      relatedId: matchId,
    }).catch(() => {});
  }
  res.status(201).json(updated);
});

// ── POST /shadow-teacher/:matchId/candidates/:candidateId/respond-request ─
const RespondRequestBody = z.object({
  action: z.enum(["accept", "reject"]),
  note: z.string().max(500).optional(),
});
router.post("/shadow-teacher/:matchId/candidates/:candidateId/respond-request", requireAuth, requireRole("professional"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  const candidateId = parseInt(req.params["candidateId"] as string, 10);
  if (isNaN(matchId) || isNaN(candidateId)) { res.status(400).json({ error: "Invalid params" }); return; }
  const parsed = RespondRequestBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const ctx = await resolveNegotiationAccess(matchId, candidateId, req.userId!, req.userRole!);
  if (!ctx) { res.status(403).json({ error: "Access denied or not found" }); return; }
  if (ctx.myRole !== "professional") { res.status(403).json({ error: "Only the invited teacher can respond" }); return; }
  if (ctx.candidate.requestStatus !== "sent") { res.status(409).json({ error: "No pending request to respond to" }); return; }

  const newStatus = parsed.data.action === "accept" ? "accepted" : "rejected";
  const [updated] = await db
    .update(shadowMatchCandidatesTable)
    .set({
      requestStatus: newStatus,
      rejectionNote: parsed.data.action === "reject" ? (parsed.data.note ?? null) : null,
    })
    .where(eq(shadowMatchCandidatesTable.id, candidateId))
    .returning();

  await postCandidateStructuredMessage({
    matchId,
    candidateProfessionalId: ctx.candidate.professionalId,
    senderId: req.userId!,
    msgType: parsed.data.action === "accept" ? "request_accepted" : "request_rejected",
    data: parsed.data.action === "reject" ? { note: parsed.data.note ?? null } : {},
  });

  void notifyMatchChatMessage(ctx.match.parentId, "A shadow teacher").catch(() => {});
  void createInAppNotification(ctx.match.parentId, {
    type: parsed.data.action === "accept" ? "shadow_request_accepted" : "shadow_request_rejected",
    title: parsed.data.action === "accept" ? "A candidate accepted your request" : "A candidate declined your request",
    body: parsed.data.action === "accept"
      ? "Open the app to schedule an interview."
      : "Open the app to try another candidate.",
    relatedType: "match",
    relatedId: matchId,
  }).catch(() => {});
  res.status(200).json(updated);
});

// ── POST /shadow-teacher/:matchId/candidates/:candidateId/propose-interview ─
const ProposeInterviewBody = z.object({
  slots: z.array(z.object({
    date: z.string().min(1),
    time: z.string().min(1),
    label: z.string().max(100).optional(),
  })).min(1).max(3),
});
router.post("/shadow-teacher/:matchId/candidates/:candidateId/propose-interview", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  const candidateId = parseInt(req.params["candidateId"] as string, 10);
  if (isNaN(matchId) || isNaN(candidateId)) { res.status(400).json({ error: "Invalid params" }); return; }
  const parsed = ProposeInterviewBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const ctx = await resolveNegotiationAccess(matchId, candidateId, req.userId!, req.userRole!);
  if (!ctx) { res.status(403).json({ error: "Access denied or not found" }); return; }
  if (ctx.myRole !== "parent") { res.status(403).json({ error: "Only the parent can propose interview slots" }); return; }
  if (ctx.candidate.requestStatus !== "accepted") { res.status(409).json({ error: "The teacher has not accepted your request yet" }); return; }
  if (ctx.candidate.interviewConfirmedSlot) { res.status(409).json({ error: "Interview has already been confirmed" }); return; }

  // Re-propose allowed while no slot is confirmed — overwrites previous slots.
  const [updated] = await db
    .update(shadowMatchCandidatesTable)
    .set({ interviewSlotsJson: JSON.stringify(parsed.data.slots) })
    .where(eq(shadowMatchCandidatesTable.id, candidateId))
    .returning();

  await postCandidateStructuredMessage({
    matchId,
    candidateProfessionalId: ctx.candidate.professionalId,
    senderId: req.userId!,
    msgType: "interview_proposed",
    data: { slots: parsed.data.slots },
  });

  const teacherUserId = await getTeacherUserIdForProfessional(ctx.candidate.professionalId);
  if (teacherUserId) {
    void notifyMatchChatMessage(teacherUserId, "A parent").catch(() => {});
    void createInAppNotification(teacherUserId, {
      type: "interview_proposed",
      title: "Parent proposed interview slots",
      body: `Pick one of ${parsed.data.slots.length} slot(s) to confirm the interview.`,
      relatedType: "match",
      relatedId: matchId,
    }).catch(() => {});
  }
  res.status(200).json(updated);
});

// ── POST /shadow-teacher/:matchId/candidates/:candidateId/confirm-interview ─
const ConfirmInterviewBody = z.object({
  confirmedSlot: z.string().min(1),
});
router.post("/shadow-teacher/:matchId/candidates/:candidateId/confirm-interview", requireAuth, requireRole("professional"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  const candidateId = parseInt(req.params["candidateId"] as string, 10);
  if (isNaN(matchId) || isNaN(candidateId)) { res.status(400).json({ error: "Invalid params" }); return; }
  const parsed = ConfirmInterviewBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const ctx = await resolveNegotiationAccess(matchId, candidateId, req.userId!, req.userRole!);
  if (!ctx) { res.status(403).json({ error: "Access denied or not found" }); return; }
  if (ctx.myRole !== "professional") { res.status(403).json({ error: "Only the invited teacher can confirm the interview" }); return; }
  if (!ctx.candidate.interviewSlotsJson) { res.status(409).json({ error: "No interview slots have been proposed yet" }); return; }
  if (ctx.candidate.interviewConfirmedSlot) { res.status(409).json({ error: "Interview has already been confirmed" }); return; }

  // Validate confirmedSlot is one of the proposed slots (accept a few common
  // encodings: "date time", "dateTtime", or the "label" if provided).
  let proposedSlots: Array<{ date: string; time: string; label?: string }> = [];
  try {
    proposedSlots = JSON.parse(ctx.candidate.interviewSlotsJson) as Array<{ date: string; time: string; label?: string }>;
  } catch {
    res.status(500).json({ error: "Stored interview slots are malformed" });
    return;
  }
  const slotMatches = proposedSlots.some((s) => {
    return parsed.data.confirmedSlot === `${s.date}T${s.time}`
      || parsed.data.confirmedSlot === `${s.date} ${s.time}`
      || (s.label !== undefined && parsed.data.confirmedSlot === s.label);
  });
  if (!slotMatches) { res.status(400).json({ error: "confirmedSlot must be one of the proposed slots" }); return; }

  const meetLink = `https://meet.jit.si/includly-${matchId}-${candidateId}${JITSI_CONFIG_SUFFIX}`;
  const [updated] = await db
    .update(shadowMatchCandidatesTable)
    .set({
      interviewConfirmedSlot: parsed.data.confirmedSlot,
      meetLink,
    })
    .where(eq(shadowMatchCandidatesTable.id, candidateId))
    .returning();

  await postCandidateStructuredMessage({
    matchId,
    candidateProfessionalId: ctx.candidate.professionalId,
    senderId: req.userId!,
    msgType: "interview_confirmed",
    data: { confirmedSlot: parsed.data.confirmedSlot, meetLink },
  });

  void notifyMatchChatMessage(ctx.match.parentId, "A shadow teacher").catch(() => {});
  void createInAppNotification(ctx.match.parentId, {
    type: "interview_confirmed",
    title: "Interview confirmed",
    body: `Join link: ${meetLink}`,
    relatedType: "match",
    relatedId: matchId,
  }).catch(() => {});
  res.status(200).json(updated);
});

// ── POST /shadow-teacher/:matchId/candidates/:candidateId/mark-interview-done ─
router.post("/shadow-teacher/:matchId/candidates/:candidateId/mark-interview-done", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  const candidateId = parseInt(req.params["candidateId"] as string, 10);
  if (isNaN(matchId) || isNaN(candidateId)) { res.status(400).json({ error: "Invalid params" }); return; }
  const ctx = await resolveNegotiationAccess(matchId, candidateId, req.userId!, req.userRole!);
  if (!ctx) { res.status(403).json({ error: "Access denied or not found" }); return; }
  if (ctx.myRole !== "parent") { res.status(403).json({ error: "Only the parent can mark the interview as done" }); return; }
  if (!ctx.candidate.meetLink) { res.status(409).json({ error: "No confirmed interview to mark as done" }); return; }
  if (ctx.candidate.interviewDoneAt) { res.status(409).json({ error: "Interview is already marked as done" }); return; }

  const [updated] = await db
    .update(shadowMatchCandidatesTable)
    .set({ interviewDoneAt: new Date() })
    .where(eq(shadowMatchCandidatesTable.id, candidateId))
    .returning();

  await postCandidateStructuredMessage({
    matchId,
    candidateProfessionalId: ctx.candidate.professionalId,
    senderId: req.userId!,
    msgType: "interview_done",
    data: {},
  });

  const teacherUserId = await getTeacherUserIdForProfessional(ctx.candidate.professionalId);
  if (teacherUserId) {
    void createInAppNotification(teacherUserId, {
      type: "interview_done",
      title: "Interview marked complete",
      body: "Parent marked the interview as complete. Salary negotiation can begin.",
      relatedType: "match",
      relatedId: matchId,
    }).catch(() => {});
  }
  res.status(200).json(updated);
});

// ── POST /shadow-teacher/:matchId/candidates/:candidateId/request-trial ─
const RequestTrialV2Body = z.object({
  trialDays: z.number().int().min(1).max(3),
});
router.post("/shadow-teacher/:matchId/candidates/:candidateId/request-trial", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  const candidateId = parseInt(req.params["candidateId"] as string, 10);
  if (isNaN(matchId) || isNaN(candidateId)) { res.status(400).json({ error: "Invalid params" }); return; }
  const parsed = RequestTrialV2Body.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const ctx = await resolveNegotiationAccess(matchId, candidateId, req.userId!, req.userRole!);
  if (!ctx) { res.status(403).json({ error: "Access denied or not found" }); return; }
  if (ctx.myRole !== "parent") { res.status(403).json({ error: "Only the parent can request a trial" }); return; }

  const [acceptedOffer] = await db
    .select({ id: negotiationOffersTable.id })
    .from(negotiationOffersTable)
    .where(and(
      eq(negotiationOffersTable.matchId, matchId),
      eq(negotiationOffersTable.candidateId, candidateId),
      eq(negotiationOffersTable.status, "accepted"),
    ))
    .limit(1);
  if (!acceptedOffer) { res.status(409).json({ error: "A salary offer must be accepted before requesting a trial" }); return; }
  if (ctx.candidate.trialDaysAccepted != null) { res.status(409).json({ error: "Trial has already been accepted for this candidate" }); return; }

  const [updated] = await db
    .update(shadowMatchCandidatesTable)
    .set({ trialDaysRequested: parsed.data.trialDays })
    .where(eq(shadowMatchCandidatesTable.id, candidateId))
    .returning();

  await postCandidateStructuredMessage({
    matchId,
    candidateProfessionalId: ctx.candidate.professionalId,
    senderId: req.userId!,
    msgType: "trial_requested",
    data: { trialDays: parsed.data.trialDays },
  });

  const teacherUserId = await getTeacherUserIdForProfessional(ctx.candidate.professionalId);
  if (teacherUserId) {
    void notifyMatchChatMessage(teacherUserId, "A parent").catch(() => {});
    void createInAppNotification(teacherUserId, {
      type: "trial_requested",
      title: `Parent requested a ${parsed.data.trialDays}-day trial`,
      body: "Accept the same number of days or counter with fewer.",
      relatedType: "match",
      relatedId: matchId,
    }).catch(() => {});
  }
  res.status(200).json(updated);
});

// ── POST /shadow-teacher/:matchId/candidates/:candidateId/accept-trial ─
const AcceptTrialV2Body = z.object({
  trialDays: z.number().int().min(1),
});
router.post("/shadow-teacher/:matchId/candidates/:candidateId/accept-trial", requireAuth, requireRole("professional"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  const candidateId = parseInt(req.params["candidateId"] as string, 10);
  if (isNaN(matchId) || isNaN(candidateId)) { res.status(400).json({ error: "Invalid params" }); return; }
  const parsed = AcceptTrialV2Body.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const ctx = await resolveNegotiationAccess(matchId, candidateId, req.userId!, req.userRole!);
  if (!ctx) { res.status(403).json({ error: "Access denied or not found" }); return; }
  if (ctx.myRole !== "professional") { res.status(403).json({ error: "Only the invited teacher can accept a trial" }); return; }
  if (ctx.candidate.trialDaysRequested == null) { res.status(409).json({ error: "No trial has been requested for this candidate" }); return; }
  if (parsed.data.trialDays > ctx.candidate.trialDaysRequested) {
    res.status(400).json({ error: `trialDays must be <= ${ctx.candidate.trialDaysRequested} (the number the parent requested)` });
    return;
  }
  if (ctx.candidate.trialDaysAccepted != null) { res.status(409).json({ error: "Trial has already been accepted" }); return; }

  // Task 3 correction: accept-trial only records the negotiated trial length.
  // It must NOT flip match.status or set selectedProfessionalId — those two
  // fields are owned by the existing payment-verify step (verify-trial-payment /
  // mark-trial-direct-pay-paid), which also generates trialStartOtp at the same
  // time. Setting status='trial_pending' here would make the existing trial
  // payment endpoints reject with "not awaiting trial payment" (they require
  // status='shortlisted') and leave the match with no trialStartOtp. match.trialDays
  // is still set here so the existing payment flow picks up the correct
  // multiplied fee (see Task 2b) once the parent proceeds to pay.
  await db
    .update(shadowMatchCandidatesTable)
    .set({ trialDaysAccepted: parsed.data.trialDays })
    .where(eq(shadowMatchCandidatesTable.id, candidateId));
  await db
    .update(shadowTeacherMatchesTable)
    .set({
      trialDays: parsed.data.trialDays,
      updatedAt: new Date(),
    })
    .where(eq(shadowTeacherMatchesTable.id, matchId));

  await postCandidateStructuredMessage({
    matchId,
    candidateProfessionalId: ctx.candidate.professionalId,
    senderId: req.userId!,
    msgType: "trial_accepted",
    data: { trialDays: parsed.data.trialDays },
  });

  void notifyMatchChatMessage(ctx.match.parentId, "A shadow teacher").catch(() => {});
  void createInAppNotification(ctx.match.parentId, {
    type: "trial_accepted",
    title: `Trial accepted for ${parsed.data.trialDays} day${parsed.data.trialDays > 1 ? "s" : ""}`,
    body: "You can now book the trial payment when ready.",
    relatedType: "match",
    relatedId: matchId,
  }).catch(() => {});

  const [updatedCandidate] = await db
    .select()
    .from(shadowMatchCandidatesTable)
    .where(eq(shadowMatchCandidatesTable.id, candidateId));
  res.status(200).json(updatedCandidate);
});

// ── POST /shadow-teacher/:matchId/commit/order + /commit/verify ─────────────
// Parent commits to a shortlisted teacher. The placement fee (admin-configured,
// default ₹2999) is charged at this step via Razorpay. Matching fee (paid at
// request time) is unaffected — this is a separate, later fee.
const CommitBody = z.object({
  selectedProfessionalId: z.number().int().positive(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  termsAcknowledged: z.boolean().optional(),
});

type CommitContextError = { status: number; body: { error: string; message?: string; pendingAmountInr?: number; teacherName?: string | null } };
type CommitContextResult =
  | { error: CommitContextError }
  | {
      match: typeof shadowTeacherMatchesTable.$inferSelect;
      teacher: { pricingMinINR: number | null; fullName: string | null; phone: string | null; email: string | null; userId: number };
      monthlyFeeInr: number;
      // Non-salary agreed terms from the accepted offer (null if no accepted
      // offer — engagement snapshot will be NULL, meaning "no agreement recorded").
      absenceRetainerPct: number | null;
      absenceFreeDaysPerMonth: number | null;
      summerRetainerPct: number | null;
      summerRetainerMonths: number | null;
      leaveTermsNotes: string | null;
    };

async function loadCommitContext(matchId: number, parentId: number, selectedProfessionalId: number): Promise<CommitContextResult> {
  const [match] = await db
    .select()
    .from(shadowTeacherMatchesTable)
    .where(and(eq(shadowTeacherMatchesTable.id, matchId), eq(shadowTeacherMatchesTable.parentId, parentId)));
  if (!match) return { error: { status: 404, body: { error: "Match not found" } } };
  if (!["shortlisted", "trial_done"].includes(match.status)) {
    return { error: { status: 400, body: { error: "Commitment is only allowed from shortlisted or trial_done status" } } };
  }

  const [candidate] = await db
    .select()
    .from(shadowMatchCandidatesTable)
    .where(
      and(
        eq(shadowMatchCandidatesTable.matchId, matchId),
        eq(shadowMatchCandidatesTable.professionalId, selectedProfessionalId),
        isNull(shadowMatchCandidatesTable.removedAt),
      ),
    );
  if (!candidate) return { error: { status: 404, body: { error: "Selected professional is not an active candidate for this match" } } } as const;

  const [teacher] = await db
    .select({ pricingMinINR: professionalProfilesTable.pricingMinINR, fullName: professionalProfilesTable.fullName, phone: professionalProfilesTable.phone, email: professionalProfilesTable.email, userId: professionalProfilesTable.userId })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, selectedProfessionalId));
  if (!teacher || teacher.pricingMinINR == null) {
    return {
      error: {
        status: 409,
        body: { error: "commitment_blocked_no_pricing", message: "This teacher hasn't set their monthly fee yet. An admin can assign them manually once the fee is agreed." },
      },
    } as const;
  }

  const [pendingOffer] = await db
    .select({ amountInr: negotiationOffersTable.amountInr, raisedByRole: negotiationOffersTable.raisedByRole })
    .from(negotiationOffersTable)
    .where(
      and(
        eq(negotiationOffersTable.matchId, matchId),
        eq(negotiationOffersTable.candidateId, candidate.id),
        eq(negotiationOffersTable.status, "pending"),
      ),
    )
    .limit(1);
  if (pendingOffer) {
    const pendingMsg = pendingOffer.raisedByRole === "parent"
      ? `Waiting for ${teacher.fullName ?? "the teacher"} to accept your offer of ₹${pendingOffer.amountInr.toLocaleString("en-IN")} before you can commit.`
      : `${teacher.fullName ?? "The teacher"} has countered at ₹${pendingOffer.amountInr.toLocaleString("en-IN")} — accept or send a counter-offer before committing.`;
    return {
      error: {
        status: 409,
        body: { error: "commitment_blocked_pending_offer", message: pendingMsg, pendingAmountInr: pendingOffer.amountInr, teacherName: teacher.fullName },
      },
    } as const;
  }

  const [acceptedOffer] = await db
    .select({
      amountInr: negotiationOffersTable.amountInr,
      absenceRetainerPct: negotiationOffersTable.absenceRetainerPct,
      absenceFreeDaysPerMonth: negotiationOffersTable.absenceFreeDaysPerMonth,
      summerRetainerPct: negotiationOffersTable.summerRetainerPct,
      summerRetainerMonths: negotiationOffersTable.summerRetainerMonths,
      leaveTermsNotes: negotiationOffersTable.leaveTermsNotes,
    })
    .from(negotiationOffersTable)
    .where(
      and(
        eq(negotiationOffersTable.matchId, matchId),
        eq(negotiationOffersTable.candidateId, candidate.id),
        eq(negotiationOffersTable.status, "accepted"),
      ),
    )
    .limit(1);
  const monthlyFeeInr = acceptedOffer?.amountInr ?? teacher.pricingMinINR!;

  return {
    match,
    teacher,
    monthlyFeeInr,
    absenceRetainerPct: acceptedOffer?.absenceRetainerPct ?? null,
    absenceFreeDaysPerMonth: acceptedOffer?.absenceFreeDaysPerMonth ?? null,
    summerRetainerPct: acceptedOffer?.summerRetainerPct ?? null,
    summerRetainerMonths: acceptedOffer?.summerRetainerMonths ?? null,
    leaveTermsNotes: acceptedOffer?.leaveTermsNotes ?? null,
  } as const;
}

async function finalizeCommit(params: {
  match: typeof shadowTeacherMatchesTable.$inferSelect;
  teacher: { fullName: string | null; phone: string | null; email: string | null; userId: number };
  selectedProfessionalId: number;
  monthlyFeeInr: number;
  startDate: string | null;
  placementFeeInr: number;
  placementFeePaymentId: number | null;
  // Non-salary agreed terms snapshotted onto the engagement. Null if no accepted
  // offer or no negotiation happened — engagement stays NULL for these fields,
  // matching the "no agreement recorded" convention on pre-feature rows.
  absenceRetainerPct: number | null;
  absenceFreeDaysPerMonth: number | null;
  summerRetainerPct: number | null;
  summerRetainerMonths: number | null;
  leaveTermsNotes: string | null;
  parentTermsAcknowledgedAt: Date;
}) {
  const {
    match, teacher, selectedProfessionalId, monthlyFeeInr, placementFeeInr, placementFeePaymentId,
    absenceRetainerPct, absenceFreeDaysPerMonth, summerRetainerPct, summerRetainerMonths, leaveTermsNotes,
    parentTermsAcknowledgedAt,
  } = params;
  const settings = await getSettings();
  const platformSalaryEnabled = ((settings as Record<string, unknown>)["platformSalaryEnabled"] as boolean) ?? false;

  const today = new Date().toISOString().split("T")[0]!;
  const effectiveStartDate = params.startDate ?? match.pendingCommitStartDate ?? today;

  // [Architect gap #1] Stranded trialCreditInr: if the new engagement won't run
  // salary through the platform, a Razorpay-collected trial fee has no salary
  // payment to apply against — credit it straight to the parent's wallet instead.
  const trialFeePaidInr = match.trialFeePaidInr ?? 0;
  let engagementTrialCreditInr = 0;
  if (trialFeePaidInr > 0) {
    if (platformSalaryEnabled) {
      engagementTrialCreditInr = trialFeePaidInr;
    } else {
      await creditWallet(
        match.parentId,
        trialFeePaidInr,
        "refund",
        match.id,
        "Trial fee credited to wallet — this engagement's salary is paid directly to the teacher, not through the platform.",
      );
    }
  }

  const [engagement] = await db
    .insert(shadowTeacherEngagementsTable)
    .values({
      parentId: match.parentId,
      professionalId: selectedProfessionalId,
      childId: match.childId ?? null,
      matchRequestId: match.id,
      startDate: effectiveStartDate,
      hoursPerWeek: 0,
      monthlyFeeInr,
      trialCreditInr: engagementTrialCreditInr,
      status: "pending_teacher_acceptance",
      startOtp: generateOtp(),
      platformSalaryEnabled,
      placementFeeInr: placementFeeInr > 0 ? placementFeeInr : null,
      placementFeePaymentId,
      // Data-capture only — snapshotted from accepted offer. No downstream
      // automation reads these yet; see schema comment on engagements table.
      absenceRetainerPct,
      absenceFreeDaysPerMonth,
      summerRetainerPct,
      summerRetainerMonths,
      leaveTermsNotes,
      parentTermsAcknowledgedAt,
    })
    .returning();

  await db
    .update(shadowTeacherMatchesTable)
    .set({
      status: "committed",
      selectedProfessionalId,
      matchedAt: new Date(),
      matchedProfessionalId: selectedProfessionalId,
      pendingCommitProfessionalId: null,
      pendingCommitStartDate: null,
      updatedAt: new Date(),
    })
    .where(eq(shadowTeacherMatchesTable.id, match.id));

  const matchChildId = match.childId ?? null;
  const [existingThread] = await db
    .select({ id: connectThreadsTable.id })
    .from(connectThreadsTable)
    .where(and(
      eq(connectThreadsTable.parentId, match.parentId),
      eq(connectThreadsTable.professionalId, selectedProfessionalId),
      matchChildId != null
        ? eq(connectThreadsTable.childId, matchChildId)
        : sql`${connectThreadsTable.childId} IS NULL`,
    ))
    .limit(1);
  if (!existingThread) {
    await db.insert(connectThreadsTable).values({
      parentId: match.parentId,
      professionalId: selectedProfessionalId,
      childId: matchChildId,
    });
  }

  try {
    await createInAppNotification(match.parentId, {
      type: "engagement_pending_acceptance",
      title: "Waiting for teacher to accept",
      body: `${teacher.fullName ?? "Your teacher"} has been notified and needs to accept the engagement. You'll be notified once they confirm.`,
      relatedType: "engagement",
      relatedId: engagement!.id,
    });
  } catch { /* non-blocking */ }

  try {
    await createInAppNotification(teacher.userId, {
      type: "engagement_awaiting_acceptance",
      title: "New engagement — your acceptance needed",
      body: `A parent has selected you for an engagement starting ${effectiveStartDate}. Open the app to accept or decline.`,
      relatedType: "engagement",
      relatedId: engagement!.id,
    });
  } catch { /* non-blocking */ }

  return engagement!;
}

router.post("/shadow-teacher/:matchId/commit/order", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }

  const parsed = CommitBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { selectedProfessionalId, startDate, termsAcknowledged } = parsed.data;
  if (!termsAcknowledged) { res.status(400).json({ error: "termsAcknowledged is required to commit to this engagement" }); return; }

  const ctx = await loadCommitContext(matchId, req.userId!, selectedProfessionalId);
  if ("error" in ctx) { res.status(ctx.error.status).json(ctx.error.body); return; }
  const {
    match, teacher, monthlyFeeInr,
    absenceRetainerPct, absenceFreeDaysPerMonth, summerRetainerPct, summerRetainerMonths, leaveTermsNotes,
  } = ctx;

  const settings = await getSettings();
  const placementFeeInr = ((settings as Record<string, unknown>)["placementFeeInr"] as number) ?? 2999;

  if (placementFeeInr <= 0) {
    const engagement = await finalizeCommit({
      match, teacher, selectedProfessionalId, monthlyFeeInr,
      startDate: startDate ?? null,
      placementFeeInr: 0,
      placementFeePaymentId: null,
      absenceRetainerPct, absenceFreeDaysPerMonth, summerRetainerPct, summerRetainerMonths, leaveTermsNotes,
      parentTermsAcknowledgedAt: new Date(),
    });
    res.json({ engagementId: engagement.id, teacherFullName: teacher.fullName, phone: teacher.phone, email: teacher.email, waived: true });
    return;
  }

  // Idempotency: if an order is already pending for this match, overwrite the
  // pending selection/start-date but reuse the existing Razorpay order.
  if (match.placementFeeOrderId) {
    await db
      .update(shadowTeacherMatchesTable)
      .set({ pendingCommitProfessionalId: selectedProfessionalId, pendingCommitStartDate: startDate ?? null, updatedAt: new Date() })
      .where(eq(shadowTeacherMatchesTable.id, matchId));
    res.json({
      matchId,
      orderId: match.placementFeeOrderId,
      amount: (match.placementFeeAmountInr ?? placementFeeInr) * 100,
      keyId: process.env["RAZORPAY_KEY_ID"]!,
      resuming: true,
    });
    return;
  }

  const razorpay = getRazorpay();
  if (!razorpay) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  const amount = placementFeeInr * 100;
  const order = await razorpay.orders.create({
    amount,
    currency: "INR",
    receipt: `placement_${matchId}_${Date.now()}`,
    notes: { matchId: String(matchId), selectedProfessionalId: String(selectedProfessionalId) },
  });

  await db
    .update(shadowTeacherMatchesTable)
    .set({
      pendingCommitProfessionalId: selectedProfessionalId,
      pendingCommitStartDate: startDate ?? null,
      placementFeeOrderId: order.id as string,
      placementFeeAmountInr: placementFeeInr,
      updatedAt: new Date(),
    })
    .where(eq(shadowTeacherMatchesTable.id, matchId));

  res.json({ matchId, orderId: order.id, amount, keyId: process.env["RAZORPAY_KEY_ID"]! });
});

const CommitVerifyBody = z.object({
  razorpayOrderId: z.string(),
  razorpayPaymentId: z.string(),
  razorpaySignature: z.string(),
  termsAcknowledged: z.boolean().optional(),
});

router.post("/shadow-teacher/:matchId/commit/verify", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }

  const parsed = CommitVerifyBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature, termsAcknowledged } = parsed.data;

  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keySecret) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  const [match] = await db
    .select()
    .from(shadowTeacherMatchesTable)
    .where(and(eq(shadowTeacherMatchesTable.id, matchId), eq(shadowTeacherMatchesTable.parentId, req.userId!)));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }

  // Idempotency: already committed — return the existing engagement rather
  // than re-processing (guards against double-submit of /commit/verify).
  // Checked before the termsAcknowledged gate so a legitimate retry of an
  // already-finalized commit isn't blocked by a resend that omits it.
  if (match.status === "committed") {
    const [existingEngagement] = await db
      .select({ id: shadowTeacherEngagementsTable.id })
      .from(shadowTeacherEngagementsTable)
      .where(eq(shadowTeacherEngagementsTable.matchRequestId, match.id))
      .orderBy(desc(shadowTeacherEngagementsTable.id))
      .limit(1);
    res.json({ engagementId: existingEngagement?.id, alreadyCommitted: true });
    return;
  }

  if (!termsAcknowledged) { res.status(400).json({ error: "termsAcknowledged is required to commit to this engagement" }); return; }
  if (!["shortlisted", "trial_done"].includes(match.status)) { res.status(400).json({ error: "Match is not awaiting placement fee payment" }); return; }
  if (!match.placementFeeOrderId || match.placementFeeOrderId !== razorpayOrderId) { res.status(400).json({ error: "Order ID mismatch" }); return; }
  if (!match.pendingCommitProfessionalId) { res.status(409).json({ error: "No pending commitment found for this match" }); return; }

  const expectedSig = crypto.createHmac("sha256", keySecret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest("hex");
  if (expectedSig !== razorpaySignature) { res.status(400).json({ error: "Payment signature verification failed" }); return; }

  const selectedProfessionalId = match.pendingCommitProfessionalId;
  const placementFeeInr = match.placementFeeAmountInr ?? 0;

  // Guard against a client retry re-submitting the same valid Razorpay
  // payment after the row was already recorded (e.g. finalizeCommit failed
  // or the response was lost in-flight) — reuse the existing payment row
  // instead of inserting a duplicate completed payment for the same charge.
  const [existingPaymentRow] = await db
    .select()
    .from(paymentsTable)
    .where(and(eq(paymentsTable.providerPaymentId, razorpayPaymentId), eq(paymentsTable.plan, "plan_placement_fee")))
    .limit(1);

  let paymentRow = existingPaymentRow;
  if (!paymentRow) {
    // Record the payment first — even if re-validation below blocks finalization,
    // the charge already succeeded on Razorpay's side and must stay visible in
    // payment history for admin follow-up.
    [paymentRow] = await db
      .insert(paymentsTable)
      .values({
        userId: req.userId!,
        plan: "plan_placement_fee",
        provider: "razorpay",
        providerOrderId: razorpayOrderId,
        providerPaymentId: razorpayPaymentId,
        amountPaise: placementFeeInr * 100,
        currency: "INR",
        status: "completed",
        professionalId: selectedProfessionalId,
        metadata: JSON.stringify({ matchId }),
      })
      .returning();
  }

  const ctx = await loadCommitContext(matchId, req.userId!, selectedProfessionalId);
  if ("error" in ctx) {
    res.status(ctx.error.status).json({
      ...ctx.error.body,
      paymentCaptured: true,
      message: "message" in ctx.error.body
        ? `${ctx.error.body.message} Your payment was captured — contact support if this isn't resolved automatically.`
        : "Your payment was captured but the commitment could not be finalized. Contact support.",
    });
    return;
  }
  const {
    match: freshMatch, teacher, monthlyFeeInr,
    absenceRetainerPct, absenceFreeDaysPerMonth, summerRetainerPct, summerRetainerMonths, leaveTermsNotes,
  } = ctx;

  const engagement = await finalizeCommit({
    match: freshMatch,
    teacher,
    selectedProfessionalId,
    monthlyFeeInr,
    startDate: freshMatch.pendingCommitStartDate,
    placementFeeInr,
    placementFeePaymentId: paymentRow!.id,
    absenceRetainerPct, absenceFreeDaysPerMonth, summerRetainerPct, summerRetainerMonths, leaveTermsNotes,
    parentTermsAcknowledgedAt: new Date(),
  });

  res.json({ engagementId: engagement.id, teacherFullName: teacher.fullName, phone: teacher.phone, email: teacher.email });
});

// ── POST /shadow-teacher/:matchId/commit — 410 Gone (replaced by order/verify) ─
router.post("/shadow-teacher/:matchId/commit", requireAuth, requireRole("parent"), async (_req: Request, res: Response): Promise<void> => {
  res.status(410).json({
    error: "gone",
    message: "This step now requires payment. Use POST /:matchId/commit/order then /:matchId/commit/verify.",
  });
});

// ── POST /shadow-teacher/:matchId/verify-commitment — 410 Gone (commit is now free) ─
router.post("/shadow-teacher/:matchId/verify-commitment", requireAuth, requireRole("parent"), async (_req: Request, res: Response): Promise<void> => {
  res.status(410).json({
    error: "gone",
    message: "This step is no longer required. Commitment is now free — POST /:matchId/commit creates the engagement directly.",
  });
});

// ── POST /shadow-teacher/:matchId/request-trial ──────────────────────────────
// Parent requests an optional trial day with one shortlisted candidate.
// Creates a Razorpay order for the admin-configured trial fee (default ₹500).
// Verificationstatus check: professional_profiles.verification_status is authoritative —
// admin approval sets BOTH professional_profiles and identity_verifications atomically.
const RequestTrialBody = z.object({
  selectedProfessionalId: z.number().int().positive(),
});

router.post("/shadow-teacher/:matchId/request-trial", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }

  const parsed = RequestTrialBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { selectedProfessionalId } = parsed.data;

  const [match] = await db
    .select()
    .from(shadowTeacherMatchesTable)
    .where(and(eq(shadowTeacherMatchesTable.id, matchId), eq(shadowTeacherMatchesTable.parentId, req.userId!)));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }
  if (match.status !== "shortlisted") { res.status(400).json({ error: "Trial can only be requested from shortlisted status" }); return; }

  // Verify the professional is an active candidate for this match
  const [candidate] = await db
    .select()
    .from(shadowMatchCandidatesTable)
    .where(
      and(
        eq(shadowMatchCandidatesTable.matchId, matchId),
        eq(shadowMatchCandidatesTable.professionalId, selectedProfessionalId),
        isNull(shadowMatchCandidatesTable.removedAt),
      ),
    );
  if (!candidate) { res.status(404).json({ error: "Selected professional is not an active candidate for this match" }); return; }

  // Guard: only verified teachers can be trialled
  const [teacher] = await db
    .select({ verificationStatus: professionalProfilesTable.verificationStatus })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, selectedProfessionalId));
  if (!teacher || teacher.verificationStatus !== "verified") {
    res.status(409).json({ error: "trial_blocked_unverified", message: "This teacher is not yet verified. Only verified teachers can be trialled." });
    return;
  }

  const settings = await getSettings();
  const baseTrialFeeInr = (settings as Record<string, unknown>)["trialFeeInr"] as number ?? 500;
  // Task 2b — multiply the per-day trial fee by the confirmed trial length (1-3
  // days). match.trialDays is set by the redesigned accept-trial endpoint; if
  // null (legacy flow), multiplier defaults to 1 for backward compat.
  const trialFeeInr = baseTrialFeeInr * (match.trialDays ?? 1);
  const trialDirectPayEnabled = (settings as Record<string, unknown>)["trialDirectPayEnabled"] as boolean ?? false;

  // ── Direct-pay branch: parent pays the teacher's verified UPI directly, no Razorpay order ──
  if (trialDirectPayEnabled) {
    const [teacherPay] = await db
      .select({ upiVpa: professionalProfilesTable.upiVpa, upiVerifiedAt: professionalProfilesTable.upiVerifiedAt, userId: professionalProfilesTable.userId, name: usersTable.fullName })
      .from(professionalProfilesTable)
      .innerJoin(usersTable, eq(usersTable.id, professionalProfilesTable.userId))
      .where(eq(professionalProfilesTable.id, selectedProfessionalId));

    const isFirstDirectPayRequest = !match.trialDirectPay;
    await db
      .update(shadowTeacherMatchesTable)
      .set({ trialDirectPay: true, updatedAt: new Date() })
      .where(eq(shadowTeacherMatchesTable.id, matchId));

    if (!teacherPay?.upiVpa || !teacherPay.upiVerifiedAt) {
      if (isFirstDirectPayRequest && teacherPay?.userId) {
        try {
          await createInAppNotification(teacherPay.userId, {
            type: "upi_verification_needed",
            title: "Verify your UPI ID to accept direct trial payments",
            body: "A parent wants to book a trial day with you, but you haven't verified your UPI ID yet. Verify it in your profile to receive payment directly.",
            relatedType: "match",
            relatedId: matchId,
          });
        } catch { /* non-blocking */ }
      }
      res.json({ matchId: match.id, directPay: true, blocked: true, trialFeeInr });
      return;
    }

    res.json({
      matchId: match.id,
      directPay: true,
      blocked: false,
      trialFeeInr,
      upiVpa: teacherPay.upiVpa,
      teacherName: teacherPay.name ?? "your teacher",
    });
    return;
  }

  // If a trial order was already created for this match, re-return it (allows modal reopen)
  if (match.trialProviderOrderId) {
    res.json({
      matchId: match.id,
      orderId: match.trialProviderOrderId,
      amount: trialFeeInr * 100,
      keyId: process.env["RAZORPAY_KEY_ID"]!,
      resuming: true,
    });
    return;
  }

  const razorpay = getRazorpay();
  if (!razorpay) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  const amount = trialFeeInr * 100;
  const order = await razorpay.orders.create({
    amount,
    currency: "INR",
    receipt: `trial_${matchId}_${Date.now()}`,
    notes: { matchId: String(matchId), selectedProfessionalId: String(selectedProfessionalId) },
  });

  await db
    .update(shadowTeacherMatchesTable)
    .set({ trialProviderOrderId: order.id as string, updatedAt: new Date() })
    .where(eq(shadowTeacherMatchesTable.id, matchId));

  res.json({
    matchId: match.id,
    orderId: order.id,
    amount,
    keyId: process.env["RAZORPAY_KEY_ID"]!,
  });
});

// ── POST /shadow-teacher/:matchId/verify-trial-payment ───────────────────────
// HMAC-verify the trial fee payment and transition shortlisted → trial_pending.
// Shape mirrors verify-request-payment exactly.
const VerifyTrialPaymentBody = z.object({
  razorpayOrderId: z.string(),
  razorpayPaymentId: z.string(),
  razorpaySignature: z.string(),
  selectedProfessionalId: z.number().int().positive(),
  preMeetingRequested: z.boolean().default(false),
  preMeetingNote: z.string().max(500).nullable().default(null),
  trialLocation: z.string().max(500).nullable().default(null),
});

router.post("/shadow-teacher/:matchId/verify-trial-payment", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }

  const parsed = VerifyTrialPaymentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keySecret) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  const { razorpayOrderId, razorpayPaymentId, razorpaySignature, selectedProfessionalId, preMeetingRequested, preMeetingNote, trialLocation } = parsed.data;

  const [match] = await db
    .select()
    .from(shadowTeacherMatchesTable)
    .where(and(eq(shadowTeacherMatchesTable.id, matchId), eq(shadowTeacherMatchesTable.parentId, req.userId!)));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }
  if (match.status !== "shortlisted") { res.status(400).json({ error: "Match is not awaiting trial payment" }); return; }
  if (match.trialProviderOrderId !== razorpayOrderId) { res.status(400).json({ error: "Order ID mismatch" }); return; }

  const expectedSig = crypto.createHmac("sha256", keySecret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest("hex");
  if (expectedSig !== razorpaySignature) { res.status(400).json({ error: "Payment signature verification failed" }); return; }

  // Re-validate active candidacy at verify time (guards against stale/removed candidate)
  const [activeCand] = await db
    .select({ id: shadowMatchCandidatesTable.id })
    .from(shadowMatchCandidatesTable)
    .where(
      and(
        eq(shadowMatchCandidatesTable.matchId, matchId),
        eq(shadowMatchCandidatesTable.professionalId, selectedProfessionalId),
        isNull(shadowMatchCandidatesTable.removedAt),
      ),
    );
  if (!activeCand) { res.status(409).json({ error: "Selected professional is no longer an active candidate for this match" }); return; }

  const razorpay = getRazorpay();
  if (!razorpay) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  // Use the amount actually charged on the Razorpay order, not a live
  // re-read of admin_settings.trialFeeInr — the admin fee could have
  // changed between request-trial-payment (order creation) and this verify
  // step, and the stored snapshot must reflect what was really collected.
  type RazorpayOrderEntity = { amount?: number };
  let order: RazorpayOrderEntity;
  try {
    order = (await razorpay.orders.fetch(razorpayOrderId)) as unknown as RazorpayOrderEntity;
  } catch (err) {
    console.error("[shadow-teacher/verify-trial-payment] Razorpay order fetch failed:", err);
    res.status(400).json({ error: "Unable to verify payment with Razorpay" });
    return;
  }
  const trialFeePaidInr = Math.round((order.amount ?? 0) / 100);

  const trialStartOtp = generateOtp();
  const trialMeetLink = `https://meet.jit.si/includly-trial-${matchId}-${selectedProfessionalId}${JITSI_CONFIG_SUFFIX}`;

  await db
    .update(shadowTeacherMatchesTable)
    .set({
      status: "trial_pending",
      trialProviderPaymentId: razorpayPaymentId,
      trialFeePaidInr,
      selectedProfessionalId,
      preMeetingRequested,
      preMeetingNote: preMeetingRequested ? (preMeetingNote ?? null) : null,
      trialStartOtp,
      trialMeetLink,
      trialLocation: trialLocation ?? null,
      // Stuck-engagement lazy-timeout resolution — stamp precisely when this
      // state was entered (write-only, no behavior change). See
      // stuckEngagementResolver.ts.
      trialPendingSince: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(shadowTeacherMatchesTable.id, matchId));

  // Notify parent: trial OTP is now visible in-app
  try {
    await createInAppNotification(match.parentId, {
      type: "trial_otp_ready",
      title: "Trial day scheduled — your start code is ready",
      body: "Open the app to get the start code you'll show your teacher at the beginning of the trial day.",
      relatedType: "match",
      relatedId: matchId,
    });
  } catch { /* non-blocking */ }

  res.json({ matchId, status: "trial_pending" });
});

// ── POST /shadow-teacher/:matchId/mark-trial-direct-pay-paid ─────────────────
// Direct-pay counterpart to verify-trial-payment: parent confirms they paid the
// teacher's UPI ID directly (no Razorpay order/HMAC — platform never held funds).
const MarkTrialDirectPayPaidBody = z.object({
  selectedProfessionalId: z.number().int().positive(),
  preMeetingRequested: z.boolean().default(false),
  preMeetingNote: z.string().max(500).nullable().default(null),
  trialLocation: z.string().max(500).nullable().default(null),
});

router.post("/shadow-teacher/:matchId/mark-trial-direct-pay-paid", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }

  const parsed = MarkTrialDirectPayPaidBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { selectedProfessionalId, preMeetingRequested, preMeetingNote, trialLocation } = parsed.data;

  const [match] = await db
    .select()
    .from(shadowTeacherMatchesTable)
    .where(and(eq(shadowTeacherMatchesTable.id, matchId), eq(shadowTeacherMatchesTable.parentId, req.userId!)));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }
  if (!match.trialDirectPay) { res.status(400).json({ error: "This match is not on the direct-pay trial flow" }); return; }

  // Idempotent: if already marked (and possibly already progressed), just return current state
  if (match.status !== "shortlisted") {
    res.json({ matchId, status: match.status });
    return;
  }

  // Re-validate active candidacy at mark-paid time (guards against stale/removed candidate)
  const [activeCand] = await db
    .select({ id: shadowMatchCandidatesTable.id })
    .from(shadowMatchCandidatesTable)
    .where(
      and(
        eq(shadowMatchCandidatesTable.matchId, matchId),
        eq(shadowMatchCandidatesTable.professionalId, selectedProfessionalId),
        isNull(shadowMatchCandidatesTable.removedAt),
      ),
    );
  if (!activeCand) { res.status(409).json({ error: "Selected professional is no longer an active candidate for this match" }); return; }

  const [teacherPay] = await db
    .select({ upiVpa: professionalProfilesTable.upiVpa, upiVerifiedAt: professionalProfilesTable.upiVerifiedAt, userId: professionalProfilesTable.userId })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, selectedProfessionalId));
  if (!teacherPay?.upiVpa || !teacherPay.upiVerifiedAt) {
    res.status(409).json({ error: "professional_upi_unverified", message: "Payment details for this teacher are being finalized. Please try again in a moment." });
    return;
  }

  const trialStartOtp = generateOtp();
  const trialMeetLink = `https://meet.jit.si/includly-trial-${matchId}-${selectedProfessionalId}${JITSI_CONFIG_SUFFIX}`;

  // Note: trialFeePaidInr is intentionally left unset here — the platform never
  // held these funds (parent paid the teacher directly), so there is nothing to
  // credit back or apply as engagement salary credit at commit time.
  await db
    .update(shadowTeacherMatchesTable)
    .set({
      status: "trial_pending",
      selectedProfessionalId,
      preMeetingRequested,
      preMeetingNote: preMeetingRequested ? (preMeetingNote ?? null) : null,
      trialStartOtp,
      trialMeetLink,
      trialLocation: trialLocation ?? null,
      trialDirectPayMarkedPaidAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(shadowTeacherMatchesTable.id, matchId));

  try {
    await createInAppNotification(match.parentId, {
      type: "trial_otp_ready",
      title: "Trial day scheduled — your start code is ready",
      body: "Open the app to get the start code you'll show your teacher at the beginning of the trial day.",
      relatedType: "match",
      relatedId: matchId,
    });
    await createInAppNotification(teacherPay.userId, {
      type: "trial_direct_pay_marked_paid",
      title: "Parent marked the trial fee as paid",
      body: "The parent has marked the trial-day fee as paid directly to your UPI ID. Please confirm receipt in the app once you've received it.",
      relatedType: "match",
      relatedId: matchId,
    });
  } catch { /* non-blocking */ }

  res.json({ matchId, status: "trial_pending" });
});

// ── POST /shadow-teacher/:matchId/confirm-trial-direct-pay ───────────────────
// Teacher confirms they received the direct trial-fee payment. Record-only —
// does not gate any further status transition (the trial is already scheduled).
router.post("/shadow-teacher/:matchId/confirm-trial-direct-pay", requireAuth, requireRole("professional", "admin"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }

  const [match] = await db.select().from(shadowTeacherMatchesTable).where(eq(shadowTeacherMatchesTable.id, matchId));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }
  if (!match.trialDirectPay || !match.trialDirectPayMarkedPaidAt) {
    res.status(400).json({ error: "No direct-pay trial fee has been marked as paid for this match yet" });
    return;
  }

  if (!match.selectedProfessionalId) { res.status(400).json({ error: "No teacher selected for this match" }); return; }
  const [pro] = await db
    .select({ id: professionalProfilesTable.id, userId: professionalProfilesTable.userId })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, match.selectedProfessionalId));
  if (!pro || pro.userId !== req.userId!) { res.status(403).json({ error: "Access denied" }); return; }

  if (match.trialDirectPayConfirmedAt) {
    res.json({ matchId, confirmedAt: match.trialDirectPayConfirmedAt });
    return;
  }

  const [updated] = await db
    .update(shadowTeacherMatchesTable)
    .set({ trialDirectPayConfirmedAt: new Date(), updatedAt: new Date() })
    .where(eq(shadowTeacherMatchesTable.id, matchId))
    .returning();

  res.json({ matchId, confirmedAt: updated!.trialDirectPayConfirmedAt });
});

// ── POST /shadow-teacher/:matchId/mark-trial-done ────────────────────────────
// Either the parent OR the selected teacher can mark the trial day complete.
// Transitions trial_pending → trial_done.
router.post("/shadow-teacher/:matchId/mark-trial-done", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }

  const [match] = await db.select().from(shadowTeacherMatchesTable).where(eq(shadowTeacherMatchesTable.id, matchId));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }
  if (!["trial_pending", "trial_started"].includes(match.status)) { res.status(400).json({ error: "Trial is not in progress" }); return; }

  const isParent = match.parentId === req.userId!;
  let isPro = false;
  if (!isParent && match.selectedProfessionalId) {
    const [pro] = await db
      .select({ id: professionalProfilesTable.id, userId: professionalProfilesTable.userId })
      .from(professionalProfilesTable)
      .where(eq(professionalProfilesTable.id, match.selectedProfessionalId));
    if (pro?.userId === req.userId!) {
      // Also confirm the professional still has an active candidacy for this match
      const [cand] = await db
        .select({ id: shadowMatchCandidatesTable.id })
        .from(shadowMatchCandidatesTable)
        .where(
          and(
            eq(shadowMatchCandidatesTable.matchId, matchId),
            eq(shadowMatchCandidatesTable.professionalId, match.selectedProfessionalId),
            isNull(shadowMatchCandidatesTable.removedAt),
          ),
        );
      isPro = !!cand;
    }
  }
  if (!isParent && !isPro) { res.status(403).json({ error: "Access denied" }); return; }

  await db
    .update(shadowTeacherMatchesTable)
    .set({ status: "trial_done", updatedAt: new Date() })
    .where(eq(shadowTeacherMatchesTable.id, matchId));

  // Notify the parent so they come back to make their commit/walk-away decision.
  // Only fire if it was the professional who marked it done (parent already knows).
  if (isPro) {
    void notifyParentOnTrialDone(match.parentId).catch(() => {});
  }

  res.json({ matchId, status: "trial_done" });
});

// ── POST /shadow-teacher/:matchId/verify-trial-start-otp — teacher confirms trial has begun ─
// Validates the start OTP the parent shows the teacher. Transitions trial_pending → trial_started.
// Generates trial_end_otp for the parent to see.
router.post("/shadow-teacher/:matchId/verify-trial-start-otp", requireAuth, requireRole("professional", "admin"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }

  const otp = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";
  if (!otp) { res.status(400).json({ error: "OTP is required" }); return; }

  const [match] = await db.select().from(shadowTeacherMatchesTable).where(eq(shadowTeacherMatchesTable.id, matchId));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }
  if (match.status !== "trial_pending") { res.status(400).json({ error: "Trial has not been started or is already in progress" }); return; }

  if (!match.selectedProfessionalId) { res.status(400).json({ error: "No teacher selected for this match" }); return; }
  const [pro] = await db
    .select({ id: professionalProfilesTable.id, userId: professionalProfilesTable.userId })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, match.selectedProfessionalId));
  if (!pro || pro.userId !== req.userId!) { res.status(403).json({ error: "Access denied" }); return; }

  const [cand] = await db
    .select({ id: shadowMatchCandidatesTable.id })
    .from(shadowMatchCandidatesTable)
    .where(and(
      eq(shadowMatchCandidatesTable.matchId, matchId),
      eq(shadowMatchCandidatesTable.professionalId, match.selectedProfessionalId),
      isNull(shadowMatchCandidatesTable.removedAt),
    ));
  if (!cand) { res.status(409).json({ error: "Your candidacy for this match is no longer active" }); return; }

  if (!match.trialStartOtp || match.trialStartOtp !== otp) {
    res.status(400).json({ error: "Incorrect start OTP" });
    return;
  }

  const trialEndOtp = generateOtp();

  // Stuck-engagement lazy-timeout resolution — stamp precisely when this
  // state was entered (write-only, no behavior change). See
  // stuckEngagementResolver.ts.
  await db
    .update(shadowTeacherMatchesTable)
    .set({ status: "trial_started", trialEndOtp, trialStartedSince: new Date(), updatedAt: new Date() })
    .where(eq(shadowTeacherMatchesTable.id, matchId));

  res.json({ matchId, status: "trial_started" });
});

// ── POST /shadow-teacher/:matchId/verify-trial-end-otp — teacher confirms trial is complete ─
// Validates the end OTP the parent shows the teacher. Transitions trial_started → trial_done.
router.post("/shadow-teacher/:matchId/verify-trial-end-otp", requireAuth, requireRole("professional", "admin"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }

  const otp = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";
  if (!otp) { res.status(400).json({ error: "OTP is required" }); return; }

  const [match] = await db.select().from(shadowTeacherMatchesTable).where(eq(shadowTeacherMatchesTable.id, matchId));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }
  if (match.status !== "trial_started") { res.status(400).json({ error: "Trial has not started yet or is already marked done" }); return; }

  if (!match.selectedProfessionalId) { res.status(400).json({ error: "No teacher selected for this match" }); return; }
  const [pro] = await db
    .select({ id: professionalProfilesTable.id, userId: professionalProfilesTable.userId })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, match.selectedProfessionalId));
  if (!pro || pro.userId !== req.userId!) { res.status(403).json({ error: "Access denied" }); return; }

  const [cand] = await db
    .select({ id: shadowMatchCandidatesTable.id })
    .from(shadowMatchCandidatesTable)
    .where(and(
      eq(shadowMatchCandidatesTable.matchId, matchId),
      eq(shadowMatchCandidatesTable.professionalId, match.selectedProfessionalId),
      isNull(shadowMatchCandidatesTable.removedAt),
    ));
  if (!cand) { res.status(409).json({ error: "Your candidacy for this match is no longer active" }); return; }

  if (!match.trialEndOtp || match.trialEndOtp !== otp) {
    res.status(400).json({ error: "Incorrect end OTP" });
    return;
  }

  await db
    .update(shadowTeacherMatchesTable)
    .set({ status: "trial_done", updatedAt: new Date() })
    .where(eq(shadowTeacherMatchesTable.id, matchId));

  void notifyParentOnTrialDone(match.parentId).catch(() => {});

  res.json({ matchId, status: "trial_done" });
});

// ── POST /shadow-teacher/:matchId/no-commit ──────────────────────────────────
// Parent walks away after the trial. Trial fee is non-refundable.
// Transitions trial_done → cancelled (re-masks contact automatically via status).
router.post("/shadow-teacher/:matchId/no-commit", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }

  const [match] = await db
    .select()
    .from(shadowTeacherMatchesTable)
    .where(and(eq(shadowTeacherMatchesTable.id, matchId), eq(shadowTeacherMatchesTable.parentId, req.userId!)));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }
  if (match.status !== "trial_done") { res.status(400).json({ error: "Can only walk away after trial is marked done" }); return; }

  await db
    .update(shadowTeacherMatchesTable)
    .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
    .where(eq(shadowTeacherMatchesTable.id, matchId));

  res.json({ matchId, status: "cancelled" });
});

// ── POST /shadow-teacher/:matchId/mark-not-interested — parent dismisses a candidate, triggers auto-refill ─
const MarkNotInterestedBody = z.object({ candidateId: z.number().int().positive() });

router.post("/shadow-teacher/:matchId/mark-not-interested", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }

  const parsed = MarkNotInterestedBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { candidateId } = parsed.data;

  const [match] = await db
    .select()
    .from(shadowTeacherMatchesTable)
    .where(and(eq(shadowTeacherMatchesTable.id, matchId), eq(shadowTeacherMatchesTable.parentId, req.userId!)));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }
  if (match.status !== "shortlisted") { res.status(400).json({ error: "Can only dismiss candidates in shortlisted status" }); return; }

  // Soft-remove the candidate
  const [removed] = await db
    .update(shadowMatchCandidatesTable)
    .set({ removedAt: new Date(), removedByUserId: req.userId! })
    .where(
      and(
        eq(shadowMatchCandidatesTable.id, candidateId),
        eq(shadowMatchCandidatesTable.matchId, matchId),
        isNull(shadowMatchCandidatesTable.removedAt),
      ),
    )
    .returning();
  if (!removed) { res.status(404).json({ error: "Candidate not found or already dismissed" }); return; }

  // Count remaining active candidates
  const [activeRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(shadowMatchCandidatesTable)
    .where(and(eq(shadowMatchCandidatesTable.matchId, matchId), isNull(shadowMatchCandidatesTable.removedAt)));
  const activeCount = activeRow?.count ?? 0;

  // Auto-refill if an active slot is free: surface next-best teacher not already in this match (including removed)
  if (activeCount < 3) {
    const everShown = await db
      .select({ professionalId: shadowMatchCandidatesTable.professionalId })
      .from(shadowMatchCandidatesTable)
      .where(eq(shadowMatchCandidatesTable.matchId, matchId));
    const excludeIds = everShown.map((r) => r.professionalId);

    const allCandidates = await db
      .select()
      .from(professionalProfilesTable)
      .where(
        and(
          eq(professionalProfilesTable.specialty, "shadow_teacher"),
          eq(professionalProfilesTable.verificationStatus, "verified"),
          eq(professionalProfilesTable.paymentActivated, true),
          isNotNull(professionalProfilesTable.pricingMinINR),
          // Defense-in-depth: every candidate must have a government ID on file
          sql`EXISTS (SELECT 1 FROM ${identityVerificationsTable} iv WHERE iv.professional_id = ${professionalProfilesTable.id})`,
          excludeIds.length > 0
            ? sql`${professionalProfilesTable.id} != ALL(${sql.raw(`ARRAY[${excludeIds.join(",")}]::int[]`)})`
            : sql`true`,
        ),
      );

    // School-hours exclusion (Rule 1) on refill too
    const refillPassedIds = await filterBySchoolHours(allCandidates, match.childId ?? null);
    const refillPassedSet = new Set(refillPassedIds);
    const candidates = allCandidates.filter((p) => refillPassedSet.has(p.id));

    if (candidates.length > 0) {
      const settings = await getSettings();
      const tiers = parseTiers(settings.tiersJson);
      // KNOWN GAP: see the identical note on the main matching path above —
      // childLat/childLng are hardcoded null here too, so geo-scoring never
      // runs on refill either.
      const refillAvailabilityMap = await computeEffectiveAvailableFrom(
        candidates.map((p) => ({ id: p.id, earliestStartDate: p.earliestStartDate })),
      );
      const candidatesForScoring: ProfessionalForScoring[] = candidates.map((p) => ({
        ...p,
        effectiveAvailableFrom: refillAvailabilityMap.get(p.id) ?? p.earliestStartDate,
      }));
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

      const [maxRankRow] = await db
        .select({ maxRank: sql<number>`max(rank)` })
        .from(shadowMatchCandidatesTable)
        .where(eq(shadowMatchCandidatesTable.matchId, matchId));
      const nextRank = (maxRankRow?.maxRank ?? 0) + 1;

      const ranked = rankCandidates(snap, candidatesForScoring, tiers, 1);
      if (ranked.length > 0) {
        await db.insert(shadowMatchCandidatesTable).values({
          matchId,
          professionalId: ranked[0]!.professionalId,
          score: ranked[0]!.score,
          rank: nextRank,
          addedBy: "auto",
        });
        // Increment high-water-mark counter — never decrements
        await db
          .update(shadowTeacherMatchesTable)
          .set({ distinctTeachersShown: sql`${shadowTeacherMatchesTable.distinctTeachersShown} + 1`, updatedAt: new Date() })
          .where(eq(shadowTeacherMatchesTable.id, matchId));
      }
    }
  }

  res.json({ success: true, activeCount });
});

// ── POST /shadow-teacher/:matchId/refund — parent-initiated refund (3-condition server gate) ─
router.post("/shadow-teacher/:matchId/refund", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }

  const [match] = await db
    .select()
    .from(shadowTeacherMatchesTable)
    .where(and(eq(shadowTeacherMatchesTable.id, matchId), eq(shadowTeacherMatchesTable.parentId, req.userId!)));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }

  // ── Condition 1: must still be shortlisted (not committed, not already refunded/cancelled) ──
  if (match.status !== "shortlisted") {
    res.status(409).json({ error: "refund_not_eligible", reason: "already_committed_or_closed" });
    return;
  }

  // ── Condition 2: fewer than 3 distinct teachers were ever shown ──
  if (match.distinctTeachersShown >= 3) {
    res.status(409).json({ error: "refund_not_eligible", reason: "three_or_more_teachers_shown" });
    return;
  }

  // ── Condition 3: 60+ days since the matching fee was paid ──
  if (!match.feePaidAt) {
    res.status(409).json({ error: "refund_not_eligible", reason: "fee_payment_not_recorded" });
    return;
  }
  const daysSincePaid = (Date.now() - new Date(match.feePaidAt).getTime()) / 86_400_000;
  if (daysSincePaid < 60) {
    res.status(409).json({
      error: "refund_not_eligible",
      reason: "window_not_elapsed",
      daysRemaining: Math.ceil(60 - daysSincePaid),
    });
    return;
  }

  if (!match.providerPaymentId || match.matchingFeeInr <= 0) {
    res.status(409).json({ error: "refund_not_eligible", reason: "no_payment_to_refund" });
    return;
  }

  const razorpay = getRazorpay();
  if (!razorpay) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  // Attempt Razorpay refund — if it throws, do NOT update the DB (parent can retry)
  try {
    await (razorpay.payments as unknown as { refund: (id: string, opts: object) => Promise<unknown> })
      .refund(match.providerPaymentId, {
        amount: match.matchingFeeInr * 100,
        notes: { reason: "Parent-initiated refund: 60-day window, fewer than 3 teachers shown" },
      });
  } catch (err) {
    console.error("[refund] Razorpay refund call failed — DB NOT updated, status stays shortlisted:", err);
    res.status(500).json({ error: "Refund could not be processed. Please try again or contact support." });
    return;
  }

  // Razorpay confirmed — NOW persist the refunded state
  await db
    .update(shadowTeacherMatchesTable)
    .set({ status: "refunded", refundedAt: new Date(), updatedAt: new Date() })
    .where(eq(shadowTeacherMatchesTable.id, matchId));

  res.json({ refunded: true, amount: match.matchingFeeInr });
});

// ── GET /shadow-teacher/requests (admin) — list all requests with candidates ─
router.get("/shadow-teacher/requests", requireAuth, requireRole("admin"), async (_req: Request, res: Response): Promise<void> => {
  const rows = await db
    .select({
      id: shadowTeacherMatchesTable.id,
      parentId: shadowTeacherMatchesTable.parentId,
      parentName: usersTable.fullName,
      parentEmail: usersTable.email,
      matchedProfessionalId: shadowTeacherMatchesTable.matchedProfessionalId,
      matchedProName: professionalProfilesTable.fullName,
      status: shadowTeacherMatchesTable.status,
      matchingFeeInr: shadowTeacherMatchesTable.matchingFeeInr,
      childDetails: shadowTeacherMatchesTable.childDetails,
      requirements: shadowTeacherMatchesTable.requirements,
      childCity: shadowTeacherMatchesTable.childCity,
      childConditions: shadowTeacherMatchesTable.childConditions,
      childBudgetMinInr: shadowTeacherMatchesTable.childBudgetMinInr,
      childBudgetMaxInr: shadowTeacherMatchesTable.childBudgetMaxInr,
      extraNotes: shadowTeacherMatchesTable.extraNotes,
      adminNotes: shadowTeacherMatchesTable.adminNotes,
      matchedAt: shadowTeacherMatchesTable.matchedAt,
      createdAt: shadowTeacherMatchesTable.createdAt,
      trialFeePaidInr: shadowTeacherMatchesTable.trialFeePaidInr,
      trialProviderPaymentId: shadowTeacherMatchesTable.trialProviderPaymentId,
      trialCreditApplied: shadowTeacherEngagementsTable.trialCreditApplied,
      activationFeeEnabled: shadowTeacherMatchesTable.activationFeeEnabled,
    })
    .from(shadowTeacherMatchesTable)
    .leftJoin(usersTable, eq(shadowTeacherMatchesTable.parentId, usersTable.id))
    .leftJoin(professionalProfilesTable, eq(shadowTeacherMatchesTable.matchedProfessionalId, professionalProfilesTable.id))
    .leftJoin(shadowTeacherEngagementsTable, eq(shadowTeacherEngagementsTable.matchRequestId, shadowTeacherMatchesTable.id))
    .orderBy(desc(shadowTeacherMatchesTable.createdAt));

  // Stuck-engagement lazy-timeout resolution, piggybacked on this admin view
  // for wider coverage. Narrowed to non-terminal statuses only, since this
  // endpoint has no pagination and returns every match ever created.
  // Deliberately NOT re-fetching `rows` afterward (unlike the parent/
  // professional read paths above) — this is a lower-stakes admin
  // convenience view; a resolution that just happened here will show up on
  // the next load rather than this exact response. See stuckEngagementResolver.ts.
  const resolvableIds = rows
    .filter((r) => ["committed", "trial_pending", "trial_started"].includes(r.status))
    .map((r) => r.id);
  await Promise.all(resolvableIds.map((id) => resolveStuckShadowTeacherMatch(id)));

  // Attach candidates per request
  const matchIds = rows.map((r) => r.id);
  const allCandidates = matchIds.length
    ? await db
        .select({
          id: shadowMatchCandidatesTable.id,
          matchId: shadowMatchCandidatesTable.matchId,
          professionalId: shadowMatchCandidatesTable.professionalId,
          proName: professionalProfilesTable.fullName,
          score: shadowMatchCandidatesTable.score,
          rank: shadowMatchCandidatesTable.rank,
          addedBy: shadowMatchCandidatesTable.addedBy,
          removedAt: shadowMatchCandidatesTable.removedAt,
        })
        .from(shadowMatchCandidatesTable)
        .leftJoin(professionalProfilesTable, eq(shadowMatchCandidatesTable.professionalId, professionalProfilesTable.id))
        .where(sql`${shadowMatchCandidatesTable.matchId} = ANY(${sql.raw(`ARRAY[${matchIds.join(",")}]::int[]`)})`)
        .orderBy(shadowMatchCandidatesTable.rank)
    : [];

  const result = rows.map((r) => ({
    ...r,
    candidates: allCandidates.filter((c) => c.matchId === r.id),
  }));

  res.json(result);
});

// ── PATCH /shadow-teacher/:id/assign (admin) — manually assign a professional ─
router.patch("/shadow-teacher/:id/assign", requireAuth, requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { professionalId, adminNotes } = req.body as { professionalId?: number; adminNotes?: string };
  if (!professionalId) { res.status(400).json({ error: "professionalId required" }); return; }

  const [match] = await db.select().from(shadowTeacherMatchesTable).where(eq(shadowTeacherMatchesTable.id, id));
  if (!match) { res.status(404).json({ error: "Match request not found" }); return; }

  const [updated] = await db
    .update(shadowTeacherMatchesTable)
    .set({
      matchedProfessionalId: professionalId,
      status: "matched",
      matchedAt: new Date(),
      adminNotes: adminNotes ?? null,
      updatedAt: new Date(),
    })
    .where(eq(shadowTeacherMatchesTable.id, id))
    .returning();

  res.json(updated);
});

// ── PATCH /shadow-teacher/:id/cancel (admin) ─
router.patch("/shadow-teacher/:id/cancel", requireAuth, requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [match] = await db.select().from(shadowTeacherMatchesTable).where(eq(shadowTeacherMatchesTable.id, id));
  if (!match) { res.status(404).json({ error: "Match request not found" }); return; }

  const settings = await getSettings();
  const shouldRefund = match.status === "queued" && settings.matchingFeeRefundable;
  let refunded = false;

  if (shouldRefund && match.providerPaymentId && match.matchingFeeInr > 0) {
    try {
      const razorpay = getRazorpay();
      if (razorpay) {
        await (razorpay.payments as unknown as { refund: (id: string, opts: object) => Promise<void> })
          .refund(match.providerPaymentId, { amount: match.matchingFeeInr * 100, notes: { reason: "Match cancelled" } });
        refunded = true;
      }
    } catch { /* Refund failure doesn't block cancel */ }
  }

  const [updated] = await db
    .update(shadowTeacherMatchesTable)
    .set({ status: refunded ? "refunded" : "cancelled", cancelledAt: new Date(), refundedAt: refunded ? new Date() : null, updatedAt: new Date() })
    .where(eq(shadowTeacherMatchesTable.id, id))
    .returning();

  res.json({ ...updated, refundInitiated: refunded });
});

// ── POST /shadow-teacher/:id/candidates (admin add candidate) ─
router.post("/shadow-teacher/:id/candidates", requireAuth, requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["id"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }

  const { professionalId } = req.body as { professionalId?: number };
  if (!professionalId) { res.status(400).json({ error: "professionalId required" }); return; }

  const [match] = await db.select({ id: shadowTeacherMatchesTable.id }).from(shadowTeacherMatchesTable).where(eq(shadowTeacherMatchesTable.id, matchId));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }

  const [pro] = await db
    .select({ id: professionalProfilesTable.id, pricingMinINR: professionalProfilesTable.pricingMinINR })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, professionalId));
  if (!pro) { res.status(404).json({ error: "Professional not found" }); return; }
  if (pro.pricingMinINR == null) {
    res.status(409).json({
      error: "professional_no_pricing",
      message: "This professional has not set their monthly fee. Set pricingMinINR on their profile before adding them as a candidate.",
    });
    return;
  }

  // Get current max rank
  const existing = await db
    .select({ rank: shadowMatchCandidatesTable.rank })
    .from(shadowMatchCandidatesTable)
    .where(and(eq(shadowMatchCandidatesTable.matchId, matchId), isNull(shadowMatchCandidatesTable.removedAt)))
    .orderBy(desc(shadowMatchCandidatesTable.rank))
    .limit(1);
  const nextRank = (existing[0]?.rank ?? 0) + 1;

  const [candidate] = await db
    .insert(shadowMatchCandidatesTable)
    .values({ matchId, professionalId, rank: nextRank, addedBy: "admin" })
    .onConflictDoNothing()
    .returning();

  if (candidate) {
    // Increment high-water-mark counter for each newly surfaced teacher
    await db
      .update(shadowTeacherMatchesTable)
      .set({ distinctTeachersShown: sql`${shadowTeacherMatchesTable.distinctTeachersShown} + 1`, updatedAt: new Date() })
      .where(eq(shadowTeacherMatchesTable.id, matchId));
  }

  res.status(201).json(candidate);
});

// ── DELETE /shadow-teacher/:id/candidates/:candidateId (admin remove candidate) ─
router.delete("/shadow-teacher/:id/candidates/:candidateId", requireAuth, requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["id"] as string, 10);
  const candidateId = parseInt(req.params["candidateId"] as string, 10);
  if (isNaN(matchId) || isNaN(candidateId)) { res.status(400).json({ error: "Invalid params" }); return; }

  const [updated] = await db
    .update(shadowMatchCandidatesTable)
    .set({ removedAt: new Date(), removedByUserId: req.userId! })
    .where(
      and(
        eq(shadowMatchCandidatesTable.id, candidateId),
        eq(shadowMatchCandidatesTable.matchId, matchId),
        isNull(shadowMatchCandidatesTable.removedAt),
      ),
    )
    .returning();

  if (!updated) { res.status(404).json({ error: "Candidate not found or already removed" }); return; }
  res.json(updated);
});

export default router;
