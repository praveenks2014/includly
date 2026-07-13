import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, or, desc, isNull, isNotNull, sql, inArray, notInArray } from "drizzle-orm";
import Razorpay from "razorpay";
import crypto from "crypto";
import {
  db,
  tutorMatchesTable,
  tutorMatchCandidatesTable,
  usersTable,
  professionalProfilesTable,
  professionalOfferingsTable,
  childrenTable,
  adminSettingsTable,
  identityVerificationsTable,
  tutorEngagementsTable,
  tutorEngagementSessionsTable,
  tutorEngagementPaymentConfirmationsTable,
  tutorEngagementPlatformPaymentsTable,
  paymentsTable,
  connectThreadsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { z } from "zod/v4";
import { rankCandidates, type MatchSnapshot } from "../lib/shadowTeacherScoring";
import { createInAppNotification } from "../lib/notificationService";
import { generateOtp } from "../lib/otp";
import { isOfferingListable } from "../lib/verificationRequirements";
import { creditWallet } from "../lib/ledger";
import { resolveOffering } from "../lib/offeringResolver";
import { SHOW_TUTOR_SEARCH } from "../lib/features";

// Same lockout threshold as sessionsV2.ts's OTP pattern (not exported there,
// so re-declared here rather than importing a private constant).
const OTP_MAX_ATTEMPTS = 5;

const router: IRouter = Router();

// Server-side feature gate — applies to every route in this file. Returns
// 404 (not 403) when off, so nothing here is reachable even if a URL is
// guessed while the frontend is hidden. CROSS-REFERENCE: the frontend's own
// SHOW_TUTOR_SEARCH flag (artifacts/sensei-link/src/features.ts) does not
// share state with this one — both must be flipped together at launch.
// Also redundant with (not a replacement for) the earlier app.ts-level
// path check, which is the first of the two checkpoints to run.
router.use((_req, res, next) => {
  if (!SHOW_TUTOR_SEARCH) { res.status(404).json({ error: "Not found" }); return; }
  next();
});

const PARENT_PLATFORM_NOTICE =
  "Includly tracks attendance, mediates disputes, and helps you rebook if this doesn't work out — as long as the engagement stays on-platform.";
const PROFESSIONAL_PLATFORM_NOTICE =
  "Staying on-platform keeps you visible to Includly families and covered by our dispute mediation.";

async function getSettings() {
  const [s] = await db.select().from(adminSettingsTable).limit(1);
  return (
    s ?? {
      tutorMatchingFeeInr: 500,
      tutorTrialFeeInr: 300,
      tutorTrialFeeGoesToProfessional: false,
    }
  );
}

function getRazorpay(): Razorpay | null {
  const keyId = process.env["RAZORPAY_KEY_ID"];
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keyId || !keySecret) return null;
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

type TutorMatchRow = typeof tutorMatchesTable.$inferSelect;
type TutorCandidateRow = typeof tutorMatchCandidatesTable.$inferSelect;

async function resolveAccess(
  matchId: number,
  candidateId: number,
  userId: number,
  userRole: string,
): Promise<{ match: TutorMatchRow; candidate: TutorCandidateRow; myRole: "parent" | "professional" } | null> {
  const [match] = await db.select().from(tutorMatchesTable).where(eq(tutorMatchesTable.id, matchId)).limit(1);
  if (!match) return null;
  const [candidate] = await db
    .select()
    .from(tutorMatchCandidatesTable)
    .where(and(eq(tutorMatchCandidatesTable.id, candidateId), eq(tutorMatchCandidatesTable.matchId, matchId), isNull(tutorMatchCandidatesTable.removedAt)))
    .limit(1);
  if (!candidate) return null;
  if (match.parentId === userId) return { match, candidate, myRole: "parent" };
  if (userRole === "professional") {
    const [pro] = await db.select({ id: professionalProfilesTable.id }).from(professionalProfilesTable).where(eq(professionalProfilesTable.userId, userId)).limit(1);
    if (pro?.id === candidate.professionalId) return { match, candidate, myRole: "professional" };
  }
  if (userRole === "admin") return { match, candidate, myRole: "parent" };
  return null;
}

async function getProfessionalUserId(professionalId: number): Promise<number | null> {
  const [row] = await db.select({ userId: professionalProfilesTable.userId }).from(professionalProfilesTable).where(eq(professionalProfilesTable.id, professionalId)).limit(1);
  return row?.userId ?? null;
}

/**
 * Candidate surfacing — mirrors shadow-teacher's surfaceCandidatesForMatch
 * structurally. CROSS-REFERENCE: the listability rule here (primary-row OR
 * offering-row, both verificationStatus='verified') is the SAME rule as
 * isOfferingListable() (verificationRequirements.ts) — duplicated here only
 * because this is a bulk SQL JOIN across many professionals at once, which
 * can't call a per-professional function without an N+1 problem. If what
 * makes an offering listable ever changes, both places need updating.
 */
async function surfaceCandidatesForTutorMatch(match: TutorMatchRow): Promise<number> {
  const busyRows = await db
    .select({ professionalId: tutorMatchesTable.selectedProfessionalId })
    .from(tutorMatchesTable)
    .where(and(isNotNull(tutorMatchesTable.selectedProfessionalId), inArray(tutorMatchesTable.status, ["pending_commitment", "trial_pending", "trial_started", "trial_done"])));
  const busyProfIds = [...new Set(busyRows.map((r: { professionalId: number | null }) => r.professionalId!))] as number[];

  const settings = await getSettings();
  const tutorListingFeeEnabled = (settings as Record<string, unknown>)["tutorListingFeeEnabled"] as boolean | undefined;

  const rows = await db
    .select({ profile: professionalProfilesTable, offering: professionalOfferingsTable })
    .from(professionalProfilesTable)
    .leftJoin(
      professionalOfferingsTable,
      and(eq(professionalOfferingsTable.professionalId, professionalProfilesTable.id), eq(professionalOfferingsTable.vertical, "home_tutor")),
    )
    .where(
      and(
        or(
          and(
            eq(professionalProfilesTable.vertical, "home_tutor"),
            eq(professionalProfilesTable.verificationStatus, "verified"),
            isNotNull(professionalProfilesTable.pricingMinINR),
            ...(tutorListingFeeEnabled ? [isNotNull(professionalProfilesTable.listingFeePaidAt)] : []),
          ),
          and(
            isNotNull(professionalOfferingsTable.id),
            eq(professionalOfferingsTable.verificationStatus, "verified"),
            isNotNull(professionalOfferingsTable.pricingMinINR),
            ...(tutorListingFeeEnabled ? [isNotNull(professionalOfferingsTable.listingFeePaidAt)] : []),
          ),
        )!,
        eq(professionalProfilesTable.paymentActivated, true),
        sql`EXISTS (SELECT 1 FROM ${identityVerificationsTable} iv WHERE iv.professional_id = ${professionalProfilesTable.id})`,
        ...(busyProfIds.length > 0 ? [notInArray(professionalProfilesTable.id, busyProfIds)] : []),
      ),
    );

  const allProfessionals = rows.map(
    ({ profile, offering }: { profile: typeof professionalProfilesTable.$inferSelect; offering: typeof professionalOfferingsTable.$inferSelect | null }) => {
      const isPrimaryMatch = profile.vertical === "home_tutor" && profile.verificationStatus === "verified" && profile.pricingMinINR != null;
      if (isPrimaryMatch || !offering) return profile;
      return { ...profile, pricingMinINR: offering.pricingMinINR, pricingMaxINR: offering.pricingMaxINR, verificationStatus: offering.verificationStatus };
    },
  );

  // No languages/lat-lng captured in tutor intake — scorer treats these as
  // neutral (0 pts either way), not a bug, just no signal to score on yet.
  const snap: MatchSnapshot = {
    childCity: match.locationArea ?? null,
    childLat: null,
    childLng: null,
    childLanguages: null,
    childBudgetMinInr: match.budgetMinInr ?? null,
    childBudgetMaxInr: match.budgetMaxInr ?? null,
    childPreferredModes: match.mode ?? null,
  };

  const ranked = rankCandidates(snap, allProfessionals, [], 3);
  let candidateCount = 0;

  if (ranked.length > 0) {
    await db.insert(tutorMatchCandidatesTable).values(
      ranked.map((c, i) => ({ matchId: match.id, professionalId: c.professionalId, score: c.score, rank: i + 1, addedBy: "auto" })),
    );
    candidateCount = ranked.length;

    const shortlistedUserIds: number[] = allProfessionals
      .filter((p: { id: number }) => ranked.some((r) => r.professionalId === p.id))
      .map((p: { userId: number }) => p.userId);
    void Promise.allSettled(
      shortlistedUserIds.map((uid: number) =>
        createInAppNotification(uid, {
          type: "tutor_request_shortlisted",
          title: "You've been shortlisted for a tutor request",
          body: "A parent is looking for a tutor and you've been shortlisted. Log in to view details.",
          relatedType: "match",
          relatedId: match.id,
        }).catch(() => {}),
      ),
    );
  }

  return candidateCount;
}

// ── POST /tutor/request ──────────────────────────────────────────────────
const NewTutorRequestBody = z.object({
  childId: z.number().int().positive(),
  childAge: z.number().int().min(0).max(25).optional(),
  subjects: z.array(z.string()).optional(),
  board: z.string().optional(),
  mode: z.array(z.string()).optional(),
  hasDiagnosedLearningDifference: z.boolean().optional(),
  frequencyPerWeek: z.number().int().min(1).max(14).optional(),
  budgetMinInr: z.number().int().min(0).optional(),
  budgetMaxInr: z.number().int().min(0).optional(),
  locationArea: z.string().optional(),
  extraNotes: z.string().max(1000).optional(),
});

// ── GET /tutor/pricing — public: matching/trial/placement fees for the intake screen ─
// Direct mirror of shadow-teacher's GET /shadow-teacher/pricing.
router.get("/tutor/pricing", async (_req: Request, res: Response): Promise<void> => {
  const settings = await getSettings();
  const s = settings as Record<string, unknown>;
  res.json({
    matchingFeeInr: settings.tutorMatchingFeeInr,
    trialFeeInr: (s["tutorTrialFeeInr"] as number) ?? 300,
    placementFeeInr: (s["tutorPlacementFeeInr"] as number) ?? 1500,
  });
});

router.post("/tutor/request", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const parsed = NewTutorRequestBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { childId, ...intake } = parsed.data;

  const [child] = await db.select().from(childrenTable).where(and(eq(childrenTable.id, childId), eq(childrenTable.parentId, req.userId!)));
  if (!child) { res.status(404).json({ error: "Child not found or does not belong to you" }); return; }

  const existing = await db
    .select()
    .from(tutorMatchesTable)
    .where(and(eq(tutorMatchesTable.parentId, req.userId!), eq(tutorMatchesTable.childId, childId)))
    .orderBy(desc(tutorMatchesTable.createdAt))
    .limit(1);

  if (existing[0] && !["cancelled", "refunded", "committed"].includes(existing[0].status)) {
    if (existing[0].status === "pending_payment" && existing[0].providerOrderId && existing[0].matchingFeeInr > 0) {
      res.status(409).json({
        error: "You already have an active tutor request",
        matchId: existing[0].id,
        providerOrderId: existing[0].providerOrderId,
        amount: existing[0].matchingFeeInr * 100,
        keyId: process.env["RAZORPAY_KEY_ID"]!,
      });
      return;
    }
    res.status(409).json({ error: "You already have an active tutor request", matchId: existing[0].id });
    return;
  }

  const settings = await getSettings();
  const razorpay = getRazorpay();
  if (!razorpay) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  const matchingFeeInr = settings.tutorMatchingFeeInr;
  const amount = matchingFeeInr * 100;
  const order = await razorpay.orders.create({ amount, currency: "INR", receipt: `tutreq_${Date.now()}`, notes: { childId: String(childId) } });

  const [match] = await db
    .insert(tutorMatchesTable)
    .values({
      parentId: req.userId!,
      status: "pending_payment",
      matchingFeeInr,
      childId: child.id,
      childAge: intake.childAge ?? null,
      subjects: intake.subjects ?? null,
      board: intake.board ?? null,
      mode: intake.mode ?? null,
      hasDiagnosedLearningDifference: intake.hasDiagnosedLearningDifference ?? null,
      frequencyPerWeek: intake.frequencyPerWeek ?? null,
      budgetMinInr: intake.budgetMinInr ?? null,
      budgetMaxInr: intake.budgetMaxInr ?? null,
      locationArea: intake.locationArea ?? null,
      extraNotes: intake.extraNotes ?? null,
      providerOrderId: order.id as string,
    })
    .returning();

  res.status(201).json({ matchId: match.id, orderId: order.id, amount, keyId: process.env["RAZORPAY_KEY_ID"]! });
});

