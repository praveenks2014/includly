// Shared recurring-schedule concept for Shadow Teacher/Tutor/Therapist
// engagements — a professional's agreed weekly commitment, captured once at
// accept time, used for candidate-matching exclusion and parent-facing
// display. Previously duplicated per-file (parent-dashboard.tsx's
// nextSessionFromSchedule, ShadowTeacherRequestWidget.tsx's
// formatRecurringScheduleSummary) since only Shadow Teacher had this concept;
// now shared since Tutor/Therapist need the identical thing, not three
// independently-drifting copies.

export interface RecurringScheduleSlot {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export const DAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatTime12h(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

// Computes the next occurrence (from now) of a professional's accepted
// weekly recurring schedule.
export function nextSessionFromSchedule(
  slots: RecurringScheduleSlot[] | null | undefined,
): string | null {
  if (!slots || slots.length === 0) return null;
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const todayDow = now.getDay();

  let best: { daysAhead: number; startTime: string } | null = null;
  for (const slot of slots) {
    const [sh, sm] = slot.startTime.split(":").map(Number);
    const slotMinutes = sh * 60 + sm;
    let daysAhead = (slot.dayOfWeek - todayDow + 7) % 7;
    if (daysAhead === 0 && slotMinutes <= nowMinutes) daysAhead = 7; // today's slot already passed
    if (!best || daysAhead < best.daysAhead || (daysAhead === best.daysAhead && slot.startTime < best.startTime)) {
      best = { daysAhead, startTime: slot.startTime };
    }
  }
  if (!best) return null;

  if (best.daysAhead === 0) return `Today, ${formatTime12h(best.startTime)}`;
  if (best.daysAhead === 1) return `Tomorrow, ${formatTime12h(best.startTime)}`;
  const targetDow = (todayDow + best.daysAhead) % 7;
  return `${DAYS_SHORT[targetDow]}, ${formatTime12h(best.startTime)}`;
}

// Read-only "Mon 4:00 PM–5:00 PM, Wed 4:00 PM–5:00 PM" summary of the full
// agreed schedule (as opposed to nextSessionFromSchedule's single next
// occurrence).
export function formatRecurringScheduleSummary(slots: RecurringScheduleSlot[] | null | undefined): string | null {
  if (!slots || slots.length === 0) return null;
  return [...slots]
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime))
    .map((s) => `${DAYS_SHORT[s.dayOfWeek]} ${formatTime12h(s.startTime)}–${formatTime12h(s.endTime)}`)
    .join(", ");
}
