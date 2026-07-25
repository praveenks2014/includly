import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import Razorpay from "razorpay";
import crypto from "crypto";
import {
  db,
  professionalAvailabilityTable,
  sessionBookingsTable,
  bookingMessagesTable,
  professionalProfilesTable,
  usersTable,
  sessionNotesTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { generateOtp } from "../lib/otp";
import { sendPushNotification } from "../lib/notificationService";
import { createLedgerHeld, releaseWithCommission, refundToWallet, findLedgerByBooking } from "../lib/ledger";
import { convertReferralIfNeeded } from "./referrals";
import {
  SetAvailabilityBody,
  BookSessionBody,
  VerifySessionPaymentBody,
  UpdateSessionStatusBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

function getRazorpay() {
  const keyId = process.env["RAZORPAY_KEY_ID"];
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keyId || !keySecret) return null;
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

function getSessionCommission(specialty: string): number {
  if (specialty === "therapy_centre") return 149;
  if (specialty === "psychiatrist" || specialty === "neurologist") return 99;
  return 49;
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

router.get("/sessions/availability", requireAuth, requireRole("professional", "admin"), async (req: Request, res: Response): Promise<void> => {
  const [prof] = await db
    .select({ id: professionalProfilesTable.id })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, req.userId!));

  if (!prof) {
    res.status(404).json({ error: "Professional profile not found" });
    return;
  }

  const slots = await db
    .select()
    .from(professionalAvailabilityTable)
    .where(eq(professionalAvailabilityTable.professionalId, prof.id))
    .orderBy(professionalAvailabilityTable.dayOfWeek, professionalAvailabilityTable.startTime);

  res.json(slots);
});

router.put("/sessions/availability", requireAuth, requireRole("professional", "admin"), async (req: Request, res: Response): Promise<void> => {
  const parsed = SetAvailabilityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [prof] = await db
    .select({ id: professionalProfilesTable.id })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, req.userId!));

  if (!prof) {
    res.status(404).json({ error: "Professional profile not found" });
    return;
  }

  await db.delete(professionalAvailabilityTable).where(eq(professionalAvailabilityTable.professionalId, prof.id));

  if (parsed.data.slots.length === 0) {
    res.json([]);
    return;
  }

  const inserted = await db
    .insert(professionalAvailabilityTable)
    .values(parsed.data.slots.map((s) => ({ ...s, professionalId: prof.id })))
    .returning();

  res.json(inserted);
});

router.get("/professionals/:id/availability", async (req: Request, res: Response): Promise<void> => {
  const profId = parseInt(req.params["id"] as string, 10);
  if (isNaN(profId)) {
    res.status(400).json({ error: "Invalid professional id" });
    return;
  }

  const slots = await db
    .select()
    .from(professionalAvailabilityTable)
    .where(
      and(
        eq(professionalAvailabilityTable.professionalId, profId),
        eq(professionalAvailabilityTable.isActive, true),
      ),
    )
    .orderBy(professionalAvailabilityTable.dayOfWeek, professionalAvailabilityTable.startTime);

  res.json(slots);
});

router.get("/professionals/:id/bookable-slots", async (req: Request, res: Response): Promise<void> => {
  const profId = parseInt(req.params["id"] as string, 10);
  const dateStr = req.query["date"] as string;

  if (isNaN(profId) || !dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    res.status(400).json({ error: "Invalid professional id or date (use YYYY-MM-DD)" });
    return;
  }

  const date = new Date(dateStr + "T00:00:00Z");
  const dayOfWeek = date.getUTCDay();

  const availSlots = await db
    .select()
    .from(professionalAvailabilityTable)
    .where(
      and(
        eq(professionalAvailabilityTable.professionalId, profId),
        eq(professionalAvailabilityTable.dayOfWeek, dayOfWeek),
        eq(professionalAvailabilityTable.isActive, true),
      ),
    );

  const existingBookings = await db
    .select({
      startTime: sessionBookingsTable.startTime,
      endTime: sessionBookingsTable.endTime,
    })
    .from(sessionBookingsTable)
    .where(
      and(
        eq(sessionBookingsTable.professionalId, profId),
        eq(sessionBookingsTable.bookedDate, dateStr),
        eq(sessionBookingsTable.status, "confirmed"),
      ),
    );

  const bookedTimes = new Set(existingBookings.map((b) => b.startTime));

  const bookable: { date: string; startTime: string; endTime: string; durationMinutes: number; priceInr: number }[] = [];

  for (const avail of availSlots) {
    let slotStart = avail.startTime;
    while (timeToMinutes(addMinutes(slotStart, avail.slotDurationMinutes)) <= timeToMinutes(avail.endTime)) {
      const slotEnd = addMinutes(slotStart, avail.slotDurationMinutes);
      if (!bookedTimes.has(slotStart)) {
        bookable.push({
          date: dateStr,
          startTime: slotStart,
          endTime: slotEnd,
          durationMinutes: avail.slotDurationMinutes,
          priceInr: avail.priceInr,
        });
      }
      slotStart = slotEnd;
    }
  }

  bookable.sort((a, b) => a.startTime.localeCompare(b.startTime));
  res.json(bookable);
});

