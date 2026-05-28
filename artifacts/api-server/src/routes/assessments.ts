import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import Razorpay from "razorpay";
import crypto from "crypto";
import {
  db,
  assessmentOfferingsTable,
  assessmentReportsTable,
  sessionBookingsTable,
  professionalProfilesTable,
  childrenTable,
  usersTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { createLedgerHeld, releaseWithCommission, refundToWallet, findLedgerByBooking } from "../lib/ledger";
import { z } from "zod";

const router: IRouter = Router();

function getRazorpay() {
  const keyId = process.env["RAZORPAY_KEY_ID"];
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keyId || !keySecret) return null;
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

// ── Rule-based diagnosis tag → specialty mapping ─────────────────────────────
const DIAGNOSIS_TO_SPECIALTIES: Record<string, string[]> = {
  autism:        ["occupational_therapy", "speech_therapy", "developmental_pediatrician"],
  asd:           ["occupational_therapy", "speech_therapy", "developmental_pediatrician"],
  speech:        ["speech_therapy"],
  language:      ["speech_therapy"],
  motor:         ["occupational_therapy"],
  sensory:       ["occupational_therapy"],
  adhd:          ["psychiatrist", "developmental_pediatrician"],
  attention:     ["psychiatrist", "developmental_pediatrician"],
  learning:      ["special_tutor"],
  dyslexia:      ["special_tutor"],
  behaviour:     ["psychiatrist", "occupational_therapy"],
  behavioral:    ["psychiatrist", "occupational_therapy"],
  developmental: ["developmental_pediatrician"],
  cognitive:     ["developmental_pediatrician"],
  intellectual:  ["developmental_pediatrician"],
  cerebral:      ["occupational_therapy", "developmental_pediatrician"],
  anxiety:       ["psychiatrist"],
  down:          ["developmental_pediatrician"],
};

function getSpecialtiesForTags(tags: string[]): string[] {
  const set = new Set<string>();
  for (const tag of tags) {
    const norm = tag.trim().toLowerCase();
    for (const [keyword, specialties] of Object.entries(DIAGNOSIS_TO_SPECIALTIES)) {
      if (norm.includes(keyword) || keyword.includes(norm)) {
        specialties.forEach((s) => set.add(s));
      }
    }
  }
  return Array.from(set);
}

// ── GET /professionals/:id/assessments ───────────────────────────────────────
router.get("/professionals/:id/assessments", async (req: Request, res: Response): Promise<void> => {
  const profId = parseInt(req.params["id"] as string, 10);
  if (isNaN(profId)) { res.status(400).json({ error: "Invalid professional id" }); return; }

  const offerings = await db
    .select()
    .from(assessmentOfferingsTable)
    .where(and(
      eq(assessmentOfferingsTable.professionalId, profId),
      eq(assessmentOfferingsTable.isActive, true),
    ))
    .orderBy(assessmentOfferingsTable.createdAt);

  res.json(offerings);
});

// ── GET /assessments/offerings/mine ──────────────────────────────────────────
router.get("/assessments/offerings/mine", requireAuth, requireRole("professional", "admin"), async (req: Request, res: Response): Promise<void> => {
  const [prof] = await db
    .select({ id: professionalProfilesTable.id })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, req.userId!));

  if (!prof) { res.status(404).json({ error: "Professional profile not found" }); return; }

  const offerings = await db
    .select()
    .from(assessmentOfferingsTable)
    .where(eq(assessmentOfferingsTable.professionalId, prof.id))
    .orderBy(assessmentOfferingsTable.createdAt);

  res.json(offerings);
});

// ── POST /assessments/offerings ──────────────────────────────────────────────
const CreateOfferingBody = z.object({
  title: z.string().min(1).max(200),
  assessmentType: z.string().min(1).max(100),
  description: z.string().optional(),
  durationMinutes: z.number().int().min(15).max(480).default(60),
  priceInr: z.number().int().min(0),
  whatIsIncluded: z.string().optional(),
});

router.post("/assessments/offerings", requireAuth, requireRole("professional", "admin"), async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateOfferingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [prof] = await db
    .select({ id: professionalProfilesTable.id })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, req.userId!));

  if (!prof) { res.status(404).json({ error: "Professional profile not found" }); return; }

  const [offering] = await db
    .insert(assessmentOfferingsTable)
    .values({ ...parsed.data, professionalId: prof.id })
    .returning();

  res.status(201).json(offering);
});

