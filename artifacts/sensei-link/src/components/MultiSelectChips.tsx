import { cn } from "@/lib/utils";

interface MultiSelectChipsProps {
  options: { label: string; value: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  max?: number;
  disabled?: boolean;
  color?: "teal" | "blue" | "violet";
}

const COLOR_CLASSES = {
  teal: {
    active: "bg-teal-600 text-white border-teal-600",
    inactive: "bg-white text-gray-700 border-gray-200 hover:border-teal-400 hover:text-teal-700",
  },
  blue: {
    active: "bg-blue-600 text-white border-blue-600",
    inactive: "bg-white text-gray-700 border-gray-200 hover:border-blue-400 hover:text-blue-700",
  },
  violet: {
    active: "bg-violet-600 text-white border-violet-600",
    inactive: "bg-white text-gray-700 border-gray-200 hover:border-violet-400 hover:text-violet-700",
  },
};

export function MultiSelectChips({
  options,
  selected,
  onChange,
  max,
  disabled,
  color = "teal",
}: MultiSelectChipsProps) {
  const { active, inactive } = COLOR_CLASSES[color];

  function toggle(value: string) {
    if (disabled) return;
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      if (max && selected.length >= max) return;
      onChange([...selected, value]);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const isActive = selected.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => toggle(opt.value)}
            disabled={disabled || (!isActive && !!max && selected.length >= max)}
            className={cn(
              "px-3 py-1.5 rounded-full border text-sm font-medium transition-all duration-100 select-none",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              isActive ? active : inactive
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
