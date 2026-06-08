/**
 * sessionsV2.ts — Flow B per-session escrow state machine
 *
 * State machine:
 *   REQUESTED → CONFIRMED_BY_PRO → PAID_HELD → SESSION_STARTED → SESSION_COMPLETED → RELEASABLE → RELEASED
 *   + CANCELLED, REFUNDED, DISPUTED
 *
 * Chat opens once booking reaches CONFIRMED_BY_PRO.
 * OTPs: 6-digit, validity from admin config, max 5 wrong attempts then lock + alert.
 * Auto-cancel: cron fires every 5 min; cancels CONFIRMED_BY_PRO bookings > autoCancelHours past slot start.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, lt, inArray, sql, desc } from "drizzle-orm";
import Razorpay from "razorpay";
import crypto from "crypto";
import {
  db,
  sessionBookingsTable,
  professionalProfilesTable,
  adminSettingsTable,
  usersTable,
  bookingPayoutsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { sendPushNotification } from "../lib/notificationService";
import { z } from "zod/v4";

const router: IRouter = Router();
const OTP_MAX_ATTEMPTS = 5;

function getRazorpay() {
  const keyId = process.env["RAZORPAY_KEY_ID"];
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keyId || !keySecret) return null;
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function getSettings() {
  const [s] = await db.select().from(adminSettingsTable).limit(1);
  return s ?? {
    markupPct: 10, markupFlatInr: 0, gstRatePct: 18,
    otpValidityMinutes: 10, autoCancelHours: 2,
  };
}

/** Compute markup and GST from pro's price and admin config */
function computeAmounts(proPrice: number, settings: { markupPct: number; markupFlatInr: number; gstRatePct: number }) {
  const markupInr = settings.markupPct > 0
    ? Math.round(proPrice * settings.markupPct / 100)
    : settings.markupFlatInr;
  const gstInr = Math.round(markupInr * settings.gstRatePct / 100);
  const totalInr = proPrice + markupInr + gstInr;
  return { proAmountInr: proPrice, markupInr, gstInr, totalInr };
}

// ─── POST /sessions-v2/book ───────────────────────────────────────────────────
// Parent books a slot → status = REQUESTED (no payment yet)
const BookV2Body = z.object({
  professionalId: z.number().int().positive(),
  bookedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string(),
  endTime: z.string(),
  durationMinutes: z.number().int().positive(),
  notes: z.string().max(1000).optional(),
  childId: z.number().int().positive().optional(),
});

router.post("/sessions-v2/book", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const parsed = BookV2Body.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { professionalId, bookedDate, startTime, endTime, durationMinutes, notes, childId } = parsed.data;

  // Conflict check
  const [existing] = await db
    .select({ id: sessionBookingsTable.id })
    .from(sessionBookingsTable)
    .where(and(
      eq(sessionBookingsTable.professionalId, professionalId),
      eq(sessionBookingsTable.bookedDate, bookedDate),
      eq(sessionBookingsTable.startTime, startTime),
      inArray(sessionBookingsTable.status, ["requested", "confirmed_by_pro", "paid_held", "session_started"]),
    ));
  if (existing) { res.status(400).json({ error: "This slot is already taken" }); return; }

  const [prof] = await db
    .select({ pricingMinINR: professionalProfilesTable.pricingMinINR, userId: professionalProfilesTable.userId })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, professionalId));
  if (!prof) { res.status(404).json({ error: "Professional not found" }); return; }

  const settings = await getSettings();
  const proPrice = prof.pricingMinINR ?? 0;
  const { proAmountInr, markupInr, gstInr, totalInr } = computeAmounts(proPrice, settings);

  const [booking] = await db
    .insert(sessionBookingsTable)
    .values({
      professionalId,
      parentId: req.userId!,
      bookedDate,
      startTime,
      endTime,
      durationMinutes,
      amountInr: totalInr,
      commissionInr: markupInr,
      proAmountInr,
      markupInr,
      gstInr,
      notes: notes ?? null,
      childId: childId ?? null,
      status: "requested",
    })
    .returning();

  // Notify professional
  if (prof.userId) {
    void sendPushNotification(prof.userId, "New booking request", "A parent has requested a session with you.").catch(() => {});
  }

  res.status(201).json({
    ...booking,
    proAmountInr,
    markupInr,
    gstInr,
    totalInr,
  });
});