// ── PATCH /tutor/:matchId — progressive intake fields ─────────────────────
// Small, additive — no new schema. These columns already existed and were
// already optional on the original /tutor/request body; this just exposes
// a standalone update path for fields captured after the upfront 4-5-field
// form + payment, per the intake-conversion research (B6). No re-scoring or
// re-surfacing is triggered — candidates are only ever surfaced once, at
// verify-request-payment, before any progressive field could exist, so
// these fields are for context/display during interview and later
// engagement, not a matching signal.
const UpdateTutorIntakeBody = z.object({
  hasDiagnosedLearningDifference: z.boolean().optional(),
  frequencyPerWeek: z.number().int().min(1).max(14).optional(),
  budgetMinInr: z.number().int().min(0).optional(),
  budgetMaxInr: z.number().int().min(0).optional(),
});

router.patch("/tutor/:matchId", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }
  const parsed = UpdateTutorIntakeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  if (Object.keys(parsed.data).length === 0) { res.status(400).json({ error: "No fields provided" }); return; }

  const [match] = await db.select().from(tutorMatchesTable).where(and(eq(tutorMatchesTable.id, matchId), eq(tutorMatchesTable.parentId, req.userId!)));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }
  if (["cancelled", "refunded"].includes(match.status)) { res.status(409).json({ error: "This request is no longer active" }); return; }

  const [updated] = await db.update(tutorMatchesTable).set({ ...parsed.data, updatedAt: new Date() }).where(eq(tutorMatchesTable.id, matchId)).returning();
  if (!updated) {
    console.error(`[tutor/update-intake] returning() came back empty for matchId=${matchId}`);
    res.status(500).json({ error: "update_failed" });
    return;
  }
  res.json(updated);
});

// ── POST /tutor/:matchId/verify-request-payment ──────────────────────────
const VerifyRequestPaymentBody = z.object({ razorpayOrderId: z.string(), razorpayPaymentId: z.string(), razorpaySignature: z.string() });

router.post("/tutor/:matchId/verify-request-payment", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }
  const parsed = VerifyRequestPaymentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keySecret) { res.status(503).json({ error: "Payment gateway not configured" }); return; }
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = parsed.data;

  const [match] = await db.select().from(tutorMatchesTable).where(and(eq(tutorMatchesTable.id, matchId), eq(tutorMatchesTable.parentId, req.userId!)));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }
  if (match.status !== "pending_payment") { res.status(400).json({ error: "Match is not awaiting payment" }); return; }
  if (match.providerOrderId !== razorpayOrderId) { res.status(400).json({ error: "Order ID mismatch" }); return; }

  const expectedSig = crypto.createHmac("sha256", keySecret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest("hex");
  if (expectedSig !== razorpaySignature) { res.status(400).json({ error: "Payment signature verification failed" }); return; }

  await db
    .update(tutorMatchesTable)
    .set({ status: "shortlisted", providerPaymentId: razorpayPaymentId, matchingFeePaidInr: match.matchingFeeInr, feePaidAt: new Date(), updatedAt: new Date() })
    .where(eq(tutorMatchesTable.id, matchId));

  const candidateCount = await surfaceCandidatesForTutorMatch(match);
  res.json({ matchId: match.id, candidateCount });
});

// ── GET /tutor/my-request ─────────────────────────────────────────────────
router.get("/tutor/my-request", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const childIdParam = req.query["childId"];
  const childId = childIdParam ? parseInt(String(childIdParam), 10) : null;
  const whereClause =
    childId && !isNaN(childId)
      ? and(eq(tutorMatchesTable.parentId, req.userId!), eq(tutorMatchesTable.childId, childId))
      : eq(tutorMatchesTable.parentId, req.userId!);

  const matches = await db.select().from(tutorMatchesTable).where(whereClause).orderBy(desc(tutorMatchesTable.createdAt)).limit(1);
  if (!matches.length) { res.json([]); return; }
  const match = matches[0]!;

  const candidateRows = await db
    .select()
    .from(tutorMatchCandidatesTable)
    .where(and(eq(tutorMatchCandidatesTable.matchId, match.id), isNull(tutorMatchCandidatesTable.removedAt)))
    .orderBy(tutorMatchCandidatesTable.rank);

  const proIds: number[] = candidateRows.map((c: TutorCandidateRow) => c.professionalId);
  const profProfiles = proIds.length ? await db.select().from(professionalProfilesTable).where(inArray(professionalProfilesTable.id, proIds)) : [];
  const profById = new Map<number, typeof professionalProfilesTable.$inferSelect>(
    profProfiles.map((p: typeof professionalProfilesTable.$inferSelect): [number, typeof professionalProfilesTable.$inferSelect] => [p.id, p]),
  );

  const candidates = candidateRows
    .map((c: TutorCandidateRow) => {
      const p = profById.get(c.professionalId);
      if (!p) return null;
      return {
        id: c.id,
        professionalId: c.professionalId,
        rank: c.rank,
        score: c.score,
        requestStatus: c.requestStatus,
        rejectionNote: c.rejectionNote,
        interviewSlotsJson: c.interviewSlotsJson,
        interviewConfirmedSlot: c.interviewConfirmedSlot,
        meetLink: c.meetLink,
        interviewDoneAt: c.interviewDoneAt,
        trialDaysRequested: c.trialDaysRequested,
        trialDaysAccepted: c.trialDaysAccepted,
        profile: {
          id: p.id,
          fullName: p.fullName,
          bio: p.bio,
          yearsExperience: p.yearsExperience,
          city: p.city,
          displayArea: p.displayArea,
          verificationStatus: p.verificationStatus,
          averageRating: p.averageRating,
          pricingMinINR: p.pricingMinINR,
          pricingMaxINR: p.pricingMaxINR,
          languages: p.languages,
          offersHomeVisits: p.offersHomeVisits,
        },
      };
    })
    .filter(Boolean);

  res.json({ ...match, candidates });
});

// ── GET /tutor/my-candidacies ──────────────────────────────────────────────
router.get("/tutor/my-candidacies", requireAuth, requireRole("professional"), async (req: Request, res: Response): Promise<void> => {
  const [pro] = await db.select({ id: professionalProfilesTable.id }).from(professionalProfilesTable).where(eq(professionalProfilesTable.userId, req.userId!));
  if (!pro) { res.status(404).json({ error: "Professional profile not found" }); return; }

  const candidates = await db
    .select({
      candidateId: tutorMatchCandidatesTable.id,
      matchId: tutorMatchCandidatesTable.matchId,
      createdAt: tutorMatchCandidatesTable.createdAt,
      matchStatus: tutorMatchesTable.status,
      selectedProfessionalId: tutorMatchesTable.selectedProfessionalId,
      childAge: tutorMatchesTable.childAge,
      subjects: tutorMatchesTable.subjects,
      board: tutorMatchesTable.board,
      mode: tutorMatchesTable.mode,
      frequencyPerWeek: tutorMatchesTable.frequencyPerWeek,
      budgetMinInr: tutorMatchesTable.budgetMinInr,
      budgetMaxInr: tutorMatchesTable.budgetMaxInr,
      locationArea: tutorMatchesTable.locationArea,
      requestStatus: tutorMatchCandidatesTable.requestStatus,
      rejectionNote: tutorMatchCandidatesTable.rejectionNote,
      interviewSlotsJson: tutorMatchCandidatesTable.interviewSlotsJson,
      interviewConfirmedSlot: tutorMatchCandidatesTable.interviewConfirmedSlot,
      meetLink: tutorMatchCandidatesTable.meetLink,
      interviewDoneAt: tutorMatchCandidatesTable.interviewDoneAt,
      trialDaysRequested: tutorMatchCandidatesTable.trialDaysRequested,
      trialDaysAccepted: tutorMatchCandidatesTable.trialDaysAccepted,
    })
    .from(tutorMatchCandidatesTable)
    .innerJoin(tutorMatchesTable, eq(tutorMatchCandidatesTable.matchId, tutorMatchesTable.id))
    .where(and(eq(tutorMatchCandidatesTable.professionalId, pro.id), isNull(tutorMatchCandidatesTable.removedAt)))
    .orderBy(desc(tutorMatchCandidatesTable.createdAt));

  res.json(candidates);
});

// ── POST /tutor/:matchId/candidates/:candidateId/send-request ────────────
router.post("/tutor/:matchId/candidates/:candidateId/send-request", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  const candidateId = parseInt(req.params["candidateId"] as string, 10);
  if (isNaN(matchId) || isNaN(candidateId)) { res.status(400).json({ error: "Invalid params" }); return; }
  const ctx = await resolveAccess(matchId, candidateId, req.userId!, req.userRole!);
  if (!ctx) { res.status(403).json({ error: "Access denied or not found" }); return; }
  if (ctx.myRole !== "parent") { res.status(403).json({ error: "Only the parent can send a request" }); return; }
  if (ctx.match.status !== "shortlisted") { res.status(409).json({ error: "Requests can only be sent while the match is shortlisted" }); return; }
  if (ctx.candidate.requestStatus !== "not_sent") { res.status(409).json({ error: "Request has already been sent for this candidate" }); return; }

  // Defense-in-depth: re-check listability even though this candidate was
  // already surfaced — an admin could have revoked verification since. Same
  // isOfferingListable() call used everywhere else, not reimplemented.
  const listable = await isOfferingListable(ctx.candidate.professionalId, "home_tutor");
  if (!listable) { res.status(409).json({ error: "This professional is no longer listable" }); return; }

  const [updated] = await db.update(tutorMatchCandidatesTable).set({ requestStatus: "sent" }).where(eq(tutorMatchCandidatesTable.id, candidateId)).returning();

  // Defensive — WHERE clause already validated to match via resolveAccess()
  // above, so an empty returning() here should never happen. Fail loudly
  // instead of silently spreading `undefined` into the response, which
  // would otherwise produce a "successful" 201 missing every real field.
  if (!updated) {
    console.error(`[tutor/send-request] returning() came back empty for candidateId=${candidateId}, matchId=${matchId}`);
    res.status(500).json({ error: "Request update did not return a row — the update may not have applied. Please retry or contact support." });
    return;
  }

  const proUserId = await getProfessionalUserId(ctx.candidate.professionalId);
  if (proUserId) {
    void createInAppNotification(proUserId, {
      type: "tutor_request_received",
      title: "A parent has sent you a request",
      body: "Log in to accept or decline this parent's request.",
      relatedType: "match",
      relatedId: matchId,
    }).catch(() => {});
  }

  res.status(201).json({ ...updated, platformNotice: PARENT_PLATFORM_NOTICE });
});

// ── POST /tutor/:matchId/candidates/:candidateId/respond-request ─────────
const RespondRequestBody = z.object({ action: z.enum(["accept", "reject"]), note: z.string().max(500).optional() });

router.post("/tutor/:matchId/candidates/:candidateId/respond-request", requireAuth, requireRole("professional"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  const candidateId = parseInt(req.params["candidateId"] as string, 10);
  if (isNaN(matchId) || isNaN(candidateId)) { res.status(400).json({ error: "Invalid params" }); return; }
  const parsed = RespondRequestBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const ctx = await resolveAccess(matchId, candidateId, req.userId!, req.userRole!);
  if (!ctx) { res.status(403).json({ error: "Access denied or not found" }); return; }
  if (ctx.myRole !== "professional") { res.status(403).json({ error: "Only the invited professional can respond" }); return; }
  if (ctx.candidate.requestStatus !== "sent") { res.status(409).json({ error: "No pending request to respond to" }); return; }

  const newStatus = parsed.data.action === "accept" ? "accepted" : "rejected";
  const [updated] = await db
    .update(tutorMatchCandidatesTable)
    .set({ requestStatus: newStatus, rejectionNote: parsed.data.action === "reject" ? (parsed.data.note ?? null) : null })
    .where(eq(tutorMatchCandidatesTable.id, candidateId))
    .returning();

  // Defensive — same rationale as send-request above.
  if (!updated) {
    console.error(`[tutor/respond-request] returning() came back empty for candidateId=${candidateId}, matchId=${matchId}, action=${parsed.data.action}`);
    res.status(500).json({ error: "Request update did not return a row — the update may not have applied. Please retry or contact support." });
    return;
  }

  void createInAppNotification(ctx.match.parentId, {
    type: parsed.data.action === "accept" ? "tutor_request_accepted" : "tutor_request_rejected",
    title: parsed.data.action === "accept" ? "A candidate accepted your request" : "A candidate declined your request",
    body: parsed.data.action === "accept" ? "Open the app to schedule an interview." : "Open the app to try another candidate.",
    relatedType: "match",
    relatedId: matchId,
  }).catch(() => {});

  res.status(200).json({ ...updated, ...(parsed.data.action === "accept" ? { platformNotice: PROFESSIONAL_PLATFORM_NOTICE } : {}) });
});

