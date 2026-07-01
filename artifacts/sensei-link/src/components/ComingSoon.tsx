import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useRef } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";

type Accent = "teal" | "violet" | "amber";

const ACCENT: Record<Accent, { icon: string; pill: string; glow: string }> = {
  teal: {
    icon: "bg-teal-50 text-teal-600",
    pill: "bg-teal-50 text-teal-700 border-teal-100",
    glow: "from-teal-50/60 to-emerald-50/40",
  },
  violet: {
    icon: "bg-violet-50 text-violet-600",
    pill: "bg-violet-50 text-violet-700 border-violet-100",
    glow: "from-violet-50/60 to-purple-50/40",
  },
  amber: {
    icon: "bg-amber-50 text-amber-600",
    pill: "bg-amber-50 text-amber-700 border-amber-100",
    glow: "from-amber-50/60 to-yellow-50/40",
  },
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
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });
  const prefersReduced = useReducedMotion();
  const a = ACCENT[accent];

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: prefersReduced ? 0 : 20 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-center justify-center py-16 px-6 text-center"
    >
      <div className={`relative w-16 h-16 rounded-2xl bg-gradient-to-br ${a.glow} flex items-center justify-center mb-5 shadow-sm border border-white/60`}>
        <Icon size={26} className={a.icon.split(" ")[1]} />
      </div>
      <div className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full border ${a.pill} mb-4`}>
        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
        Coming Soon
      </div>
      <h2 className="text-xl font-semibold text-gray-900 mb-2">{title}</h2>
      {description && (
        <p className="text-sm text-muted-foreground mb-6 leading-relaxed max-w-sm">{description}</p>
      )}
      {children}
    </motion.div>
  );
}
