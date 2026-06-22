import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Loader2, BookOpen, User, TrendingUp, Plus, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";

export interface ProgressEngagement {
  id: number;
  childId: number | null;
  childName: string | null;
  status: string;
}

interface DailyLog {
  id: number;
  logDate: string;
  authorRole: string;
  authorUserId: number;
  content: string;
  createdAt: string;
  updatedAt: string;
  authorName: string | null;
  signedPhotoUrl?: string | null;
}

interface ChildGoal {
  id: number;
  label: string;
  category: string | null;
  isActive: boolean;
  createdByUserId: number;
}

interface BehaviorLog {
  id: number;
  childId: number;
  engagementId: number | null;
  dailyLogId: number | null;
  loggedBy: number;
  occurredAt: string;
  tantrumTypes: string[];
  triggers: string[] | null;
  durationMinutes: number | null;
  intensity: string;
  notes: string | null;
  strategies: { strategy: string; worked: "yes" | "no" | "too_early" }[];
  createdAt: string;
}

const MOODS = ["😊 Great", "🙂 Good", "😐 Okay", "😔 Difficult"];
const P_RANK: Record<string, number> = { independent: 5, visual_prompt: 4, verbal_prompt: 3, modeling: 2, physical_assist: 1 };
const P_BG: Record<string, string> = { independent: "bg-green-400", visual_prompt: "bg-yellow-400", verbal_prompt: "bg-amber-400", modeling: "bg-orange-400", physical_assist: "bg-red-400" };

const TANTRUM_TYPES = [
  "Physical aggression", "Self-injurious behavior", "Property destruction", "Elopement",
  "Screaming / vocal outburst", "Drop and refuse", "Throwing objects", "Emotional meltdown",
  "Non-compliance / task refusal", "Repetitive behavior escalation", "Social withdrawal / shutdown",
  "Breath-holding", "Other",
];

const TRIGGERS_LIST = [
  "Sensory overload", "Transition / routine change", "Demand or task presented",
  "Preferred item or activity removed", "Attention-seeking", "Hunger or fatigue",
  "Pain or physical discomfort", "Communication frustration", "Unexpected change",
  "Social interaction difficulty", "Waiting", "Other",
];

const STRATEGIES_LIST = [
  "Redirection", "Sensory break", "Visual schedule or cue", "First-then board",
  "Deep pressure / proprioceptive input", "Calm-down space / safe space",
  "Token economy / reward offered", "Planned ignoring", "Verbal de-escalation",
  "Physical guidance / hand-over-hand", "Social story reviewed", "Choice offered",
  "Wait and observe", "Other",
];

const DURATION_BANDS = [
  { key: "under5",  label: "Under 5 min", minutes: 2  },
  { key: "5to15",   label: "5–15 min",    minutes: 10 },
  { key: "15to30",  label: "15–30 min",   minutes: 22 },
  { key: "over30",  label: "Over 30 min", minutes: 45 },
];

const INTENSITY_CLASS: Record<string, string> = {
  mild:     "bg-green-100 text-green-700 border-green-200",
  moderate: "bg-amber-100 text-amber-700 border-amber-200",
  severe:   "bg-red-100 text-red-700 border-red-200",
};

const OUTCOME_CLASS: Record<string, string> = {
  yes:       "bg-green-100 text-green-700",
  no:        "bg-red-100 text-red-700",
  too_early: "bg-gray-100 text-gray-500",
};

const OUTCOME_LABEL: Record<string, string> = {
  yes: "✓ Worked", no: "✗ Didn't work", too_early: "⟳ Too early",
};