// ── POST /tutor/:matchId/candidates/:candidateId/propose-interview ───────
const ProposeInterviewBody = z.object({
  slots: z.array(z.object({ date: z.string().min(1), time: z.string().min(1), label: z.string().max(100).optional() })).min(1).max(3),
});

router.post("/tutor/:matchId/candidates/:candidateId/propose-interview", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  const candidateId = parseInt(req.params["candidateId"] as string, 10);
  if (isNaN(matchId) || isNaN(candidateId)) { res.status(400).json({ error: "Invalid params" }); return; }
  const parsed = ProposeInterviewBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const ctx = await resolveAccess(matchId, candidateId, req.userId!, req.userRole!);
  if (!ctx) { res.status(403).json({ error: "Access denied or not found" }); return; }
  if (ctx.myRole !== "parent") { res.status(403).json({ error: "Only the parent can propose interview slots" }); return; }
  if (ctx.candidate.requestStatus !== "accepted") { res.status(409).json({ error: "The professional has not accepted your request yet" }); return; }
  if (ctx.candidate.interviewConfirmedSlot) { res.status(409).json({ error: "Interview has already been confirmed" }); return; }

  const [updated] = await db
    .update(tutorMatchCandidatesTable)
    .set({ interviewSlotsJson: JSON.stringify(parsed.data.slots) })
    .where(eq(tutorMatchCandidatesTable.id, candidateId))
    .returning();
  if (!updated) {
    console.error(`[tutor/propose-interview] returning() came back empty for candidateId=${candidateId}, matchId=${matchId}`);
    res.status(500).json({ error: "update_failed" });
    return;
  }

  const proUserId = await getProfessionalUserId(ctx.candidate.professionalId);
  if (proUserId) {
    void createInAppNotification(proUserId, {
      type: "interview_proposed",
      title: "Parent proposed interview slots",
      body: `Pick one of ${parsed.data.slots.length} slot(s) to confirm the interview.`,
      relatedType: "match",
      relatedId: matchId,
    }).catch(() => {});
  }
  res.status(200).json(updated);
});

// ── POST /tutor/:matchId/candidates/:candidateId/confirm-interview ───────
const ConfirmInterviewBody = z.object({ confirmedSlot: z.string().min(1) });

router.post("/tutor/:matchId/candidates/:candidateId/confirm-interview", requireAuth, requireRole("professional"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  const candidateId = parseInt(req.params["candidateId"] as string, 10);
  if (isNaN(matchId) || isNaN(candidateId)) { res.status(400).json({ error: "Invalid params" }); return; }
  const parsed = ConfirmInterviewBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const ctx = await resolveAccess(matchId, candidateId, req.userId!, req.userRole!);
  if (!ctx) { res.status(403).json({ error: "Access denied or not found" }); return; }
  if (ctx.myRole !== "professional") { res.status(403).json({ error: "Only the invited professional can confirm the interview" }); return; }
  if (!ctx.candidate.interviewSlotsJson) { res.status(409).json({ error: "No interview slots have been proposed yet" }); return; }
  if (ctx.candidate.interviewConfirmedSlot) { res.status(409).json({ error: "Interview has already been confirmed" }); return; }

  let proposedSlots: Array<{ date: string; time: string; label?: string }> = [];
  try {
    proposedSlots = JSON.parse(ctx.candidate.interviewSlotsJson) as Array<{ date: string; time: string; label?: string }>;
  } catch {
    res.status(500).json({ error: "Stored interview slots are malformed" });
    return;
  }
  const slotMatches = proposedSlots.some(
    (s) => parsed.data.confirmedSlot === `${s.date}T${s.time}` || parsed.data.confirmedSlot === `${s.date} ${s.time}` || (s.label !== undefined && parsed.data.confirmedSlot === s.label),
  );
  if (!slotMatches) { res.status(400).json({ error: "confirmedSlot must be one of the proposed slots" }); return; }

  const meetLink = `https://meet.jit.si/includly-${matchId}-${candidateId}`;
  const [updated] = await db
    .update(tutorMatchCandidatesTable)
    .set({ interviewConfirmedSlot: parsed.data.confirmedSlot, meetLink })
    .where(eq(tutorMatchCandidatesTable.id, candidateId))
    .returning();
  if (!updated) {
    console.error(`[tutor/confirm-interview] returning() came back empty for candidateId=${candidateId}, matchId=${matchId}`);
    res.status(500).json({ error: "update_failed" });
    return;
  }

  void createInAppNotification(ctx.match.parentId, {
    type: "interview_confirmed",
    title: "Interview confirmed",
    body: `Join link: ${meetLink}`,
    relatedType: "match",
    relatedId: matchId,
  }).catch(() => {});
  res.status(200).json(updated);
});

// ── POST /tutor/:matchId/candidates/:candidateId/mark-interview-done ─────
router.post("/tutor/:matchId/candidates/:candidateId/mark-interview-done", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  const candidateId = parseInt(req.params["candidateId"] as string, 10);
  if (isNaN(matchId) || isNaN(candidateId)) { res.status(400).json({ error: "Invalid params" }); return; }
  const ctx = await resolveAccess(matchId, candidateId, req.userId!, req.userRole!);
  if (!ctx) { res.status(403).json({ error: "Access denied or not found" }); return; }
  if (ctx.myRole !== "parent") { res.status(403).json({ error: "Only the parent can mark the interview as done" }); return; }
  if (!ctx.candidate.meetLink) { res.status(409).json({ error: "No confirmed interview to mark as done" }); return; }
  if (ctx.candidate.interviewDoneAt) { res.status(409).json({ error: "Interview is already marked as done" }); return; }

  const [updated] = await db.update(tutorMatchCandidatesTable).set({ interviewDoneAt: new Date() }).where(eq(tutorMatchCandidatesTable.id, candidateId)).returning();
  if (!updated) {
    console.error(`[tutor/mark-interview-done] returning() came back empty for candidateId=${candidateId}, matchId=${matchId}`);
    res.status(500).json({ error: "update_failed" });
    return;
  }

  const proUserId = await getProfessionalUserId(ctx.candidate.professionalId);
  if (proUserId) {
    void createInAppNotification(proUserId, {
      type: "interview_done",
      title: "Interview marked complete",
      body: "Parent marked the interview as complete. You can now discuss a trial.",
      relatedType: "match",
      relatedId: matchId,
    }).catch(() => {});
  }
  res.status(200).json(updated);
});

// ── POST /tutor/:matchId/candidates/:candidateId/request-trial ───────────
// No negotiation precondition — rate is display-and-accept from the offering.
const RequestTrialBody = z.object({ trialDays: z.number().int().min(1).max(3) });

router.post("/tutor/:matchId/candidates/:candidateId/request-trial", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  const candidateId = parseInt(req.params["candidateId"] as string, 10);
  if (isNaN(matchId) || isNaN(candidateId)) { res.status(400).json({ error: "Invalid params" }); return; }
  const parsed = RequestTrialBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const ctx = await resolveAccess(matchId, candidateId, req.userId!, req.userRole!);
  if (!ctx) { res.status(403).json({ error: "Access denied or not found" }); return; }
  if (ctx.myRole !== "parent") { res.status(403).json({ error: "Only the parent can request a trial" }); return; }
  if (!ctx.candidate.interviewDoneAt) { res.status(409).json({ error: "Interview must be marked done before requesting a trial" }); return; }
  if (ctx.candidate.trialDaysAccepted != null) { res.status(409).json({ error: "Trial has already been accepted for this candidate" }); return; }

  const [updated] = await db.update(tutorMatchCandidatesTable).set({ trialDaysRequested: parsed.data.trialDays }).where(eq(tutorMatchCandidatesTable.id, candidateId)).returning();
  if (!updated) {
    console.error(`[tutor/request-trial] returning() came back empty for candidateId=${candidateId}, matchId=${matchId}`);
    res.status(500).json({ error: "update_failed" });
    return;
  }

  const proUserId = await getProfessionalUserId(ctx.candidate.professionalId);
  if (proUserId) {
    void createInAppNotification(proUserId, {
      type: "trial_requested",
      title: `Parent requested a ${parsed.data.trialDays}-day trial`,
      body: "Accept the same number of days or counter with fewer.",
      relatedType: "match",
      relatedId: matchId,
    }).catch(() => {});
  }
  res.status(200).json(updated);
});

// ── POST /tutor/:matchId/candidates/:candidateId/accept-trial ────────────
const AcceptTrialBody = z.object({ trialDays: z.number().int().min(1) });

router.post("/tutor/:matchId/candidates/:candidateId/accept-trial", requireAuth, requireRole("professional"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  const candidateId = parseInt(req.params["candidateId"] as string, 10);
  if (isNaN(matchId) || isNaN(candidateId)) { res.status(400).json({ error: "Invalid params" }); return; }
  const parsed = AcceptTrialBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const ctx = await resolveAccess(matchId, candidateId, req.userId!, req.userRole!);
  if (!ctx) { res.status(403).json({ error: "Access denied or not found" }); return; }
  if (ctx.myRole !== "professional") { res.status(403).json({ error: "Only the invited professional can accept a trial" }); return; }
  if (ctx.candidate.trialDaysRequested == null) { res.status(409).json({ error: "No trial has been requested yet" }); return; }
  if (parsed.data.trialDays > ctx.candidate.trialDaysRequested) { res.status(400).json({ error: "Accepted days cannot exceed requested days" }); return; }

  const [updated] = await db.update(tutorMatchCandidatesTable).set({ trialDaysAccepted: parsed.data.trialDays }).where(eq(tutorMatchCandidatesTable.id, candidateId)).returning();
  if (!updated) {
    console.error(`[tutor/accept-trial] returning() came back empty for candidateId=${candidateId}, matchId=${matchId}`);
    res.status(500).json({ error: "update_failed" });
    return;
  }
  await db.update(tutorMatchesTable).set({ trialDays: parsed.data.trialDays, updatedAt: new Date() }).where(eq(tutorMatchesTable.id, matchId));

  void createInAppNotification(ctx.match.parentId, {
    type: "trial_accepted",
    title: "Trial accepted",
    body: `Your tutor accepted a ${parsed.data.trialDays}-day trial. Proceed to payment.`,
    relatedType: "match",
    relatedId: matchId,
  }).catch(() => {});
  res.status(200).json(updated);
});

// ── POST /tutor/:matchId/request-trial-payment — toggle-branched ─────────
const RequestTrialPaymentBody = z.object({ selectedProfessionalId: z.number().int().positive() });

