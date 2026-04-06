import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@clerk/react";
import {
  useGetPaymentPlans,
  useGetMySubscription,
  useCreateRazorpayOrder,
  useVerifyRazorpayPayment,
  useCreateStripeCheckout,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Check, Loader2, Zap, CreditCard, Shield, Building2 } from "lucide-react";
import { loadRazorpayScript, formatRupees, type RazorpayPaymentResponse } from "@/lib/razorpay";

type RazorpayResponse = RazorpayPaymentResponse;

export default function PricingPage() {
  const [, setLocation] = useLocation();
  const { isSignedIn } = useAuth();
  const { toast } = useToast();

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  const { data: plans, isLoading: plansLoading } = useGetPaymentPlans();
  const { data: sub } = useGetMySubscription();

  const { mutateAsync: createOrder } = useCreateRazorpayOrder();
  const { mutateAsync: verifyPayment } = useVerifyRazorpayPayment();
  const { mutateAsync: createStripeCheckout } = useCreateStripeCheckout();

  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  function requireSignIn() {
    if (!isSignedIn) {
      setLocation("/sign-in");
      return false;
    }
    return true;
  }

  async function handleRazorpay(planId: string, professionalId?: number) {
    if (!requireSignIn()) return;

    const loaded = await loadRazorpayScript();
    if (!loaded) {
      toast({ title: "Could not load payment module", description: "Please try again.", variant: "destructive" });
      return;
    }

    const key = `rzp-${planId}`;
    setLoadingKey(key);
    try {
      const order = await createOrder({
        data: {
          plan: planId as "plan_a_subscription" | "plan_b_per_contact" | "plan_c_featured" | "plan_d_pro_onetime" | "plan_e_pro_monthly",
          professionalId,
        },
      });

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
              toast({ title: "Verification failed", description: "Please contact support.", variant: "destructive" });
            }
          } catch {
            toast({ title: "Verification error", description: "Please contact support.", variant: "destructive" });
          }
        },
        theme: { color: "#4f46e5" },
        modal: {
          ondismiss: () => {
            setLoadingKey(null);
            toast({ title: "Payment cancelled", description: "You can try again anytime." });
          },
        },
      });

      rzp.open();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast({ title: "Could not initiate payment", description: msg, variant: "destructive" });
    } finally {
      setLoadingKey(null);
    }
  }

  async function handleStripe(planId: string, professionalId?: number) {
    if (!requireSignIn()) return;

    const key = `stripe-${planId}`;
    setLoadingKey(key);
    try {
      const origin = window.location.origin;
      const result = await createStripeCheckout({
        data: {
          plan: planId as "plan_a_subscription" | "plan_b_per_contact" | "plan_c_featured",
          professionalId,
          successUrl: `${origin}${basePath}/payment/success`,
          cancelUrl: `${origin}${basePath}/payment/cancel`,
        },
      });
      window.location.href = result.url;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Stripe is not configured.";
      toast({ title: "Stripe unavailable", description: msg, variant: "destructive" });
    } finally {
      setLoadingKey(null);
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
              {/* Plan A — Subscription (parents) */}
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
                disabled={!!hasActiveSub}
                disabledLabel="Already subscribed"
                onRazorpay={() => handleRazorpay("plan_a_subscription")}
                onStripe={() => handleStripe("plan_a_subscription")}
                loadingKey={loadingKey}
                planId="plan_a_subscription"
              />
              {/* Plan B — Per contact (parents, must unlock from profile) */}
              <PlanCard
                plan={plans.planB}
                icon={<CreditCard size={20} className="text-muted-foreground" />}
                features={[
                  "Unlock one specialist's contact",
                  "Pay per contact",
                  "Never expires",
                  "Instant access",
                ]}
                loadingKey={loadingKey}
                planId="plan_b_per_contact"
                profileUnlockOnly
              />
              {/* Plan C — Featured (professionals only, Stripe only) */}
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
                onStripe={() => handleStripe("plan_c_featured")}
                loadingKey={loadingKey}
                planId="plan_c_featured"
                stripeOnly
              />
            </>
          )}
        </div>

        {/* For Professionals section */}
        {plans && (
          <div className="mt-12 mb-8">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-serif font-bold text-foreground mb-2">For Professionals</h2>
              <p className="text-muted-foreground max-w-xl mx-auto">
                Join SenseiLink as a specialist. Simple, transparent pricing to get your profile live and visible to parents.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              {/* Plan D — One-time listing fee */}
              <PlanCard
                plan={plans.planD}
                icon={<Building2 size={20} className="text-primary" />}
                badge="Required"
                highlight
                features={[
                  "One-time fee to go live",
                  "Appear in parent searches",
                  "No monthly commitment",
                  "Profile stays active permanently",
                ]}
                onRazorpay={() => handleRazorpay("plan_d_pro_onetime")}
                loadingKey={loadingKey}
                planId="plan_d_pro_onetime"
              />
              {/* Plan E — Monthly subscription */}
              <PlanCard
                plan={plans.planE}
                icon={<Shield size={20} className="text-purple-600" />}
                badge="Neurologists & Therapy Centres"
                features={[
                  "Premium badge on your profile",
                  "Required for neurologists",
                  "Required for therapy centres",
                  "Monthly renewal",
                ]}
                onRazorpay={() => handleRazorpay("plan_e_pro_monthly")}
                loadingKey={loadingKey}
                planId="plan_e_pro_monthly"
              />
              {/* Plan C — Featured listing */}
              <PlanCard
                plan={plans.planC}
                icon={<Zap size={20} className="text-yellow-500" />}
                badge="Optional boost"
                features={[
                  "Featured at top of search results",
                  "More parent inquiries",
                  "30-day visibility boost",
                  "Build your practice faster",
                ]}
                onStripe={() => handleStripe("plan_c_featured")}
                loadingKey={loadingKey}
                planId="plan_c_featured"
                stripeOnly
              />
            </div>
          </div>
        )}

        <div className="bg-card border border-border rounded-xl p-6 text-center">
          <p className="text-sm text-muted-foreground mb-1">
            Payments are processed securely via Razorpay (UPI, cards, netbanking) or Stripe (international cards).
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
  disabled,
  disabledLabel,
  onRazorpay,
  onStripe,
  loadingKey,
  planId,
  stripeOnly,
  profileUnlockOnly,
  note,
}: {
  plan: PlanDetails;
  icon: React.ReactNode;
  highlight?: boolean;
  badge?: string;
  features: string[];
  disabled?: boolean;
  disabledLabel?: string;
  onRazorpay?: () => void;
  onStripe?: () => void;
  loadingKey: string | null;
  planId: string;
  stripeOnly?: boolean;
  profileUnlockOnly?: boolean;
  note?: string;
}) {
  const rzpLoading = loadingKey === `rzp-${planId}`;
  const stripeLoading = loadingKey === `stripe-${planId}`;

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

      {note && (
        <p className="text-xs text-muted-foreground/70 italic mb-3">{note}</p>
      )}

      {disabled ? (
        <Button className="w-full" disabled>
          {disabledLabel ?? "Unavailable"}
        </Button>
      ) : profileUnlockOnly ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground/70 italic mb-1">
            To unlock a specific specialist, click "Unlock" on their profile or in search results.
          </p>
          <Link href="/search">
            <Button className="w-full" variant="outline" data-testid={`cta-browse-${planId}`}>
              Browse specialists
            </Button>
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {!stripeOnly && onRazorpay && (
            <Button
              className="w-full"
              variant={highlight ? "default" : "outline"}
              disabled={!!loadingKey}
              onClick={onRazorpay}
              data-testid={`cta-rzp-${planId}`}
            >
              {rzpLoading ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
              {rzpLoading ? "Processing…" : "Pay via Razorpay"}
            </Button>
          )}
          {onStripe && (
            <Button
              className="w-full"
              variant="outline"
              disabled={!!loadingKey}
              onClick={onStripe}
              data-testid={`cta-stripe-${planId}`}
            >
              {stripeLoading ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
              {stripeLoading ? "Redirecting…" : stripeOnly ? "Pay with Stripe" : "Pay via Stripe (international)"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