router.post("/sessions/book", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = BookSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { professionalId, bookedDate, startTime, endTime, durationMinutes, amountInr, notes, childId } = { childId: undefined as number | undefined, ...parsed.data };

  const [existing] = await db
    .select({ id: sessionBookingsTable.id })
    .from(sessionBookingsTable)
    .where(
      and(
        eq(sessionBookingsTable.professionalId, professionalId),
        eq(sessionBookingsTable.bookedDate, bookedDate),
        eq(sessionBookingsTable.startTime, startTime),
        eq(sessionBookingsTable.status, "confirmed"),
      ),
    );

  if (existing) {
    res.status(400).json({ error: "This slot is already booked" });
    return;
  }

  const [prof] = await db
    .select({ specialty: professionalProfilesTable.specialty })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, professionalId));

  const commissionInr = prof ? getSessionCommission(prof.specialty) : 49;

  // Credit-based booking for therapists and psychologists
  const isCreditSpecialty = prof && (
    prof.specialty === "occupational_therapy" ||
    prof.specialty === "speech_therapy" ||
    prof.specialty === "psychiatrist"
  );
  if (isCreditSpecialty) {
    // Wrap credit deduction + booking in a transaction so credit is never lost on booking failure
    let bookingId: number | null = null;

    try {
      await db.transaction(async (tx) => {
        // Atomic deduction: only succeeds if credits > 0, prevents over-draw
        const deductResult = await tx
          .update(usersTable)
          .set({ sessionCredits: sql`${usersTable.sessionCredits} - 1` })
          .where(and(eq(usersTable.id, req.userId!), sql`${usersTable.sessionCredits} > 0`))
          .returning({ sessionCredits: usersTable.sessionCredits });

        if (deductResult.length === 0) {
          throw Object.assign(new Error("NO_SESSION_CREDITS"), { statusCode: 402 });
        }

        const [booking] = await tx
          .insert(sessionBookingsTable)
          .values({
            professionalId,
            parentId: req.userId!,
            bookedDate,
            startTime,
            endTime,
            durationMinutes,
            amountInr: 0,
            commissionInr: 0,
            notes: notes ?? null,
            childId: childId ?? null,
            status: "confirmed",
            startOtp: generateOtp(),
            endOtp: generateOtp(),
          })
          .returning();

        bookingId = booking.id;
      });
    } catch (err: unknown) {
      const e = err as Error & { statusCode?: number };
      if (e.message === "NO_SESSION_CREDITS") {
        res.status(402).json({
          error: "You need session credits to book with this specialist. Purchase a session pass to continue.",
          code: "NO_SESSION_CREDITS",
          sessionCredits: 0,
        });
        return;
      }
      throw err;
    }

    res.json({ sessionId: bookingId!, usedCredit: true });
    return;
  }

  // Standard Razorpay payment flow for other specialties
  const razorpay = getRazorpay();
  if (!razorpay) {
    res.status(503).json({ error: "Payment gateway not configured" });
    return;
  }

  const order = await razorpay.orders.create({
    amount: amountInr * 100,
    currency: "INR",
    receipt: `session_${Date.now()}`,
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
      amountInr,
      commissionInr,
      notes: notes ?? null,
      childId: childId ?? null,
      providerOrderId: order.id as string,
    })
    .returning();

  res.json({
    sessionId: booking.id,
    orderId: order.id,
    amount: amountInr * 100,
    currency: "INR",
    keyId: process.env["RAZORPAY_KEY_ID"]!,
  });
});

