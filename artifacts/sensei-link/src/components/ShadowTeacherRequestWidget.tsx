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
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { fetchWithAuth, getApiBase } from "@/lib/api";
import { loadRazorpayScript, type RazorpayPaymentResponse } from "@/lib/razorpay";
import {
  UserCheck, Loader2, CheckCircle2, Clock, IndianRupee,
  AlertCircle, RefreshCw, MessageSquare, Star, MapPin, Languages,
  ChevronRight, BadgeCheck,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShadowMatchChatDrawer } from "./ShadowMatchChatDrawer";
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
}

interface Candidate {
  id: number;
  professionalId: number;
  score: number | null;
  rank: number;
  addedBy: string;
  profile: CandidateProfile;
  threadId: number | null;
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
  candidates: Candidate[];
}

function useMyMatch() {
  return useQuery<MatchWithCandidates | null>({
    queryKey: ["shadow-teacher-my-request"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/shadow-teacher/my-request");
      const data = await res.json() as MatchWithCandidates | null;
      if (Array.isArray(data) && data.length === 0) return null;
      return (data as MatchWithCandidates) ?? null;
    },
    staleTime: 20_000,
    refetchInterval: 30_000,
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
  return useQuery<{ matchingFeeInr: number }>({
    queryKey: ["shadow-teacher-pricing"],
    queryFn: async () => {
      const res = await fetch(`${getApiBase()}/shadow-teacher/pricing`);
      return res.json() as Promise<{ matchingFeeInr: number }>;
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
};

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return null;
  const color = score >= 70 ? "bg-green-100 text-green-700" : score >= 45 ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-500";
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${color}`}>
      {Math.round(score)}/100
    </span>
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
}: {
  candidate: Candidate;
  matchId: number;
  committed: boolean;
  myUserId: number;
  selected: boolean;
  onChoose: (professionalId: number) => void;
  onNotInterested?: (candidateId: number) => void;
}) {
  const [chatOpen, setChatOpen] = useState(false);
  const p = candidate.profile;
  const displayName = committed && p.fullName ? p.fullName : (p.firstName ?? `Teacher #${candidate.rank}`);

  return (
    <>
      <div className={`bg-white border rounded-2xl p-4 shadow-sm space-y-3 ${selected ? "border-[#2EC4A5]" : "border-gray-100"}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-[#1A2340] text-sm">{displayName}</p>
              {p.verificationStatus === "verified" && (
                <BadgeCheck size={14} className="text-[#2EC4A5] shrink-0" />
              )}
              {candidate.addedBy === "admin" && (
                <span className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded border border-purple-200">Admin pick</span>
              )}
              <ScoreBadge score={candidate.score} />
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {p.city && (
                <span className="text-[11px] text-gray-400 flex items-center gap-1">
                  <MapPin size={10} />{p.displayArea ?? p.city}
                </span>
              )}
              {p.yearsExperience > 0 && (
                <span className="text-[11px] text-gray-400">{p.yearsExperience} yrs exp.</span>
              )}
              {p.averageRating && (
                <span className="text-[11px] text-gray-400 flex items-center gap-1">
                  <Star size={10} className="fill-[#FFB830] text-[#FFB830]" />{p.averageRating.toFixed(1)}
                </span>
              )}
            </div>
          </div>
          {(p.pricingMinINR || p.pricingMaxINR) && (
            <div className="text-right shrink-0">
              <p className="text-xs text-gray-400">Monthly</p>
              <p className="text-sm font-bold text-[#1A2340]">
                ₹{(p.pricingMinINR ?? 0).toLocaleString("en-IN")}
                {p.pricingMaxINR && p.pricingMaxINR !== p.pricingMinINR
                  ? `–${p.pricingMaxINR.toLocaleString("en-IN")}`
                  : ""}
              </p>
            </div>
          )}
        </div>

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
          {!committed && (
            <Button
              size="sm"
              className="gap-1 text-xs flex-1 bg-[#2EC4A5] hover:bg-[#26a88d] text-white rounded-xl"
              onClick={() => onChoose(candidate.professionalId)}
            >
              <ChevronRight size={12} />
              Choose
            </Button>
          )}
        </div>
        {!committed && !selected && onNotInterested && (
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

  const { data: match, isLoading: loadingMatch, refetch } = useMyMatch();
  const { data: children = [], isLoading: loadingChildren } = useChildren();
  const { data: pricing } = useMatchingFee();
  const matchingFee = pricing?.matchingFeeInr ?? 500;

  const [selectedChildId, setSelectedChildId] = useState<number | "">("");
  const [extraNotes, setExtraNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [choosingId, setChoosingId] = useState<number | null>(null);
  const [refunding, setRefunding] = useState(false);

  const status = match?.status ?? null;
  const isActive = status && !["cancelled", "refunded"].includes(status);
  const committed = status === "committed";

  // ── handleSubmit — calls /request, opens Razorpay modal, then verifies ──
  // Works for both new submissions AND resuming a pending_payment (uses match.childId fallback)
  async function handleSubmit() {
    const effectiveChildId = selectedChildId || match?.childId || null;
    if (!effectiveChildId) { toast({ title: "Please select a child profile", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      const loaded = await loadRazorpayScript();
      if (!loaded) { toast({ title: "Payment gateway unavailable", variant: "destructive" }); return; }

      const res = await fetchWithAuth("/api/shadow-teacher/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childId: effectiveChildId, extraNotes: extraNotes.trim() || undefined }),
      });
      const data = await res.json() as {
        error?: string;
        matchId?: number;
        orderId?: string;
        providerOrderId?: string;
        amount?: number;
        keyId?: string;
      };

      if (!res.ok && res.status !== 409) {
        toast({ title: data.error ?? "Could not submit request", variant: "destructive" });
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

  // ── handleChoose — FREE commit (matching fee was already paid at request) ──
  async function handleChoose(professionalId: number) {
    if (!match) return;
    setChoosingId(professionalId);
    try {
      const res = await fetchWithAuth(`/api/shadow-teacher/${match.id}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedProfessionalId: professionalId }),
      });
      const data = await res.json() as { error?: string; message?: string; engagementId?: number };
      if (!res.ok) {
        if (res.status === 409) {
          toast({ title: "Cannot choose teacher", description: data.message ?? data.error, variant: "destructive" });
        } else {
          toast({ title: data.error ?? "Could not select teacher", variant: "destructive" });
        }
        return;
      }
      toast({ title: "Teacher confirmed!", description: "Your engagement is live. Contact details are now visible." });
      queryClient.invalidateQueries({ queryKey: ["parent-engagements"] });
      queryClient.invalidateQueries({ queryKey: ["shadow-teacher-my-request"] });
      await refetch();
    } catch {
      toast({ title: "Network error", variant: "destructive" });
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
            <div>
              <Label className="text-sm mb-1.5 block">Which child is this for?</Label>
              <select
                value={selectedChildId}
                onChange={(e) => setSelectedChildId(e.target.value ? Number(e.target.value) : "")}
                className="w-full border border-input rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">— Select a child —</option>
                {children.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.city ? ` · ${c.city}` : ""}</option>
                ))}
              </select>
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
          disabled={submitting || !selectedChildId || children.length === 0}
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <IndianRupee size={14} />}
          {submitting ? "Opening payment…" : `Find My Shadow Teacher — ₹${matchingFee.toLocaleString("en-IN")}`}
        </Button>

        <p className="text-[11px] text-center text-muted-foreground">
          A one-time matching fee of ₹{matchingFee.toLocaleString("en-IN")} is charged now. Choosing your teacher later is free.
        </p>
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

  // ── Shortlisted: show candidates ─────────────────────────────────────────
  if (status === "shortlisted" && match) {
    const myId = me?.id ?? 0;
    const feePaidAt = match.feePaidAt ? new Date(match.feePaidAt) : null;
    const daysSincePaid = feePaidAt ? (Date.now() - feePaidAt.getTime()) / 86_400_000 : 0;
    const refundEligible = !committed && (match.distinctTeachersShown < 3) && (daysSincePaid >= 60);

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <UserCheck size={18} className="text-primary" />
          <h2 className="font-serif font-semibold text-lg text-foreground">Your Matches</h2>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS.shortlisted}`}>
            {match.candidates.length} candidate{match.candidates.length !== 1 ? "s" : ""}
          </span>
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
                onChoose={async (proId) => {
                  if (choosingId) return;
                  await handleChoose(proId);
                }}
                onNotInterested={async (candidateId) => { await handleNotInterested(candidateId); }}
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
      </div>
    );
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
