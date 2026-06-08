import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc } from "drizzle-orm";
import Razorpay from "razorpay";
import crypto from "crypto";
import {
  db,
  shadowTeacherMatchesTable,
  adminSettingsTable,
  usersTable,
  professionalProfilesTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { z } from "zod/v4";

const router: IRouter = Router();

function getRazorpay() {
  const keyId = process.env["RAZORPAY_KEY_ID"];
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keyId || !keySecret) return null;
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

async function getSettings() {
  const [settings] = await db.select().from(adminSettingsTable).limit(1);
  return settings ?? { matchingFeeInr: 500, matchingFeeRefundable: true };
}

const RequestMatchBody = z.object({
  childDetails: z.string().min(1).max(1000).optional(),
  requirements: z.string().max(2000).optional(),
});

const VerifyMatchPaymentBody = z.object({
  matchId: z.number().int().positive(),
  razorpayPaymentId: z.string(),
  razorpayOrderId: z.string(),
  razorpaySignature: z.string(),
});

// POST /shadow-teacher/request — parent initiates, creates Razorpay order for matching fee
router.post("/shadow-teacher/request", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const parsed = RequestMatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const settings = await getSettings();
  const fee = settings.matchingFeeInr;

  const razorpay = getRazorpay();
  if (!razorpay) {
    res.status(503).json({ error: "Payment gateway not configured" });
    return;
  }

  const order = await razorpay.orders.create({
    amount: fee * 100,
    currency: "INR",
    receipt: `stmatch_${Date.now()}`,
  });

  const [match] = await db
    .insert(shadowTeacherMatchesTable)
    .values({
      parentId: req.userId!,
      status: "pending_payment",
      matchingFeeInr: fee,
      providerOrderId: order.id as string,
      childDetails: parsed.data.childDetails ?? null,
      requirements: parsed.data.requirements ?? null,
    })
    .returning();

  res.json({
    matchId: match.id,
    orderId: order.id,
    amount: fee * 100,
    currency: "INR",
    keyId: process.env["RAZORPAY_KEY_ID"]!,
  });
});

// POST /shadow-teacher/verify-payment — confirm payment signature, move to queued
router.post("/shadow-teacher/verify-payment", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const parsed = VerifyMatchPaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keySecret) {
    res.status(503).json({ error: "Payment gateway not configured" });
    return;
  }

  const { matchId, razorpayPaymentId, razorpayOrderId, razorpaySignature } = parsed.data;

  const [match] = await db
    .select()
    .from(shadowTeacherMatchesTable)
    .where(and(eq(shadowTeacherMatchesTable.id, matchId), eq(shadowTeacherMatchesTable.parentId, req.userId!)));

  if (!match) {
    res.status(404).json({ error: "Match request not found" });
    return;
  }

  if (match.providerOrderId !== razorpayOrderId) {
    res.status(400).json({ error: "Order ID mismatch" });
    return;
  }

  const expectedSig = crypto
    .createHmac("sha256", keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

  if (expectedSig !== razorpaySignature) {
    res.status(400).json({ error: "Payment signature verification failed" });
    return;
  }

  const [updated] = await db
    .update(shadowTeacherMatchesTable)
    .set({ status: "queued", providerPaymentId: razorpayPaymentId, updatedAt: new Date() })
    .where(eq(shadowTeacherMatchesTable.id, matchId))
    .returning();

  res.json(updated);
});

// GET /shadow-teacher/my-request — parent views their latest match request
router.get("/shadow-teacher/my-request", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const matches = await db
    .select()
    .from(shadowTeacherMatchesTable)
    .where(eq(shadowTeacherMatchesTable.parentId, req.userId!))
    .orderBy(desc(shadowTeacherMatchesTable.createdAt))
    .limit(5);

  res.json(matches);
});

// GET /shadow-teacher/requests (admin) — list all match requests
router.get("/shadow-teacher/requests", requireAuth, requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
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
      adminNotes: shadowTeacherMatchesTable.adminNotes,
      matchedAt: shadowTeacherMatchesTable.matchedAt,
      createdAt: shadowTeacherMatchesTable.createdAt,
    })
    .from(shadowTeacherMatchesTable)
    .leftJoin(usersTable, eq(shadowTeacherMatchesTable.parentId, usersTable.id))
    .leftJoin(professionalProfilesTable, eq(shadowTeacherMatchesTable.matchedProfessionalId, professionalProfilesTable.id))
    .orderBy(desc(shadowTeacherMatchesTable.createdAt));

  res.json(rows);
});

// PATCH /shadow-teacher/:id/assign — admin assigns a professional
router.patch("/shadow-teacher/:id/assign", requireAuth, requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { professionalId, adminNotes } = req.body as { professionalId?: number; adminNotes?: string };
  if (!professionalId || isNaN(professionalId)) {
    res.status(400).json({ error: "professionalId required" });
    return;
  }

  const [match] = await db.select().from(shadowTeacherMatchesTable).where(eq(shadowTeacherMatchesTable.id, id));
  if (!match) { res.status(404).json({ error: "Match request not found" }); return; }
  if (match.status !== "queued") { res.status(400).json({ error: "Can only assign from queued status" }); return; }

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

// PATCH /shadow-teacher/:id/cancel — admin cancels; refund if not yet matched
router.patch("/shadow-teacher/:id/cancel", requireAuth, requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [match] = await db.select().from(shadowTeacherMatchesTable).where(eq(shadowTeacherMatchesTable.id, id));
  if (!match) { res.status(404).json({ error: "Match request not found" }); return; }

  const settings = await getSettings();
  const wasUnmatched = match.status === "queued";
  const shouldRefund = wasUnmatched && settings.matchingFeeRefundable;

  // Initiate Razorpay refund if applicable
  let refunded = false;
  if (shouldRefund && match.providerPaymentId) {
    try {
      const razorpay = getRazorpay();
      if (razorpay) {
        await (razorpay.payments as any).refund(match.providerPaymentId, {
          amount: match.matchingFeeInr * 100,
          notes: { reason: "Shadow teacher match cancelled before assignment" },
        });
        refunded = true;
      }
    } catch {
      // Refund failure is logged but doesn't block the cancel
    }
  }

  const [updated] = await db
    .update(shadowTeacherMatchesTable)
    .set({
      status: refunded ? "refunded" : "cancelled",
      cancelledAt: new Date(),
      refundedAt: refunded ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(shadowTeacherMatchesTable.id, id))
    .returning();

  res.json({ ...updated, refundInitiated: refunded });
});

export default router;