router.post("/sessions/verify-payment", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = VerifySessionPaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keySecret) {
    res.status(503).json({ error: "Payment gateway not configured" });
    return;
  }

  const { sessionId, razorpayPaymentId, razorpayOrderId, razorpaySignature } = parsed.data;

  const [booking] = await db
    .select()
    .from(sessionBookingsTable)
    .where(
      and(
        eq(sessionBookingsTable.id, sessionId),
        eq(sessionBookingsTable.parentId, req.userId!),
      ),
    );

  if (!booking) {
    res.status(404).json({ error: "Session booking not found" });
    return;
  }

  if (booking.providerOrderId !== razorpayOrderId) {
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

  const [confirmed] = await db
    .update(sessionBookingsTable)
    .set({
      status: "confirmed",
      providerPaymentId: razorpayPaymentId,
      startOtp: generateOtp(),
      endOtp: generateOtp(),
      updatedAt: new Date(),
    })
    .where(eq(sessionBookingsTable.id, sessionId))
    .returning();

  // Create ledger entry: funds held until specialist marks session complete
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
        bookingType: "session",
      });
    } catch { /* ledger failure must never affect the payment response */ }
  })();

  // Convert referral on first booking (fire-and-forget, never blocks response)
  void convertReferralIfNeeded(confirmed!.parentId);

  res.json(confirmed);
});

router.get("/sessions", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const [user] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!));

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const msgCountSubquery = sql<number>`(SELECT COUNT(*)::int FROM booking_messages WHERE booking_id = ${sessionBookingsTable.id})`;

  if (user.role === "professional" || user.role === "admin") {
    const [prof] = await db
      .select({ id: professionalProfilesTable.id, offersHomeVisits: professionalProfilesTable.offersHomeVisits })
      .from(professionalProfilesTable)
      .where(eq(professionalProfilesTable.userId, req.userId!));

    if (!prof) {
      res.json([]);
      return;
    }

    const bookings = await db
      .select({
        id: sessionBookingsTable.id,
        professionalId: sessionBookingsTable.professionalId,
        parentId: sessionBookingsTable.parentId,
        bookedDate: sessionBookingsTable.bookedDate,
        startTime: sessionBookingsTable.startTime,
        endTime: sessionBookingsTable.endTime,
        durationMinutes: sessionBookingsTable.durationMinutes,
        amountInr: sessionBookingsTable.amountInr,
        status: sessionBookingsTable.status,
        notes: sessionBookingsTable.notes,
        createdAt: sessionBookingsTable.createdAt,
        startedAt: sessionBookingsTable.startedAt,
        parentName: usersTable.fullName,
        parentLocation: usersTable.location,
        parentSharesLocation: usersTable.shareHomeLocation,
        messageCount: msgCountSubquery,
      })
      .from(sessionBookingsTable)
      .leftJoin(usersTable, eq(sessionBookingsTable.parentId, usersTable.id))
      .where(eq(sessionBookingsTable.professionalId, prof.id))
      .orderBy(desc(sessionBookingsTable.bookedDate), desc(sessionBookingsTable.startTime));

    res.json(
      bookings.map((b) => ({
        ...b,
        professionalName: null,
        professionalSpecialty: null,
        professionalCity: null,
        professionalDisplayArea: null,
        professionalAddress: null,
        // Only share parent's area when: specialist offers home visits + booking confirmed + parent has given consent
        parentLocation: prof.offersHomeVisits && b.status === "confirmed" && b.parentSharesLocation ? (b.parentLocation ?? null) : null,
      })),
    );
  } else {
    const bookings = await db
      .select({
        id: sessionBookingsTable.id,
        professionalId: sessionBookingsTable.professionalId,
        parentId: sessionBookingsTable.parentId,
        bookedDate: sessionBookingsTable.bookedDate,
        startTime: sessionBookingsTable.startTime,
        endTime: sessionBookingsTable.endTime,
        durationMinutes: sessionBookingsTable.durationMinutes,
        amountInr: sessionBookingsTable.amountInr,
        status: sessionBookingsTable.status,
        notes: sessionBookingsTable.notes,
        createdAt: sessionBookingsTable.createdAt,
        startOtp: sessionBookingsTable.startOtp,
        endOtp: sessionBookingsTable.endOtp,
        proAmountInr: sessionBookingsTable.proAmountInr,
        markupInr: sessionBookingsTable.markupInr,
        gstInr: sessionBookingsTable.gstInr,
        professionalName: professionalProfilesTable.fullName,
        professionalSpecialty: professionalProfilesTable.specialty,
        professionalCity: professionalProfilesTable.city,
        professionalDisplayArea: professionalProfilesTable.displayArea,
        professionalAddress: professionalProfilesTable.clinicAddress,
        messageCount: msgCountSubquery,
      })
      .from(sessionBookingsTable)
      .leftJoin(professionalProfilesTable, eq(sessionBookingsTable.professionalId, professionalProfilesTable.id))
      .where(eq(sessionBookingsTable.parentId, req.userId!))
      .orderBy(desc(sessionBookingsTable.bookedDate), desc(sessionBookingsTable.startTime));

    const OTP_VISIBLE_STATUSES = ["paid_held", "session_started"];
    res.json(
      bookings.map((b) => ({
        ...b,
        parentName: null,
        parentLocation: null,
        professionalCity: b.professionalCity ?? null,
        professionalDisplayArea: b.professionalDisplayArea ?? null,
        // Full clinic address only revealed after booking is confirmed
        professionalAddress: b.status === "confirmed" ? (b.professionalAddress ?? null) : null,
        // OTPs only visible to parent when escrow is active
        startOtp: OTP_VISIBLE_STATUSES.includes(b.status) ? (b.startOtp ?? null) : null,
        endOtp: b.status === "session_started" ? (b.endOtp ?? null) : null,
        // Breakdown for confirmed_by_pro pay-now CTA and paid_held display
        breakdown: (b.proAmountInr != null && b.proAmountInr > 0) ? {
          proAmountInr: b.proAmountInr,
          markupInr: b.markupInr ?? 0,
          gstInr: b.gstInr ?? 0,
          totalInr: (b.proAmountInr ?? 0) + (b.markupInr ?? 0) + (b.gstInr ?? 0),
        } : null,
      })),
    );
  }
});

