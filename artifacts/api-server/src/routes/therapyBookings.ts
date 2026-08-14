import { Router, type IRouter, type Request, type Response } from "express";
import { eq, ne, and, desc, sql } from "drizzle-orm";
import Razorpay from "razorpay";
import crypto from "crypto";
import {
  db,
  therapyCentresTable,
  centreTherapistsTable,
  centreServicesTable,
  centreServicePricesTable,
  centreServicePackagesTable,
  centreServicePackagePurchasesTable,
  therapyBookingsTable,
  professionalProfilesTable,
  slotsTable,
  usersTable,
  adminSettingsTable,
  centreCancellationPoliciesTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { generateOtp } from "../lib/otp";
import { postDuesCharge } from "../lib/platformDues";
import { createInAppNotification } from "../lib/notificationService";
import { logger } from "../lib/logger";
import { z } from "zod/v4";

// Same constant sessionsV2.ts uses for sessionBookingsTable's OTP lockout —
// ported, not imported, since that's a route-file-to-route-file boundary
// this codebase doesn't cross (see slotGeneration.ts's own convention note
// re: trivial per-file duplication).
const OTP_MAX_ATTEMPTS = 5;

async function getOtpSettings() {
  const [s] = await db.select({ otpValidityMinutes: adminSettingsTable.otpValidityMinutes, otpStallFlagDays: adminSettingsTable.otpStallFlagDays }).from(adminSettingsTable).limit(1);
  return s ?? { otpValidityMinutes: 10, otpStallFlagDays: 5 };
}

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
  // Tiebreaker on id DESC, not just effectiveFrom DESC -- two price rows
  // CAN legitimately share the same effectiveFrom (a same-day correction,
  // or two prices both entered "effective today"), and id (a serial
  // primary key, assigned atomically and strictly unique) is the only
  // column here guaranteed to break that tie the same way every time.
  // createdAt would mostly work but isn't provably collision-proof for
  // rows inserted in the same transaction/tight batch -- id is.
  const priceRows = await db
    .select({ id: centreServicePricesTable.id, commissionPctOverride: centreServicePricesTable.commissionPctOverride, effectiveFrom: centreServicePricesTable.effectiveFrom })
    .from(centreServicePricesTable)
    .where(and(eq(centreServicePricesTable.centreId, centreId), eq(centreServicePricesTable.serviceId, serviceId)))
    .orderBy(desc(centreServicePricesTable.effectiveFrom), desc(centreServicePricesTable.id));
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
  // Same id-DESC tiebreaker as resolveCentreCommission, same reasoning.
  const rows = await db
    .select({ id: centreServicePricesTable.id, priceInr: centreServicePricesTable.priceInr, effectiveFrom: centreServicePricesTable.effectiveFrom })
    .from(centreServicePricesTable)
    .where(and(eq(centreServicePricesTable.centreId, centreId), eq(centreServicePricesTable.serviceId, serviceId)))
    .orderBy(desc(centreServicePricesTable.effectiveFrom), desc(centreServicePricesTable.id));
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
          otpLockedAt: null,
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

// ── GET /therapy-bookings/:id ───────────────────────────────────────────────
// Mirrors GET /sessions-v2/:id's access-check + showOtps shape exactly —
// admin/parent/participating-professional only; startOtp/endOtp stripped
// to undefined outside the window where the parent is allowed to reveal
// them to the therapist in person.
router.get("/therapy-bookings/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const bookingId = parsedId(req.params["id"] as string);
  if (!bookingId) { res.status(400).json({ error: "Invalid booking id" }); return; }

  const [booking] = await db.select().from(therapyBookingsTable).where(eq(therapyBookingsTable.id, bookingId));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }

  const isAdmin = req.userRole === "admin";
  const isParent = booking.parentId === req.userId;
  let isPro = false;
  if (!isAdmin && !isParent) {
    const [prof] = await db.select({ id: professionalProfilesTable.id }).from(professionalProfilesTable)
      .where(eq(professionalProfilesTable.userId, req.userId!));
    isPro = !!prof && prof.id === booking.professionalId;
  }
  if (!isAdmin && !isParent && !isPro) { res.status(403).json({ error: "Access denied" }); return; }

  const showOtps = isParent && ["confirmed", "session_started"].includes(booking.status ?? "");

  res.json({
    ...booking,
    startOtp: showOtps ? booking.startOtp : undefined,
    endOtp: showOtps ? booking.endOtp : undefined,
  });
});

