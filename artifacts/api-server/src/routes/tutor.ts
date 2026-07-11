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
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { z } from "zod/v4";
import { rankCandidates, type MatchSnapshot } from "../lib/shadowTeacherScoring";
import { createInAppNotification } from "../lib/notificationService";
import { generateOtp } from "../lib/otp";
import { isOfferingListable } from "../lib/verificationRequirements";
import { SHOW_TUTOR_SEARCH } from "../lib/features";

const router: IRouter = Router();

// Server-side feature gate — applies to every route in this file. Returns
// 404 (not 403) when off, so nothing here is reachable even if a URL is
// guessed while the frontend is hidden. CROSS-REFERENCE: the frontend's own
// SHOW_TUTOR_SEARCH flag (artifacts/sensei-link/src/features.ts) does not
// share state with this one — both must be flipped together at launch.
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
          and(eq(professionalProfilesTable.vertical, "home_tutor"), eq(professionalProfilesTable.verificationStatus, "verified"), isNotNull(professionalProfilesTable.pricingMinINR)),
          and(isNotNull(professionalOfferingsTable.id), eq(professionalOfferingsTable.verificationStatus, "verified"), isNotNull(professionalOfferingsTable.pricingMinINR)),
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

  const settings = await getSettings();
  const trialFeeInr = settings.tutorTrialFeeInr * (match.trialDays ?? 1);
  const trialStartOtp = generateOtp();

  await db
    .update(tutorMatchesTable)
    .set({ status: "trial_pending", trialProviderPaymentId: razorpayPaymentId, trialFeePaidInr: trialFeeInr, selectedProfessionalId, trialStartOtp, updatedAt: new Date() })
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

export default router;
