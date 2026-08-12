import { Router, type IRouter, type Request, type Response } from "express";
import { eq, ne, and, desc, sql, gte, lte, inArray } from "drizzle-orm";
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
  slotsTable,
  childrenTable,
  tutorEngagementsTable,
  tutorEngagementSessionsTable,
  therapistEngagementsTable,
  therapistEngagementSessionsTable,
  therapyCentresTable,
  centreServicesTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { generateOtp } from "../lib/otp";
import { sendPushNotification } from "../lib/notificationService";
import { createLedgerHeld, releaseWithCommission, refundToWallet, findLedgerByBooking } from "../lib/ledger";
import { convertReferralIfNeeded } from "./referrals";
import { getRecurringAndSessionBusyWindows, overlapsAnyWindow, getCommittedEngagementBlocks } from "../lib/recurringSchedule";
import { overlaps } from "../lib/scheduleConflict";
import {
  SetAvailabilityBody,
  BookSessionBody,
  VerifySessionPaymentBody,
  UpdateSessionStatusBody,
} from "@workspace/api-zod";
import { z } from "zod/v4";

const router: IRouter = Router();

function getRazorpay() {
  const keyId = process.env["RAZORPAY_KEY_ID"];
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keyId || !keySecret) return null;
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

function getSessionCommission(specialty: string): number {
  // The "therapy_centre" branch below predates the real centre-identity
  // model (employingCentreId) — a professional_profiles row is never
  // actually created with this specialty value in production (only a
  // demo-seed script does, per the therapy-centre audit). Left as-is,
  // not fixed here — resolveBookingCommission below is the real,
  // employingCentreId-driven path for centre-employed professionals now.
  if (specialty === "therapy_centre") return 149;
  if (specialty === "psychiatrist" || specialty === "neurologist") return 99;
  return 49;
}

// Resolves the REAL commission for a booking, checking whether the
// professional is centre-employed first. Centre-employed: percentage of
// the (server-computed, not client-supplied) amountInr, using the centre's
// own commissionPctOverride if set, else its platformDefaultCommissionPct
// — resolvedCommissionPct is returned so the caller can snapshot it onto
// the booking row. Non-centre: unchanged flat-amount specialty rate,
// resolvedCommissionPct null (nothing was resolved from a centre rate).
async function resolveBookingCommission(
  professionalId: number,
  specialty: string,
  amountInr: number,
): Promise<{ commissionInr: number; resolvedCommissionPct: number | null }> {
  const [prof] = await db
    .select({ employingCentreId: professionalProfilesTable.employingCentreId })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, professionalId));

  if (prof?.employingCentreId) {
    const [centre] = await db
      .select({
        commissionPctOverride: therapyCentresTable.commissionPctOverride,
        platformDefaultCommissionPct: therapyCentresTable.platformDefaultCommissionPct,
      })
      .from(therapyCentresTable)
      .where(eq(therapyCentresTable.id, prof.employingCentreId));

    if (centre) {
      const pct = centre.commissionPctOverride ?? centre.platformDefaultCommissionPct;
      return { commissionInr: Math.round((amountInr * pct) / 100), resolvedCommissionPct: pct };
    }
  }

  return { commissionInr: getSessionCommission(specialty), resolvedCommissionPct: null };
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

