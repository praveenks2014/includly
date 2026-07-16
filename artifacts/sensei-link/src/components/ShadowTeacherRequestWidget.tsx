/**
 * ShadowTeacherRequestWidget — Deposit-at-Request Flow
 *
 * 1. Child selector → submit → Razorpay modal (₹500 matching fee)
 * 2. Payment verified → up to 3 candidates surfaced → chat / dismiss / choose
 * 3. Choose teacher → FREE commit → engagement auto-created
 * 4. Refund button appears after 60 days if <3 distinct teachers shown & never committed
 *
 * Legacy (queued/matched) states also handled for existing records.
 */
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { fetchWithAuth, getApiBase } from "@/lib/api";
import { loadRazorpayScript, type RazorpayPaymentResponse } from "@/lib/razorpay";
import { useSelectedChild } from "@/contexts/SelectedChildContext";
import {
  UserCheck, Loader2, CheckCircle2, Clock, IndianRupee,
  AlertCircle, RefreshCw, MessageSquare, Star, MapPin, Languages,
  ChevronRight, BadgeCheck, Send, Video, XCircle, CalendarClock,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShadowMatchChatDrawer } from "./ShadowMatchChatDrawer";
import { UpiPayQRDialog } from "./UpiPayQRDialog";
import { TermsAcknowledgment } from "./TermsAcknowledgment";
import { ProfessionalAvatar } from "./ProfessionalAvatar";
import { useGetMe } from "@workspace/api-client-react";

interface Child {
  id: number;
  name: string;
  city: string | null;
  conditions: string[] | null;
  languages: string[] | null;
  budgetMinInr: number | null;
  budgetMaxInr: number | null;
  preferredModes: string[] | null;
}

interface CandidateProfile {
  firstName?: string | null;
  fullName?: string | null;
  specialty: string;
  city: string | null;
  displayArea: string | null;
  yearsExperience: number;
  offersHomeVisits: boolean;
  verificationStatus: string;
  bio: string | null;
  pricingMinINR: number | null;
  pricingMaxINR: number | null;
  averageRating: number | null;
  languages: string[] | null;
  phone?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
}

interface InterviewSlot {
  date: string;
  time: string;
  label?: string;
}

interface Candidate {
  id: number;
  professionalId: number;
  score: number | null;
  rank: number;
  addedBy: string;
  profile: CandidateProfile;
  threadId: number | null;
  // Redesigned journey (Task 2c) — request → interview → trial state, plus
  // expected salary range surfaced at top level.
  expectedSalaryMin: number | null;
  expectedSalaryMax: number | null;
  requestStatus: string;
  rejectionNote: string | null;
  interviewSlotsJson: string | null;
  interviewConfirmedSlot: string | null;
  meetLink: string | null;
  interviewDoneAt: string | null;
  trialDaysRequested: number | null;
  trialDaysAccepted: number | null;
}

interface MatchWithCandidates {
  id: number;
  status: string;
  matchingFeeInr: number;
  providerOrderId: string | null;
  feePaidAt: string | null;
  distinctTeachersShown: number;
  matchedAt?: string;
  matchedProName?: string;
  selectedProfessionalId: number | null;
  childId: number | null;
  childCity: string | null;
  childConditions: string[] | null;
  childBudgetMinInr: number | null;
  childBudgetMaxInr: number | null;
  trialStartOtp: string | null;
  trialEndOtp: string | null;
  trialLocation: string | null;
  candidates: Candidate[];
}

