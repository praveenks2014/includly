import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import Razorpay from "razorpay";
import crypto from "crypto";
import {
  db,
  shadowTeacherEngagementsTable,
  engagementSalaryPaymentsTable,
  engagementSalaryConfirmationsTable,
  adminSettingsTable,
  professionalProfilesTable,
  usersTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { createInAppNotification } from "../lib/notificationService";
import { z } from "zod";

const router: IRouter = Router();

function getRazorpay() {
  const keyId = process.env["RAZORPAY_KEY_ID"];
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keyId || !keySecret) return null;
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

async function getSettings() {
  const [s] = await db.select().from(adminSettingsTable).limit(1);
  return s ?? { salaryPlatformCutPct: 10 };
}

async function getEngagementForParent(engagementId: number, parentId: number) {
  const [eng] = await db
    .select()
    .from(shadowTeacherEngagementsTable)
    .where(and(eq(shadowTeacherEngagementsTable.id, engagementId), eq(shadowTeacherEngagementsTable.parentId, parentId)))
    .limit(1);
  return eng ?? null;
}

const InitSalaryPaymentBody = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
});

const VerifySalaryPaymentBody = z.object({
  paymentId: z.number().int().positive(),
  razorpayPaymentId: z.string(),
  razorpayOrderId: z.string(),
  razorpaySignature: z.string(),
});

// POST /engagements/:id/pay-salary — parent initiates a monthly salary payment
router.post("/engagements/:id/pay-salary", requireAuth, requireRole("parent"), async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = InitSalaryPaymentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const eng = await getEngagementForParent(id, req.userId!);
  if (!eng) { res.status(404).json({ error: "Engagement not found" }); return; }
  if (!["active", "notice_period"].includes(eng.status)) {
    res.status(409).json({ error: "Engagement is not active" });
    return;
  }
  if (!eng.platformSalaryEnabled) {
    res.status(409).json({ error: "platform_salary_disabled", message: "This engagement's salary is paid directly to the teacher. Use the salary-confirmations flow instead." });
    return;
  }

  const { month } = parsed.data;

  // Check if already paid (or pending) for this month — include trialCreditInr
  // so retries can reuse the amount already pinned to the pending record
  const [existing] = await db
    .select({
      id:             engagementSalaryPaymentsTable.id,
      status:         engagementSalaryPaymentsTable.status,
      trialCreditInr: engagementSalaryPaymentsTable.trialCreditInr,
    })
    .from(engagementSalaryPaymentsTable)
    .where(and(eq(engagementSalaryPaymentsTable.engagementId, id), eq(engagementSalaryPaymentsTable.month, month)))
    .limit(1);

  if (existing?.status === "paid") {
    res.status(409).json({ error: `Month ${month} is already paid` });
    return;
  }

  const settings = await getSettings();
  const gross = eng.monthlyFeeInr;
  const platformCut = Math.round(gross * (settings.salaryPlatformCutPct / 100));
  const net = gross - platformCut;

  // ── Trial credit: computed once on first attempt, reused on retry ────────────
  // On a failed/abandoned payment the parent retries → `existing` is the pending
  // record from the first attempt, already carrying trialCreditInr.
  // We read credit from that stored value so every order for this month is for the
  // same chargeableGross — no second subtraction is possible across retries.
  const trialCredit: number = existing
    ? (existing.trialCreditInr ?? 0)                               // retry: reuse pinned amount
    : (!eng.trialCreditApplied && eng.trialCreditInr > 0           // first attempt: compute fresh
        ? eng.trialCreditInr : 0);

  const chargeableGross = Math.max(0, gross - trialCredit);

  // ── ₹0 path: credit covers the full month — skip Razorpay ──────────────────
  if (chargeableGross === 0) {
    if (trialCredit > 0) {
      await db.update(shadowTeacherEngagementsTable)
        .set({ trialCreditApplied: true, updatedAt: new Date() })
        .where(eq(shadowTeacherEngagementsTable.id, id));
    }
    let paymentRecord;
    if (existing) {
      [paymentRecord] = await db
        .update(engagementSalaryPaymentsTable)
        .set({ status: "paid", paidAt: new Date(), trialCreditInr: trialCredit, updatedAt: new Date() })
        .where(eq(engagementSalaryPaymentsTable.id, existing.id))
        .returning();
    } else {
      [paymentRecord] = await db
        .insert(engagementSalaryPaymentsTable)
        .values({
          engagementId: id,
          month,
          grossInr: gross,
          platformCutInr: platformCut,
          netInr: net,
          trialCreditInr: trialCredit,
          razorpayOrderId: null,
          razorpayPaymentId: null,
          status: "paid",
          paidAt: new Date(),
        })
        .returning();
    }
    res.status(201).json({
      paymentId: paymentRecord!.id,
      orderId: null,
      amount: 0,
      grossInr: gross,
      netInr: net,
      trialCreditInr: trialCredit,
      keyId: null,
    });
    return;
  }

  // ── Normal Razorpay path ──────────────────────────────────────────────────────
  const razorpay = getRazorpay();
  if (!razorpay) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  const order = await razorpay.orders.create({
    amount: chargeableGross * 100,    // gross minus trial credit
    currency: "INR",
    notes: { engagementId: String(id), month, type: "salary", trialCredit: String(trialCredit) },
  });

  let paymentRecord;
  if (existing) {
    // Retry: update existing pending record with new Razorpay order
    [paymentRecord] = await db
      .update(engagementSalaryPaymentsTable)
      .set({ razorpayOrderId: order.id as string, status: "pending", updatedAt: new Date() })
      .where(eq(engagementSalaryPaymentsTable.id, existing.id))
      .returning();
  } else {
    // First attempt: insert and pin the credit amount to this payment record
    [paymentRecord] = await db
      .insert(engagementSalaryPaymentsTable)
      .values({
        engagementId: id,
        month,
        grossInr: gross,
        platformCutInr: platformCut,
        netInr: net,
        trialCreditInr: trialCredit,          // pinned here; reused on all retries
        razorpayOrderId: order.id as string,
        status: "pending",
      })
      .returning();
  }

  res.json({
    paymentId: paymentRecord!.id,
    orderId: order.id,
    amount: chargeableGross,                   // what the parent actually pays
    grossInr: gross,
    platformCutInr: platformCut,
    netInr: net,
    trialCreditInr: trialCredit,
    keyId: process.env["RAZORPAY_KEY_ID"],
  });
});