// ── POST /therapy-bookings/:id/start-otp ────────────────────────────────────
// Ported from sessionsV2.ts's start-otp control flow verbatim (lock check
// -> expiry check+regen -> mismatch/attempt-increment/lock+alert -> success
// transition) -- same shape, different table, different final status names
// ('confirmed' here where V2 has 'paid_held'). requireRole("professional")
// PLUS the professionalId ownership check below is what actually
// guarantees startConfirmedByUserId can only ever be set to the therapist's
// own sub-account userId -- a centre_admin has the wrong role and never
// reaches the ownership check at all.
const OtpBody = z.object({ otp: z.string().length(6) });
router.post("/therapy-bookings/:id/start-otp", requireAuth, requireRole("professional"), async (req: Request, res: Response): Promise<void> => {
  const bookingId = parsedId(req.params["id"] as string);
  if (!bookingId) { res.status(400).json({ error: "Invalid booking id" }); return; }
  const parsed = OtpBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "OTP must be 6 digits" }); return; }

  const [prof] = await db.select({ id: professionalProfilesTable.id }).from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, req.userId!));
  if (!prof) { res.status(404).json({ error: "Professional profile not found" }); return; }

  const [booking] = await db.select().from(therapyBookingsTable)
    .where(and(eq(therapyBookingsTable.id, bookingId), eq(therapyBookingsTable.professionalId, prof.id)));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  if (booking.status !== "confirmed") { res.status(400).json({ error: "Booking is not in a startable status" }); return; }

  if (booking.otpLockedAt) { res.status(403).json({ error: "OTP is locked due to too many failed attempts. Contact admin." }); return; }

  const settings = await getOtpSettings();
  const now = new Date();

  if (booking.otpIssuedAt) {
    const expiryMs = settings.otpValidityMinutes * 60 * 1000;
    if (now.getTime() - booking.otpIssuedAt.getTime() > expiryMs) {
      await db.update(therapyBookingsTable).set({
        startOtp: generateOtp(), endOtp: generateOtp(), otpIssuedAt: now, otpAttempts: 0, updatedAt: now,
      }).where(eq(therapyBookingsTable.id, bookingId));
      res.status(400).json({ error: "OTP expired — a new OTP has been generated. Ask the parent to check their app." });
      return;
    }
  }

  if (parsed.data.otp !== booking.startOtp) {
    const newAttempts = (booking.otpAttempts ?? 0) + 1;
    if (newAttempts >= OTP_MAX_ATTEMPTS) {
      await db.update(therapyBookingsTable).set({ otpAttempts: newAttempts, otpLockedAt: now, updatedAt: now }).where(eq(therapyBookingsTable.id, bookingId));
      await createInAppNotification(booking.parentId, {
        type: "session_otp_locked",
        title: "OTP locked — admin alerted",
        body: "Too many wrong OTP attempts. Admin has been notified.",
        relatedType: "therapy_booking",
        relatedId: bookingId,
      }).catch(() => {});
      res.status(403).json({ error: "Too many failed attempts — OTP locked. Admin has been alerted." });
      return;
    }
    await db.update(therapyBookingsTable).set({ otpAttempts: newAttempts, updatedAt: now }).where(eq(therapyBookingsTable.id, bookingId));
    res.status(400).json({ error: "Incorrect OTP", attemptsRemaining: OTP_MAX_ATTEMPTS - newAttempts });
    return;
  }

  const [updated] = await db
    .update(therapyBookingsTable)
    .set({ status: "session_started", startedAt: now, startConfirmedByUserId: req.userId!, otpAttempts: 0, updatedAt: now })
    .where(eq(therapyBookingsTable.id, bookingId))
    .returning();

  res.json(updated);
});

