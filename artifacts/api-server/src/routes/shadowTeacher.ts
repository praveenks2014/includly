import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, isNull, isNotNull, sql } from "drizzle-orm";
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
import { notifyMatchShortlisted, notifyMatchChatMessage } from "../lib/notificationService";

const router: IRouter = Router();

function getRazorpay() {
  const keyId = process.env["RAZORPAY_KEY_ID"];
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keyId || !keySecret) return null;
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

async function getSettings() {
  const [s] = await db.select().from(adminSettingsTable).limit(1);
  return s ?? { matchingFeeInr: 500, matchingFeeRefundable: true, tiersJson: null };
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

// ── GET /shadow-teacher/pricing — public: returns current matching fee ────────
router.get("/shadow-teacher/pricing", async (_req: Request, res: Response): Promise<void> => {
  const s = await getSettings();
  res.json({ matchingFeeInr: s.matchingFeeInr });
});

// ── POST /shadow-teacher/request — parent submits (new flow: no upfront fee) ─
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
    .select({ id: shadowTeacherMatchesTable.id, status: shadowTeacherMatchesTable.status })
    .from(shadowTeacherMatchesTable)
    .where(eq(shadowTeacherMatchesTable.parentId, req.userId!))
    .orderBy(desc(shadowTeacherMatchesTable.createdAt))
    .limit(1);
  if (existing[0] && !["cancelled", "refunded", "committed"].includes(existing[0].status)) {
    res.status(409).json({ error: "You already have an active shadow teacher request", matchId: existing[0].id });
    return;
  }

  // Fetch all verified shadow teachers
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
    childCity: child.city ?? null,
    childLat: null,
    childLng: null,
    childLanguages: child.languages ?? null,
    childBudgetMinInr: child.budgetMinInr ?? null,
    childBudgetMaxInr: child.budgetMaxInr ?? null,
    childPreferredModes: child.preferredModes ?? null,
  };

  const ranked = rankCandidates(snap, professionals, tiers, 3);

  // Insert match
  const [match] = await db
    .insert(shadowTeacherMatchesTable)
    .values({
      parentId: req.userId!,
      status: "shortlisted",
      matchingFeeInr: 0,
      childId: child.id,
      childCity: child.city ?? null,
      childConditions: child.conditions ?? null,
      childLanguages: child.languages ?? null,
      childBudgetMinInr: child.budgetMinInr ?? null,
      childBudgetMaxInr: child.budgetMaxInr ?? null,
      childGoalsAreas: child.goalsAreas ?? null,
      childPreferredModes: child.preferredModes ?? null,
      extraNotes: extraNotes ?? null,
    })
    .returning();

  // Insert candidates
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

    // Push notify teachers (fire-and-forget)
    const teacherUserIds = professionals
      .filter((p) => ranked.some((r) => r.professionalId === p.id))
      .map((p) => p.userId);
    void notifyMatchShortlisted(teacherUserIds).catch(() => {});
  }

  res.status(201).json({ matchId: match.id, candidateCount: ranked.length });
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
router.get("/shadow-teacher/my-request", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matches = await db
    .select()
    .from(shadowTeacherMatchesTable)
    .where(eq(shadowTeacherMatchesTable.parentId, req.userId!))
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

  if (!["shortlisted", "pending_commitment", "committed"].includes(match.status)) {
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

// ── POST /shadow-teacher/:matchId/commit — parent selects a teacher, create Razorpay order ─
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
  if (match.status !== "shortlisted") { res.status(400).json({ error: "Commitment is only allowed from shortlisted status" }); return; }

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
  if (!candidate) { res.status(404).json({ error: "Selected professional is not a candidate for this match" }); return; }

  // Block if teacher has no pricing
  const [teacher] = await db
    .select({ pricingMinINR: professionalProfilesTable.pricingMinINR, fullName: professionalProfilesTable.fullName })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, selectedProfessionalId));
  if (!teacher || teacher.pricingMinINR == null) {
    res.status(409).json({
      error: "commitment_blocked_no_pricing",
      message: "This teacher hasn't set their monthly fee yet. An admin can assign them manually once the fee is agreed.",
    });
    return;
  }

  const settings = await getSettings();
  const razorpay = getRazorpay();
  if (!razorpay) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  const amount = settings.matchingFeeInr * 100;
  const order = await razorpay.orders.create({
    amount,
    currency: "INR",
    receipt: `stcommit_${matchId}_${Date.now()}`,
    notes: { matchId: String(matchId), professionalId: String(selectedProfessionalId) },
  });

  await db
    .update(shadowTeacherMatchesTable)
    .set({
      status: "pending_commitment",
      selectedProfessionalId,
      providerOrderId: order.id as string,
      matchingFeeInr: settings.matchingFeeInr,
      updatedAt: new Date(),
    })
    .where(eq(shadowTeacherMatchesTable.id, matchId));

  res.json({
    orderId: order.id,
    amount,
    currency: "INR",
    keyId: process.env["RAZORPAY_KEY_ID"]!,
    teacherFirstName: teacher.fullName?.split(" ")[0] ?? "Teacher",
  });
});