// ── PATCH /sessions/availability/:id — link a template row to a centre
// service ("slot_type"). Centre-scoped only: a non-centre-employed
// professional has no serviceId to set, and this deliberately does not
// touch the individual-professional path at all (SetAvailabilityBody, the
// shared PUT above, is left exactly as-is). Local Zod schema, not the
// generated api-zod contract — this field is meaningless outside the
// centre case, so it doesn't belong in the cross-vertical contract.
const SetTemplateServiceBody = z.object({ serviceId: z.number().int().positive().nullable() });
router.patch("/sessions/availability/:id", requireAuth, requireRole("professional", "admin"), async (req: Request, res: Response): Promise<void> => {
  const templateId = parseInt(req.params["id"] as string, 10);
  if (isNaN(templateId)) { res.status(400).json({ error: "Invalid template id" }); return; }
  const parsed = SetTemplateServiceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [prof] = await db
    .select({ id: professionalProfilesTable.id, employingCentreId: professionalProfilesTable.employingCentreId })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, req.userId!));
  if (!prof) { res.status(404).json({ error: "Professional profile not found" }); return; }
  if (!prof.employingCentreId) {
    res.status(400).json({ error: "Only a centre-employed professional's template can be linked to a service" });
    return;
  }

  const [template] = await db
    .select({ id: professionalAvailabilityTable.id })
    .from(professionalAvailabilityTable)
    .where(and(eq(professionalAvailabilityTable.id, templateId), eq(professionalAvailabilityTable.professionalId, prof.id)));
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }

  if (parsed.data.serviceId !== null) {
    const [service] = await db
      .select({ id: centreServicesTable.id })
      .from(centreServicesTable)
      .where(and(eq(centreServicesTable.id, parsed.data.serviceId), eq(centreServicesTable.centreId, prof.employingCentreId)));
    if (!service) {
      res.status(400).json({ error: "serviceId must belong to your own employing centre" });
      return;
    }
  }

  const [updated] = await db
    .update(professionalAvailabilityTable)
    .set({ serviceId: parsed.data.serviceId, updatedAt: new Date() })
    .where(eq(professionalAvailabilityTable.id, templateId))
    .returning();

  res.json(updated);
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

  // Base candidate set: materialized slots the generation job already
  // confirmed, AT GENERATION TIME, didn't overlap a recurring commitment
  // or individually-scheduled session (lib/slotGeneration.ts). Same
  // response shape as before this migration — no change needed in any of
  // the 3 frontend consumers (AssessmentBookingModal, VerticalRequestWidget,
  // BookingWidgetV2).
  const openSlots = await db
    .select()
    .from(slotsTable)
    .where(
      and(
        eq(slotsTable.professionalId, profId),
        eq(slotsTable.date, dateStr),
        eq(slotsTable.status, "open"),
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

  // Recurring commitments (all 3 verticals) + individually-scheduled
  // tutor/therapist sessions.
  const busyWindows = await getRecurringAndSessionBusyWindows(profId, dateStr);

  // IMPORTANT — these two checks are NOT redundant with the generation
  // job's own exclusion above, even though they check the same sources.
  // This is the read-side-only scope's deliberate design, not
  // belt-and-braces to be cleaned up later: the write-path was NOT
  // migrated (booking creation doesn't reference slotId, so nothing
  // flips a slot's status to 'booked' when a booking happens), and the
  // generation job only runs once daily. Without re-checking live here,
  // a slot booked minutes ago would still show status='open' (stale in
  // one direction), and a brand-new recurring commitment accepted since
  // the last generation run wouldn't be excluded until the NEXT run, up
  // to ~24h later (stale in the other direction). Only remove these live
  // checks once the write-path migration lands and slots.status is
  // actually maintained in real time by the booking endpoints — until
  // then, this is the actual correctness guarantee, not a redundant one.
  const bookable = openSlots
    .filter((s) => !bookedTimes.has(s.startTime) && !overlapsAnyWindow(busyWindows, s.startTime, s.endTime))
    .map((s) => ({
      date: dateStr,
      startTime: s.startTime,
      endTime: s.endTime,
      durationMinutes: s.durationMins,
      priceInr: s.priceInr,
    }));

  bookable.sort((a, b) => a.startTime.localeCompare(b.startTime));
  res.json(bookable);
});

// GET /professionals/me/calendar — the professional's own calendar (B5),
// three layers from three sources, per the agreed design: committed
// recurring engagements expanded from recurringScheduleJson (all 3
// verticals), open availability from materialized slots, booked sessions
// merged from THREE underlying tables (not slots.status='booked' — the
// write-path migration that would keep that in sync is explicitly
// deferred):
//   - session_bookings: ad-hoc/consultation-type bookings (Flow B).
//   - tutor_engagement_sessions / therapist_engagement_sessions: individual
//     dated instances of an ongoing recurring engagement, scheduled one at
//     a time via POST .../engagements/:id/sessions (Item 2) — a genuinely
//     different concept from "committed" above (which is the abstract
//     weekly PATTERN from recurringScheduleJson, not a concrete scheduled
//     instance with its own id/status/meetLink). Merged into "booked"
//     rather than a 4th layer since, from the professional's point of view,
//     both represent an actual scheduled session happening at a specific
//     time — the "committed" layer already covers the recurring-pattern
//     visualization.
const CALENDAR_BOOKED_STATUSES = ["confirmed", "requested", "confirmed_by_pro", "paid_held", "session_started"] as const;
const CALENDAR_ENGAGEMENT_SESSION_STATUSES = ["scheduled", "started", "completed", "no_show"] as const;

interface CalendarBookedItem {
  id: number;
  date: string;
  startTime: string | null;
  endTime: string | null;
  status: string;
  parentName: string | null;
  childName: string | null;
  vertical: "session_booking" | "tutor" | "therapist";
  meetLink: string | null;
}

