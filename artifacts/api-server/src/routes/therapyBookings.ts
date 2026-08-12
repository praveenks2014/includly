import { Router, type IRouter, type Request, type Response } from "express";
import { eq, ne, and, desc, sql } from "drizzle-orm";
import Razorpay from "razorpay";
import crypto from "crypto";
import {
  db,
  therapyCentresTable,
  centreTherapistsTable,
  centreServicePricesTable,
  centreServicePackagesTable,
  centreServicePackagePurchasesTable,
  therapyBookingsTable,
  professionalProfilesTable,
  slotsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { generateOtp } from "../lib/otp";
import { postDuesCharge } from "../lib/platformDues";
import { z } from "zod/v4";

const router: IRouter = Router();

function parsedId(raw: string): number | null {
  const n = parseInt(raw, 10);
  return isNaN(n) ? null : n;
}

function getRazorpay() {
  const keyId = process.env["RAZORPAY_KEY_ID"];
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keyId || !keySecret) return null;
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

// Same helper as sessions.ts's own bookingSlotLockSql, duplicated rather
// than imported — matching this codebase's established per-file
// duplication convention for trivial helpers (see slotGeneration.ts's own
// header comment) rather than importing one route file into another.
// Deliberately the SAME (professionalId, date, startTime) key shape, so a
// centre booking and an individual booking for the same underlying
// professional/slot still serialize against each other correctly — they
// share the exact same professionalAvailabilityTable/slotsTable calendar.
function bookingSlotLockSql(professionalId: number, date: string, startTime: string) {
  return sql`SELECT pg_advisory_xact_lock(hashtext(${professionalId}::text || ':' || ${date} || ':' || ${startTime}))`;
}

// Resolves the commission for a centre booking: price-entry-level override
// (centreServicePricesTable.commissionPctOverride on the CURRENT effective
// price row for this service) -> centre-level override
// (therapyCentresTable.commissionPctOverride) -> platform default. This is
// a genuine three-tier chain the old resolveBookingCommission (sessions.ts)
// never had a hook for, since it never touched centreServicePricesTable at
// all. Matches resolveBookingCommission's own precedent of using module-
// level `db` even when called from inside a db.transaction callback (see
// sessions.ts's Razorpay branch) -- read-only lookups on unrelated tables,
// no race to protect here.
async function resolveCentreCommission(
  centreId: number,
  serviceId: number,
  amountInr: number,
): Promise<{ commissionInr: number; centreAmountInr: number; resolvedCommissionPct: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const priceRows = await db
    .select({ commissionPctOverride: centreServicePricesTable.commissionPctOverride, effectiveFrom: centreServicePricesTable.effectiveFrom })
    .from(centreServicePricesTable)
    .where(and(eq(centreServicePricesTable.centreId, centreId), eq(centreServicePricesTable.serviceId, serviceId)))
    .orderBy(desc(centreServicePricesTable.effectiveFrom));
  const currentPriceRow = priceRows.find((p) => p.effectiveFrom <= today) ?? null;

  const [centre] = await db
    .select({ commissionPctOverride: therapyCentresTable.commissionPctOverride, platformDefaultCommissionPct: therapyCentresTable.platformDefaultCommissionPct })
    .from(therapyCentresTable)
    .where(eq(therapyCentresTable.id, centreId));

  const pct = currentPriceRow?.commissionPctOverride ?? centre?.commissionPctOverride ?? centre?.platformDefaultCommissionPct ?? 15;
  const commissionInr = Math.round((amountInr * pct) / 100);
  return { commissionInr, centreAmountInr: amountInr - commissionInr, resolvedCommissionPct: pct };
}

// Authoritative price source for a direct-payment booking -- same
// "latest row with effectiveFrom <= today" resolution GET
// /centres/:id/services already uses for display, mirrored exactly here
// so what a parent is shown and what they're actually charged never
// diverge. Snapshotted onto the booking row at booking time (never
// re-read later) -- a centre changing its price list only affects NEW
// bookings from that point on.
async function resolveCurrentServicePrice(centreId: number, serviceId: number): Promise<number | null> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db
    .select({ priceInr: centreServicePricesTable.priceInr, effectiveFrom: centreServicePricesTable.effectiveFrom })
    .from(centreServicePricesTable)
    .where(and(eq(centreServicePricesTable.centreId, centreId), eq(centreServicePricesTable.serviceId, serviceId)))
    .orderBy(desc(centreServicePricesTable.effectiveFrom));
  const current = rows.find((p) => p.effectiveFrom <= today);
  return current?.priceInr ?? null;
}