router.patch("/sessions/:id/status", requireAuth, requireRole("professional", "admin"), async (req: Request, res: Response): Promise<void> => {
  const sessionId = parseInt(req.params["id"] as string, 10);
  if (isNaN(sessionId)) {
    res.status(400).json({ error: "Invalid session id" });
    return;
  }

  const parsed = UpdateSessionStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [prof] = await db
    .select({ id: professionalProfilesTable.id })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, req.userId!));

  if (!prof) {
    res.status(404).json({ error: "Professional profile not found" });
    return;
  }

  const [booking] = await db
    .select()
    .from(sessionBookingsTable)
    .where(
      and(
        eq(sessionBookingsTable.id, sessionId),
        eq(sessionBookingsTable.professionalId, prof.id),
      ),
    );

  if (!booking) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const [updated] = await db
    .update(sessionBookingsTable)
    .set({ status: parsed.data.status as typeof booking.status, updatedAt: new Date() })
    .where(eq(sessionBookingsTable.id, sessionId))
    .returning();

  // Ledger: release on completion, refund to wallet on cancellation
  void (async () => {
    try {
      const ledgerEntry = await findLedgerByBooking(sessionId);
      if (ledgerEntry) {
        if (parsed.data.status === "completed") {
          await releaseWithCommission(ledgerEntry.id);
        } else if (
          parsed.data.status === "cancelled_by_professional" ||
          parsed.data.status === "no_show"
        ) {
          await refundToWallet(ledgerEntry.id, `Session ${parsed.data.status.replace(/_/g, " ")} — refunded to wallet`);
        }
      }
    } catch { /* ledger ops must not break the status update response */ }
  })();

  res.json(updated);
});

async function assertBookingParticipant(bookingId: number, userId: number, userRole: string): Promise<{ booking: typeof sessionBookingsTable.$inferSelect } | null> {
  const [booking] = await db
    .select()
    .from(sessionBookingsTable)
    .where(eq(sessionBookingsTable.id, bookingId));

  if (!booking) return null;

  if (userRole === "admin") return { booking };
  if (booking.parentId === userId) return { booking };

  const [prof] = await db
    .select({ id: professionalProfilesTable.id })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, userId));

  if (prof && prof.id === booking.professionalId) return { booking };

  return null;
}