// ── PATCH /assessments/offerings/:id ─────────────────────────────────────────
const UpdateOfferingBody = z.object({
  title: z.string().min(1).max(200).optional(),
  assessmentType: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  durationMinutes: z.number().int().min(15).max(480).optional(),
  priceInr: z.number().int().min(0).optional(),
  whatIsIncluded: z.string().optional(),
  isActive: z.boolean().optional(),
});

router.patch("/assessments/offerings/:id", requireAuth, requireRole("professional", "admin"), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = UpdateOfferingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [prof] = await db
    .select({ id: professionalProfilesTable.id })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, req.userId!));

  if (!prof) { res.status(404).json({ error: "Professional profile not found" }); return; }

  const [existing] = await db
    .select({ id: assessmentOfferingsTable.id })
    .from(assessmentOfferingsTable)
    .where(and(
      eq(assessmentOfferingsTable.id, id),
      eq(assessmentOfferingsTable.professionalId, prof.id),
    ));

  if (!existing) { res.status(404).json({ error: "Offering not found" }); return; }

  const [updated] = await db
    .update(assessmentOfferingsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(assessmentOfferingsTable.id, id))
    .returning();

  res.json(updated);
});

// ── DELETE /assessments/offerings/:id ────────────────────────────────────────
router.delete("/assessments/offerings/:id", requireAuth, requireRole("professional", "admin"), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [prof] = await db
    .select({ id: professionalProfilesTable.id })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, req.userId!));

  if (!prof) { res.status(404).json({ error: "Professional profile not found" }); return; }

  const [existing] = await db
    .select({ id: assessmentOfferingsTable.id })
    .from(assessmentOfferingsTable)
    .where(and(
      eq(assessmentOfferingsTable.id, id),
      eq(assessmentOfferingsTable.professionalId, prof.id),
    ));

  if (!existing) { res.status(404).json({ error: "Offering not found" }); return; }

  await db
    .update(assessmentOfferingsTable)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(assessmentOfferingsTable.id, id));

  res.json({ success: true });
});

// ── POST /assessments/book ───────────────────────────────────────────────────
const BookAssessmentBody = z.object({
  professionalId: z.number().int().positive(),
  offeringId: z.number().int().positive(),
  bookedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  durationMinutes: z.number().int().positive(),
  childId: z.number().int().positive().optional(),
  notes: z.string().optional(),
});

router.post("/assessments/book", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = BookAssessmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { professionalId, offeringId, bookedDate, startTime, endTime, durationMinutes, childId, notes } = parsed.data;

  const [offering] = await db
    .select()
    .from(assessmentOfferingsTable)
    .where(and(
      eq(assessmentOfferingsTable.id, offeringId),
      eq(assessmentOfferingsTable.professionalId, professionalId),
      eq(assessmentOfferingsTable.isActive, true),
    ));

  if (!offering) { res.status(404).json({ error: "Assessment offering not found" }); return; }

  const [clash] = await db
    .select({ id: sessionBookingsTable.id })
    .from(sessionBookingsTable)
    .where(and(
      eq(sessionBookingsTable.professionalId, professionalId),
      eq(sessionBookingsTable.bookedDate, bookedDate),
      eq(sessionBookingsTable.startTime, startTime),
      eq(sessionBookingsTable.status, "confirmed"),
    ));

  if (clash) { res.status(400).json({ error: "This slot is already booked" }); return; }

  const razorpay = getRazorpay();
  if (!razorpay) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  const order = await razorpay.orders.create({
    amount: offering.priceInr * 100,
    currency: "INR",
    receipt: `assessment_${Date.now()}`,
  });

  const [booking] = await db
    .insert(sessionBookingsTable)
    .values({
      professionalId,
      parentId: req.userId!,
      bookedDate,
      startTime,
      endTime,
      durationMinutes,
      amountInr: offering.priceInr,
      commissionInr: 0,
      notes: notes ?? null,
      childId: childId ?? null,
      bookingType: "assessment",
      assessmentOfferingId: offeringId,
      providerOrderId: order.id as string,
    })
    .returning();

  res.json({
    assessmentId: booking.id,
    orderId: order.id,
    amount: offering.priceInr * 100,
    currency: "INR",
    keyId: process.env["RAZORPAY_KEY_ID"]!,
    offeringTitle: offering.title,
  });
});

// ── POST /assessments/verify-payment ─────────────────────────────────────────
const VerifyAssessmentPaymentBody = z.object({
  assessmentId: z.number().int().positive(),
  razorpayPaymentId: z.string(),
  razorpayOrderId: z.string(),
  razorpaySignature: z.string(),
});

