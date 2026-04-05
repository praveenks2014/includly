import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@clerk/react";
import {
  useGetPaymentPlans,
  useGetMySubscription,
  useCreateRazorpayOrder,
  useVerifyRazorpayPayment,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Check, Loader2, Zap, CreditCard, Shield } from "lucide-react";
import { loadRazorpayScript, formatRupees, type RazorpayPaymentResponse } from "@/lib/razorpay";

type RazorpayResponse = RazorpayPaymentResponse;

export default function PricingPage() {
  const [, setLocation] = useLocation();
  const { isSignedIn } = useAuth();
  const { toast } = useToast();

  const { data: plans, isLoading: plansLoading } = useGetPaymentPlans();
  const { data: sub } = useGetMySubscription();

  const { mutateAsync: createOrder, isPending: orderPending } = useCreateRazorpayOrder();
  const { mutateAsync: verifyPayment, isPending: verifyPending } = useVerifyRazorpayPayment();

  const [activePlan, setActivePlan] = useState<string | null>(null);
  const isLoading = orderPending || verifyPending;

  async function handleRazorpay(planId: string) {
    if (!isSignedIn) {
      setLocation("/sign-in");
      return;
    }

    const loaded = await loadRazorpayScript();
    if (!loaded) {
      toast({ title: "Could not load payment module", description: "Please try again or contact support.", variant: "destructive" });
      return;
    }

    setActivePlan(planId);
    try {
      const order = await createOrder({ data: { plan: planId as "plan_a_subscription" | "plan_b_per_contact" | "plan_c_featured" } });

      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: "SenseiLink",
        description: order.planName,
        order_id: order.orderId,
        handler: async (response: RazorpayResponse) => {
          try {
            const result = await verifyPayment({
              data: {
                razorpayPaymentId: response.razorpay_payment_id,
                razorpayOrderId: response.razorpay_order_id,
                razorpaySignature: response.razorpay_signature,
                paymentId: order.paymentId,
              },
            });
            if (result.success) {
              toast({ title: "Payment successful!", description: result.message });
              setLocation("/payment/success?plan=" + planId);
            } else {
              toast({ title: "Payment verification failed", description: "Please contact support.", variant: "destructive" });
            }
          } catch {
            toast({ title: "Verification error", description: "Please contact support.", variant: "destructive" });
          }
        },
        theme: { color: "#4f46e5" },
        modal: {
          ondismiss: () => {
            setActivePlan(null);
            toast({ title: "Payment cancelled", description: "You can try again anytime." });
          },
        },
      });

      rzp.open();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast({ title: "Could not initiate payment", description: msg, variant: "destructive" });
    } finally {
      setActivePlan(null);
    }
  }

  if (plansLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={28} />
      </div>
    );
  }

  const hasActiveSub = sub?.hasActiveSubscription;

  return (
    <div className="min-h-screen bg-background py-12 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-serif font-bold text-foreground mb-3">Choose your plan</h1>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            Connect with the right specialist for your child. Pay only for what you need.
          </p>
          {hasActiveSub && sub?.subscription && (
            <div className="mt-4 inline-flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 rounded-full px-4 py-2 text-sm font-medium">
              <Check size={14} />
              Premium active until {new Date(sub.subscription.expiresAt!).toLocaleDateString("en-IN", { month: "long", day: "numeric", year: "numeric" })}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          {plans && (
            <>
              <PlanCard
                plan={plans.planA}
                icon={<Zap size={20} className="text-primary" />}
                highlight
                badge="Best value"
                features={[
                  "30-day unlimited access",
                  "Unlock unlimited contacts",
                  "All specialties included",
                  "Download contact info",
                ]}
                ctaLabel={hasActiveSub ? "Already subscribed" : "Get Premium"}
                ctaDisabled={!!hasActiveSub}
                loading={isLoading && activePlan === "plan_a_subscription"}
                onCta={() => handleRazorpay("plan_a_subscription")}
              />
              <PlanCard
                plan={plans.planB}
                icon={<CreditCard size={20} className="text-muted-foreground" />}
                features={[
                  "Unlock one specialist's contact",
                  "Pay per contact",
                  "Never expires",
                  "Instant access",
                ]}
                ctaLabel="Unlock contact"
                loading={isLoading && activePlan === "plan_b_per_contact"}
                onCta={() => handleRazorpay("plan_b_per_contact")}
              />
              <PlanCard
                plan={plans.planC}
                icon={<Shield size={20} className="text-accent" />}
                badge="For professionals"
                features={[
                  "Featured listing for 30 days",
                  "Appear at the top of search",
                  "More parent inquiries",
                  "Build your practice",
                ]}
                ctaLabel="Get featured"
                loading={isLoading && activePlan === "plan_c_featured"}
                onCta={() => handleRazorpay("plan_c_featured")}
              />
            </>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-6 text-center">
          <p className="text-sm text-muted-foreground mb-1">
            Payments are processed securely via Razorpay. All major UPI apps, cards, and netbanking supported.
          </p>
          <p className="text-xs text-muted-foreground">
            Need help?{" "}
            <a href="/support" className="underline text-primary">Contact support</a>
          </p>
        </div>
      </div>
    </div>
  );
}

interface PlanDetails {
  id: string;
  name: string;
  description: string;
  amountPaise: number;
  currency: string;
  durationDays?: number | null;
}

function PlanCard({
  plan,
  icon,
  highlight,
  badge,
  features,
  ctaLabel,
  ctaDisabled,
  loading,
  onCta,
}: {
  plan: PlanDetails;
  icon: React.ReactNode;
  highlight?: boolean;
  badge?: string;
  features: string[];
  ctaLabel: string;
  ctaDisabled?: boolean;
  loading?: boolean;
  onCta: () => void;
}) {
  return (
    <div
      className={`relative bg-card border rounded-2xl p-6 shadow-sm flex flex-col ${
        highlight ? "border-primary ring-1 ring-primary" : "border-border"
      }`}
    >
      {badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge className="px-3 py-1 text-xs font-semibold">{badge}</Badge>
        </div>
      )}
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{plan.id.replace(/_/g, " ")}</span>
      </div>
      <h2 className="text-xl font-bold text-foreground mb-1">{plan.name}</h2>
      <p className="text-sm text-muted-foreground mb-4 flex-1">{plan.description}</p>
      <div className="mb-6">
        <span className="text-3xl font-bold text-foreground">{formatRupees(plan.amountPaise)}</span>
        {plan.durationDays && (
          <span className="text-muted-foreground text-sm ml-1">/ {plan.durationDays} days</span>
        )}
      </div>
      <ul className="space-y-2 mb-6">
        {features.map((f) => (
          <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
            <Check size={14} className="text-green-500 shrink-0" />
            {f}
          </li>
        ))}
      </ul>
      <Button
        className="w-full"
        variant={highlight ? "default" : "outline"}
        disabled={ctaDisabled || loading}
        onClick={onCta}
        data-testid={`cta-${plan.id}`}
      >
        {loading ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
        {ctaLabel}
      </Button>
    </div>
  );
}