// POST /engagements/:id/verify-salary-payment — confirm Razorpay signature + mark paid
router.post("/engagements/:id/verify-salary-payment", requireAuth, requireRole("parent"), async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = VerifySalaryPaymentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { paymentId, razorpayPaymentId, razorpayOrderId, razorpaySignature } = parsed.data;

  const [payment] = await db
    .select()
    .from(engagementSalaryPaymentsTable)
    .where(and(eq(engagementSalaryPaymentsTable.id, paymentId), eq(engagementSalaryPaymentsTable.engagementId, id)))
    .limit(1);

  if (!payment) { res.status(404).json({ error: "Payment not found" }); return; }

  const keySecret = process.env["RAZORPAY_KEY_SECRET"] ?? "";
  const body = razorpayOrderId + "|" + razorpayPaymentId;
  const expectedSig = crypto.createHmac("sha256", keySecret).update(body).digest("hex");

  if (expectedSig !== razorpaySignature) {
    res.status(400).json({ error: "Invalid payment signature" });
    return;
  }

  const [updated] = await db
    .update(engagementSalaryPaymentsTable)
    .set({ razorpayPaymentId, status: "paid", paidAt: new Date(), updatedAt: new Date() })
    .where(eq(engagementSalaryPaymentsTable.id, paymentId))
    .returning();

  // Mark the trial credit consumed — keyed off the amount stored in the payment
  // record (not re-read from eng) so the flag flips exactly once
  if (updated!.trialCreditInr > 0) {
    await db.update(shadowTeacherEngagementsTable)
      .set({ trialCreditApplied: true, updatedAt: new Date() })
      .where(eq(shadowTeacherEngagementsTable.id, id));
  }

  // Notify teacher that salary has been paid (in-app + best-effort push)
  try {
    const [eng] = await db
      .select({ professionalId: shadowTeacherEngagementsTable.professionalId })
      .from(shadowTeacherEngagementsTable)
      .where(eq(shadowTeacherEngagementsTable.id, id))
      .limit(1);
    if (eng) {
      const [prof] = await db
        .select({ userId: professionalProfilesTable.userId })
        .from(professionalProfilesTable)
        .where(eq(professionalProfilesTable.id, eng.professionalId))
        .limit(1);
      if (prof) {
        const netAmount = updated!.netInr;
        await createInAppNotification(prof.userId, {
          type: "salary_paid",
          title: "Salary payment received",
          body: `Your salary of ₹${netAmount.toLocaleString("en-IN")} net for ${updated!.month} has been paid.`,
          relatedType: "engagement",
          relatedId: id,
        });
      }
    }
  } catch { /* non-blocking */ }

  res.json(updated);
});

