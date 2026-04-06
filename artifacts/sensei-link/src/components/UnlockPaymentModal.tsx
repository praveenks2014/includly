import { useState } from "react";
import { useLocation } from "wouter";
import {
  useGetPaymentPlans,
  useCreateRazorpayOrder,
  useVerifyRazorpayPayment,
  useCreateStripeCheckout,
  getGetPaymentPlansQueryKey,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Check, Loader2, Zap, CreditCard } from "lucide-react";
import { loadRazorpayScript, formatRupees, type RazorpayPaymentResponse } from "@/lib/razorpay";

type RazorpayResponse = RazorpayPaymentResponse;

export function UnlockPaymentModal({
  open,
  onClose,
  professionalId,
  professionalName,
  onUnlockSuccess,
}: {
  open: boolean;
  onClose: () => void;
  professionalId: number;
  professionalName?: string;
  onUnlockSuccess: () => void;
}) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [activePlan, setActivePlan] = useState<string | null>(null);

  const { data: plans, isLoading: plansLoading } = useGetPaymentPlans({ query: { enabled: open, queryKey: getGetPaymentPlansQueryKey() } });
  const { mutateAsync: createOrder } = useCreateRazorpayOrder();
  const { mutateAsync: verifyPayment } = useVerifyRazorpayPayment();
  const { mutateAsync: createStripeCheckout } = useCreateStripeCheckout();

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  async function handleRazorpayPlan(planId: "plan_a_subscription" | "plan_b_per_contact") {
    const loaded = await loadRazorpayScript();
    if (!loaded) {
      toast({ title: "Could not load payment module", description: "Please try again or contact support.", variant: "destructive" });
      return;
    }

    setActivePlan(planId);
    try {
      const orderData: { plan: "plan_a_subscription" | "plan_b_per_contact"; professionalId?: number } = { plan: planId };
      if (planId === "plan_b_per_contact") {
        orderData.professionalId = professionalId;
      }

      let order;
      try {
        order = await createOrder({ data: orderData });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("contact limit") || msg.includes("CONTACT_LIMIT_REACHED")) {
          toast({
            title: "Monthly contact limit reached",
            description: "Upgrade to Plan A for unlimited contacts this month.",
            variant: "destructive",
          });
          setActivePlan(null);
          return;
        }
        throw err;
      }

      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: "Sproutly",
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
              toast({
                title: planId === "plan_b_per_contact" ? "Contact unlocked!" : "Premium activated!",
                description: planId === "plan_b_per_contact"
                  ? "You can now see the contact details."
                  : "Enjoy 30 days of unlimited access.",
              });
              onUnlockSuccess();
              onClose();
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

  async function handleStripe(planId: "plan_a_subscription" | "plan_b_per_contact") {
    setActivePlan(`stripe_${planId}`);
    try {
      const origin = window.location.origin;
      const result = await createStripeCheckout({
        data: {
          plan: planId,
          professionalId: planId === "plan_b_per_contact" ? professionalId : undefined,
          successUrl: `${origin}${basePath}/payment/success`,
          cancelUrl: `${origin}${basePath}/payment/cancel`,
        },
      });
      window.location.href = result.url;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Stripe is not configured. Please use Razorpay.";
      if (msg.includes("contact limit") || msg.includes("CONTACT_LIMIT_REACHED")) {
        toast({
          title: "Monthly contact limit reached",
          description: "Upgrade to Plan A for unlimited contacts this month.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Stripe unavailable", description: msg, variant: "destructive" });
      }
    } finally {
      setActivePlan(null);
    }
  }

  const isLoading = activePlan !== null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">Unlock contact details</DialogTitle>
          <DialogDescription>
            {professionalName
              ? `Choose how you'd like to access ${professionalName}'s contact information.`
              : "Choose a plan to reveal contact details."}
          </DialogDescription>
        </DialogHeader>

        {plansLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="animate-spin text-primary" size={24} />
          </div>
        ) : (
          <div className="space-y-4">
            {plans && (
              <>
                <PlanOption
                  title={plans.planB.name}
                  price={formatRupees(plans.planB.amountPaise)}
                  description="Unlock just this specialist's contact"
                  features={["One-time unlock", "Never expires", "Instant access"]}
                  badge="Pay per contact"
                  activePlanId={activePlan}
                  planId="plan_b_per_contact"
                  onRazorpay={() => handleRazorpayPlan("plan_b_per_contact")}
                  onStripe={() => handleStripe("plan_b_per_contact")}
                  isLoading={isLoading}
                />

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">or</span>
                  </div>
                </div>

                <PlanOption
                  title={plans.planA.name}
                  price={formatRupees(plans.planA.amountPaise)}
                  description="Unlock unlimited contacts for 30 days"
                  features={["All specialties", "Unlimited unlocks", `30 day access`]}
                  badge="Best value"
                  highlight
                  activePlanId={activePlan}
                  planId="plan_a_subscription"
                  onRazorpay={() => handleRazorpayPlan("plan_a_subscription")}
                  onStripe={() => handleStripe("plan_a_subscription")}
                  isLoading={isLoading}
                />
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PlanOption({
  title,
  price,
  description,
  features,
  badge,
  highlight,
  planId,
  activePlanId,
  onRazorpay,
  onStripe,
  isLoading,
}: {
  title: string;
  price: string;
  description: string;
  features: string[];
  badge: string;
  highlight?: boolean;
  planId: string;
  activePlanId: string | null;
  onRazorpay: () => void;
  onStripe: () => void;
  isLoading: boolean;
}) {
  const rzpLoading = activePlanId === planId;
  const stripeLoading = activePlanId === `stripe_${planId}`;

  return (
    <div className={`rounded-xl border p-4 ${highlight ? "border-primary bg-primary/5" : "border-border"}`}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{badge}</span>
          <h3 className="font-semibold text-sm mt-0.5">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <span className="text-xl font-bold text-foreground">{price}</span>
      </div>
      <ul className="space-y-1 mb-3">
        {features.map((f) => (
          <li key={f} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Check size={11} className="text-green-500 shrink-0" />
            {f}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1 gap-1"
          variant={highlight ? "default" : "outline"}
          disabled={isLoading}
          onClick={onRazorpay}
          data-testid={`pay-razorpay-${planId}`}
        >
          {rzpLoading ? <Loader2 size={13} className="animate-spin" /> : null}
          Pay via UPI/Card
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="flex-1 gap-1 text-xs"
          disabled={isLoading}
          onClick={onStripe}
          data-testid={`pay-stripe-${planId}`}
        >
          {stripeLoading ? <Loader2 size={13} className="animate-spin" /> : null}
          <CreditCard size={13} />
          International card
        </Button>
      </div>
    </div>
  );
}