router.get("/professionals/me/calendar", requireAuth, requireRole("professional"), async (req: Request, res: Response): Promise<void> => {
  const startDate = req.query["startDate"] as string;
  const endDate = req.query["endDate"] as string;

  if (!startDate || !endDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    res.status(400).json({ error: "Invalid startDate or endDate (use YYYY-MM-DD)" });
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

  const [committed, openSlots, sessionBookings, tutorSessions, therapistSessions] = await Promise.all([
    getCommittedEngagementBlocks(prof.id, startDate, endDate),
    // Includes 'blocked' (not just 'open') so a professional can see — and
    // via the B7 endpoints below, undo — a slot they manually blocked.
    db.select().from(slotsTable).where(and(
      eq(slotsTable.professionalId, prof.id),
      gte(slotsTable.date, startDate),
      lte(slotsTable.date, endDate),
      inArray(slotsTable.status, ["open", "blocked"]),
    )),
    db.select({
      id: sessionBookingsTable.id,
      date: sessionBookingsTable.bookedDate,
      startTime: sessionBookingsTable.startTime,
      endTime: sessionBookingsTable.endTime,
      status: sessionBookingsTable.status,
      parentName: usersTable.fullName,
      childName: childrenTable.name,
    })
      .from(sessionBookingsTable)
      .leftJoin(usersTable, eq(sessionBookingsTable.parentId, usersTable.id))
      .leftJoin(childrenTable, eq(sessionBookingsTable.childId, childrenTable.id))
      .where(and(
        eq(sessionBookingsTable.professionalId, prof.id),
        gte(sessionBookingsTable.bookedDate, startDate),
        lte(sessionBookingsTable.bookedDate, endDate),
        inArray(sessionBookingsTable.status, CALENDAR_BOOKED_STATUSES),
      )),
    db.select({
      id: tutorEngagementSessionsTable.id,
      date: tutorEngagementSessionsTable.sessionDate,
      startTime: tutorEngagementSessionsTable.startTime,
      endTime: tutorEngagementSessionsTable.endTime,
      status: tutorEngagementSessionsTable.status,
      meetLink: tutorEngagementSessionsTable.meetLink,
      parentName: usersTable.fullName,
      childName: childrenTable.name,
    })
      .from(tutorEngagementSessionsTable)
      .innerJoin(tutorEngagementsTable, eq(tutorEngagementSessionsTable.engagementId, tutorEngagementsTable.id))
      .leftJoin(usersTable, eq(tutorEngagementsTable.parentId, usersTable.id))
      .leftJoin(childrenTable, eq(tutorEngagementsTable.childId, childrenTable.id))
      .where(and(
        eq(tutorEngagementsTable.professionalId, prof.id),
        gte(tutorEngagementSessionsTable.sessionDate, startDate),
        lte(tutorEngagementSessionsTable.sessionDate, endDate),
        inArray(tutorEngagementSessionsTable.status, CALENDAR_ENGAGEMENT_SESSION_STATUSES),
      )),
    db.select({
      id: therapistEngagementSessionsTable.id,
      date: therapistEngagementSessionsTable.sessionDate,
      startTime: therapistEngagementSessionsTable.startTime,
      endTime: therapistEngagementSessionsTable.endTime,
      status: therapistEngagementSessionsTable.status,
      meetLink: therapistEngagementSessionsTable.meetLink,
      parentName: usersTable.fullName,
      childName: childrenTable.name,
    })
      .from(therapistEngagementSessionsTable)
      .innerJoin(therapistEngagementsTable, eq(therapistEngagementSessionsTable.engagementId, therapistEngagementsTable.id))
      .leftJoin(usersTable, eq(therapistEngagementsTable.parentId, usersTable.id))
      .leftJoin(childrenTable, eq(therapistEngagementsTable.childId, childrenTable.id))
      .where(and(
        eq(therapistEngagementsTable.professionalId, prof.id),
        gte(therapistEngagementSessionsTable.sessionDate, startDate),
        lte(therapistEngagementSessionsTable.sessionDate, endDate),
        inArray(therapistEngagementSessionsTable.status, CALENDAR_ENGAGEMENT_SESSION_STATUSES),
      )),
  ]);

  const booked: CalendarBookedItem[] = [
    ...sessionBookings.map((s): CalendarBookedItem => ({
      id: s.id, date: s.date, startTime: s.startTime, endTime: s.endTime, status: s.status,
      parentName: s.parentName, childName: s.childName, vertical: "session_booking", meetLink: null,
    })),
    ...tutorSessions.map((s): CalendarBookedItem => ({
      id: s.id, date: s.date, startTime: s.startTime, endTime: s.endTime, status: s.status,
      parentName: s.parentName, childName: s.childName, vertical: "tutor", meetLink: s.meetLink,
    })),
    ...therapistSessions.map((s): CalendarBookedItem => ({
      id: s.id, date: s.date, startTime: s.startTime, endTime: s.endTime, status: s.status,
      parentName: s.parentName, childName: s.childName, vertical: "therapist", meetLink: s.meetLink,
    })),
  ];

  res.json({
    committed,
    open: openSlots.map((s) => ({
      id: s.id,
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      durationMins: s.durationMins,
      priceInr: s.priceInr,
      status: s.status,
      generatedFromTemplateId: s.generatedFromTemplateId,
    })),
    booked,
  });
});

// B7 — manual adjustment. Resolves the caller's own professional row; kept
// as a tiny local helper (not a shared export) since every one of these
// routes needs it and none of them share a call site with anything else in
// this file.
async function getOwnProfessionalId(userId: number): Promise<number | null> {
  const [prof] = await db
    .select({ id: professionalProfilesTable.id })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, userId));
  return prof?.id ?? null;
}

