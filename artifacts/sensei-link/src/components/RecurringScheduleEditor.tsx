import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { type RecurringScheduleSlot, DAYS_FULL, DAYS_SHORT } from "@/lib/recurringSchedule";

function calcEndTime(start: string, mins: number) {
  const [h, m] = start.split(":").map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// Shared weekly-commitment picker used at the professional-acceptance step
// for all three recurring-engagement verticals (Shadow Teacher, Tutor,
// Therapist) — was Shadow-Teacher-only (TeacherScheduleEditor in
// professional-dashboard.tsx) before Tutor/Therapist gained the identical
// recurringScheduleJson concept. Also reused for shadow-teacher's
// DESCRIPTIVE generalAvailabilityJson (a different concept — not a
// commitment, not required, doesn't block the calendar) — title/description
// are overridable for that case; defaults keep the original
// commitment-specific copy for the 3 existing call sites unchanged.
export function RecurringScheduleEditor({
  slots,
  onChange,
  title = "Your weekly commitment",
  description = "Add the day(s) and time(s) you're committing to for this engagement. This blocks your calendar — required before you can accept.",
}: {
  slots: RecurringScheduleSlot[];
  onChange: (slots: RecurringScheduleSlot[]) => void;
  title?: string;
  description?: string;
}) {
  function addSlot(day: number) {
    const daySlots = slots.filter((s) => s.dayOfWeek === day);
    const lastEnd = daySlots.length > 0
      ? daySlots.reduce((max, s) => (s.endTime > max ? s.endTime : max), "00:00")
      : "09:00";
    onChange([...slots, { dayOfWeek: day, startTime: lastEnd, endTime: calcEndTime(lastEnd, 60) }]);
  }
  function removeSlot(idx: number) {
    onChange(slots.filter((_, i) => i !== idx));
  }
  function updateSlot(idx: number, field: "startTime" | "endTime", value: string) {
    onChange(slots.map((s, i) => (i === idx ? { ...s, [field]: value } : s)));
  }

  return (
    <div className="space-y-2.5">
      <p className="text-xs font-semibold text-[#1A2340]">{title}</p>
      <p className="text-[11px] text-gray-500">{description}</p>
      <div className="space-y-2">
        {[1, 2, 3, 4, 5, 6, 0].map((day) => {
          const daySlots = slots.map((s, i) => ({ ...s, _idx: i })).filter((s) => s.dayOfWeek === day);
          return (
            <div key={day} className="border border-gray-100 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-gray-50/60">
                <div className="flex items-center gap-2">
                  <span className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold ${daySlots.length > 0 ? "bg-[#2EC4A5] text-white" : "bg-gray-200 text-gray-500"}`}>
                    {DAYS_SHORT[day]}
                  </span>
                  <p className="text-xs font-medium text-[#1A2340]">{DAYS_FULL[day]}</p>
                </div>
                <button type="button" onClick={() => addSlot(day)} className="flex items-center gap-1 text-[11px] text-[#2EC4A5] hover:text-[#26a88d] font-medium" aria-label={`Add commitment for ${DAYS_FULL[day]}`}>
                  <Plus size={12} /> Add
                </button>
              </div>
              {daySlots.length > 0 && (
                <div className="px-3 py-2 space-y-1.5">
                  {daySlots.map(({ _idx: idx, ...slot }) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Input
                        type="time"
                        value={slot.startTime}
                        onChange={(e) => updateSlot(idx, "startTime", e.target.value)}
                        className="h-7 text-xs w-24 rounded-lg focus-visible:ring-[#2EC4A5]"
                        aria-label="Start time"
                      />
                      <span className="text-gray-400 text-[11px]">to</span>
                      <Input
                        type="time"
                        value={slot.endTime}
                        onChange={(e) => updateSlot(idx, "endTime", e.target.value)}
                        className="h-7 text-xs w-24 rounded-lg focus-visible:ring-[#2EC4A5]"
                        aria-label="End time"
                      />
                      <button type="button" onClick={() => removeSlot(idx)} className="ml-auto text-gray-300 hover:text-red-400 transition-colors p-1 rounded-lg" aria-label="Remove commitment">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