// ── POST /therapy-bookings/book ─────────────────────────────────────────────
// Booking creation for CENTRE-EMPLOYED professionals only -- individual
// professionals keep using POST /sessions/book, completely untouched.
// Reuses the exact same professionalAvailabilityTable/slotsTable calendar
// (and bookingSlotLockSql's lock discipline) every professional already
// has; the only thing that differs from /sessions/book is which table the
// resulting booking lands in, and that price/commission are resolved from
// the centre's own services/prices rather than the professional's own
// template price or a flat specialty rate.
const BookTherapySessionBody = z.object({
  professionalId: z.number().int().positive(),
  bookedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string(),
  childId: z.number().int().positive().optional(),
  notes: z.string().optional(),
  // When set: consume one credit from an existing, already-paid package
  // purchase instead of charging directly. Validated server-side against
  // this parent/service/remaining-credits -- never trusted at face value.
  packagePurchaseId: z.number().int().positive().optional(),
});
router.post("/therapy-bookings/book", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = BookTherapySessionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { professionalId, bookedDate, startTime, childId, notes, packagePurchaseId } = parsed.data;

  const [prof] = await db
    .select({ id: professionalProfilesTable.id, employingCentreId: professionalProfilesTable.employingCentreId })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, professionalId));
  if (!prof || !prof.employingCentreId) {
    res.status(400).json({ error: "This professional is not centre-employed. Use /sessions/book instead." });
    return;
  }
  const centreId = prof.employingCentreId;

  const [therapist] = await db
    .select({ id: centreTherapistsTable.id })
    .from(centreTherapistsTable)
    .where(and(eq(centreTherapistsTable.professionalProfileId, professionalId), eq(centreTherapistsTable.centreId, centreId)));
  if (!therapist) {
    res.status(400).json({ error: "No matching centre therapist roster entry found" });
    return;
  }

  // Fast-path pre-check, same discipline as /sessions/book -- not the
  // authoritative guard, just avoids unnecessary work before the lock.
  const [existing] = await db
    .select({ id: therapyBookingsTable.id })
    .from(therapyBookingsTable)
    .where(and(
      eq(therapyBookingsTable.professionalId, professionalId),
      eq(therapyBookingsTable.bookedDate, bookedDate),
      eq(therapyBookingsTable.startTime, startTime),
      eq(therapyBookingsTable.status, "confirmed"),
    ));
  if (existing) { res.status(400).json({ error: "This slot is already booked" }); return; }

  let bookingResult: { id: number; orderId: string | null; amountInr: number; usedPackage: boolean } | null = null;

  try {
    await db.transaction(async (tx) => {
      await tx.execute(bookingSlotLockSql(professionalId, bookedDate, startTime));

      const [conflict] = await tx
        .select({ id: therapyBookingsTable.id })
        .from(therapyBookingsTable)
        .where(and(
          eq(therapyBookingsTable.professionalId, professionalId),
          eq(therapyBookingsTable.bookedDate, bookedDate),
          eq(therapyBookingsTable.startTime, startTime),
          eq(therapyBookingsTable.status, "confirmed"),
        ));
      if (conflict) throw Object.assign(new Error("SLOT_TAKEN"), { statusCode: 400 });

      // Authoritative slot lookup, same NO_MATCHING_SLOT discipline as
      // /sessions/book -- a date/time never actually generated as a real
      // slot can never be booked, regardless of what the client claims.
      const [slot] = await tx
        .select({ endTime: slotsTable.endTime, durationMins: slotsTable.durationMins, serviceId: slotsTable.serviceId })
        .from(slotsTable)
        .where(and(
          eq(slotsTable.professionalId, professionalId),
          eq(slotsTable.date, bookedDate),
          eq(slotsTable.startTime, startTime),
        ));
      if (!slot) throw Object.assign(new Error("NO_MATCHING_SLOT"), { statusCode: 400 });
      if (!slot.serviceId) throw Object.assign(new Error("NO_SERVICE_LINKED"), { statusCode: 400 });

      if (packagePurchaseId) {
        // Atomic guard: only consumes a credit if this purchase actually
        // belongs to this parent, matches this exact service, is active,
        // and still has room -- same conditional-UPDATE-RETURNING
        // over-draw prevention as sessionBookingsTable's credit-path
        // deduction. If the WHERE fails to match any row, nothing is
        // consumed and the booking is rejected outright.
        const [purchase] = await tx
          .update(centreServicePackagePurchasesTable)
          .set({
            sessionsConsumed: sql`${centreServicePackagePurchasesTable.sessionsConsumed} + 1`,
            status: sql`CASE WHEN ${centreServicePackagePurchasesTable.sessionsConsumed} + 1 >= ${centreServicePackagePurchasesTable.sessionsTotal} THEN 'exhausted' ELSE 'active' END`,
            updatedAt: new Date(),
          })
          .where(and(
            eq(centreServicePackagePurchasesTable.id, packagePurchaseId),
            eq(centreServicePackagePurchasesTable.parentId, req.userId!),
            eq(centreServicePackagePurchasesTable.serviceId, slot.serviceId),
            eq(centreServicePackagePurchasesTable.status, "active"),
            sql`${centreServicePackagePurchasesTable.sessionsConsumed} < ${centreServicePackagePurchasesTable.sessionsTotal}`,
          ))
          .returning();
        if (!purchase) throw Object.assign(new Error("PACKAGE_NOT_AVAILABLE"), { statusCode: 400 });

        // Per-session value, snapshotted from the purchase's own amount --
        // never re-derived from the current service price, since this
        // session was already paid for as part of the package.
        const perSessionAmountInr = Math.round(purchase.amountPaidInr / purchase.sessionsTotal);
        const { commissionInr, centreAmountInr, resolvedCommissionPct } =
          await resolveCentreCommission(centreId, slot.serviceId, perSessionAmountInr);

        const [booking] = await tx
          .insert(therapyBookingsTable)
          .values({
            parentId: req.userId!,
            centreId,
            serviceId: slot.serviceId,
            professionalId,
            therapistId: therapist.id,
            packageId: purchase.packageId,
            packagePurchaseId: purchase.id,
            childId: childId ?? null,
            bookedDate,
            startTime,
            endTime: slot.endTime,
            status: "confirmed",
            amountInr: perSessionAmountInr,
            commissionInr,
            centreAmountInr,
            resolvedCommissionPct,
            startOtp: generateOtp(),
            endOtp: generateOtp(),
            otpIssuedAt: new Date(),
            ...(notes ? { sessionNote: notes } : {}),
          })
          .returning();

        bookingResult = { id: booking.id, orderId: null, amountInr: 0, usedPackage: true };
        return;
      }

      // Direct payment path.
      const priceInr = await resolveCurrentServicePrice(centreId, slot.serviceId);
      if (priceInr === null) throw Object.assign(new Error("NO_SERVICE_PRICE"), { statusCode: 400 });

      const { commissionInr, centreAmountInr, resolvedCommissionPct } =
        await resolveCentreCommission(centreId, slot.serviceId, priceInr);

      const razorpay = getRazorpay();
      if (!razorpay) throw Object.assign(new Error("PAYMENT_GATEWAY_NOT_CONFIGURED"), { statusCode: 503 });

      const order = await razorpay.orders.create({
        amount: priceInr * 100,
        currency: "INR",
        receipt: `therapy_booking_${Date.now()}`,
      });

      const [booking] = await tx
        .insert(therapyBookingsTable)
        .values({
          parentId: req.userId!,
          centreId,
          serviceId: slot.serviceId,
          professionalId,
          therapistId: therapist.id,
          childId: childId ?? null,
          bookedDate,
          startTime,
          endTime: slot.endTime,
          amountInr: priceInr,
          commissionInr,
          centreAmountInr,
          resolvedCommissionPct,
          providerOrderId: order.id as string,
          ...(notes ? { sessionNote: notes } : {}),
        })
        .returning();

      bookingResult = { id: booking.id, orderId: order.id as string, amountInr: priceInr, usedPackage: false };
    });
  } catch (err: unknown) {
    const e = err as Error & { statusCode?: number };
    if (e.message === "SLOT_TAKEN") { res.status(400).json({ error: "This slot is already booked" }); return; }
    if (e.message === "NO_MATCHING_SLOT") { res.status(400).json({ error: "This date/time is not an available slot for this professional" }); return; }
    if (e.message === "NO_SERVICE_LINKED") { res.status(400).json({ error: "This professional's schedule isn't linked to a centre service yet" }); return; }
    if (e.message === "NO_SERVICE_PRICE") { res.status(400).json({ error: "This service has no current price set" }); return; }
    if (e.message === "PACKAGE_NOT_AVAILABLE") { res.status(400).json({ error: "This package is not available for this service, or has no sessions remaining" }); return; }
    if (e.message === "PAYMENT_GATEWAY_NOT_CONFIGURED") { res.status(503).json({ error: "Payment gateway not configured" }); return; }
    throw err;
  }

  if (bookingResult!.usedPackage) {
    res.json({ sessionId: bookingResult!.id, usedPackage: true });
    return;
  }
  res.json({
    sessionId: bookingResult!.id,
    orderId: bookingResult!.orderId,
    amount: bookingResult!.amountInr * 100,
    currency: "INR",
    keyId: process.env["RAZORPAY_KEY_ID"]!,
  });
});