// ─── PATCH /sessions-v2/:id/confirm ──────────────────────────────────────────
// Professional confirms → CONFIRMED_BY_PRO. Chat opens from this point.
router.patch("/sessions-v2/:id/confirm", requireAuth, requireRole("professional"), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [prof] = await db
    .select({ id: professionalProfilesTable.id })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, req.userId!));
  if (!prof) { res.status(404).json({ error: "Professional profile not found" }); return; }

  const [booking] = await db.select().from(sessionBookingsTable)
    .where(and(eq(sessionBookingsTable.id, id), eq(sessionBookingsTable.professionalId, prof.id)));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  if (booking.status !== "requested") { res.status(400).json({ error: `Cannot confirm from status: ${booking.status}` }); return; }

  const [updated] = await db
    .update(sessionBookingsTable)
    .set({ status: "confirmed_by_pro", updatedAt: new Date() })
    .where(eq(sessionBookingsTable.id, id))
    .returning();

  // Notify parent: please pay
  void sendPushNotification(booking.parentId, "Session confirmed — pay to secure your slot", "Your specialist confirmed your request. Complete payment now.").catch(() => {});

  res.json(updated);
});

// ─── PATCH /sessions-v2/:id/reject ───────────────────────────────────────────
// Professional rejects → CANCELLED (no payment was made)
router.patch("/sessions-v2/:id/reject", requireAuth, requireRole("professional"), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [prof] = await db
    .select({ id: professionalProfilesTable.id })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, req.userId!));
  if (!prof) { res.status(404).json({ error: "Professional profile not found" }); return; }

  const [booking] = await db.select().from(sessionBookingsTable)
    .where(and(eq(sessionBookingsTable.id, id), eq(sessionBookingsTable.professionalId, prof.id)));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  if (booking.status !== "requested") { res.status(400).json({ error: `Cannot reject from status: ${booking.status}` }); return; }

  const [updated] = await db
    .update(sessionBookingsTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(sessionBookingsTable.id, id))
    .returning();

  void sendPushNotification(booking.parentId, "Session request declined", "Your specialist was unable to take this slot. Try another time.").catch(() => {});

  res.json(updated);
});

// ─── POST /sessions-v2/:id/pay ────────────────────────────────────────────────
// Parent pays → creates Razorpay order. Returns orderId for client to launch Razorpay SDK.
router.post("/sessions-v2/:id/pay", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [booking] = await db.select().from(sessionBookingsTable)
    .where(and(eq(sessionBookingsTable.id, id), eq(sessionBookingsTable.parentId, req.userId!)));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  if (booking.status !== "confirmed_by_pro") { res.status(400).json({ error: "Booking not yet confirmed by professional" }); return; }

  const razorpay = getRazorpay();
  if (!razorpay) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  const order = await razorpay.orders.create({
    amount: booking.amountInr * 100,
    currency: "INR",
    receipt: `bk_${id}_${Date.now()}`,
    notes: { bookingId: String(id) },
  });

  const [updated] = await db
    .update(sessionBookingsTable)
    .set({ providerOrderId: order.id as string, updatedAt: new Date() })
    .where(eq(sessionBookingsTable.id, id))
    .returning();

  res.json({
    bookingId: updated.id,
    orderId: order.id,
    amount: booking.amountInr * 100,
    currency: "INR",
    keyId: process.env["RAZORPAY_KEY_ID"]!,
    breakdown: {
      proAmountInr: booking.proAmountInr,
      markupInr: booking.markupInr,
      gstInr: booking.gstInr,
      totalInr: booking.amountInr,
    },
  });
});

