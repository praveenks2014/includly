import { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { ComingSoon } from "@/components/ComingSoon";
import { useServiceCategoryStatus, type ComingSoonInfo } from "@/lib/serviceCategories";

// List-row rendering of the same 8 categories as FindSpecialistTiles —
// purely presentational, reads dot/isLive/onClick entirely from
// useServiceCategoryStatus(). Does not independently compute or re-derive
// any category state itself; that's the exact drift that caused this list
// to fall out of sync with the tile grid in the first place.
export function ServiceCategoryList() {
  const categories = useServiceCategoryStatus();
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
      {categories.map((c) => {
        const Icon = c.icon;
        return (
          <button
            key={c.key}
            onClick={() => c.onClick(setComingSoon)}
            className="w-full bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex items-center gap-4 text-left hover:shadow-md transition-shadow"
          >
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 relative ${c.iconClass}`}>
              <Icon size={20} />
              {c.dot !== "none" && (
                <span
                  className={`absolute top-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-white ${
                    c.dot === "active" ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="font-bold text-[#1A2340] text-sm">{c.label}</p>
                {!c.isLive && (
                  <span className="text-[9px] font-bold uppercase tracking-wide text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
                    Coming soon
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-0.5">{c.description}</p>
            </div>
            <ArrowRight size={16} className="text-gray-300 shrink-0" />
          </button>
        );
      })}
    </div>
  );
}
