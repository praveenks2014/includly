import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc } from "drizzle-orm";
import Razorpay from "razorpay";
import crypto from "crypto";
import {
  db,
  professionalAvailabilityTable,
  sessionBookingsTable,
  professionalProfilesTable,
  usersTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
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

  const razorpay = getRazorpay();
  if (!razorpay) {
    res.status(503).json({ error: "Payment gateway not configured" });
    return;
  }

  const { professionalId, bookedDate, startTime, endTime, durationMinutes, amountInr, notes } = parsed.data;

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
      updatedAt: new Date(),
    })
    .where(eq(sessionBookingsTable.id, sessionId))
    .returning();

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

  if (user.role === "professional" || user.role === "admin") {
    const [prof] = await db
      .select({ id: professionalProfilesTable.id })
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
        parentName: usersTable.fullName,
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
        professionalName: professionalProfilesTable.fullName,
        professionalSpecialty: professionalProfilesTable.specialty,
      })
      .from(sessionBookingsTable)
      .leftJoin(professionalProfilesTable, eq(sessionBookingsTable.professionalId, professionalProfilesTable.id))
      .where(eq(sessionBookingsTable.parentId, req.userId!))
      .orderBy(desc(sessionBookingsTable.bookedDate), desc(sessionBookingsTable.startTime));

    res.json(
      bookings.map((b) => ({
        ...b,
        parentName: null,
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

  res.json(updated);
});

export default router;
