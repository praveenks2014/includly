import { eq } from "drizzle-orm";
import { db, professionalAvailabilityTable, slotsTable } from "@workspace/db";
import { getRecurringAndSessionBusyWindows, overlapsAnyWindow } from "./recurringSchedule";

// Rolling window the generation job keeps materialized slots filled
// through — 10 weeks, within the spec's 8-12 week range.
const GENERATION_WINDOW_DAYS = 70;

// Same small time-math helpers as sessions.ts/tutor.ts's own local copies
// (addMinutes/timeToMinutes, addMinutesLocal/timeToMinutesLocal) — matching
// this codebase's established per-file duplication convention for trivial
// helpers rather than importing a route file into a lib file.
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

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface CandidateSlot {
  professionalId: number;
  date: string;
  startTime: string;
  endTime: string;
  durationMins: number;
  generatedFromTemplateId: number;
}

// Expands every active professional_availability template into materialized
// slots rows for the rolling window, never inserting a slot that overlaps
// the professional's own recurring commitments or individually-scheduled
// tutor/therapist sessions (reuses Commit A's getRecurringAndSessionBusyWindows/
// overlapsAnyWindow unchanged — not a second implementation of the same
// exclusion). Idempotent via slots' DB-level unique index on
// (professionalId, date, startTime): re-running for an unchanged template
// inserts nothing new because the database rejects the duplicates, not
// because this job pre-checks existence itself.
export async function runSlotGenerationJob(): Promise<void> {
  const templates = await db
    .select()
    .from(professionalAvailabilityTable)
    .where(eq(professionalAvailabilityTable.isActive, true));

  if (templates.length === 0) return;

  const startDate = todayIsoDate();
  const endDate = addDaysIso(startDate, GENERATION_WINDOW_DAYS);

  // Busy windows only depend on (professionalId, date), not on which
  // template row is being walked — cache so multiple templates for the
  // same professional on the same day don't repeat the same queries.
  const busyCache = new Map<string, Awaited<ReturnType<typeof getRecurringAndSessionBusyWindows>>>();
  async function getBusy(professionalId: number, date: string) {
    const key = `${professionalId}:${date}`;
    let cached = busyCache.get(key);
    if (!cached) {
      cached = await getRecurringAndSessionBusyWindows(professionalId, date);
      busyCache.set(key, cached);
    }
    return cached;
  }

  const candidates: CandidateSlot[] = [];

  for (const tpl of templates) {
    let cursor = startDate;
    while (cursor <= endDate) {
      const cursorDow = new Date(cursor + "T00:00:00Z").getUTCDay();
      const withinEffectiveRange =
        (!tpl.effectiveFrom || cursor >= tpl.effectiveFrom) &&
        (!tpl.effectiveTo || cursor <= tpl.effectiveTo);

      if (cursorDow === tpl.dayOfWeek && withinEffectiveRange) {
        const busy = await getBusy(tpl.professionalId, cursor);
        const step = tpl.slotDurationMinutes + tpl.bufferMins;
        let slotStart = tpl.startTime;
        while (timeToMinutes(addMinutes(slotStart, tpl.slotDurationMinutes)) <= timeToMinutes(tpl.endTime)) {
          const slotEnd = addMinutes(slotStart, tpl.slotDurationMinutes);
          if (!overlapsAnyWindow(busy, slotStart, slotEnd)) {
            candidates.push({
              professionalId: tpl.professionalId,
              date: cursor,
              startTime: slotStart,
              endTime: slotEnd,
              durationMins: tpl.slotDurationMinutes,
              generatedFromTemplateId: tpl.id,
            });
          }
          slotStart = addMinutes(slotStart, step);
        }
      }
      cursor = addDaysIso(cursor, 1);
    }
  }

  if (candidates.length === 0) return;

  await db
    .insert(slotsTable)
    .values(candidates.map((c) => ({ ...c, status: "open" as const })))
    .onConflictDoNothing({ target: [slotsTable.professionalId, slotsTable.date, slotsTable.startTime] });
}