// ── POST /therapy-bookings/:id/end-otp ──────────────────────────────────────
// Same shape as start-otp. On success this is the REAL completion trigger —
// fires postDuesCharge, same as the (now admin-only) mark-completed stub
// did, so settlement behaves identically regardless of which path a
// session reaches session_completed through.
router.post("/therapy-bookings/:id/end-otp", requireAuth, requireRole("professional"), async (req: Request, res: Response): Promise<void> => {
  const bookingId = parsedId(req.params["id"] as string);
  if (!bookingId) { res.status(400).json({ error: "Invalid booking id" }); return; }
  const parsed = OtpBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "OTP must be 6 digits" }); return; }

  const [prof] = await db.select({ id: professionalProfilesTable.id }).from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, req.userId!));
  if (!prof) { res.status(404).json({ error: "Professional profile not found" }); return; }

  const [booking] = await db.select().from(therapyBookingsTable)
    .where(and(eq(therapyBookingsTable.id, bookingId), eq(therapyBookingsTable.professionalId, prof.id)));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  if (booking.status !== "session_started") { res.status(400).json({ error: "Booking has not been started yet" }); return; }

  if (booking.otpLockedAt) { res.status(403).json({ error: "OTP is locked due to too many failed attempts. Contact admin." }); return; }

  const settings = await getOtpSettings();
  const now = new Date();

  if (booking.otpIssuedAt) {
    const expiryMs = settings.otpValidityMinutes * 60 * 1000;
    if (now.getTime() - booking.otpIssuedAt.getTime() > expiryMs) {
      await db.update(therapyBookingsTable).set({
        startOtp: generateOtp(), endOtp: generateOtp(), otpIssuedAt: now, otpAttempts: 0, updatedAt: now,
      }).where(eq(therapyBookingsTable.id, bookingId));
      res.status(400).json({ error: "OTP expired — a new OTP has been generated. Ask the parent to check their app." });
      return;
    }
  }

  if (parsed.data.otp !== booking.endOtp) {
    const newAttempts = (booking.otpAttempts ?? 0) + 1;
    if (newAttempts >= OTP_MAX_ATTEMPTS) {
      await db.update(therapyBookingsTable).set({ otpAttempts: newAttempts, otpLockedAt: now, updatedAt: now }).where(eq(therapyBookingsTable.id, bookingId));
      await createInAppNotification(booking.parentId, {
        type: "session_otp_locked",
        title: "OTP locked — admin alerted",
        body: "Too many wrong OTP attempts. Admin has been notified.",
        relatedType: "therapy_booking",
        relatedId: bookingId,
      }).catch(() => {});
      res.status(403).json({ error: "Too many failed attempts — OTP locked. Admin has been alerted." });
      return;
    }
    await db.update(therapyBookingsTable).set({ otpAttempts: newAttempts, updatedAt: now }).where(eq(therapyBookingsTable.id, bookingId));
    res.status(400).json({ error: "Incorrect OTP", attemptsRemaining: OTP_MAX_ATTEMPTS - newAttempts });
    return;
  }

  const [updated] = await db
    .update(therapyBookingsTable)
    .set({ status: "session_completed", completedAt: now, endConfirmedByUserId: req.userId!, otpAttempts: 0, updatedAt: now })
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

