import { useState, useEffect } from "react";
import Picker from "react-mobile-picker";
import { X } from "lucide-react";

interface WheelTimePickerProps {
  value: string;
  onChange: (time: string) => void;
  placeholder?: string;
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = ["00", "15", "30", "45"];

function parseTime(t: string): { hour: string; minute: string } {
  if (t && /^\d{2}:\d{2}$/.test(t)) {
    const [h, m] = t.split(":");
    const snappedMinute = MINUTES.includes(m) ? m : "00";
    return { hour: h, minute: snappedMinute };
  }
  return { hour: "08", minute: "00" };
}

function formatDisplay(t: string): string {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${displayHour}:${m} ${ampm}`;
}

export function WheelTimePicker({ value, onChange, placeholder = "Select time" }: WheelTimePickerProps) {
  const [open, setOpen] = useState(false);
  const [pickerValue, setPickerValue] = useState(() => parseTime(value));

  useEffect(() => {
    if (open) setPickerValue(parseTime(value));
  }, [open, value]);

  function handleConfirm() {
    onChange(`${pickerValue.hour}:${pickerValue.minute}`);
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
        {value ? formatDisplay(value) : placeholder}
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
              <p className="text-sm font-semibold text-gray-800">Select time</p>
              <button
                type="button"
                onClick={handleConfirm}
                className="rounded-lg bg-teal-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-700 active:bg-teal-800"
              >
                Done
              </button>
            </div>

            <div className="px-8 py-2">
              <Picker
                value={pickerValue}
                onChange={(v) => setPickerValue(v as typeof pickerValue)}
                height={175}
                itemHeight={42}
                wheelMode="natural"
              >
                <Picker.Column name="hour">
                  {HOURS.map((h) => (
                    <Picker.Item key={h} value={h}>
                      <span className="text-base font-medium">{h}</span>
                    </Picker.Item>
                  ))}
                </Picker.Column>
                <Picker.Column name="minute">
                  {MINUTES.map((m) => (
                    <Picker.Item key={m} value={m}>
                      <span className="text-base font-medium">{m}</span>
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
