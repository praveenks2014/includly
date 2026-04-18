import { useState } from "react";
import { useLocation } from "wouter";
import {
  useGetBookableSlots,
  useBookSession,
  useVerifySessionPayment,
  useGetSessionCredits,
  getGetSessionCreditsQueryKey,
  type BookableSlot,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CalendarCheck, Clock, IndianRupee, ChevronRight, Ticket, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { loadRazorpayScript } from "@/lib/razorpay";
import type { RazorpayPaymentResponse } from "@/lib/razorpay";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

const CREDIT_SPECIALTIES = ["occupational_therapy", "speech_therapy", "psychiatrist"];

export function BookingWidget({
  professionalId,
  professionalName,
  specialty,
}: {
  professionalId: number;
  professionalName?: string | null;
  specialty?: string;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [date, setDate] = useState<string>(todayIsoDate());
  const [selectedSlot, setSelectedSlot] = useState<BookableSlot | null>(null);
  const [notes, setNotes] = useState("");
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState(false);

  const isCreditSpecialty = specialty ? CREDIT_SPECIALTIES.includes(specialty) : false;

  const { data: slots, isLoading: slotsLoading } = useGetBookableSlots(professionalId, { date });
  const { data: sessionCreditsData, refetch: refetchCredits } = useGetSessionCredits({
    query: {
      queryKey: getGetSessionCreditsQueryKey(),
      enabled: isCreditSpecialty,
      retry: false,
    },
  });

  const { mutateAsync: bookSession } = useBookSession();
  const { mutateAsync: verifyPayment } = useVerifySessionPayment();

  const credits = sessionCreditsData?.credits ?? 0;
  const noCredits = isCreditSpecialty && credits < 1;

  async function handleBook() {
    if (!selectedSlot) return;
    setBooking(true);
    try {
      const result = await bookSession({
        data: {
          professionalId,
          bookedDate: selectedSlot.date,
          startTime: selectedSlot.startTime,
          endTime: selectedSlot.endTime,
          durationMinutes: selectedSlot.durationMinutes,
          amountInr: selectedSlot.priceInr,
          notes: notes.trim() || undefined,
        },
      });

      // Credit-based booking: no Razorpay step needed
      if (result.usedCredit) {
        toast({ title: "Session booked!", description: "1 session credit used. Your session is confirmed." });
        refetchCredits();
        setBooked(true);
        return;
      }

      // Standard Razorpay payment flow
      const loaded = await loadRazorpayScript();
      if (!loaded) {
        toast({ title: "Payment error", description: "Could not load payment gateway", variant: "destructive" });
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const rzp = new window.Razorpay({
          key: result.keyId as string,
          amount: result.amount as number,
          currency: result.currency as string,
          order_id: result.orderId as string,
          name: "Sproutly",
          description: `Session with ${professionalName ?? "specialist"}`,
          handler: async (response: RazorpayPaymentResponse) => {
            try {
              await verifyPayment({
                data: {
                  sessionId: result.sessionId as number,
                  razorpayPaymentId: response.razorpay_payment_id,
                  razorpayOrderId: response.razorpay_order_id,
                  razorpaySignature: response.razorpay_signature,
                },
              });
              toast({ title: "Session booked!", description: "Your session is confirmed." });
              setBooked(true);
              resolve();
            } catch {
              toast({ title: "Payment verification failed", variant: "destructive" });
              reject(new Error("Payment verification failed"));
            }
          },
          modal: {
            ondismiss: () => reject(new Error("dismissed")),
          },
        });
        rzp.open();
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "";
      if (errorMessage !== "dismissed") {
        toast({ title: "Booking failed", description: errorMessage || "Please try again.", variant: "destructive" });
      }
    } finally {
      setBooking(false);
    }
  }

  if (booked) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 shadow-sm text-center">
        <CalendarCheck size={40} className="text-green-500 mx-auto mb-3" />
        <h3 className="font-semibold text-lg text-foreground mb-1">Session Confirmed!</h3>
        <p className="text-sm text-muted-foreground">
          Your session on {selectedSlot?.date} at {selectedSlot?.startTime} has been booked.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => window.location.href = "/sessions"}>
          View my sessions
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <CalendarCheck size={20} className="text-primary" />
          <h2 className="font-serif font-semibold text-lg text-foreground">Book a Session</h2>
        </div>
        {isCreditSpecialty && (
          <div className="flex items-center gap-1.5 text-sm">
            <Ticket size={15} className="text-primary" />
            <span className="font-semibold text-foreground">{credits}</span>
            <span className="text-muted-foreground">credits</span>
          </div>
        )}
      </div>

      {/* No credits warning for credit-specialty */}
      {noCredits && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle size={18} className="text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">No session credits</p>
            <p className="text-xs text-amber-700 mt-0.5 mb-2">
              Booking with occupational therapists, speech therapists, and psychiatrists requires session credits.
            </p>
            <Button size="sm" className="gap-1.5 h-7 text-xs" onClick={() => navigate("/account")}>
              <Ticket size={12} />
              Buy session pass
            </Button>
          </div>
        </div>
      )}

      <div className="mb-4">
        <Label htmlFor="booking-date" className="text-sm mb-1 block">Select date</Label>
        <Input
          id="booking-date"
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
                  disabled={noCredits}
                  className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
                    noCredits
                      ? "border-border text-muted-foreground/50 cursor-not-allowed"
                      : isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:border-primary hover:bg-primary/5"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Clock size={12} />
                    {slot.startTime}
                    <span className="text-xs opacity-70">({slot.durationMinutes}m)</span>
                  </span>
                  {!isCreditSpecialty && (
                    <span className="flex items-center gap-0.5 text-xs mt-0.5 opacity-80">
                      <IndianRupee size={10} />
                      ₹{slot.priceInr}
                    </span>
                  )}
                  {isCreditSpecialty && (
                    <span className="flex items-center gap-0.5 text-xs mt-0.5 opacity-80">
                      <Ticket size={10} />
                      1 credit
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {selectedSlot && !noCredits && (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="bg-muted/40 rounded-lg p-3 text-sm">
                <p className="font-medium">
                  {selectedSlot.date} • {selectedSlot.startTime}–{selectedSlot.endTime}
                  {isCreditSpecialty ? " • 1 session credit" : ` • ₹${selectedSlot.priceInr}`}
                </p>
              </div>
              <div>
                <Label htmlFor="booking-notes" className="text-xs text-muted-foreground mb-1 block">
                  Notes for the specialist (optional)
                </Label>
                <Textarea
                  id="booking-notes"
                  placeholder="Brief description of your child's needs…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="text-sm resize-none"
                  rows={2}
                />
              </div>
              <Button
                className="w-full gap-2"
                onClick={handleBook}
                disabled={booking}
              >
                {booking ? <Loader2 size={14} className="animate-spin" /> : isCreditSpecialty ? <Ticket size={14} /> : <ChevronRight size={14} />}
                {booking
                  ? "Processing…"
                  : isCreditSpecialty
                    ? "Book with 1 credit"
                    : `Book & Pay ₹${selectedSlot.priceInr}`}
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
