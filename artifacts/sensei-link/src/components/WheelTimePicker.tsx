import { useState, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface WheelTimePickerProps {
  value: string;
  onChange: (time: string) => void;
  placeholder?: string;
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = ["00", "15", "30", "45"];

interface TimeParts {
  hour: string;
  minute: string;
}

function parseTime(t: string): TimeParts {
  if (t && /^\d{2}:\d{2}$/.test(t)) {
    const [h, m] = t.split(":");
    // Snap legacy non-quarter minutes to "00" (same as the old wheel picker).
    return { hour: h, minute: MINUTES.includes(m) ? m : "00" };
  }
  return { hour: "", minute: "" };
}

export function WheelTimePicker({
  value,
  onChange,
  placeholder = "Select time",
}: WheelTimePickerProps) {
  const [parts, setParts] = useState<TimeParts>(() => parseTime(value));

  useEffect(() => {
    setParts(parseTime(value));
  }, [value]);

  function handleChange(field: keyof TimeParts, val: string) {
    const next: TimeParts = { ...parts, [field]: val };
    setParts(next);
    if (next.hour && next.minute) {
      onChange(`${next.hour}:${next.minute}`);
    }
  }

  return (
    <div className="grid grid-cols-2 gap-2" aria-label={placeholder}>
      <Select value={parts.hour} onValueChange={(v) => handleChange("hour", v)}>
        <SelectTrigger className="rounded-lg" aria-label="Hour">
          <SelectValue placeholder="HH" />
        </SelectTrigger>
        <SelectContent>
          {HOURS.map((h) => (
            <SelectItem key={h} value={h}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={parts.minute} onValueChange={(v) => handleChange("minute", v)}>
        <SelectTrigger className="rounded-lg" aria-label="Minute">
          <SelectValue placeholder="MM" />
        </SelectTrigger>
        <SelectContent>
          {MINUTES.map((m) => (
            <SelectItem key={m} value={m}>
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
