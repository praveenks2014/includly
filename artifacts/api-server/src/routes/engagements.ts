import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  shadowTeacherEngagementsTable,
  shadowTeacherMatchesTable,
  engagementLogsTable,
  professionalProfilesTable,
  usersTable,
  childrenTable,
  shadowMatchCandidatesTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { createLedgerHeld } from "../lib/ledger";
import { createInAppNotification } from "../lib/notificationService";
import { z } from "zod";

const router: IRouter = Router();

const CreateEngagementBody = z.object({
  professionalId: z.number().int().positive(),
  childId:        z.number().int().positive().optional(),
  matchRequestId: z.number().int().positive().optional(),
  startDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hoursPerWeek:   z.number().int().min(1).max(40),
  monthlyFeeInr:  z.number().int().min(0),
  notes:          z.string().optional(),
});

const LogWeekBody = z.object({
  weekStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hoursLogged: z.number().int().min(0).max(100),
  notes: z.string().optional(),
});

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

router.get("/engagements", requireAuth, async (req, res): Promise<void> => {
  const isParent = req.userRole === "parent";

  if (isParent) {
    const rows = await db
      .select({
        id: shadowTeacherEngagementsTable.id,
        parentId: shadowTeacherEngagementsTable.parentId,
        professionalId: shadowTeacherEngagementsTable.professionalId,
        childId: shadowTeacherEngagementsTable.childId,
        startDate: shadowTeacherEngagementsTable.startDate,
        hoursPerWeek: shadowTeacherEngagementsTable.hoursPerWeek,
        monthlyFeeInr: shadowTeacherEngagementsTable.monthlyFeeInr,
        status: shadowTeacherEngagementsTable.status,
        nextBillingDate: shadowTeacherEngagementsTable.nextBillingDate,
        billedThroughDate: shadowTeacherEngagementsTable.billedThroughDate,
        notes: shadowTeacherEngagementsTable.notes,
        createdAt: shadowTeacherEngagementsTable.createdAt,
        startOtp: shadowTeacherEngagementsTable.startOtp,
        professionalName: professionalProfilesTable.fullName,
        professionalSpecialty: professionalProfilesTable.specialty,
        childName: childrenTable.name,
      })
      .from(shadowTeacherEngagementsTable)
      .leftJoin(professionalProfilesTable, eq(shadowTeacherEngagementsTable.professionalId, professionalProfilesTable.id))
      .leftJoin(childrenTable, eq(shadowTeacherEngagementsTable.childId, childrenTable.id))
      .where(eq(shadowTeacherEngagementsTable.parentId, req.userId!))
      .orderBy(desc(shadowTeacherEngagementsTable.createdAt));
    const today = new Date().toISOString().slice(0, 10);
    const safeRows = rows.map(r => ({
      ...r,
      startOtp: r.startOtp && r.startDate <= today ? r.startOtp : null,
    }));
    res.json(safeRows);
    return;
  }

  const [prof] = await db
    .select({ id: professionalProfilesTable.id })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, req.userId!))
    .limit(1);

  if (!prof) { res.json([]); return; }

  const rows = await db
    .select({
      id:               shadowTeacherEngagementsTable.id,
      parentId:         shadowTeacherEngagementsTable.parentId,
      professionalId:   shadowTeacherEngagementsTable.professionalId,
      childId:          shadowTeacherEngagementsTable.childId,
      matchRequestId:   shadowTeacherEngagementsTable.matchRequestId,
      tier:             shadowTeacherEngagementsTable.tier,
      startDate:        shadowTeacherEngagementsTable.startDate,
      monthlyFeeInr:    shadowTeacherEngagementsTable.monthlyFeeInr,
      status:           shadowTeacherEngagementsTable.status,
      notes:            shadowTeacherEngagementsTable.notes,
      createdAt:        shadowTeacherEngagementsTable.createdAt,
      parentName:       usersTable.fullName,
      childName:        childrenTable.name,
      childConditions:  childrenTable.conditions,
      childLanguages:   childrenTable.languages,
      childCity:        childrenTable.city,
      childConsent:     childrenTable.consent,
      candidateId:      shadowMatchCandidatesTable.id,
    })
    .from(shadowTeacherEngagementsTable)
    .leftJoin(usersTable, eq(shadowTeacherEngagementsTable.parentId, usersTable.id))
    .leftJoin(childrenTable, eq(shadowTeacherEngagementsTable.childId, childrenTable.id))
    .leftJoin(
      shadowMatchCandidatesTable,
      and(
        eq(shadowMatchCandidatesTable.matchId, shadowTeacherEngagementsTable.matchRequestId),
        eq(shadowMatchCandidatesTable.professionalId, prof.id),
      ),
    )
    .where(eq(shadowTeacherEngagementsTable.professionalId, prof.id))
    .orderBy(desc(shadowTeacherEngagementsTable.createdAt));
  res.json(rows);
});