// ── POST /therapy-bookings/:id/regenerate-otp ───────────────────────────────
// Either participant (parent or the therapist) can request fresh codes if
// the old ones expired or were lost -- mirrors sessionsV2.ts's regenerate
// endpoint.
router.post("/therapy-bookings/:id/regenerate-otp", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const bookingId = parsedId(req.params["id"] as string);
  if (!bookingId) { res.status(400).json({ error: "Invalid booking id" }); return; }

  const [booking] = await db.select().from(therapyBookingsTable).where(eq(therapyBookingsTable.id, bookingId));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }

  const isParent = booking.parentId === req.userId;
  let isPro = false;
  if (!isParent) {
    const [prof] = await db.select({ id: professionalProfilesTable.id }).from(professionalProfilesTable)
      .where(eq(professionalProfilesTable.userId, req.userId!));
    isPro = !!prof && prof.id === booking.professionalId;
  }
  if (!isParent && !isPro) { res.status(403).json({ error: "Access denied" }); return; }

  if (!["confirmed", "session_started"].includes(booking.status ?? "")) {
    res.status(400).json({ error: "OTP regeneration not applicable in current status" });
    return;
  }

  const now = new Date();
  await db.update(therapyBookingsTable).set({
    startOtp: generateOtp(), endOtp: generateOtp(), otpIssuedAt: now, otpAttempts: 0, otpLockedAt: null, updatedAt: now,
  }).where(eq(therapyBookingsTable.id, bookingId));

  res.json({ message: "OTPs regenerated successfully" });
});

// ── PATCH /therapy-bookings/:id/mark-completed ──────────────────────────────
// Admin-only human-resolution path for a stalled booking (see
// isBookingStalled/GET /admin/therapy-bookings/stalled below) -- a
// therapist ALWAYS goes through real start-otp/end-otp now that those
// exist; this is deliberately not reachable by "professional" anymore, so
// there's no shortcut around actual OTP confirmation. Gate broadened from
// 'confirmed' only to also accept 'session_started', since a stalled
// session can be stuck at either point (never started, or started but
// never ended) -- both are things this action needs to be able to resolve.
// Still routes through postDuesCharge, same as end-otp's success path, so
// settlement behaves identically regardless of which path reached
// session_completed.
router.patch("/therapy-bookings/:id/mark-completed", requireAuth, requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
  const bookingId = parsedId(req.params["id"] as string);
  if (!bookingId) { res.status(400).json({ error: "Invalid booking id" }); return; }

  const [booking] = await db.select().from(therapyBookingsTable).where(eq(therapyBookingsTable.id, bookingId));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }

  if (!["confirmed", "session_started"].includes(booking.status ?? "")) {
    res.status(409).json({ error: "Only a confirmed or in-progress session can be marked completed" });
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

// ── GET /admin/therapy-bookings/stalled ─────────────────────────────────────
// Lazy, evaluated-on-read surfacing -- NOT a cron, NOT auto-resolved, same
// discipline as B8's isOwnerOverdue/resolveOverdueDuesInvoices, explicitly
// NOT stuckEngagementResolver.ts's trial-timeout auto-progression pattern
// (a stalled session must never silently become "completed" on its own).
// Response is deliberately rich, not just IDs -- an admin needs to be able
// to act from this list without a second lookup: who's involved, how long
// it's been stalled, and specifically which side's confirmation is
// missing (waitingOn), since "confirmed" (never started) and
// "session_started" (started, never ended) call for different follow-up.
function isBookingStalled(bookedDate: string, status: string, stallFlagDays: number): boolean {
  if (status !== "confirmed" && status !== "session_started") return false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - stallFlagDays);
  return bookedDate <= cutoff.toISOString().slice(0, 10);
}

