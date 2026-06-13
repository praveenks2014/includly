/**
 * ShadowTeacherRequestWidget — Flow A
 *
 * Parent pays a one-time matching fee; admin then assigns a verified shadow teacher.
 * Matching fee is refundable if no match is assigned yet.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { fetchWithAuth } from "@/lib/api";
import { loadRazorpayScript, type RazorpayPaymentResponse } from "@/lib/razorpay";
import {
  UserCheck, Loader2, CheckCircle2, Clock, IndianRupee, ShieldCheck,
  AlertCircle, RefreshCw,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface MatchRequest {
  id: number;
  status: "pending_payment" | "queued" | "matched" | "cancelled" | "refunded" | "payment_failed";
  matchingFeeInr: number;
  matchedAt?: string;
  createdAt: string;
  matchedProName?: string;
}

interface Settings { matchingFeeInr: number; matchingFeeRefundable: boolean }

function useMyMatchRequests() {
  return useQuery<MatchRequest[]>({
    queryKey: ["shadow-teacher-my-request"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/shadow-teacher/my-request");
      return res.json();
    },
    staleTime: 30_000,
  });
}

function useShadowSettings() {
  return useQuery<Settings>({
    queryKey: ["admin-settings-shadow"],
    queryFn: async () => {
      const res = await fetch("/api/settings/public");
      if (!res.ok) throw new Error("Failed to fetch settings");
      const d = await res.json();
      return { matchingFeeInr: d.matchingFeeInr ?? 500, matchingFeeRefundable: d.matchingFeeRefundable ?? true };
    },
    staleTime: 5 * 60_000,
  });
}

const STATUS_UI: Record<MatchRequest["status"], { label: string; color: string; icon: React.ReactNode }> = {
  pending_payment: { label: "Awaiting payment", color: "bg-yellow-100 text-yellow-700", icon: <Clock size={12} /> },
  queued: { label: "In queue — finding match", color: "bg-blue-100 text-blue-700", icon: <Clock size={12} /> },
  matched: { label: "Matched!", color: "bg-green-100 text-green-700", icon: <CheckCircle2 size={12} /> },
  cancelled: { label: "Cancelled", color: "bg-gray-100 text-gray-600", icon: <AlertCircle size={12} /> },
  refunded: { label: "Refunded", color: "bg-gray-100 text-gray-600", icon: <RefreshCw size={12} /> },
  payment_failed: { label: "Payment failed", color: "bg-red-100 text-red-700", icon: <AlertCircle size={12} /> },
};

export function ShadowTeacherRequestWidget() {
  const { toast } = useToast();
  const { data: settings } = useShadowSettings();
  const { data: myRequests, isLoading: loadingRequests, refetch } = useMyMatchRequests();

  const [childDetails, setChildDetails] = useState("");
  const [requirements, setRequirements] = useState("");
  const [loading, setLoading] = useState(false);

  // Active/latest request
  const latestRequest = myRequests?.[0];
  const hasActiveRequest = latestRequest && !["cancelled", "refunded"].includes(latestRequest.status);

  async function handleRequest() {
    setLoading(true);
    try {
      const loaded = await loadRazorpayScript();
      if (!loaded) { toast({ title: "Payment gateway error", variant: "destructive" }); return; }

      const res = await fetchWithAuth("/api/shadow-teacher/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childDetails: childDetails.trim() || undefined, requirements: requirements.trim() || undefined }),
      });
      const orderData = await res.json();
      if (!res.ok) { toast({ title: orderData.error ?? "Could not initiate request", variant: "destructive" }); return; }

      await new Promise<void>((resolve, reject) => {
        const rzp = new window.Razorpay({
          key: orderData.keyId as string,
          amount: orderData.amount as number,
          currency: "INR",
          order_id: orderData.orderId as string,
          name: "Includly",
          description: "Shadow Teacher Matching Fee",
          handler: async (response: RazorpayPaymentResponse) => {
            try {
              const vRes = await fetchWithAuth("/api/shadow-teacher/verify-payment", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  matchId: orderData.matchId,
                  razorpayPaymentId: response.razorpay_payment_id,
                  razorpayOrderId: response.razorpay_order_id,
                  razorpaySignature: response.razorpay_signature,
                }),
              });
              const vData = await vRes.json();
              if (!vRes.ok) { toast({ title: vData.error ?? "Verification failed", variant: "destructive" }); reject(new Error("verify")); return; }
              toast({ title: "Request submitted!", description: "We'll find you a suitable shadow teacher soon." });
              refetch();
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
    } finally {
      setLoading(false);
    }
  }

  if (loadingRequests) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 size={22} className="animate-spin text-primary" />
      </div>
    );
  }

  const fee = settings?.matchingFeeInr ?? 500;
  const refundable = settings?.matchingFeeRefundable ?? true;

  // Show status if there's an active request
  if (hasActiveRequest && latestRequest) {
    const ui = STATUS_UI[latestRequest.status];
    return (
      <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <UserCheck size={20} className="text-primary" />
          <h2 className="font-serif font-semibold text-lg text-foreground">Shadow Teacher Matching</h2>
        </div>

        <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${ui.color}`}>
          {ui.icon}
          {ui.label}
        </div>

        {latestRequest.status === "matched" && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <p className="font-semibold text-green-800 text-sm">Your shadow teacher has been assigned!</p>
            {latestRequest.matchedProName && (
              <p className="text-sm text-green-700 mt-1">Specialist: <strong>{latestRequest.matchedProName}</strong></p>
            )}
            <p className="text-xs text-green-600 mt-2">Our team will be in touch to schedule the first session.</p>
          </div>
        )}

        {latestRequest.status === "queued" && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-sm text-blue-800">Your matching fee has been received. Our team is reviewing your requirements and will assign a suitable shadow teacher shortly.</p>
            <p className="text-xs text-blue-600 mt-2">Typical turnaround: 1–3 business days.</p>
          </div>
        )}

        <div className="text-xs text-muted-foreground">
          Matching fee paid: ₹{latestRequest.matchingFeeInr?.toLocaleString("en-IN")}
          {refundable && latestRequest.status === "queued" && (
            <span className="ml-2 text-green-600">• Refundable if unmatched</span>
          )}
        </div>
      </div>
    );
  }

  // New request form
  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-5">
      <div className="flex items-center gap-2">
        <UserCheck size={20} className="text-primary" />
        <h2 className="font-serif font-semibold text-lg text-foreground">Find a Shadow Teacher</h2>
      </div>

      <p className="text-sm text-muted-foreground">
        A shadow teacher provides one-on-one support for your child in inclusive classrooms or at home. Our team will carefully match you with a verified professional.
      </p>

      <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-1">
        <div className="flex items-center gap-2">
          <IndianRupee size={14} className="text-primary" />
          <span className="font-semibold text-foreground">₹{fee.toLocaleString("en-IN")} matching fee</span>
        </div>
        {refundable && (
          <div className="flex items-center gap-2 text-xs text-green-700">
            <ShieldCheck size={12} />
            <span>Fully refundable if we can't find a match</span>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <Label htmlFor="st-child" className="text-sm mb-1 block">Your child's details</Label>
          <Input
            id="st-child"
            placeholder="Age, diagnosis, school type…"
            value={childDetails}
            onChange={(e) => setChildDetails(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="st-req" className="text-sm mb-1 block">What kind of support are you looking for?</Label>
          <Textarea
            id="st-req"
            placeholder="Describe your child's needs and your expectations…"
            value={requirements}
            onChange={(e) => setRequirements(e.target.value)}
            rows={3}
            className="resize-none text-sm"
          />
        </div>
      </div>

      <Button className="w-full gap-2" onClick={handleRequest} disabled={loading}>
        {loading ? <Loader2 size={14} className="animate-spin" /> : <IndianRupee size={14} />}
        {loading ? "Processing…" : `Pay ₹${fee.toLocaleString("en-IN")} & Submit Request`}
      </Button>

      <p className="text-[11px] text-center text-muted-foreground">
        By submitting you agree to our matching process. {refundable ? "Full refund if no match is found." : "Matching fee is non-refundable."}
      </p>
    </div>
  );
}