// POST /professionals/me/calendar/slots — add a one-off bookable slot
// outside the weekly template. Guarded by the same busy-window check as
// the generation job and the booking endpoints (Commit A) so a manually
// added slot can't create a double-booking against the professional's own
// recurring commitments, plus a same-table overlap check against slots
// that check alone wouldn't catch (two slots with different start times
// that still overlap).
router.post("/professionals/me/calendar/slots", requireAuth, requireRole("professional"), async (req: Request, res: Response): Promise<void> => {
  const { date, startTime, endTime, priceInr } = req.body ?? {};
  const timeRe = /^\d{2}:\d{2}$/;
  if (
    typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    typeof startTime !== "string" || !timeRe.test(startTime) ||
    typeof endTime !== "string" || !timeRe.test(endTime) ||
    startTime >= endTime ||
    typeof priceInr !== "number" || !Number.isFinite(priceInr) || priceInr <= 0
  ) {
    res.status(400).json({ error: "Invalid date/startTime/endTime/priceInr" });
    return;
  }

  const profId = await getOwnProfessionalId(req.userId!);
  if (!profId) { res.status(404).json({ error: "Professional profile not found" }); return; }

  const busyWindows = await getRecurringAndSessionBusyWindows(profId, date);
  if (overlapsAnyWindow(busyWindows, startTime, endTime)) {
    res.status(400).json({ error: "This overlaps one of your existing commitments" });
    return;
  }

  const sameDaySlots = await db.select({ startTime: slotsTable.startTime, endTime: slotsTable.endTime })
    .from(slotsTable)
    .where(and(
      eq(slotsTable.professionalId, profId),
      eq(slotsTable.date, date),
      inArray(slotsTable.status, ["open", "blocked", "booked"]),
    ));
  if (sameDaySlots.some((s) => overlaps(s.startTime, s.endTime, startTime, endTime))) {
    res.status(400).json({ error: "This overlaps an existing slot on that date" });
    return;
  }

  const [hh, mm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const durationMins = (eh * 60 + em) - (hh * 60 + mm);

  try {
    const [created] = await db.insert(slotsTable).values({
      professionalId: profId,
      date,
      startTime,
      endTime,
      durationMins,
      priceInr,
      status: "open",
      generatedFromTemplateId: null,
    }).returning();
    res.status(201).json(created);
  } catch (err) {
    const pgErr = err as { code?: string };
    if (pgErr.code === "23505") {
      res.status(409).json({ error: "A slot already exists at that exact start time" });
      return;
    }
    throw err;
  }
});

// PATCH /professionals/me/calendar/slots/:id — block or unblock a slot.
// Never touches a 'booked' slot (that's a live session_bookings row, not
// this status field — see the file-header comment above slotsTable in
// lib/db/src/schema/sessions.ts).
router.patch("/professionals/me/calendar/slots/:id", requireAuth, requireRole("professional"), async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const { status } = req.body ?? {};
  if (!Number.isInteger(id) || (status !== "open" && status !== "blocked")) {
    res.status(400).json({ error: "Invalid slot id or status (must be 'open' or 'blocked')" });
    return;
  }

  const profId = await getOwnProfessionalId(req.userId!);
  if (!profId) { res.status(404).json({ error: "Professional profile not found" }); return; }

  const [slot] = await db.select().from(slotsTable).where(and(eq(slotsTable.id, id), eq(slotsTable.professionalId, profId)));
  if (!slot) { res.status(404).json({ error: "Slot not found" }); return; }
  if (slot.status !== "open" && slot.status !== "blocked") {
    res.status(400).json({ error: `Cannot change a slot with status '${slot.status}'` });
    return;
  }

  const [updated] = await db.update(slotsTable).set({ status }).where(eq(slotsTable.id, id)).returning();
  res.json(updated);
});

