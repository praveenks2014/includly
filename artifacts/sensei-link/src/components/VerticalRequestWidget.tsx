/**
 * VerticalRequestWidget — shared parent-facing request→interview→trial→commit
 * flow for the tutor and therapist verticals (B6).
 *
 * Structurally mirrors ShadowTeacherRequestWidget.tsx (request → candidates →
 * interview → trial → commit state machine, Razorpay wiring, UpiPayQRDialog
 * reuse) but is ONE parameterized component instead of two ~2000-line
 * near-duplicates, since tutor and therapist share ~90% of this shape. No
 * negotiation UI (rates are display-and-accept for both verticals, per spec)
 * — that alone removes the largest chunk of shadow-teacher's own file.
 *
 * Does NOT touch ShadowTeacherRequestWidget.tsx or any shadow-teacher route.
 */
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { fetchWithAuth, getApiBase } from "@/lib/api";
import { loadRazorpayScript, type RazorpayPaymentResponse } from "@/lib/razorpay";
import { useSelectedChild } from "@/contexts/SelectedChildContext";
import { AntiBypassNotice } from "./AntiBypassNotice";
import { UpiPayQRDialog } from "./UpiPayQRDialog";
import { ReviewModal } from "./ReviewModal";
import {
  Loader2, CheckCircle2, IndianRupee, MapPin, Star, Languages,
  ChevronRight, BadgeCheck, ShieldCheck, Send, Video, XCircle, CalendarClock, ClipboardCheck,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGetMe } from "@workspace/api-client-react";

export type Vertical = "tutor" | "therapist";

interface VerticalConfig {
  vertical: Vertical;
  apiBase: string; // "/api/tutor" | "/api/therapist"
  professionalLabel: string; // "tutor" | "therapist"
  professionalLabelCap: string; // "Tutor" | "Therapist"
  antiBypassBenefits: string[];
}

const CONFIGS: Record<Vertical, VerticalConfig> = {
  tutor: {
    vertical: "tutor",
    apiBase: "/api/tutor",
    professionalLabel: "tutor",
    professionalLabelCap: "Tutor",
    antiBypassBenefits: [
      "Session attendance tracking",
      "Your tutor reserved for you — they can't be matched with other Includly parents while engaged with you",
      "Dispute mediation and replacement support if things don't work out",
    ],
  },
  therapist: {
    vertical: "therapist",
    apiBase: "/api/therapist",
    professionalLabel: "therapist",
    professionalLabelCap: "Therapist",
    antiBypassBenefits: [
      "Session attendance tracking",
      "Your therapist reserved for you — they can't be matched with other Includly parents while engaged with you",
      "Dispute mediation and replacement support if things don't work out",
    ],
  },
};

interface Child {
  id: number;
  name: string;
  city: string | null;
}

interface CandidateProfile {
  fullName?: string | null;
  bio: string | null;
  yearsExperience: number;
  city: string | null;
  displayArea: string | null;
  verificationStatus: string;
  averageRating: number | null;
  pricingMinINR: number | null;
  pricingMaxINR: number | null;
  languages: string[] | null;
  offersHomeVisits: boolean;
  rciVerified?: boolean | null; // therapist only
}

interface InterviewSlot {
  date: string;
  time: string;
  label?: string;
}

interface Candidate {
  id: number;
  professionalId: number;
  rank: number;
  score: number | null;
  requestStatus: string;
  rejectionNote: string | null;
  interviewSlotsJson: string | null;
  interviewConfirmedSlot: string | null;
  meetLink: string | null;
  interviewDoneAt: string | null;
  trialDaysRequested: number | null;
  trialDaysAccepted: number | null;
  assessmentCompleted?: boolean; // therapist only
  assessmentDoneAt?: string | null; // therapist only
  profile: CandidateProfile;
}

interface MatchWithCandidates {
  id: number;
  status: string;
  matchingFeeInr: number;
  selectedProfessionalId: number | null;
  childId: number | null;
  trialStartOtp: string | null;
  trialEndOtp: string | null;
  trialDays: number | null;
  trialMeetLink?: string | null;
  trialDirectPay: boolean | null;
  wantsAssessmentFirst?: boolean; // therapist only
  assessmentFeePaymentId?: string | null; // therapist only
  assessmentFeeOrderId?: string | null; // therapist only
  candidates: Candidate[];
}

interface PricingResponse {
  matchingFeeInr: number;
  trialFeeInr: number;
  placementFeeInr: number;
  assessmentFeeInr?: number;
}

function useMyMatch(cfg: VerticalConfig, childId: number | null) {
  return useQuery<MatchWithCandidates | null>({
    queryKey: [`${cfg.vertical}-my-request`, childId],
    queryFn: async () => {
      const url = childId ? `${cfg.apiBase}/my-request?childId=${childId}` : `${cfg.apiBase}/my-request`;
      const res = await fetchWithAuth(url);
      const data = (await res.json()) as MatchWithCandidates | null;
      if (Array.isArray(data) && data.length === 0) return null;
      return (data as MatchWithCandidates) ?? null;
    },
    staleTime: 20_000,
    refetchInterval: 30_000,
    enabled: childId !== null,
  });
}

function useChildren() {
  return useQuery<Child[]>({
    queryKey: ["/children"],
    queryFn: async () => {
      const res = await fetchWithAuth(`${getApiBase()}/children`);
      if (!res.ok) return [];
      return res.json() as Promise<Child[]>;
    },
    staleTime: 60_000,
  });
}

