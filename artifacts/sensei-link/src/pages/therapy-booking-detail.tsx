import { useParams, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { fetchWithAuth } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Calendar, Clock, IndianRupee, ShieldCheck, AlertTriangle } from "lucide-react";

const BOOKING_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending_payment: { label: "Pending payment", color: "bg-gray-100 text-gray-600 border-gray-200" },
  confirmed: { label: "Confirmed", color: "bg-blue-50 text-blue-700 border-blue-200" },
  session_started: { label: "In session", color: "bg-teal-50 text-teal-700 border-teal-200" },
  session_completed: { label: "Completed", color: "bg-green-50 text-green-700 border-green-200" },
  cancelled_by_parent: { label: "Cancelled (you)", color: "bg-red-50 text-red-700 border-red-200" },
  cancelled_by_centre: { label: "Cancelled (centre)", color: "bg-red-50 text-red-700 border-red-200" },
  refunded: { label: "Refunded", color: "bg-red-50 text-red-700 border-red-200" },
  no_show_parent: { label: "Missed", color: "bg-amber-50 text-amber-700 border-amber-200" },
  no_show_centre: { label: "Centre no-show", color: "bg-amber-50 text-amber-700 border-amber-200" },
};

interface TherapyBookingDetail {
  id: number;
  centreId: number;
  centreName: string | null;
  therapistId: number | null;
  therapistName: string | null;
  serviceId: number;
  serviceName: string | null;
  bookedDate: string;
  startTime: string;
  endTime: string;
  status: string;
  amountInr: number;
  startOtp?: string | null;
  endOtp?: string | null;
  sessionNote: string | null;
}

interface CancellationPolicy {
  window1Hours: number;
  window1RefundPct: number;
  window2Hours: number;
  window2RefundPct: number;
  insideWindow2RefundPct: number;
}

const DEFAULT_POLICY: CancellationPolicy = {
  window1Hours: 24, window1RefundPct: 100,
  window2Hours: 2, window2RefundPct: 50,
  insideWindow2RefundPct: 0,
};

// Mirrors the exact tier logic in POST /therapy-bookings/:id/cancel's
// "parent_cancelled" branch (therapyBookings.ts) -- a preview only, the
// server recomputes this authoritatively at cancel time, but a parent
// should see the real number before confirming, not a guess.
function previewRefundPct(policy: CancellationPolicy, bookedDate: string, startTime: string): number {
  const sessionStart = new Date(`${bookedDate}T${startTime}:00`);
  const hoursUntil = (sessionStart.getTime() - Date.now()) / (60 * 60 * 1000);
  if (hoursUntil >= policy.window1Hours) return policy.window1RefundPct;
  if (hoursUntil >= policy.window2Hours) return policy.window2RefundPct;
  return policy.insideWindow2RefundPct;
}

function parseFeedback(sessionNote: string | null): { sessionCovered: string; childEngagement: string; homeActivities?: string } | null {
  if (!sessionNote) return null;
  try {
    return JSON.parse(sessionNote);
  } catch {
    return null;
  }
}

