import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CalendarCheck, Clock, IndianRupee } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fetchWithAuth } from "@/lib/api";

// Same labels/colors as the parent-facing therapy-bookings pages
// (therapy-bookings.tsx/therapy-booking-detail.tsx) -- duplicated per this
// codebase's own established per-file convention for small constants
// (OTP_MAX_ATTEMPTS, bookingSlotLockSql, BOOKING_STATUS_LABEL itself).
const BOOKING_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending_payment: { label: "Pending payment", color: "bg-gray-100 text-gray-600 border-gray-200" },
  confirmed: { label: "Confirmed", color: "bg-blue-50 text-blue-700 border-blue-200" },
  session_started: { label: "In session", color: "bg-teal-50 text-teal-700 border-teal-200" },
  session_completed: { label: "Completed", color: "bg-green-50 text-green-700 border-green-200" },
  cancelled_by_parent: { label: "Cancelled (parent)", color: "bg-red-50 text-red-700 border-red-200" },
  cancelled_by_centre: { label: "Cancelled (centre)", color: "bg-red-50 text-red-700 border-red-200" },
  refunded: { label: "Refunded", color: "bg-red-50 text-red-700 border-red-200" },
  no_show_parent: { label: "Parent no-show", color: "bg-amber-50 text-amber-700 border-amber-200" },
  no_show_centre: { label: "Centre no-show", color: "bg-amber-50 text-amber-700 border-amber-200" },
};

export interface TherapyBookingSummary {
  id: number;
  centreId: number;
  centreName: string | null;
  parentId: number;
  parentName: string | null;
  serviceId: number;
  serviceName: string | null;
  bookedDate: string;
  startTime: string;
  endTime: string;
  status: string;
  amountInr: number;
  hasFeedback: boolean;
}

export function TherapyBookingCard({ b, onRefresh }: { b: TherapyBookingSummary; onRefresh: () => void }) {
  const { toast } = useToast();
  const [startOtpInput, setStartOtpInput] = useState("");
  const [endOtpInput, setEndOtpInput] = useState("");
  const [loading, setLoading] = useState<"start" | "end" | "feedback" | null>(null);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(b.hasFeedback);
  const [sessionCovered, setSessionCovered] = useState("");
  const [childEngagement, setChildEngagement] = useState("");
  const [homeActivities, setHomeActivities] = useState("");

  const statusCfg = BOOKING_STATUS_LABEL[b.status] ?? { label: b.status, color: "bg-gray-100 text-gray-600 border-gray-200" };

  async function verifyOtp(type: "start" | "end") {
    const otp = (type === "start" ? startOtpInput : endOtpInput).trim();
    if (otp.length !== 6) { toast({ title: "Enter the 6-digit code", variant: "destructive" }); return; }
    setLoading(type);
    try {
      const res = await fetchWithAuth(`/api/therapy-bookings/${b.id}/${type}-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp }),
      });
      const data = await res.json();
      if (!res.ok) {
        const attemptsLeft = data.attemptsRemaining != null ? ` (${data.attemptsRemaining} attempts left)` : "";
        toast({ title: (data.error ?? "Error") + attemptsLeft, variant: "destructive" });
        return;
      }
      toast({ title: type === "start" ? "Session started ✓" : "Session completed 🎉" });
      if (type === "start") setStartOtpInput(""); else setEndOtpInput("");
      onRefresh();
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setLoading(null);
    }
  }

  async function submitFeedback() {
    if (!sessionCovered.trim() || !childEngagement.trim()) {
      toast({ title: "Session covered and child engagement are required", variant: "destructive" });
      return;
    }
    setLoading("feedback");
    try {
      const res = await fetchWithAuth(`/api/therapy-bookings/${b.id}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionCovered: sessionCovered.trim(),
          childEngagement: childEngagement.trim(),
          homeActivities: homeActivities.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error ?? "Failed to submit feedback", variant: "destructive" }); return; }
      toast({ title: "Feedback submitted" });
      setFeedbackSubmitted(true);
      onRefresh();
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-[0_2px_12px_rgba(26,35,64,0.06)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[#1A2340]">{b.parentName ?? "Parent"}</p>
          <p className="text-xs text-gray-500">{b.centreName}{b.serviceName ? ` · ${b.serviceName}` : ""}</p>
          <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
            <span className="flex items-center gap-1"><CalendarCheck size={11} />{b.bookedDate}</span>
            <span className="flex items-center gap-1"><Clock size={11} />{b.startTime}–{b.endTime}</span>
            <span className="flex items-center gap-1"><IndianRupee size={11} />{b.amountInr.toLocaleString("en-IN")}</span>
          </div>
        </div>
        <span className={`text-xs px-2 py-1 rounded-full font-medium border shrink-0 ${statusCfg.color}`}>{statusCfg.label}</span>
      </div>

      {b.status === "confirmed" && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="Start code (from parent)"
              value={startOtpInput}
              onChange={(e) => setStartOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-[#2EC4A5] placeholder:text-gray-300"
            />
            <Button
              size="sm"
              className="bg-[#2EC4A5] hover:bg-[#26a98d] text-white shrink-0"
              disabled={loading === "start" || startOtpInput.length !== 6}
              onClick={() => verifyOtp("start")}
            >
              {loading === "start" ? <Loader2 size={14} className="animate-spin" /> : "Start"}
            </Button>
          </div>
          <p className="text-[10px] text-gray-400">Ask the parent for the 6-digit start code shown in their app.</p>
        </div>
      )}

      {b.status === "session_started" && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="Finish code (from parent)"
              value={endOtpInput}
              onChange={(e) => setEndOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-[#FF6B6B] placeholder:text-gray-300"
            />
            <Button
              size="sm"
              className="bg-[#FF6B6B] hover:bg-[#e05a5a] text-white shrink-0"
              disabled={loading === "end" || endOtpInput.length !== 6}
              onClick={() => verifyOtp("end")}
            >
              {loading === "end" ? <Loader2 size={14} className="animate-spin" /> : "Complete"}
            </Button>
          </div>
          <p className="text-[10px] text-gray-400">Ask the parent for the 6-digit finish code shown in their app.</p>
        </div>
      )}

      {b.status === "session_completed" && !feedbackSubmitted && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
          <p className="text-xs font-medium text-gray-600">Add session feedback</p>
          <Textarea
            value={sessionCovered}
            onChange={(e) => setSessionCovered(e.target.value)}
            placeholder="What was covered in this session?"
            className="text-sm"
          />
          <Textarea
            value={childEngagement}
            onChange={(e) => setChildEngagement(e.target.value)}
            placeholder="How did the child engage?"
            className="text-sm"
          />
          <Textarea
            value={homeActivities}
            onChange={(e) => setHomeActivities(e.target.value)}
            placeholder="Suggested home activities (optional)"
            className="text-sm"
          />
          <Button
            size="sm"
            className="bg-[#2EC4A5] hover:bg-[#26a98d] text-white"
            disabled={loading === "feedback"}
            onClick={submitFeedback}
          >
            {loading === "feedback" ? <Loader2 size={14} className="animate-spin" /> : "Submit feedback"}
          </Button>
        </div>
      )}

      {b.status === "session_completed" && feedbackSubmitted && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2">Feedback submitted for this session.</p>
        </div>
      )}
    </div>
  );
}
