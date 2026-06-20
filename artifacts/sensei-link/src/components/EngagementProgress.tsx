import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Loader2, BookOpen, User, TrendingUp, Plus, CheckCircle2 } from "lucide-react";

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

const MOODS = ["😊 Great", "🙂 Good", "😐 Okay", "😔 Difficult"];
const P_RANK: Record<string, number> = { independent: 5, visual_prompt: 4, verbal_prompt: 3, modeling: 2, physical_assist: 1 };
const P_BG: Record<string, string> = { independent: "bg-green-400", visual_prompt: "bg-yellow-400", verbal_prompt: "bg-amber-400", modeling: "bg-orange-400", physical_assist: "bg-red-400" };

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

  const [logNote, setLogNote] = useState("");
  const [logExtraSupport, setLogExtraSupport] = useState("");
  const [logMood, setLogMood] = useState("");
  const [postingLog, setPostingLog] = useState(false);
  const [addingGoal, setAddingGoal] = useState(false);
  const [newGoalLabel, setNewGoalLabel] = useState("");
  const [newGoalCategory, setNewGoalCategory] = useState("");
  const [savingGoal, setSavingGoal] = useState(false);

  async function handlePostLog() {
    if (!logNote.trim()) return;
    setPostingLog(true);
    try {
      await fetchWithAuth(`/api/engagements/${active.id}/daily-logs`, {
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
      queryClient.invalidateQueries({ queryKey: ["engagement-logs", active.id] });
      setLogNote(""); setLogExtraSupport(""); setLogMood("");
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

  // ── Trend preprocessing (teacher logs only) ──
  const _ptLogs = [...logs].filter(l => l.authorRole === "teacher").sort((a, b) => a.logDate.localeCompare(b.logDate)).map(l => { let c: Record<string, unknown> = {}; try { c = JSON.parse(l.content) as Record<string, unknown>; } catch {} return { date: l.logDate.slice(5), c }; });
  const ptGoalMap: Record<string, { label: string; pts: { date: string; rank: number; level: string }[] }> = {};
  _ptLogs.forEach(({ date, c }) => { ((c["goalRatings"] as { goalId: number; label: string; level: string }[] | undefined) ?? []).forEach(gr => { const k = String(gr.goalId); if (!ptGoalMap[k]) ptGoalMap[k] = { label: gr.label, pts: [] }; ptGoalMap[k].pts.push({ date, rank: P_RANK[gr.level] ?? 3, level: gr.level }); }); });
  const ptBehavMap: Record<string, { date: string; count: number }[]> = {};
  _ptLogs.forEach(({ date, c }) => { ((c["behaviorCounts"] as { label: string; count: number }[] | undefined) ?? []).filter(b => b.count > 0).forEach(b => { if (!ptBehavMap[b.label]) ptBehavMap[b.label] = []; ptBehavMap[b.label].push({ date, count: b.count }); }); });
  const ptDurData = _ptLogs.flatMap(({ date, c }) => { const tot = ((c["durations"] as { label: string; minutes: number }[] | undefined) ?? []).reduce((s, d) => s + d.minutes, 0); return tot > 0 ? [{ date, minutes: tot }] : []; });
  const ptGoalEntries = Object.entries(ptGoalMap);
  const ptBehavEntries = Object.entries(ptBehavMap);
  const hasPtTrendData = ptGoalEntries.length > 0 || ptBehavEntries.length > 0 || ptDurData.length > 0;
  const ptMaxMins = ptDurData.length > 0 ? Math.max(...ptDurData.map(d => d.minutes), 1) : 1;

  if (view === "logs") {
    return (
      <div className="space-y-4">
        {active.status === "ended" && (
          <div className="flex items-center gap-2.5 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
            <CheckCircle2 size={13} className="text-gray-400 shrink-0" />
            <p className="text-xs text-gray-500 font-medium">This engagement has ended — records are read-only.</p>
          </div>
        )}
        {active.status !== "ended" && (
          <div className="bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(26,35,64,0.06)] space-y-3">
            <div>
              <p className="text-sm font-bold text-[#1A2340]">Today's Update</p>
              <p className="text-xs text-gray-400 mt-0.5">Anything the teacher should know today?</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-2">Child's mood at home today <span className="text-gray-400">(optional)</span></p>
              <div className="flex gap-2 flex-wrap">
                {MOODS.map(m => (
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
            <Button onClick={handlePostLog} disabled={postingLog || !logNote.trim()}
              className="w-full bg-[#2EC4A5] hover:bg-[#26a88d] text-white text-sm">
              {postingLog ? <Loader2 size={14} className="animate-spin mr-1" /> : null}Post Update
            </Button>
          </div>
        )}
        {logs.length === 0 ? (
          <div className="bg-white border border-dashed border-gray-200 rounded-2xl p-10 text-center">
            <div className="w-12 h-12 bg-teal-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <BookOpen size={20} className="text-teal-300" />
            </div>
            <p className="text-sm font-semibold text-gray-600">No logs yet</p>
            <p className="text-xs text-gray-400 mt-1">Post today's update above — your teacher will see it before the session.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {[...logs].reverse().map(log => {
              let parsed: Record<string, unknown> = {};
              try { parsed = JSON.parse(log.content) as Record<string, unknown>; } catch {}
              const goalRatings = parsed["goalRatings"] as { goalId: number; label: string; level: string }[] | undefined;
              const bcs = parsed["behaviorCounts"] as { label: string; count: number }[] | undefined;
              const durs = parsed["durations"] as { label: string; minutes: number }[] | undefined;
              const summary = log.authorRole === "teacher"
                ? String(parsed["behaviorMood"] ?? parsed["taughtToday"] ?? "")
                : String(parsed["eventsForTeacher"] ?? "");
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
                  {bcs && bcs.filter(b => b.count > 0).length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {bcs.filter(b => b.count > 0).map((b, i) => <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-semibold">{b.label}: {b.count}×</span>)}
                    </div>
                  )}
                  {durs && durs.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {durs.map((d, i) => <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 font-semibold">⏱ {d.label}: {d.minutes}m</span>)}
                    </div>
                  )}
                  {!!log.signedPhotoUrl && (
                    <a
                      href={log.signedPhotoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-[#2EC4A5] hover:underline font-medium"
                    >
                      📷 View photo
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

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
              <input value={newGoalLabel} onChange={e => setNewGoalLabel(e.target.value)}
                placeholder="Goal (e.g. Writes own name)"
                className="w-full rounded-lg border border-gray-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2EC4A5]" />
              <input value={newGoalCategory} onChange={e => setNewGoalCategory(e.target.value)}
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
              {childGoals.map(g => (
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

  // view === "trends"
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
          const maxC = Math.max(...pts.map(p => p.count), 1);
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
