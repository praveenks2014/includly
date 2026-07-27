import { z } from "zod/v4";
import { and, eq, ne, sql } from "drizzle-orm";
import {
  db,
  shadowTeacherEngagementsTable,
  tutorEngagementsTable,
  therapistEngagementsTable,
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