router.get("/admin/therapy-bookings/stalled", requireAuth, requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
  const settings = await getOtpSettings();

  const candidates = await db
    .select({
      id: therapyBookingsTable.id,
      centreId: therapyBookingsTable.centreId,
      centreName: therapyCentresTable.name,
      professionalId: therapyBookingsTable.professionalId,
      therapistName: centreTherapistsTable.name,
      parentId: therapyBookingsTable.parentId,
      parentName: usersTable.fullName,
      parentEmail: usersTable.email,
      serviceId: therapyBookingsTable.serviceId,
      serviceName: centreServicesTable.name,
      bookedDate: therapyBookingsTable.bookedDate,
      startTime: therapyBookingsTable.startTime,
      endTime: therapyBookingsTable.endTime,
      status: therapyBookingsTable.status,
      startedAt: therapyBookingsTable.startedAt,
      otpLockedAt: therapyBookingsTable.otpLockedAt,
      amountInr: therapyBookingsTable.amountInr,
      commissionInr: therapyBookingsTable.commissionInr,
    })
    .from(therapyBookingsTable)
    .innerJoin(therapyCentresTable, eq(therapyCentresTable.id, therapyBookingsTable.centreId))
    .leftJoin(centreTherapistsTable, eq(centreTherapistsTable.professionalProfileId, therapyBookingsTable.professionalId))
    .innerJoin(usersTable, eq(usersTable.id, therapyBookingsTable.parentId))
    .innerJoin(centreServicesTable, eq(centreServicesTable.id, therapyBookingsTable.serviceId))
    .where(sql`${therapyBookingsTable.status} IN ('confirmed', 'session_started')`);

  const today = new Date().toISOString().slice(0, 10);
  const stalled = candidates
    .filter((b) => isBookingStalled(b.bookedDate, b.status, settings.otpStallFlagDays))
    .map((b) => {
      const stalledDays = Math.floor((new Date(today).getTime() - new Date(b.bookedDate).getTime()) / (24 * 60 * 60 * 1000));
      return {
        ...b,
        stalledDays,
        waitingOn: b.status === "confirmed" ? "start_confirmation" : "end_confirmation",
        otpCurrentlyLocked: !!b.otpLockedAt,
      };
    })
    .sort((a, b) => b.stalledDays - a.stalledDays);

  res.json(stalled);
});

// ── POST /therapy-bookings/:id/cancel ───────────────────────────────────────
// Computes a refund from the centre's own cancellation policy
// (centreCancellationPoliciesTable — falls back to the schema's own column
// defaults if the centre never configured one) and applies it via the same
// real Razorpay refund call already used elsewhere in this codebase
// (admin.ts, professionals.ts, shadowTeacher.ts, therapist.ts), not a new
// refund mechanism. Package-consumed bookings have no per-booking payment to
// refund against — those get a binary credit-restore instead (full window =
// restore the session credit; inside the window = permanently consumed),
// which matches a slot-based value better than approximating a cash
// percentage on a credit.
const CancelBookingBody = z.object({
  reason: z.enum(["parent_cancelled", "parent_no_show", "centre_no_show"]),
});

const DEFAULT_CANCELLATION_POLICY = {
  window1Hours: 24, window1RefundPct: 100,
  window2Hours: 2, window2RefundPct: 50,
  insideWindow2RefundPct: 0,
  noShowRefundPct: 0,
  centreNoShowRefundPct: 100,
  offerCompensationSlot: true,
};

