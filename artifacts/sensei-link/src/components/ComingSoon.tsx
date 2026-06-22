import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type Accent = "teal" | "violet" | "amber";

const ACCENT: Record<Accent, { bg: string; text: string }> = {
  teal: { bg: "bg-teal-50", text: "text-teal-600" },
  violet: { bg: "bg-violet-50", text: "text-violet-600" },
  amber: { bg: "bg-amber-50", text: "text-amber-600" },
};

export function ComingSoon({
  icon: Icon,
  title,
  description,
  accent = "teal",
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  accent?: Accent;
  children?: ReactNode;
}) {
  const a = ACCENT[accent];
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className={`w-16 h-16 ${a.bg} rounded-2xl flex items-center justify-center mb-5`}>
        <Icon size={28} className={a.text} />
      </div>
      <h2 className="text-xl font-semibold text-gray-900 mb-2">{title}</h2>
      {description && <p className="text-sm text-muted-foreground mb-6 leading-relaxed max-w-sm">{description}</p>}
      {children}
    </div>
  );
}
