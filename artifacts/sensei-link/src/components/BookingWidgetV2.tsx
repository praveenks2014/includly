/**
 * BookingWidgetV2 — Flow B escrow booking
 *
 * State machine from parent's perspective:
 *   1. Parent picks slot → POST /sessions-v2/book → status = requested
 *   2. Pro confirms       → status = confirmed_by_pro  (parent gets notified to pay)
 *   3. Parent pays        → POST /sessions-v2/:id/pay + verify-payment → paid_held
 *   4. OTPs shown to parent. Pro enters start/end OTPs.
 *   5. After end OTP → releasable → admin releases → released
 */
import { useState } from "react";
import {
  useGetBookableSlots,
  useGetMe,
  type BookableSlot,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CalendarCheck, Clock, IndianRupee, ChevronRight, Loader2,
  Info, MapPin, ShieldCheck, AlertCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fetchWithAuth } from "@/lib/api";
import { loadRazorpayScript, type RazorpayPaymentResponse } from "@/lib/razorpay";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

interface BookingV2Result {
  id: number;
  status: string;
  amountInr: number;
  proAmountInr: number;
  markupInr: number;
  gstInr: number;
  startOtp?: string;
  endOtp?: string;
}

export function BookingWidgetV2({
  professionalId,
  professionalName,
  offersHomeVisits,
}: {
  professionalId: number;
  professionalName?: string | null;
  offersHomeVisits?: boolean;
}) {
  const { toast } = useToast();
  const { data: meData } = useGetMe();
  const [date, setDate] = useState(todayIsoDate());
  const [selectedSlot, setSelectedSlot] = useState<BookableSlot | null>(null);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [booking, setBooking] = useState<BookingV2Result | null>(null);
  const [step, setStep] = useState<"select" | "requested" | "pay" | "paid">("select");

  const { data: slots, isLoading: slotsLoading } = useGetBookableSlots(professionalId, { date });

  async function handleBook() {
    if (!selectedSlot) return;
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/sessions-v2/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          professionalId,
          bookedDate: selectedSlot.date,
          startTime: selectedSlot.startTime,
          endTime: selectedSlot.endTime,
          durationMinutes: selectedSlot.durationMinutes,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error ?? "Booking failed", variant: "destructive" }); return; }
      setBooking(data as BookingV2Result);
      setStep("requested");
      toast({ title: "Request sent!", description: "Waiting for the specialist to confirm your slot." });
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handlePay() {
    if (!booking) return;
    setLoading(true);
    try {
      const loaded = await loadRazorpayScript();
      if (!loaded) { toast({ title: "Payment gateway error", variant: "destructive" }); return; }

      const res = await fetchWithAuth(`/api/sessions-v2/${booking.id}/pay`, { method: "POST" });
      const orderData = await res.json();
      if (!res.ok) { toast({ title: orderData.error ?? "Could not create order", variant: "destructive" }); return; }

      await new Promise<void>((resolve, reject) => {
        const rzp = new window.Razorpay({
          key: orderData.keyId as string,
          amount: orderData.amount as number,
          currency: orderData.currency as string,
          order_id: orderData.orderId as string,
          name: "Includly",
          description: `Session with ${professionalName ?? "specialist"}`,
          handler: async (response: RazorpayPaymentResponse) => {
            try {
              const vRes = await fetchWithAuth(`/api/sessions-v2/${booking.id}/verify-payment`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  razorpayPaymentId: response.razorpay_payment_id,
                  razorpayOrderId: response.razorpay_order_id,
                  razorpaySignature: response.razorpay_signature,
                }),
              });
              const vData = await vRes.json();
              if (!vRes.ok) { toast({ title: vData.error ?? "Verification failed", variant: "destructive" }); reject(new Error("verify")); return; }
              setBooking(vData as BookingV2Result);
              setStep("paid");
              toast({ title: "Payment successful!", description: "Your session is confirmed and funds are held securely." });
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
    } finally {
      setLoading(false);
    }
  }

  // ── Step: Paid — show OTPs ──────────────────────────────────────────────────
  if (step === "paid" && booking) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2 text-green-600">
          <ShieldCheck size={22} />
          <h3 className="font-semibold text-base">Payment held securely</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Your payment of <strong>₹{booking.amountInr?.toLocaleString("en-IN")}</strong> is held in escrow and will be released to the specialist after the session is complete.
        </p>
        {(booking.startOtp || booking.endOtp) && (
          <div className="bg-muted/40 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Your session codes</p>
            <p className="text-xs text-muted-foreground">Share these codes with your specialist at the start and end of your session.</p>
            <div className="grid grid-cols-2 gap-3">
              {booking.startOtp && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                  <p className="text-[10px] font-medium text-green-700 mb-1">START CODE</p>
                  <p className="text-2xl font-mono font-bold text-green-800 tracking-[0.2em]">{booking.startOtp}</p>
                </div>
              )}
              {booking.endOtp && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
                  <p className="text-[10px] font-medium text-blue-700 mb-1">END CODE</p>
                  <p className="text-2xl font-mono font-bold text-blue-800 tracking-[0.2em]">{booking.endOtp}</p>
                </div>
              )}
            </div>
          </div>
        )}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle size={14} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800">Don't share these codes before your session starts. The specialist will ask for them.</p>
        </div>
        <Button variant="outline" className="w-full" onClick={() => window.location.href = "/sessions"}>
          View my sessions
        </Button>
      </div>
    );
  }

  // ── Step: Requested — waiting for pro ──────────────────────────────────────
  if (step === "requested" && booking) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 shadow-sm text-center space-y-3">
        <Clock size={36} className="text-amber-500 mx-auto" />
        <h3 className="font-semibold text-foreground">Waiting for confirmation</h3>
        <p className="text-sm text-muted-foreground">
          Your request has been sent to <strong>{professionalName ?? "the specialist"}</strong>. You'll receive a notification once they confirm — then you can complete payment to secure your slot.
        </p>
        <div className="bg-muted/40 rounded-lg p-3 text-xs text-muted-foreground">
          If the specialist doesn't confirm within the allowed window, your request will be automatically cancelled at no charge.
        </div>
        <Button className="w-full gap-2 mt-1" onClick={handlePay} disabled={loading}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <IndianRupee size={14} />}
          Pay ₹{booking.amountInr?.toLocaleString("en-IN")} now
        </Button>
        <p className="text-[11px] text-muted-foreground">You can pay once the specialist confirms. Payment is held securely until the session is complete.</p>
        <Button variant="ghost" size="sm" onClick={() => window.location.href = "/sessions"}>
          View in My Sessions
        </Button>
      </div>
    );
  }

  // ── Step: Select slot ───────────────────────────────────────────────────────
  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-5">
        <CalendarCheck size={20} className="text-primary" />
        <h2 className="font-serif font-semibold text-lg text-foreground">Book a Session</h2>
        <span className="ml-auto text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
          <ShieldCheck size={10} /> Escrow protected
        </span>
      </div>

      {offersHomeVisits && meData && !meData.location && (
        <div className="mb-4 bg-primary/5 border border-primary/20 rounded-lg p-3 flex items-start gap-2">
          <Info size={14} className="text-primary mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">This specialist offers home visits.</span>{" "}
            <a href="/dashboard" className="text-primary underline underline-offset-2">Set your area</a> in your dashboard.
          </p>
        </div>
      )}

      <div className="mb-4">
        <Label htmlFor="bv2-date" className="text-sm mb-1 block">Select date</Label>
        <Input
          id="bv2-date"
          type="date"
          min={todayIsoDate()}
          value={date}
          onChange={(e) => { setDate(e.target.value); setSelectedSlot(null); }}
          className="max-w-xs"
        />
      </div>

      {slotsLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 size={16} className="animate-spin" /> Checking availability…
        </div>
      ) : slots && slots.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">No available slots for this date. Try another day.</p>
      ) : slots && slots.length > 0 ? (
        <div>
          <p className="text-xs text-muted-foreground mb-2">Available time slots</p>
          <div className="flex flex-wrap gap-2 mb-4">
            {slots.map((slot) => {
              const isSelected = selectedSlot?.startTime === slot.startTime && selectedSlot?.date === slot.date;
              return (
                <button
                  key={`${slot.date}-${slot.startTime}`}
                  onClick={() => setSelectedSlot(isSelected ? null : slot)}
                  className={`px-3 py-2 rounded-lg border text-sm transition-colors ${isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary hover:bg-primary/5"}`}
                >
                  <span className="flex items-center gap-1.5">
                    <Clock size={12} />
                    {slot.startTime}
                    <span className="text-xs opacity-70">({slot.durationMinutes}m)</span>
                  </span>
                  <span className="flex items-center gap-0.5 text-xs mt-0.5 opacity-80">
                    <IndianRupee size={10} />
                    ₹{slot.priceInr}
                  </span>
                </button>
              );
            })}
          </div>

          {selectedSlot && (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-1">
                <p className="font-medium">{selectedSlot.date} • {selectedSlot.startTime}–{selectedSlot.endTime} • ₹{selectedSlot.priceInr}</p>
                <p className="text-xs text-muted-foreground">+ platform fee & GST calculated at checkout</p>
              </div>
              <div>
                <Label htmlFor="bv2-notes" className="text-xs text-muted-foreground mb-1 block">Notes for the specialist (optional)</Label>
                <Textarea
                  id="bv2-notes"
                  placeholder="Brief description of your child's needs…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="text-sm resize-none"
                  rows={2}
                />
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex items-start gap-2">
                <ShieldCheck size={14} className="text-blue-600 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-800">
                  Payment is held in escrow until your session is complete and verified with OTP codes. Your money is safe.
                </p>
              </div>
              <Button className="w-full gap-2" onClick={handleBook} disabled={loading}>
                {loading ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
                {loading ? "Processing…" : "Request session"}
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
