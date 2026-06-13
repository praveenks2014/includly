/**
 * ShadowTeacherRequestWidget — New Flow
 *
 * 1. Child selector → child snapshot → submit (no upfront fee)
 * 2. Shortlisted candidates → chat drawer → choose teacher
 * 3. Razorpay commitment fee → HMAC verify → engagement auto-created
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
  matchedAt?: string;
  matchedProName?: string;
  selectedProfessionalId: number | null;
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
}: {
  candidate: Candidate;
  matchId: number;
  committed: boolean;
  myUserId: number;
  selected: boolean;
  onChoose: (professionalId: number) => void;
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

  const [selectedChildId, setSelectedChildId] = useState<number | "">("");
  const [extraNotes, setExtraNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [choosingId, setChoosingId] = useState<number | null>(null);

  const status = match?.status ?? null;
  const isActive = status && !["cancelled", "refunded"].includes(status);
  const committed = status === "committed";

  async function handleSubmit() {
    if (!selectedChildId) { toast({ title: "Please select a child profile", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      const res = await fetchWithAuth("/api/shadow-teacher/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childId: selectedChildId, extraNotes: extraNotes.trim() || undefined }),
      });
      const data = await res.json() as { error?: string; matchId?: number; candidateCount?: number };
      if (!res.ok) {
        if (res.status === 409 && data.matchId) {
          toast({ title: "You already have an active request. Refreshing…" });
          await refetch();
          return;
        }
        toast({ title: data.error ?? "Could not submit request", variant: "destructive" });
        return;
      }
      toast({ title: "Request submitted!", description: `Found ${data.candidateCount ?? 0} candidate${data.candidateCount === 1 ? "" : "s"} for you.` });
      await refetch();
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleChoose(professionalId: number) {
    if (!match) return;
    setChoosingId(professionalId);
    try {
      const loaded = await loadRazorpayScript();
      if (!loaded) { toast({ title: "Payment gateway unavailable", variant: "destructive" }); return; }

      const res = await fetchWithAuth(`/api/shadow-teacher/${match.id}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedProfessionalId: professionalId }),
      });
      const orderData = await res.json() as {
        error?: string; message?: string;
        orderId?: string; amount?: number; keyId?: string; teacherFirstName?: string;
      };

      if (!res.ok) {
        if (res.status === 409) {
          toast({ title: "Cannot commit", description: orderData.message ?? orderData.error, variant: "destructive" });
        } else {
          toast({ title: orderData.error ?? "Could not initiate payment", variant: "destructive" });
        }
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const rzp = new window.Razorpay({
          key: orderData.keyId!,
          amount: orderData.amount!,
          currency: "INR",
          order_id: orderData.orderId!,
          name: "Includly",
          description: `First month — ${orderData.teacherFirstName ?? "Teacher"}`,
          handler: async (response: RazorpayPaymentResponse) => {
            try {
              const vRes = await fetchWithAuth(`/api/shadow-teacher/${match.id}/verify-commitment`, {
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
                toast({ title: vd.error ?? "Verification failed", variant: "destructive" });
                reject(new Error("verify"));
                return;
              }
              toast({ title: "Teacher selected!", description: "Your engagement has been created. Check the engagement card below." });
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
      if (msg !== "dismissed") toast({ title: "Payment failed", description: msg, variant: "destructive" });
      await refetch();
    } finally {
      setChoosingId(null);
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
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <UserCheck size={14} />}
          {submitting ? "Submitting…" : "Find My Shadow Teacher (Free)"}
        </Button>

        <p className="text-[11px] text-center text-muted-foreground">
          No fee to request a match. A commitment fee (first month's salary) is charged only when you choose a teacher.
        </p>
      </div>
    );
  }

  // ── Shortlisted: show candidates ─────────────────────────────────────────
  if (status === "shortlisted" && match) {
    const myId = me?.id ?? 0;

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <UserCheck size={18} className="text-primary" />
          <h2 className="font-serif font-semibold text-lg text-foreground">Your Matches</h2>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS.shortlisted}`}>
            {match.candidates.filter((c) => !committed || c.professionalId === match.selectedProfessionalId).length} candidate{match.candidates.length !== 1 ? "s" : ""}
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
              />
            ))}
          </div>
        )}

        <p className="text-xs text-center text-muted-foreground">
          Chat with teachers to ask questions. When ready, press <strong>Choose</strong> to proceed with the first month's fee.
        </p>
      </div>
    );
  }

  // ── Pending commitment ───────────────────────────────────────────────────
  if (status === "pending_commitment" && match) {
    const selectedCandidate = match.candidates.find((c) => c.professionalId === match.selectedProfessionalId);
    const myId = me?.id ?? 0;
    return (
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <Clock size={18} className="text-purple-500" />
          <h2 className="font-serif font-semibold text-lg text-foreground">Complete Your Selection</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          You selected a teacher. Complete the first month's payment to confirm your engagement.
        </p>
        {selectedCandidate && (
          <CandidateCard
            candidate={selectedCandidate}
            matchId={match.id}
            committed={false}
            myUserId={myId}
            selected
            onChoose={async (proId) => { await handleChoose(proId); }}
          />
        )}
        <Button
          className="w-full gap-2 bg-[#2EC4A5] hover:bg-[#26a88d] text-white"
          onClick={async () => {
            if (match.selectedProfessionalId) await handleChoose(match.selectedProfessionalId);
          }}
          disabled={choosingId != null}
        >
          {choosingId != null ? <Loader2 size={14} className="animate-spin" /> : <IndianRupee size={14} />}
          Resume Payment
        </Button>
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
    pending_payment: { label: "Awaiting payment", icon: <Clock size={14} /> },
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