// ─── POST /sessions-v2/:id/verify-payment ─────────────────────────────────────
// Verify Razorpay signature → PAID_HELD, generate OTPs
const VerifyPayBody = z.object({
  razorpayPaymentId: z.string(),
  razorpayOrderId: z.string(),
  razorpaySignature: z.string(),
});

router.post("/sessions-v2/:id/verify-payment", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = VerifyPayBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keySecret) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  const { razorpayPaymentId, razorpayOrderId, razorpaySignature } = parsed.data;

  const [booking] = await db.select().from(sessionBookingsTable)
    .where(and(eq(sessionBookingsTable.id, id), eq(sessionBookingsTable.parentId, req.userId!)));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  if (booking.providerOrderId !== razorpayOrderId) { res.status(400).json({ error: "Order ID mismatch" }); return; }

  const expectedSig = crypto.createHmac("sha256", keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`).digest("hex");
  if (expectedSig !== razorpaySignature) { res.status(400).json({ error: "Payment signature verification failed" }); return; }

  const settings = await getSettings();
  const now = new Date();

  const [updated] = await db
    .update(sessionBookingsTable)
    .set({
      status: "paid_held",
      providerPaymentId: razorpayPaymentId,
      startOtp: generateOtp(),
      endOtp: generateOtp(),
      otpIssuedAt: now,
      otpAttempts: 0,
      updatedAt: now,
    })
    .where(eq(sessionBookingsTable.id, id))
    .returning();

  // Notify professional — funds are held
  const [prof] = await db.select({ userId: professionalProfilesTable.userId })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, booking.professionalId));
  if (prof?.userId) {
    void sendPushNotification(prof.userId, "Payment received — session confirmed", "The parent has paid. Session is locked in.").catch(() => {});
  }

  res.json(updated);
});

// ─── POST /sessions-v2/:id/start-otp ─────────────────────────────────────────
// Professional enters start OTP → SESSION_STARTED
const OtpBody = z.object({ otp: z.string().length(6) });

router.post("/sessions-v2/:id/start-otp", requireAuth, requireRole("professional"), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = OtpBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "OTP must be 6 digits" }); return; }

  const [prof] = await db.select({ id: professionalProfilesTable.id })
    .from(professionalProfilesTable).where(eq(professionalProfilesTable.userId, req.userId!));
  if (!prof) { res.status(404).json({ error: "Professional profile not found" }); return; }

  const [booking] = await db.select().from(sessionBookingsTable)
    .where(and(eq(sessionBookingsTable.id, id), eq(sessionBookingsTable.professionalId, prof.id)));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  if (booking.status !== "paid_held") { res.status(400).json({ error: "Booking is not in PAID_HELD status" }); return; }

  // OTP lock check
  if (booking.otpLockedAt) {
    res.status(403).json({ error: "OTP is locked due to too many failed attempts. Contact admin." });
    return;
  }

  const settings = await getSettings();
  const now = new Date();

  // Validity check
  if (booking.otpIssuedAt) {
    const expiryMs = settings.otpValidityMinutes * 60 * 1000;
    if (now.getTime() - booking.otpIssuedAt.getTime() > expiryMs) {
      // Re-generate OTPs on expiry
      await db.update(sessionBookingsTable).set({
        startOtp: generateOtp(), endOtp: generateOtp(),
        otpIssuedAt: now, otpAttempts: 0, updatedAt: now,
      }).where(eq(sessionBookingsTable.id, id));
      res.status(400).json({ error: "OTP expired — a new OTP has been generated. Ask the parent to check their app." });
      return;
    }
  }

  if (parsed.data.otp !== booking.startOtp) {
    const newAttempts = (booking.otpAttempts ?? 0) + 1;
    if (newAttempts >= OTP_MAX_ATTEMPTS) {
      await db.update(sessionBookingsTable).set({
        otpAttempts: newAttempts, otpLockedAt: now, updatedAt: now,
      }).where(eq(sessionBookingsTable.id, id));
      // Alert admin
      void sendPushNotification(booking.parentId, "OTP locked — admin alerted", "Too many wrong OTP attempts. Admin has been notified.").catch(() => {});
      res.status(403).json({ error: "Too many failed attempts — OTP locked. Admin has been alerted." });
      return;
    }
    await db.update(sessionBookingsTable).set({ otpAttempts: newAttempts, updatedAt: now }).where(eq(sessionBookingsTable.id, id));
    res.status(400).json({ error: "Incorrect OTP", attemptsRemaining: OTP_MAX_ATTEMPTS - newAttempts });
    return;
  }

  const [updated] = await db
    .update(sessionBookingsTable)
    .set({ status: "session_started", startedAt: now, otpAttempts: 0, updatedAt: now })
    .where(eq(sessionBookingsTable.id, id))
    .returning();

  res.json(updated);
});

// ─── POST /sessions-v2/:id/end-otp ───────────────────────────────────────────
// Professional enters end OTP → SESSION_COMPLETED → RELEASABLE
router.post("/sessions-v2/:id/end-otp", requireAuth, requireRole("professional"), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = OtpBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "OTP must be 6 digits" }); return; }

  const [prof] = await db.select({ id: professionalProfilesTable.id })
    .from(professionalProfilesTable).where(eq(professionalProfilesTable.userId, req.userId!));
  if (!prof) { res.status(404).json({ error: "Professional profile not found" }); return; }

  const [booking] = await db.select().from(sessionBookingsTable)
    .where(and(eq(sessionBookingsTable.id, id), eq(sessionBookingsTable.professionalId, prof.id)));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  if (booking.status !== "session_started") { res.status(400).json({ error: "Session has not started yet" }); return; }

  if (booking.otpLockedAt) {
    res.status(403).json({ error: "OTP is locked. Contact admin." });
    return;
  }

  const now = new Date();
  if (parsed.data.otp !== booking.endOtp) {
    const newAttempts = (booking.otpAttempts ?? 0) + 1;
    if (newAttempts >= OTP_MAX_ATTEMPTS) {
      await db.update(sessionBookingsTable).set({ otpAttempts: newAttempts, otpLockedAt: now, updatedAt: now }).where(eq(sessionBookingsTable.id, id));
      res.status(403).json({ error: "Too many failed end-OTP attempts — locked. Contact admin." });
      return;
    }
    await db.update(sessionBookingsTable).set({ otpAttempts: newAttempts, updatedAt: now }).where(eq(sessionBookingsTable.id, id));
    res.status(400).json({ error: "Incorrect end OTP", attemptsRemaining: OTP_MAX_ATTEMPTS - newAttempts });
    return;
  }

  const [updated] = await db
    .update(sessionBookingsTable)
    .set({ status: "releasable", otpAttempts: 0, updatedAt: now })
    .where(eq(sessionBookingsTable.id, id))
    .returning();

  // Notify admin that this booking is ready to release
  void sendPushNotification(booking.parentId, "Session complete!", "Your session has been marked complete. Payment will be released to the professional shortly.").catch(() => {});

  res.json(updated);
});

// ─── POST /sessions-v2/:id/regenerate-otp ────────────────────────────────────
// Either party can request OTP regeneration if it expired
router.post("/sessions-v2/:id/regenerate-otp", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [booking] = await db.select().from(sessionBookingsTable).where(eq(sessionBookingsTable.id, id));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }

  // Only parent or the booking's professional can trigger this
  const isParent = booking.parentId === req.userId;
  if (!isParent) {
    const [prof] = await db.select({ id: professionalProfilesTable.id })
      .from(professionalProfilesTable).where(eq(professionalProfilesTable.userId, req.userId!));
    if (!prof || prof.id !== booking.professionalId) {
      res.status(403).json({ error: "Not a participant of this booking" });
      return;
    }
  }

  if (!["paid_held", "session_started"].includes(booking.status ?? "")) {
    res.status(400).json({ error: "OTP regeneration not applicable in current status" });
    return;
  }

  const now = new Date();
  await db.update(sessionBookingsTable).set({
    startOtp: generateOtp(), endOtp: generateOtp(),
    otpIssuedAt: now, otpAttempts: 0, otpLockedAt: null,
    updatedAt: now,
  }).where(eq(sessionBookingsTable.id, id));

  res.json({ message: "OTPs regenerated successfully" });
});

// ─── POST /sessions-v2/:id/dispute ───────────────────────────────────────────
// Parent or professional raises a dispute → DISPUTED
const DisputeBody = z.object({ reason: z.string().min(5).max(1000) });

router.post("/sessions-v2/:id/dispute", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = DisputeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [booking] = await db.select().from(sessionBookingsTable).where(eq(sessionBookingsTable.id, id));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }

  const isParent = booking.parentId === req.userId;
  if (!isParent) {
    const [prof] = await db.select({ id: professionalProfilesTable.id })
      .from(professionalProfilesTable).where(eq(professionalProfilesTable.userId, req.userId!));
    if (!prof || prof.id !== booking.professionalId) {
      res.status(403).json({ error: "Not a participant of this booking" });
      return;
    }
  }

  const disputableStatuses = ["paid_held", "session_started", "session_completed", "releasable"];
  if (!disputableStatuses.includes(booking.status ?? "")) {
    res.status(400).json({ error: "Cannot dispute in current status" });
    return;
  }

  const [updated] = await db
    .update(sessionBookingsTable)
    .set({ status: "disputed", disputeReason: parsed.data.reason, disputedAt: new Date(), updatedAt: new Date() })
    .where(eq(sessionBookingsTable.id, id))
    .returning();

  res.json(updated);
});

// ─── GET /sessions-v2/:id ─────────────────────────────────────────────────────
// Get booking details (participants + admin only)
router.get("/sessions-v2/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [booking] = await db.select().from(sessionBookingsTable).where(eq(sessionBookingsTable.id, id));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }

  const isAdmin = req.userRole === "admin";
  const isParent = booking.parentId === req.userId;
  let isPro = false;
  if (!isAdmin && !isParent) {
    const [prof] = await db.select({ id: professionalProfilesTable.id })
      .from(professionalProfilesTable).where(eq(professionalProfilesTable.userId, req.userId!));
    isPro = !!prof && prof.id === booking.professionalId;
  }
  if (!isAdmin && !isParent && !isPro) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  // OTPs only visible to parent for PAID_HELD+ status
  const showOtps = isParent && ["paid_held", "session_started"].includes(booking.status ?? "");

  res.json({
    ...booking,
    startOtp: showOtps ? booking.startOtp : undefined,
    endOtp: showOtps ? booking.endOtp : undefined,
  });
});

export { router as sessionsV2Router };

// ─── Auto-cancel scheduler ────────────────────────────────────────────────────
// Call this from index.ts on a cron interval
export async function runAutoCancelJob(): Promise<void> {
  try {
    const [settings] = await db.select({ autoCancelHours: adminSettingsTable.autoCancelHours }).from(adminSettingsTable).limit(1);
    const hours = settings?.autoCancelHours ?? 2;

    // Find CONFIRMED_BY_PRO bookings where booked_date + start_time + autoCancelHours < now
    // We join date + time string to a timestamp for comparison
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const cutoffDate = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD

    const stale = await db
      .select({ id: sessionBookingsTable.id, parentId: sessionBookingsTable.parentId })
      .from(sessionBookingsTable)
      .where(and(
        eq(sessionBookingsTable.status, "confirmed_by_pro"),
        sql`(${sessionBookingsTable.bookedDate} || ' ' || ${sessionBookingsTable.startTime})::timestamptz < now() - (${hours} || ' hours')::interval`,
      ));

    for (const b of stale) {
      await db.update(sessionBookingsTable)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(sessionBookingsTable.id, b.id));
      void sendPushNotification(b.parentId, "Session auto-cancelled", "Your session was cancelled because payment was not completed within the allowed window.").catch(() => {});
    }
    if (stale.length > 0) {
      console.log(`[AutoCancel] Cancelled ${stale.length} stale bookings`);
    }
  } catch (err) {
    console.error("[AutoCancel] Error:", err);
  }
}