router.post("/therapy-bookings/:id/cancel", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const bookingId = parsedId(req.params["id"] as string);
  if (!bookingId) { res.status(400).json({ error: "Invalid booking id" }); return; }
  const parsed = CancelBookingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { reason } = parsed.data;

  const [booking] = await db.select().from(therapyBookingsTable).where(eq(therapyBookingsTable.id, bookingId));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }

  const isAdmin = req.userRole === "admin";
  const isParent = booking.parentId === req.userId;
  let isPro = false;
  let isCentreOwner = false;
  if (!isParent && !isAdmin) {
    const [prof] = await db.select({ id: professionalProfilesTable.id }).from(professionalProfilesTable)
      .where(eq(professionalProfilesTable.userId, req.userId!));
    isPro = !!prof && prof.id === booking.professionalId;
    if (!isPro) {
      const [centre] = await db.select({ id: therapyCentresTable.id }).from(therapyCentresTable)
        .where(and(eq(therapyCentresTable.id, booking.centreId), eq(therapyCentresTable.ownerUserId, req.userId!)));
      isCentreOwner = !!centre;
    }
  }

  if (reason === "parent_cancelled") {
    if (!isParent && !isAdmin) { res.status(403).json({ error: "Only the parent can cancel with this reason" }); return; }
  } else {
    // parent_no_show / centre_no_show — reported by the centre side after
    // the fact, not self-declared by the parent.
    if (!isPro && !isCentreOwner && !isAdmin) { res.status(403).json({ error: "Only the therapist, centre admin, or platform admin can report a no-show" }); return; }
  }

  if (booking.status !== "confirmed") {
    res.status(409).json({ error: "Only a confirmed (not yet started) session can be cancelled" });
    return;
  }

  const [policyRow] = await db.select().from(centreCancellationPoliciesTable).where(eq(centreCancellationPoliciesTable.centreId, booking.centreId));
  const policy = policyRow ?? DEFAULT_CANCELLATION_POLICY;

  let refundPct: number;
  if (reason === "parent_no_show") {
    refundPct = policy.noShowRefundPct;
  } else if (reason === "centre_no_show") {
    refundPct = policy.centreNoShowRefundPct;
  } else {
    const sessionStart = new Date(`${booking.bookedDate}T${booking.startTime}:00`);
    const hoursUntil = (sessionStart.getTime() - Date.now()) / (60 * 60 * 1000);
    if (hoursUntil >= policy.window1Hours) refundPct = policy.window1RefundPct;
    else if (hoursUntil >= policy.window2Hours) refundPct = policy.window2RefundPct;
    else refundPct = policy.insideWindow2RefundPct;
  }

  const refundAmountInr = Math.round((booking.amountInr * refundPct) / 100);
  const newStatus = reason === "centre_no_show" ? "cancelled_by_centre" : "cancelled_by_parent";
  const isPackageBooking = !!booking.packagePurchaseId;

  // Atomic status transition — conditional on status still being 'confirmed'
  // so two near-simultaneous cancel attempts can't both process (the second
  // gets zero rows back, treated as already-cancelled) — same conditional-
  // UPDATE-RETURNING discipline as the package-consumption guard in
  // POST /therapy-bookings/book.
  const [updated] = await db
    .update(therapyBookingsTable)
    .set({
      status: newStatus,
      cancellationReason: isPackageBooking
        ? `${reason}: ${refundPct >= 100 ? "package credit restored" : "package credit consumed (no refund)"}`
        : `${reason}: ${refundPct}% refund (₹${refundAmountInr})`,
      compensationSlotOffered: policy.offerCompensationSlot,
      updatedAt: new Date(),
    })
    .where(and(eq(therapyBookingsTable.id, bookingId), eq(therapyBookingsTable.status, "confirmed")))
    .returning();

  if (!updated) {
    res.status(409).json({ error: "This booking was already cancelled or is no longer in a cancellable state" });
    return;
  }

  let creditRestored = false;
  if (isPackageBooking) {
    if (refundPct >= 100) {
      const [restored] = await db
        .update(centreServicePackagePurchasesTable)
        .set({
          sessionsConsumed: sql`GREATEST(${centreServicePackagePurchasesTable.sessionsConsumed} - 1, 0)`,
          status: sql`CASE WHEN status = 'exhausted' THEN 'active' ELSE status END`,
          updatedAt: new Date(),
        })
        .where(and(eq(centreServicePackagePurchasesTable.id, booking.packagePurchaseId!), sql`${centreServicePackagePurchasesTable.sessionsConsumed} > 0`))
        .returning();
      creditRestored = !!restored;
    }
  } else if (refundAmountInr > 0 && booking.providerPaymentId) {
    const razorpay = getRazorpay();
    if (razorpay) {
      try {
        await (razorpay.payments as unknown as { refund: (id: string, opts: object) => Promise<unknown> })
          .refund(booking.providerPaymentId, { amount: refundAmountInr * 100, notes: { reason, bookingId: String(bookingId) } });
      } catch (err: unknown) {
        // The booking is already correctly marked cancelled — that must
        // never be blocked on this. But a failed refund must never fail
        // SILENTLY: log it with enough detail to act on, and flag the
        // booking itself so it surfaces on GET /admin/therapy-bookings/
        // refund-failed — same "no silent resolution, admin must see and
        // act" principle as isBookingStalled. Without this, a parent's
        // cancellation would appear to fully succeed while the refund
        // never actually reached Razorpay at all.
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error(
          { bookingId, providerPaymentId: booking.providerPaymentId, attemptedAmountInr: refundAmountInr, err: errorMessage },
          "Cancellation refund failed — booking cancelled but refund did not reach Razorpay",
        );
        await db
          .update(therapyBookingsTable)
          .set({ refundFailedAt: new Date(), refundFailureReason: errorMessage, updatedAt: new Date() })
          .where(eq(therapyBookingsTable.id, bookingId));
      }
    }
  }

  res.json({
    ...updated,
    refundPct,
    refundAmountInr: isPackageBooking ? 0 : refundAmountInr,
    packageCreditRestored: isPackageBooking ? creditRestored : undefined,
  });
});

