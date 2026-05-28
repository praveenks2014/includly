import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useGetAssessmentOfferings,
  useBookAssessment,
  useVerifyAssessmentPayment,
  getMyAssessmentsQueryKey,
  type AssessmentOfferingType,
} from "@workspace/api-client-react";
import { loadRazorpayScript } from "@/lib/razorpay";
import { fetchWithAuth, getApiBase } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Clock,
  IndianRupee,
  CheckCircle2,
  Calendar,
  ChevronRight,
  User,
} from "lucide-react";

type SlotType = {
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  priceInr: number;
};

type ChildType = { id: number; name: string };

interface Props {
  professionalId: number;
  professionalName: string | null;
  open: boolean;
  onClose: () => void;
}

type Step = "offering" | "slot" | "paying" | "success";

export function AssessmentBookingModal({ professionalId, professionalName, open, onClose }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [step, setStep] = useState<Step>("offering");
  const [selectedOffering, setSelectedOffering] = useState<AssessmentOfferingType | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0]!;
  });
  const [selectedSlot, setSelectedSlot] = useState<SlotType | null>(null);
  const [selectedChildId, setSelectedChildId] = useState<number | undefined>(undefined);
  const [notes, setNotes] = useState("");

  const { data: offerings = [], isLoading: offeringsLoading } = useGetAssessmentOfferings(professionalId, {
    query: { enabled: open },
  });

  const { data: slots = [], isLoading: slotsLoading } = useQuery<SlotType[]>({
    queryKey: [`/professionals/${professionalId}/bookable-slots`, selectedDate],
    queryFn: async () => {
      const res = await fetchWithAuth(`${getApiBase()}/professionals/${professionalId}/bookable-slots?date=${selectedDate}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open && step === "slot" && !!selectedDate,
  });

  const { data: children = [] } = useQuery<ChildType[]>({
    queryKey: ["/children"],
    queryFn: async () => {
      const res = await fetchWithAuth(`${getApiBase()}/children`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open && step === "slot",
  });

  const bookMutation = useBookAssessment();
  const verifyMutation = useVerifyAssessmentPayment();

  function resetAndClose() {
    setStep("offering");
    setSelectedOffering(null);
    setSelectedSlot(null);
    setSelectedChildId(undefined);
    setNotes("");
    onClose();
  }

  async function handleBook() {
    if (!selectedOffering || !selectedSlot) return;
    setStep("paying");

    const loaded = await loadRazorpayScript();
    if (!loaded) {
      toast({ title: "Could not load payment gateway", variant: "destructive" });
      setStep("slot");
      return;
    }

    let orderData: Awaited<ReturnType<typeof bookMutation.mutateAsync>> | null = null;
    try {
      orderData = await bookMutation.mutateAsync({
        professionalId,
        offeringId: selectedOffering.id,
        bookedDate: selectedSlot.date,
        startTime: selectedSlot.startTime,
        endTime: selectedSlot.endTime,
        durationMinutes: selectedSlot.durationMinutes,
        childId: selectedChildId,
        notes: notes.trim() || undefined,
      });
    } catch {
      toast({ title: "Could not create booking", variant: "destructive" });
      setStep("slot");
      return;
    }

    const rzp = new window.Razorpay({
      key: orderData.keyId,
      amount: orderData.amount,
      currency: orderData.currency,
      name: "Includly",
      description: `Assessment: ${selectedOffering.title}`,
      order_id: orderData.orderId,
      handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
        try {
          await verifyMutation.mutateAsync({
            assessmentId: orderData!.assessmentId,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpayOrderId: response.razorpay_order_id,
            razorpaySignature: response.razorpay_signature,
          });
          void qc.invalidateQueries({ queryKey: getMyAssessmentsQueryKey() });
          setStep("success");
        } catch {
          toast({ title: "Payment verification failed. Contact support.", variant: "destructive" });
          setStep("slot");
        }
      },
      theme: { color: "#2EC4A5" },
      modal: {
        ondismiss: () => {
          setStep("slot");
        },
      },
    });
    rzp.open();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetAndClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-[#1A2340]">
            {step === "success" ? "Booking Confirmed" : `Book Assessment — ${professionalName ?? "Specialist"}`}
          </DialogTitle>
        </DialogHeader>

        {/* ── Step: picking an offering ───────────────────────────────── */}
        {step === "offering" && (
          <div className="space-y-3 pt-1">
            {offeringsLoading && (
              <div className="flex justify-center py-8">
                <Loader2 className="animate-spin text-[#2EC4A5]" size={28} />
              </div>
            )}
            {!offeringsLoading && offerings.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-6">
                No assessment offerings listed by this specialist yet.
              </p>
            )}
            {offerings.map((o) => (
              <button
                key={o.id}
                onClick={() => { setSelectedOffering(o); setStep("slot"); }}
                className="w-full text-left p-4 rounded-xl border border-gray-100 hover:border-[#2EC4A5] hover:bg-[#2EC4A5]/5 transition-all group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[#1A2340] text-sm group-hover:text-[#2EC4A5] transition-colors">
                      {o.title}
                    </p>
                    {o.description && (
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{o.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2">
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <Clock size={11} /> {o.durationMinutes} min
                      </span>
                      {o.whatIsIncluded && (
                        <span className="text-xs text-[#2EC4A5] truncate max-w-[180px]">{o.whatIsIncluded}</span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-bold text-[#1A2340] text-base">
                      ₹{o.priceInr.toLocaleString("en-IN")}
                    </p>
                    <ChevronRight size={16} className="text-gray-300 group-hover:text-[#2EC4A5] ml-auto mt-1 transition-colors" />
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ── Step: picking a slot ─────────────────────────────────────── */}
        {step === "slot" && selectedOffering && (
          <div className="space-y-4 pt-1">
            {/* Selected offering summary */}
            <div className="p-3 bg-[#2EC4A5]/5 border border-[#2EC4A5]/20 rounded-xl flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-[#2EC4A5]">{selectedOffering.title}</p>
                <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                  <Clock size={10} /> {selectedOffering.durationMinutes} min
                </p>
              </div>
              <p className="font-bold text-[#1A2340]">₹{selectedOffering.priceInr.toLocaleString("en-IN")}</p>
            </div>

            {/* Date picker */}
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1.5 flex items-center gap-1.5">
                <Calendar size={12} /> Select Date
              </label>
              <input
                type="date"
                value={selectedDate}
                min={new Date(Date.now() + 86400000).toISOString().split("T")[0]}
                onChange={(e) => { setSelectedDate(e.target.value); setSelectedSlot(null); }}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2EC4A5]"
              />
            </div>

            {/* Slot picker */}
            {selectedDate && (
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Available Slots</label>
                {slotsLoading ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="animate-spin text-[#2EC4A5]" size={20} />
                  </div>
                ) : slots.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-3">No slots available on this date</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {slots.map((s) => (
                      <button
                        key={s.startTime}
                        onClick={() => setSelectedSlot(s)}
                        className={`text-xs py-2 px-1 rounded-lg border transition-all ${
                          selectedSlot?.startTime === s.startTime
                            ? "border-[#2EC4A5] bg-[#2EC4A5] text-white font-semibold"
                            : "border-gray-200 text-gray-600 hover:border-[#2EC4A5]"
                        }`}
                      >
                        {s.startTime}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Child selector */}
            {children.length > 0 && (
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1.5 flex items-center gap-1.5">
                  <User size={12} /> For which child? <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {children.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setSelectedChildId(selectedChildId === c.id ? undefined : c.id)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                        selectedChildId === c.id
                          ? "border-[#2EC4A5] bg-[#2EC4A5] text-white font-semibold"
                          : "border-gray-200 text-gray-600 hover:border-[#2EC4A5]"
                      }`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Notes for specialist <span className="font-normal text-gray-400">(optional)</span></label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="E.g. specific concerns, previous assessments..."
                rows={2}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#2EC4A5]"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => { setStep("offering"); setSelectedSlot(null); }}>
                Back
              </Button>
              <Button
                className="flex-1 bg-[#2EC4A5] hover:bg-[#25a98d] text-white"
                disabled={!selectedSlot}
                onClick={handleBook}
              >
                Pay ₹{selectedOffering.priceInr.toLocaleString("en-IN")}
              </Button>
            </div>
          </div>
        )}

        {/* ── Step: paying (waiting for Razorpay) ─────────────────────── */}
        {step === "paying" && (
          <div className="flex flex-col items-center py-10 gap-3">
            <Loader2 className="animate-spin text-[#2EC4A5]" size={36} />
            <p className="text-sm text-gray-500">Opening payment gateway…</p>
          </div>
        )}

        {/* ── Step: success ────────────────────────────────────────────── */}
        {step === "success" && (
          <div className="flex flex-col items-center py-8 gap-4 text-center">
            <div className="w-16 h-16 rounded-full bg-[#2EC4A5]/10 flex items-center justify-center">
              <CheckCircle2 size={36} className="text-[#2EC4A5]" />
            </div>
            <div>
              <p className="font-serif font-bold text-[#1A2340] text-lg">Assessment Booked!</p>
              <p className="text-sm text-gray-500 mt-1">
                Your booking is confirmed. The specialist will reach out with next steps.
              </p>
            </div>
            <Button className="bg-[#2EC4A5] hover:bg-[#25a98d] text-white" onClick={resetAndClose}>
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
