import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, isNull, isNotNull, sql, count, max, inArray } from "drizzle-orm";
import Razorpay from "razorpay";
import crypto from "crypto";
import {
  db,
  shadowTeacherMatchesTable,
  shadowMatchCandidatesTable,
  shadowMatchThreadsTable,
  shadowMatchMessagesTable,
  shadowTeacherEngagementsTable,
  adminSettingsTable,
  usersTable,
  professionalProfilesTable,
  childrenTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { z } from "zod/v4";
import { rankCandidates, maskBody, type MatchSnapshot, type TierDef } from "../lib/shadowTeacherScoring";
import { notifyMatchShortlisted, notifyMatchChatMessage, notifyParentOnTrialDone } from "../lib/notificationService";

const router: IRouter = Router();

function getRazorpay() {
  const keyId = process.env["RAZORPAY_KEY_ID"];
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keyId || !keySecret) return null;
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

async function getSettings() {
  const [s] = await db.select().from(adminSettingsTable).limit(1);
  return s ?? { matchingFeeInr: 500, matchingFeeRefundable: true, tiersJson: null, trialFeeInr: 500 };
}

function parseTiers(tiersJson: string | null): TierDef[] {
  if (!tiersJson) return [];
  try { return JSON.parse(tiersJson) as TierDef[]; } catch { return []; }
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

// ── GET /shadow-teacher/pricing — public: returns matching fee + trial fee ────
router.get("/shadow-teacher/pricing", async (_req: Request, res: Response): Promise<void> => {
  const s = await getSettings();
  res.json({ matchingFeeInr: s.matchingFeeInr, trialFeeInr: (s as Record<string, unknown>)["trialFeeInr"] as number ?? 500 });
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

  // Prevent duplicate active requests
  const existing = await db
    .select()
    .from(shadowTeacherMatchesTable)
    .where(eq(shadowTeacherMatchesTable.parentId, req.userId!))
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

  // Run scoring and surface up to 3 candidates
  const professionals = await db
    .select()
    .from(professionalProfilesTable)
    .where(
      and(
        eq(professionalProfilesTable.specialty, "shadow_teacher"),
        eq(professionalProfilesTable.verificationStatus, "verified"),
        isNotNull(professionalProfilesTable.pricingMinINR),
      ),
    );

  const settings = await getSettings();
  const tiers = parseTiers(settings.tiersJson);
  const snap: MatchSnapshot = {
    childCity: match.childCity ?? null,
    childLat: null,
    childLng: null,
    childLanguages: match.childLanguages ?? null,
    childBudgetMinInr: match.childBudgetMinInr ?? null,
    childBudgetMaxInr: match.childBudgetMaxInr ?? null,
    childPreferredModes: match.childPreferredModes ?? null,
  };

  const ranked = rankCandidates(snap, professionals, tiers, 3);
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

    // Push notify teachers (fire-and-forget)
    const teacherUserIds = professionals
      .filter((p) => ranked.some((r) => r.professionalId === p.id))
      .map((p) => p.userId);
    void notifyMatchShortlisted(teacherUserIds).catch(() => {});
  }

  // Set high-water-mark counter (never decrements from here)
  await db
    .update(shadowTeacherMatchesTable)
    .set({ distinctTeachersShown: candidateCount })
    .where(eq(shadowTeacherMatchesTable.id, matchId));

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
  const match = matches[0]!;
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

  const candidates = await db
    .select({
      candidateId: shadowMatchCandidatesTable.id,
      matchId:     shadowMatchCandidatesTable.matchId,
      createdAt:   shadowMatchCandidatesTable.createdAt,
      matchStatus:            shadowTeacherMatchesTable.status,
      selectedProfessionalId: shadowTeacherMatchesTable.selectedProfessionalId,
      childCity:              shadowTeacherMatchesTable.childCity,
      childConditions:        shadowTeacherMatchesTable.childConditions,
      childBudgetMinInr:      shadowTeacherMatchesTable.childBudgetMinInr,
      childBudgetMaxInr:      shadowTeacherMatchesTable.childBudgetMaxInr,
      childPreferredModes:    shadowTeacherMatchesTable.childPreferredModes,
      childGoalsAreas:        shadowTeacherMatchesTable.childGoalsAreas,
      preMeetingRequested:    shadowTeacherMatchesTable.preMeetingRequested,
      preMeetingNote:         shadowTeacherMatchesTable.preMeetingNote,
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
      childBudgetMinInr:   c.childBudgetMinInr  !== null ? Number(c.childBudgetMinInr)  : null,
      childBudgetMaxInr:   c.childBudgetMaxInr  !== null ? Number(c.childBudgetMaxInr)  : null,
      childPreferredModes: c.childPreferredModes ?? [],
      childGoalsAreas:        c.childGoalsAreas       ?? null,
      preMeetingRequested:    c.preMeetingRequested   ?? false,
      preMeetingNote:         c.preMeetingNote        ?? null,
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
    : messages.map((m) => ({ ...m, body: maskBody(m.body) }));

  res.json({ threadId: thread.id, committed, messages: maskedMessages });
});

// ── POST /shadow-teacher/:matchId/thread/:candidateId — send message ─
const SendMessageBody = z.object({ body: z.string().min(1).max(5000) });

router.post("/shadow-teacher/:matchId/thread/:candidateId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  const candidateId = parseInt(req.params["candidateId"] as string, 10);
  if (isNaN(matchId) || isNaN(candidateId)) { res.status(400).json({ error: "Invalid params" }); return; }

  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [match] = await db.select().from(shadowTeacherMatchesTable).where(eq(shadowTeacherMatchesTable.id, matchId));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }

  if (!["shortlisted", "pending_commitment", "committed", "trial_pending", "trial_done"].includes(match.status)) {
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

  const [message] = await db
    .insert(shadowMatchMessagesTable)
    .values({ threadId: thread.id, senderId: req.userId!, body: parsed.data.body })
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

  const body = committed ? message!.body : maskBody(message!.body);
  res.status(201).json({ ...message, body });
});

// ── POST /shadow-teacher/:matchId/commit — parent selects a teacher (FREE — matching fee already paid at request) ─
const CommitBody = z.object({ selectedProfessionalId: z.number().int().positive() });

router.post("/shadow-teacher/:matchId/commit", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }

  const parsed = CommitBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { selectedProfessionalId } = parsed.data;

  const [match] = await db
    .select()
    .from(shadowTeacherMatchesTable)
    .where(and(eq(shadowTeacherMatchesTable.id, matchId), eq(shadowTeacherMatchesTable.parentId, req.userId!)));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }
  if (!["shortlisted", "trial_done"].includes(match.status)) { res.status(400).json({ error: "Commitment is only allowed from shortlisted or trial_done status" }); return; }

  // Verify the professional is an active candidate
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

  // Load teacher — block if no pricing set
  const [teacher] = await db
    .select({ pricingMinINR: professionalProfilesTable.pricingMinINR, fullName: professionalProfilesTable.fullName, phone: professionalProfilesTable.phone, email: professionalProfilesTable.email })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, selectedProfessionalId));
  if (!teacher || teacher.pricingMinINR == null) {
    res.status(409).json({
      error: "commitment_blocked_no_pricing",
      message: "This teacher hasn't set their monthly fee yet. An admin can assign them manually once the fee is agreed.",
    });
    return;
  }

  // Create engagement — no Razorpay call; matching fee was already captured at request time.
  // If a trial fee was paid, carry it forward as a credit on the first salary payment.
  const today = new Date().toISOString().split("T")[0]!;
  const [engagement] = await db
    .insert(shadowTeacherEngagementsTable)
    .values({
      parentId: match.parentId,
      professionalId: selectedProfessionalId,
      childId: match.childId ?? null,
      matchRequestId: match.id,
      startDate: today,
      hoursPerWeek: 0,
      monthlyFeeInr: teacher.pricingMinINR!,
      trialCreditInr: match.trialFeePaidInr ?? 0,
      status: "active",
    })
    .returning();

  // Transition match to committed — permanently refund-ineligible from this point
  await db
    .update(shadowTeacherMatchesTable)
    .set({
      status: "committed",
      selectedProfessionalId,
      matchedAt: new Date(),
      matchedProfessionalId: selectedProfessionalId,
      updatedAt: new Date(),
    })
    .where(eq(shadowTeacherMatchesTable.id, matchId));

  res.json({
    engagementId: engagement!.id,
    teacherFullName: teacher.fullName,
    phone: teacher.phone,
    email: teacher.email,
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
  const trialFeeInr = (settings as Record<string, unknown>)["trialFeeInr"] as number ?? 500;

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
});