// ── PATCH /therapy-bookings/:id/reschedule ──────────────────────────────────
const RescheduleTherapyBookingBody = z.object({
  bookedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string(),
});
router.patch("/therapy-bookings/:id/reschedule", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const bookingId = parsedId(req.params["id"] as string);
  if (!bookingId) { res.status(400).json({ error: "Invalid booking id" }); return; }
  const parsed = RescheduleTherapyBookingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [booking] = await db.select().from(therapyBookingsTable).where(eq(therapyBookingsTable.id, bookingId));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }

  let isProfessional = false;
  if (req.userRole === "professional") {
    const [prof] = await db.select({ id: professionalProfilesTable.id }).from(professionalProfilesTable)
      .where(eq(professionalProfilesTable.userId, req.userId!));
    isProfessional = !!prof && prof.id === booking.professionalId;
  }
  let isCentreOwner = false;
  if (req.userRole === "centre_admin") {
    const [centre] = await db.select({ id: therapyCentresTable.id }).from(therapyCentresTable)
      .where(and(eq(therapyCentresTable.id, booking.centreId), eq(therapyCentresTable.ownerUserId, req.userId!)));
    isCentreOwner = !!centre;
  }
  if (booking.parentId !== req.userId! && !isProfessional && !isCentreOwner && req.userRole !== "admin") {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  if (booking.status !== "confirmed") {
    res.status(409).json({ error: "Only a confirmed (not yet started) session can be rescheduled" });
    return;
  }

  const { bookedDate, startTime } = parsed.data;

  let updated: typeof booking | undefined;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(bookingSlotLockSql(booking.professionalId, bookedDate, startTime));

      const [conflict] = await tx
        .select({ id: therapyBookingsTable.id })
        .from(therapyBookingsTable)
        .where(and(
          eq(therapyBookingsTable.professionalId, booking.professionalId),
          eq(therapyBookingsTable.bookedDate, bookedDate),
          eq(therapyBookingsTable.startTime, startTime),
          eq(therapyBookingsTable.status, "confirmed"),
          ne(therapyBookingsTable.id, bookingId),
        ));
      if (conflict) throw Object.assign(new Error("SLOT_TAKEN"), { statusCode: 409 });

      const [slot] = await tx
        .select({ endTime: slotsTable.endTime, serviceId: slotsTable.serviceId })
        .from(slotsTable)
        .where(and(
          eq(slotsTable.professionalId, booking.professionalId),
          eq(slotsTable.date, bookedDate),
          eq(slotsTable.startTime, startTime),
        ));
      if (!slot) throw Object.assign(new Error("NO_MATCHING_SLOT"), { statusCode: 400 });
      // A reschedule moves the TIME, not what was purchased/agreed to —
      // staying within the same service keeps the already-snapshotted
      // amountInr/commissionInr/packagePurchaseId meaningful. A genuine
      // service change is a new booking, not a reschedule.
      if (slot.serviceId !== booking.serviceId) throw Object.assign(new Error("SERVICE_MISMATCH"), { statusCode: 400 });

      const now = new Date();
      [updated] = await tx
        .update(therapyBookingsTable)
        .set({
          bookedDate,
          startTime,
          endTime: slot.endTime,
          startOtp: generateOtp(),
          endOtp: generateOtp(),
          otpIssuedAt: now,
          otpAttempts: 0,
          updatedAt: now,
        })
        .where(eq(therapyBookingsTable.id, bookingId))
        .returning();
    });
  } catch (err: unknown) {
    const e = err as Error & { statusCode?: number };
    if (e.message === "SLOT_TAKEN") { res.status(409).json({ error: "That time is already booked" }); return; }
    if (e.message === "NO_MATCHING_SLOT") { res.status(400).json({ error: "This date/time is not an available slot for this professional" }); return; }
    if (e.message === "SERVICE_MISMATCH") { res.status(400).json({ error: "Reschedule must stay within the same service" }); return; }
    throw err;
  }

  res.json(updated);
});