// ── Direct-pay salary confirmations (platformSalaryEnabled === false) ──────────
// Parent marks a month's salary as paid directly to the teacher's UPI; teacher
// confirms receipt. Record-only — no platform funds move, no commission applies.

const MarkSalaryConfirmationBody = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
});

// POST /engagements/:id/salary-confirmations — parent marks a month as paid directly
router.post("/engagements/:id/salary-confirmations", requireAuth, requireRole("parent"), async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = MarkSalaryConfirmationBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { month } = parsed.data;

  const eng = await getEngagementForParent(id, req.userId!);
  if (!eng) { res.status(404).json({ error: "Engagement not found" }); return; }
  if (!["active", "notice_period"].includes(eng.status)) {
    res.status(409).json({ error: "Engagement is not active" });
    return;
  }
  if (eng.platformSalaryEnabled) {
    res.status(409).json({ error: "platform_salary_enabled", message: "This engagement's salary is paid through the platform. Use the pay-salary flow instead." });
    return;
  }

  const [prof] = await db
    .select({ userId: professionalProfilesTable.userId, upiVpa: professionalProfilesTable.upiVpa, upiVerifiedAt: professionalProfilesTable.upiVerifiedAt })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, eng.professionalId))
    .limit(1);
  if (!prof?.upiVpa || !prof.upiVerifiedAt) {
    res.status(409).json({ error: "professional_upi_unverified", message: "Payment details for this teacher are being finalized. Please try again in a moment." });
    return;
  }

  // Idempotent: re-return the existing confirmation for this month rather than duplicating
  const [existing] = await db
    .select()
    .from(engagementSalaryConfirmationsTable)
    .where(and(eq(engagementSalaryConfirmationsTable.engagementId, id), eq(engagementSalaryConfirmationsTable.month, month)))
    .limit(1);
  if (existing) { res.status(200).json(existing); return; }

  const [confirmation] = await db
    .insert(engagementSalaryConfirmationsTable)
    .values({
      engagementId: id,
      month,
      amountInr: eng.monthlyFeeInr,
      markedPaidAt: new Date(),
    })
    .returning();

  try {
    await createInAppNotification(prof.userId, {
      type: "salary_marked_paid_direct",
      title: "Parent marked salary as paid",
      body: `The parent has marked your salary of ₹${eng.monthlyFeeInr.toLocaleString("en-IN")} for ${month} as paid directly. Please confirm receipt in the app.`,
      relatedType: "engagement",
      relatedId: id,
    });
  } catch { /* non-blocking */ }

  res.status(201).json(confirmation);
});

// GET /engagements/:id/direct-pay-info — parent fetches teacher's verified VPA + amount for QR
router.get("/engagements/:id/direct-pay-info", requireAuth, requireRole("parent"), async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const eng = await getEngagementForParent(id, req.userId!);
  if (!eng) { res.status(404).json({ error: "Engagement not found" }); return; }
  if (eng.platformSalaryEnabled) {
    res.status(409).json({ error: "platform_salary_enabled", message: "This engagement's salary is paid through the platform." });
    return;
  }

  const [row] = await db
    .select({
      upiVpa: professionalProfilesTable.upiVpa,
      upiVerifiedAt: professionalProfilesTable.upiVerifiedAt,
      teacherName: usersTable.fullName,
    })
    .from(professionalProfilesTable)
    .innerJoin(usersTable, eq(usersTable.id, professionalProfilesTable.userId))
    .where(eq(professionalProfilesTable.id, eng.professionalId))
    .limit(1);

  const verified = !!(row?.upiVpa && row?.upiVerifiedAt);
  res.json({
    verified,
    vpa: verified ? row!.upiVpa : null,
    teacherName: row?.teacherName ?? null,
    monthlyFeeInr: eng.monthlyFeeInr,
  });
});