router.post("/assessments/verify-payment", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = VerifyAssessmentPaymentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keySecret) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  const { assessmentId, razorpayPaymentId, razorpayOrderId, razorpaySignature } = parsed.data;

  const [booking] = await db
    .select()
    .from(sessionBookingsTable)
    .where(and(
      eq(sessionBookingsTable.id, assessmentId),
      eq(sessionBookingsTable.parentId, req.userId!),
    ));

  if (!booking) { res.status(404).json({ error: "Assessment booking not found" }); return; }
  if (booking.providerOrderId !== razorpayOrderId) { res.status(400).json({ error: "Order ID mismatch" }); return; }

  const expectedSig = crypto
    .createHmac("sha256", keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

  if (expectedSig !== razorpaySignature) { res.status(400).json({ error: "Payment signature verification failed" }); return; }

  const [confirmed] = await db
    .update(sessionBookingsTable)
    .set({ status: "confirmed", providerPaymentId: razorpayPaymentId, updatedAt: new Date() })
    .where(eq(sessionBookingsTable.id, assessmentId))
    .returning();

  void (async () => {
    try {
      const [prof] = await db
        .select({ userId: professionalProfilesTable.userId })
        .from(professionalProfilesTable)
        .where(eq(professionalProfilesTable.id, confirmed!.professionalId))
        .limit(1);
      await createLedgerHeld({
        bookingId: confirmed!.id,
        parentId: confirmed!.parentId,
        professionalUserId: prof?.userId ?? null,
        amountInr: confirmed!.amountInr,
        bookingType: "assessment",
      });
    } catch { /* ledger failure must never block payment response */ }
  })();

  res.json({ success: true, assessmentId: confirmed!.id });
});

// ── GET /assessments ──────────────────────────────────────────────────────────
router.get("/assessments", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const [user] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!));

  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  if (user.role === "professional" || user.role === "admin") {
    const [prof] = await db
      .select({ id: professionalProfilesTable.id })
      .from(professionalProfilesTable)
      .where(eq(professionalProfilesTable.userId, req.userId!));

    if (!prof) { res.json([]); return; }

    const bookings = await db
      .select({
        id: sessionBookingsTable.id,
        professionalId: sessionBookingsTable.professionalId,
        parentId: sessionBookingsTable.parentId,
        bookedDate: sessionBookingsTable.bookedDate,
        startTime: sessionBookingsTable.startTime,
        durationMinutes: sessionBookingsTable.durationMinutes,
        amountInr: sessionBookingsTable.amountInr,
        status: sessionBookingsTable.status,
        childId: sessionBookingsTable.childId,
        notes: sessionBookingsTable.notes,
        assessmentOfferingId: sessionBookingsTable.assessmentOfferingId,
        createdAt: sessionBookingsTable.createdAt,
        parentName: usersTable.fullName,
      })
      .from(sessionBookingsTable)
      .leftJoin(usersTable, eq(usersTable.id, sessionBookingsTable.parentId))
      .where(and(
        eq(sessionBookingsTable.professionalId, prof.id),
        eq(sessionBookingsTable.bookingType, "assessment"),
      ))
      .orderBy(desc(sessionBookingsTable.createdAt));

    res.json(bookings);
    return;
  }

  const bookings = await db
    .select({
      id: sessionBookingsTable.id,
      professionalId: sessionBookingsTable.professionalId,
      parentId: sessionBookingsTable.parentId,
      bookedDate: sessionBookingsTable.bookedDate,
      startTime: sessionBookingsTable.startTime,
      durationMinutes: sessionBookingsTable.durationMinutes,
      amountInr: sessionBookingsTable.amountInr,
      status: sessionBookingsTable.status,
      childId: sessionBookingsTable.childId,
      notes: sessionBookingsTable.notes,
      assessmentOfferingId: sessionBookingsTable.assessmentOfferingId,
      createdAt: sessionBookingsTable.createdAt,
      professionalName: professionalProfilesTable.fullName,
    })
    .from(sessionBookingsTable)
    .leftJoin(professionalProfilesTable, eq(professionalProfilesTable.id, sessionBookingsTable.professionalId))
    .where(and(
      eq(sessionBookingsTable.parentId, req.userId!),
      eq(sessionBookingsTable.bookingType, "assessment"),
    ))
    .orderBy(desc(sessionBookingsTable.createdAt));

  res.json(bookings);
});

// ── PATCH /assessments/:bookingId/status ──────────────────────────────────────
const UpdateAssessmentStatusBody = z.object({
  status: z.enum(["completed", "cancelled_by_parent", "cancelled_by_professional"]),
});