export default function TherapyBookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const bookingId = Number(id);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const { data: booking, isLoading } = useQuery({
    queryKey: ["therapy-bookings", bookingId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/therapy-bookings/${bookingId}`);
      if (!res.ok) throw new Error("Failed to load booking");
      return (await res.json()) as TherapyBookingDetail;
    },
    enabled: !!bookingId,
  });

  const { data: policy } = useQuery({
    queryKey: ["centres", booking?.centreId, "cancellation-policy"],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/centres/${booking!.centreId}/cancellation-policy`);
      if (!res.ok) throw new Error("Failed to load cancellation policy");
      return (await res.json()) as CancellationPolicy | null;
    },
    enabled: !!booking?.centreId && booking?.status === "confirmed",
  });

  async function handleCancel() {
    setCancelling(true);
    try {
      const res = await fetchWithAuth(`/api/therapy-bookings/${bookingId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "parent_cancelled" }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error ?? "Cancellation failed", variant: "destructive" }); return; }
      toast({ title: "Session cancelled", description: "Your refund will be processed per the centre's cancellation policy." });
      setCancelDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["therapy-bookings"] });
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setCancelling(false);
    }
  }

  if (isLoading) {
    return <div className="flex justify-center py-24"><Loader2 size={24} className="animate-spin text-[#2EC4A5]" /></div>;
  }
  if (!booking) {
    return <p className="text-sm text-muted-foreground text-center py-24">Booking not found.</p>;
  }

  const statusCfg = BOOKING_STATUS_LABEL[booking.status] ?? { label: booking.status, color: "bg-gray-100 text-gray-600 border-gray-200" };
  const feedback = parseFeedback(booking.sessionNote);
  const effectivePolicy = policy ?? DEFAULT_POLICY;
  const refundPreviewPct = previewRefundPct(effectivePolicy, booking.bookedDate, booking.startTime);
  const canCancel = booking.status === "confirmed";

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <h1 className="font-serif text-xl text-[#1A2340]">{booking.serviceName ?? "Session"}</h1>
          <span className={`text-[10px] rounded-full px-2 py-0.5 border ${statusCfg.color}`}>{statusCfg.label}</span>
        </div>
        <p className="text-sm text-muted-foreground">
          {booking.centreName}{booking.therapistName ? ` · ${booking.therapistName}` : ""}
        </p>
        <div className="flex items-center gap-4 mt-3 text-sm text-[#1A2340]">
          <span className="flex items-center gap-1"><Calendar size={14} />{booking.bookedDate}</span>
          <span className="flex items-center gap-1"><Clock size={14} />{booking.startTime}–{booking.endTime}</span>
          <span className="flex items-center gap-1"><IndianRupee size={14} />{booking.amountInr.toLocaleString("en-IN")}</span>
        </div>
      </div>

      {(booking.startOtp || booking.endOtp) && (
        <div className="bg-muted/40 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <ShieldCheck size={13} /> Your session codes
          </p>
          <p className="text-xs text-muted-foreground">Share these with your specialist at the start and end of your session.</p>
          <div className="grid grid-cols-2 gap-3">
            {booking.startOtp && (
              <div className="bg-background rounded-lg p-3 text-center">
                <p className="text-[10px] text-muted-foreground uppercase">Start code</p>
                <p className="text-lg font-bold tracking-wider">{booking.startOtp}</p>
              </div>
            )}
            {booking.endOtp && (
              <div className="bg-background rounded-lg p-3 text-center">
                <p className="text-[10px] text-muted-foreground uppercase">End code</p>
                <p className="text-lg font-bold tracking-wider">{booking.endOtp}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {feedback && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <h2 className="font-semibold text-[#1A2340]">Session Feedback</h2>
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">What was covered</p>
            <p className="text-sm text-foreground whitespace-pre-line">{feedback.sessionCovered}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">How your child engaged</p>
            <p className="text-sm text-foreground whitespace-pre-line">{feedback.childEngagement}</p>
          </div>
          {feedback.homeActivities && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Suggested home activities</p>
              <p className="text-sm text-foreground whitespace-pre-line">{feedback.homeActivities}</p>
            </div>
          )}
        </div>
      )}

      {canCancel && (
        <Button variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => setCancelDialogOpen(true)}>
          Cancel session
        </Button>
      )}

      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif text-[#1A2340]">Cancel this session?</DialogTitle>
          </DialogHeader>
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>
              Based on the centre's cancellation policy, you'll receive a <strong>{refundPreviewPct}%</strong> refund
              (₹{Math.round((booking.amountInr * refundPreviewPct) / 100).toLocaleString("en-IN")} of ₹{booking.amountInr.toLocaleString("en-IN")}).
            </span>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)} disabled={cancelling}>Keep session</Button>
            <Button variant="destructive" onClick={handleCancel} disabled={cancelling}>
              {cancelling ? <Loader2 size={14} className="animate-spin" /> : "Confirm cancellation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