// ── POST /therapy-bookings/verify-payment ───────────────────────────────────
const VerifyTherapyBookingPaymentBody = z.object({
  bookingId: z.number().int().positive(),
  razorpayPaymentId: z.string(),
  razorpayOrderId: z.string(),
  razorpaySignature: z.string(),
});
router.post("/therapy-bookings/verify-payment", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = VerifyTherapyBookingPaymentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keySecret) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  const { bookingId, razorpayPaymentId, razorpayOrderId, razorpaySignature } = parsed.data;

  const [booking] = await db
    .select()
    .from(therapyBookingsTable)
    .where(and(eq(therapyBookingsTable.id, bookingId), eq(therapyBookingsTable.parentId, req.userId!)));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  if (booking.providerOrderId !== razorpayOrderId) { res.status(400).json({ error: "Order ID mismatch" }); return; }

  const expectedSig = crypto.createHmac("sha256", keySecret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest("hex");
  if (expectedSig !== razorpaySignature) { res.status(400).json({ error: "Payment signature verification failed" }); return; }

  // Same lock-then-recheck-then-write as /sessions/verify-payment -- this
  // is the endpoint that actually closes the Razorpay-path race, since
  // /therapy-bookings/book's own lock only protects its pending_payment
  // insert, which never conflicts with the "confirmed" filter.
  let confirmed: typeof booking | undefined;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(bookingSlotLockSql(booking.professionalId, booking.bookedDate, booking.startTime));

      const [conflict] = await tx
        .select({ id: therapyBookingsTable.id })
        .from(therapyBookingsTable)
        .where(and(
          eq(therapyBookingsTable.professionalId, booking.professionalId),
          eq(therapyBookingsTable.bookedDate, booking.bookedDate),
          eq(therapyBookingsTable.startTime, booking.startTime),
          eq(therapyBookingsTable.status, "confirmed"),
          ne(therapyBookingsTable.id, bookingId),
        ));
      if (conflict) throw Object.assign(new Error("SLOT_TAKEN"), { statusCode: 409 });

      [confirmed] = await tx
        .update(therapyBookingsTable)
        .set({
          status: "confirmed",
          providerPaymentId: razorpayPaymentId,
          startOtp: generateOtp(),
          endOtp: generateOtp(),
          otpIssuedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(therapyBookingsTable.id, bookingId))
        .returning();
    });
  } catch (err: unknown) {
    const e = err as Error & { statusCode?: number };
    if (e.message === "SLOT_TAKEN") {
      res.status(409).json({ error: "This slot was booked by someone else while your payment was processing. Contact support for a refund." });
      return;
    }
    throw err;
  }

  res.json(confirmed);
});

