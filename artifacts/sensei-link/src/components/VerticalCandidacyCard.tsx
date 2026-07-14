/**
 * VerticalCandidacyCard — professional-facing candidacy card for the tutor
 * and therapist verticals (Part B). Mirrors professional-dashboard.tsx's
 * shadow-teacher CandidacyCard/RespondRequestBlock/TeacherInterviewSection/
 * TeacherTrialAcceptSection shape, parameterized by vertical instead of
 * duplicated, matching the convention already established in
 * VerticalRequestWidget.tsx (the parent-facing counterpart).
 *
 * No chat/"Open Chat" footer here — unlike shadow-teacher's CandidacyCard,
 * GET /tutor|therapist/my-candidacies returns no messageCount field, so
 * there's no messaging surface to link to for these verticals.
 *
 * Does NOT touch professional-dashboard.tsx's existing CandidacyCard or any
 * shadow-teacher route.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { fetchWithAuth } from "@/lib/api";
import { Loader2, Check, XCircle, Video, ClipboardCheck } from "lucide-react";
import type { Vertical } from "./VerticalRequestWidget";

const API_BASE: Record<Vertical, string> = { tutor: "/api/tutor", therapist: "/api/therapist" };

interface InterviewSlot {
  date: string;
  time: string;
  label?: string;
}

export interface VerticalCandidacy {
  candidateId: number;
  matchId: number;
  matchStatus: string;
  selectedProfessionalId: number | null;
  childAge: number | null;
  budgetMinInr: number | null;
  budgetMaxInr: number | null;
  requestStatus: string;
  rejectionNote: string | null;
  interviewSlotsJson: string | null;
  interviewConfirmedSlot: string | null;
  meetLink: string | null;
  interviewDoneAt: string | null;
  trialDaysRequested: number | null;
  trialDaysAccepted: number | null;
  trialMeetLink?: string | null;
  // tutor-only
  subjects?: string[] | null;
  board?: string | null;
  mode?: string[] | null;
  locationArea?: string | null;
  // therapist-only
  diagnosedConditions?: string[] | null;
  disciplineNeeded?: string | null;
  sessionModePreference?: string[] | null;
  wantsAssessmentFirst?: boolean | null;
  assessmentCompleted?: boolean | null;
  assessmentDoneAt?: string | null;
  assessmentFeePaymentId?: string | null;
}

function RespondRequestBlock({ vertical, candidacy: c, onUpdated }: { vertical: Vertical; candidacy: VerticalCandidacy; onUpdated: () => void }) {
  const { toast } = useToast();
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineNote, setDeclineNote] = useState("");
  const [responding, setResponding] = useState(false);

  if (c.requestStatus !== "sent") return null;

  async function respond(action: "accept" | "reject") {
    setResponding(true);
    try {
      const res = await fetchWithAuth(`${API_BASE[vertical]}/${c.matchId}/candidates/${c.candidateId}/respond-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: action === "reject" ? (declineNote.trim() || undefined) : undefined }),
      });
      if (!res.ok) { const e = await res.json() as { error?: string }; toast({ title: e.error ?? "Could not respond", variant: "destructive" }); return; }
      setDeclineOpen(false);
      onUpdated();
    } finally { setResponding(false); }
  }

  return (
    <div className="mb-3 p-4 bg-blue-50 border border-blue-200 rounded-xl space-y-3">
      <p className="text-sm font-bold text-blue-900">Request</p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-blue-800">
        {c.locationArea && <span>📍 {c.locationArea}</span>}
        {(c.budgetMinInr || c.budgetMaxInr) && (
          <span>💰 ₹{c.budgetMinInr?.toLocaleString("en-IN") ?? "?"} – ₹{c.budgetMaxInr?.toLocaleString("en-IN") ?? "?"}/mo</span>
        )}
        {c.mode && c.mode.length > 0 && <span>🎓 {c.mode.join(", ")}</span>}
        {c.sessionModePreference && c.sessionModePreference.length > 0 && <span>🎓 {c.sessionModePreference.join(", ")}</span>}
        {c.diagnosedConditions && c.diagnosedConditions.length > 0 && <span className="col-span-2">🏥 {c.diagnosedConditions.join(", ")}</span>}
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => void respond("accept")}
          disabled={responding}
          className="flex-1 bg-green-600 hover:bg-green-700 text-white text-xs h-8 rounded-xl"
        >
          {responding ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} className="mr-1" />}
          Accept
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setDeclineOpen(true)}
          disabled={responding}
          className="flex-1 border-red-200 text-red-600 hover:bg-red-50 text-xs h-8 rounded-xl"
        >
          <XCircle size={12} className="mr-1" />
          Decline
        </Button>
      </div>

      <Dialog open={declineOpen} onOpenChange={setDeclineOpen}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-[#1A2340]">Decline Request</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <Label className="text-xs font-semibold text-gray-600">
              Reason <span className="font-normal text-gray-400">(optional, shown to the parent)</span>
            </Label>
            <Textarea
              rows={3}
              maxLength={500}
              value={declineNote}
              onChange={(e) => setDeclineNote(e.target.value)}
              placeholder="e.g. Not available for this location right now"
              className="text-sm rounded-xl resize-none"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => setDeclineOpen(false)}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white rounded-xl"
              disabled={responding}
              onClick={() => void respond("reject")}
            >
              {responding ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
              Confirm Decline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InterviewSection({ vertical, candidacy: c, onUpdated }: { vertical: Vertical; candidacy: VerticalCandidacy; onUpdated: () => void }) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  if (c.requestStatus !== "accepted") return null;

  let proposedSlots: InterviewSlot[] = [];
  if (c.interviewSlotsJson) {
    try { proposedSlots = JSON.parse(c.interviewSlotsJson) as InterviewSlot[]; } catch { /* ignore malformed */ }
  }

  async function confirmSlot() {
    if (!selectedSlot) return;
    setConfirming(true);
    try {
      const res = await fetchWithAuth(`${API_BASE[vertical]}/${c.matchId}/candidates/${c.candidateId}/confirm-interview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmedSlot: selectedSlot }),
      });
      if (!res.ok) { const e = await res.json() as { error?: string }; toast({ title: e.error ?? "Could not confirm interview", variant: "destructive" }); return; }
      onUpdated();
    } finally { setConfirming(false); }
  }

  if (c.interviewConfirmedSlot) {
    return (
      <div className="mb-3 p-4 bg-teal-50 border border-teal-200 rounded-xl space-y-2">
        <p className="text-sm font-bold text-teal-900">Interview scheduled for {c.interviewConfirmedSlot}</p>
        {c.meetLink && (
          <a
            href={c.meetLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 w-full h-9 rounded-lg bg-[#2EC4A5] hover:bg-[#26a88d] text-white font-semibold text-xs no-underline"
          >
            <Video size={13} />
            Join Interview
          </a>
        )}
      </div>
    );
  }

  if (proposedSlots.length === 0) {
    return (
      <div className="mb-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
        <p className="text-xs font-semibold text-amber-800">Waiting for parent to propose interview times</p>
      </div>
    );
  }

  return (
    <div className="mb-3 p-4 bg-purple-50 border border-purple-200 rounded-xl space-y-2">
      <p className="text-sm font-bold text-purple-900">Choose an interview slot</p>
      <div className="space-y-1.5">
        {proposedSlots.map((s, i) => {
          const key = `${s.date}T${s.time}`;
          const isChosen = selectedSlot === key;
          return (
            <button
              key={i}
              onClick={() => setSelectedSlot(key)}
              className={`w-full text-left text-xs px-3 py-2 rounded-lg border ${isChosen ? "bg-purple-600 text-white border-purple-600" : "bg-white text-purple-800 border-purple-200"}`}
            >
              {s.label ? `${s.label} — ` : ""}{s.date} at {s.time}
            </button>
          );
        })}
      </div>
      <Button
        size="sm"
        onClick={() => void confirmSlot()}
        disabled={!selectedSlot || confirming}
        className="w-full bg-purple-600 hover:bg-purple-700 text-white text-xs h-8 rounded-xl"
      >
        {confirming ? <Loader2 size={12} className="animate-spin mr-1" /> : null}
        Confirm Slot
      </Button>
    </div>
  );
}

function AssessmentSection({ vertical, candidacy: c, onUpdated }: { vertical: Vertical; candidacy: VerticalCandidacy; onUpdated: () => void }) {
  const { toast } = useToast();
  const [marking, setMarking] = useState(false);

  // Therapist-only, and only relevant once the parent opted for an
  // assessment-first flow. Gated on assessmentFeePaymentId (not just
  // wantsAssessmentFirst) so the button never appears before the backend
  // would actually allow it — /mark-assessment-done 409s otherwise.
  if (vertical !== "therapist" || !c.wantsAssessmentFirst) return null;

  if (c.assessmentCompleted) {
    return (
      <div className="mb-3 p-4 bg-green-50 border border-green-200 rounded-xl">
        <p className="text-xs font-semibold text-green-800">✓ Assessment marked complete</p>
      </div>
    );
  }

  if (!c.assessmentFeePaymentId) {
    return (
      <div className="mb-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
        <p className="text-xs font-semibold text-amber-800">Waiting for the parent to pay the assessment fee</p>
      </div>
    );
  }

  async function markDone() {
    setMarking(true);
    try {
      const res = await fetchWithAuth(`${API_BASE[vertical]}/${c.matchId}/candidates/${c.candidateId}/mark-assessment-done`, { method: "POST" });
      if (!res.ok) { const e = await res.json() as { error?: string }; toast({ title: e.error ?? "Could not mark assessment done", variant: "destructive" }); return; }
      onUpdated();
    } finally { setMarking(false); }
  }

  return (
    <div className="mb-3 p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-2">
      <p className="text-sm font-bold text-indigo-900">Assessment fee received</p>
      <Button
        size="sm"
        onClick={() => void markDone()}
        disabled={marking}
        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-xs h-8 rounded-xl"
      >
        {marking ? <Loader2 size={12} className="animate-spin mr-1" /> : <ClipboardCheck size={12} className="mr-1" />}
        Mark Assessment Done
      </Button>
    </div>
  );
}

function TrialAcceptSection({ vertical, candidacy: c, onUpdated }: { vertical: Vertical; candidacy: VerticalCandidacy; onUpdated: () => void }) {
  const { toast } = useToast();
  const [trialDays, setTrialDays] = useState(1);
  const [accepting, setAccepting] = useState(false);

  if (c.trialDaysRequested == null || c.trialDaysAccepted != null) return null;

  async function acceptTrial() {
    setAccepting(true);
    try {
      const res = await fetchWithAuth(`${API_BASE[vertical]}/${c.matchId}/candidates/${c.candidateId}/accept-trial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trialDays }),
      });
      if (!res.ok) { const e = await res.json() as { error?: string }; toast({ title: e.error ?? "Could not accept trial", variant: "destructive" }); return; }
      onUpdated();
    } finally { setAccepting(false); }
  }

  return (
    <div className="mb-3 p-4 bg-orange-50 border border-orange-200 rounded-xl space-y-2">
      <p className="text-sm font-bold text-orange-900">
        Parent wants a {c.trialDaysRequested}-day trial. How many days can you offer?
      </p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          max={c.trialDaysRequested}
          value={trialDays}
          onChange={(e) => setTrialDays(Math.max(1, Math.min(c.trialDaysRequested!, parseInt(e.target.value || "1", 10))))}
          className="w-20 text-sm border border-orange-200 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-orange-400 bg-white"
        />
        <Button
          size="sm"
          onClick={() => void acceptTrial()}
          disabled={accepting}
          className="flex-1 bg-orange-500 hover:bg-orange-600 text-white text-xs h-9 rounded-xl"
        >
          {accepting ? <Loader2 size={12} className="animate-spin mr-1" /> : null}
          Confirm Trial Days
        </Button>
      </div>
    </div>
  );
}