router.post("/engagements", requireAuth, requireRole("parent"), async (req, res): Promise<void> => {
  const parsed = CreateEngagementBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { professionalId, childId, matchRequestId, startDate, hoursPerWeek, monthlyFeeInr, notes } = parsed.data;

  const nextBillingDate = addMonths(startDate, 1);

  // ── Auto carry-over: trial fee paid on the match → first-month salary credit ─
  // Automatically reads match.trialFeePaidInr and sets engagement.trialCreditInr.
  // No admin action needed. Ownership check (parentId = req.userId) prevents spoofing.
  let trialCreditInr = 0;
  if (matchRequestId) {
    const [match] = await db
      .select({ trialFeePaidInr: shadowTeacherMatchesTable.trialFeePaidInr })
      .from(shadowTeacherMatchesTable)
      .where(and(
        eq(shadowTeacherMatchesTable.id, matchRequestId),
        eq(shadowTeacherMatchesTable.parentId, req.userId!),
      ))
      .limit(1);
    trialCreditInr = match?.trialFeePaidInr ?? 0;
  }

  const [engagement] = await db
    .insert(shadowTeacherEngagementsTable)
    .values({
      parentId: req.userId!,
      professionalId,
      childId: childId ?? null,
      matchRequestId: matchRequestId ?? null,
      startDate,
      hoursPerWeek,
      monthlyFeeInr,
      notes: notes ?? null,
      nextBillingDate,
      trialCreditInr,
      status: "active",
    })
    .returning();

  const [prof] = await db
    .select({ userId: professionalProfilesTable.userId })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, professionalId))
    .limit(1);

  if (monthlyFeeInr > 0) {
    await createLedgerHeld({
      engagementId: engagement!.id,
      parentId: req.userId!,
      professionalUserId: prof?.userId ?? null,
      amountInr: monthlyFeeInr,
      bookingType: "engagement",
    });
  }

  res.status(201).json(engagement);
});

router.patch("/engagements/:id/status", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { status } = req.body ?? {};
  if (!["active", "paused", "ended"].includes(status)) {
    res.status(400).json({ error: "status must be active | paused | ended" });
    return;
  }

  const [existing] = await db
    .select()
    .from(shadowTeacherEngagementsTable)
    .where(eq(shadowTeacherEngagementsTable.id, id))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Engagement not found" }); return; }

  const canEdit =
    req.userRole === "admin" ||
    existing.parentId === req.userId! ||
    (await isProfessionalOwner(existing.professionalId, req.userId!));

  if (!canEdit) { res.status(403).json({ error: "Access denied" }); return; }

  // paused / active transitions must go through the mutual-consent lifecycle flow;
  // only admins may force-set these directly.
  if (["paused", "active"].includes(status) && req.userRole !== "admin") {
    res.status(403).json({ error: "Use the lifecycle consent flow to pause or resume an engagement" });
    return;
  }

  const [updated] = await db
    .update(shadowTeacherEngagementsTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(shadowTeacherEngagementsTable.id, id))
    .returning();

  res.json(updated);
});