// ── Package purchases ────────────────────────────────────────────────────────

router.post("/therapy-bookings/packages/:packageId/purchase", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const packageId = parsedId(req.params["packageId"] as string);
  if (!packageId) { res.status(400).json({ error: "Invalid package id" }); return; }

  const [pkg] = await db
    .select()
    .from(centreServicePackagesTable)
    .where(and(eq(centreServicePackagesTable.id, packageId), eq(centreServicePackagesTable.isActive, true)));
  if (!pkg) { res.status(404).json({ error: "Package not found or inactive" }); return; }

  const razorpay = getRazorpay();
  if (!razorpay) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  const order = await razorpay.orders.create({
    amount: pkg.priceInr * 100,
    currency: "INR",
    receipt: `pkg_purchase_${Date.now()}`,
  });

  const [purchase] = await db
    .insert(centreServicePackagePurchasesTable)
    .values({
      packageId: pkg.id,
      centreId: pkg.centreId,
      serviceId: pkg.serviceId,
      parentId: req.userId!,
      sessionsTotal: pkg.sessionCount,
      amountPaidInr: pkg.priceInr,
      providerOrderId: order.id as string,
    })
    .returning();

  res.json({
    purchaseId: purchase.id,
    orderId: order.id,
    amount: pkg.priceInr * 100,
    currency: "INR",
    keyId: process.env["RAZORPAY_KEY_ID"]!,
  });
});