router.get("/sessions/:bookingId/messages", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const bookingId = parseInt(req.params["bookingId"] as string, 10);
  if (isNaN(bookingId)) {
    res.status(400).json({ error: "Invalid booking id" });
    return;
  }

  const limit = Math.min(parseInt((req.query["limit"] as string) ?? "100", 10) || 100, 200);
  const before = req.query["before"] ? parseInt(req.query["before"] as string, 10) : null;

  const participant = await assertBookingParticipant(bookingId, req.userId!, req.userRole!);
  if (!participant) {
    res.status(404).json({ error: "Booking not found or access denied" });
    return;
  }

  const whereClause = before && !isNaN(before)
    ? and(eq(bookingMessagesTable.bookingId, bookingId), sql`${bookingMessagesTable.id} < ${before}`)
    : eq(bookingMessagesTable.bookingId, bookingId);

  const rows = await db
    .select({
      id: bookingMessagesTable.id,
      bookingId: bookingMessagesTable.bookingId,
      senderId: bookingMessagesTable.senderId,
      senderName: usersTable.fullName,
      body: bookingMessagesTable.body,
      createdAt: bookingMessagesTable.createdAt,
    })
    .from(bookingMessagesTable)
    .leftJoin(usersTable, eq(bookingMessagesTable.senderId, usersTable.id))
    .where(whereClause)
    .orderBy(desc(bookingMessagesTable.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  // nextBefore = oldest id in this page (for loading even-earlier messages)
  const nextBefore = hasMore ? page[page.length - 1]?.id ?? null : null;
  // Reverse to return chronological order (oldest → newest) for display
  const messages = [...page].reverse();

  res.json({ messages, total: messages.length, hasMore, nextBefore });
});

router.post("/sessions/:bookingId/messages", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const bookingId = parseInt(req.params["bookingId"] as string, 10);
  if (isNaN(bookingId)) {
    res.status(400).json({ error: "Invalid booking id" });
    return;
  }

  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!body || body.length === 0) {
    res.status(400).json({ error: "Message body is required" });
    return;
  }
  if (body.length > 2000) {
    res.status(400).json({ error: "Message is too long (max 2000 characters)" });
    return;
  }

  const participant = await assertBookingParticipant(bookingId, req.userId!, req.userRole!);
  if (!participant) {
    res.status(404).json({ error: "Booking not found or access denied" });
    return;
  }

  const [message] = await db
    .insert(bookingMessagesTable)
    .values({ bookingId, senderId: req.userId!, body })
    .returning();

  const [withSender] = await db
    .select({
      id: bookingMessagesTable.id,
      bookingId: bookingMessagesTable.bookingId,
      senderId: bookingMessagesTable.senderId,
      senderName: usersTable.fullName,
      body: bookingMessagesTable.body,
      createdAt: bookingMessagesTable.createdAt,
    })
    .from(bookingMessagesTable)
    .leftJoin(usersTable, eq(bookingMessagesTable.senderId, usersTable.id))
    .where(eq(bookingMessagesTable.id, message.id));

  res.status(201).json(withSender);

  // Fire-and-forget push notification to the other participant.
  // Admin senders do not trigger notifications.
  if (req.userRole !== "admin") {
    void (async () => {
      try {
        const booking = participant.booking;
        const senderName = withSender?.senderName ?? "Someone";
        const notifBody = body.slice(0, 80);

        if (req.userId === booking.parentId) {
          // Sender is parent → notify the professional
          const [prof] = await db
            .select({ userId: professionalProfilesTable.userId })
            .from(professionalProfilesTable)
            .where(eq(professionalProfilesTable.id, booking.professionalId));
          if (prof) {
            await sendPushNotification(prof.userId, {
              title: `New message from ${senderName}`,
              body: notifBody,
              url: "/sessions",
            });
          }
        } else {
          // Sender is professional → notify the parent
          await sendPushNotification(booking.parentId, {
            title: `New message from ${senderName}`,
            body: notifBody,
            url: "/sessions",
          });
        }
      } catch {
        // Push errors must never affect the message response
      }
    })();
  }
});

// GET /sessions/progress — parent's session-notes timeline for habit loop
router.get("/sessions/progress", requireAuth, requireRole("parent", "admin"), async (req: Request, res: Response): Promise<void> => {
  const parentId = req.userId!;

  const notes = await db
    .select({
      bookingId: sessionNotesTable.bookingId,
      parentSummary: sessionNotesTable.parentSummary,
      progressMarkers: sessionNotesTable.progressMarkers,
      noteCreatedAt: sessionNotesTable.createdAt,
      bookedDate: sessionBookingsTable.bookedDate,
      professionalName: usersTable.fullName,
    })
    .from(sessionNotesTable)
    .innerJoin(sessionBookingsTable, eq(sessionNotesTable.bookingId, sessionBookingsTable.id))
    .innerJoin(professionalProfilesTable, eq(sessionBookingsTable.professionalId, professionalProfilesTable.id))
    .innerJoin(usersTable, eq(professionalProfilesTable.userId, usersTable.id))
    .where(eq(sessionBookingsTable.parentId, parentId))
    .orderBy(desc(sessionNotesTable.createdAt))
    .limit(20);

  res.json(notes);
});