// ── POST /shadow-teacher/:matchId/verify-commitment — HMAC verify, create engagement ─
const VerifyCommitmentBody = z.object({
  razorpayOrderId: z.string(),
  razorpayPaymentId: z.string(),
  razorpaySignature: z.string(),
});

router.post("/shadow-teacher/:matchId/verify-commitment", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }

  const parsed = VerifyCommitmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keySecret) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = parsed.data;

  const [match] = await db
    .select()
    .from(shadowTeacherMatchesTable)
    .where(and(eq(shadowTeacherMatchesTable.id, matchId), eq(shadowTeacherMatchesTable.parentId, req.userId!)));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }
  if (match.status !== "pending_commitment") { res.status(400).json({ error: "Match is not awaiting commitment payment" }); return; }
  if (match.providerOrderId !== razorpayOrderId) { res.status(400).json({ error: "Order ID mismatch" }); return; }

  const expectedSig = crypto.createHmac("sha256", keySecret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest("hex");
  if (expectedSig !== razorpaySignature) { res.status(400).json({ error: "Payment signature verification failed" }); return; }

  const proId = match.selectedProfessionalId!;
  const [teacher] = await db
    .select({ pricingMinINR: professionalProfilesTable.pricingMinINR, fullName: professionalProfilesTable.fullName, phone: professionalProfilesTable.phone, email: professionalProfilesTable.email })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, proId));
  if (!teacher) { res.status(404).json({ error: "Teacher not found" }); return; }

  // Safety net: teacher's pricing was cleared after commit but before engagement creation.
  // Auto-refund the matching fee (which was already captured) and reset the match so the
  // parent can re-commit to a different teacher. The pre-payment check in /commit makes
  // this path unreachable in normal operation.
  if (teacher.pricingMinINR == null) {
    const razorpay = getRazorpay();
    if (razorpay && match.providerPaymentId && match.matchingFeeInr > 0) {
      try {
        await (razorpay.payments as unknown as { refund: (id: string, opts: object) => Promise<unknown> })
          .refund(match.providerPaymentId, {
            amount: match.matchingFeeInr * 100,
            notes: { reason: "Teacher pricing unavailable at engagement creation" },
          });
      } catch (refundErr) {
        console.error("[verify-commitment] Auto-refund failed:", refundErr);
      }
    }
    await db
      .update(shadowTeacherMatchesTable)
      .set({ status: "shortlisted", selectedProfessionalId: null, providerOrderId: null, providerPaymentId: null, matchingFeeInr: 0, updatedAt: new Date() })
      .where(eq(shadowTeacherMatchesTable.id, matchId));
    res.status(409).json({
      error: "engagement_blocked_no_pricing",
      message: "This teacher's pricing is no longer available. Your matching fee has been refunded and you can select a different teacher.",
    });
    return;
  }

  // Create engagement
  const today = new Date().toISOString().split("T")[0]!;
  const [engagement] = await db
    .insert(shadowTeacherEngagementsTable)
    .values({
      parentId: match.parentId,
      professionalId: proId,
      childId: match.childId ?? null,
      matchRequestId: match.id,
      startDate: today,
      hoursPerWeek: 0,
      monthlyFeeInr: teacher.pricingMinINR!,
      status: "active",
    })
    .returning();

  // Update match status
  await db
    .update(shadowTeacherMatchesTable)
    .set({
      status: "committed",
      providerPaymentId: razorpayPaymentId,
      matchedAt: new Date(),
      matchedProfessionalId: proId,
      updatedAt: new Date(),
    })
    .where(eq(shadowTeacherMatchesTable.id, matchId));

  res.json({
    engagementId: engagement!.id,
    professionalFullName: teacher.fullName,
    phone: teacher.phone,
    email: teacher.email,
  });
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