// ── GET /admin/therapy-bookings/refund-failed ───────────────────────────────
// Lazy, evaluated-on-read surfacing — no cron, no auto-retry. A failed
// refund is exactly the kind of thing that must never silently resolve
// itself; an admin has to see it and take real action (retry via Razorpay's
// dashboard directly, or handle it another way), same principle as
// GET /admin/therapy-bookings/stalled. Rich response for the same reason
// that one is: an admin needs to be able to act without a second lookup.
router.get("/admin/therapy-bookings/refund-failed", requireAuth, requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
  const rows = await db
    .select({
      id: therapyBookingsTable.id,
      centreId: therapyBookingsTable.centreId,
      centreName: therapyCentresTable.name,
      parentId: therapyBookingsTable.parentId,
      parentName: usersTable.fullName,
      parentEmail: usersTable.email,
      bookedDate: therapyBookingsTable.bookedDate,
      startTime: therapyBookingsTable.startTime,
      amountInr: therapyBookingsTable.amountInr,
      cancellationReason: therapyBookingsTable.cancellationReason,
      providerPaymentId: therapyBookingsTable.providerPaymentId,
      refundFailedAt: therapyBookingsTable.refundFailedAt,
      refundFailureReason: therapyBookingsTable.refundFailureReason,
    })
    .from(therapyBookingsTable)
    .innerJoin(therapyCentresTable, eq(therapyCentresTable.id, therapyBookingsTable.centreId))
    .innerJoin(usersTable, eq(usersTable.id, therapyBookingsTable.parentId))
    .where(sql`${therapyBookingsTable.refundFailedAt} IS NOT NULL`)
    .orderBy(desc(therapyBookingsTable.refundFailedAt));

  res.json(rows);
});

// ── PATCH /admin/therapy-bookings/:id/mark-refund-resolved ─────────────────
// Clears the flag once an admin has actually handled the refund by some
// other means (typically Razorpay's own dashboard) — this endpoint never
// itself moves money, it only closes out the surfaced item, mirroring the
// disputes table's own "records the decision, doesn't execute it" design.
router.patch("/admin/therapy-bookings/:id/mark-refund-resolved", requireAuth, requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
  const bookingId = parsedId(req.params["id"] as string);
  if (!bookingId) { res.status(400).json({ error: "Invalid booking id" }); return; }

  const [booking] = await db.select().from(therapyBookingsTable).where(eq(therapyBookingsTable.id, bookingId));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  if (!booking.refundFailedAt) { res.status(409).json({ error: "This booking has no outstanding refund failure" }); return; }

  const [updated] = await db
    .update(therapyBookingsTable)
    .set({ refundFailedAt: null, refundFailureReason: null, updatedAt: new Date() })
    .where(eq(therapyBookingsTable.id, bookingId))
    .returning();

  res.json(updated);
});

export default router;
