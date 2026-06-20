import { useState, useEffect } from "react";
import Picker from "react-mobile-picker";
import { X } from "lucide-react";

interface WheelDatePickerProps {
  value: string;
  onChange: (isoDate: string) => void;
  label?: string;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const MONTH_TO_NUM: Record<string, string> = Object.fromEntries(
  MONTHS.map((m, i) => [m, String(i + 1).padStart(2, "0")])
);
const NUM_TO_MONTH: Record<string, string> = Object.fromEntries(
  MONTHS.map((m, i) => [String(i + 1).padStart(2, "0"), m])
);

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR - 1990 + 1 }, (_, i) =>
  String(CURRENT_YEAR - i)
);
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"));

function parseIso(iso: string): { day: string; month: string; year: string } {
  if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split("-");
    return {
      year: y,
      month: NUM_TO_MONTH[m] ?? "Jan",
      day: d,
    };
  }
  return { day: "01", month: "Jan", year: String(CURRENT_YEAR - 5) };
}

function toIso(day: string, month: string, year: string): string {
  const m = MONTH_TO_NUM[month] ?? "01";
  return `${year}-${m}-${day}`;
}

function formatDisplay(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const monthName = NUM_TO_MONTH[m] ?? m;
  return `${parseInt(d)} ${monthName} ${y}`;
}

export function WheelDatePicker({ value, onChange }: WheelDatePickerProps) {
  const [open, setOpen] = useState(false);
  const [pickerValue, setPickerValue] = useState(() => parseIso(value));

  useEffect(() => {
    if (open) setPickerValue(parseIso(value));
  }, [open, value]);

  function handleConfirm() {
    onChange(toIso(pickerValue.day, pickerValue.month, pickerValue.year));
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`w-full rounded-lg border px-3 py-2.5 text-sm text-left transition-colors focus:outline-none focus:ring-1 focus:ring-teal-500 ${
          value
            ? "border-gray-200 text-gray-900 bg-white focus:border-teal-500"
            : "border-gray-200 text-gray-400 bg-white focus:border-teal-500"
        }`}
      >
        {value ? formatDisplay(value) : "Select date of birth"}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <div className="relative z-10 rounded-t-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100"
              >
                <X size={16} />
              </button>
              <p className="text-sm font-semibold text-gray-800">Date of birth</p>
              <button
                type="button"
                onClick={handleConfirm}
                className="rounded-lg bg-teal-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-700 active:bg-teal-800"
              >
                Done
              </button>
            </div>

            <div className="px-4 py-2">
              <Picker
                value={pickerValue}
                onChange={(v) => setPickerValue(v as typeof pickerValue)}
                height={210}
                itemHeight={42}
                wheelMode="natural"
              >
                <Picker.Column name="day">
                  {DAYS.map((d) => (
                    <Picker.Item key={d} value={d}>
                      <span className="text-base font-medium">{parseInt(d)}</span>
                    </Picker.Item>
                  ))}
                </Picker.Column>
                <Picker.Column name="month">
                  {MONTHS.map((m) => (
                    <Picker.Item key={m} value={m}>
                      <span className="text-base font-medium">{m}</span>
                    </Picker.Item>
                  ))}
                </Picker.Column>
                <Picker.Column name="year">
                  {YEARS.map((y) => (
                    <Picker.Item key={y} value={y}>
                      <span className="text-base font-medium">{y}</span>
                    </Picker.Item>
                  ))}
                </Picker.Column>
              </Picker>
            </div>

            <div className="h-safe-bottom pb-6" />
          </div>
        </div>
      )}
    </>
  );
}
