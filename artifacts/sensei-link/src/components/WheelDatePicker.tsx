import { useState, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface WheelDatePickerProps {
  value: string;
  onChange: (isoDate: string) => void;
  label?: string;
}

const MONTHS = [
  { value: "01", label: "Jan" },
  { value: "02", label: "Feb" },
  { value: "03", label: "Mar" },
  { value: "04", label: "Apr" },
  { value: "05", label: "May" },
  { value: "06", label: "Jun" },
  { value: "07", label: "Jul" },
  { value: "08", label: "Aug" },
  { value: "09", label: "Sep" },
  { value: "10", label: "Oct" },
  { value: "11", label: "Nov" },
  { value: "12", label: "Dec" },
];

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR - 1990 + 1 }, (_, i) =>
  String(CURRENT_YEAR - i)
);

interface DateParts {
  day: string;
  month: string;
  year: string;
}

function parseIso(iso: string): DateParts {
  if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split("-");
    return { year: y, month: m, day: d };
  }
  return { day: "", month: "", year: "" };
}

function daysInMonth(month: string, year: string): number {
  const m = parseInt(month, 10);
  const y = parseInt(year, 10);
  if (!m || !y) return 31;
  return new Date(y, m, 0).getDate();
}

export function WheelDatePicker({ value, onChange }: WheelDatePickerProps) {
  const [parts, setParts] = useState<DateParts>(() => parseIso(value));

  useEffect(() => {
    setParts(parseIso(value));
  }, [value]);

  const maxDay =
    parts.month && parts.year ? daysInMonth(parts.month, parts.year) : 31;
  const days = Array.from({ length: maxDay }, (_, i) =>
    String(i + 1).padStart(2, "0")
  );

  function handleChange(field: keyof DateParts, val: string) {
    const next: DateParts = { ...parts, [field]: val };
    // Clamp an impossible day (e.g. 31 Feb) down to the month's last valid day.
    const max =
      next.month && next.year ? daysInMonth(next.month, next.year) : 31;
    if (next.day && parseInt(next.day, 10) > max) {
      next.day = String(max).padStart(2, "0");
    }
    setParts(next);
    if (next.day && next.month && next.year) {
      onChange(`${next.year}-${next.month}-${next.day}`);
    }
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      <Select value={parts.day} onValueChange={(v) => handleChange("day", v)}>
        <SelectTrigger className="rounded-lg" aria-label="Day">
          <SelectValue placeholder="Day" />
        </SelectTrigger>
        <SelectContent>
          {days.map((d) => (
            <SelectItem key={d} value={d}>
              {parseInt(d, 10)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={parts.month} onValueChange={(v) => handleChange("month", v)}>
        <SelectTrigger className="rounded-lg" aria-label="Month">
          <SelectValue placeholder="Month" />
        </SelectTrigger>
        <SelectContent>
          {MONTHS.map((m) => (
            <SelectItem key={m.value} value={m.value}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={parts.year} onValueChange={(v) => handleChange("year", v)}>
        <SelectTrigger className="rounded-lg" aria-label="Year">
          <SelectValue placeholder="Year" />
        </SelectTrigger>
        <SelectContent>
          {YEARS.map((y) => (
            <SelectItem key={y} value={y}>
              {y}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