router.post("/tutor/:matchId/request-trial-payment", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }
  const parsed = RequestTrialPaymentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { selectedProfessionalId } = parsed.data;

  const [match] = await db.select().from(tutorMatchesTable).where(and(eq(tutorMatchesTable.id, matchId), eq(tutorMatchesTable.parentId, req.userId!)));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }
  if (match.status !== "shortlisted") { res.status(400).json({ error: "Trial payment can only be requested from shortlisted status" }); return; }

  const [candidate] = await db
    .select()
    .from(tutorMatchCandidatesTable)
    .where(and(eq(tutorMatchCandidatesTable.matchId, matchId), eq(tutorMatchCandidatesTable.professionalId, selectedProfessionalId), isNull(tutorMatchCandidatesTable.removedAt)));
  if (!candidate) { res.status(404).json({ error: "Selected professional is not an active candidate for this match" }); return; }

  const settings = await getSettings();
  const baseTrialFeeInr = settings.tutorTrialFeeInr;
  const trialFeeInr = baseTrialFeeInr * (match.trialDays ?? 1);

  // Trial-fee destination is snapshotted at request time, not read live at
  // every step — flipping this setting later never changes an in-flight
  // trial's payment mode. When true, trial-fee collection moves to
  // direct-pay for compliance reasons — same reasoning as shadow-teacher's
  // platformSalaryEnabled/trialDirectPayEnabled design: the platform must
  // never collect money that belongs to the professional.
  const goesToProfessional = settings.tutorTrialFeeGoesToProfessional ?? false;
  await db.update(tutorMatchesTable).set({ trialDirectPay: goesToProfessional, updatedAt: new Date() }).where(eq(tutorMatchesTable.id, matchId));

  if (goesToProfessional) {
    const [proPay] = await db
      .select({ upiVpa: professionalProfilesTable.upiVpa, upiVerifiedAt: professionalProfilesTable.upiVerifiedAt, userId: professionalProfilesTable.userId, name: usersTable.fullName })
      .from(professionalProfilesTable)
      .innerJoin(usersTable, eq(usersTable.id, professionalProfilesTable.userId))
      .where(eq(professionalProfilesTable.id, selectedProfessionalId));

    const isFirstDirectPayRequest = !match.trialDirectPayMarkedPaidAt;
    if (!proPay?.upiVpa || !proPay.upiVerifiedAt) {
      if (isFirstDirectPayRequest && proPay?.userId) {
        void createInAppNotification(proPay.userId, {
          type: "upi_verification_needed",
          title: "Verify your UPI ID to accept direct trial payments",
          body: "A parent wants to book a trial with you, but you haven't verified your UPI ID yet. Verify it in your profile to receive payment directly.",
          relatedType: "match",
          relatedId: matchId,
        }).catch(() => {});
      }
      res.json({ matchId, directPay: true, blocked: true, trialFeeInr });
      return;
    }
    res.json({ matchId, directPay: true, blocked: false, trialFeeInr, upiVpa: proPay.upiVpa, professionalName: proPay.name ?? "your tutor" });
    return;
  }

  // Razorpay-collect branch — platform revenue.
  if (match.trialProviderOrderId) {
    res.json({ matchId, directPay: false, orderId: match.trialProviderOrderId, amount: trialFeeInr * 100, keyId: process.env["RAZORPAY_KEY_ID"]! });
    return;
  }
  const razorpay = getRazorpay();
  if (!razorpay) { res.status(503).json({ error: "Payment gateway not configured" }); return; }
  const order = await razorpay.orders.create({ amount: trialFeeInr * 100, currency: "INR", receipt: `tuttrial_${matchId}_${Date.now()}`, notes: { matchId: String(matchId) } });
  await db.update(tutorMatchesTable).set({ trialProviderOrderId: order.id as string, selectedProfessionalId, updatedAt: new Date() }).where(eq(tutorMatchesTable.id, matchId));
  res.json({ matchId, directPay: false, orderId: order.id, amount: trialFeeInr * 100, keyId: process.env["RAZORPAY_KEY_ID"]! });
});

// ── POST /tutor/:matchId/verify-trial-payment — Razorpay branch only ─────
const VerifyTrialPaymentBody = z.object({
  razorpayOrderId: z.string(),
  razorpayPaymentId: z.string(),
  razorpaySignature: z.string(),
  selectedProfessionalId: z.number().int().positive(),
});

router.post("/tutor/:matchId/verify-trial-payment", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }
  const parsed = VerifyTrialPaymentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keySecret) { res.status(503).json({ error: "Payment gateway not configured" }); return; }
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature, selectedProfessionalId } = parsed.data;

  const [match] = await db.select().from(tutorMatchesTable).where(and(eq(tutorMatchesTable.id, matchId), eq(tutorMatchesTable.parentId, req.userId!)));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }
  if (match.status !== "shortlisted") { res.status(400).json({ error: "Match is not awaiting trial payment" }); return; }
  if (match.trialDirectPay) { res.status(400).json({ error: "This match is on the direct-pay trial flow, not Razorpay" }); return; }
  if (match.trialProviderOrderId !== razorpayOrderId) { res.status(400).json({ error: "Order ID mismatch" }); return; }

  const expectedSig = crypto.createHmac("sha256", keySecret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest("hex");
  if (expectedSig !== razorpaySignature) { res.status(400).json({ error: "Payment signature verification failed" }); return; }

  const [activeCand] = await db
    .select({ id: tutorMatchCandidatesTable.id })
    .from(tutorMatchCandidatesTable)
    .where(and(eq(tutorMatchCandidatesTable.matchId, matchId), eq(tutorMatchCandidatesTable.professionalId, selectedProfessionalId), isNull(tutorMatchCandidatesTable.removedAt)));
  if (!activeCand) { res.status(409).json({ error: "Selected professional is no longer an active candidate for this match" }); return; }

  const razorpay = getRazorpay();
  if (!razorpay) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  // Use the amount actually charged on the Razorpay order, not a live
  // re-read of admin_settings.tutorTrialFeeInr — the admin fee could have
  // changed between request-trial-payment (order creation) and this verify
  // step, and the stored snapshot must reflect what was really collected.
  type RazorpayOrderEntity = { amount?: number };
  let order: RazorpayOrderEntity;
  try {
    order = (await razorpay.orders.fetch(razorpayOrderId)) as unknown as RazorpayOrderEntity;
  } catch (err) {
    console.error("[tutor/verify-trial-payment] Razorpay order fetch failed:", err);
    res.status(400).json({ error: "Unable to verify payment with Razorpay" });
    return;
  }
  const trialFeePaidInr = Math.round((order.amount ?? 0) / 100);
  const trialStartOtp = generateOtp();

  await db
    .update(tutorMatchesTable)
    .set({ status: "trial_pending", trialProviderPaymentId: razorpayPaymentId, trialFeePaidInr, selectedProfessionalId, trialStartOtp, updatedAt: new Date() })
    .where(eq(tutorMatchesTable.id, matchId));

  void createInAppNotification(match.parentId, {
    type: "trial_otp_ready",
    title: "Trial scheduled — your start code is ready",
    body: "Open the app to get the start code you'll show your tutor at the beginning of the trial.",
    relatedType: "match",
    relatedId: matchId,
  }).catch(() => {});

  res.json({ matchId, status: "trial_pending" });
});

// ── POST /tutor/:matchId/mark-trial-paid — direct-pay branch (parent) ────
const MarkTrialPaidBody = z.object({ selectedProfessionalId: z.number().int().positive() });

router.post("/tutor/:matchId/mark-trial-paid", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }
  const parsed = MarkTrialPaidBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { selectedProfessionalId } = parsed.data;

  const [match] = await db.select().from(tutorMatchesTable).where(and(eq(tutorMatchesTable.id, matchId), eq(tutorMatchesTable.parentId, req.userId!)));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }
  if (!match.trialDirectPay) { res.status(400).json({ error: "This match is not on the direct-pay trial flow" }); return; }
  if (match.status !== "shortlisted") { res.json({ matchId, status: match.status }); return; }

  const [activeCand] = await db
    .select({ id: tutorMatchCandidatesTable.id })
    .from(tutorMatchCandidatesTable)
    .where(and(eq(tutorMatchCandidatesTable.matchId, matchId), eq(tutorMatchCandidatesTable.professionalId, selectedProfessionalId), isNull(tutorMatchCandidatesTable.removedAt)));
  if (!activeCand) { res.status(409).json({ error: "Selected professional is no longer an active candidate for this match" }); return; }

  const [proPay] = await db
    .select({ upiVpa: professionalProfilesTable.upiVpa, upiVerifiedAt: professionalProfilesTable.upiVerifiedAt, userId: professionalProfilesTable.userId })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, selectedProfessionalId));
  if (!proPay?.upiVpa || !proPay.upiVerifiedAt) {
    res.status(409).json({ error: "professional_upi_unverified", message: "Payment details for this tutor are being finalized. Please try again in a moment." });
    return;
  }

  const trialStartOtp = generateOtp();

  await db
    .update(tutorMatchesTable)
    .set({ status: "trial_pending", selectedProfessionalId, trialStartOtp, trialDirectPayMarkedPaidAt: new Date(), updatedAt: new Date() })
    .where(eq(tutorMatchesTable.id, matchId));

  void createInAppNotification(match.parentId, {
    type: "trial_otp_ready",
    title: "Trial scheduled — your start code is ready",
    body: "Open the app to get the start code you'll show your tutor at the beginning of the trial.",
    relatedType: "match",
    relatedId: matchId,
  }).catch(() => {});
  void createInAppNotification(proPay.userId, {
    type: "trial_direct_pay_marked_paid",
    title: "Parent marked the trial fee as paid",
    body: "The parent has marked the trial fee as paid directly to your UPI ID. Please confirm receipt in the app once you've received it.",
    relatedType: "match",
    relatedId: matchId,
  }).catch(() => {});

  res.json({ matchId, status: "trial_pending" });
});

// ── POST /tutor/:matchId/confirm-trial-paid — direct-pay branch (professional) ─
router.post("/tutor/:matchId/confirm-trial-paid", requireAuth, requireRole("professional", "admin"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }

  const [match] = await db.select().from(tutorMatchesTable).where(eq(tutorMatchesTable.id, matchId));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }
  if (!match.selectedProfessionalId) { res.status(400).json({ error: "No tutor selected for this match" }); return; }

  if (req.userRole === "professional") {
    const [pro] = await db.select({ id: professionalProfilesTable.id }).from(professionalProfilesTable).where(eq(professionalProfilesTable.userId, req.userId!));
    if (!pro || pro.id !== match.selectedProfessionalId) { res.status(403).json({ error: "Access denied" }); return; }
  }

  await db.update(tutorMatchesTable).set({ trialDirectPayConfirmedAt: new Date(), updatedAt: new Date() }).where(eq(tutorMatchesTable.id, matchId));
  res.json({ matchId, confirmed: true });
});

// ── POST /tutor/:matchId/verify-trial-start-otp ───────────────────────────
router.post("/tutor/:matchId/verify-trial-start-otp", requireAuth, requireRole("professional", "admin"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }
  const otp = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";
  if (!otp) { res.status(400).json({ error: "OTP is required" }); return; }

  const [match] = await db.select().from(tutorMatchesTable).where(eq(tutorMatchesTable.id, matchId));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }
  if (match.status !== "trial_pending") { res.status(400).json({ error: "Trial has not been started or is already in progress" }); return; }
  if (!match.selectedProfessionalId) { res.status(400).json({ error: "No tutor selected for this match" }); return; }

  if (req.userRole === "professional") {
    const [pro] = await db.select({ id: professionalProfilesTable.id }).from(professionalProfilesTable).where(eq(professionalProfilesTable.userId, req.userId!));
    if (!pro || pro.id !== match.selectedProfessionalId) { res.status(403).json({ error: "Access denied" }); return; }
  }
  if (!match.trialStartOtp || match.trialStartOtp !== otp) { res.status(400).json({ error: "Incorrect start OTP" }); return; }

  const trialEndOtp = generateOtp();
  await db.update(tutorMatchesTable).set({ status: "trial_started", trialEndOtp, updatedAt: new Date() }).where(eq(tutorMatchesTable.id, matchId));
  res.json({ matchId, status: "trial_started" });
});

// ── POST /tutor/:matchId/verify-trial-end-otp ─────────────────────────────
router.post("/tutor/:matchId/verify-trial-end-otp", requireAuth, requireRole("professional", "admin"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }
  const otp = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";
  if (!otp) { res.status(400).json({ error: "OTP is required" }); return; }

  const [match] = await db.select().from(tutorMatchesTable).where(eq(tutorMatchesTable.id, matchId));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }
  if (match.status !== "trial_started") { res.status(400).json({ error: "Trial has not started yet or is already marked done" }); return; }
  if (!match.selectedProfessionalId) { res.status(400).json({ error: "No tutor selected for this match" }); return; }

  if (req.userRole === "professional") {
    const [pro] = await db.select({ id: professionalProfilesTable.id }).from(professionalProfilesTable).where(eq(professionalProfilesTable.userId, req.userId!));
    if (!pro || pro.id !== match.selectedProfessionalId) { res.status(403).json({ error: "Access denied" }); return; }
  }
  if (!match.trialEndOtp || match.trialEndOtp !== otp) { res.status(400).json({ error: "Incorrect end OTP" }); return; }

  await db.update(tutorMatchesTable).set({ status: "trial_done", updatedAt: new Date() }).where(eq(tutorMatchesTable.id, matchId));
  res.json({ matchId, status: "trial_done" });
});

// ═══════════════════════════════════════════════════════════════════════
// B4 — commit → engagement → activation fee → session tracking → payment
// cadence.
// ═══════════════════════════════════════════════════════════════════════

type TutorEngagementRow = typeof tutorEngagementsTable.$inferSelect;

