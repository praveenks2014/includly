import { DAYS_FULL, DAYS_SHORT } from "@/lib/recurringSchedule";

// Day-of-week-only picker for the shadow-teacher request form's "desired
// coverage days" field -- deliberately NOT RecurringScheduleEditor, which
// is hard-wired to per-slot start/end time inputs at every existing call
// site (weekly commitment, general availability). Real shadow-teacher
// coverage always runs during the child's already-known school hours, so
// there's nothing for a parent to pick here beyond which days -- times are
// never collected from this component at all.
export function DaySelector({
  days,
  onChange,
  title = "Days you're looking for",
  description = "Select the day(s) you'd like shadow-teacher coverage. Sessions run during your child's school hours.",
}: {
  days: number[];
  onChange: (days: number[]) => void;
  title?: string;
  description?: string;
}) {
  function toggleDay(day: number) {
    onChange(days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort());
  }

  return (
    <div className="space-y-2.5">
      <p className="text-xs font-semibold text-[#1A2340]">{title}</p>
      <p className="text-[11px] text-gray-500">{description}</p>
      <div className="flex flex-wrap gap-2">
        {[1, 2, 3, 4, 5, 6, 0].map((day) => {
          const selected = days.includes(day);
          return (
            <button
              key={day}
              type="button"
              onClick={() => toggleDay(day)}
              aria-pressed={selected}
              aria-label={DAYS_FULL[day]}
              className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl border transition-colors ${
                selected
                  ? "border-[#2EC4A5] bg-[#2EC4A5]/10"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <span className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold ${selected ? "bg-[#2EC4A5] text-white" : "bg-gray-200 text-gray-500"}`}>
                {DAYS_SHORT[day]}
              </span>
              <span className={`text-[10px] font-medium ${selected ? "text-[#1A2340]" : "text-gray-400"}`}>{DAYS_FULL[day]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
