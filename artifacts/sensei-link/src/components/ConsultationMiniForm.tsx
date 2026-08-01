import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { SERVICE_CATEGORIES } from "@/lib/serviceCategories";
import { writePendingConsultationNotes } from "@/lib/consultationNotes";
import { InlineSpecialistResults } from "@/components/InlineSpecialistResults";

const MODE_OPTIONS = ["Online", "In-clinic"] as const;

export type ConsultationSpecialty = "psychiatrist" | "developmental_pediatrician" | "neurologist";

// Shared mini-form for the 3 consultation specialties — reason for visit,
// preferred mode, and the same "assessment findings" field pattern used by
// VerticalRequestWidget's Therapist form (visual shape only; this feeds
// notes on /sessions-v2/book via BookingWidgetV2, not extraNotes on a
// match request, so the component isn't shared/imported between them).
export function ConsultationMiniForm({ specialty }: { specialty: ConsultationSpecialty }) {
  const [, setLocation] = useLocation();
  const meta = SERVICE_CATEGORIES.find((c) => c.key === specialty)!;
  const Icon = meta.icon;

  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<(typeof MODE_OPTIONS)[number]>("Online");
  const [assessmentFindings, setAssessmentFindings] = useState("");
  const [extraNotes, setExtraNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit() {
    const notesParts: string[] = [];
    if (reason.trim()) notesParts.push(`Reason for visit: ${reason.trim()}`);
    notesParts.push(`Preferred mode: ${mode}`);
    if (assessmentFindings.trim()) {
      notesParts.push(`Existing diagnosis / assessment findings: ${assessmentFindings.trim()}`);
    }
    if (extraNotes.trim()) notesParts.push(extraNotes.trim());

    writePendingConsultationNotes({
      specialty,
      notes: notesParts.join("\n\n"),
      mode,
    });
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="space-y-5 pb-4">
        <button
          onClick={() => setLocation("/services")}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-teal-600 transition-colors"
        >
          <ArrowLeft size={13} /> Back to Services
        </button>
        <h2 className="font-serif font-bold text-[#1A2340] text-lg">{meta.label} specialists</h2>
        <InlineSpecialistResults specialty={specialty} />
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
          <h2 className="font-serif font-bold text-[#1A2340]">{meta.label} consultation</h2>
        </div>

        <div>
          <label className="text-sm mb-1 block font-medium text-foreground">Reason for visit</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={2}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2EC4A5] resize-none"
            placeholder="e.g. difficulty with attention/focus at school"
          />
        </div>

        <div>
          <label className="text-sm mb-1 block font-medium text-foreground">Preferred mode</label>
          <div className="flex flex-wrap gap-1.5">
            {MODE_OPTIONS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`text-xs px-2.5 py-1 rounded-full border ${
                  mode === m ? "bg-[#2EC4A5] text-white border-[#2EC4A5]" : "bg-white text-gray-600 border-gray-200"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-sm mb-1 block font-medium text-foreground">
            Existing diagnosis / assessment findings <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <textarea
            value={assessmentFindings}
            onChange={(e) => setAssessmentFindings(e.target.value)}
            maxLength={1000}
            rows={3}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2EC4A5] resize-none"
            placeholder="e.g. a brief summary of a prior evaluation — full reports can be shared directly with the specialist after matching"
          />
        </div>

        <div>
          <label className="text-sm mb-1 block font-medium text-foreground">
            Anything else? <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <textarea
            value={extraNotes}
            onChange={(e) => setExtraNotes(e.target.value)}
            maxLength={500}
            rows={2}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2EC4A5] resize-none"
            placeholder="Anything else the specialist should know"
          />
        </div>

        <p className="text-xs text-gray-400">
          Browsing and picking a slot is free — you'll only pay (or use a session credit) once you actually book with a specialist.
        </p>

        <button
          onClick={handleSubmit}
          className="w-full bg-[#2EC4A5] hover:bg-[#26a88d] text-white font-semibold text-sm rounded-xl py-2.5 transition-colors"
        >
          View Available Slots
        </button>
      </div>
    </div>
  );
}