// ── Commit — structural mirror of shadowTeacher.ts's loadCommitContext /
// finalizeCommit, minus the negotiation-offer lookups (tutor has no
// negotiation tables — rate is the offering's listed pricingMinINR,
// resolved via resolveOffering() rather than read directly off
// professional_profiles, since a tutor offering may live on
// professional_offerings for a professional whose primary vertical is
// something else).
type TutorCommitContextResult =
  | { error: { status: number; body: { error: string; message?: string } } }
  | {
      match: TutorMatchRow;
      professional: { fullName: string | null; phone: string | null; email: string | null; userId: number };
      perSessionFeeInr: number;
    };

async function loadTutorCommitContext(matchId: number, parentId: number, selectedProfessionalId: number): Promise<TutorCommitContextResult> {
  const [match] = await db.select().from(tutorMatchesTable).where(and(eq(tutorMatchesTable.id, matchId), eq(tutorMatchesTable.parentId, parentId)));
  if (!match) return { error: { status: 404, body: { error: "Match not found" } } };
  if (!["shortlisted", "trial_done"].includes(match.status)) {
    return { error: { status: 400, body: { error: "Commitment is only allowed from shortlisted or trial_done status" } } };
  }

  const [candidate] = await db
    .select()
    .from(tutorMatchCandidatesTable)
    .where(and(eq(tutorMatchCandidatesTable.matchId, matchId), eq(tutorMatchCandidatesTable.professionalId, selectedProfessionalId), isNull(tutorMatchCandidatesTable.removedAt)));
  if (!candidate) return { error: { status: 404, body: { error: "Selected professional is not an active candidate for this match" } } };

  const [professional] = await db
    .select({ fullName: professionalProfilesTable.fullName, phone: professionalProfilesTable.phone, email: professionalProfilesTable.email, userId: professionalProfilesTable.userId })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, selectedProfessionalId));
  if (!professional) return { error: { status: 404, body: { error: "Professional not found" } } };

  const offering = await resolveOffering(selectedProfessionalId, "home_tutor");
  if (!offering || offering.pricingMinINR == null) {
    return {
      error: {
        status: 409,
        body: { error: "commitment_blocked_no_pricing", message: "This tutor hasn't set their per-session fee yet. An admin can assign them manually once the fee is agreed." },
      },
    };
  }

  return { match, professional, perSessionFeeInr: offering.pricingMinINR };
}

async function finalizeTutorCommit(params: {
  match: TutorMatchRow;
  professional: { fullName: string | null; phone: string | null; email: string | null; userId: number };
  selectedProfessionalId: number;
  perSessionFeeInr: number;
  directPayEnabled: boolean;
  startDate: string | null;
  placementFeeInr: number;
  placementFeePaymentId: number | null;
}): Promise<TutorEngagementRow> {
  const { match, professional, selectedProfessionalId, perSessionFeeInr, directPayEnabled, placementFeeInr, placementFeePaymentId } = params;
  const today = new Date().toISOString().split("T")[0]!;
  const effectiveStartDate = params.startDate ?? match.pendingCommitStartDate ?? today;

  const [engagement] = await db
    .insert(tutorEngagementsTable)
    .values({
      parentId: match.parentId,
      professionalId: selectedProfessionalId,
      childId: match.childId ?? null,
      matchRequestId: match.id,
      startDate: effectiveStartDate,
      sessionsPerWeek: match.frequencyPerWeek ?? 0,
      perSessionFeeInr,
      // Always credited here (never wallet-stranded) — tutor sessions are
      // always direct-pay-or-Razorpay-collected between parent and tutor,
      // unlike shadow-teacher's salary-escrow branch, so there's no
      // scenario where the trial credit has nothing to apply against.
      trialCreditInr: match.trialFeePaidInr ?? 0,
      status: "pending_teacher_acceptance",
      startOtp: generateOtp(),
      placementFeeInr: placementFeeInr > 0 ? placementFeeInr : null,
      placementFeePaymentId,
      directPayEnabled,
    })
    .returning();

  await db
    .update(tutorMatchesTable)
    .set({
      status: "committed",
      selectedProfessionalId,
      matchedAt: new Date(),
      matchedProfessionalId: selectedProfessionalId,
      pendingCommitProfessionalId: null,
      pendingCommitStartDate: null,
      updatedAt: new Date(),
    })
    .where(eq(tutorMatchesTable.id, match.id));

  const matchChildId = match.childId ?? null;
  const [existingThread] = await db
    .select({ id: connectThreadsTable.id })
    .from(connectThreadsTable)
    .where(
      and(
        eq(connectThreadsTable.parentId, match.parentId),
        eq(connectThreadsTable.professionalId, selectedProfessionalId),
        matchChildId != null ? eq(connectThreadsTable.childId, matchChildId) : sql`${connectThreadsTable.childId} IS NULL`,
      ),
    )
    .limit(1);
  if (!existingThread) {
    await db.insert(connectThreadsTable).values({ parentId: match.parentId, professionalId: selectedProfessionalId, childId: matchChildId });
  }

  void createInAppNotification(match.parentId, {
    type: "engagement_pending_acceptance",
    title: "Waiting for tutor to accept",
    body: `${professional.fullName ?? "Your tutor"} has been notified and needs to accept the engagement. You'll be notified once they confirm.`,
    relatedType: "engagement", relatedId: engagement!.id,
  }).catch(() => {});

  void createInAppNotification(professional.userId, {
    type: "engagement_awaiting_acceptance",
    title: "New engagement — your acceptance needed",
    body: `A parent has selected you for an engagement starting ${effectiveStartDate}. Open the app to accept or decline.`,
    relatedType: "engagement", relatedId: engagement!.id,
  }).catch(() => {});

  return engagement!;
}

// ── POST /tutor/:matchId/commit/order + /commit/verify ───────────────────
const TutorCommitBody = z.object({
  selectedProfessionalId: z.number().int().positive(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

router.post("/tutor/:matchId/commit/order", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }
  const parsed = TutorCommitBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { selectedProfessionalId, startDate } = parsed.data;

  const ctx = await loadTutorCommitContext(matchId, req.userId!, selectedProfessionalId);
  if ("error" in ctx) { res.status(ctx.error.status).json(ctx.error.body); return; }
  const { match, professional, perSessionFeeInr } = ctx;

  const settings = await getSettings();
  const placementFeeInr = ((settings as Record<string, unknown>)["tutorPlacementFeeInr"] as number) ?? 1500;
  const directPayEnabled = ((settings as Record<string, unknown>)["tutorDirectPayEnabled"] as boolean) ?? true;

  if (placementFeeInr <= 0) {
    const engagement = await finalizeTutorCommit({ match, professional, selectedProfessionalId, perSessionFeeInr, directPayEnabled, startDate: startDate ?? null, placementFeeInr: 0, placementFeePaymentId: null });
    res.json({ engagementId: engagement.id, professionalFullName: professional.fullName, phone: professional.phone, email: professional.email, waived: true });
    return;
  }

  // Idempotency — reuse the pending order if one already exists.
  if (match.placementFeeOrderId) {
    await db
      .update(tutorMatchesTable)
      .set({ pendingCommitProfessionalId: selectedProfessionalId, pendingCommitStartDate: startDate ?? null, updatedAt: new Date() })
      .where(eq(tutorMatchesTable.id, matchId));
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
    receipt: `tutplacement_${matchId}_${Date.now()}`,
    notes: { matchId: String(matchId), selectedProfessionalId: String(selectedProfessionalId) },
  });

  await db
    .update(tutorMatchesTable)
    .set({
      pendingCommitProfessionalId: selectedProfessionalId,
      pendingCommitStartDate: startDate ?? null,
      placementFeeOrderId: order.id as string,
      placementFeeAmountInr: placementFeeInr,
      updatedAt: new Date(),
    })
    .where(eq(tutorMatchesTable.id, matchId));

  res.json({ matchId, orderId: order.id, amount, keyId: process.env["RAZORPAY_KEY_ID"]! });
});

const TutorCommitVerifyBody = z.object({
  razorpayOrderId: z.string(),
  razorpayPaymentId: z.string(),
  razorpaySignature: z.string(),
});

router.post("/tutor/:matchId/commit/verify", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }
  const parsed = TutorCommitVerifyBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = parsed.data;

  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keySecret) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  const [match] = await db.select().from(tutorMatchesTable).where(and(eq(tutorMatchesTable.id, matchId), eq(tutorMatchesTable.parentId, req.userId!)));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }

  // Idempotency: already committed — return the existing engagement rather
  // than re-processing (guards against double-submit of /commit/verify).
  if (match.status === "committed") {
    const [existingEngagement] = await db
      .select({ id: tutorEngagementsTable.id })
      .from(tutorEngagementsTable)
      .where(eq(tutorEngagementsTable.matchRequestId, match.id))
      .orderBy(desc(tutorEngagementsTable.id))
      .limit(1);
    res.json({ engagementId: existingEngagement?.id, alreadyCommitted: true });
    return;
  }

  if (!["shortlisted", "trial_done"].includes(match.status)) { res.status(400).json({ error: "Match is not awaiting placement fee payment" }); return; }
  if (!match.placementFeeOrderId || match.placementFeeOrderId !== razorpayOrderId) { res.status(400).json({ error: "Order ID mismatch" }); return; }
  if (!match.pendingCommitProfessionalId) { res.status(409).json({ error: "No pending commitment found for this match" }); return; }

  const expectedSig = crypto.createHmac("sha256", keySecret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest("hex");
  if (expectedSig !== razorpaySignature) { res.status(400).json({ error: "Payment signature verification failed" }); return; }

  const selectedProfessionalId = match.pendingCommitProfessionalId;
  const placementFeeInr = match.placementFeeAmountInr ?? 0;

  // Guard against a client retry re-submitting the same valid Razorpay
  // payment after the row was already recorded — reuse the existing
  // payment row instead of inserting a duplicate completed payment.
  const [existingPaymentRow] = await db
    .select()
    .from(paymentsTable)
    .where(and(eq(paymentsTable.providerPaymentId, razorpayPaymentId), eq(paymentsTable.plan, "plan_placement_fee")))
    .limit(1);

  let paymentRow = existingPaymentRow;
  if (!paymentRow) {
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

  const ctx = await loadTutorCommitContext(matchId, req.userId!, selectedProfessionalId);
  if ("error" in ctx) {
    res.status(ctx.error.status).json({
      ...ctx.error.body,
      paymentCaptured: true,
      message: ctx.error.body.message
        ? `${ctx.error.body.message} Your payment was captured — contact support if this isn't resolved automatically.`
        : "Your payment was captured but the commitment could not be finalized. Contact support.",
    });
    return;
  }
  const { match: freshMatch, professional, perSessionFeeInr } = ctx;
  const settings = await getSettings();
  const directPayEnabled = ((settings as Record<string, unknown>)["tutorDirectPayEnabled"] as boolean) ?? true;

  const engagement = await finalizeTutorCommit({
    match: freshMatch,
    professional,
    selectedProfessionalId,
    perSessionFeeInr,
    directPayEnabled,
    startDate: freshMatch.pendingCommitStartDate,
    placementFeeInr,
    placementFeePaymentId: paymentRow!.id,
  });

  res.json({ engagementId: engagement.id, professionalFullName: professional.fullName, phone: professional.phone, email: professional.email });
});

async function getTutorEngagementWithAccess(
  engagementId: number,
  userId: number,
  userRole: string,
): Promise<{ eng: TutorEngagementRow; role: "parent" | "professional" | "admin" } | { eng: null; role: null }> {
  const [eng] = await db.select().from(tutorEngagementsTable).where(eq(tutorEngagementsTable.id, engagementId)).limit(1);
  if (!eng) return { eng: null, role: null };
  if (userRole === "admin") return { eng, role: "admin" };
  if (eng.parentId === userId) return { eng, role: "parent" };
  const [prof] = await db
    .select({ id: professionalProfilesTable.id })
    .from(professionalProfilesTable)
    .where(and(eq(professionalProfilesTable.userId, userId), eq(professionalProfilesTable.id, eng.professionalId)))
    .limit(1);
  if (prof) return { eng, role: "professional" };
  return { eng: null, role: null };
}