// POST /engagements/:id/salary-confirmations/:confId/confirm — teacher confirms receipt
router.post("/engagements/:id/salary-confirmations/:confId/confirm", requireAuth, requireRole("professional"), async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  const confId = parseInt(req.params["confId"] as string, 10);
  if (isNaN(id) || isNaN(confId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [eng] = await db
    .select()
    .from(shadowTeacherEngagementsTable)
    .where(eq(shadowTeacherEngagementsTable.id, id))
    .limit(1);
  if (!eng) { res.status(404).json({ error: "Engagement not found" }); return; }

  const [prof] = await db
    .select({ id: professionalProfilesTable.id, userId: professionalProfilesTable.userId })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, eng.professionalId))
    .limit(1);
  if (!prof || prof.userId !== req.userId!) { res.status(403).json({ error: "Access denied" }); return; }

  const [confirmation] = await db
    .select()
    .from(engagementSalaryConfirmationsTable)
    .where(and(eq(engagementSalaryConfirmationsTable.id, confId), eq(engagementSalaryConfirmationsTable.engagementId, id)))
    .limit(1);
  if (!confirmation) { res.status(404).json({ error: "Confirmation not found" }); return; }

  if (confirmation.confirmedAt) { res.json(confirmation); return; }

  const [updated] = await db
    .update(engagementSalaryConfirmationsTable)
    .set({ confirmedAt: new Date() })
    .where(eq(engagementSalaryConfirmationsTable.id, confId))
    .returning();

  try {
    await createInAppNotification(eng.parentId, {
      type: "salary_confirmation_received",
      title: "Teacher confirmed salary receipt",
      body: `Your teacher confirmed receiving the ₹${confirmation.amountInr.toLocaleString("en-IN")} salary payment for ${confirmation.month}.`,
      relatedType: "engagement",
      relatedId: id,
    });
  } catch { /* non-blocking */ }

  res.json(updated);
});

// GET /engagements/:id/salary-confirmations — both parent and teacher can view
router.get("/engagements/:id/salary-confirmations", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [eng] = await db
    .select()
    .from(shadowTeacherEngagementsTable)
    .where(eq(shadowTeacherEngagementsTable.id, id))
    .limit(1);
  if (!eng) { res.status(404).json({ error: "Engagement not found" }); return; }

  const isParent = eng.parentId === req.userId!;
  const [prof] = await db
    .select({ userId: professionalProfilesTable.userId })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, eng.professionalId))
    .limit(1);
  const isTeacher = prof?.userId === req.userId!;
  const isAdmin = req.userRole === "admin";

  if (!isParent && !isTeacher && !isAdmin) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const rows = await db
    .select()
    .from(engagementSalaryConfirmationsTable)
    .where(eq(engagementSalaryConfirmationsTable.engagementId, id))
    .orderBy(desc(engagementSalaryConfirmationsTable.month));

  res.json(rows);
});

// GET /engagements/:id/payments — both parent and teacher can view
router.get("/engagements/:id/payments", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [eng] = await db
    .select()
    .from(shadowTeacherEngagementsTable)
    .where(eq(shadowTeacherEngagementsTable.id, id))
    .limit(1);

  if (!eng) { res.status(404).json({ error: "Engagement not found" }); return; }

  const isParent = eng.parentId === req.userId!;
  const [prof] = await db
    .select({ userId: professionalProfilesTable.userId })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, eng.professionalId))
    .limit(1);
  const isTeacher = prof?.userId === req.userId!;
  const isAdmin = req.userRole === "admin";

  if (!isParent && !isTeacher && !isAdmin) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const rows = await db
    .select()
    .from(engagementSalaryPaymentsTable)
    .where(eq(engagementSalaryPaymentsTable.engagementId, id))
    .orderBy(desc(engagementSalaryPaymentsTable.month));

  res.json(rows);
});

// GET /my-salary-payments — teacher sees their own salary history across all engagements
router.get("/my-salary-payments", requireAuth, requireRole("professional"), async (req, res): Promise<void> => {
  const [prof] = await db
    .select({ id: professionalProfilesTable.id })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, req.userId!))
    .limit(1);

  if (!prof) { res.status(404).json({ error: "Professional profile not found" }); return; }

  const rows = await db
    .select({
      id: engagementSalaryPaymentsTable.id,
      engagementId: engagementSalaryPaymentsTable.engagementId,
      month: engagementSalaryPaymentsTable.month,
      grossInr: engagementSalaryPaymentsTable.grossInr,
      platformCutInr: engagementSalaryPaymentsTable.platformCutInr,
      trialCreditInr: engagementSalaryPaymentsTable.trialCreditInr,
      netInr: engagementSalaryPaymentsTable.netInr,
      status: engagementSalaryPaymentsTable.status,
      paidAt: engagementSalaryPaymentsTable.paidAt,
    })
    .from(engagementSalaryPaymentsTable)
    .innerJoin(
      shadowTeacherEngagementsTable,
      and(
        eq(engagementSalaryPaymentsTable.engagementId, shadowTeacherEngagementsTable.id),
        eq(shadowTeacherEngagementsTable.professionalId, prof.id),
      ),
    )
    .orderBy(desc(engagementSalaryPaymentsTable.month));

  res.json(rows);
});

export default router;