router.patch("/assessments/:bookingId/status", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const bookingId = parseInt(req.params["bookingId"] as string, 10);
  if (isNaN(bookingId)) { res.status(400).json({ error: "Invalid booking id" }); return; }

  const parsed = UpdateAssessmentStatusBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.userId!));

  const [booking] = await db
    .select()
    .from(sessionBookingsTable)
    .where(and(
      eq(sessionBookingsTable.id, bookingId),
      eq(sessionBookingsTable.bookingType, "assessment"),
    ));

  if (!booking) { res.status(404).json({ error: "Assessment booking not found" }); return; }

  const isParent = booking.parentId === req.userId!;
  const isProfOrAdmin = user?.role === "professional" || user?.role === "admin";
  if (!isParent && !isProfOrAdmin) { res.status(403).json({ error: "Forbidden" }); return; }

  const [updated] = await db
    .update(sessionBookingsTable)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(eq(sessionBookingsTable.id, bookingId))
    .returning();

  const ledger = await findLedgerByBooking(bookingId);
  if (ledger) {
    if (parsed.data.status === "completed") {
      void releaseWithCommission(ledger.id).catch(() => {});
    } else {
      void refundToWallet(ledger.id, `Assessment ${parsed.data.status.replace(/_/g, " ")}`).catch(() => {});
    }
  }

  res.json(updated);
});

// ── POST /assessments/:bookingId/report ───────────────────────────────────────
const SubmitReportBody = z.object({
  childId: z.number().int().positive().optional(),
  summary: z.string().optional(),
  observationNotes: z.string().optional(),
  recommendations: z.string().optional(),
  diagnosisTags: z.array(z.string()).optional(),
  reportFileKey: z.string().optional(),
  templateData: z.string().optional(),
  status: z.enum(["draft", "submitted"]).optional().default("draft"),
});

router.post("/assessments/:bookingId/report", requireAuth, requireRole("professional", "admin"), async (req: Request, res: Response): Promise<void> => {
  const bookingId = parseInt(req.params["bookingId"] as string, 10);
  if (isNaN(bookingId)) { res.status(400).json({ error: "Invalid booking id" }); return; }

  const parsed = SubmitReportBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [prof] = await db
    .select({ id: professionalProfilesTable.id })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, req.userId!));

  if (!prof) { res.status(404).json({ error: "Professional profile not found" }); return; }

  const [booking] = await db
    .select()
    .from(sessionBookingsTable)
    .where(and(
      eq(sessionBookingsTable.id, bookingId),
      eq(sessionBookingsTable.professionalId, prof.id),
      eq(sessionBookingsTable.bookingType, "assessment"),
    ));

  if (!booking) { res.status(404).json({ error: "Assessment booking not found" }); return; }

  const status = parsed.data.status ?? "draft";

  const [report] = await db
    .insert(assessmentReportsTable)
    .values({
      bookingId,
      childId: parsed.data.childId ?? booking.childId ?? null,
      professionalId: prof.id,
      parentId: booking.parentId,
      summary: parsed.data.summary ?? null,
      observationNotes: parsed.data.observationNotes ?? null,
      recommendations: parsed.data.recommendations ?? null,
      diagnosisTags: parsed.data.diagnosisTags ?? [],
      reportFileKey: parsed.data.reportFileKey ?? null,
      templateData: parsed.data.templateData ?? null,
      status,
      submittedAt: status === "submitted" ? new Date() : null,
    })
    .returning();

  res.status(201).json(report);
});

// ── PATCH /assessments/:bookingId/report ──────────────────────────────────────
const UpdateReportBody = z.object({
  summary: z.string().optional(),
  observationNotes: z.string().optional(),
  recommendations: z.string().optional(),
  diagnosisTags: z.array(z.string()).optional(),
  reportFileKey: z.string().optional(),
  templateData: z.string().optional(),
  status: z.enum(["draft", "submitted"]).optional(),
});

router.patch("/assessments/:bookingId/report", requireAuth, requireRole("professional", "admin"), async (req: Request, res: Response): Promise<void> => {
  const bookingId = parseInt(req.params["bookingId"] as string, 10);
  if (isNaN(bookingId)) { res.status(400).json({ error: "Invalid booking id" }); return; }

  const parsed = UpdateReportBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [prof] = await db
    .select({ id: professionalProfilesTable.id })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, req.userId!));

  if (!prof) { res.status(404).json({ error: "Professional profile not found" }); return; }

  const [existing] = await db
    .select()
    .from(assessmentReportsTable)
    .where(and(
      eq(assessmentReportsTable.bookingId, bookingId),
      eq(assessmentReportsTable.professionalId, prof.id),
    ));

  if (!existing) { res.status(404).json({ error: "Report not found — use POST to create first" }); return; }

  const updates: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  if (parsed.data.status === "submitted" && !existing.submittedAt) {
    updates["submittedAt"] = new Date();
  }

  const [updated] = await db
    .update(assessmentReportsTable)
    .set(updates)
    .where(eq(assessmentReportsTable.id, existing.id))
    .returning();

  res.json(updated);
});