// ── GET /tutor/engagements — list the caller's own engagements ───────────
// Direct mirror of engagements.ts's GET /engagements (dual parent/
// professional shapes). Without this there is no way to discover an
// engagement's id/status after the initial commit response.
router.get("/tutor/engagements", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const isParent = req.userRole === "parent";
  const today = new Date().toISOString().slice(0, 10);

  if (isParent) {
    const rows = await db
      .select({
        id: tutorEngagementsTable.id,
        parentId: tutorEngagementsTable.parentId,
        professionalId: tutorEngagementsTable.professionalId,
        childId: tutorEngagementsTable.childId,
        startDate: tutorEngagementsTable.startDate,
        sessionsPerWeek: tutorEngagementsTable.sessionsPerWeek,
        perSessionFeeInr: tutorEngagementsTable.perSessionFeeInr,
        status: tutorEngagementsTable.status,
        endDate: tutorEngagementsTable.endDate,
        endedReason: tutorEngagementsTable.endedReason,
        directPayEnabled: tutorEngagementsTable.directPayEnabled,
        placementFeeInr: tutorEngagementsTable.placementFeeInr,
        activationFeeInr: tutorEngagementsTable.activationFeeInr,
        startOtp: tutorEngagementsTable.startOtp,
        professionalName: professionalProfilesTable.fullName,
        childName: childrenTable.name,
        createdAt: tutorEngagementsTable.createdAt,
      })
      .from(tutorEngagementsTable)
      .leftJoin(professionalProfilesTable, eq(tutorEngagementsTable.professionalId, professionalProfilesTable.id))
      .leftJoin(childrenTable, eq(tutorEngagementsTable.childId, childrenTable.id))
      .where(eq(tutorEngagementsTable.parentId, req.userId!))
      .orderBy(desc(tutorEngagementsTable.createdAt));

    const safeRows = rows.map((r: { startOtp: string | null; startDate: string }) => ({ ...r, startOtp: r.startOtp && r.startDate <= today ? r.startOtp : null }));
    res.json(safeRows);
    return;
  }

  const [prof] = await db.select({ id: professionalProfilesTable.id }).from(professionalProfilesTable).where(eq(professionalProfilesTable.userId, req.userId!)).limit(1);
  if (!prof) { res.json([]); return; }

  const rows = await db
    .select({
      id: tutorEngagementsTable.id,
      parentId: tutorEngagementsTable.parentId,
      professionalId: tutorEngagementsTable.professionalId,
      childId: tutorEngagementsTable.childId,
      matchRequestId: tutorEngagementsTable.matchRequestId,
      startDate: tutorEngagementsTable.startDate,
      sessionsPerWeek: tutorEngagementsTable.sessionsPerWeek,
      perSessionFeeInr: tutorEngagementsTable.perSessionFeeInr,
      status: tutorEngagementsTable.status,
      endDate: tutorEngagementsTable.endDate,
      endedReason: tutorEngagementsTable.endedReason,
      directPayEnabled: tutorEngagementsTable.directPayEnabled,
      placementFeeInr: tutorEngagementsTable.placementFeeInr,
      activationFeeInr: tutorEngagementsTable.activationFeeInr,
      parentName: usersTable.fullName,
      childName: childrenTable.name,
      createdAt: tutorEngagementsTable.createdAt,
    })
    .from(tutorEngagementsTable)
    .leftJoin(usersTable, eq(tutorEngagementsTable.parentId, usersTable.id))
    .leftJoin(childrenTable, eq(tutorEngagementsTable.childId, childrenTable.id))
    .where(eq(tutorEngagementsTable.professionalId, prof.id))
    .orderBy(desc(tutorEngagementsTable.createdAt));

  res.json(rows);
});

// ── PATCH /tutor/engagements/:id/acceptance — tutor accepts or declines ──
// Mirrors lifecycleRequests.ts's PATCH /engagements/:id/teacher-acceptance
// exactly, minus the negotiation-offer void (tutor/therapist have no
// negotiation tables). activationFeeEnabled is per-match (default false for
// tutor, checked here, not a global setting).
router.patch("/tutor/engagements/:id/acceptance", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { action } = req.body ?? {};
  if (!["accept", "decline"].includes(action as string)) { res.status(400).json({ error: "action must be accept or decline" }); return; }

  const { eng, role } = await getTutorEngagementWithAccess(id, req.userId!, req.userRole!);
  if (!eng || !role) { res.status(404).json({ error: "Engagement not found or access denied" }); return; }
  if (role !== "professional") { res.status(403).json({ error: "Only the assigned tutor can accept or decline" }); return; }
  if (eng.status !== "pending_teacher_acceptance") { res.status(409).json({ error: "Engagement is not awaiting acceptance" }); return; }

  // Direct-pay gate — teacher-side, so the parent is never trapped. Same
  // shape as shadow-teacher's platformSalaryEnabled===false check in
  // lifecycleRequests.ts. Only applies when this engagement's snapshotted
  // directPayEnabled is true; a Razorpay-collect engagement has no UPI
  // dependency to gate on.
  if (action === "accept" && eng.directPayEnabled) {
    const [prof] = await db
      .select({ upiVerifiedAt: professionalProfilesTable.upiVerifiedAt })
      .from(professionalProfilesTable)
      .where(eq(professionalProfilesTable.id, eng.professionalId))
      .limit(1);
    if (!prof?.upiVerifiedAt) {
      res.status(409).json({
        error: "upi_verification_required",
        message: "Verify your UPI ID to accept this engagement. The parent will pay you directly for each session.",
      });
      return;
    }
  }

  if (action === "accept") {
    const settings = await getSettings();
    const globalActivationFeeInr = ((settings as Record<string, unknown>)["tutorActivationFeeInr"] as number) ?? 500;

    let effectiveActivationFeeEnabled = false; // tutor default OFF, per-match override below
    if (eng.matchRequestId) {
      const [matchRow] = await db
        .select({ activationFeeEnabled: tutorMatchesTable.activationFeeEnabled })
        .from(tutorMatchesTable)
        .where(eq(tutorMatchesTable.id, eng.matchRequestId))
        .limit(1);
      effectiveActivationFeeEnabled = matchRow?.activationFeeEnabled ?? false;
    }
    const activationFeeInr = effectiveActivationFeeEnabled ? globalActivationFeeInr : 0;
    const nextStatus = activationFeeInr > 0 ? "pending_activation_fee" : "pending_start";

    await db
      .update(tutorEngagementsTable)
      .set({ status: nextStatus, activationFeeInr: activationFeeInr > 0 ? activationFeeInr : null, updatedAt: new Date() })
      .where(eq(tutorEngagementsTable.id, id));

    void createInAppNotification(eng.parentId, {
      type: "engagement_accepted",
      title: "Tutor accepted the engagement",
      body: nextStatus === "pending_activation_fee"
        ? "Your tutor accepted the engagement and is completing their activation fee. Your start code will be ready once that's done."
        : `Your tutor accepted the engagement. Your start code will be ready on ${eng.startDate}.`,
      relatedType: "engagement", relatedId: id,
    }).catch(() => {});
    if (nextStatus === "pending_activation_fee") {
      void createInAppNotification(req.userId!, {
        type: "activation_fee_due",
        title: "Activation fee required",
        body: `Pay the one-time activation fee of ₹${activationFeeInr.toLocaleString("en-IN")} to start this engagement.`,
        relatedType: "engagement", relatedId: id,
      }).catch(() => {});
    }

    res.json({ status: nextStatus, activationFeeInr: activationFeeInr > 0 ? activationFeeInr : undefined });
    return;
  }

  // ── Decline ────────────────────────────────────────────────────────────
  await db
    .update(tutorEngagementsTable)
    .set({ status: "ended", endedReason: "professional_declined", updatedAt: new Date() })
    .where(eq(tutorEngagementsTable.id, id));

  if (eng.matchRequestId) {
    const [candidate] = await db
      .select({ id: tutorMatchCandidatesTable.id })
      .from(tutorMatchCandidatesTable)
      .where(and(eq(tutorMatchCandidatesTable.matchId, eng.matchRequestId), eq(tutorMatchCandidatesTable.professionalId, eng.professionalId), isNull(tutorMatchCandidatesTable.removedAt)))
      .limit(1);
    if (candidate) {
      await db.update(tutorMatchCandidatesTable).set({ removedAt: new Date(), removedByUserId: req.userId! }).where(eq(tutorMatchCandidatesTable.id, candidate.id));
    }
    await db
      .update(tutorMatchesTable)
      .set({ status: "shortlisted", selectedProfessionalId: null, matchedAt: null, matchedProfessionalId: null, updatedAt: new Date() })
      .where(eq(tutorMatchesTable.id, eng.matchRequestId));
  }

  let refundedInr: number | null = null;
  if (eng.placementFeePaymentId) {
    const [feePayment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, eng.placementFeePaymentId)).limit(1);
    if (feePayment && feePayment.status !== "refunded") {
      refundedInr = Math.round(feePayment.amountPaise / 100);
      await creditWallet(eng.parentId, refundedInr, "refund", feePayment.id, "Placement fee refunded — tutor declined the engagement.");
      await db.update(paymentsTable).set({ status: "refunded" }).where(eq(paymentsTable.id, feePayment.id));
    }
  }

  void createInAppNotification(eng.parentId, {
    type: "engagement_declined",
    title: "Tutor declined the engagement",
    body: refundedInr
      ? `Your tutor declined this engagement. Your placement fee of ₹${refundedInr.toLocaleString("en-IN")} has been refunded to your wallet. You can return to your request to choose another tutor.`
      : "Your tutor declined this engagement. You can return to your request to choose another tutor.",
    relatedType: "engagement", relatedId: id,
  }).catch(() => {});

  res.json({ status: "ended", endedReason: "professional_declined", refundedInr: refundedInr ?? undefined });
});

// ── POST /tutor/engagements/:id/activation-fee/order + /verify ───────────
// Direct mirror of lifecycleRequests.ts's activation-fee/order+verify.
router.post("/tutor/engagements/:id/activation-fee/order", requireAuth, requireRole("professional"), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { eng, role } = await getTutorEngagementWithAccess(id, req.userId!, req.userRole!);
  if (!eng || role !== "professional") { res.status(404).json({ error: "Engagement not found or access denied" }); return; }
  if (eng.status !== "pending_activation_fee") { res.status(409).json({ error: "Engagement is not awaiting an activation fee payment" }); return; }

  // Defensive check — per-match activation_fee_enabled toggled OFF after
  // routing here. Same guard as shadow-teacher's Task 2e.
  if (eng.matchRequestId) {
    const [matchRow] = await db
      .select({ activationFeeEnabled: tutorMatchesTable.activationFeeEnabled })
      .from(tutorMatchesTable)
      .where(eq(tutorMatchesTable.id, eng.matchRequestId))
      .limit(1);
    if (matchRow && !matchRow.activationFeeEnabled) {
      await db.update(tutorEngagementsTable).set({ status: "pending_start", updatedAt: new Date() }).where(eq(tutorEngagementsTable.id, id));
      res.json({ skipped: true, status: "pending_start" });
      return;
    }
  }

  const activationFeeInr = eng.activationFeeInr ?? 0;
  if (activationFeeInr <= 0) { res.status(409).json({ error: "No activation fee is due for this engagement" }); return; }

  if (eng.activationFeeOrderId) {
    res.json({ orderId: eng.activationFeeOrderId, amount: activationFeeInr * 100, keyId: process.env["RAZORPAY_KEY_ID"]!, resuming: true });
    return;
  }

  const razorpay = getRazorpay();
  if (!razorpay) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  const amount = activationFeeInr * 100;
  const order = await razorpay.orders.create({ amount, currency: "INR", receipt: `tutactivation_${id}_${Date.now()}`, notes: { engagementId: String(id) } });

  await db.update(tutorEngagementsTable).set({ activationFeeOrderId: order.id as string, updatedAt: new Date() }).where(eq(tutorEngagementsTable.id, id));
  res.json({ orderId: order.id, amount, keyId: process.env["RAZORPAY_KEY_ID"]! });
});

const TutorActivationVerifyBody = z.object({ razorpayOrderId: z.string(), razorpayPaymentId: z.string(), razorpaySignature: z.string() });