function BehaviorDetail({ bl }: { bl: BehaviorLog }) {
  const strategies = bl.strategies ?? [];
  return (
    <div className="mt-2 pt-2 border-t border-rose-100 space-y-1.5">
      <p className="text-[10px] font-bold text-rose-600 uppercase tracking-wide flex items-center gap-1">
        <AlertTriangle size={10} /> Behavior incident recorded
      </p>
      <div className="flex flex-wrap gap-1">
        {bl.tantrumTypes.map((t, i) => (
          <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 font-semibold">{t}</span>
        ))}
        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold capitalize ${INTENSITY_CLASS[bl.intensity] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
          {bl.intensity}
        </span>
        {bl.durationMinutes != null && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold">⏱ {bl.durationMinutes} min</span>
        )}
      </div>
      {(bl.triggers ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {(bl.triggers ?? []).map((t, i) => (
            <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">⚡ {t}</span>
          ))}
        </div>
      )}
      {strategies.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {strategies.map((s, i) => (
            <span key={i} className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${OUTCOME_CLASS[s.worked] ?? "bg-gray-100 text-gray-600"}`}>
              {s.strategy} · {OUTCOME_LABEL[s.worked] ?? s.worked}
            </span>
          ))}
        </div>
      )}
      {bl.notes && <p className="text-[11px] text-gray-500 italic">{bl.notes}</p>}
    </div>
  );
}

/**
 * Shared logs / goals / trends surface for a single active shadow-teacher engagement.
 * Used by both the shadow-teacher workspace (ShadowTeacherTab) and the Progress destination.
 * Owns the engagement-logs and child-goals queries with the SAME query keys used elsewhere,
 * so React Query dedupes the fetches and childId scoping stays identical across both call sites.
 */
export function EngagementProgress({
  active,
  view,
}: {
  active: ProgressEngagement;
  view: "logs" | "goals" | "trends";
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: logs = [] } = useQuery<DailyLog[]>({
    queryKey: ["engagement-logs", active.id],
    queryFn: () => fetchWithAuth(`/api/engagements/${active.id}/daily-logs`).then((r) => r.json()),
    enabled: !!active.id,
  });

  const { data: childGoals = [] } = useQuery<ChildGoal[]>({
    queryKey: ["child-goals", active.childId],
    queryFn: () => fetchWithAuth(`/api/children/${active.childId}/goals`).then((r) => r.json()),
    enabled: !!active.childId,
  });

  // ── Behavior logs — scoped to SELECTED CHILD's childId (from the engagement prop) ──
  // The engagement prop is already scoped to selectedChildId at the ProgressTab/ShadowTeacherTab
  // call site, so active.childId is always the correct child. Switching children re-mounts
  // with a new active prop, giving a fresh queryKey and a fresh fetch.
  const { data: behaviorLogs = [] } = useQuery<BehaviorLog[]>({
    queryKey: ["behavior-logs", active.childId],
    queryFn: () => fetchWithAuth(`/api/behavior-logs?childId=${active.childId}`).then((r) => r.json()),
    enabled: !!active.childId,
  });

  const behaviorByDailyLogId = useMemo(() => {
    const map: Record<number, BehaviorLog> = {};
    for (const bl of behaviorLogs) {
      if (bl.dailyLogId != null) map[bl.dailyLogId] = bl;
    }
    return map;
  }, [behaviorLogs]);

  const standaloneBehaviorLogs = useMemo(
    () => behaviorLogs.filter((bl) => bl.dailyLogId == null),
    [behaviorLogs],
  );

  // ── Daily log state ──
  const [logNote, setLogNote] = useState("");
  const [logExtraSupport, setLogExtraSupport] = useState("");
  const [logMood, setLogMood] = useState("");
  const [postingLog, setPostingLog] = useState(false);

  // ── Goal state ──
  const [addingGoal, setAddingGoal] = useState(false);
  const [newGoalLabel, setNewGoalLabel] = useState("");
  const [newGoalCategory, setNewGoalCategory] = useState("");
  const [savingGoal, setSavingGoal] = useState(false);

  // ── Behavior form state (attached to session log — fires on "Post Update") ──
  const [bOpen, setBOpen] = useState(false);
  const [bTypes, setBTypes] = useState<string[]>([]);
  const [bTypesOther, setBTypesOther] = useState("");
  const [bTriggers, setBTriggers] = useState<string[]>([]);
  const [bTriggersOther, setBTriggersOther] = useState("");
  const [bDuration, setBDuration] = useState("");
  const [bIntensity, setBIntensity] = useState("");
  const [bStrategies, setBStrategies] = useState<Record<string, "yes" | "no" | "too_early">>({});
  const [bStrategiesOther, setBStrategiesOther] = useState("");
  const [bNotes, setBNotes] = useState("");

  function resetBehaviorForm() {
    setBTypes([]); setBTypesOther("");
    setBTriggers([]); setBTriggersOther("");
    setBDuration(""); setBIntensity("");
    setBStrategies({}); setBStrategiesOther("");
    setBNotes("");
  }

  function buildBehaviorPayload(dailyLogId?: number) {
    const DURATION_MAP: Record<string, number> = { under5: 2, "5to15": 10, "15to30": 22, over30: 45 };
    const finalTypes = bTypes.filter((t) => t !== "Other").concat(
      bTypes.includes("Other") ? [bTypesOther.trim() || "Other"] : [],
    );
    const finalTriggers = bTriggers.filter((t) => t !== "Other").concat(
      bTriggers.includes("Other") ? [bTriggersOther.trim() || "Other"] : [],
    );
    const strategyEntries: { strategy: string; worked: "yes" | "no" | "too_early" }[] =
      Object.entries(bStrategies)
        .filter(([s]) => s !== "Other")
        .map(([strategy, worked]) => ({ strategy, worked }));
    if ("Other" in bStrategies) {
      strategyEntries.push({ strategy: bStrategiesOther.trim() || "Other", worked: bStrategies["Other"] });
    }
    return {
      childId: active.childId!,
      engagementId: active.id,
      ...(dailyLogId != null && { dailyLogId }),
      tantrumTypes: finalTypes,
      ...(finalTriggers.length > 0 && { triggers: finalTriggers }),
      ...(bDuration && { durationMinutes: DURATION_MAP[bDuration] }),
      intensity: bIntensity,
      ...(bNotes.trim() && { notes: bNotes.trim() }),
      strategies: strategyEntries,
    };
  }

  async function handlePostLog() {
    if (!logNote.trim()) return;
    setPostingLog(true);
    try {
      const resp = await fetchWithAuth(`/api/engagements/${active.id}/daily-logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logDate: new Date().toISOString().slice(0, 10),
          content: {
            eventsForTeacher: [logMood, logNote.trim()].filter(Boolean).join(" — "),
            extraSupportAreas: logExtraSupport.trim() || undefined,
          },
        }),
      });
      const createdLog = await resp.json() as { id: number };
      queryClient.invalidateQueries({ queryKey: ["engagement-logs", active.id] });

      // Submit attached behavior incident if the panel is open and has required data.
      // This is a separate POST — the daily_logs table and schema are untouched.
      if (bOpen && bTypes.length > 0 && bIntensity) {
        try {
          await fetchWithAuth("/api/behavior-logs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildBehaviorPayload(createdLog.id)),
          });
          queryClient.invalidateQueries({ queryKey: ["behavior-logs", active.childId] });
        } catch { /* non-blocking — daily log already saved */ }
      }

      setLogNote(""); setLogExtraSupport(""); setLogMood("");
      setBOpen(false); resetBehaviorForm();
      toast({ title: "Update posted ✓" });
    } catch { toast({ title: "Failed to post update", variant: "destructive" }); }
    finally { setPostingLog(false); }
  }

  async function handleAddGoal() {
    if (!active.childId || !newGoalLabel.trim()) return;
    setSavingGoal(true);
    try {
      await fetchWithAuth(`/api/children/${active.childId}/goals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newGoalLabel.trim(), category: newGoalCategory.trim() || undefined, engagementId: active.id }),
      });
      await queryClient.invalidateQueries({ queryKey: ["child-goals", active.childId] });
      setNewGoalLabel(""); setNewGoalCategory(""); setAddingGoal(false);
      toast({ title: "Goal added ✓" });
    } catch { toast({ title: "Failed to add goal", variant: "destructive" }); }
    finally { setSavingGoal(false); }
  }

  async function handleToggleParentGoal(goalId: number, isActive: boolean) {
    if (!active.childId) return;
    try {
      await fetchWithAuth(`/api/children/${active.childId}/goals/${goalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !isActive }),
      });
      queryClient.invalidateQueries({ queryKey: ["child-goals", active.childId] });
    } catch { toast({ title: "Failed to update goal", variant: "destructive" }); }
  }

  // ── Behavior form (used by both attached and standalone modes) ──
  function renderBehaviorForm(
    submitLabel: string,
    onSubmit: () => void,
    isSubmitting: boolean,
    isAttached: boolean,
  ) {
    return (
      <div className="space-y-4">
        {/* Behavior types */}
        <div>
          <p className="text-xs font-semibold text-gray-700 mb-1.5">What happened? <span className="text-rose-500">*</span></p>
          <div className="flex flex-wrap gap-1.5">
            {TANTRUM_TYPES.map((t) => (
              <button key={t} type="button"
                onClick={() => setBTypes((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t])}
                className={`text-[11px] px-2.5 py-1 rounded-full border font-medium transition-colors ${bTypes.includes(t) ? "bg-rose-500 text-white border-rose-500" : "bg-white text-gray-600 border-gray-200 hover:border-rose-300"}`}>
                {t}
              </button>
            ))}
          </div>
          {bTypes.includes("Other") && (
            <input value={bTypesOther} onChange={(e) => setBTypesOther(e.target.value)}
              placeholder="Describe the behavior…"
              className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
          )}
        </div>

        {/* Triggers */}
        <div>
          <p className="text-xs font-semibold text-gray-700 mb-1.5">What triggered it? <span className="text-gray-400 font-normal">(optional)</span></p>
          <div className="flex flex-wrap gap-1.5">
            {TRIGGERS_LIST.map((t) => (
              <button key={t} type="button"
                onClick={() => setBTriggers((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t])}
                className={`text-[11px] px-2.5 py-1 rounded-full border font-medium transition-colors ${bTriggers.includes(t) ? "bg-amber-500 text-white border-amber-500" : "bg-white text-gray-600 border-gray-200 hover:border-amber-300"}`}>
                {t}
              </button>
            ))}
          </div>
          {bTriggers.includes("Other") && (
            <input value={bTriggersOther} onChange={(e) => setBTriggersOther(e.target.value)}
              placeholder="Describe the trigger…"
              className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          )}
        </div>

        {/* Duration */}
        <div>
          <p className="text-xs font-semibold text-gray-700 mb-1.5">How long did it last? <span className="text-gray-400 font-normal">(optional)</span></p>
          <div className="flex flex-wrap gap-1.5">
            {DURATION_BANDS.map((d) => (
              <button key={d.key} type="button"
                onClick={() => setBDuration((p) => p === d.key ? "" : d.key)}
                className={`text-[11px] px-2.5 py-1 rounded-full border font-medium transition-colors ${bDuration === d.key ? "bg-blue-500 text-white border-blue-500" : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"}`}>
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* Intensity */}
        <div>
          <p className="text-xs font-semibold text-gray-700 mb-1.5">Intensity <span className="text-rose-500">*</span></p>
          <div className="flex gap-2">
            {([ ["mild", "Mild"], ["moderate", "Moderate"], ["severe", "Severe"] ] as const).map(([val, label]) => (
              <button key={val} type="button"
                onClick={() => setBIntensity((p) => p === val ? "" : val)}
                className={`text-[11px] px-3 py-1 rounded-full border font-semibold transition-colors ${
                  bIntensity === val
                    ? val === "mild" ? "bg-green-500 text-white border-green-500"
                      : val === "moderate" ? "bg-amber-500 text-white border-amber-500"
                      : "bg-red-500 text-white border-red-500"
                    : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Strategies */}
        <div>
          <p className="text-xs font-semibold text-gray-700 mb-1.5">Strategies tried <span className="text-gray-400 font-normal">(optional)</span></p>
          <div className="space-y-1.5">
            {STRATEGIES_LIST.map((s) => {
              const selected = s in bStrategies;
              const outcome = bStrategies[s];
              return (
                <div key={s} className={`rounded-lg border px-3 py-2 transition-colors ${selected ? "border-teal-200 bg-teal-50" : "border-gray-200 bg-white"}`}>
                  <div className="flex items-center gap-2">
                    <button type="button"
                      onClick={() => setBStrategies((p) => {
                        const n = { ...p };
                        if (s in n) { delete n[s]; } else { n[s] = "too_early"; }
                        return n;
                      })}
                      className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-colors ${selected ? "bg-teal-500 border-teal-500" : "border-gray-300 bg-white"}`}>
                      {selected && <CheckCircle2 size={10} className="text-white" />}
                    </button>
                    <span className="text-xs text-gray-700 flex-1">{s}</span>
                    {selected && (
                      <div className="flex gap-1 shrink-0">
                        {([ ["yes", "✓ Worked"], ["no", "✗ Didn't"], ["too_early", "⟳ Unsure"] ] as const).map(([val, lbl]) => (
                          <button key={val} type="button"
                            onClick={() => setBStrategies((p) => ({ ...p, [s]: val }))}
                            className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold transition-all ${outcome === val ? OUTCOME_CLASS[val] + " border-transparent" : "bg-white text-gray-400 border-gray-200"}`}>
                            {lbl}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {s === "Other" && selected && (
                    <input value={bStrategiesOther} onChange={(e) => setBStrategiesOther(e.target.value)}
                      placeholder="Describe strategy…"
                      className="mt-1.5 w-full rounded-lg border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-teal-400" />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Notes */}
        <div>
          <p className="text-xs font-semibold text-gray-700 mb-1">Any other notes? <span className="text-gray-400 font-normal">(optional)</span></p>
          <textarea value={bNotes} onChange={(e) => setBNotes(e.target.value)} rows={2}
            placeholder="Additional context…"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none" />
        </div>

        {!isAttached && (
          <Button onClick={onSubmit} disabled={isSubmitting || bTypes.length === 0 || !bIntensity}
            className="w-full bg-rose-500 hover:bg-rose-600 text-white text-sm">
            {isSubmitting ? <Loader2 size={14} className="animate-spin mr-1" /> : <AlertTriangle size={14} className="mr-1" />}
            {submitLabel}
          </Button>
        )}
      </div>
    );
  }

  // ── Trend preprocessing (teacher logs only) ──
  const _ptLogs = [...logs].filter((l) => l.authorRole === "teacher").sort((a, b) => a.logDate.localeCompare(b.logDate)).map((l) => { let c: Record<string, unknown> = {}; try { c = JSON.parse(l.content) as Record<string, unknown>; } catch {} return { date: l.logDate.slice(5), c }; });
  const ptGoalMap: Record<string, { label: string; pts: { date: string; rank: number; level: string }[] }> = {};
  _ptLogs.forEach(({ date, c }) => { ((c["goalRatings"] as { goalId: number; label: string; level: string }[] | undefined) ?? []).forEach((gr) => { const k = String(gr.goalId); if (!ptGoalMap[k]) ptGoalMap[k] = { label: gr.label, pts: [] }; ptGoalMap[k].pts.push({ date, rank: P_RANK[gr.level] ?? 3, level: gr.level }); }); });
  const ptBehavMap: Record<string, { date: string; count: number }[]> = {};
  _ptLogs.forEach(({ date, c }) => { ((c["behaviorCounts"] as { label: string; count: number }[] | undefined) ?? []).filter((b) => b.count > 0).forEach((b) => { if (!ptBehavMap[b.label]) ptBehavMap[b.label] = []; ptBehavMap[b.label].push({ date, count: b.count }); }); });
  const ptDurData = _ptLogs.flatMap(({ date, c }) => { const tot = ((c["durations"] as { label: string; minutes: number }[] | undefined) ?? []).reduce((s, d) => s + d.minutes, 0); return tot > 0 ? [{ date, minutes: tot }] : []; });
  const ptGoalEntries = Object.entries(ptGoalMap);
  const ptBehavEntries = Object.entries(ptBehavMap);
  const hasPtTrendData = ptGoalEntries.length > 0 || ptBehavEntries.length > 0 || ptDurData.length > 0;
  const ptMaxMins = ptDurData.length > 0 ? Math.max(...ptDurData.map((d) => d.minutes), 1) : 1;

  // ════════════════════════════════════════════════════════
  // VIEW: LOGS
  // ════════════════════════════════════════════════════════
  if (view === "logs") {
    return (
      <div className="space-y-4">
        {active.status === "ended" && (
          <div className="flex items-center gap-2.5 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
            <CheckCircle2 size={13} className="text-gray-400 shrink-0" />
            <p className="text-xs text-gray-500 font-medium">This engagement has ended — records are read-only.</p>
          </div>
        )}

        {/* ── Today's Update + optional behavior incident ── */}
        {active.status !== "ended" && (
          <div className="bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(26,35,64,0.06)] space-y-3">
            <div>
              <p className="text-sm font-bold text-[#1A2340]">Today's Update</p>
              <p className="text-xs text-gray-400 mt-0.5">Anything the teacher should know today?</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-2">Child's mood at home today <span className="text-gray-400">(optional)</span></p>
              <div className="flex gap-2 flex-wrap">
                {MOODS.map((m) => (
                  <button key={m} onClick={() => setLogMood(logMood === m ? "" : m)}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${logMood === m ? "border-[#2EC4A5] bg-[#2EC4A5]/10 text-[#2EC4A5]" : "border-gray-200 hover:border-gray-300"}`}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Events at home</p>
              <textarea value={logNote} onChange={(e) => setLogNote(e.target.value)} rows={3}
                placeholder="Didn't sleep well, was upset at breakfast…"
                className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#2EC4A5] resize-none" />
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Areas needing extra support <span className="text-gray-400">(optional)</span></p>
              <textarea value={logExtraSupport} onChange={(e) => setLogExtraSupport(e.target.value)} rows={2}
                placeholder="Please help with transitions today"
                className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#2EC4A5] resize-none" />
            </div>

            {/* ── Collapsible behavior incident panel ── */}
            <button type="button"
              onClick={() => {
                if (!bOpen) { resetBehaviorForm(); }
                setBOpen((p) => !p);
              }}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-rose-50 border border-rose-100 hover:border-rose-200 transition-colors">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-rose-600">
                <AlertTriangle size={12} /> Record a behavior incident <span className="font-normal text-rose-400">(optional)</span>
              </span>
              {bOpen ? <ChevronUp size={14} className="text-rose-400" /> : <ChevronDown size={14} className="text-rose-400" />}
            </button>
            {bOpen && (
              <div className="border border-rose-100 rounded-xl p-4 bg-rose-50/40">
                {renderBehaviorForm("", () => {}, false, true)}
              </div>
            )}

            <Button onClick={() => void handlePostLog()} disabled={postingLog || !logNote.trim()}
              className="w-full bg-[#2EC4A5] hover:bg-[#26a88d] text-white text-sm">
              {postingLog ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
              {bOpen && bTypes.length > 0 && bIntensity ? "Post Update + Log Incident" : "Post Update"}
            </Button>
          </div>
        )}


        {/* ── Log feed ── */}
        {logs.length === 0 && standaloneBehaviorLogs.length === 0 ? (
          <div className="bg-white border border-dashed border-gray-200 rounded-2xl p-10 text-center">
            <div className="w-12 h-12 bg-teal-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <BookOpen size={20} className="text-teal-300" />
            </div>
            <p className="text-sm font-semibold text-gray-600">No logs yet</p>
            <p className="text-xs text-gray-400 mt-1">Post today's update above — your teacher will see it before the session.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Daily log cards (newest first) with any stitched behavior incident */}
            {[...logs].reverse().map((log) => {
              let parsed: Record<string, unknown> = {};
              try { parsed = JSON.parse(log.content) as Record<string, unknown>; } catch {}
              const goalRatings = parsed["goalRatings"] as { goalId: number; label: string; level: string }[] | undefined;
              const bcs = parsed["behaviorCounts"] as { label: string; count: number }[] | undefined;
              const durs = parsed["durations"] as { label: string; minutes: number }[] | undefined;
              const summary = log.authorRole === "teacher"
                ? String(parsed["behaviorMood"] ?? parsed["taughtToday"] ?? "")
                : String(parsed["eventsForTeacher"] ?? "");
              const attachedBehavior = behaviorByDailyLogId[log.id];
              const LEVEL_CHIP: Record<string, { label: string; cls: string }> = {
                independent:    { label: "Independent", cls: "bg-green-100 text-green-700" },
                visual_prompt:  { label: "Visual ✓",    cls: "bg-yellow-100 text-yellow-700" },
                verbal_prompt:  { label: "Verbal",      cls: "bg-amber-100 text-amber-700" },
                modeling:       { label: "Modeling",    cls: "bg-orange-100 text-orange-700" },
                physical_assist:{ label: "Physical",    cls: "bg-red-100 text-red-700" },
              };
              return (
                <div key={log.id} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm space-y-2.5">
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${log.authorRole === "teacher" ? "bg-blue-50" : "bg-teal-50"}`}>
                      <User size={12} className={log.authorRole === "teacher" ? "text-blue-500" : "text-teal-500"} />
                    </div>
                    <span className="text-xs font-bold text-[#1A2340]">{new Date(log.logDate).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</span>
                    <span className={`ml-auto text-[10px] px-2.5 py-0.5 rounded-full border font-bold ${log.authorRole === "teacher" ? "bg-blue-50 text-blue-600 border-blue-100" : "bg-teal-50 text-teal-600 border-teal-100"}`}>
                      {log.authorRole === "teacher" ? "Teacher" : "You"}
                    </span>
                  </div>
                  {summary && <p className="text-sm text-gray-600 leading-relaxed">{summary}</p>}
                  {log.authorRole === "parent" && !!parsed["extraSupportAreas"] && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">Extra support needed: {String(parsed["extraSupportAreas"])}</p>
                  )}
                  {log.authorRole === "teacher" && !!parsed["reteachAtHome"] && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">🏠 Reteach at home: {String(parsed["reteachAtHome"])}</p>
                  )}
                  {goalRatings && goalRatings.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {goalRatings.map((gr, i) => {
                        const chip = LEVEL_CHIP[gr.level] ?? { label: gr.level, cls: "bg-gray-100 text-gray-600" };
                        return (
                          <span key={i} className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${chip.cls}`}>
                            {gr.label}: {chip.label}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {bcs && bcs.filter((b) => b.count > 0).length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {bcs.filter((b) => b.count > 0).map((b, i) => <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-semibold">{b.label}: {b.count}×</span>)}
                    </div>
                  )}
                  {durs && durs.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {durs.map((d, i) => <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 font-semibold">⏱ {d.label}: {d.minutes}m</span>)}
                    </div>
                  )}
                  {!!log.signedPhotoUrl && (
                    <a href={log.signedPhotoUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-[#2EC4A5] hover:underline font-medium">
                      📷 View photo
                    </a>
                  )}
                  {/* Stitched behavior incident — same child, same day log */}
                  {attachedBehavior && <BehaviorDetail bl={attachedBehavior} />}
                </div>
              );
            })}

            {/* Standalone behavior incidents (no dailyLogId) */}
            {standaloneBehaviorLogs.map((bl) => (
              <div key={`bl-${bl.id}`} className="bg-white rounded-2xl p-4 border border-rose-100 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-xl bg-rose-50 flex items-center justify-center shrink-0">
                    <AlertTriangle size={12} className="text-rose-500" />
                  </div>
                  <span className="text-xs font-bold text-[#1A2340]">
                    {new Date(bl.occurredAt).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
                  </span>
                  <span className="ml-auto text-[10px] px-2.5 py-0.5 rounded-full border font-bold bg-rose-50 text-rose-600 border-rose-100">
                    Standalone incident
                  </span>
                </div>
                <div className="flex flex-wrap gap-1 mb-1">
                  {bl.tantrumTypes.map((t, i) => (
                    <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 font-semibold">{t}</span>
                  ))}
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold capitalize ${INTENSITY_CLASS[bl.intensity] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
                    {bl.intensity}
                  </span>
                  {bl.durationMinutes != null && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold">⏱ {bl.durationMinutes} min</span>
                  )}
                </div>
                {(bl.triggers ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1">
                    {(bl.triggers ?? []).map((t, i) => (
                      <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">⚡ {t}</span>
                    ))}
                  </div>
                )}
                {bl.strategies && bl.strategies.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {bl.strategies.map((s, i) => (
                      <span key={i} className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${OUTCOME_CLASS[s.worked] ?? "bg-gray-100 text-gray-600"}`}>
                        {s.strategy} · {OUTCOME_LABEL[s.worked] ?? s.worked}
                      </span>
                    ))}
                  </div>
                )}
                {bl.notes && <p className="text-[11px] text-gray-500 italic mt-1">{bl.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ════════════════════════════════════════════════════════
  // VIEW: GOALS
  // ════════════════════════════════════════════════════════
  if (view === "goals") {
    return (
      <div className="space-y-4">
        {active.status === "ended" && (
          <div className="flex items-center gap-2.5 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
            <CheckCircle2 size={13} className="text-gray-400 shrink-0" />
            <p className="text-xs text-gray-500 font-medium">This engagement has ended — records are read-only.</p>
          </div>
        )}
        <div className="bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(26,35,64,0.06)] space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-[#1A2340]">Goals for {active.childName ?? "your child"}</p>
              <p className="text-xs text-gray-400 mt-0.5">You set the goals — your teacher tracks progress each session.</p>
            </div>
            {active.status !== "ended" && (
              <button onClick={() => setAddingGoal(!addingGoal)}
                className="flex items-center gap-1 text-xs text-[#2EC4A5] font-semibold hover:underline shrink-0 ml-3">
                <Plus size={13} />{addingGoal ? "Cancel" : "Add Goal"}
              </button>
            )}
          </div>
          {addingGoal && active.status !== "ended" && (
            <div className="p-3 bg-gray-50 rounded-lg space-y-2">
              <input value={newGoalLabel} onChange={(e) => setNewGoalLabel(e.target.value)}
                placeholder="Goal (e.g. Writes own name)"
                className="w-full rounded-lg border border-gray-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2EC4A5]" />
              <input value={newGoalCategory} onChange={(e) => setNewGoalCategory(e.target.value)}
                placeholder="Category (optional — e.g. Writing, Math)"
                className="w-full rounded-lg border border-gray-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2EC4A5]" />
              <Button size="sm" onClick={() => void handleAddGoal()} disabled={savingGoal || !newGoalLabel.trim()}
                className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white text-xs w-full">
                {savingGoal ? <Loader2 size={12} className="animate-spin mr-1" /> : null}Add Goal
              </Button>
            </div>
          )}
          {childGoals.length === 0 ? (
            <div className="text-center py-6">
              <div className="w-10 h-10 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-2.5">
                <TrendingUp size={16} className="text-gray-300" />
              </div>
              <p className="text-xs font-semibold text-gray-500">No goals yet</p>
              <p className="text-[11px] text-gray-400 mt-0.5">Tap "Add Goal" to create the first one.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {childGoals.map((g) => (
                <div key={g.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                  <div className={`w-1.5 h-8 rounded-full shrink-0 ${g.isActive ? "bg-teal-400" : "bg-gray-200"}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold truncate ${g.isActive ? "text-[#1A2340]" : "text-gray-400 line-through"}`}>{g.label}</p>
                    {g.category && <p className="text-[11px] text-gray-400 mt-0.5">{g.category}</p>}
                  </div>
                  {active.status !== "ended" ? (
                    <button onClick={() => void handleToggleParentGoal(g.id, g.isActive)}
                      className={`shrink-0 text-[10px] px-2.5 py-1 rounded-full font-bold border transition-all ${g.isActive ? "bg-green-50 text-green-600 border-green-200 hover:bg-red-50 hover:text-red-500 hover:border-red-200" : "bg-gray-100 text-gray-400 border-gray-200 hover:bg-green-50 hover:text-green-600 hover:border-green-200"}`}>
                      {g.isActive ? "Active" : "Inactive"}
                    </button>
                  ) : (
                    <span className={`shrink-0 text-[10px] px-2.5 py-1 rounded-full font-bold border ${g.isActive ? "bg-green-50 text-green-600 border-green-200" : "bg-gray-100 text-gray-400 border-gray-200"}`}>
                      {g.isActive ? "Active" : "Inactive"}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════
  // VIEW: TRENDS
  // ════════════════════════════════════════════════════════
  return (
    hasPtTrendData ? (
      <div className="space-y-4">
        {ptGoalEntries.map(([gid, { label, pts }]) => {
          const trend = pts.length > 1 ? pts[pts.length - 1].rank - pts[0].rank : 0;
          return (
            <div key={gid} className="bg-white rounded-xl p-4 shadow-[0_2px_12px_rgba(26,35,64,0.06)]">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-bold text-[#1A2340]">{label}</p>
                {pts.length > 1 && <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${trend > 0 ? "bg-green-100 text-green-700" : trend < 0 ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-500"}`}>{trend > 0 ? "↑ Improving" : trend < 0 ? "↓ More support" : "Steady"}</span>}
              </div>
              <div className="flex items-end gap-1.5 overflow-x-auto pb-1" style={{ minHeight: 52 }}>
                {pts.map((pt, i) => (
                  <div key={i} className="flex flex-col items-center gap-0.5 shrink-0">
                    <div className={`w-7 rounded-sm ${P_BG[pt.level] ?? "bg-gray-300"}`} style={{ height: `${(pt.rank / 5) * 40}px` }} />
                    <span className="text-[9px] text-gray-400">{pt.date}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[9px] text-gray-300">← needs support</span>
                <span className="text-[9px] text-gray-300">independent →</span>
              </div>
            </div>
          );
        })}
        {ptBehavEntries.map(([bLabel, pts]) => {
          const maxC = Math.max(...pts.map((p) => p.count), 1);
          return (
            <div key={bLabel} className="bg-white rounded-xl p-4 shadow-[0_2px_12px_rgba(26,35,64,0.06)]">
              <p className="text-sm font-bold text-[#1A2340] mb-3">{bLabel} <span className="text-xs font-normal text-gray-400">incidents</span></p>
              <div className="flex items-end gap-1.5 overflow-x-auto pb-1" style={{ minHeight: 52 }}>
                {pts.map((pt, i) => (
                  <div key={i} className="flex flex-col items-center gap-0.5 shrink-0">
                    <span className="text-[9px] text-gray-500 font-medium">{pt.count}</span>
                    <div className="w-7 bg-amber-400 rounded-sm" style={{ height: `${Math.max((pt.count / maxC) * 40, 3)}px` }} />
                    <span className="text-[9px] text-gray-400">{pt.date}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {ptDurData.length > 0 && (
          <div className="bg-white rounded-xl p-4 shadow-[0_2px_12px_rgba(26,35,64,0.06)]">
            <p className="text-sm font-bold text-[#1A2340] mb-3">Focus duration <span className="text-xs font-normal text-gray-400">min</span></p>
            <div className="flex items-end gap-1.5 overflow-x-auto pb-1" style={{ minHeight: 52 }}>
              {ptDurData.map((pt, i) => (
                <div key={i} className="flex flex-col items-center gap-0.5 shrink-0">
                  <span className="text-[9px] text-gray-500 font-medium">{pt.minutes}</span>
                  <div className="w-7 bg-teal-400 rounded-sm" style={{ height: `${Math.max((pt.minutes / ptMaxMins) * 40, 3)}px` }} />
                  <span className="text-[9px] text-gray-400">{pt.date}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    ) : (
      <div className="bg-white border border-dashed border-gray-200 rounded-2xl p-12 text-center">
        <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
          <TrendingUp size={20} className="text-gray-300" />
        </div>
        <p className="text-sm font-semibold text-gray-600">No trend data yet</p>
        <p className="text-xs text-gray-400 mt-1">Charts will appear as your teacher logs goal ratings each session.</p>
      </div>
    )
  );
}