function useMyMatch(childId: number | null) {
  return useQuery<MatchWithCandidates | null>({
    queryKey: ["shadow-teacher-my-request", childId],
    queryFn: async () => {
      const url = childId
        ? `/api/shadow-teacher/my-request?childId=${childId}`
        : "/api/shadow-teacher/my-request";
      const res = await fetchWithAuth(url);
      const data = await res.json() as MatchWithCandidates | null;
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

function useMatchingFee() {
  return useQuery<{ matchingFeeInr: number; trialFeeInr: number; noticePeriodDays: number }>({
    queryKey: ["shadow-teacher-pricing"],
    queryFn: async () => {
      const res = await fetch(`${getApiBase()}/shadow-teacher/pricing`);
      return res.json() as Promise<{ matchingFeeInr: number; trialFeeInr: number; noticePeriodDays: number }>;
    },
    staleTime: 5 * 60_000,
  });
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  shortlisted: "bg-blue-100 text-blue-700",
  pending_commitment: "bg-purple-100 text-purple-700",
  committed: "bg-green-100 text-green-700",
  queued: "bg-blue-100 text-blue-700",
  matched: "bg-green-100 text-green-700",
  cancelled: "bg-gray-100 text-gray-600",
  refunded: "bg-gray-100 text-gray-600",
  payment_failed: "bg-red-100 text-red-700",
  pending_payment: "bg-yellow-100 text-yellow-700",
  trial_pending: "bg-orange-100 text-orange-700",
  trial_started: "bg-indigo-100 text-indigo-700",
  trial_done: "bg-teal-100 text-teal-700",
};

interface NegotiationOffer {
  id: number;
  raisedByUserId: number;
  raisedByRole: string;
  amountInr: number;
  // Non-salary agreed terms — recorded on the offer, snapshotted to the
  // engagement at commit. NOT tied to any downstream enforcement yet
  // (loss-of-pay calc, absence tracking, retainer payouts are future work).
  absenceRetainerPct: number;
  absenceFreeDaysPerMonth: number;
  summerRetainerPct: number;
  summerRetainerMonths: number;
  leaveTermsNotes: string | null;
  status: string;
  createdAt: string;
}

const DEFAULT_ABSENCE_RETAINER_PCT = 50;
const DEFAULT_ABSENCE_FREE_DAYS_PER_MONTH = 4;
const DEFAULT_SUMMER_RETAINER_PCT = 0;
const DEFAULT_SUMMER_RETAINER_MONTHS = 0;

function termsSummary(o: NegotiationOffer): string {
  const parts: string[] = [];
  const absenceCustom = o.absenceRetainerPct !== DEFAULT_ABSENCE_RETAINER_PCT
    || o.absenceFreeDaysPerMonth !== DEFAULT_ABSENCE_FREE_DAYS_PER_MONTH;
  const summerCustom = o.summerRetainerPct !== DEFAULT_SUMMER_RETAINER_PCT
    || o.summerRetainerMonths !== DEFAULT_SUMMER_RETAINER_MONTHS;
  const hasNotes = !!(o.leaveTermsNotes && o.leaveTermsNotes.trim());

  if (absenceCustom) parts.push(`retainer ${o.absenceRetainerPct}% (${o.absenceFreeDaysPerMonth} free days)`);
  if (summerCustom) parts.push(`summer ${o.summerRetainerPct}% × ${o.summerRetainerMonths}mo`);
  if (hasNotes) parts.push("has notes");
  return parts.length === 0 ? "standard terms" : parts.join(" · ");
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return null;
  const color = score >= 70 ? "bg-green-100 text-green-700" : score >= 45 ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-500";
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${color}`}>
      {Math.round(score)}/100
    </span>
  );
}

function OfferSection({ matchId, candidateId, myUserId, matchStatus }: {
  matchId: number;
  candidateId: number;
  myUserId: number;
  matchStatus: string;
}) {
  const [offerInput, setOfferInput] = useState("");
  const [absenceRetainerPct, setAbsenceRetainerPct] = useState(DEFAULT_ABSENCE_RETAINER_PCT);
  const [absenceFreeDaysPerMonth, setAbsenceFreeDaysPerMonth] = useState(DEFAULT_ABSENCE_FREE_DAYS_PER_MONTH);
  const [summerRetainerPct, setSummerRetainerPct] = useState(DEFAULT_SUMMER_RETAINER_PCT);
  const [summerRetainerMonths, setSummerRetainerMonths] = useState(DEFAULT_SUMMER_RETAINER_MONTHS);
  const [leaveTermsNotes, setLeaveTermsNotes] = useState("");
  const [expandTerms, setExpandTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: offers = [] } = useQuery<NegotiationOffer[]>({
    queryKey: ["offers", matchId, candidateId],
    queryFn: () => fetchWithAuth(`/api/shadow-teacher/${matchId}/candidates/${candidateId}/offers`).then(r => r.json() as Promise<NegotiationOffer[]>),
    enabled: myUserId > 0 && ["shortlisted", "trial_done"].includes(matchStatus),
    refetchInterval: 15_000,
  });

  // One-shot prefill: when offers first load, seed the form from the latest
  // offer so counter-offers iterate from the current negotiation state, not
  // from platform defaults. Skip subsequent polls so user edits stick.
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (prefilledRef.current || offers.length === 0) return;
    const latest = offers[offers.length - 1]!;
    setAbsenceRetainerPct(latest.absenceRetainerPct ?? DEFAULT_ABSENCE_RETAINER_PCT);
    setAbsenceFreeDaysPerMonth(latest.absenceFreeDaysPerMonth ?? DEFAULT_ABSENCE_FREE_DAYS_PER_MONTH);
    setSummerRetainerPct(latest.summerRetainerPct ?? DEFAULT_SUMMER_RETAINER_PCT);
    setSummerRetainerMonths(latest.summerRetainerMonths ?? DEFAULT_SUMMER_RETAINER_MONTHS);
    setLeaveTermsNotes(latest.leaveTermsNotes ?? "");
    if (termsSummary(latest) !== "standard terms") setExpandTerms(true);
    prefilledRef.current = true;
  }, [offers]);

  const acceptedOffer = offers.find(o => o.status === "accepted");
  const myPendingOffer = offers.find(o => o.status === "pending" && o.raisedByUserId === myUserId);
  const theirPendingOffer = offers.find(o => o.status === "pending" && o.raisedByUserId !== myUserId);

  if (!["shortlisted", "trial_done"].includes(matchStatus)) return null;

  async function submitOffer() {
    const amount = parseInt(offerInput.replace(/\D/g, ""), 10);
    if (!amount || amount <= 0) { toast({ title: "Enter a valid amount", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      const res = await fetchWithAuth(`/api/shadow-teacher/${matchId}/candidates/${candidateId}/offers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountInr: amount,
          absenceRetainerPct,
          absenceFreeDaysPerMonth,
          summerRetainerPct,
          summerRetainerMonths,
          leaveTermsNotes: leaveTermsNotes.trim() || null,
        }),
      });
      if (!res.ok) { const e = await res.json() as { error?: string }; toast({ title: e.error ?? "Failed to send offer", variant: "destructive" }); return; }
      setOfferInput("");
      queryClient.invalidateQueries({ queryKey: ["offers", matchId, candidateId] });
    } finally { setSubmitting(false); }
  }

  async function acceptOffer(offerId: number) {
    setSubmitting(true);
    try {
      const res = await fetchWithAuth(`/api/shadow-teacher/${matchId}/candidates/${candidateId}/offers/${offerId}/accept`, { method: "PATCH" });
      if (!res.ok) { const e = await res.json() as { error?: string }; toast({ title: e.error ?? "Failed", variant: "destructive" }); return; }
      queryClient.invalidateQueries({ queryKey: ["offers", matchId, candidateId] });
    } finally { setSubmitting(false); }
  }

  async function withdrawOffer(offerId: number) {
    setSubmitting(true);
    try {
      const res = await fetchWithAuth(`/api/shadow-teacher/${matchId}/candidates/${candidateId}/offers/${offerId}`, { method: "DELETE" });
      if (!res.ok) { const e = await res.json() as { error?: string }; toast({ title: e.error ?? "Failed", variant: "destructive" }); return; }
      queryClient.invalidateQueries({ queryKey: ["offers", matchId, candidateId] });
    } finally { setSubmitting(false); }
  }

  const termsForm = expandTerms ? (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-2.5 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] text-gray-600">
          Absence retainer (%)
          <input type="number" min={0} max={100} value={absenceRetainerPct}
            onChange={e => setAbsenceRetainerPct(Math.max(0, Math.min(100, parseInt(e.target.value || "0", 10))))}
            className="mt-0.5 w-full text-xs border border-gray-200 rounded-md px-2 py-1 outline-none focus:ring-1 focus:ring-[#2EC4A5]"
            data-testid="input-absence-retainer-pct" />
        </label>
        <label className="text-[10px] text-gray-600">
          Free absence days / mo
          <input type="number" min={0} max={30} value={absenceFreeDaysPerMonth}
            onChange={e => setAbsenceFreeDaysPerMonth(Math.max(0, Math.min(30, parseInt(e.target.value || "0", 10))))}
            className="mt-0.5 w-full text-xs border border-gray-200 rounded-md px-2 py-1 outline-none focus:ring-1 focus:ring-[#2EC4A5]"
            data-testid="input-absence-free-days" />
        </label>
        <label className="text-[10px] text-gray-600">
          Summer retainer (%)
          <input type="number" min={0} max={100} value={summerRetainerPct}
            onChange={e => setSummerRetainerPct(Math.max(0, Math.min(100, parseInt(e.target.value || "0", 10))))}
            className="mt-0.5 w-full text-xs border border-gray-200 rounded-md px-2 py-1 outline-none focus:ring-1 focus:ring-[#2EC4A5]"
            data-testid="input-summer-retainer-pct" />
        </label>
        <label className="text-[10px] text-gray-600">
          Summer retainer for (months)
          <input type="number" min={0} max={12} value={summerRetainerMonths}
            onChange={e => setSummerRetainerMonths(Math.max(0, Math.min(12, parseInt(e.target.value || "0", 10))))}
            className="mt-0.5 w-full text-xs border border-gray-200 rounded-md px-2 py-1 outline-none focus:ring-1 focus:ring-[#2EC4A5]"
            data-testid="input-summer-retainer-months" />
        </label>
      </div>
      <label className="text-[10px] text-gray-600 block">
        Additional leave / retainer terms (optional)
        <textarea rows={2} maxLength={1000} value={leaveTermsNotes}
          onChange={e => setLeaveTermsNotes(e.target.value)}
          placeholder="e.g. 2 additional paid leaves during Diwali week"
          className="mt-0.5 w-full text-xs border border-gray-200 rounded-md px-2 py-1 outline-none focus:ring-1 focus:ring-[#2EC4A5] resize-none"
          data-testid="input-leave-terms-notes" />
      </label>
      <p className="text-[10px] text-gray-400 leading-snug">
        💡 Recorded for reference. Includly doesn&apos;t automate loss-of-pay or retainer payouts yet — this captures what you both agreed.
      </p>
    </div>
  ) : null;

  const toggleTermsButton = !acceptedOffer && !myPendingOffer ? (
    <button
      type="button"
      onClick={() => setExpandTerms(v => !v)}
      className="text-[10px] text-gray-500 hover:text-[#2EC4A5] underline underline-offset-2 self-start"
      data-testid="toggle-terms"
    >
      {expandTerms ? "▾ Hide leave & retainer terms" : "▸ Adjust leave & retainer terms"}
    </button>
  ) : null;

  return (
    <div className="border-t border-gray-100 pt-3 space-y-2 mt-1">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Price Negotiation</p>
      {offers.filter(o => o.status !== "withdrawn").slice(-4).map(o => (
        <div key={o.id} className={`flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg ${o.raisedByUserId === myUserId ? "bg-blue-50 text-blue-800" : "bg-gray-50 text-gray-600"}`}>
          <span className="min-w-0 truncate" title={o.leaveTermsNotes ?? undefined}>
            {o.raisedByUserId === myUserId ? "You" : "Teacher"} offered ₹{o.amountInr.toLocaleString("en-IN")}/mo · {termsSummary(o)}
          </span>
          <span className={`ml-2 text-[10px] font-semibold shrink-0 ${o.status === "accepted" ? "text-green-600" : o.status === "superseded" ? "text-gray-400" : "text-amber-600"}`}>
            {o.status === "accepted" ? "✓ Agreed" : o.status === "superseded" ? "replaced" : "pending"}
          </span>
        </div>
      ))}
      {acceptedOffer ? (
        <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 space-y-1">
          <p className="text-xs font-bold text-green-800">🔒 Agreed: ₹{acceptedOffer.amountInr.toLocaleString("en-IN")}/mo — click Choose to lock in</p>
          <p className="text-[10px] text-green-700">
            Absence retainer {acceptedOffer.absenceRetainerPct}% beyond {acceptedOffer.absenceFreeDaysPerMonth} free days/mo
            {(acceptedOffer.summerRetainerPct > 0 || acceptedOffer.summerRetainerMonths > 0)
              ? ` · Summer retainer ${acceptedOffer.summerRetainerPct}% × ${acceptedOffer.summerRetainerMonths}mo`
              : ""}
          </p>
          {acceptedOffer.leaveTermsNotes && acceptedOffer.leaveTermsNotes.trim() && (
            <p className="text-[10px] text-green-700 italic">Notes: {acceptedOffer.leaveTermsNotes}</p>
          )}
        </div>
      ) : myPendingOffer ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-amber-700 min-w-0 truncate">Waiting for teacher&apos;s response · {termsSummary(myPendingOffer)}</span>
          <button onClick={() => void withdrawOffer(myPendingOffer.id)} disabled={submitting}
            className="text-[10px] text-red-500 hover:underline disabled:opacity-50 shrink-0">Withdraw</button>
        </div>
      ) : theirPendingOffer ? (
        <div className="space-y-2">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 space-y-1">
            <p className="text-xs font-semibold text-amber-900">Teacher offered ₹{theirPendingOffer.amountInr.toLocaleString("en-IN")}/mo</p>
            <p className="text-[10px] text-amber-800">
              Absence retainer {theirPendingOffer.absenceRetainerPct}% beyond {theirPendingOffer.absenceFreeDaysPerMonth} free days/mo
              {(theirPendingOffer.summerRetainerPct > 0 || theirPendingOffer.summerRetainerMonths > 0)
                ? ` · Summer retainer ${theirPendingOffer.summerRetainerPct}% × ${theirPendingOffer.summerRetainerMonths}mo`
                : ""}
            </p>
            {theirPendingOffer.leaveTermsNotes && theirPendingOffer.leaveTermsNotes.trim() && (
              <p className="text-[10px] text-amber-800 italic">Notes: {theirPendingOffer.leaveTermsNotes}</p>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => void acceptOffer(theirPendingOffer.id)} disabled={submitting}
              className="flex-1 text-xs bg-green-600 text-white rounded-lg py-1.5 font-semibold hover:bg-green-700 disabled:opacity-50">Accept</button>
            <div className="flex flex-1 gap-1">
              <input type="number" min="1" placeholder="Counter ₹"
                value={offerInput} onChange={e => setOfferInput(e.target.value)}
                className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-[#2EC4A5] min-w-0" />
              <button onClick={() => void submitOffer()} disabled={submitting || !offerInput}
                className="text-xs bg-[#1A2340] text-white rounded-lg px-2 font-semibold hover:bg-[#2a3660] disabled:opacity-50">Send</button>
            </div>
          </div>
          {toggleTermsButton}
          {termsForm}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input type="number" min="1" placeholder="Make an offer ₹/mo"
              value={offerInput} onChange={e => setOfferInput(e.target.value)}
              className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-[#2EC4A5] min-w-0" />
            <button onClick={() => void submitOffer()} disabled={submitting || !offerInput}
              className="text-xs bg-[#2EC4A5] text-white rounded-lg px-3 py-1.5 font-semibold hover:bg-[#26a88d] disabled:opacity-50">
              {submitting ? "…" : "Offer"}
            </button>
          </div>
          {toggleTermsButton}
          {termsForm}
        </div>
      )}
    </div>
  );
}

// ── SendRequestBlock — Task 3a: requestStatus action row ──────────────────
function SendRequestBlock({ matchId, candidate }: { matchId: number; candidate: Candidate }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sending, setSending] = useState(false);

  async function sendRequest() {
    setSending(true);
    try {
      const res = await fetchWithAuth(`/api/shadow-teacher/${matchId}/candidates/${candidate.id}/send-request`, { method: "POST" });
      if (!res.ok) { const e = await res.json() as { error?: string }; toast({ title: e.error ?? "Could not send request", variant: "destructive" }); return; }
      queryClient.invalidateQueries({ queryKey: ["shadow-teacher-my-request"] });
    } finally { setSending(false); }
  }

  if (candidate.requestStatus === "not_sent") {
    return (
      <button
        onClick={() => void sendRequest()}
        disabled={sending}
        className="w-full flex items-center justify-center gap-1.5 text-xs bg-[#2EC4A5] text-white rounded-xl py-2 font-semibold hover:bg-[#26a88d] disabled:opacity-50"
        data-testid="button-send-request"
      >
        {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
        Send Request
      </button>
    );
  }
  if (candidate.requestStatus === "sent") {
    return (
      <div className="w-full text-center text-xs font-semibold px-2.5 py-2 rounded-xl bg-amber-50 text-amber-700 border border-amber-200">
        Request Sent – Awaiting Response
      </div>
    );
  }
  if (candidate.requestStatus === "accepted") {
    return (
      <div className="w-full text-center text-xs font-semibold px-2.5 py-2 rounded-xl bg-green-50 text-green-700 border border-green-200">
        Accepted ✓
      </div>
    );
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

// ── InterviewSection — Task 3b: schedule → confirm → mark done ────────────
function InterviewSection({ matchId, candidate }: { matchId: number; candidate: Candidate }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [slots, setSlots] = useState<InterviewSlot[]>([{ date: "", time: "", label: "" }]);
  const [proposing, setProposing] = useState(false);
  const [markingDone, setMarkingDone] = useState(false);

  if (candidate.requestStatus !== "accepted") return null;

  function updateSlot(i: number, field: keyof InterviewSlot, value: string) {
    setSlots((prev) => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s));
  }
  function addSlot() {
    setSlots((prev) => prev.length < 3 ? [...prev, { date: "", time: "", label: "" }] : prev);
  }
  function removeSlot(i: number) {
    setSlots((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function proposeInterview() {
    const validSlots = slots.filter((s) => s.date && s.time);
    if (validSlots.length === 0) { toast({ title: "Add at least one date and time", variant: "destructive" }); return; }
    setProposing(true);
    try {
      const res = await fetchWithAuth(`/api/shadow-teacher/${matchId}/candidates/${candidate.id}/propose-interview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slots: validSlots.map((s) => ({ date: s.date, time: s.time, label: s.label || undefined })) }),
      });
      if (!res.ok) { const e = await res.json() as { error?: string }; toast({ title: e.error ?? "Could not propose slots", variant: "destructive" }); return; }
      setDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["shadow-teacher-my-request"] });
    } finally { setProposing(false); }
  }

  async function markDone() {
    setMarkingDone(true);
    try {
      const res = await fetchWithAuth(`/api/shadow-teacher/${matchId}/candidates/${candidate.id}/mark-interview-done`, { method: "POST" });
      if (!res.ok) { const e = await res.json() as { error?: string }; toast({ title: e.error ?? "Could not mark interview done", variant: "destructive" }); return; }
      queryClient.invalidateQueries({ queryKey: ["shadow-teacher-my-request"] });
    } finally { setMarkingDone(false); }
  }

  let proposedSlots: InterviewSlot[] = [];
  if (candidate.interviewSlotsJson) {
    try { proposedSlots = JSON.parse(candidate.interviewSlotsJson) as InterviewSlot[]; } catch { /* ignore malformed */ }
  }

  return (
    <div className="border-t border-gray-100 pt-3 space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Interview</p>

      {candidate.interviewDoneAt ? (
        <div className="w-full text-center text-xs font-semibold px-2.5 py-2 rounded-xl bg-green-50 text-green-700 border border-green-200">
          Interview Complete ✓
        </div>
      ) : candidate.interviewConfirmedSlot ? (
        <div className="space-y-2">
          <div className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800 space-y-1">
            <p className="font-semibold">Confirmed: {candidate.interviewConfirmedSlot}</p>
            {candidate.meetLink && (
              <a
                href={candidate.meetLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 w-full h-9 rounded-lg bg-[#2EC4A5] hover:bg-[#26a88d] text-white font-semibold text-xs no-underline mt-1"
              >
                <Video size={13} />
                Join Interview
              </a>
            )}
          </div>
          <button
            onClick={() => void markDone()}
            disabled={markingDone}
            className="w-full flex items-center justify-center gap-1.5 text-xs bg-[#1A2340] text-white rounded-xl py-2 font-semibold hover:bg-[#2a3660] disabled:opacity-50"
          >
            {markingDone ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            Mark Interview Done
          </button>
        </div>
      ) : candidate.interviewSlotsJson ? (
        <div className="space-y-1.5">
          <div className="w-full text-center text-xs font-semibold px-2.5 py-2 rounded-xl bg-amber-50 text-amber-700 border border-amber-200">
            Awaiting teacher's confirmation…
          </div>
          <button
            onClick={() => { setSlots(proposedSlots.length > 0 ? proposedSlots : [{ date: "", time: "", label: "" }]); setDialogOpen(true); }}
            className="w-full text-[11px] text-gray-500 hover:text-[#2EC4A5] underline underline-offset-2"
          >
            Propose different slots
          </button>
        </div>
      ) : (
        <button
          onClick={() => setDialogOpen(true)}
          className="w-full flex items-center justify-center gap-1.5 text-xs bg-[#2EC4A5] text-white rounded-xl py-2 font-semibold hover:bg-[#26a88d]"
          data-testid="button-schedule-interview"
        >
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
            <p className="text-xs text-gray-500">Suggest up to 3 date/time options. The teacher will confirm one.</p>
            {slots.map((slot, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input type="date" value={slot.date} onChange={(e) => updateSlot(i, "date", e.target.value)}
                  className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-[#2EC4A5]" />
                <input type="time" value={slot.time} onChange={(e) => updateSlot(i, "time", e.target.value)}
                  className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-[#2EC4A5]" />
                {slots.length > 1 && (
                  <button onClick={() => removeSlot(i)} className="text-gray-300 hover:text-red-500 shrink-0">
                    <XCircle size={16} />
                  </button>
                )}
              </div>
            ))}
            {slots.length < 3 && (
              <button onClick={addSlot} className="text-[11px] text-[#2EC4A5] hover:underline">+ Add another slot</button>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white rounded-xl"
              disabled={proposing}
              onClick={() => void proposeInterview()}
            >
              {proposing ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
              Propose Slots
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── TrialRequestSection — Task 3d: negotiate trial length, then hand off to
// the existing (unchanged) trial-payment flow via onBookTrialPayment ───────
function TrialRequestSection({
  matchId, candidate, baseTrialFeeInr, onBookTrialPayment, bookingTrial,
}: {
  matchId: number;
  candidate: Candidate;
  baseTrialFeeInr: number;
  onBookTrialPayment: (professionalId: number) => void;
  bookingTrial: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [trialDays, setTrialDays] = useState(1);
  const [requesting, setRequesting] = useState(false);

  async function requestTrial() {
    setRequesting(true);
    try {
      const res = await fetchWithAuth(`/api/shadow-teacher/${matchId}/candidates/${candidate.id}/request-trial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trialDays }),
      });
      if (!res.ok) { const e = await res.json() as { error?: string }; toast({ title: e.error ?? "Could not request trial", variant: "destructive" }); return; }
      queryClient.invalidateQueries({ queryKey: ["shadow-teacher-my-request"] });
    } finally { setRequesting(false); }
  }

  if (candidate.trialDaysAccepted != null) {
    return (
      <div className="border-t border-gray-100 pt-3 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Trial</p>
        <div className="w-full text-center text-xs font-semibold px-2.5 py-2 rounded-xl bg-green-50 text-green-700 border border-green-200">
          Trial: {candidate.trialDaysAccepted} day{candidate.trialDaysAccepted > 1 ? "s" : ""} confirmed
        </div>
        <button
          onClick={() => onBookTrialPayment(candidate.professionalId)}
          disabled={bookingTrial}
          className="w-full flex items-center justify-center gap-1.5 text-xs bg-orange-500 hover:bg-orange-600 text-white rounded-xl py-2 font-semibold disabled:opacity-50"
        >
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
        <div className="w-full text-center text-xs font-semibold px-2.5 py-2 rounded-xl bg-amber-50 text-amber-700 border border-amber-200">
          Awaiting teacher confirmation…
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-gray-100 pt-3 space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Request Trial</p>
      <div className="flex gap-1.5">
        {[1, 2, 3].map((n) => (
          <button
            key={n}
            onClick={() => setTrialDays(n)}
            className={`flex-1 text-xs font-semibold py-1.5 rounded-lg border ${trialDays === n ? "bg-[#2EC4A5] text-white border-[#2EC4A5]" : "bg-white text-gray-600 border-gray-200"}`}
          >
            {n} day{n > 1 ? "s" : ""}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-gray-500 text-center">
        ₹{baseTrialFeeInr.toLocaleString("en-IN")} × {trialDays} = ₹{(baseTrialFeeInr * trialDays).toLocaleString("en-IN")}
      </p>
      <button
        onClick={() => void requestTrial()}
        disabled={requesting}
        className="w-full flex items-center justify-center gap-1.5 text-xs bg-orange-500 hover:bg-orange-600 text-white rounded-xl py-2 font-semibold disabled:opacity-50"
        data-testid="button-request-trial"
      >
        {requesting ? <Loader2 size={13} className="animate-spin" /> : <Star size={13} />}
        Request Trial
      </button>
    </div>
  );
}

function CandidateCard({
  candidate,
  matchId,
  committed,
  myUserId,
  selected,
  onChoose,
  onNotInterested,
  onBookTrialPayment,
  bookingTrial,
  baseTrialFeeInr,
  trialMode,
  matchStatus,
}: {
  candidate: Candidate;
  matchId: number;
  committed: boolean;
  myUserId: number;
  selected: boolean;
  onChoose: (professionalId: number) => void;
  onNotInterested?: (candidateId: number) => void;
  onBookTrialPayment?: (professionalId: number) => void;
  bookingTrial?: boolean;
  baseTrialFeeInr: number;
  trialMode?: boolean;
  matchStatus?: string;
}) {
  const [chatOpen, setChatOpen] = useState(false);
  const p = candidate.profile;
  const displayName = committed && p.fullName ? p.fullName : (p.firstName ?? `Teacher #${candidate.rank}`);

  // Share the same query key as OfferSection — React Query deduplicates, no extra request.
  const { data: cardOffers = [] } = useQuery<NegotiationOffer[]>({
    queryKey: ["offers", matchId, candidate.id],
    queryFn: () => fetchWithAuth(`/api/shadow-teacher/${matchId}/candidates/${candidate.id}/offers`).then(r => r.json() as Promise<NegotiationOffer[]>),
    enabled: myUserId > 0 && !committed && !trialMode && !!matchStatus && ["shortlisted", "trial_done"].includes(matchStatus ?? ""),
    refetchInterval: 15_000,
  });
  const myPendingOffer = cardOffers.find(o => o.status === "pending" && o.raisedByUserId === myUserId);

  return (
    <>
      <div className={`bg-white border rounded-2xl p-4 shadow-sm space-y-3 ${selected ? "border-[#2EC4A5]" : "border-gray-100"}`}>
        <div className="flex items-start gap-3">
          <ProfessionalAvatar avatarUrl={p.avatarUrl} fullName={displayName} size="md" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="font-bold text-[#1A2340] text-base leading-tight">{displayName}</p>
              {p.verificationStatus === "verified" && (
                <BadgeCheck size={15} className="text-[#2EC4A5] shrink-0" />
              )}
              {candidate.addedBy === "admin" && (
                <span className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded border border-purple-200">Admin pick</span>
              )}
              <ScoreBadge score={candidate.score} />
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Shadow Teacher
              {p.yearsExperience > 0 && ` · ${p.yearsExperience} ${p.yearsExperience === 1 ? "yr" : "yrs"} experience`}
            </p>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              {p.city && (
                <span className="text-[11px] text-gray-400 flex items-center gap-1">
                  <MapPin size={10} />{p.displayArea ?? p.city}
                </span>
              )}
              {p.averageRating && (
                <span className="text-[11px] text-gray-400 flex items-center gap-1">
                  <Star size={10} className="fill-[#FFB830] text-[#FFB830]" />{p.averageRating.toFixed(1)}
                </span>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs text-gray-400">Expected</p>
            <p className="text-sm font-bold text-[#1A2340]">
              {candidate.expectedSalaryMin == null && candidate.expectedSalaryMax == null
                ? "Salary TBD"
                : `₹${(candidate.expectedSalaryMin ?? 0).toLocaleString("en-IN")}${
                    candidate.expectedSalaryMax && candidate.expectedSalaryMax !== candidate.expectedSalaryMin
                      ? `–₹${candidate.expectedSalaryMax.toLocaleString("en-IN")}`
                      : ""
                  }/month`}
            </p>
          </div>
        </div>

        {!committed && !trialMode && (
          <SendRequestBlock matchId={matchId} candidate={candidate} />
        )}

        {!committed && !trialMode && (
          <InterviewSection matchId={matchId} candidate={candidate} />
        )}

        {p.bio && <p className="text-xs text-gray-500 line-clamp-2">{p.bio}</p>}

        <div className="flex flex-wrap gap-2">
          {p.offersHomeVisits && (
            <span className="text-[10px] px-2 py-0.5 bg-[#2EC4A5]/10 text-[#2EC4A5] rounded-full">Home visits</span>
          )}
          {(p.languages ?? []).slice(0, 3).map((l) => (
            <span key={l} className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full flex items-center gap-1">
              <Languages size={9} />{l}
            </span>
          ))}
        </div>

        {committed && p.phone && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-xs space-y-1">
            <p className="font-semibold text-green-800">Contact revealed</p>
            {p.phone && <p className="text-green-700">📞 {p.phone}</p>}
            {p.email && <p className="text-green-700">✉️ {p.email}</p>}
          </div>
        )}

        {/* Task 3c — negotiation only unlocks once the interview is marked done,
            regardless of requestStatus or match status. */}
        {!committed && !trialMode && matchStatus && candidate.interviewDoneAt != null && (
          <OfferSection
            matchId={matchId}
            candidateId={candidate.id}
            myUserId={myUserId}
            matchStatus={matchStatus}
          />
        )}

        {!committed && !trialMode && candidate.interviewDoneAt != null && (
          <TrialRequestSection
            matchId={matchId}
            candidate={candidate}
            baseTrialFeeInr={baseTrialFeeInr}
            onBookTrialPayment={onBookTrialPayment ?? (() => {})}
            bookingTrial={!!bookingTrial}
          />
        )}

        <div className="flex gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            className="gap-1 text-xs flex-1 border-[#2EC4A5] text-[#2EC4A5] hover:bg-[#2EC4A5]/10 rounded-xl"
            onClick={() => setChatOpen(true)}
          >
            <MessageSquare size={12} />
            Chat
          </Button>
          {!committed && !trialMode && (
            myPendingOffer ? (
              <div className="flex-1 rounded-xl border border-amber-200 bg-amber-50 px-2 py-2 text-center text-[10px] font-medium text-amber-800 leading-tight">
                Waiting for {displayName} to accept your offer of ₹{myPendingOffer.amountInr.toLocaleString("en-IN")} before you can commit
              </div>
            ) : (
              <Button
                size="sm"
                className="gap-1 text-xs flex-1 bg-[#2EC4A5] hover:bg-[#26a88d] text-white rounded-xl"
                onClick={() => onChoose(candidate.professionalId)}
              >
                <ChevronRight size={12} />
                Choose
              </Button>
            )
          )}
        </div>
        {!committed && !trialMode && !selected && onNotInterested && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl mt-1"
            onClick={() => onNotInterested(candidate.id)}
          >
            Not interested
          </Button>
        )}
      </div>

      {chatOpen && (
        <ShadowMatchChatDrawer
          matchId={matchId}
          candidateId={candidate.id}
          candidateName={displayName}
          committed={committed && selected}
          myUserId={myUserId}
          onClose={() => setChatOpen(false)}
        />
      )}
    </>
  );
}

export function ShadowTeacherRequestWidget() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: me } = useGetMe();

  // Global child context is the single source of truth for which child is active.
  const { selectedChildId, childrenLoading } = useSelectedChild();

  const { data: match, isLoading: loadingMatch, refetch } = useMyMatch(selectedChildId);
  const { data: children = [], isLoading: loadingChildrenLocal } = useChildren();
  const { data: pricing } = useMatchingFee();
  const matchingFee = pricing?.matchingFeeInr ?? 500;
  const trialFee = pricing?.trialFeeInr ?? 500;

  // Use children from the local hook for full field coverage (city, conditions, etc.)
  // selectedChildId comes from context — no internal child-selection state.
  const loadingChildren = childrenLoading || loadingChildrenLocal;

  // Compute effectiveChildId at component level so eligibility query can use it.
  const effectiveChildIdForEligibility = selectedChildId ?? match?.childId ?? null;
  const hasActiveMatch = !!match && !["cancelled", "refunded"].includes(match.status);

  // Re-request waiver eligibility — only queried when there is no active match.
  const { data: eligibility } = useQuery<{
    waived: boolean;
    childName: string;
    previousMatch: { extraNotes: string | null; childGoalsAreas: string[] | null; childPreferredModes: string[] | null } | null;
  }>({
    queryKey: ["re-request-eligibility", effectiveChildIdForEligibility],
    queryFn: () =>
      fetchWithAuth(`/api/shadow-teacher/re-request-eligibility?childId=${effectiveChildIdForEligibility}`)
        .then((r) => r.json()),
    enabled: !!effectiveChildIdForEligibility && !hasActiveMatch,
    staleTime: 30_000,
  });

  const [extraNotes, setExtraNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Pre-fill extra notes from the most recent previous request when the eligibility data loads.
  useEffect(() => {
    const prev = eligibility?.previousMatch?.extraNotes;
    if (prev) setExtraNotes((current) => current || prev);
  }, [eligibility]);
  const [choosingId, setChoosingId] = useState<number | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [requestingTrial, setRequestingTrial] = useState(false);
  const [markingTrialDone, setMarkingTrialDone] = useState(false);
  const [noCommitting, setNoCommitting] = useState(false);

  // Commit date-picker dialog state
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [commitProfId, setCommitProfId] = useState<number | null>(null);
  const [commitStartDate, setCommitStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [commitAcknowledged, setCommitAcknowledged] = useState(false);
  const [commitTermsChecked, setCommitTermsChecked] = useState(false);

  // Trial booking modal state
  const [trialModalOpen, setTrialModalOpen] = useState(false);
  const [trialModalProfId, setTrialModalProfId] = useState<number | null>(null);
  const [trialPreMeetingChecked, setTrialPreMeetingChecked] = useState(false);
  const [trialPreMeetingNote, setTrialPreMeetingNote] = useState("");
  const [trialLocation, setTrialLocation] = useState("");

  // Direct-pay trial flow state (admin-flag trialDirectPayEnabled — parent pays teacher's UPI directly)
  const [directPayInfo, setDirectPayInfo] = useState<{
    professionalId: number;
    upiVpa: string;
    teacherName: string;
    trialFeeInr: number;
    preMeetingRequested: boolean;
    preMeetingNote: string | null;
    trialLoc: string | null;
  } | null>(null);
  const [markingDirectPayPaid, setMarkingDirectPayPaid] = useState(false);

  const status = match?.status ?? null;
  const isActive = status && !["cancelled", "refunded"].includes(status);
  const committed = status === "committed";

  // ── handleSubmit — calls /request, opens Razorpay modal, then verifies ──
  // selectedChildId comes from global SelectedChildContext.
  // Falls back to match.childId when resuming an existing pending_payment.
  async function handleSubmit() {
    const effectiveChildId = selectedChildId ?? match?.childId ?? null;
    if (!effectiveChildId) { toast({ title: "Please select a child profile from the child switcher above", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      const res = await fetchWithAuth("/api/shadow-teacher/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childId: effectiveChildId, extraNotes: extraNotes.trim() || undefined }),
      });
      const data = await res.json() as {
        error?: string;
        matchId?: number;
        waived?: boolean;
        orderId?: string;
        providerOrderId?: string;
        amount?: number;
        keyId?: string;
      };

      if (!res.ok && res.status !== 409) {
        toast({ title: data.error ?? "Could not submit request", variant: "destructive" });
        return;
      }

      // Waived path: no Razorpay step — candidates were already surfaced server-side
      if (res.ok && data.waived) {
        toast({ title: "Request submitted!", description: "We're finding matched teachers for you." });
        queryClient.invalidateQueries({ queryKey: ["shadow-teacher-my-request"] });
        await refetch();
        return;
      }

      // Both 201 (new match) and 409 pending_payment return order fields for the modal
      const orderId = data.orderId ?? data.providerOrderId;
      if (!orderId || !data.amount || !data.keyId || !data.matchId) {
        // 409 for a non-pending_payment active request
        toast({ title: "You already have an active request", description: "Refreshing your status…" });
        await refetch();
        return;
      }

      // Only load Razorpay after confirming we have a payable (non-waived) order
      const loaded = await loadRazorpayScript();
      if (!loaded) { toast({ title: "Payment gateway unavailable", variant: "destructive" }); return; }

      const matchId = data.matchId;
      await new Promise<void>((resolve, reject) => {
        const rzp = new window.Razorpay({
          key: data.keyId!,
          amount: data.amount!,
          currency: "INR",
          order_id: orderId,
          name: "Includly",
          description: "Shadow teacher matching fee",
          handler: async (response: RazorpayPaymentResponse) => {
            try {
              const vRes = await fetchWithAuth(`/api/shadow-teacher/${matchId}/verify-request-payment`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  razorpayOrderId: response.razorpay_order_id,
                  razorpayPaymentId: response.razorpay_payment_id,
                  razorpaySignature: response.razorpay_signature,
                }),
              });
              if (!vRes.ok) {
                const vd = await vRes.json() as { error?: string };
                toast({ title: vd.error ?? "Payment verification failed", variant: "destructive" });
                reject(new Error("verify"));
                return;
              }
              const vd = await vRes.json() as { candidateCount?: number };
              toast({ title: "Payment confirmed!", description: `Found ${vd.candidateCount ?? 0} teacher${vd.candidateCount === 1 ? "" : "s"} for you.` });
              queryClient.invalidateQueries({ queryKey: ["shadow-teacher-my-request"] });
              await refetch();
              resolve();
            } catch { reject(new Error("verify")); }
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

  // ── handleChoose — commit to a teacher (placement fee charged via Razorpay) ──
  async function handleChoose(professionalId: number, startDate?: string) {
    if (!match) return;
    setChoosingId(professionalId);
    try {
      const orderRes = await fetchWithAuth(`/api/shadow-teacher/${match.id}/commit/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedProfessionalId: professionalId, startDate, termsAcknowledged: true }),
      });
      const orderData = await orderRes.json() as {
        error?: string; message?: string; engagementId?: number;
        waived?: boolean; orderId?: string; amount?: number; keyId?: string;
      };
      if (!orderRes.ok) {
        if (orderRes.status === 409) {
          toast({ title: "Cannot choose teacher", description: orderData.message ?? orderData.error, variant: "destructive" });
        } else {
          toast({ title: orderData.error ?? "Could not select teacher", variant: "destructive" });
        }
        return;
      }

      // Placement fee waived (admin set it to ₹0) — engagement already created.
      if (orderData.waived) {
        toast({ title: "Teacher confirmed!", description: "Your start code is now visible in the Engagement tab." });
        queryClient.invalidateQueries({ queryKey: ["parent-engagements"] });
        queryClient.invalidateQueries({ queryKey: ["shadow-teacher-my-request"] });
        await refetch();
        return;
      }

      if (!orderData.orderId || !orderData.amount || !orderData.keyId) {
        toast({ title: "Invalid payment response", variant: "destructive" });
        return;
      }

      const loaded = await loadRazorpayScript();
      if (!loaded) { toast({ title: "Payment gateway unavailable", variant: "destructive" }); return; }

      await new Promise<void>((resolve, reject) => {
        const rzp = new window.Razorpay({
          key: orderData.keyId!,
          amount: orderData.amount!,
          currency: "INR",
          order_id: orderData.orderId!,
          name: "Includly",
          description: "Shadow teacher placement fee",
          handler: async (response: RazorpayPaymentResponse) => {
            try {
              const vRes = await fetchWithAuth(`/api/shadow-teacher/${match.id}/commit/verify`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  razorpayOrderId: response.razorpay_order_id,
                  razorpayPaymentId: response.razorpay_payment_id,
                  razorpaySignature: response.razorpay_signature,
                  termsAcknowledged: true,
                }),
              });
              const vd = await vRes.json() as { error?: string; message?: string; engagementId?: number };
              if (!vRes.ok) {
                toast({ title: vd.message ?? vd.error ?? "Payment verification failed", variant: "destructive" });
                reject(new Error("verify"));
                return;
              }
              toast({ title: "Teacher confirmed!", description: "Your start code is now visible in the Engagement tab." });
              queryClient.invalidateQueries({ queryKey: ["parent-engagements"] });
              queryClient.invalidateQueries({ queryKey: ["shadow-teacher-my-request"] });
              await refetch();
              resolve();
            } catch { reject(new Error("verify")); }
          },
          modal: { ondismiss: () => reject(new Error("dismissed")) },
        });
        rzp.open();
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg !== "dismissed") toast({ title: "Could not select teacher", description: msg, variant: "destructive" });
      await refetch();
    } finally {
      setChoosingId(null);
    }
  }

  // ── handleNotInterested — soft-remove candidate, triggers server-side auto-refill ──
  async function handleNotInterested(candidateId: number) {
    if (!match) return;
    try {
      const res = await fetchWithAuth(`/api/shadow-teacher/${match.id}/mark-not-interested`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        toast({ title: d.error ?? "Could not dismiss candidate", variant: "destructive" });
        return;
      }
      await refetch();
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    }
  }

  // ── handleRequestTrial — pay trial fee → trial_pending ──────────────────
  // Called from the modal's confirm button with pre-meeting preferences.
  async function handleRequestTrial(professionalId: number, preMeetingRequested: boolean, preMeetingNote: string | null, trialLoc: string | null) {
    if (!match) return;
    setTrialModalOpen(false);
    setRequestingTrial(true);
    try {
      const res = await fetchWithAuth(`/api/shadow-teacher/${match.id}/request-trial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedProfessionalId: professionalId }),
      });
      const data = await res.json() as {
        error?: string; message?: string; matchId?: number; orderId?: string; amount?: number; keyId?: string;
        directPay?: boolean; blocked?: boolean; trialFeeInr?: number; upiVpa?: string; teacherName?: string;
      };
      if (!res.ok) {
        toast({ title: data.message ?? data.error ?? "Could not initiate trial", variant: "destructive" });
        return;
      }

      // ── Direct-pay branch: no Razorpay order — parent pays teacher's UPI directly ──
      if (data.directPay) {
        if (data.blocked) {
          toast({
            title: "Almost ready",
            description: "We've prompted your teacher to finalize their payment details. Please try again in a few minutes.",
          });
          return;
        }
        setDirectPayInfo({
          professionalId,
          upiVpa: data.upiVpa!,
          teacherName: data.teacherName ?? "your teacher",
          trialFeeInr: data.trialFeeInr ?? 500,
          preMeetingRequested,
          preMeetingNote,
          trialLoc,
        });
        return;
      }

      const loaded = await loadRazorpayScript();
      if (!loaded) { toast({ title: "Payment gateway unavailable", variant: "destructive" }); return; }

      if (!data.orderId || !data.amount || !data.keyId) {
        toast({ title: "Invalid payment response", variant: "destructive" });
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const rzp = new window.Razorpay({
          key: data.keyId!,
          amount: data.amount!,
          currency: "INR",
          order_id: data.orderId!,
          name: "Includly",
          description: "Shadow teacher trial day fee",
          handler: async (response: RazorpayPaymentResponse) => {
            try {
              const vRes = await fetchWithAuth(`/api/shadow-teacher/${match.id}/verify-trial-payment`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  razorpayOrderId: response.razorpay_order_id,
                  razorpayPaymentId: response.razorpay_payment_id,
                  razorpaySignature: response.razorpay_signature,
                  selectedProfessionalId: professionalId,
                  preMeetingRequested,
                  preMeetingNote,
                  trialLocation: trialLoc,
                }),
              });
              if (!vRes.ok) {
                const vd = await vRes.json() as { error?: string };
                toast({ title: vd.error ?? "Payment verification failed", variant: "destructive" });
                reject(new Error("verify"));
                return;
              }
              toast({ title: "Trial day booked!", description: "Coordinate with the teacher to schedule the trial day." });
              queryClient.invalidateQueries({ queryKey: ["shadow-teacher-my-request"] });
              await refetch();
              resolve();
            } catch { reject(new Error("verify")); }
          },
          modal: { ondismiss: () => reject(new Error("dismissed")) },
        });
        rzp.open();
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg !== "dismissed") toast({ title: "Trial request failed", description: msg, variant: "destructive" });
      await refetch();
    } finally {
      setRequestingTrial(false);
    }
  }

  // ── handleConfirmDirectPayPaid — parent confirms they paid the teacher's UPI directly ──
  async function handleConfirmDirectPayPaid() {
    if (!match || !directPayInfo) return;
    setMarkingDirectPayPaid(true);
    try {
      const res = await fetchWithAuth(`/api/shadow-teacher/${match.id}/mark-trial-direct-pay-paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectedProfessionalId: directPayInfo.professionalId,
          preMeetingRequested: directPayInfo.preMeetingRequested,
          preMeetingNote: directPayInfo.preMeetingNote,
          trialLocation: directPayInfo.trialLoc,
        }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string; message?: string };
        toast({ title: d.message ?? d.error ?? "Could not confirm payment", variant: "destructive" });
        return;
      }
      toast({ title: "Trial day booked!", description: "Coordinate with the teacher to schedule the trial day." });
      setDirectPayInfo(null);
      queryClient.invalidateQueries({ queryKey: ["shadow-teacher-my-request"] });
      await refetch();
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setMarkingDirectPayPaid(false);
    }
  }

  // ── handleMarkTrialDone — parent marks trial as complete ─────────────────
  async function handleMarkTrialDone() {
    if (!match) return;
    setMarkingTrialDone(true);
    try {
      const res = await fetchWithAuth(`/api/shadow-teacher/${match.id}/mark-trial-done`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        toast({ title: d.error ?? "Could not mark trial done", variant: "destructive" });
        return;
      }
      toast({ title: "Trial marked complete!", description: "You can now commit to this teacher or walk away." });
      queryClient.invalidateQueries({ queryKey: ["shadow-teacher-my-request"] });
      await refetch();
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setMarkingTrialDone(false);
    }
  }

  // ── handleNoCommit — parent walks away after trial ───────────────────────
  async function handleNoCommit() {
    if (!match) return;
    setNoCommitting(true);
    try {
      const res = await fetchWithAuth(`/api/shadow-teacher/${match.id}/no-commit`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        toast({ title: d.error ?? "Could not process walk-away", variant: "destructive" });
        return;
      }
      toast({ title: "Request closed", description: "The trial fee is non-refundable. You can submit a new request any time." });
      queryClient.invalidateQueries({ queryKey: ["shadow-teacher-my-request"] });
      await refetch();
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setNoCommitting(false);
    }
  }

  // ── handleRefund — server re-checks all 3 conditions before initiating ──
  async function handleRefund() {
    if (!match) return;
    setRefunding(true);
    try {
      const res = await fetchWithAuth(`/api/shadow-teacher/${match.id}/refund`, { method: "POST" });
      const data = await res.json() as { error?: string; reason?: string; daysRemaining?: number; refunded?: boolean; amount?: number };
      if (!res.ok) {
        const reasonMsg: Record<string, string> = {
          already_committed_or_closed: "This request is already closed or a teacher was confirmed.",
          three_or_more_teachers_shown: "You've been shown 3+ teachers, so the matching fee is non-refundable.",
          window_not_elapsed: `${data.daysRemaining ?? ""} day${data.daysRemaining === 1 ? "" : "s"} remaining before you can request a refund.`,
          fee_payment_not_recorded: "Payment record not found. Please contact support.",
          no_payment_to_refund: "No payment found to refund. Please contact support.",
        };
        const msg = (data.reason && reasonMsg[data.reason]) ?? data.error ?? "Refund could not be processed";
        toast({ title: "Refund not available", description: msg, variant: "destructive" });
        return;
      }
      toast({ title: "Refund initiated", description: `₹${(data.amount ?? 0).toLocaleString("en-IN")} will be returned within 5–7 business days.` });
      await refetch();
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setRefunding(false);
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

  // ── New request form ─────────────────────────────────────────────────────
  if (!isActive) {
    return (
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-5">
        <div className="flex items-center gap-2">
          <UserCheck size={20} className="text-primary" />
          <h2 className="font-serif font-semibold text-lg text-foreground">Find a Shadow Teacher</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          A shadow teacher provides one-on-one support in inclusive classrooms or at home. Select your child's profile and we'll match you with the best available teachers — for free.
        </p>

        {children.length === 0 ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
            You haven't added a child profile yet. <a href="/dashboard" className="underline font-medium">Add your child</a> first so we can pre-fill their details.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Selected child display — controlled by the global child switcher, not a local dropdown */}
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground mb-0.5">Finding a shadow teacher for</p>
              <p className="text-sm font-medium text-foreground">{selectedChild?.name ?? "—"}</p>
              {children.length > 1 && (
                <p className="text-[11px] text-muted-foreground mt-1">To request for a different child, switch at the top of the page.</p>
              )}
            </div>

            {selectedChild && (
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 text-xs space-y-1.5">
                <p className="font-semibold text-foreground text-[11px] uppercase tracking-wide">Matching will use</p>
                {selectedChild.city && <p className="text-muted-foreground">📍 City: {selectedChild.city}</p>}
                {selectedChild.conditions?.length ? <p className="text-muted-foreground">🏥 Conditions: {selectedChild.conditions.join(", ")}</p> : null}
                {selectedChild.languages?.length ? <p className="text-muted-foreground">🗣️ Languages: {selectedChild.languages.join(", ")}</p> : null}
                {(selectedChild.budgetMinInr || selectedChild.budgetMaxInr) && (
                  <p className="text-muted-foreground">💰 Budget: ₹{selectedChild.budgetMinInr?.toLocaleString("en-IN") ?? "?"} – ₹{selectedChild.budgetMaxInr?.toLocaleString("en-IN") ?? "?"}/mo</p>
                )}
                {selectedChild.preferredModes?.length ? <p className="text-muted-foreground">🏠 Modes: {selectedChild.preferredModes.join(", ")}</p> : null}
              </div>
            )}

            {eligibility?.waived && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-start gap-2.5">
                <CheckCircle2 size={15} className="text-green-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-green-800">Matching fee waived ✓</p>
                  <p className="text-xs text-green-700 mt-0.5 leading-relaxed">
                    You paid within the last 3 months for {eligibility.childName}. Confirm your details to get matched — no payment needed.
                  </p>
                </div>
              </div>
            )}

            <div>
              <Label className="text-sm mb-1.5 block">Anything else to tell us? <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea
                placeholder="School type, specific goals, timing preferences…"
                value={extraNotes}
                onChange={(e) => setExtraNotes(e.target.value)}
                rows={3}
                className="resize-none text-sm"
              />
            </div>
          </div>
        )}

        <Button
          className="w-full gap-2"
          onClick={handleSubmit}
          disabled={submitting || selectedChildId === null || children.length === 0}
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <IndianRupee size={14} />}
          {submitting
            ? (eligibility?.waived ? "Submitting…" : "Opening payment…")
            : eligibility?.waived
              ? "Confirm & Get Matched — Free"
              : `Find My Shadow Teacher — ₹${matchingFee.toLocaleString("en-IN")}`}
        </Button>

        {!eligibility?.waived && (
          <p className="text-[11px] text-center text-muted-foreground">
            A one-time matching fee of ₹{matchingFee.toLocaleString("en-IN")} is charged now. Choosing your teacher later is free.
          </p>
        )}
      </div>
    );
  }

  // ── Pending payment: existing unpaid order → reopen Razorpay modal ────────
  if (status === "pending_payment" && match) {
    return (
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <Clock size={18} className="text-amber-500" />
          <h2 className="font-serif font-semibold text-lg text-foreground">Complete Your Payment</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Your matching request is ready — complete the ₹{matchingFee.toLocaleString("en-IN")} payment to see your matched teachers.
        </p>
        <Button
          className="w-full gap-2 bg-[#2EC4A5] hover:bg-[#26a88d] text-white"
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <IndianRupee size={14} />}
          {submitting ? "Opening payment…" : `Pay ₹${matchingFee.toLocaleString("en-IN")} to see teachers`}
        </Button>
        <p className="text-[11px] text-center text-muted-foreground">
          Your request details are saved. Tap the button to continue where you left off.
        </p>
      </div>
    );
  }

  // ── Trial pending: trial day scheduled ───────────────────────────────────
  if (status === "trial_pending" && match) {
    const myId = me?.id ?? 0;
    const trialCandidate = match.candidates.find((c) => c.professionalId === match.selectedProfessionalId);
    const trialName = trialCandidate
      ? (trialCandidate.profile.firstName ?? `Teacher #${trialCandidate.rank}`)
      : "your selected teacher";
    return (
      <div className="space-y-4">
        {match.trialStartOtp && (
          <div className="bg-indigo-50 border-2 border-indigo-300 rounded-2xl p-5 text-center space-y-2">
            <p className="text-xs font-semibold text-indigo-600 uppercase tracking-widest">Trial Start Code</p>
            <p className="text-5xl font-mono font-bold tracking-[0.25em] text-indigo-900 select-all">
              {match.trialStartOtp}
            </p>
            <p className="text-xs text-indigo-600">Show this to {trialName} — they will enter it to begin the trial</p>
          </div>
        )}
        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Star size={18} className="text-orange-500" />
            <p className="font-semibold text-orange-800">Trial day with {trialName} is awaiting start</p>
          </div>
          <p className="text-sm text-orange-700">
            Share the code above with {trialName}. Once they enter it, the trial day officially begins.
            The fee of ₹{trialFee.toLocaleString("en-IN")} will be credited to the first month if you commit.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2 border-orange-300 text-orange-700 hover:bg-orange-100 rounded-xl"
            onClick={handleMarkTrialDone}
            disabled={markingTrialDone}
          >
            {markingTrialDone ? <Loader2 size={14} className="animate-spin" /> : null}
            {markingTrialDone ? "Marking…" : "Mark trial done manually (fallback)"}
          </Button>
        </div>
        {trialCandidate && (
          <CandidateCard
            candidate={trialCandidate}
            matchId={match.id}
            committed={false}
            myUserId={myId}
            selected
            onChoose={() => {}}
            baseTrialFeeInr={trialFee}
            trialMode
          />
        )}
      </div>
    );
  }

  // ── Trial started: teacher entered start OTP — show end OTP ──────────────
  if (status === "trial_started" && match) {
    const myId = me?.id ?? 0;
    const trialCandidate = match.candidates.find((c) => c.professionalId === match.selectedProfessionalId);
    const trialName = trialCandidate
      ? (trialCandidate.profile.firstName ?? `Teacher #${trialCandidate.rank}`)
      : "your selected teacher";
    return (
      <div className="space-y-4">
        {match.trialEndOtp && (
          <div className="bg-indigo-50 border-2 border-indigo-300 rounded-2xl p-5 text-center space-y-2">
            <p className="text-xs font-semibold text-indigo-600 uppercase tracking-widest">Trial End Code</p>
            <p className="text-5xl font-mono font-bold tracking-[0.25em] text-indigo-900 select-all">
              {match.trialEndOtp}
            </p>
            <p className="text-xs text-indigo-600">When the trial day is over, show this to {trialName} to close it</p>
          </div>
        )}
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Star size={18} className="text-indigo-500" />
            <p className="font-semibold text-indigo-800">Trial day is underway with {trialName}</p>
          </div>
          <p className="text-sm text-indigo-700">
            The trial has officially started. At the end of the day, share the code above with {trialName} —
            they will enter it to complete the trial. You&apos;ll then decide whether to commit or walk away.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2 border-indigo-300 text-indigo-700 hover:bg-indigo-100 rounded-xl"
            onClick={handleMarkTrialDone}
            disabled={markingTrialDone}
          >
            {markingTrialDone ? <Loader2 size={14} className="animate-spin" /> : null}
            {markingTrialDone ? "Marking…" : "Mark trial done manually (fallback)"}
          </Button>
        </div>
        {trialCandidate && (
          <CandidateCard
            candidate={trialCandidate}
            matchId={match.id}
            committed={false}
            myUserId={myId}
            selected
            onChoose={() => {}}
            baseTrialFeeInr={trialFee}
            trialMode
          />
        )}
      </div>
    );
  }

  // ── Commit date-picker dialog (rendered in trial_done and shortlisted returns) ──
  const commitCandidate = match?.candidates.find((c) => c.professionalId === commitProfId) ?? null;
  const commitFeeLabel = commitCandidate == null || (commitCandidate.expectedSalaryMin == null && commitCandidate.expectedSalaryMax == null)
    ? "To be confirmed"
    : `₹${(commitCandidate.expectedSalaryMin ?? 0).toLocaleString("en-IN")}${
        commitCandidate.expectedSalaryMax && commitCandidate.expectedSalaryMax !== commitCandidate.expectedSalaryMin
          ? `–₹${commitCandidate.expectedSalaryMax.toLocaleString("en-IN")}`
          : ""
      } (expected — confirmed when the teacher accepts)`;

  const CommitDialog = commitDialogOpen && commitProfId !== null ? (
    <Dialog open onOpenChange={(o) => { if (!o) { setCommitDialogOpen(false); setCommitProfId(null); setCommitAcknowledged(false); setCommitTermsChecked(false); } }}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-[#1A2340]">Pick a Start Date</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="bg-teal-50 border border-teal-200 rounded-xl p-3.5 space-y-2">
            <p className="text-sm font-semibold text-teal-800">Includly&apos;s protections apply only to on-platform engagements</p>
            <p className="text-xs text-teal-700">By keeping this engagement on Includly, you keep:</p>
            <ul className="text-xs text-teal-700 space-y-1 list-disc pl-4">
              <li>Daily attendance &amp; session tracking</li>
              <li>Holiday &amp; leave management</li>
              <li>Your teacher reserved for you — they can&apos;t be matched with other Includly parents while engaged with you</li>
              <li>Dispute mediation and replacement support if things don&apos;t work out</li>
            </ul>
            <p className="text-xs text-teal-700">Taking the engagement off-platform after committing means these protections no longer apply.</p>
          </div>
          <label className="flex items-start gap-2 cursor-pointer text-xs text-[#1A2340]">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-[#2EC4A5] cursor-pointer"
              checked={commitAcknowledged}
              onChange={(e) => setCommitAcknowledged(e.target.checked)}
              data-testid="commit-acknowledge-checkbox"
            />
            <span>I understand — I want to keep this engagement on Includly</span>
          </label>
          <p className="text-sm text-gray-600">When should the engagement begin? The teacher will enter your start code on this date to activate things.</p>
          <input
            type="date"
            min={new Date().toISOString().slice(0, 10)}
            value={commitStartDate}
            onChange={(e) => setCommitStartDate(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2EC4A5]"
          />
          <TermsAcknowledgment
            scheduleSummary={null}
            monthlyFeeLabel={commitFeeLabel}
            startDate={commitStartDate}
            noticePeriodDays={pricing?.noticePeriodDays}
            checked={commitTermsChecked}
            onCheckedChange={setCommitTermsChecked}
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="rounded-xl" onClick={() => { setCommitDialogOpen(false); setCommitProfId(null); setCommitAcknowledged(false); setCommitTermsChecked(false); }}>Cancel</Button>
          <Button
            className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white rounded-xl disabled:opacity-60"
            disabled={choosingId !== null || !commitStartDate || !commitAcknowledged || !commitTermsChecked}
            onClick={async () => {
              const profId = commitProfId!;
              const sd = commitStartDate;
              setCommitDialogOpen(false);
              setCommitProfId(null);
              setCommitAcknowledged(false);
              setCommitTermsChecked(false);
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

  // ── Trial done: commit or walk away ───────────────────────────────────────
  if (status === "trial_done" && match) {
    const myId = me?.id ?? 0;
    const trialCandidate = match.candidates.find((c) => c.professionalId === match.selectedProfessionalId);
    const trialName = trialCandidate
      ? (trialCandidate.profile.firstName ?? `Teacher #${trialCandidate.rank}`)
      : "this teacher";
    return (
      <>{CommitDialog}<div className="space-y-4">
        <div className="bg-teal-50 border border-teal-200 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-teal-600" />
            <p className="font-semibold text-teal-800">Trial day complete — what would you like to do?</p>
          </div>
          <p className="text-sm text-teal-700">
            If you commit to {trialName}, your trial fee of ₹{trialFee.toLocaleString("en-IN")} will be credited against the first month&apos;s salary.
            Walking away closes this request — no refund on the trial fee.
          </p>
          <div className="border-l-4 border-teal-400 bg-white/70 rounded-r-lg px-3 py-2.5 text-xs text-teal-800">
            <span className="font-semibold">💚 When you commit, stay on Includly.</span> You get attendance tracking, leave management, teacher-exclusivity, and dispute support — protections that only apply while the engagement runs on-platform.
          </div>
          <div className="flex gap-3">
            <Button
              className="flex-1 gap-2 bg-[#2EC4A5] hover:bg-[#26a88d] text-white rounded-xl"
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
            <Button
              variant="outline"
              className="flex-1 gap-2 border-red-300 text-red-600 hover:bg-red-50 rounded-xl"
              onClick={handleNoCommit}
              disabled={noCommitting}
            >
              {noCommitting ? <Loader2 size={14} className="animate-spin" /> : null}
              {noCommitting ? "Processing…" : "Not a fit — walk away"}
            </Button>
          </div>
        </div>
        {trialCandidate && (
          <CandidateCard
            candidate={trialCandidate}
            matchId={match.id}
            committed={false}
            myUserId={myId}
            selected
            onChoose={() => {}}
            baseTrialFeeInr={trialFee}
            trialMode
          />
        )}
      </div></>
    );
  }

  // ── Shortlisted: show candidates ─────────────────────────────────────────
  if (status === "shortlisted" && match) {
    const myId = me?.id ?? 0;
    const feePaidAt = match.feePaidAt ? new Date(match.feePaidAt) : null;
    const daysSincePaid = feePaidAt ? (Date.now() - feePaidAt.getTime()) / 86_400_000 : 0;
    const refundEligible = !committed && (match.distinctTeachersShown < 3) && (daysSincePaid >= 60);

    // Task 3d — reflect the negotiated trial length (if any) in the trial-payment
    // modal's fee display. Falls back to the flat base fee (×1) for candidates
    // that never went through the negotiated trial-days flow.
    const trialModalCandidate = match.candidates.find((c) => c.professionalId === trialModalProfId);
    const modalTrialDays = trialModalCandidate?.trialDaysAccepted ?? 1;
    const modalFeeInr = trialFee * modalTrialDays;

    return (
      <>{CommitDialog}<div className="space-y-4">
        <div className="flex items-center gap-2">
          <UserCheck size={18} className="text-primary" />
          <h2 className="font-serif font-semibold text-lg text-foreground">Your Matches</h2>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS.shortlisted}`}>
            {match.candidates.length} candidate{match.candidates.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="bg-teal-50 border border-teal-200 rounded-xl p-3 text-xs text-teal-800">
          <span className="font-semibold">💚 Committing on Includly keeps you protected.</span> Attendance tracking, leave management, teacher-exclusivity, and dispute support only apply to on-platform engagements.
        </div>

        {match.candidates.length === 0 ? (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
            <p className="font-semibold">No candidates yet</p>
            <p className="mt-1 text-xs text-blue-600">Our admin team will add suitable teachers shortly. Check back soon.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {match.candidates.map((c) => (
              <CandidateCard
                key={c.id}
                candidate={c}
                matchId={match.id}
                committed={committed}
                myUserId={myId}
                selected={match.selectedProfessionalId === c.professionalId}
                matchStatus={status}
                onChoose={(proId) => {
                  if (choosingId) return;
                  setCommitProfId(proId);
                  setCommitStartDate(new Date().toISOString().slice(0, 10));
                  setCommitDialogOpen(true);
                }}
                onNotInterested={async (candidateId) => { await handleNotInterested(candidateId); }}
                baseTrialFeeInr={trialFee}
                bookingTrial={requestingTrial}
                onBookTrialPayment={requestingTrial ? () => {} : (proId) => {
                  setTrialModalProfId(proId);
                  setTrialPreMeetingChecked(false);
                  setTrialPreMeetingNote("");
                  setTrialModalOpen(true);
                }}
              />
            ))}
          </div>
        )}

        <p className="text-xs text-center text-muted-foreground">
          Chat with teachers to ask questions. When you're ready, press <strong>Choose</strong> — no extra charge.
        </p>

        {refundEligible && (
          <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 space-y-2">
            <p className="text-xs text-amber-800 font-medium">Refund available</p>
            <p className="text-xs text-amber-700">
              It's been 60+ days and fewer than 3 teachers have been suggested. You can request a full refund of ₹{matchingFee.toLocaleString("en-IN")}.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs border-amber-400 text-amber-800 hover:bg-amber-100"
              onClick={handleRefund}
              disabled={refunding}
            >
              {refunding ? <Loader2 size={12} className="animate-spin mr-1" /> : null}
              {refunding ? "Processing…" : `Get Refund — ₹${matchingFee.toLocaleString("en-IN")}`}
            </Button>
          </div>
        )}

        <Dialog open={trialModalOpen} onOpenChange={setTrialModalOpen}>
          <DialogContent className="max-w-sm rounded-2xl">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-[#1A2340]">Book a Trial Day</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-sm text-orange-800">
                A one-time <strong>₹{modalFeeInr.toLocaleString("en-IN")}</strong>
                {modalTrialDays > 1 ? ` (₹${trialFee.toLocaleString("en-IN")} × ${modalTrialDays} days)` : ""} trial fee will be charged.
                If you commit afterwards, this amount is credited against the first month&apos;s salary.
                The fee is <strong>non-refundable</strong> if you walk away.
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-gray-700">
                  Trial location <span className="font-normal text-gray-400 text-xs">(where will the trial take place?)</span>
                </Label>
                <input
                  type="text"
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-300 bg-white"
                  placeholder="e.g. St. Mary's School, Bandra, Mumbai"
                  maxLength={300}
                  value={trialLocation}
                  onChange={(e) => setTrialLocation(e.target.value)}
                />
              </div>
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="pre-meeting-check"
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-[#2EC4A5] cursor-pointer"
                  checked={trialPreMeetingChecked}
                  onChange={(e) => {
                    setTrialPreMeetingChecked(e.target.checked);
                    if (!e.target.checked) setTrialPreMeetingNote("");
                  }}
                />
                <label htmlFor="pre-meeting-check" className="text-sm text-gray-700 cursor-pointer leading-snug">
                  I&apos;d like a brief call or meeting with this teacher <em>before</em> the trial day
                </label>
              </div>
              {trialPreMeetingChecked && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-gray-600">
                    Anything specific to discuss? <span className="font-normal text-gray-400">(optional)</span>
                  </Label>
                  <Textarea
                    className="text-sm rounded-xl resize-none"
                    rows={3}
                    maxLength={500}
                    placeholder="e.g. I'd like to understand their approach to behaviour management…"
                    value={trialPreMeetingNote}
                    onChange={(e) => setTrialPreMeetingNote(e.target.value)}
                  />
                </div>
              )}
            </div>
            <DialogFooter className="flex gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 rounded-xl"
                onClick={() => setTrialModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white rounded-xl gap-1"
                disabled={requestingTrial}
                onClick={() => {
                  if (!trialModalProfId) return;
                  void handleRequestTrial(
                    trialModalProfId,
                    trialPreMeetingChecked,
                    trialPreMeetingChecked && trialPreMeetingNote.trim() ? trialPreMeetingNote.trim() : null,
                    trialLocation.trim() || null,
                  );
                }}
              >
                <IndianRupee size={13} />
                Pay {"\u20B9"}{modalFeeInr.toLocaleString("en-IN")} {"&"} Book Trial
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {directPayInfo && match && (
          <UpiPayQRDialog
            open={!!directPayInfo}
            onOpenChange={(o) => { if (!o) setDirectPayInfo(null); }}
            vpa={directPayInfo.upiVpa}
            teacherName={directPayInfo.teacherName}
            amountInr={directPayInfo.trialFeeInr}
            note={`Includly trial - ${directPayInfo.teacherName}`}
            txnRef={`inc-t-${match.id}`}
            submitting={markingDirectPayPaid}
            onPaidConfirm={handleConfirmDirectPayPaid}
          />
        )}
      </div>
    </>);
  }

  // ── Committed (brief state before engagement loads) ──────────────────────
  if (status === "committed") {
    return (
      <div className="bg-green-50 border border-green-200 rounded-2xl p-6 text-center space-y-2">
        <CheckCircle2 size={32} className="mx-auto text-green-500" />
        <p className="font-semibold text-green-800">Teacher confirmed!</p>
        <p className="text-sm text-green-600">Your engagement is being set up. Refresh if it doesn't appear below.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1 border-green-300 text-green-700">
          <RefreshCw size={12} /> Refresh
        </Button>
      </div>
    );
  }

  // ── Legacy states (queued / matched / payment states) ───────────────────
  const legacyUI: Record<string, { label: string; icon: React.ReactNode; desc?: string }> = {
    queued: { label: "In queue — finding match", icon: <Clock size={14} />, desc: "Our team is reviewing your requirements. Typical turnaround: 1–3 business days." },
    matched: { label: "Matched!", icon: <CheckCircle2 size={14} /> },
    payment_failed: { label: "Payment failed — try again", icon: <AlertCircle size={14} /> },
  };
  const ui = legacyUI[status ?? ""] ?? { label: status ?? "Unknown", icon: <AlertCircle size={14} /> };

  return (
    <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
      <div className="flex items-center gap-2">
        <UserCheck size={20} className="text-primary" />
        <h2 className="font-serif font-semibold text-lg text-foreground">Shadow Teacher Matching</h2>
      </div>

      <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${STATUS_COLORS[status ?? ""] ?? "bg-gray-100 text-gray-600"}`}>
        {ui.icon}
        {ui.label}
      </div>

      {status === "matched" && match?.matchedProName && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <p className="font-semibold text-green-800 text-sm">Your shadow teacher has been assigned!</p>
          <p className="text-sm text-green-700 mt-1">Specialist: <strong>{match.matchedProName}</strong></p>
          <p className="text-xs text-green-600 mt-2">Our team will be in touch to schedule the first session.</p>
        </div>
      )}

      {status === "queued" && ui.desc && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-sm text-blue-800">{ui.desc}</p>
        </div>
      )}

      {match?.matchingFeeInr != null && match.matchingFeeInr > 0 && (
        <p className="text-xs text-muted-foreground">
          Matching fee paid: ₹{match.matchingFeeInr.toLocaleString("en-IN")}
        </p>
      )}
    </div>
  );
}
