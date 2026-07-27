import { z } from "zod/v4";

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