const VerifyPackagePurchasePaymentBody = z.object({
  purchaseId: z.number().int().positive(),
  razorpayPaymentId: z.string(),
  razorpayOrderId: z.string(),
  razorpaySignature: z.string(),
});
router.post("/therapy-bookings/packages/purchases/verify-payment", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = VerifyPackagePurchasePaymentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keySecret) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  const { purchaseId, razorpayPaymentId, razorpayOrderId, razorpaySignature } = parsed.data;

  const [purchase] = await db
    .select()
    .from(centreServicePackagePurchasesTable)
    .where(and(eq(centreServicePackagePurchasesTable.id, purchaseId), eq(centreServicePackagePurchasesTable.parentId, req.userId!)));
  if (!purchase) { res.status(404).json({ error: "Purchase not found" }); return; }
  if (purchase.providerOrderId !== razorpayOrderId) { res.status(400).json({ error: "Order ID mismatch" }); return; }

  const expectedSig = crypto.createHmac("sha256", keySecret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest("hex");
  if (expectedSig !== razorpaySignature) { res.status(400).json({ error: "Payment signature verification failed" }); return; }

  const [updated] = await db
    .update(centreServicePackagePurchasesTable)
    .set({ status: "active", providerPaymentId: razorpayPaymentId, updatedAt: new Date() })
    .where(eq(centreServicePackagePurchasesTable.id, purchaseId))
    .returning();

  res.json(updated);
});

router.get("/therapy-bookings/packages/purchases/mine", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const rows = await db
    .select()
    .from(centreServicePackagePurchasesTable)
    .where(eq(centreServicePackagePurchasesTable.parentId, req.userId!))
    .orderBy(desc(centreServicePackagePurchasesTable.createdAt));
  res.json(rows);
});

// ── PATCH /therapy-bookings/:id/mark-completed ──────────────────────────────
// TEMPORARY stand-in for Step 2's OTP-driven completion flow (endOtp
// verification will replace this transition's trigger). The postDuesCharge
// wiring below is NOT temporary — it's the real, final settlement path;
// this endpoint only exists so that wiring can be proven correct before
// Step 2's OTP endpoints exist. Routes through postDuesCharge, never
// ledger.ts's releaseWithCommission -- see the commission-gap finding this
// migration was built to fix: a centre's resolvedCommissionPct must
// actually reach settlement, not just sit snapshotted on the booking row.
router.patch("/therapy-bookings/:id/mark-completed", requireAuth, requireRole("professional", "admin"), async (req: Request, res: Response): Promise<void> => {
  const bookingId = parsedId(req.params["id"] as string);
  if (!bookingId) { res.status(400).json({ error: "Invalid booking id" }); return; }

  const [booking] = await db.select().from(therapyBookingsTable).where(eq(therapyBookingsTable.id, bookingId));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }

  if (req.userRole !== "admin") {
    const [prof] = await db.select({ id: professionalProfilesTable.id }).from(professionalProfilesTable)
      .where(eq(professionalProfilesTable.userId, req.userId!));
    if (!prof || prof.id !== booking.professionalId) { res.status(403).json({ error: "Access denied" }); return; }
  }

  if (booking.status !== "confirmed") {
    res.status(409).json({ error: "Only a confirmed session can be marked completed" });
    return;
  }

  const [updated] = await db
    .update(therapyBookingsTable)
    .set({ status: "session_completed", completedAt: new Date(), updatedAt: new Date() })
    .where(eq(therapyBookingsTable.id, bookingId))
    .returning();

  await postDuesCharge({
    ownerType: "centre",
    ownerId: booking.centreId,
    sourceType: "therapy_booking",
    sourceId: booking.id,
    amountInr: booking.commissionInr,
  });

  res.json(updated);
});

export default router;