// DELETE /professionals/me/calendar/slots/:id — only for slots the
// professional added themselves (generatedFromTemplateId is null).
// Deleting a template-generated slot would be a no-op in practice: the
// daily generation job's idempotency depends on the row existing (see
// slotGeneration.ts), so removing it just lets the same slot reappear on
// the next run. Blocking (via the PATCH route above) is the durable way
// to suppress a generated slot; delete is only meaningful as "undo" for a
// one-off slot that no template will ever regenerate.
router.delete("/professionals/me/calendar/slots/:id", requireAuth, requireRole("professional"), async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid slot id" }); return; }

  const profId = await getOwnProfessionalId(req.userId!);
  if (!profId) { res.status(404).json({ error: "Professional profile not found" }); return; }

  const [slot] = await db.select().from(slotsTable).where(and(eq(slotsTable.id, id), eq(slotsTable.professionalId, profId)));
  if (!slot) { res.status(404).json({ error: "Slot not found" }); return; }
  if (slot.status === "booked") { res.status(400).json({ error: "Cannot delete a booked slot" }); return; }
  if (slot.generatedFromTemplateId !== null) {
    res.status(400).json({ error: "This slot comes from your weekly template — block it instead of deleting, or it will reappear" });
    return;
  }

  await db.delete(slotsTable).where(eq(slotsTable.id, id));
  res.json({ ok: true });
});

function addDaysIsoLocal(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const ManualBlockRange = { startTime: /^\d{2}:\d{2}$/, endTime: /^\d{2}:\d{2}$/ };
function isValidManualRanges(value: unknown): value is { startTime: string; endTime: string }[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((r) =>
      r && typeof r === "object" &&
      typeof (r as Record<string, unknown>)["startTime"] === "string" &&
      typeof (r as Record<string, unknown>)["endTime"] === "string" &&
      ManualBlockRange.startTime.test((r as Record<string, unknown>)["startTime"] as string) &&
      ManualBlockRange.endTime.test((r as Record<string, unknown>)["endTime"] as string) &&
      (r as { startTime: string; endTime: string }).startTime < (r as { startTime: string; endTime: string }).endTime,
    )
  );
}

// POST /professionals/me/calendar/quick-block-busy — bulk-blocks every OPEN
// materialized slot across a date range that overlaps a set of windows.
// Two sources for those windows, same bulk-block mechanism either way —
// this is deliberately ONE endpoint, not two:
//   - ranges omitted (busy-hours quick-block): windows come from
//     getRecurringAndSessionBusyWindows/overlapsAnyWindow, unchanged — not
//     a new definition of "busy", and since the calendar endpoint's
//     booked-layer extension above, already visible as the committed +
//     booked layers.
//   - ranges provided (manual range block): windows come directly from the
//     caller instead — a professional blocking arbitrary time for their
//     own reasons, independent of any computed commitment. Deliberately
//     NOT merged with the computed busy windows in this mode; only the
//     given ranges are applied, so this never blocks more than what was
//     explicitly selected.
router.post("/professionals/me/calendar/quick-block-busy", requireAuth, requireRole("professional"), async (req: Request, res: Response): Promise<void> => {
  const { startDate, endDate, ranges } = req.body ?? {};
  if (
    typeof startDate !== "string" || typeof endDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) ||
    startDate > endDate
  ) {
    res.status(400).json({ error: "Invalid startDate/endDate (use YYYY-MM-DD, startDate <= endDate)" });
    return;
  }
  if (ranges !== undefined && !isValidManualRanges(ranges)) {
    res.status(400).json({ error: "ranges must be a non-empty array of {startTime, endTime} (HH:MM, startTime < endTime)" });
    return;
  }

  const profId = await getOwnProfessionalId(req.userId!);
  if (!profId) { res.status(404).json({ error: "Professional profile not found" }); return; }

  const openSlots = await db.select({ id: slotsTable.id, date: slotsTable.date, startTime: slotsTable.startTime, endTime: slotsTable.endTime })
    .from(slotsTable)
    .where(and(
      eq(slotsTable.professionalId, profId),
      gte(slotsTable.date, startDate),
      lte(slotsTable.date, endDate),
      eq(slotsTable.status, "open"),
    ));

  const idsToBlock: number[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    const daySlots = openSlots.filter((s) => s.date === cursor);
    if (daySlots.length > 0) {
      const windows = ranges ?? await getRecurringAndSessionBusyWindows(profId, cursor);
      for (const s of daySlots) {
        if (overlapsAnyWindow(windows, s.startTime, s.endTime)) idsToBlock.push(s.id);
      }
    }
    cursor = addDaysIsoLocal(cursor, 1);
  }

  if (idsToBlock.length === 0) {
    res.json({ blockedCount: 0 });
    return;
  }

  await db.update(slotsTable).set({ status: "blocked" }).where(inArray(slotsTable.id, idsToBlock));
  res.json({ blockedCount: idsToBlock.length });
});

