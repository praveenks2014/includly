/**
 * CentreBookingWidget — direct-payment booking for a centre-employed
 * professional, against therapyBookingsTable (not BookingWidgetV2's
 * sessionsV2/sessionBookingsTable flow, which now server-side rejects
 * centre-employed professionals entirely — see the CENTRE_EMPLOYED_
 * PROFESSIONAL gate in POST /sessions/book).
 *
 * Scoped to direct payment only for this pass, matching BookingWidgetV2's
 * own scope — package-purchase-backed booking (POST /therapy-bookings/book
 * with packagePurchaseId) is a real, separate piece of UI (needs its own
 * "buy a package" / "use my package" flow) not built here, not silently
 * folded in.
 *
 * State machine, simpler than BookingWidgetV2's Flow B escrow model —
 * therapy_bookings confirms directly on payment, no separate
 * "pro confirms" step:
 *   1. Parent picks slot → POST /therapy-bookings/book → status = pending_payment
 *   2. Parent pays       → POST /therapy-bookings/verify-payment → status = confirmed
 */
import { useState } from "react";
import {
  useGetBookableSlots,
  type BookableSlot,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  CalendarCheck, Clock, IndianRupee, ChevronRight, Loader2,
  ShieldCheck, AlertCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fetchWithAuth } from "@/lib/api";
import { loadRazorpayScript, type RazorpayPaymentResponse } from "@/lib/razorpay";
import { useSelectedChild } from "@/contexts/SelectedChildContext";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

interface CentreBookingResult {
  id: number;
  status: string;
  amountInr: number;
  startOtp?: string | null;
  endOtp?: string | null;
}

export function CentreBookingWidget({
  professionalId,
  professionalName,
}: {
  professionalId: number;
  professionalName?: string | null;
}) {
  const { toast } = useToast();
  const { selectedChildId } = useSelectedChild();
  const [date, setDate] = useState(todayIsoDate());
  const [selectedSlot, setSelectedSlot] = useState<BookableSlot | null>(null);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [booking, setBooking] = useState<CentreBookingResult | null>(null);
  const [step, setStep] = useState<"select" | "paid">("select");

  const { data: slots, isLoading: slotsLoading } = useGetBookableSlots(professionalId, { date });

  async function handleBook() {
    if (!selectedSlot) return;
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/therapy-bookings/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          professionalId,
          bookedDate: selectedSlot.date,
          startTime: selectedSlot.startTime,
          notes: notes.trim() || undefined,
          childId: selectedChildId ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error ?? "Booking failed", variant: "destructive" }); return; }

      // Direct-pay response: { sessionId, orderId, amount, currency, keyId }
      if (!data.orderId) {
        toast({ title: "This slot requires a package purchase, not yet supported here", variant: "destructive" });
        return;
      }
      setBooking({ id: data.sessionId, status: "pending_payment", amountInr: data.amount / 100 });
      await payNow(data.sessionId, data.orderId, data.amount, data.currency, data.keyId);
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function payNow(bookingId: number, orderId: string, amount: number, currency: string, keyId: string) {
    const loaded = await loadRazorpayScript();
    if (!loaded) { toast({ title: "Payment gateway error", variant: "destructive" }); return; }

    try {
      await new Promise<void>((resolve, reject) => {
        const rzp = new window.Razorpay({
          key: keyId,
          amount,
          currency,
          order_id: orderId,
          name: "Includly",
          description: `Session with ${professionalName ?? "specialist"}`,
          handler: async (response: RazorpayPaymentResponse) => {
            try {
              const vRes = await fetchWithAuth("/api/therapy-bookings/verify-payment", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  bookingId,
                  razorpayPaymentId: response.razorpay_payment_id,
                  razorpayOrderId: response.razorpay_order_id,
                  razorpaySignature: response.razorpay_signature,
                }),
              });
              const vData = await vRes.json();
              if (!vRes.ok) { toast({ title: vData.error ?? "Verification failed", variant: "destructive" }); reject(new Error("verify")); return; }
              setBooking(vData as CentreBookingResult);
              setStep("paid");
              toast({ title: "Payment successful!", description: "Your session is confirmed." });
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
    }
  }

  // ── Step: Paid — show confirmation + OTP codes ──────────────────────────────
  if (step === "paid" && booking) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2 text-green-600">
          <ShieldCheck size={22} />
          <h3 className="font-semibold text-base">Session confirmed</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          <strong>₹{booking.amountInr?.toLocaleString("en-IN")}</strong> paid.
        </p>
        {(booking.startOtp || booking.endOtp) && (
          <div className="bg-muted/40 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Your session codes</p>
            <p className="text-xs text-muted-foreground">Share these codes with your specialist at the start and end of your session.</p>
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
      </div>
    );
  }

  // ── Step: Select slot ────────────────────────────────────────────────────────
  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
      <div className="flex items-center gap-2 text-[#1A2340]">
        <CalendarCheck size={20} />
        <h3 className="font-semibold text-base">Book a session</h3>
      </div>

      <input
        type="date"
        value={date}
        min={todayIsoDate()}
        onChange={(e) => { setDate(e.target.value); setSelectedSlot(null); }}
        className="w-full border border-border rounded-lg px-3 py-2 text-sm"
      />

      {slotsLoading && (
        <div className="flex justify-center py-6"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
      )}

      {!slotsLoading && (slots?.length ?? 0) === 0 && (
        <p className="text-sm text-muted-foreground text-center py-6">No open slots on this date.</p>
      )}

      {!slotsLoading && (slots?.length ?? 0) > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {slots!.map((s) => (
            <button
              key={s.startTime}
              onClick={() => setSelectedSlot(s)}
              className={`text-xs rounded-lg border px-2 py-2 flex flex-col items-center gap-0.5 ${
                selectedSlot?.startTime === s.startTime
                  ? "border-[#2EC4A5] bg-[#2EC4A5]/10 text-[#1A2340]"
                  : "border-border text-muted-foreground hover:border-[#2EC4A5]/50"
              }`}
            >
              <Clock size={12} />
              {s.startTime}
            </button>
          ))}
        </div>
      )}

      {selectedSlot && (
        <>
          <div className="flex items-center gap-1 text-sm text-[#1A2340]">
            <IndianRupee size={14} />
            {selectedSlot.priceInr?.toLocaleString("en-IN")}
            <span className="text-xs text-muted-foreground ml-1">({selectedSlot.durationMinutes} min)</span>
          </div>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything the specialist should know before your session? (optional)"
            className="text-sm"
          />
          <Button onClick={handleBook} disabled={loading} className="w-full bg-[#2EC4A5] hover:bg-[#2EC4A5]/90 text-white gap-1.5">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
            Book & Pay
          </Button>
        </>
      )}

      <p className="text-[11px] text-muted-foreground flex items-center gap-1">
        <AlertCircle size={11} /> Payment is required to confirm your slot.
      </p>
    </div>
  );
}