// POST /sessions/:bookingId/verify-start-otp — specialist submits the start OTP shown by parent
router.post("/sessions/:bookingId/verify-start-otp", requireAuth, requireRole("professional", "admin"), async (req: Request, res: Response): Promise<void> => {
  const bookingId = parseInt(req.params["bookingId"] as string, 10);
  if (isNaN(bookingId)) { res.status(400).json({ error: "Invalid booking id" }); return; }

  const otp = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";
  if (!otp) { res.status(400).json({ error: "OTP is required" }); return; }

  const [prof] = await db.select({ id: professionalProfilesTable.id })
    .from(professionalProfilesTable).where(eq(professionalProfilesTable.userId, req.userId!)).limit(1);

  const [booking] = await db.select().from(sessionBookingsTable).where(eq(sessionBookingsTable.id, bookingId)).limit(1);
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }

  const isAdmin = req.userRole === "admin";
  if (!isAdmin && (!prof || prof.id !== booking.professionalId)) {
    res.status(403).json({ error: "Not your booking" }); return;
  }
  if (booking.status !== "confirmed") {
    res.status(400).json({ error: "Booking is not in confirmed status" }); return;
  }
  if (booking.startedAt) {
    res.status(400).json({ error: "Session already started" }); return;
  }
  if (booking.startOtp !== otp) {
    res.status(400).json({ error: "Incorrect start OTP — ask the parent for the 6-digit code shown in their app" }); return;
  }

  const [updated] = await db.update(sessionBookingsTable)
    .set({ startedAt: new Date(), updatedAt: new Date() })
    .where(eq(sessionBookingsTable.id, bookingId))
    .returning();

  void sendPushNotification(booking.parentId, {
    title: "Session started ✓",
    body: "Your session has begun. The specialist has scanned your start OTP.",
    url: "/sessions",
  }).catch(() => {});

  res.json({ ok: true, startedAt: updated.startedAt });
});

// POST /sessions/:bookingId/verify-end-otp — specialist submits the finish OTP to close the session
router.post("/sessions/:bookingId/verify-end-otp", requireAuth, requireRole("professional", "admin"), async (req: Request, res: Response): Promise<void> => {
  const bookingId = parseInt(req.params["bookingId"] as string, 10);
  if (isNaN(bookingId)) { res.status(400).json({ error: "Invalid booking id" }); return; }

  const otp = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";
  if (!otp) { res.status(400).json({ error: "OTP is required" }); return; }

  const [prof] = await db.select({ id: professionalProfilesTable.id, specialty: professionalProfilesTable.specialty })
    .from(professionalProfilesTable).where(eq(professionalProfilesTable.userId, req.userId!)).limit(1);

  const [booking] = await db.select().from(sessionBookingsTable).where(eq(sessionBookingsTable.id, bookingId)).limit(1);
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }

  const isAdmin = req.userRole === "admin";
  if (!isAdmin && (!prof || prof.id !== booking.professionalId)) {
    res.status(403).json({ error: "Not your booking" }); return;
  }
  if (booking.status !== "confirmed") {
    res.status(400).json({ error: "Session is not in confirmed status" }); return;
  }
  if (!booking.startedAt) {
    res.status(400).json({ error: "Session has not been started yet — verify the start OTP first" }); return;
  }
  if (booking.endOtp !== otp) {
    res.status(400).json({ error: "Incorrect finish OTP — ask the parent for the 6-digit finish code" }); return;
  }

  const [completed] = await db.update(sessionBookingsTable)
    .set({ status: "completed", updatedAt: new Date() })
    .where(eq(sessionBookingsTable.id, bookingId))
    .returning();

  // Release escrow funds to the professional
  void (async () => {
    try {
      const ledgerEntry = await findLedgerByBooking(bookingId);
      if (ledgerEntry) await releaseWithCommission(ledgerEntry.id);
    } catch { /* ledger failure must not block the response */ }
  })();

  void sendPushNotification(booking.parentId, {
    title: "Session completed 🎉",
    body: "Your session is complete. A progress note will appear in your dashboard shortly.",
    url: "/sessions",
  }).catch(() => {});

  res.json({ ok: true, status: "completed" });
});

export default router;