// Advisory-lock key shared by booking-creation and reschedule — same
// (professionalId, date, startTime) slot identity either way, so a create
// and a reschedule racing for the same slot serialize against each other
// too, not just two creates or two reschedules independently.
function bookingSlotLockSql(professionalId: number, date: string, startTime: string) {
  return sql`SELECT pg_advisory_xact_lock(hashtext(${professionalId}::text || ':' || ${date} || ':' || ${startTime}))`;
}

router.post("/sessions/book", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = BookSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // amountInr, endTime and durationMinutes are still accepted in the request
  // body (BookSessionBody keeps requiring them, for frontend backward-
  // compatibility) but deliberately never read from here on — both branches
  // below resolve endTime/duration (and price, where relevant) from the
  // authoritative slots row instead. See each branch's slot lookup for why.
  const { professionalId, bookedDate, startTime, notes, childId } = { childId: undefined as number | undefined, ...parsed.data };

  // Fast-path pre-check — not the authoritative guard (that's the
  // advisory-lock-protected re-check inside each branch below), just avoids
  // doing profile lookups / calling Razorpay for an obviously-conflicting
  // request before ever acquiring the lock.
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

  // Credit-based booking for therapists and psychologists
  const isCreditSpecialty = prof && (
    prof.specialty === "occupational_therapy" ||
    prof.specialty === "speech_therapy" ||
    prof.specialty === "psychiatrist"
  );
  if (isCreditSpecialty) {
    // Advisory lock + re-check + credit deduction + insert, all in one
    // transaction — this branch inserts directly as status:"confirmed", the
    // exact row shape the conflict check filters on, so without the lock
    // two concurrent requests for the same slot could both pass the
    // pre-check above and both insert as confirmed. Credit deduction was
    // already transactional; the lock/re-check close the actual race.
    let bookingId: number | null = null;

    try {
      await db.transaction(async (tx) => {
        await tx.execute(bookingSlotLockSql(professionalId, bookedDate, startTime));

        const [conflict] = await tx
          .select({ id: sessionBookingsTable.id })
          .from(sessionBookingsTable)
          .where(and(
            eq(sessionBookingsTable.professionalId, professionalId),
            eq(sessionBookingsTable.bookedDate, bookedDate),
            eq(sessionBookingsTable.startTime, startTime),
            eq(sessionBookingsTable.status, "confirmed"),
          ));
        if (conflict) {
          throw Object.assign(new Error("SLOT_TAKEN"), { statusCode: 400 });
        }

        // Authoritative duration/endTime source — same reasoning as the
        // Razorpay branch's price lookup below: never trust client-supplied
        // endTime/durationMinutes. This branch has no price at stake
        // (amountInr is always 0 here), but the stored duration is still
        // each party's permanent record of how long the session was agreed
        // to be — letting a parent invent an arbitrary duration would
        // corrupt that record independent of any pricing exploit, and
        // undermines the exact attendance-integrity guarantee this system
        // exists to provide. No matching slot means this date/time was
        // never actually offered — reject rather than silently accept an
        // invented one.
        const [slot] = await tx
          .select({ durationMins: slotsTable.durationMins, endTime: slotsTable.endTime })
          .from(slotsTable)
          .where(and(
            eq(slotsTable.professionalId, professionalId),
            eq(slotsTable.date, bookedDate),
            eq(slotsTable.startTime, startTime),
          ));
        if (!slot) {
          throw Object.assign(new Error("NO_MATCHING_SLOT"), { statusCode: 400 });
        }

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
            endTime: slot.endTime,
            durationMinutes: slot.durationMins,
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
      if (e.message === "SLOT_TAKEN") {
        res.status(400).json({ error: "This slot is already booked" });
        return;
      }
      if (e.message === "NO_SESSION_CREDITS") {
        res.status(402).json({
          error: "You need session credits to book with this specialist. Purchase a session pass to continue.",
          code: "NO_SESSION_CREDITS",
          sessionCredits: 0,
        });
        return;
      }
      if (e.message === "NO_MATCHING_SLOT") {
        res.status(400).json({ error: "This date/time is not an available slot for this professional" });
        return;
      }
      throw err;
    }

    res.json({ sessionId: bookingId!, usedCredit: true });
    return;
  }

  // Standard Razorpay payment flow for other specialties. This branch
  // inserts as status:"pending_payment" (default), which the conflict
  // check above never matches — the real confirmed-vs-confirmed race for
  // this flow is at POST /sessions/verify-payment (a separate endpoint,
  // not covered by this fix), not here. Still lock-protected for
  // consistency with the credit branch and to avoid ever creating a
  // Razorpay order for a slot that's confirmed-taken the instant before.
  const razorpay = getRazorpay();
  if (!razorpay) {
    res.status(503).json({ error: "Payment gateway not configured" });
    return;
  }

  let bookingResult: { id: number; orderId: string; amountInr: number } | null = null;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(bookingSlotLockSql(professionalId, bookedDate, startTime));

      const [conflict] = await tx
        .select({ id: sessionBookingsTable.id })
        .from(sessionBookingsTable)
        .where(and(
          eq(sessionBookingsTable.professionalId, professionalId),
          eq(sessionBookingsTable.bookedDate, bookedDate),
          eq(sessionBookingsTable.startTime, startTime),
          eq(sessionBookingsTable.status, "confirmed"),
        ));
      if (conflict) {
        throw Object.assign(new Error("SLOT_TAKEN"), { statusCode: 400 });
      }

      // Authoritative price source — never trust the client-supplied
      // amountInr. The real materialized slot (generated by
      // slotGeneration.ts, snapshotted from the professional's own
      // availability template) is the only source of truth for what this
      // exact professional/date/time is actually priced at. No matching
      // slot means this date/time was never actually offered — reject
      // rather than silently accept an invented one.
      const [slot] = await tx
        .select({ priceInr: slotsTable.priceInr, durationMins: slotsTable.durationMins, endTime: slotsTable.endTime })
        .from(slotsTable)
        .where(and(
          eq(slotsTable.professionalId, professionalId),
          eq(slotsTable.date, bookedDate),
          eq(slotsTable.startTime, startTime),
        ));
      if (!slot) {
        throw Object.assign(new Error("NO_MATCHING_SLOT"), { statusCode: 400 });
      }
      const realAmountInr = slot.priceInr;

      const { commissionInr: resolvedCommissionInr, resolvedCommissionPct } =
        await resolveBookingCommission(professionalId, prof?.specialty ?? "", realAmountInr);

      const order = await razorpay.orders.create({
        amount: realAmountInr * 100,
        currency: "INR",
        receipt: `session_${Date.now()}`,
      });

      const [booking] = await tx
        .insert(sessionBookingsTable)
        .values({
          professionalId,
          parentId: req.userId!,
          bookedDate,
          startTime,
          endTime: slot.endTime,
          durationMinutes: slot.durationMins,
          amountInr: realAmountInr,
          commissionInr: resolvedCommissionInr,
          resolvedCommissionPct,
          notes: notes ?? null,
          childId: childId ?? null,
          providerOrderId: order.id as string,
        })
        .returning();

      bookingResult = { id: booking.id, orderId: order.id as string, amountInr: realAmountInr };
    });
  } catch (err: unknown) {
    const e = err as Error & { statusCode?: number };
    if (e.message === "SLOT_TAKEN") {
      res.status(400).json({ error: "This slot is already booked" });
      return;
    }
    if (e.message === "NO_MATCHING_SLOT") {
      res.status(400).json({ error: "This date/time is not an available slot for this professional" });
      return;
    }
    throw err;
  }

  res.json({
    sessionId: bookingResult!.id,
    orderId: bookingResult!.orderId,
    amount: bookingResult!.amountInr * 100,
    currency: "INR",
    keyId: process.env["RAZORPAY_KEY_ID"]!,
  });
});

