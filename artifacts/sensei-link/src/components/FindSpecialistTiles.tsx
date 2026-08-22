import { useState } from "react";
import { ArrowLeft, MousePointerClick } from "lucide-react";
import { ComingSoon } from "@/components/ComingSoon";
import { useServiceCategoryStatus, type ComingSoonInfo } from "@/lib/serviceCategories";

export function FindSpecialistTiles() {
  const categories = useServiceCategoryStatus("tiles");
  const [comingSoon, setComingSoon] = useState<ComingSoonInfo | null>(null);

  if (comingSoon) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setComingSoon(null)}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-teal-600 transition-colors"
        >
          <ArrowLeft size={14} /> Back
        </button>
        <ComingSoon icon={comingSoon.icon} accent="amber" title={comingSoon.title} description={comingSoon.description} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Single breakpoint at lg: 4-across (2 rows) below 1024px, 8-across
          at 1024px+ — wraps, never horizontal-scrolls, at 1280/768/375.
          gap-2.5 (not the 0.65rem the mockup used) — stays on Tailwind's
          spacing scale, same visual result. */}
      <div className="grid grid-cols-4 lg:grid-cols-8 gap-2.5">
        {categories.map((t) => {
          const Icon = t.icon;
          // Badge background bumped one step deeper (-50 → -100) purely for
          // icon-color contrast at the larger size — icon color and the
          // shared iconClass in serviceCategories.ts (consumed by
          // ServiceCategoryList too) stay untouched, so List View is
          // unaffected. Every category's iconClass follows the same "-50"
          // convention, so this is a safe, mechanical transform, not a
          // hand-maintained parallel color map.
          const badgeClass = t.iconClass.replace(/-50\b/, "-100");
          return (
            <button
              key={t.key}
              onClick={() => t.onClick(setComingSoon)}
              className={`group relative bg-white border border-gray-100 rounded-2xl p-3.5 pt-4 flex flex-col items-center gap-2 text-center shadow-[0_1px_2px_rgba(26,35,64,0.04),0_1px_8px_rgba(26,35,64,0.03)] transition-[transform,box-shadow,border-color] duration-200 hover:[transform:perspective(600px)_rotateY(5deg)_translateY(-3px)] hover:shadow-[0_10px_24px_rgba(26,35,64,0.10),0_2px_6px_rgba(26,35,64,0.06)] hover:border-teal-200 focus-visible:[transform:perspective(600px)_rotateY(5deg)_translateY(-3px)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 active:[transform:scale(0.95)] ${!t.isLive ? "opacity-60 grayscale-[0.4]" : ""}`}
            >
              {t.dot !== "none" && (
                <span
                  className={`absolute top-2 right-2 w-2.5 h-2.5 rounded-full ring-2 ring-white ${
                    t.dot === "active" ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                />
              )}
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-[1.06] ${badgeClass}`}>
                <Icon size={24} />
              </div>
              <span className="text-[11px] font-bold text-[#1A2340] leading-tight">
                <span className="lg:hidden">{t.mobileLabel ?? t.label}</span>
                <span className="hidden lg:inline">{t.label}</span>
              </span>
              {!t.isLive && (
                <span className="text-[8px] font-bold uppercase tracking-wide text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5 leading-none">
                  Coming soon
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-400">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active engagement
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Request in progress
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-300" /> No relationship yet
        </span>
      </div>
      <div className="flex flex-col items-center justify-center gap-2 bg-teal-50/60 border border-dashed border-teal-200 rounded-2xl py-7 px-6 text-center">
        <div className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center text-teal-600">
          <MousePointerClick size={18} />
        </div>
        <p className="text-sm font-bold text-[#1A2340]">Tap a category above to get started</p>
        <p className="text-xs text-gray-400">We'll match you with verified specialists for your child</p>
      </div>
    </div>
  );
}