// ── GET /children/:childId/reports ────────────────────────────────────────────
router.get("/children/:childId/reports", requireAuth, requireRole("parent", "admin"), async (req: Request, res: Response): Promise<void> => {
  const childId = parseInt(req.params["childId"] as string, 10);
  if (isNaN(childId)) { res.status(400).json({ error: "Invalid child id" }); return; }

  const [child] = await db
    .select({ id: childrenTable.id })
    .from(childrenTable)
    .where(and(
      eq(childrenTable.id, childId),
      eq(childrenTable.parentId, req.userId!),
    ));

  if (!child) { res.status(404).json({ error: "Child not found" }); return; }

  const reports = await db
    .select({
      id: assessmentReportsTable.id,
      bookingId: assessmentReportsTable.bookingId,
      childId: assessmentReportsTable.childId,
      professionalId: assessmentReportsTable.professionalId,
      parentId: assessmentReportsTable.parentId,
      reportType: assessmentReportsTable.reportType,
      summary: assessmentReportsTable.summary,
      observationNotes: assessmentReportsTable.observationNotes,
      recommendations: assessmentReportsTable.recommendations,
      diagnosisTags: assessmentReportsTable.diagnosisTags,
      reportFileKey: assessmentReportsTable.reportFileKey,
      templateData: assessmentReportsTable.templateData,
      status: assessmentReportsTable.status,
      submittedAt: assessmentReportsTable.submittedAt,
      createdAt: assessmentReportsTable.createdAt,
      updatedAt: assessmentReportsTable.updatedAt,
      professionalName: professionalProfilesTable.fullName,
    })
    .from(assessmentReportsTable)
    .leftJoin(professionalProfilesTable, eq(professionalProfilesTable.id, assessmentReportsTable.professionalId))
    .where(and(
      eq(assessmentReportsTable.childId, childId),
      eq(assessmentReportsTable.status, "submitted"),
    ))
    .orderBy(desc(assessmentReportsTable.submittedAt));

  res.json(reports);
});

// ── GET /assessments/matches/:childId ─────────────────────────────────────────
router.get("/assessments/matches/:childId", requireAuth, requireRole("parent", "admin"), async (req: Request, res: Response): Promise<void> => {
  const childId = parseInt(req.params["childId"] as string, 10);
  if (isNaN(childId)) { res.status(400).json({ error: "Invalid child id" }); return; }

  const [child] = await db
    .select()
    .from(childrenTable)
    .where(and(
      eq(childrenTable.id, childId),
      eq(childrenTable.parentId, req.userId!),
    ));

  if (!child) { res.status(404).json({ error: "Child not found" }); return; }

  const tags = (child.diagnosisTags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const matchedSpecialties = getSpecialtiesForTags(tags);

  if (matchedSpecialties.length === 0) { res.json([]); return; }

  const professionals = await db
    .select({
      id: professionalProfilesTable.id,
      fullName: professionalProfilesTable.fullName,
      specialty: professionalProfilesTable.specialty,
      city: professionalProfilesTable.city,
      averageRating: professionalProfilesTable.averageRating,
      totalRatings: professionalProfilesTable.totalRatings,
      isVerified: professionalProfilesTable.isVerified,
      pricingMinINR: professionalProfilesTable.pricingMinINR,
      pricingMaxINR: professionalProfilesTable.pricingMaxINR,
    })
    .from(professionalProfilesTable)
    .where(sql`${professionalProfilesTable.specialty} = ANY(ARRAY[${sql.join(matchedSpecialties.map(s => sql`${s}::specialty`), sql`, `)}])`)
    .limit(12);

  const profIds = professionals.map((p) => p.id);
  const allOfferings = profIds.length > 0
    ? await db
        .select()
        .from(assessmentOfferingsTable)
        .where(and(
          inArray(assessmentOfferingsTable.professionalId, profIds),
          eq(assessmentOfferingsTable.isActive, true),
        ))
    : [];

  const byProfId = allOfferings.reduce<Record<number, typeof allOfferings>>((acc, o) => {
    if (!acc[o.professionalId]) acc[o.professionalId] = [];
    acc[o.professionalId]!.push(o);
    return acc;
  }, {});

  res.json(professionals.map((p) => ({ ...p, assessments: byProfId[p.id] ?? [] })));
});

export default router;
