/**
 * VerticalEngagementCard — professional-facing engagement lifecycle card for
 * the tutor and therapist verticals (Part B). Mirrors the relevant slices of
 * professional-dashboard.tsx's EngagementTab (teacher acceptance, activation
 * fee, start OTP, session OTP entry, direct-pay confirmations) but trimmed to
 * B6's already-established scope (see VerticalTab()/TutorTab()/TherapistTab()
 * in parent-dashboard.tsx: request→interview→trial→commit plus basic ongoing
 * payment — no daily logs, goals, or lifecycle pause/buyout, none of which
 * exist for these verticals).
 *
 * Endpoint paths verified by reading tutor.ts/therapist.ts directly rather
 * than assumed from shadow-teacher's naming (tutor/therapist use
 * `/engagements/:id/acceptance`, NOT shadow-teacher's
 * `/engagements/:id/teacher-acceptance`).
 *
 * Does NOT touch professional-dashboard.tsx's existing EngagementTab or any
 * shadow-teacher route.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { fetchWithAuth } from "@/lib/api";
import { loadRazorpayScript } from "@/lib/razorpay";
import { AntiBypassNotice } from "./AntiBypassNotice";
import { Loader2, IndianRupee, CheckCircle2, Video } from "lucide-react";
import type { Vertical } from "./VerticalRequestWidget";

const API_BASE: Record<Vertical, string> = { tutor: "/api/tutor", therapist: "/api/therapist" };

const ANTI_BYPASS_BENEFITS: Record<Vertical, string[]> = {
  tutor: [
    "Session attendance tracking",
    "This engagement stays exclusively yours — Includly won't match this parent with another tutor while you're engaged",
    "Dispute mediation support if something goes wrong",
  ],
  therapist: [
    "Session attendance tracking",
    "This engagement stays exclusively yours — Includly won't match this parent with another therapist while you're engaged",
    "Dispute mediation support if something goes wrong",
  ],
};

export interface VerticalEngagement {
  id: number;
  professionalId: number;
  childId: number | null;
  matchRequestId: number | null;
  status: string;
  startDate: string;
  sessionsPerWeek: number;
  perSessionFeeInr: number;
  billingCadence?: "monthly" | "per_session"; // therapist only; tutor is always monthly
  directPayEnabled: boolean;
  activationFeeInr: number | null;
  parentName: string | null;
  childName: string | null;
}

interface VerticalSession {
  id: number;
  sessionDate: string;
  startTime: string | null;
  endTime: string | null;
  status: string;
  otpLockedAt: string | null;
  paidAmountInr?: number | null;
  paidAt?: string | null;
  meetLink?: string | null;
  topicsCovered?: string | null;
  childEngagementNotes?: string | null;
  nextSessionNotes?: string | null;
  goalProgress?: "better" | "same" | "needs_attention" | null;
}

interface PendingConfirmation {
  id: number;
  month: string;
  amountInr: number;
  markedPaidAt: string;
}

function AcceptanceSection({ vertical, eng, onUpdated }: { vertical: Vertical; eng: VerticalEngagement; onUpdated: () => void }) {
  const { toast } = useToast();
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (eng.status !== "pending_teacher_acceptance") return null;

  async function respond(action: "accept" | "decline") {
    setSubmitting(true);
    try {
      const res = await fetchWithAuth(`${API_BASE[vertical]}/engagements/${eng.id}/acceptance`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const e = await res.json() as { error?: string; message?: string };
        toast({ title: e.message ?? e.error ?? "Could not respond", variant: "destructive" });
        return;
      }
      toast({ title: action === "accept" ? "Engagement accepted ✓" : "Engagement declined" });
      onUpdated();
    } finally { setSubmitting(false); }
  }

  return (
    <div className="mb-3 p-4 bg-blue-50 border border-blue-200 rounded-xl space-y-3">
      <p className="text-sm font-bold text-blue-900">New engagement — your acceptance needed</p>
      <p className="text-xs text-blue-800">
        {eng.parentName ?? "A parent"} has committed to an engagement with you
        {eng.childName ? ` for ${eng.childName}` : ""}, starting {eng.startDate}.
      </p>
      <AntiBypassNotice
        professionalLabel={vertical}
        benefits={ANTI_BYPASS_BENEFITS[vertical]}
        checked={checked}
        onCheckedChange={setChecked}
        checkboxLabel="I understand — I'll keep this engagement on Includly rather than take it off-platform"
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => void respond("accept")}
          disabled={submitting || !checked}
          className="flex-1 bg-green-600 hover:bg-green-700 text-white text-xs h-8 rounded-xl"
        >
          {submitting ? <Loader2 size={12} className="animate-spin" /> : null}
          Accept
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void respond("decline")}
          disabled={submitting}
          className="flex-1 border-red-200 text-red-600 hover:bg-red-50 text-xs h-8 rounded-xl"
        >
          Decline
        </Button>
      </div>
    </div>
  );
}

function ActivationFeeSection({ vertical, eng, onUpdated }: { vertical: Vertical; eng: VerticalEngagement; onUpdated: () => void }) {
  const { toast } = useToast();
  const [paying, setPaying] = useState(false);

  if (eng.status !== "pending_activation_fee") return null;

  async function handlePay() {
    setPaying(true);
    try {
      const orderRes = await fetchWithAuth(`${API_BASE[vertical]}/engagements/${eng.id}/activation-fee/order`, { method: "POST" });
      const orderData = await orderRes.json() as { error?: string; orderId?: string; amount?: number; keyId?: string; skipped?: boolean; status?: string };
      if (!orderRes.ok) { toast({ title: orderData.error ?? "Could not start payment", variant: "destructive" }); return; }
      if (orderData.skipped) { toast({ title: "Activation fee not required" }); onUpdated(); return; }
      if (!orderData.orderId || !orderData.amount || !orderData.keyId) { toast({ title: "Invalid payment response", variant: "destructive" }); return; }

      const loaded = await loadRazorpayScript();
      if (!loaded) { toast({ title: "Payment gateway unavailable", variant: "destructive" }); return; }

      await new Promise<void>((resolve, reject) => {
        const rzp = new (window as unknown as { Razorpay: new (opts: unknown) => { open: () => void } }).Razorpay({
          key: orderData.keyId!,
          amount: orderData.amount!,
          currency: "INR",
          order_id: orderData.orderId!,
          name: "Includly",
          description: "One-time activation fee",
          handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
            try {
              const vRes = await fetchWithAuth(`${API_BASE[vertical]}/engagements/${eng.id}/activation-fee/verify`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  razorpayOrderId: response.razorpay_order_id,
                  razorpayPaymentId: response.razorpay_payment_id,
                  razorpaySignature: response.razorpay_signature,
                }),
              });
              const vd = await vRes.json() as { error?: string };
              if (!vRes.ok) { toast({ title: vd.error ?? "Payment verification failed", variant: "destructive" }); reject(new Error("verify")); return; }
              toast({ title: "Activation fee paid ✓" });
              onUpdated();
              resolve();
            } catch { reject(new Error("verify")); }
          },
          modal: { ondismiss: () => reject(new Error("dismissed")) },
          theme: { color: "#2EC4A5" },
        });
        rzp.open();
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg !== "dismissed") toast({ title: "Could not complete payment", description: msg, variant: "destructive" });
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="mb-3 p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
      <p className="text-sm font-bold text-amber-900">Activation fee required</p>
      <p className="text-xs text-amber-700">
        Pay the one-time activation fee of ₹{(eng.activationFeeInr ?? 0).toLocaleString("en-IN")} to activate this engagement.
      </p>
      <Button
        size="sm"
        onClick={() => void handlePay()}
        disabled={paying}
        className="w-full bg-amber-500 hover:bg-amber-600 text-white text-xs h-9 rounded-xl"
      >
        {paying ? <Loader2 size={12} className="animate-spin mr-1" /> : <IndianRupee size={12} className="mr-1" />}
        Pay Activation Fee
      </Button>
    </div>
  );
}

function StartOtpSection({ vertical, eng, onUpdated }: { vertical: Vertical; eng: VerticalEngagement; onUpdated: () => void }) {
  const { toast } = useToast();
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);

  if (eng.status !== "pending_start") return null;

  async function handleSubmit() {
    const code = otp.trim();
    if (!code) { toast({ title: "Enter the start code", variant: "destructive" }); return; }
    setLoading(true);
    try {
      const res = await fetchWithAuth(`${API_BASE[vertical]}/engagements/${eng.id}/verify-start-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp: code }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        toast({ title: d.error ?? "Incorrect code — try again", variant: "destructive" });
        setOtp("");
        return;
      }
      toast({ title: "Engagement started!" });
      onUpdated();
    } finally { setLoading(false); }
  }

  return (
    <div className="mb-3 p-4 bg-orange-50 border border-orange-200 rounded-xl space-y-2">
      <p className="text-sm font-bold text-orange-900">Enter the parent's start code to begin</p>
      <p className="text-xs text-orange-700">Ask the parent to open their app — the start code appears on {eng.startDate}.</p>
      <div className="flex gap-2">
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          placeholder="_ _ _ _ _ _"
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
          className="flex-1 h-9 text-center text-lg font-mono tracking-widest border border-orange-300 rounded-xl px-3 outline-none focus:ring-2 focus:ring-orange-400 bg-white"
          onKeyDown={(e) => { if (e.key === "Enter") void handleSubmit(); }}
        />
        <Button
          size="sm"
          className="h-9 px-4 rounded-xl text-xs text-white bg-orange-500 hover:bg-orange-600"
          onClick={() => void handleSubmit()}
          disabled={loading || otp.length === 0}
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : "Confirm Start"}
        </Button>
      </div>
    </div>
  );
}

function SessionOtpEntry({ vertical, engagementId, session, type, onUpdated }: { vertical: Vertical; engagementId: number; session: VerticalSession; type: "start" | "end"; onUpdated: () => void }) {
  const { toast } = useToast();
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const isStart = type === "start";

  if (session.otpLockedAt) {
    return <p className="text-xs text-red-600">OTP locked — too many failed attempts. Contact admin.</p>;
  }

  async function handleSubmit() {
    const code = otp.trim();
    if (code.length !== 6) { toast({ title: "Enter the 6-digit code", variant: "destructive" }); return; }
    setLoading(true);
    try {
      const endpoint = `${API_BASE[vertical]}/engagements/${engagementId}/sessions/${session.id}/${isStart ? "start-otp" : "end-otp"}`;
      const res = await fetchWithAuth(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp: code }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        toast({ title: d.error ?? "Incorrect OTP", variant: "destructive" });
        setOtp("");
        return;
      }
      toast({ title: isStart ? "Session started" : "Session complete" });
      onUpdated();
    } finally { setLoading(false); }
  }

  return (
    <div className="flex gap-1.5 mt-1.5">
      <input
        type="text"
        inputMode="numeric"
        maxLength={6}
        placeholder="OTP"
        value={otp}
        onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
        className="w-24 h-8 text-center text-xs font-mono tracking-widest border border-gray-300 rounded-lg px-2 outline-none focus:ring-1 focus:ring-[#2EC4A5] bg-white"
      />
      <Button
        size="sm"
        onClick={() => void handleSubmit()}
        disabled={loading || otp.length !== 6}
        className="h-8 px-3 text-xs rounded-lg bg-[#1A2340] hover:bg-[#2a3660] text-white"
      >
        {loading ? <Loader2 size={11} className="animate-spin" /> : (isStart ? "Start" : "End")}
      </Button>
    </div>
  );
}

const GOAL_PROGRESS_LABEL: Record<string, string> = {
  better: "Better",
  same: "Same",
  needs_attention: "Needs attention",
};

function SessionProgressNotesForm({ vertical, engagementId, session, onUpdated }: { vertical: Vertical; engagementId: number; session: VerticalSession; onUpdated: () => void }) {
  const { toast } = useToast();
  const hasNotes = !!(session.topicsCovered || session.childEngagementNotes || session.nextSessionNotes || session.goalProgress);
  const [editing, setEditing] = useState(!hasNotes);
  const [topicsCovered, setTopicsCovered] = useState(session.topicsCovered ?? "");
  const [childEngagementNotes, setChildEngagementNotes] = useState(session.childEngagementNotes ?? "");
  const [nextSessionNotes, setNextSessionNotes] = useState(session.nextSessionNotes ?? "");
  const [goalProgress, setGoalProgress] = useState<"better" | "same" | "needs_attention">(session.goalProgress ?? "same");
  const [saving, setSaving] = useState(false);

  if (!editing) {
    return (
      <div className="mt-1.5 p-2 rounded-lg bg-teal-50 border border-teal-100 space-y-1">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold text-teal-800 uppercase">Session notes</p>
          <button onClick={() => setEditing(true)} className="text-[10px] text-teal-600 hover:underline">Edit</button>
        </div>
        {session.topicsCovered && <p className="text-xs text-gray-600"><span className="font-medium">Covered:</span> {session.topicsCovered}</p>}
        {session.childEngagementNotes && <p className="text-xs text-gray-600"><span className="font-medium">Engagement:</span> {session.childEngagementNotes}</p>}
        {session.nextSessionNotes && <p className="text-xs text-gray-600"><span className="font-medium">Next session:</span> {session.nextSessionNotes}</p>}
        {session.goalProgress && <p className="text-xs text-gray-600"><span className="font-medium">Goal progress:</span> {GOAL_PROGRESS_LABEL[session.goalProgress]}</p>}
      </div>
    );
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API_BASE[vertical]}/engagements/${engagementId}/sessions/${session.id}/progress-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicsCovered: topicsCovered.trim() || undefined, childEngagementNotes: childEngagementNotes.trim() || undefined, nextSessionNotes: nextSessionNotes.trim() || undefined, goalProgress }),
      });
      if (!res.ok) { const e = await res.json() as { error?: string }; toast({ title: e.error ?? "Could not save notes", variant: "destructive" }); return; }
      setEditing(false);
      onUpdated();
    } finally { setSaving(false); }
  }

  return (
    <div className="mt-1.5 p-2.5 rounded-lg bg-gray-50 border border-gray-100 space-y-2">
      <input
        type="text"
        placeholder="What was covered"
        value={topicsCovered}
        onChange={(e) => setTopicsCovered(e.target.value)}
        maxLength={1000}
        className="w-full h-8 text-xs border border-gray-200 rounded-lg px-2 outline-none focus:ring-1 focus:ring-[#2EC4A5] bg-white"
      />
      <input
        type="text"
        placeholder="How the child engaged"
        value={childEngagementNotes}
        onChange={(e) => setChildEngagementNotes(e.target.value)}
        maxLength={1000}
        className="w-full h-8 text-xs border border-gray-200 rounded-lg px-2 outline-none focus:ring-1 focus:ring-[#2EC4A5] bg-white"
      />
      <input
        type="text"
        placeholder="Notes for next session"
        value={nextSessionNotes}
        onChange={(e) => setNextSessionNotes(e.target.value)}
        maxLength={1000}
        className="w-full h-8 text-xs border border-gray-200 rounded-lg px-2 outline-none focus:ring-1 focus:ring-[#2EC4A5] bg-white"
      />
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-gray-500">Goal progress:</span>
        <select
          value={goalProgress}
          onChange={(e) => setGoalProgress(e.target.value as typeof goalProgress)}
          className="h-7 text-xs border border-gray-200 rounded-lg px-1.5 bg-white"
        >
          <option value="better">Better</option>
          <option value="same">Same</option>
          <option value="needs_attention">Needs attention</option>
        </select>
      </div>
      <div className="flex gap-2">
        {hasNotes && <Button size="sm" variant="outline" className="flex-1 h-7 text-xs rounded-lg" onClick={() => setEditing(false)}>Cancel</Button>}
        <Button size="sm" onClick={() => void save()} disabled={saving} className="flex-1 h-7 text-xs rounded-lg bg-[#2EC4A5] hover:bg-[#26a88d] text-white">
          {saving ? <Loader2 size={11} className="animate-spin" /> : "Save notes"}
        </Button>
      </div>
    </div>
  );
}

function ActiveSessionsSection({ vertical, eng, onUpdated }: { vertical: Vertical; eng: VerticalEngagement; onUpdated: () => void }) {
  const { data: sessions = [], refetch } = useQuery<VerticalSession[]>({
    queryKey: [`${vertical}-engagement-sessions`, eng.id],
    queryFn: () => fetchWithAuth(`${API_BASE[vertical]}/engagements/${eng.id}/sessions`).then(r => r.json()),
    enabled: eng.status === "active",
  });

  if (eng.status !== "active") return null;

  function handleSessionUpdated() {
    void refetch();
    onUpdated();
  }

  const relevant = sessions.filter(s => s.status === "scheduled" || s.status === "started" || s.status === "completed");

  return (
    <div className="mb-3 p-4 bg-white border border-gray-100 rounded-xl space-y-2">
      <p className="text-sm font-bold text-[#1A2340]">Sessions</p>
      {relevant.length === 0 ? (
        <p className="text-xs text-gray-400">No scheduled sessions yet.</p>
      ) : (
        <div className="space-y-2">
          {relevant.map((s) => (
            <div key={s.id} className="p-2.5 rounded-lg border border-gray-100 bg-gray-50/50">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#1A2340]">{s.sessionDate}{s.startTime ? ` · ${s.startTime}` : ""}</span>
                <span className="text-[10px] text-gray-400 uppercase">{s.status}</span>
              </div>
              {vertical === "therapist" && eng.billingCadence === "per_session" && s.status === "completed" && (
                <p className="text-[10px] text-gray-400 mt-1">{s.paidAt ? `Paid ₹${s.paidAmountInr?.toLocaleString("en-IN")}` : "Payment pending"}</p>
              )}
              {s.meetLink && (s.status === "scheduled" || s.status === "started") && (
                <a
                  href={s.meetLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 mt-1.5 text-xs font-medium text-[#2EC4A5] hover:text-[#26a88d] no-underline"
                >
                  <Video size={12} />
                  Join video call
                </a>
              )}
              {s.status === "scheduled" && <SessionOtpEntry vertical={vertical} engagementId={eng.id} session={s} type="start" onUpdated={handleSessionUpdated} />}
              {s.status === "started" && <SessionOtpEntry vertical={vertical} engagementId={eng.id} session={s} type="end" onUpdated={handleSessionUpdated} />}
              {s.status === "completed" && <SessionProgressNotesForm vertical={vertical} engagementId={eng.id} session={s} onUpdated={handleSessionUpdated} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PaymentSection({ vertical, eng, onUpdated }: { vertical: Vertical; eng: VerticalEngagement; onUpdated: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const isMonthly = vertical === "tutor" || eng.billingCadence === "monthly";

  const { data: pending = [] } = useQuery<PendingConfirmation[]>({
    queryKey: [`${vertical}-payment-confirmations`, eng.id],
    queryFn: () => fetchWithAuth(`${API_BASE[vertical]}/engagements/${eng.id}/payment-confirmations`).then(r => r.json()),
    enabled: eng.status === "active" && isMonthly && eng.directPayEnabled,
  });

  if (eng.status !== "active") return null;

  async function confirmReceived(confirmationId: number) {
    setConfirmingId(confirmationId);
    try {
      const res = await fetchWithAuth(`${API_BASE[vertical]}/engagements/${eng.id}/payment-confirmations/${confirmationId}/confirm-received`, { method: "POST" });
      if (!res.ok) { const e = await res.json() as { error?: string }; toast({ title: e.error ?? "Could not confirm", variant: "destructive" }); return; }
      toast({ title: "Receipt confirmed ✓" });
      queryClient.invalidateQueries({ queryKey: [`${vertical}-payment-confirmations`, eng.id] });
      onUpdated();
    } finally { setConfirmingId(null); }
  }

  if (!isMonthly) {
    // per_session cadence — the parent's mark-paid/pay-session flow is the
    // only step (no professional confirmation exists for this cadence,
    // confirmed by reading therapist.ts's sessions/:id/mark-paid — parent-
    // only, no counterpart). Status shows inline per-session in
    // ActiveSessionsSection above instead.
    return null;
  }

  if (!eng.directPayEnabled) {
    return (
      <div className="mb-3 p-3 bg-gray-50 border border-gray-100 rounded-xl">
        <p className="text-xs text-gray-500">Session payments for this engagement are collected and remitted through Includly.</p>
      </div>
    );
  }

  if (pending.length === 0) return null;

  return (
    <div className="mb-3 space-y-2">
      {pending.map((p) => (
        <div key={p.id} className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-amber-800">Parent marked ₹{p.amountInr.toLocaleString("en-IN")} paid for {p.month}</p>
            <p className="text-[10px] text-amber-600">Confirm once you've received it.</p>
          </div>
          <Button
            size="sm"
            onClick={() => void confirmReceived(p.id)}
            disabled={confirmingId === p.id}
            className="h-8 px-3 text-xs rounded-lg bg-amber-500 hover:bg-amber-600 text-white shrink-0"
          >
            {confirmingId === p.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} className="mr-1" />}
            Confirm
          </Button>
        </div>
      ))}
    </div>
  );
}

export function VerticalEngagementCard({ vertical, engagement: eng, onUpdated }: { vertical: Vertical; engagement: VerticalEngagement; onUpdated: () => void }) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-[0_4px_24px_rgba(26,35,64,0.06)]">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-bold text-[#1A2340]">{eng.parentName ?? "Parent"}{eng.childName ? ` — ${eng.childName}` : ""}</p>
          <p className="text-xs text-gray-400">Starts {eng.startDate} · ₹{eng.perSessionFeeInr.toLocaleString("en-IN")}/session</p>
        </div>
        <span className="shrink-0 text-[10px] font-semibold px-2.5 py-0.5 rounded-full border bg-gray-50 text-gray-500 border-gray-200 uppercase">
          {eng.status.replace(/_/g, " ")}
        </span>
      </div>

      <AcceptanceSection vertical={vertical} eng={eng} onUpdated={onUpdated} />
      <ActivationFeeSection vertical={vertical} eng={eng} onUpdated={onUpdated} />
      <StartOtpSection vertical={vertical} eng={eng} onUpdated={onUpdated} />
      <ActiveSessionsSection vertical={vertical} eng={eng} onUpdated={onUpdated} />
      <PaymentSection vertical={vertical} eng={eng} onUpdated={onUpdated} />
    </div>
  );
}