router.post("/tutor/engagements/:id/activation-fee/verify", requireAuth, requireRole("professional"), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = TutorActivationVerifyBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = parsed.data;
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keySecret) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  const { eng, role } = await getTutorEngagementWithAccess(id, req.userId!, req.userRole!);
  if (!eng || role !== "professional") { res.status(404).json({ error: "Engagement not found or access denied" }); return; }

  if (eng.status !== "pending_activation_fee") { res.json({ status: eng.status, alreadyProcessed: true }); return; }
  if (!eng.activationFeeOrderId || eng.activationFeeOrderId !== razorpayOrderId) { res.status(400).json({ error: "Order ID mismatch" }); return; }

  const expectedSig = crypto.createHmac("sha256", keySecret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest("hex");
  if (expectedSig !== razorpaySignature) { res.status(400).json({ error: "Payment signature verification failed" }); return; }

  const activationFeeInr = eng.activationFeeInr ?? 0;
  const [paymentRow] = await db
    .insert(paymentsTable)
    .values({
      userId: req.userId!,
      plan: "plan_activation_fee",
      provider: "razorpay",
      providerOrderId: razorpayOrderId,
      providerPaymentId: razorpayPaymentId,
      amountPaise: activationFeeInr * 100,
      currency: "INR",
      status: "completed",
      professionalId: eng.professionalId,
      metadata: JSON.stringify({ engagementId: id }),
    })
    .returning();

  await db.update(tutorEngagementsTable).set({ status: "pending_start", activationFeePaymentId: paymentRow!.id, updatedAt: new Date() }).where(eq(tutorEngagementsTable.id, id));

  void createInAppNotification(eng.parentId, {
    type: "engagement_activated",
    title: "Tutor completed activation",
    body: "Your start code is now ready.",
    relatedType: "engagement", relatedId: id,
  }).catch(() => {});

  res.json({ status: "pending_start" });
});

// ── POST /tutor/engagements/:id/verify-start-otp — one-time engagement start ─
// Direct mirror of engagements.ts's POST /engagements/:id/confirm-start.
router.post("/tutor/engagements/:id/verify-start-otp", requireAuth, requireRole("professional", "admin"), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const otp = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";
  if (!otp) { res.status(400).json({ error: "Start code required" }); return; }

  const { eng, role } = await getTutorEngagementWithAccess(id, req.userId!, req.userRole!);
  if (!eng || (role !== "professional" && role !== "admin")) { res.status(404).json({ error: "Engagement not found or access denied" }); return; }
  if (eng.status !== "pending_start") { res.status(409).json({ error: "Engagement is not awaiting start confirmation" }); return; }
  if (!eng.startOtp || eng.startOtp !== otp) { res.status(400).json({ error: "Incorrect start code" }); return; }

  const today = new Date().toISOString().slice(0, 10);
  if (eng.startDate > today) { res.status(400).json({ error: `Start date is ${eng.startDate} — you can confirm on or after that date` }); return; }

  const [updated] = await db
    .update(tutorEngagementsTable)
    .set({ status: "active", startOtp: null, updatedAt: new Date() })
    .where(eq(tutorEngagementsTable.id, id))
    .returning();
  if (!updated) {
    console.error(`[tutor/verify-start-otp] returning() came back empty for engagementId=${id}`);
    res.status(500).json({ error: "update_failed" });
    return;
  }

  void createInAppNotification(eng.parentId, {
    type: "engagement_active",
    title: "Engagement is now active!",
    body: "Your tutor has confirmed the start code. The engagement is officially underway.",
    relatedType: "engagement", relatedId: id,
  }).catch(() => {});

  res.json(updated);
});

// ── Session tracking: schedule → start (OTP) → complete ──────────────────
// OTP lockout pattern mirrored from sessionsV2.ts's start-otp/end-otp
// (attempts/expiry/lock), not shadow-teacher's simpler compare-only
// trial-OTP — tutor_engagement_sessions was schema'd with otpAttempts/
// otpLockedAt specifically to support this enforcement. OTPs are issued at
// schedule time (no payment gate per session — billing is a monthly
// rollup via mark-month-paid, unlike sessionsV2's per-booking escrow).
const ScheduleTutorSessionBody = z.object({
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
});

router.post("/tutor/engagements/:id/sessions", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = ScheduleTutorSessionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { eng, role } = await getTutorEngagementWithAccess(id, req.userId!, req.userRole!);
  if (!eng || !role) { res.status(404).json({ error: "Engagement not found or access denied" }); return; }
  if (eng.status !== "active") { res.status(409).json({ error: "Engagement must be active to schedule a session" }); return; }

  const now = new Date();
  const [session] = await db
    .insert(tutorEngagementSessionsTable)
    .values({
      engagementId: id,
      sessionDate: parsed.data.sessionDate,
      startTime: parsed.data.startTime ?? null,
      endTime: parsed.data.endTime ?? null,
      startOtp: generateOtp(),
      endOtp: generateOtp(),
      otpIssuedAt: now,
    })
    .returning();
  if (!session) {
    console.error(`[tutor/schedule-session] returning() came back empty for engagementId=${id}`);
    res.status(500).json({ error: "insert_failed" });
    return;
  }

  res.status(201).json(session);
});

router.get("/tutor/engagements/:id/sessions", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { eng, role } = await getTutorEngagementWithAccess(id, req.userId!, req.userRole!);
  if (!eng || !role) { res.status(404).json({ error: "Engagement not found or access denied" }); return; }

  const rows = await db.select().from(tutorEngagementSessionsTable).where(eq(tutorEngagementSessionsTable.engagementId, id)).orderBy(desc(tutorEngagementSessionsTable.sessionDate));
  res.json(rows);
});

const SessionOtpBody = z.object({ otp: z.string().length(6) });

router.post("/tutor/engagements/:id/sessions/:sessionId/start-otp", requireAuth, requireRole("professional"), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  const sessionId = parseInt(req.params["sessionId"] as string, 10);
  if (isNaN(id) || isNaN(sessionId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = SessionOtpBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "OTP must be 6 digits" }); return; }

  const { eng, role } = await getTutorEngagementWithAccess(id, req.userId!, req.userRole!);
  if (!eng || role !== "professional") { res.status(404).json({ error: "Engagement not found or access denied" }); return; }

  const [session] = await db.select().from(tutorEngagementSessionsTable).where(and(eq(tutorEngagementSessionsTable.id, sessionId), eq(tutorEngagementSessionsTable.engagementId, id))).limit(1);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  if (session.status !== "scheduled") { res.status(400).json({ error: "Session is not in scheduled status" }); return; }
  if (session.otpLockedAt) { res.status(403).json({ error: "OTP is locked due to too many failed attempts. Contact admin." }); return; }

  const settings = await getSettings();
  const otpValidityMinutes = ((settings as Record<string, unknown>)["otpValidityMinutes"] as number) ?? 10;
  const now = new Date();

  if (session.otpIssuedAt && now.getTime() - session.otpIssuedAt.getTime() > otpValidityMinutes * 60 * 1000) {
    await db.update(tutorEngagementSessionsTable).set({ startOtp: generateOtp(), endOtp: generateOtp(), otpIssuedAt: now, otpAttempts: 0, updatedAt: now }).where(eq(tutorEngagementSessionsTable.id, sessionId));
    res.status(400).json({ error: "OTP expired — a new OTP has been generated." });
    return;
  }

  if (parsed.data.otp !== session.startOtp) {
    const newAttempts = (session.otpAttempts ?? 0) + 1;
    if (newAttempts >= OTP_MAX_ATTEMPTS) {
      await db.update(tutorEngagementSessionsTable).set({ otpAttempts: newAttempts, otpLockedAt: now, updatedAt: now }).where(eq(tutorEngagementSessionsTable.id, sessionId));
      res.status(403).json({ error: "Too many failed attempts — OTP locked. Admin has been alerted." });
      return;
    }
    await db.update(tutorEngagementSessionsTable).set({ otpAttempts: newAttempts, updatedAt: now }).where(eq(tutorEngagementSessionsTable.id, sessionId));
    res.status(400).json({ error: "Incorrect OTP", attemptsRemaining: OTP_MAX_ATTEMPTS - newAttempts });
    return;
  }

  const [updated] = await db
    .update(tutorEngagementSessionsTable)
    .set({ status: "started", startedAt: now, otpAttempts: 0, markedByUserId: req.userId!, updatedAt: now })
    .where(eq(tutorEngagementSessionsTable.id, sessionId))
    .returning();
  if (!updated) {
    console.error(`[tutor/session-start-otp] returning() came back empty for sessionId=${sessionId}`);
    res.status(500).json({ error: "update_failed" });
    return;
  }
  res.json(updated);
});

router.post("/tutor/engagements/:id/sessions/:sessionId/end-otp", requireAuth, requireRole("professional"), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  const sessionId = parseInt(req.params["sessionId"] as string, 10);
  if (isNaN(id) || isNaN(sessionId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = SessionOtpBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "OTP must be 6 digits" }); return; }

  const { eng, role } = await getTutorEngagementWithAccess(id, req.userId!, req.userRole!);
  if (!eng || role !== "professional") { res.status(404).json({ error: "Engagement not found or access denied" }); return; }

  const [session] = await db.select().from(tutorEngagementSessionsTable).where(and(eq(tutorEngagementSessionsTable.id, sessionId), eq(tutorEngagementSessionsTable.engagementId, id))).limit(1);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  if (session.status !== "started") { res.status(400).json({ error: "Session has not been started yet" }); return; }
  if (session.otpLockedAt) { res.status(403).json({ error: "OTP is locked. Contact admin." }); return; }

  const now = new Date();
  if (parsed.data.otp !== session.endOtp) {
    const newAttempts = (session.otpAttempts ?? 0) + 1;
    if (newAttempts >= OTP_MAX_ATTEMPTS) {
      await db.update(tutorEngagementSessionsTable).set({ otpAttempts: newAttempts, otpLockedAt: now, updatedAt: now }).where(eq(tutorEngagementSessionsTable.id, sessionId));
      res.status(403).json({ error: "Too many failed end-OTP attempts — locked. Contact admin." });
      return;
    }
    await db.update(tutorEngagementSessionsTable).set({ otpAttempts: newAttempts, updatedAt: now }).where(eq(tutorEngagementSessionsTable.id, sessionId));
    res.status(400).json({ error: "Incorrect end OTP", attemptsRemaining: OTP_MAX_ATTEMPTS - newAttempts });
    return;
  }

  const [updated] = await db
    .update(tutorEngagementSessionsTable)
    .set({ status: "completed", completedAt: now, otpAttempts: 0, updatedAt: now })
    .where(eq(tutorEngagementSessionsTable.id, sessionId))
    .returning();
  if (!updated) {
    console.error(`[tutor/session-end-otp] returning() came back empty for sessionId=${sessionId}`);
    res.status(500).json({ error: "update_failed" });
    return;
  }
  res.json(updated);
});

// ── Payment cadence — tutor is ALWAYS monthly ─────────────────────────────
// amountInr is never hardcoded — computed as perSessionFeeInr × count of
// completed sessions in the given month at the moment of marking.
const MarkTutorMonthPaidBody = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });

router.post("/tutor/engagements/:id/mark-month-paid", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = MarkTutorMonthPaidBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { month } = parsed.data;

  const { eng, role } = await getTutorEngagementWithAccess(id, req.userId!, req.userRole!);
  if (!eng || role !== "parent") { res.status(404).json({ error: "Engagement not found or access denied" }); return; }
  if (!eng.directPayEnabled) {
    res.status(409).json({ error: "direct_pay_disabled", message: "This engagement's sessions are paid through the platform. Use the pay-month flow instead." });
    return;
  }

  const [existing] = await db
    .select()
    .from(tutorEngagementPaymentConfirmationsTable)
    .where(and(eq(tutorEngagementPaymentConfirmationsTable.engagementId, id), eq(tutorEngagementPaymentConfirmationsTable.month, month)))
    .limit(1);
  if (existing) { res.status(409).json({ error: "This month has already been marked paid", confirmation: existing }); return; }

  const completedSessions = await db
    .select()
    .from(tutorEngagementSessionsTable)
    .where(and(eq(tutorEngagementSessionsTable.engagementId, id), eq(tutorEngagementSessionsTable.status, "completed"), sql`to_char(${tutorEngagementSessionsTable.sessionDate}::date, 'YYYY-MM') = ${month}`));
  const amountInr = eng.perSessionFeeInr * completedSessions.length;

  const [confirmation] = await db.insert(tutorEngagementPaymentConfirmationsTable).values({ engagementId: id, month, amountInr }).returning();
  if (!confirmation) {
    console.error(`[tutor/mark-month-paid] returning() came back empty for engagementId=${id}, month=${month}`);
    res.status(500).json({ error: "insert_failed" });
    return;
  }

  const proUserId = await getProfessionalUserId(eng.professionalId);
  if (proUserId) {
    void createInAppNotification(proUserId, {
      type: "month_payment_marked",
      title: "Parent marked this month as paid",
      body: `The parent marked ₹${amountInr.toLocaleString("en-IN")} as paid for ${month} (${completedSessions.length} completed session(s)). Confirm once received.`,
      relatedType: "engagement", relatedId: id,
    }).catch(() => {});
  }

  res.status(201).json(confirmation);
});