function TrialJoinSection({ candidacy: c }: { candidacy: VerticalCandidacy }) {
  if (!c.trialMeetLink) return null;
  if (c.matchStatus !== "trial_pending" && c.matchStatus !== "trial_started") return null;

  return (
    <div className="mb-3 p-4 bg-teal-50 border border-teal-200 rounded-xl space-y-2">
      <p className="text-sm font-bold text-teal-900">Trial video link</p>
      <a
        href={c.trialMeetLink}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-1.5 w-full h-9 rounded-lg bg-[#2EC4A5] hover:bg-[#26a88d] text-white font-semibold text-xs no-underline"
      >
        <Video size={13} />
        Join Trial Call
      </a>
    </div>
  );
}

const MATCH_STATUS_LABEL: Record<string, string> = {
  shortlisted: "Shortlisted",
  pending_commitment: "Pending commitment",
  committed: "Committed",
  trial_pending: "Trial pending",
  trial_started: "Trial in progress",
  trial_done: "Trial complete",
};

export function VerticalCandidacyCard({ vertical, candidacy: c, onUpdated }: { vertical: Vertical; candidacy: VerticalCandidacy; onUpdated: () => void }) {
  const isSelected = c.selectedProfessionalId !== null;

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-[0_4px_24px_rgba(26,35,64,0.06)]">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex flex-wrap gap-1.5 flex-1">
          {vertical === "tutor" && c.subjects && c.subjects.length > 0 && c.subjects.map((s) => (
            <span key={s} className="text-xs bg-[#2EC4A5]/10 text-[#2EC4A5] px-2 py-0.5 rounded-full font-medium">{s}</span>
          ))}
          {vertical === "therapist" && c.disciplineNeeded && (
            <span className="text-xs bg-[#2EC4A5]/10 text-[#2EC4A5] px-2 py-0.5 rounded-full font-medium">{c.disciplineNeeded.replace(/_/g, " ")}</span>
          )}
        </div>
        <span className="shrink-0 text-[10px] font-semibold px-2.5 py-0.5 rounded-full border bg-gray-50 text-gray-500 border-gray-200">
          {isSelected ? "✓ You were selected" : (MATCH_STATUS_LABEL[c.matchStatus] ?? c.matchStatus)}
        </span>
      </div>

      <RespondRequestBlock vertical={vertical} candidacy={c} onUpdated={onUpdated} />
      <InterviewSection vertical={vertical} candidacy={c} onUpdated={onUpdated} />
      {vertical === "therapist" && isSelected && <AssessmentSection vertical={vertical} candidacy={c} onUpdated={onUpdated} />}
      <TrialAcceptSection vertical={vertical} candidacy={c} onUpdated={onUpdated} />
      <TrialJoinSection candidacy={c} />
    </div>
  );
}