router.post("/shadow-teacher/:matchId/verify-trial-payment", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }

  const parsed = VerifyTrialPaymentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keySecret) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  const { razorpayOrderId, razorpayPaymentId, razorpaySignature, selectedProfessionalId, preMeetingRequested, preMeetingNote } = parsed.data;

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

  const settings = await getSettings();
  const trialFeeInr = (settings as Record<string, unknown>)["trialFeeInr"] as number ?? 500;

  await db
    .update(shadowTeacherMatchesTable)
    .set({
      status: "trial_pending",
      trialProviderPaymentId: razorpayPaymentId,
      trialFeePaidInr: trialFeeInr,
      selectedProfessionalId,
      preMeetingRequested,
      preMeetingNote: preMeetingRequested ? (preMeetingNote ?? null) : null,
      updatedAt: new Date(),
    })
    .where(eq(shadowTeacherMatchesTable.id, matchId));

  res.json({ matchId, status: "trial_pending" });
});

// ── POST /shadow-teacher/:matchId/mark-trial-done ────────────────────────────
// Either the parent OR the selected teacher can mark the trial day complete.
// Transitions trial_pending → trial_done.
router.post("/shadow-teacher/:matchId/mark-trial-done", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }

  const [match] = await db.select().from(shadowTeacherMatchesTable).where(eq(shadowTeacherMatchesTable.id, matchId));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }
  if (match.status !== "trial_pending") { res.status(400).json({ error: "Trial is not in progress" }); return; }

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

    const candidates = await db
      .select()
      .from(professionalProfilesTable)
      .where(
        and(
          eq(professionalProfilesTable.specialty, "shadow_teacher"),
          eq(professionalProfilesTable.verificationStatus, "verified"),
          isNotNull(professionalProfilesTable.pricingMinINR),
          excludeIds.length > 0
            ? sql`${professionalProfilesTable.id} != ALL(${sql.raw(`ARRAY[${excludeIds.join(",")}]::int[]`)})`
            : sql`true`,
        ),
      );

    if (candidates.length > 0) {
      const settings = await getSettings();
      const tiers = parseTiers(settings.tiersJson);
      const snap: MatchSnapshot = {
        childCity: match.childCity ?? null,
        childLat: null,
        childLng: null,
        childLanguages: match.childLanguages ?? null,
        childBudgetMinInr: match.childBudgetMinInr ?? null,
        childBudgetMaxInr: match.childBudgetMaxInr ?? null,
        childPreferredModes: match.childPreferredModes ?? null,
      };

      const [maxRankRow] = await db
        .select({ maxRank: sql<number>`max(rank)` })
        .from(shadowMatchCandidatesTable)
        .where(eq(shadowMatchCandidatesTable.matchId, matchId));
      const nextRank = (maxRankRow?.maxRank ?? 0) + 1;

      const ranked = rankCandidates(snap, candidates, tiers, 1);
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
    })
    .from(shadowTeacherMatchesTable)
    .leftJoin(usersTable, eq(shadowTeacherMatchesTable.parentId, usersTable.id))
    .leftJoin(professionalProfilesTable, eq(shadowTeacherMatchesTable.matchedProfessionalId, professionalProfilesTable.id))
    .orderBy(desc(shadowTeacherMatchesTable.createdAt));

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