// ── GET /tutor/engagements/:id/payment-confirmations — professional-only,
// lists UNCONFIRMED direct-pay confirmations (confirmedAt IS NULL) so the
// professional can discover which confirmationId(s) are awaiting their
// confirm-received action below. Read-only, no writes. Same access-check
// convention (getTutorEngagementWithAccess) as every other endpoint in
// this file — restricted to the professional assigned to THIS engagement.
router.get("/tutor/engagements/:id/payment-confirmations", requireAuth, requireRole("professional"), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { eng, role } = await getTutorEngagementWithAccess(id, req.userId!, req.userRole!);
  if (!eng || role !== "professional") { res.status(404).json({ error: "Engagement not found or access denied" }); return; }

  const rows = await db
    .select()
    .from(tutorEngagementPaymentConfirmationsTable)
    .where(and(eq(tutorEngagementPaymentConfirmationsTable.engagementId, id), isNull(tutorEngagementPaymentConfirmationsTable.confirmedAt)))
    .orderBy(desc(tutorEngagementPaymentConfirmationsTable.month));

  res.json(rows);
});

router.post("/tutor/engagements/:id/payment-confirmations/:confirmationId/confirm-received", requireAuth, requireRole("professional"), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  const confirmationId = parseInt(req.params["confirmationId"] as string, 10);
  if (isNaN(id) || isNaN(confirmationId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { eng, role } = await getTutorEngagementWithAccess(id, req.userId!, req.userRole!);
  if (!eng || role !== "professional") { res.status(404).json({ error: "Engagement not found or access denied" }); return; }

  const [confirmation] = await db
    .select()
    .from(tutorEngagementPaymentConfirmationsTable)
    .where(and(eq(tutorEngagementPaymentConfirmationsTable.id, confirmationId), eq(tutorEngagementPaymentConfirmationsTable.engagementId, id)))
    .limit(1);
  if (!confirmation) { res.status(404).json({ error: "Payment confirmation not found" }); return; }
  if (confirmation.confirmedAt) { res.status(409).json({ error: "Already confirmed" }); return; }

  const [updated] = await db
    .update(tutorEngagementPaymentConfirmationsTable)
    .set({ confirmedAt: new Date() })
    .where(eq(tutorEngagementPaymentConfirmationsTable.id, confirmationId))
    .returning();
  if (!updated) {
    console.error(`[tutor/confirm-received] returning() came back empty for confirmationId=${confirmationId}`);
    res.status(500).json({ error: "update_failed" });
    return;
  }
  res.json(updated);
});

// ── GET /tutor/engagements/:id/direct-pay-info — verified VPA + amount for QR ─
// Direct mirror of salaryPayments.ts's GET /engagements/:id/direct-pay-info.
// Feeds the SAME UpiPayQRDialog frontend component shadow-teacher already
// uses (vpa/teacherName/amountInr props) — not rebuilt here, this endpoint
// just supplies its data for the tutor vertical. amountInr is computed the
// same way mark-month-paid computes it (perSessionFeeInr × completed
// sessions in the given month), since unlike shadow-teacher's flat
// monthlyFeeInr, a tutor's monthly total varies with sessions actually held.
router.get("/tutor/engagements/:id/direct-pay-info", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const month = typeof req.query["month"] === "string" ? req.query["month"] : null;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) { res.status(400).json({ error: "month query param is required (YYYY-MM)" }); return; }

  const { eng, role } = await getTutorEngagementWithAccess(id, req.userId!, req.userRole!);
  if (!eng || role !== "parent") { res.status(404).json({ error: "Engagement not found or access denied" }); return; }
  if (!eng.directPayEnabled) {
    res.status(409).json({ error: "direct_pay_disabled", message: "This engagement's sessions are paid through the platform." });
    return;
  }

  const [row] = await db
    .select({ upiVpa: professionalProfilesTable.upiVpa, upiVerifiedAt: professionalProfilesTable.upiVerifiedAt, professionalName: usersTable.fullName })
    .from(professionalProfilesTable)
    .innerJoin(usersTable, eq(usersTable.id, professionalProfilesTable.userId))
    .where(eq(professionalProfilesTable.id, eng.professionalId))
    .limit(1);

  const completedSessions = await db
    .select()
    .from(tutorEngagementSessionsTable)
    .where(and(eq(tutorEngagementSessionsTable.engagementId, id), eq(tutorEngagementSessionsTable.status, "completed"), sql`to_char(${tutorEngagementSessionsTable.sessionDate}::date, 'YYYY-MM') = ${month}`));
  const amountInr = eng.perSessionFeeInr * completedSessions.length;

  const verified = !!(row?.upiVpa && row?.upiVerifiedAt);
  res.json({ verified, vpa: verified ? row!.upiVpa : null, professionalName: row?.professionalName ?? null, amountInr });
});

// ═══════════════════════════════════════════════════════════════════════
// Razorpay-collect-and-remit path for ongoing tutor session payments —
// only reachable when this engagement's directPayEnabled snapshot is
// false (an admin deliberately switched tutorDirectPayEnabled off before
// this engagement committed).
//
// ⚠ COMPLIANCE FLAG: routing recurring session payments through the
// platform like this means Includly is now collecting and holding money
// on behalf of many tutors before remitting it — the exact
// salary-aggregation exposure (TDS/GST/aggregation obligations) that
// shadow-teacher's platformSalaryEnabled toggle exists to isolate behind
// an explicit admin decision, not something to flip on casually. Confirm
// with whoever owns compliance before setting tutorDirectPayEnabled=false
// in production. Direct-pay (the default) has none of this exposure — the
// platform never touches the money.
// ═══════════════════════════════════════════════════════════════════════
const PayTutorMonthBody = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });

router.post("/tutor/engagements/:id/pay-month", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = PayTutorMonthBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { month } = parsed.data;

  const { eng, role } = await getTutorEngagementWithAccess(id, req.userId!, req.userRole!);
  if (!eng || role !== "parent") { res.status(404).json({ error: "Engagement not found or access denied" }); return; }
  if (eng.directPayEnabled) {
    res.status(409).json({ error: "direct_pay_enabled", message: "This engagement's sessions are paid directly to the tutor. Use the mark-month-paid flow instead." });
    return;
  }

  const [existing] = await db
    .select()
    .from(tutorEngagementPlatformPaymentsTable)
    .where(and(eq(tutorEngagementPlatformPaymentsTable.engagementId, id), eq(tutorEngagementPlatformPaymentsTable.month, month)))
    .limit(1);
  if (existing?.status === "paid") { res.status(409).json({ error: `Month ${month} is already paid` }); return; }

  const completedSessions = await db
    .select()
    .from(tutorEngagementSessionsTable)
    .where(and(eq(tutorEngagementSessionsTable.engagementId, id), eq(tutorEngagementSessionsTable.status, "completed"), sql`to_char(${tutorEngagementSessionsTable.sessionDate}::date, 'YYYY-MM') = ${month}`));
  const gross = eng.perSessionFeeInr * completedSessions.length;

  // Trial credit computed once on first attempt, pinned on the row, reused on retry — same discipline as salaryPayments.ts.
  const trialCredit = existing
    ? existing.trialCreditInr
    : (!eng.trialCreditApplied && eng.trialCreditInr > 0 ? eng.trialCreditInr : 0);
  const chargeableGross = Math.max(0, gross - trialCredit);

  if (chargeableGross === 0) {
    if (trialCredit > 0) {
      await db.update(tutorEngagementsTable).set({ trialCreditApplied: true, updatedAt: new Date() }).where(eq(tutorEngagementsTable.id, id));
    }
    let paymentRecord;
    if (existing) {
      [paymentRecord] = await db.update(tutorEngagementPlatformPaymentsTable).set({ status: "paid", paidAt: new Date(), trialCreditInr: trialCredit, updatedAt: new Date() }).where(eq(tutorEngagementPlatformPaymentsTable.id, existing.id)).returning();
    } else {
      [paymentRecord] = await db.insert(tutorEngagementPlatformPaymentsTable).values({ engagementId: id, month, grossInr: gross, trialCreditInr: trialCredit, status: "paid", paidAt: new Date() }).returning();
    }
    if (!paymentRecord) {
      console.error(`[tutor/pay-month] returning() came back empty (waived path) for engagementId=${id}, month=${month}`);
      res.status(500).json({ error: "update_failed" });
      return;
    }
    res.status(201).json({ paymentId: paymentRecord.id, orderId: null, amount: 0, grossInr: gross, trialCreditInr: trialCredit, keyId: null });
    return;
  }

  const razorpay = getRazorpay();
  if (!razorpay) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  const order = await razorpay.orders.create({ amount: chargeableGross * 100, currency: "INR", notes: { engagementId: String(id), month, type: "tutor_ongoing_session_fee" } });

  let paymentRecord;
  if (existing) {
    [paymentRecord] = await db.update(tutorEngagementPlatformPaymentsTable).set({ razorpayOrderId: order.id as string, status: "pending", updatedAt: new Date() }).where(eq(tutorEngagementPlatformPaymentsTable.id, existing.id)).returning();
  } else {
    [paymentRecord] = await db.insert(tutorEngagementPlatformPaymentsTable).values({ engagementId: id, month, grossInr: gross, trialCreditInr: trialCredit, razorpayOrderId: order.id as string, status: "pending" }).returning();
  }
  if (!paymentRecord) {
    console.error(`[tutor/pay-month] returning() came back empty (order path) for engagementId=${id}, month=${month}`);
    res.status(500).json({ error: "update_failed" });
    return;
  }

  res.json({ paymentId: paymentRecord.id, orderId: order.id, amount: chargeableGross, grossInr: gross, trialCreditInr: trialCredit, keyId: process.env["RAZORPAY_KEY_ID"] });
});

const VerifyTutorMonthPaymentBody = z.object({ paymentId: z.number().int().positive(), razorpayPaymentId: z.string(), razorpayOrderId: z.string(), razorpaySignature: z.string() });

router.post("/tutor/engagements/:id/verify-month-payment", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = VerifyTutorMonthPaymentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { paymentId, razorpayPaymentId, razorpayOrderId, razorpaySignature } = parsed.data;
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keySecret) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  const [payment] = await db.select().from(tutorEngagementPlatformPaymentsTable).where(and(eq(tutorEngagementPlatformPaymentsTable.id, paymentId), eq(tutorEngagementPlatformPaymentsTable.engagementId, id))).limit(1);
  if (!payment) { res.status(404).json({ error: "Payment not found" }); return; }
  if (payment.razorpayOrderId !== razorpayOrderId) { res.status(400).json({ error: "Order ID mismatch" }); return; }

  const expectedSig = crypto.createHmac("sha256", keySecret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest("hex");
  if (expectedSig !== razorpaySignature) { res.status(400).json({ error: "Payment signature verification failed" }); return; }

  const [updated] = await db
    .update(tutorEngagementPlatformPaymentsTable)
    .set({ razorpayPaymentId, status: "paid", paidAt: new Date(), updatedAt: new Date() })
    .where(eq(tutorEngagementPlatformPaymentsTable.id, paymentId))
    .returning();
  if (!updated) {
    console.error(`[tutor/verify-month-payment] returning() came back empty for paymentId=${paymentId}`);
    res.status(500).json({ error: "update_failed" });
    return;
  }

  if (updated.trialCreditInr > 0) {
    await db.update(tutorEngagementsTable).set({ trialCreditApplied: true, updatedAt: new Date() }).where(eq(tutorEngagementsTable.id, id));
  }

  const [eng] = await db.select({ professionalId: tutorEngagementsTable.professionalId }).from(tutorEngagementsTable).where(eq(tutorEngagementsTable.id, id)).limit(1);
  if (eng) {
    const proUserId = await getProfessionalUserId(eng.professionalId);
    if (proUserId) {
      void createInAppNotification(proUserId, {
        type: "session_payment_collected",
        title: "Session payment received",
        body: `₹${updated.grossInr.toLocaleString("en-IN")} for ${updated.month} has been collected and will be remitted to you.`,
        relatedType: "engagement", relatedId: id,
      }).catch(() => {});
    }
  }

  res.json(updated);
});

export default router;
