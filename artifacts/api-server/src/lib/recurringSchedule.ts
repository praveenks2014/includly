import { z } from "zod/v4";
import { and, eq, ne, inArray, isNotNull, sql } from "drizzle-orm";
import {
  db,
  shadowTeacherEngagementsTable,
  tutorEngagementsTable,
  therapistEngagementsTable,
  tutorEngagementSessionsTable,
  therapistEngagementSessionsTable,
} from "@workspace/db";
import { overlaps } from "./scheduleConflict";

// Shared shape for a professional's agreed weekly commitment, captured at
// engagement-acceptance time. Used by tutor.ts and therapist.ts's
// PATCH .../engagements/:id/acceptance — mirrors lifecycleRequests.ts's
// existing shadow-teacher RecurringScheduleSlot/TeacherAcceptanceBody
// (left as-is there; that file imports plain "zod" (v3, pinned via the
// workspace catalog) rather than "zod/v4", and schema objects built via
// the two entry points aren't safely known to be interchangeable, so its
// existing validator isn't touched here).
export const RecurringScheduleSlot = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
});

export type RecurringScheduleSlotType = z.infer<typeof RecurringScheduleSlot>;

type EngagementVertical = "shadow_teacher" | "tutor" | "therapist";

const VERTICAL_LABEL: Record<EngagementVertical, string> = {
  shadow_teacher: "Shadow Teacher",
  tutor: "Tutor",
  therapist: "Therapist",
};

const DAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatTime12h(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

interface ExistingSlot {
  vertical: EngagementVertical;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

// Checks a professional's PROPOSED recurring schedule (about to be accepted
// for one specific engagement) against their OTHER active (non-ended)
// engagements across all three recurring-engagement verticals — a
// professional can hold multiple simultaneous offerings (shadow_teacher +
// tutor + therapist are independent rows in professional_offerings, per
// vertical), so a new commitment in any one of them must not silently
// double-book a slot already committed in another. Slot-vs-slot only (same
// dayOfWeek + time-range overlap) — individual one-off session rows and
// session_bookings are already covered separately by hasScheduleConflict()
// in scheduleConflict.ts; not duplicated or extended here.
export async function checkRecurringScheduleConflict(
  professionalId: number,
  newSlots: RecurringScheduleSlotType[],
  exclude: { vertical: EngagementVertical; engagementId: number },
): Promise<string | null> {
  const shadowConditions = [
    eq(shadowTeacherEngagementsTable.professionalId, professionalId),
    sql`${shadowTeacherEngagementsTable.status} != 'ended'`,
  ];
  if (exclude.vertical === "shadow_teacher") shadowConditions.push(ne(shadowTeacherEngagementsTable.id, exclude.engagementId));

  const tutorConditions = [
    eq(tutorEngagementsTable.professionalId, professionalId),
    sql`${tutorEngagementsTable.status} != 'ended'`,
  ];
  if (exclude.vertical === "tutor") tutorConditions.push(ne(tutorEngagementsTable.id, exclude.engagementId));

  const therapistConditions = [
    eq(therapistEngagementsTable.professionalId, professionalId),
    sql`${therapistEngagementsTable.status} != 'ended'`,
  ];
  if (exclude.vertical === "therapist") therapistConditions.push(ne(therapistEngagementsTable.id, exclude.engagementId));

  const [shadowRows, tutorRows, therapistRows] = await Promise.all([
    db.select({ recurringScheduleJson: shadowTeacherEngagementsTable.recurringScheduleJson })
      .from(shadowTeacherEngagementsTable).where(and(...shadowConditions)),
    db.select({ recurringScheduleJson: tutorEngagementsTable.recurringScheduleJson })
      .from(tutorEngagementsTable).where(and(...tutorConditions)),
    db.select({ recurringScheduleJson: therapistEngagementsTable.recurringScheduleJson })
      .from(therapistEngagementsTable).where(and(...therapistConditions)),
  ]);

  const existing: ExistingSlot[] = [];
  for (const [vertical, rows] of [
    ["shadow_teacher", shadowRows],
    ["tutor", tutorRows],
    ["therapist", therapistRows],
  ] as const) {
    for (const row of rows) {
      const slots = (row.recurringScheduleJson as { dayOfWeek: number; startTime: string; endTime: string }[] | null) ?? [];
      for (const s of slots) existing.push({ vertical, ...s });
    }
  }

  for (const newSlot of newSlots) {
    for (const ex of existing) {
      if (ex.dayOfWeek === newSlot.dayOfWeek && overlaps(ex.startTime, ex.endTime, newSlot.startTime, newSlot.endTime)) {
        return `This conflicts with your existing ${VERTICAL_LABEL[ex.vertical]} commitment: ${DAYS_FULL[ex.dayOfWeek]} ${formatTime12h(ex.startTime)}–${formatTime12h(ex.endTime)}.`;
      }
    }
  }
  return null;
}

export interface BusyWindow {
  startTime: string;
  endTime: string;
}

// Busy windows for a specific date that bookable-slots/sessions-v2/
// book-interview's EXISTING session_bookings exclusion does not cover:
// the professional's own recurring commitments (all three verticals,
// matched by day-of-week derived from the given date — recurringScheduleJson
// is a weekly pattern, not concrete dates) and their individually-scheduled
// tutor/therapist engagement sessions on that exact date. Does NOT
// re-check session_bookings itself — callers already have their own
// check for that; this is additive, not a replacement.
export async function getRecurringAndSessionBusyWindows(
  professionalId: number,
  date: string,
): Promise<BusyWindow[]> {
  const dayOfWeek = new Date(date + "T00:00:00Z").getUTCDay();
  const windows: BusyWindow[] = [];

  const [shadowRows, tutorRows, therapistRows] = await Promise.all([
    db.select({ recurringScheduleJson: shadowTeacherEngagementsTable.recurringScheduleJson })
      .from(shadowTeacherEngagementsTable)
      .where(and(eq(shadowTeacherEngagementsTable.professionalId, professionalId), sql`${shadowTeacherEngagementsTable.status} != 'ended'`)),
    db.select({ recurringScheduleJson: tutorEngagementsTable.recurringScheduleJson })
      .from(tutorEngagementsTable)
      .where(and(eq(tutorEngagementsTable.professionalId, professionalId), sql`${tutorEngagementsTable.status} != 'ended'`)),
    db.select({ recurringScheduleJson: therapistEngagementsTable.recurringScheduleJson })
      .from(therapistEngagementsTable)
      .where(and(eq(therapistEngagementsTable.professionalId, professionalId), sql`${therapistEngagementsTable.status} != 'ended'`)),
  ]);
  for (const row of [...shadowRows, ...tutorRows, ...therapistRows]) {
    const slots = (row.recurringScheduleJson as { dayOfWeek: number; startTime: string; endTime: string }[] | null) ?? [];
    for (const s of slots) {
      if (s.dayOfWeek === dayOfWeek) windows.push({ startTime: s.startTime, endTime: s.endTime });
    }
  }

  const [tutorSessions, therapistSessions] = await Promise.all([
    db.select({ startTime: tutorEngagementSessionsTable.startTime, endTime: tutorEngagementSessionsTable.endTime })
      .from(tutorEngagementSessionsTable)
      .innerJoin(tutorEngagementsTable, eq(tutorEngagementSessionsTable.engagementId, tutorEngagementsTable.id))
      .where(and(
        eq(tutorEngagementsTable.professionalId, professionalId),
        eq(tutorEngagementSessionsTable.sessionDate, date),
        inArray(tutorEngagementSessionsTable.status, ["scheduled", "started"]),
        isNotNull(tutorEngagementSessionsTable.startTime),
        isNotNull(tutorEngagementSessionsTable.endTime),
      )),
    db.select({ startTime: therapistEngagementSessionsTable.startTime, endTime: therapistEngagementSessionsTable.endTime })
      .from(therapistEngagementSessionsTable)
      .innerJoin(therapistEngagementsTable, eq(therapistEngagementSessionsTable.engagementId, therapistEngagementsTable.id))
      .where(and(
        eq(therapistEngagementsTable.professionalId, professionalId),
        eq(therapistEngagementSessionsTable.sessionDate, date),
        inArray(therapistEngagementSessionsTable.status, ["scheduled", "started"]),
        isNotNull(therapistEngagementSessionsTable.startTime),
        isNotNull(therapistEngagementSessionsTable.endTime),
      )),
  ]);
  for (const row of [...tutorSessions, ...therapistSessions]) {
    if (row.startTime && row.endTime) windows.push({ startTime: row.startTime, endTime: row.endTime });
  }

  return windows;
}

export function overlapsAnyWindow(windows: BusyWindow[], startTime: string, endTime: string): boolean {
  return windows.some((w) => overlaps(w.startTime, w.endTime, startTime, endTime));
}