router.post("/engagements/:id/bill", requireAuth, requireRole("admin"), async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [engagement] = await db
    .select()
    .from(shadowTeacherEngagementsTable)
    .where(and(eq(shadowTeacherEngagementsTable.id, id), eq(shadowTeacherEngagementsTable.status, "active")))
    .limit(1);

  if (!engagement) { res.status(404).json({ error: "Active engagement not found" }); return; }

  const [prof] = await db
    .select({ userId: professionalProfilesTable.userId })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, engagement.professionalId))
    .limit(1);

  const ledgerId = await createLedgerHeld({
    engagementId: id,
    parentId: engagement.parentId,
    professionalUserId: prof?.userId ?? null,
    amountInr: engagement.monthlyFeeInr,
    bookingType: "engagement",
  });

  const newNextBilling = addMonths(engagement.nextBillingDate ?? engagement.startDate, 1);

  await db
    .update(shadowTeacherEngagementsTable)
    .set({
      billedThroughDate: engagement.nextBillingDate,
      nextBillingDate: newNextBilling,
      updatedAt: new Date(),
    })
    .where(eq(shadowTeacherEngagementsTable.id, id));

  res.json({ ledgerId, nextBillingDate: newNextBilling });
});

router.get("/engagements/:id/logs", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const rows = await db
    .select()
    .from(engagementLogsTable)
    .where(eq(engagementLogsTable.engagementId, id))
    .orderBy(desc(engagementLogsTable.createdAt));

  res.json(rows);
});

router.post("/engagements/:id/logs", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { weekStartDate, hoursLogged, notes } = LogWeekBody.parse(req.body);

  const [row] = await db
    .insert(engagementLogsTable)
    .values({ engagementId: id, weekStartDate, hoursLogged, notes: notes ?? null, loggedByUserId: req.userId! })
    .returning();

  res.status(201).json(row);
});

// ── POST /engagements/:id/confirm-start — teacher enters parent's start code to activate engagement ──
router.post("/engagements/:id/confirm-start", requireAuth, requireRole("professional"), async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { otp } = (req.body ?? {}) as { otp?: string };
  if (typeof otp !== "string" || otp.trim().length === 0) { res.status(400).json({ error: "Start code required" }); return; }

  const [prof] = await db
    .select({ id: professionalProfilesTable.id, userId: professionalProfilesTable.userId })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, req.userId!))
    .limit(1);
  if (!prof) { res.status(403).json({ error: "Professional profile not found" }); return; }

  const [engagement] = await db
    .select()
    .from(shadowTeacherEngagementsTable)
    .where(and(
      eq(shadowTeacherEngagementsTable.id, id),
      eq(shadowTeacherEngagementsTable.professionalId, prof.id),
    ))
    .limit(1);
  if (!engagement) { res.status(404).json({ error: "Engagement not found" }); return; }
  if (engagement.status !== "pending_start") { res.status(409).json({ error: "Engagement is not awaiting start confirmation" }); return; }
  if (!engagement.startOtp || engagement.startOtp !== otp.trim()) {
    res.status(400).json({ error: "Incorrect start code" }); return;
  }

  const today = new Date().toISOString().slice(0, 10);
  if (engagement.startDate > today) {
    res.status(400).json({ error: `Start date is ${engagement.startDate} — you can confirm on or after that date` }); return;
  }

  const [updated] = await db
    .update(shadowTeacherEngagementsTable)
    .set({ status: "active", startOtp: null, updatedAt: new Date() })
    .where(eq(shadowTeacherEngagementsTable.id, id))
    .returning();

  if (engagement.monthlyFeeInr > 0) {
    await createLedgerHeld({
      engagementId: id,
      parentId: engagement.parentId,
      professionalUserId: prof.userId ?? null,
      amountInr: engagement.monthlyFeeInr,
      bookingType: "engagement",
    });
  }

  // Notify parent that engagement is now active
  try {
    await createInAppNotification(engagement.parentId, {
      type: "engagement_active",
      title: "Engagement is now active!",
      body: "Your teacher has confirmed the start code. The engagement is officially underway.",
      relatedType: "engagement",
      relatedId: id,
    });
  } catch { /* non-blocking */ }

  res.json(updated);
});

async function isProfessionalOwner(professionalId: number, userId: number): Promise<boolean> {
  const [prof] = await db
    .select({ id: professionalProfilesTable.id })
    .from(professionalProfilesTable)
    .where(and(eq(professionalProfilesTable.id, professionalId), eq(professionalProfilesTable.userId, userId)))
    .limit(1);
  return !!prof;
}

export default router;