function usePricing(cfg: VerticalConfig) {
  return useQuery<PricingResponse>({
    queryKey: [`${cfg.vertical}-pricing`],
    queryFn: () => fetch(`${getApiBase()}${cfg.apiBase.replace("/api", "")}/pricing`).then((r) => r.json() as Promise<PricingResponse>),
    staleTime: 5 * 60_000,
  });
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return null;
  const color = score >= 70 ? "bg-green-100 text-green-700" : score >= 45 ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-500";
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${color}`}>{Math.round(score)}/100</span>;
}

// ── SendRequestBlock ───────────────────────────────────────────────────────
function SendRequestBlock({ cfg, matchId, candidate }: { cfg: VerticalConfig; matchId: number; candidate: Candidate }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sending, setSending] = useState(false);

  async function sendRequest() {
    setSending(true);
    try {
      const res = await fetchWithAuth(`${cfg.apiBase}/${matchId}/candidates/${candidate.id}/send-request`, { method: "POST" });
      if (!res.ok) {
        const e = (await res.json()) as { error?: string };
        toast({ title: e.error ?? "Could not send request", variant: "destructive" });
        return;
      }
      queryClient.invalidateQueries({ queryKey: [`${cfg.vertical}-my-request`] });
    } finally {
      setSending(false);
    }
  }

  if (candidate.requestStatus === "not_sent") {
    return (
      <button
        onClick={() => void sendRequest()}
        disabled={sending}
        className="w-full flex items-center justify-center gap-1.5 text-xs bg-[#2EC4A5] text-white rounded-xl py-2 font-semibold hover:bg-[#26a88d] disabled:opacity-50"
      >
        {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
        Send Request
      </button>
    );
  }
  if (candidate.requestStatus === "sent") {
    return <div className="w-full text-center text-xs font-semibold px-2.5 py-2 rounded-xl bg-amber-50 text-amber-700 border border-amber-200">Request Sent – Awaiting Response</div>;
  }
  if (candidate.requestStatus === "accepted") {
    return <div className="w-full text-center text-xs font-semibold px-2.5 py-2 rounded-xl bg-green-50 text-green-700 border border-green-200">Accepted ✓</div>;
  }
  if (candidate.requestStatus === "rejected") {
    return (
      <div className="w-full text-xs px-2.5 py-2 rounded-xl bg-red-50 text-red-700 border border-red-200 space-y-0.5">
        <p className="font-semibold text-center">Declined</p>
        {candidate.rejectionNote && <p className="text-[11px] text-red-600">{candidate.rejectionNote}</p>}
      </div>
    );
  }
  return null;
}

// ── InterviewSection ────────────────────────────────────────────────────────
function InterviewSection({ cfg, matchId, candidate }: { cfg: VerticalConfig; matchId: number; candidate: Candidate }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [slots, setSlots] = useState<InterviewSlot[]>([{ date: "", time: "", label: "" }]);
  const [proposing, setProposing] = useState(false);
  const [markingDone, setMarkingDone] = useState(false);

  if (candidate.requestStatus !== "accepted") return null;

  function updateSlot(i: number, field: keyof InterviewSlot, value: string) {
    setSlots((prev) => prev.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)));
  }
  function addSlot() {
    setSlots((prev) => (prev.length < 3 ? [...prev, { date: "", time: "", label: "" }] : prev));
  }
  function removeSlot(i: number) {
    setSlots((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function proposeInterview() {
    const validSlots = slots.filter((s) => s.date && s.time);
    if (validSlots.length === 0) {
      toast({ title: "Add at least one date and time", variant: "destructive" });
      return;
    }
    setProposing(true);
    try {
      const res = await fetchWithAuth(`${cfg.apiBase}/${matchId}/candidates/${candidate.id}/propose-interview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slots: validSlots.map((s) => ({ date: s.date, time: s.time, label: s.label || undefined })) }),
      });
      if (!res.ok) {
        const e = (await res.json()) as { error?: string };
        toast({ title: e.error ?? "Could not propose slots", variant: "destructive" });
        return;
      }
      setDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: [`${cfg.vertical}-my-request`] });
    } finally {
      setProposing(false);
    }
  }

  async function markDone() {
    setMarkingDone(true);
    try {
      const res = await fetchWithAuth(`${cfg.apiBase}/${matchId}/candidates/${candidate.id}/mark-interview-done`, { method: "POST" });
      if (!res.ok) {
        const e = (await res.json()) as { error?: string };
        toast({ title: e.error ?? "Could not mark interview done", variant: "destructive" });
        return;
      }
      queryClient.invalidateQueries({ queryKey: [`${cfg.vertical}-my-request`] });
    } finally {
      setMarkingDone(false);
    }
  }

  let proposedSlots: InterviewSlot[] = [];
  if (candidate.interviewSlotsJson) {
    try {
      proposedSlots = JSON.parse(candidate.interviewSlotsJson) as InterviewSlot[];
    } catch {
      /* ignore malformed */
    }
  }

  return (
    <div className="border-t border-gray-100 pt-3 space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Interview</p>
      {candidate.interviewDoneAt ? (
        <div className="w-full text-center text-xs font-semibold px-2.5 py-2 rounded-xl bg-green-50 text-green-700 border border-green-200">Interview Complete ✓</div>
      ) : candidate.interviewConfirmedSlot ? (
        <div className="space-y-2">
          <div className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800 space-y-1">
            <p className="font-semibold">Confirmed: {candidate.interviewConfirmedSlot}</p>
            {candidate.meetLink && (
              <a href={candidate.meetLink} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1.5 w-full h-9 rounded-lg bg-[#2EC4A5] hover:bg-[#26a88d] text-white font-semibold text-xs no-underline mt-1">
                <Video size={13} />
                Join Interview
              </a>
            )}
          </div>
          <button onClick={() => void markDone()} disabled={markingDone} className="w-full flex items-center justify-center gap-1.5 text-xs bg-[#1A2340] text-white rounded-xl py-2 font-semibold hover:bg-[#2a3660] disabled:opacity-50">
            {markingDone ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            Mark Interview Done
          </button>
        </div>
      ) : candidate.interviewSlotsJson ? (
        <div className="space-y-1.5">
          <div className="w-full text-center text-xs font-semibold px-2.5 py-2 rounded-xl bg-amber-50 text-amber-700 border border-amber-200">Awaiting {cfg.professionalLabel}&apos;s confirmation…</div>
          <button onClick={() => { setSlots(proposedSlots.length > 0 ? proposedSlots : [{ date: "", time: "", label: "" }]); setDialogOpen(true); }} className="w-full text-[11px] text-gray-500 hover:text-[#2EC4A5] underline underline-offset-2">
            Propose different slots
          </button>
        </div>
      ) : (
        <button onClick={() => setDialogOpen(true)} className="w-full flex items-center justify-center gap-1.5 text-xs bg-[#2EC4A5] text-white rounded-xl py-2 font-semibold hover:bg-[#26a88d]">
          <CalendarClock size={13} />
          Schedule Interview
        </button>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-[#1A2340]">Propose Interview Slots</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-gray-500">Suggest up to 3 date/time options. The {cfg.professionalLabel} will confirm one.</p>
            {slots.map((slot, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input type="date" value={slot.date} onChange={(e) => updateSlot(i, "date", e.target.value)} className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-[#2EC4A5]" />
                <input type="time" value={slot.time} onChange={(e) => updateSlot(i, "time", e.target.value)} className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-[#2EC4A5]" />
                {slots.length > 1 && (
                  <button onClick={() => removeSlot(i)} className="text-gray-300 hover:text-red-500 shrink-0">
                    <XCircle size={16} />
                  </button>
                )}
              </div>
            ))}
            {slots.length < 3 && <button onClick={addSlot} className="text-[11px] text-[#2EC4A5] hover:underline">+ Add another slot</button>}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white rounded-xl" disabled={proposing} onClick={() => void proposeInterview()}>
              {proposing ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
              Propose Slots
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── AssessmentSection — therapist only, gates trial when wantsAssessmentFirst ─
function AssessmentSection({ matchId, candidate, assessmentFeeInr, wantsAssessmentFirst, matchAssessmentFeePaymentId }: {
  matchId: number;
  candidate: Candidate;
  assessmentFeeInr: number;
  wantsAssessmentFirst: boolean;
  matchAssessmentFeePaymentId: string | null | undefined;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [booking, setBooking] = useState(false);

  if (!wantsAssessmentFirst || candidate.requestStatus !== "accepted") return null;
  if (candidate.assessmentCompleted) {
    return (
      <div className="border-t border-gray-100 pt-3 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Assessment</p>
        <div className="w-full text-center text-xs font-semibold px-2.5 py-2 rounded-xl bg-green-50 text-green-700 border border-green-200">Assessment Complete ✓</div>
      </div>
    );
  }

  async function bookAssessment() {
    setBooking(true);
    try {
      const res = await fetchWithAuth(`/api/therapist/${matchId}/candidates/${candidate.id}/book-assessment`, { method: "POST" });
      const data = (await res.json()) as { error?: string; orderId?: string; amount?: number; keyId?: string };
      if (!res.ok) {
        toast({ title: data.error ?? "Could not book assessment", variant: "destructive" });
        return;
      }
      const loaded = await loadRazorpayScript();
      if (!loaded || !data.orderId || !data.amount || !data.keyId) {
        toast({ title: "Payment gateway unavailable", variant: "destructive" });
        return;
      }
      await new Promise<void>((resolve, reject) => {
        const rzp = new window.Razorpay({
          key: data.keyId!,
          amount: data.amount!,
          currency: "INR",
          order_id: data.orderId!,
          name: "Includly",
          description: "Therapist assessment fee",
          handler: async (response: RazorpayPaymentResponse) => {
            try {
              const vRes = await fetchWithAuth(`/api/therapist/${matchId}/verify-assessment-payment`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ razorpayOrderId: response.razorpay_order_id, razorpayPaymentId: response.razorpay_payment_id, razorpaySignature: response.razorpay_signature }),
              });
              if (!vRes.ok) {
                const vd = (await vRes.json()) as { error?: string };
                toast({ title: vd.error ?? "Payment verification failed", variant: "destructive" });
                reject(new Error("verify"));
                return;
              }
              toast({ title: "Assessment booked!", description: "Coordinate with the therapist to schedule it." });
              queryClient.invalidateQueries({ queryKey: ["therapist-my-request"] });
              resolve();
            } catch {
              reject(new Error("verify"));
            }
          },
          modal: { ondismiss: () => reject(new Error("dismissed")) },
        });
        rzp.open();
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg !== "dismissed") toast({ title: "Assessment booking failed", variant: "destructive" });
    } finally {
      setBooking(false);
    }
  }

  if (matchAssessmentFeePaymentId) {
    return (
      <div className="border-t border-gray-100 pt-3 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Assessment</p>
        <div className="w-full text-center text-xs font-semibold px-2.5 py-2 rounded-xl bg-amber-50 text-amber-700 border border-amber-200">Assessment paid — awaiting completion</div>
      </div>
    );
  }

  return (
    <div className="border-t border-gray-100 pt-3 space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Assessment required first</p>
      <button onClick={() => void bookAssessment()} disabled={booking} className="w-full flex items-center justify-center gap-1.5 text-xs bg-orange-500 hover:bg-orange-600 text-white rounded-xl py-2 font-semibold disabled:opacity-50">
        {booking ? <Loader2 size={13} className="animate-spin" /> : <ClipboardCheck size={13} />}
        Book Assessment — ₹{assessmentFeeInr.toLocaleString("en-IN")}
      </button>
    </div>
  );
}

// ── TrialRequestSection ──────────────────────────────────────────────────────
function TrialRequestSection({ cfg, matchId, candidate, baseTrialFeeInr, assessmentBlocking, onBookTrialPayment, bookingTrial }: {
  cfg: VerticalConfig;
  matchId: number;
  candidate: Candidate;
  baseTrialFeeInr: number;
  assessmentBlocking: boolean;
  onBookTrialPayment: (professionalId: number) => void;
  bookingTrial: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [trialDays, setTrialDays] = useState(1);
  const [requesting, setRequesting] = useState(false);

  if (assessmentBlocking) return null;

  async function requestTrial() {
    setRequesting(true);
    try {
      const res = await fetchWithAuth(`${cfg.apiBase}/${matchId}/candidates/${candidate.id}/request-trial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trialDays }),
      });
      if (!res.ok) {
        const e = (await res.json()) as { error?: string };
        toast({ title: e.error ?? "Could not request trial", variant: "destructive" });
        return;
      }
      queryClient.invalidateQueries({ queryKey: [`${cfg.vertical}-my-request`] });
    } finally {
      setRequesting(false);
    }
  }

  if (candidate.trialDaysAccepted != null) {
    return (
      <div className="border-t border-gray-100 pt-3 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Trial</p>
        <div className="w-full text-center text-xs font-semibold px-2.5 py-2 rounded-xl bg-green-50 text-green-700 border border-green-200">
          Trial: {candidate.trialDaysAccepted} day{candidate.trialDaysAccepted > 1 ? "s" : ""} confirmed
        </div>
        <button onClick={() => onBookTrialPayment(candidate.professionalId)} disabled={bookingTrial} className="w-full flex items-center justify-center gap-1.5 text-xs bg-orange-500 hover:bg-orange-600 text-white rounded-xl py-2 font-semibold disabled:opacity-50">
          <IndianRupee size={13} />
          Book Trial Payment — ₹{(baseTrialFeeInr * candidate.trialDaysAccepted).toLocaleString("en-IN")}
        </button>
      </div>
    );
  }

  if (candidate.trialDaysRequested != null) {
    return (
      <div className="border-t border-gray-100 pt-3 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Trial</p>
        <div className="w-full text-center text-xs font-semibold px-2.5 py-2 rounded-xl bg-amber-50 text-amber-700 border border-amber-200">Awaiting {cfg.professionalLabel} confirmation…</div>
      </div>
    );
  }

  return (
    <div className="border-t border-gray-100 pt-3 space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Request Trial</p>
      <div className="flex gap-1.5">
        {[1, 2, 3].map((n) => (
          <button key={n} onClick={() => setTrialDays(n)} className={`flex-1 text-xs font-semibold py-1.5 rounded-lg border ${trialDays === n ? "bg-[#2EC4A5] text-white border-[#2EC4A5]" : "bg-white text-gray-600 border-gray-200"}`}>
            {n} day{n > 1 ? "s" : ""}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-gray-500 text-center">₹{baseTrialFeeInr.toLocaleString("en-IN")} × {trialDays} = ₹{(baseTrialFeeInr * trialDays).toLocaleString("en-IN")}</p>
      <button onClick={() => void requestTrial()} disabled={requesting} className="w-full flex items-center justify-center gap-1.5 text-xs bg-orange-500 hover:bg-orange-600 text-white rounded-xl py-2 font-semibold disabled:opacity-50">
        {requesting ? <Loader2 size={13} className="animate-spin" /> : <Star size={13} />}
        Request Trial
      </button>
    </div>
  );
}

// ── TrustSignalCard — the candidate card, vertical-aware trust signals ──────
function TrustSignalCard({ cfg, candidate, matchId, committed, selected, onChoose, baseTrialFeeInr, trialMode, matchStatus, wantsAssessmentFirst, matchAssessmentFeePaymentId, assessmentFeeInr }: {
  cfg: VerticalConfig;
  candidate: Candidate;
  matchId: number;
  committed: boolean;
  selected: boolean;
  onChoose: (professionalId: number) => void;
  baseTrialFeeInr: number;
  trialMode?: boolean;
  matchStatus?: string;
  wantsAssessmentFirst?: boolean;
  matchAssessmentFeePaymentId?: string | null;
  assessmentFeeInr?: number;
}) {
  const p = candidate.profile;
  const displayName = p.fullName ?? `${cfg.professionalLabelCap} #${candidate.rank}`;
  const assessmentBlocking = !!(wantsAssessmentFirst && !candidate.assessmentCompleted);

  return (
    <div className={`bg-white border rounded-2xl p-4 shadow-sm space-y-3 ${selected ? "border-[#2EC4A5]" : "border-gray-100"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="font-bold text-[#1A2340] text-base leading-tight">{displayName}</p>
            {p.verificationStatus === "verified" && cfg.vertical === "tutor" && <BadgeCheck size={15} className="text-[#2EC4A5] shrink-0" />}
            <ScoreBadge score={candidate.score} />
          </div>
          {/* RCI-VERIFIED — deliberately the single most prominent trust signal on the
              therapist card, per B6's research citation that verified credentials
              matter more than price for this audience. Not a small icon. */}
          {cfg.vertical === "therapist" && (
            <Badge
              variant={p.rciVerified ? "default" : "outline"}
              className={p.rciVerified ? "mt-1.5 bg-violet-600 text-white border-violet-600 gap-1 text-[11px] px-2.5 py-1" : "mt-1.5 text-gray-400 border-gray-200 gap-1 text-[11px] px-2.5 py-1"}
            >
              <ShieldCheck size={12} />
              {p.rciVerified ? "RCI Verified" : "RCI verification pending"}
            </Badge>
          )}
          <p className="text-xs text-gray-500 mt-1">
            {p.yearsExperience > 0 ? `${p.yearsExperience} ${p.yearsExperience === 1 ? "yr" : "yrs"} experience` : "Experience not listed"}
          </p>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            {p.city && (
              <span className="text-[11px] text-gray-400 flex items-center gap-1">
                <MapPin size={10} />
                {p.displayArea ?? p.city}
              </span>
            )}
            {p.averageRating && (
              <span className="text-[11px] text-gray-400 flex items-center gap-1">
                <Star size={10} className="fill-[#FFB830] text-[#FFB830]" />
                {p.averageRating.toFixed(1)}
              </span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-gray-400">Rate</p>
          <p className="text-sm font-bold text-[#1A2340]">
            {p.pricingMinINR == null ? "TBD" : `₹${p.pricingMinINR.toLocaleString("en-IN")}${p.pricingMaxINR && p.pricingMaxINR !== p.pricingMinINR ? `–₹${p.pricingMaxINR.toLocaleString("en-IN")}` : ""}/session`}
          </p>
        </div>
      </div>

      {!committed && !trialMode && <SendRequestBlock cfg={cfg} matchId={matchId} candidate={candidate} />}
      {!committed && !trialMode && <InterviewSection cfg={cfg} matchId={matchId} candidate={candidate} />}

      {p.bio && <p className="text-xs text-gray-500 line-clamp-2">{p.bio}</p>}

      <div className="flex flex-wrap gap-2">
        {p.offersHomeVisits && <span className="text-[10px] px-2 py-0.5 bg-[#2EC4A5]/10 text-[#2EC4A5] rounded-full">Home visits</span>}
        {(p.languages ?? []).slice(0, 3).map((l) => (
          <span key={l} className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full flex items-center gap-1">
            <Languages size={9} />
            {l}
          </span>
        ))}
      </div>

      {cfg.vertical === "therapist" && !committed && !trialMode && (
        <AssessmentSection matchId={matchId} candidate={candidate} assessmentFeeInr={assessmentFeeInr ?? 1500} wantsAssessmentFirst={!!wantsAssessmentFirst} matchAssessmentFeePaymentId={matchAssessmentFeePaymentId} />
      )}

      {!committed && !trialMode && candidate.interviewDoneAt != null && (
        <TrialRequestSection cfg={cfg} matchId={matchId} candidate={candidate} baseTrialFeeInr={baseTrialFeeInr} assessmentBlocking={assessmentBlocking} onBookTrialPayment={onChoose} bookingTrial={false} />
      )}

      {!committed && !trialMode && candidate.trialDaysAccepted == null && matchStatus === "shortlisted" && (
        <div className="flex gap-2 pt-1">
          <Button size="sm" className="gap-1 text-xs flex-1 bg-[#2EC4A5] hover:bg-[#26a88d] text-white rounded-xl" onClick={() => onChoose(candidate.professionalId)}>
            <ChevronRight size={12} />
            Choose
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Main widget ──────────────────────────────────────────────────────────────
export function VerticalRequestWidget({ vertical }: { vertical: Vertical }) {
  const cfg = CONFIGS[vertical];
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: me } = useGetMe();
  const { selectedChildId, childrenLoading } = useSelectedChild();
  const { data: match, isLoading: loadingMatch, refetch } = useMyMatch(cfg, selectedChildId);
  const { data: children = [], isLoading: loadingChildrenLocal } = useChildren();
  const { data: pricing } = usePricing(cfg);
  const matchingFee = pricing?.matchingFeeInr ?? 500;
  const trialFee = pricing?.trialFeeInr ?? 500;
  const assessmentFee = pricing?.assessmentFeeInr ?? 1500;

  const loadingChildren = childrenLoading || loadingChildrenLocal;

  // ── Upfront intake (5 fields incl. location — see conversion-drop research
  // in the B6 spec) ───────────────────────────────────────────────────────
  const [childAge, setChildAge] = useState("");
  const [locationArea, setLocationArea] = useState("");
  const [mode, setMode] = useState<string[]>([]);
  // tutor-only
  const [subjects, setSubjects] = useState<string[]>([]);
  const [board, setBoard] = useState("");
  // therapist-only
  const [primaryConcern, setPrimaryConcern] = useState("");
  const [disciplineNeeded, setDisciplineNeeded] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [choosingId, setChoosingId] = useState<number | null>(null);

  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [commitProfId, setCommitProfId] = useState<number | null>(null);
  const [commitStartDate, setCommitStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [commitAcknowledged, setCommitAcknowledged] = useState(false);

  const [directPayInfo, setDirectPayInfo] = useState<{ professionalId: number; vpa: string; professionalName: string; amountInr: number } | null>(null);
  const [markingDirectPayPaid, setMarkingDirectPayPaid] = useState(false);
  const [reviewingProfessionalId, setReviewingProfessionalId] = useState<number | null>(null);

  const status = match?.status ?? null;
  const isActive = status && !["cancelled", "refunded"].includes(status);
  const committed = status === "committed";

  const DISCIPLINE_OPTIONS = [
    { value: "occupational_therapy", label: "Occupational Therapy" },
    { value: "speech_therapy", label: "Speech Therapy" },
    { value: "aba", label: "ABA" },
    { value: "behavioral_therapy", label: "Behavioral Therapy" },
    { value: "physiotherapy", label: "Physiotherapy" },
    { value: "developmental_therapy", label: "Developmental Therapy" },
    { value: "special_education", label: "Special Education" },
    { value: "psychotherapy_counselling", label: "Psychotherapy / Counselling" },
    { value: "clinical_psychology", label: "Clinical Psychology" },
    { value: "not_sure", label: "Not sure yet" },
  ];
  const SUBJECT_OPTIONS = ["Mathematics", "Science", "English", "Hindi", "Social Studies", "Computer Science"];
  const MODE_OPTIONS = cfg.vertical === "tutor" ? ["Home", "Online"] : ["Home", "Online", "Clinic"];

  async function handleSubmit() {
    const effectiveChildId = selectedChildId ?? match?.childId ?? null;
    if (!effectiveChildId) {
      toast({ title: "Please select a child profile from the child switcher above", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        childId: effectiveChildId,
        childAge: childAge ? parseInt(childAge, 10) : undefined,
        locationArea: locationArea || undefined,
        extraNotes: undefined,
      };
      if (cfg.vertical === "tutor") {
        body["subjects"] = subjects.length ? subjects : undefined;
        body["board"] = board || undefined;
        body["mode"] = mode.length ? mode : undefined;
      } else {
        body["diagnosedConditions"] = primaryConcern ? [primaryConcern] : undefined;
        body["disciplineNeeded"] = disciplineNeeded || undefined;
        body["sessionModePreference"] = mode.length ? mode : undefined;
      }

      const res = await fetchWithAuth(`${cfg.apiBase}/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string; matchId?: number; orderId?: string; amount?: number; keyId?: string };

      if (!res.ok && res.status !== 409) {
        toast({ title: data.error ?? "Could not submit request", variant: "destructive" });
        return;
      }

      const orderId = data.orderId;
      if (!orderId || !data.amount || !data.keyId || !data.matchId) {
        toast({ title: "You already have an active request", description: "Refreshing your status…" });
        await refetch();
        return;
      }

      const loaded = await loadRazorpayScript();
      if (!loaded) {
        toast({ title: "Payment gateway unavailable", variant: "destructive" });
        return;
      }

      const matchId = data.matchId;
      await new Promise<void>((resolve, reject) => {
        const rzp = new window.Razorpay({
          key: data.keyId!,
          amount: data.amount!,
          currency: "INR",
          order_id: orderId,
          name: "Includly",
          description: `${cfg.professionalLabelCap} matching fee`,
          handler: async (response: RazorpayPaymentResponse) => {
            try {
              const vRes = await fetchWithAuth(`${cfg.apiBase}/${matchId}/verify-request-payment`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ razorpayOrderId: response.razorpay_order_id, razorpayPaymentId: response.razorpay_payment_id, razorpaySignature: response.razorpay_signature }),
              });
              if (!vRes.ok) {
                const vd = (await vRes.json()) as { error?: string };
                toast({ title: vd.error ?? "Payment verification failed", variant: "destructive" });
                reject(new Error("verify"));
                return;
              }
              const vd = (await vRes.json().catch(() => ({}))) as { candidateCount?: number };
              toast({ title: "Payment confirmed!", description: `Found ${vd.candidateCount ?? 0} ${cfg.professionalLabel}${vd.candidateCount === 1 ? "" : "s"} for you.` });
              queryClient.invalidateQueries({ queryKey: [`${cfg.vertical}-my-request`] });
              await refetch();
              resolve();
            } catch {
              reject(new Error("verify"));
            }
          },
          modal: { ondismiss: () => reject(new Error("dismissed")) },
        });
        rzp.open();
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg !== "dismissed") toast({ title: "Request failed", description: msg, variant: "destructive" });
      await refetch();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleChoose(professionalId: number, startDate?: string) {
    if (!match) return;
    setChoosingId(professionalId);
    try {
      const orderRes = await fetchWithAuth(`${cfg.apiBase}/${match.id}/commit/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedProfessionalId: professionalId, startDate }),
      });
      const orderData = (await orderRes.json()) as { error?: string; message?: string; waived?: boolean; orderId?: string; amount?: number; keyId?: string };
      if (!orderRes.ok) {
        toast({ title: orderData.message ?? orderData.error ?? "Could not select this professional", variant: "destructive" });
        return;
      }
      if (orderData.waived) {
        toast({ title: `${cfg.professionalLabelCap} confirmed!`, description: "Your start code will appear in the Engagement tab." });
        queryClient.invalidateQueries({ queryKey: [`${cfg.vertical}-my-request`] });
        await refetch();
        return;
      }
      if (!orderData.orderId || !orderData.amount || !orderData.keyId) {
        toast({ title: "Invalid payment response", variant: "destructive" });
        return;
      }
      const loaded = await loadRazorpayScript();
      if (!loaded) {
        toast({ title: "Payment gateway unavailable", variant: "destructive" });
        return;
      }
      await new Promise<void>((resolve, reject) => {
        const rzp = new window.Razorpay({
          key: orderData.keyId!,
          amount: orderData.amount!,
          currency: "INR",
          order_id: orderData.orderId!,
          name: "Includly",
          description: `${cfg.professionalLabelCap} placement fee`,
          handler: async (response: RazorpayPaymentResponse) => {
            try {
              const vRes = await fetchWithAuth(`${cfg.apiBase}/${match.id}/commit/verify`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ razorpayOrderId: response.razorpay_order_id, razorpayPaymentId: response.razorpay_payment_id, razorpaySignature: response.razorpay_signature }),
              });
              const vd = (await vRes.json()) as { error?: string; message?: string };
              if (!vRes.ok) {
                toast({ title: vd.message ?? vd.error ?? "Payment verification failed", variant: "destructive" });
                reject(new Error("verify"));
                return;
              }
              toast({ title: `${cfg.professionalLabelCap} confirmed!`, description: "Your start code will appear in the Engagement tab." });
              queryClient.invalidateQueries({ queryKey: [`${cfg.vertical}-my-request`] });
              await refetch();
              resolve();
            } catch {
              reject(new Error("verify"));
            }
          },
          modal: { ondismiss: () => reject(new Error("dismissed")) },
        });
        rzp.open();
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg !== "dismissed") toast({ title: "Could not select this professional", description: msg, variant: "destructive" });
      await refetch();
    } finally {
      setChoosingId(null);
    }
  }

  // ── handleBookTrialPayment — direct-pay vs Razorpay branch ────────────────
  async function handleBookTrialPayment(professionalId: number) {
    if (!match) return;
    try {
      const res = await fetchWithAuth(`${cfg.apiBase}/${match.id}/request-trial-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedProfessionalId: professionalId }),
      });
      const data = (await res.json()) as {
        error?: string; message?: string; directPay?: boolean; blocked?: boolean; trialFeeInr?: number;
        upiVpa?: string; professionalName?: string; orderId?: string; amount?: number; keyId?: string;
      };
      if (!res.ok) {
        toast({ title: data.message ?? data.error ?? "Could not initiate trial payment", variant: "destructive" });
        return;
      }
      if (data.directPay) {
        if (data.blocked) {
          toast({ title: "Almost ready", description: `We've asked your ${cfg.professionalLabel} to finish verifying their UPI ID. Please try again shortly.` });
          return;
        }
        setDirectPayInfo({ professionalId, vpa: data.upiVpa!, professionalName: data.professionalName ?? `your ${cfg.professionalLabel}`, amountInr: data.trialFeeInr ?? trialFee });
        return;
      }
      const loaded = await loadRazorpayScript();
      if (!loaded || !data.orderId || !data.amount || !data.keyId) {
        toast({ title: "Payment gateway unavailable", variant: "destructive" });
        return;
      }
      await new Promise<void>((resolve, reject) => {
        const rzp = new window.Razorpay({
          key: data.keyId!,
          amount: data.amount!,
          currency: "INR",
          order_id: data.orderId!,
          name: "Includly",
          description: `${cfg.professionalLabelCap} trial fee`,
          handler: async (response: RazorpayPaymentResponse) => {
            try {
              const vRes = await fetchWithAuth(`${cfg.apiBase}/${match.id}/verify-trial-payment`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ razorpayOrderId: response.razorpay_order_id, razorpayPaymentId: response.razorpay_payment_id, razorpaySignature: response.razorpay_signature, selectedProfessionalId: professionalId }),
              });
              if (!vRes.ok) {
                const vd = (await vRes.json()) as { error?: string };
                toast({ title: vd.error ?? "Payment verification failed", variant: "destructive" });
                reject(new Error("verify"));
                return;
              }
              toast({ title: "Trial booked!", description: "Coordinate scheduling with your " + cfg.professionalLabel + "." });
              queryClient.invalidateQueries({ queryKey: [`${cfg.vertical}-my-request`] });
              await refetch();
              resolve();
            } catch {
              reject(new Error("verify"));
            }
          },
          modal: { ondismiss: () => reject(new Error("dismissed")) },
        });
        rzp.open();
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg !== "dismissed") toast({ title: "Trial request failed", description: msg, variant: "destructive" });
      await refetch();
    }
  }

  async function handleConfirmDirectPayPaid() {
    if (!match || !directPayInfo) return;
    setMarkingDirectPayPaid(true);
    try {
      const res = await fetchWithAuth(`${cfg.apiBase}/${match.id}/mark-trial-paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedProfessionalId: directPayInfo.professionalId }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string; message?: string };
        toast({ title: d.message ?? d.error ?? "Could not confirm payment", variant: "destructive" });
        return;
      }
      toast({ title: "Trial booked!", description: "Coordinate scheduling with your " + cfg.professionalLabel + "." });
      setDirectPayInfo(null);
      queryClient.invalidateQueries({ queryKey: [`${cfg.vertical}-my-request`] });
      await refetch();
    } finally {
      setMarkingDirectPayPaid(false);
    }
  }

  if (loadingMatch || loadingChildren) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 size={22} className="animate-spin text-primary" />
      </div>
    );
  }

  const selectedChild = children.find((c) => c.id === selectedChildId);

  // ── New request form (upfront 5-field intake) ─────────────────────────────
  if (!isActive) {
    return (
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-5">
        <div className="flex items-center gap-2">
          <ClipboardCheck size={20} className="text-primary" />
          <h2 className="font-serif font-semibold text-lg text-foreground">Find a {cfg.professionalLabelCap}</h2>
        </div>

        {children.length === 0 ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
            You haven&apos;t added a child profile yet. <a href="/dashboard" className="underline font-medium">Add your child</a> first.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground mb-0.5">Finding a {cfg.professionalLabel} for</p>
              <p className="text-sm font-medium text-foreground">{selectedChild?.name ?? "—"}</p>
            </div>

            <div>
              <label className="text-sm mb-1 block font-medium text-foreground">Child&apos;s age</label>
              <input type="number" min={0} max={25} value={childAge} onChange={(e) => setChildAge(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2EC4A5]" placeholder="e.g. 8" />
            </div>

            {cfg.vertical === "tutor" ? (
              <>
                <div>
                  <label className="text-sm mb-1 block font-medium text-foreground">Subjects needed</label>
                  <div className="flex flex-wrap gap-1.5">
                    {SUBJECT_OPTIONS.map((s) => (
                      <button key={s} type="button" onClick={() => setSubjects((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))} className={`text-xs px-2.5 py-1 rounded-full border ${subjects.includes(s) ? "bg-[#2EC4A5] text-white border-[#2EC4A5]" : "bg-white text-gray-600 border-gray-200"}`}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-sm mb-1 block font-medium text-foreground">Board</label>
                  <select value={board} onChange={(e) => setBoard(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2EC4A5]">
                    <option value="">Select board</option>
                    <option value="CBSE">CBSE</option>
                    <option value="ICSE">ICSE</option>
                    <option value="State Board">State Board</option>
                    <option value="IB">IB</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="text-sm mb-1 block font-medium text-foreground">Primary concern <span className="text-muted-foreground font-normal">(or leave blank if not yet diagnosed)</span></label>
                  <input type="text" value={primaryConcern} onChange={(e) => setPrimaryConcern(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2EC4A5]" placeholder="e.g. speech delay" />
                </div>
                <div>
                  <label className="text-sm mb-1 block font-medium text-foreground">Discipline needed</label>
                  <select value={disciplineNeeded} onChange={(e) => setDisciplineNeeded(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2EC4A5]">
                    <option value="">Select discipline</option>
                    {DISCIPLINE_OPTIONS.map((d) => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <div>
              <label className="text-sm mb-1 block font-medium text-foreground">Mode</label>
              <div className="flex flex-wrap gap-1.5">
                {MODE_OPTIONS.map((m) => (
                  <button key={m} type="button" onClick={() => setMode((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]))} className={`text-xs px-2.5 py-1 rounded-full border ${mode.includes(m) ? "bg-[#2EC4A5] text-white border-[#2EC4A5]" : "bg-white text-gray-600 border-gray-200"}`}>
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm mb-1 block font-medium text-foreground">Area / locality</label>
              <input type="text" value={locationArea} onChange={(e) => setLocationArea(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2EC4A5]" placeholder="e.g. Koramangala, Bengaluru" />
            </div>
          </div>
        )}

        <Button className="w-full gap-2" onClick={() => void handleSubmit()} disabled={submitting || selectedChildId === null || children.length === 0}>
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <IndianRupee size={14} />}
          {submitting ? "Opening payment…" : `Find My ${cfg.professionalLabelCap} — ₹${matchingFee.toLocaleString("en-IN")}`}
        </Button>
        <p className="text-[11px] text-center text-muted-foreground">A one-time matching fee of ₹{matchingFee.toLocaleString("en-IN")} is charged now. Choosing your {cfg.professionalLabel} later is free.</p>
      </div>
    );
  }

  if (status === "pending_payment" && match) {
    return (
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
        <h2 className="font-serif font-semibold text-lg text-foreground">Complete Your Payment</h2>
        <Button className="w-full gap-2 bg-[#2EC4A5] hover:bg-[#26a88d] text-white" onClick={() => void handleSubmit()} disabled={submitting}>
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <IndianRupee size={14} />}
          {submitting ? "Opening payment…" : `Pay ₹${matchingFee.toLocaleString("en-IN")} to see ${cfg.professionalLabel}s`}
        </Button>
      </div>
    );
  }

  const myId = me?.id ?? 0;

  // ── Trial pending/started — OTP display ───────────────────────────────────
  if ((status === "trial_pending" || status === "trial_started") && match) {
    const trialCandidate = match.candidates.find((c) => c.professionalId === match.selectedProfessionalId);
    const trialName = trialCandidate?.profile.fullName ?? `your ${cfg.professionalLabel}`;
    const otp = status === "trial_pending" ? match.trialStartOtp : match.trialEndOtp;
    const otpLabel = status === "trial_pending" ? "Trial Start Code" : "Trial End Code";
    return (
      <div className="space-y-4">
        {otp && (
          <div className="bg-indigo-50 border-2 border-indigo-300 rounded-2xl p-5 text-center space-y-2">
            <p className="text-xs font-semibold text-indigo-600 uppercase tracking-widest">{otpLabel}</p>
            <p className="text-5xl font-mono font-bold tracking-[0.25em] text-indigo-900 select-all">{otp}</p>
            <p className="text-xs text-indigo-600">Show this to {trialName} when the trial {status === "trial_pending" ? "begins" : "ends"}</p>
          </div>
        )}
        {match.trialMeetLink && (
          <a
            href={match.trialMeetLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 w-full h-10 rounded-xl bg-[#2EC4A5] hover:bg-[#26a88d] text-white font-semibold text-sm no-underline"
          >
            <Video size={15} />
            Join Trial Call
          </a>
        )}
        {trialCandidate && (
          <TrustSignalCard cfg={cfg} candidate={trialCandidate} matchId={match.id} committed={false} selected onChoose={() => {}} baseTrialFeeInr={trialFee} trialMode matchStatus={status} />
        )}
      </div>
    );
  }

  const CommitDialog = commitDialogOpen && commitProfId !== null ? (
    <Dialog open onOpenChange={(o) => { if (!o) { setCommitDialogOpen(false); setCommitProfId(null); setCommitAcknowledged(false); } }}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-[#1A2340]">Pick a Start Date</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <AntiBypassNotice professionalLabel={cfg.professionalLabel} benefits={cfg.antiBypassBenefits} checked={commitAcknowledged} onCheckedChange={setCommitAcknowledged} />
          <p className="text-sm text-gray-600">When should the engagement begin?</p>
          <input type="date" min={new Date().toISOString().slice(0, 10)} value={commitStartDate} onChange={(e) => setCommitStartDate(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2EC4A5]" />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="rounded-xl" onClick={() => { setCommitDialogOpen(false); setCommitProfId(null); setCommitAcknowledged(false); }}>Cancel</Button>
          <Button
            className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white rounded-xl disabled:opacity-60"
            disabled={choosingId !== null || !commitStartDate || !commitAcknowledged}
            onClick={async () => {
              const profId = commitProfId!;
              const sd = commitStartDate;
              setCommitDialogOpen(false);
              setCommitProfId(null);
              setCommitAcknowledged(false);
              await handleChoose(profId, sd);
            }}
          >
            {choosingId ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;

  if (status === "trial_done" && match) {
    const trialCandidate = match.candidates.find((c) => c.professionalId === match.selectedProfessionalId);
    const trialName = trialCandidate?.profile.fullName ?? `this ${cfg.professionalLabel}`;
    return (
      <>
        {CommitDialog}
        <div className="space-y-4">
          <div className="bg-teal-50 border border-teal-200 rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={18} className="text-teal-600" />
              <p className="font-semibold text-teal-800">Trial complete — what would you like to do?</p>
            </div>
            <Button
              className="w-full gap-2 bg-[#2EC4A5] hover:bg-[#26a88d] text-white rounded-xl"
              onClick={() => {
                if (!match.selectedProfessionalId) return;
                setCommitProfId(match.selectedProfessionalId);
                setCommitStartDate(new Date().toISOString().slice(0, 10));
                setCommitDialogOpen(true);
              }}
              disabled={choosingId !== null}
            >
              {choosingId ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
              Commit to {trialName}
            </Button>
            {match.selectedProfessionalId && (
              <Button
                variant="outline"
                className="w-full gap-2 rounded-xl"
                onClick={() => setReviewingProfessionalId(match.selectedProfessionalId)}
              >
                <Star size={14} />
                Rate your trial with {trialName}
              </Button>
            )}
          </div>
        </div>
        {reviewingProfessionalId !== null && (
          <ReviewModal professionalId={reviewingProfessionalId} onClose={() => setReviewingProfessionalId(null)} />
        )}
      </>
    );
  }

  // ── Shortlisted: candidate list ────────────────────────────────────────────
  return (
    <>
      {CommitDialog}
      <div className="space-y-3">
        {match?.candidates.map((c) => (
          <TrustSignalCard
            key={c.id}
            cfg={cfg}
            candidate={c}
            matchId={match.id}
            committed={committed}
            selected={c.professionalId === match.selectedProfessionalId}
            onChoose={(profId) => {
              if (c.trialDaysAccepted != null && !committed) {
                void handleBookTrialPayment(profId);
                return;
              }
              setCommitProfId(profId);
              setCommitStartDate(new Date().toISOString().slice(0, 10));
              setCommitDialogOpen(true);
            }}
            baseTrialFeeInr={trialFee}
            matchStatus={status ?? undefined}
            wantsAssessmentFirst={match?.wantsAssessmentFirst}
            matchAssessmentFeePaymentId={match?.assessmentFeePaymentId}
            assessmentFeeInr={assessmentFee}
          />
        ))}
        {(!match || match.candidates.length === 0) && <p className="text-sm text-muted-foreground text-center py-6">No candidates surfaced yet.</p>}
      </div>

      {directPayInfo && (
        <UpiPayQRDialog
          open
          onOpenChange={(o) => { if (!o) setDirectPayInfo(null); }}
          vpa={directPayInfo.vpa}
          teacherName={directPayInfo.professionalName}
          amountInr={directPayInfo.amountInr}
          note={`Trial fee — ${cfg.professionalLabelCap}`}
          txnRef={`${cfg.vertical}-trial-${match?.id ?? ""}`}
          submitting={markingDirectPayPaid}
          onPaidConfirm={handleConfirmDirectPayPaid}
        />
      )}
    </>
  );
}

export function TutorRequestWidget() {
  return <VerticalRequestWidget vertical="tutor" />;
}
export function TherapistRequestWidget() {
  return <VerticalRequestWidget vertical="therapist" />;
}