// ── PATCH /sessions/:id/reschedule ────────────────────────────────────────
// In-place update of the SAME booking row (same id) — no slots table
// involvement, since slots.bookingId/'booked' is explicitly NOT the write-
// path source of truth in this system (see the file-header comment above
// slotsTable and GET /professionals/:id/bookable-slots's own comment) —
// the real conflict-prevention mechanism is a live query against
// session_bookings directly, which is exactly what this reuses. Same
// advisory-lock-protected re-check as the create endpoint above (shared
// bookingSlotLockSql helper, same lock key shape), so a reschedule racing
// a concurrent booking-creation — or another reschedule — for the same
// slot serializes correctly instead of double-booking. Re-issues OTPs and
// clears otpAttempts/otpLockedAt on every reschedule, same rationale as
// the tutor/therapist reschedule fix: the verify-otp endpoints always
// compare against the DB value at call time, so overwriting these columns
// makes the pre-reschedule codes unmatchable the instant this commits.
// Gated to status:"confirmed" (booked + paid, not yet started) — mirrors
// this table's own pre-start state, same as tutor/therapist's
// status:"scheduled" gate.
const RescheduleSessionBookingBody = z.object({
  bookedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string(),
  endTime: z.string(),
});
router.patch("/sessions/:id/reschedule", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const sessionId = parseInt(req.params["id"] as string, 10);
  if (isNaN(sessionId)) { res.status(400).json({ error: "Invalid session id" }); return; }
  const parsed = RescheduleSessionBookingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [booking] = await db.select().from(sessionBookingsTable).where(eq(sessionBookingsTable.id, sessionId));
  if (!booking) { res.status(404).json({ error: "Session not found" }); return; }

  let isProfessional = false;
  if (req.userRole === "professional") {
    const [prof] = await db.select({ id: professionalProfilesTable.id }).from(professionalProfilesTable)
      .where(eq(professionalProfilesTable.userId, req.userId!));
    isProfessional = !!prof && prof.id === booking.professionalId;
  }
  if (booking.parentId !== req.userId! && !isProfessional && req.userRole !== "admin") {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  // Server-side gate, not inferred from UI flow — an already-started or
  // otherwise non-pre-session booking cannot be rescheduled via this path
  // even via a direct API call.
  if (booking.status !== "confirmed") {
    res.status(409).json({ error: "Only a confirmed (not yet started) session can be rescheduled" });
    return;
  }

  const { bookedDate, startTime, endTime } = parsed.data;

  let updated: typeof booking | undefined;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(bookingSlotLockSql(booking.professionalId, bookedDate, startTime));

      const [conflict] = await tx
        .select({ id: sessionBookingsTable.id })
        .from(sessionBookingsTable)
        .where(and(
          eq(sessionBookingsTable.professionalId, booking.professionalId),
          eq(sessionBookingsTable.bookedDate, bookedDate),
          eq(sessionBookingsTable.startTime, startTime),
          eq(sessionBookingsTable.status, "confirmed"),
          ne(sessionBookingsTable.id, sessionId),
        ));
      if (conflict) {
        throw Object.assign(new Error("SLOT_TAKEN"), { statusCode: 409 });
      }

      const now = new Date();
      [updated] = await tx
        .update(sessionBookingsTable)
        .set({
          bookedDate,
          startTime,
          endTime,
          startOtp: generateOtp(),
          endOtp: generateOtp(),
          otpIssuedAt: now,
          otpAttempts: 0,
          otpLockedAt: null,
          updatedAt: now,
        })
        .where(eq(sessionBookingsTable.id, sessionId))
        .returning();
    });
  } catch (err: unknown) {
    const e = err as Error & { statusCode?: number };
    if (e.message === "SLOT_TAKEN") {
      res.status(409).json({ error: "That time is already booked" });
      return;
    }
    throw err;
  }

  res.json(updated);
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

  // This is the endpoint that actually closes the Razorpay-path race —
  // POST /sessions/book's own lock only protects its own insert
  // (status:"pending_payment", which never conflicts), so two concurrent
  // bookings for the same slot can both reach payment and both arrive
  // here. Same lock-then-recheck-then-write pattern as book/reschedule.
  // NOT handled here, flagged rather than silently built: if this parent's
  // payment already succeeded with Razorpay before losing the race, they've
  // been charged for a slot they don't get — that's a refund-flow gap,
  // out of scope for "add the lock," not something to quietly solve here.
  let confirmed: typeof booking | undefined;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(bookingSlotLockSql(booking.professionalId, booking.bookedDate, booking.startTime));

      const [conflict] = await tx
        .select({ id: sessionBookingsTable.id })
        .from(sessionBookingsTable)
        .where(and(
          eq(sessionBookingsTable.professionalId, booking.professionalId),
          eq(sessionBookingsTable.bookedDate, booking.bookedDate),
          eq(sessionBookingsTable.startTime, booking.startTime),
          eq(sessionBookingsTable.status, "confirmed"),
          ne(sessionBookingsTable.id, sessionId),
        ));
      if (conflict) {
        throw Object.assign(new Error("SLOT_TAKEN"), { statusCode: 409 });
      }

      [confirmed] = await tx
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
    });
  } catch (err: unknown) {
    const e = err as Error & { statusCode?: number };
    if (e.message === "SLOT_TAKEN") {
      res.status(409).json({ error: "This slot was booked by someone else while your payment was processing. Contact support for a refund." });
      return;
    }
    throw err;
  }

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
        childId: sessionBookingsTable.childId,
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
