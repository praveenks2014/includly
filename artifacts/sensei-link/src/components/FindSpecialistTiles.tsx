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
          at 1024px+ — wraps, never horizontal-scrolls, at 1280/768/375. */}
      <div className="grid grid-cols-4 lg:grid-cols-8 gap-2">
        {categories.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => t.onClick(setComingSoon)}
              className="relative bg-white border border-gray-100 rounded-2xl p-3 pt-3.5 flex flex-col items-center gap-1.5 text-center hover:shadow-md hover:border-gray-200 transition-all"
            >
              {t.dot !== "none" && (
                <span
                  className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ring-2 ring-white ${
                    t.dot === "active" ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                />
              )}
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${t.iconClass}`}>
                <Icon size={16} />
              </div>
              <span className="text-[10px] font-bold text-[#1A2340] leading-tight">
                <span className="lg:hidden">{t.mobileLabel ?? t.label}</span>
                <span className="hidden lg:inline">{t.label}</span>
              </span>
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
