import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { SERVICE_CATEGORIES } from "@/lib/serviceCategories";
import { COACHING_SUB_TYPE_OPTIONS, getCoachingSubTypeIcon } from "@/lib/specialties";
import { InlineSpecialistResults } from "@/components/InlineSpecialistResults";

// Icon Grid's inline first step for Inclusive Coach — collects the
// activity up front and pre-supplies it as coachingSubType on the URL,
// rather than making the parent set it manually in search's Filters panel
// (which stays how List View reaches search, unchanged).
export function CoachActivityForm() {
  const [, setLocation] = useLocation();
  const meta = SERVICE_CATEGORIES.find((c) => c.key === "coaching")!;
  const Icon = meta.icon;

  const [activity, setActivity] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit() {
    if (!activity) return;
    setSubmitted(true);
  }

  if (submitted && activity) {
    return (
      <div className="space-y-5 pb-4">
        <button
          onClick={() => setLocation("/services")}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-teal-600 transition-colors"
        >
          <ArrowLeft size={13} /> Back to Services
        </button>
        <h2 className="font-serif font-bold text-[#1A2340] text-lg">Inclusive Coaches</h2>
        <InlineSpecialistResults specialty="coaching" coachingSubType={activity} />
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-4">
      <button
        onClick={() => setLocation("/services")}
        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-teal-600 transition-colors"
      >
        <ArrowLeft size={13} /> Back to Services
      </button>

      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${meta.iconClass}`}>
            <Icon size={16} />
          </div>
          <h2 className="font-serif font-bold text-[#1A2340]">Inclusive Coach</h2>
        </div>

        <div>
          <label className="text-sm mb-2 block font-medium text-foreground">Activity needed</label>
          <div className="grid grid-cols-2 gap-2">
            {COACHING_SUB_TYPE_OPTIONS.map((opt) => {
              const OptIcon = getCoachingSubTypeIcon(opt.value);
              const selected = activity === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setActivity(opt.value)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                    selected
                      ? "bg-orange-50 border-orange-300 text-orange-700"
                      : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  <OptIcon size={14} />
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <p className="text-xs text-gray-400">
          Browsing is free — you'll only pay once you actually book a session with a coach.
        </p>

        <button
          onClick={handleSubmit}
          disabled={!activity}
          className="w-full bg-[#2EC4A5] hover:bg-[#26a88d] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-xl py-2.5 transition-colors"
        >
          View Available Coaches
        </button>
      </div>
    </div>
  );
}
