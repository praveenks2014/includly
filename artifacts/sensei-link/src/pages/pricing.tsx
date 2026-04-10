import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@clerk/react";
import {
  useGetMe,
  useGetMyProfessionalProfile,
  useGetMySubscription,
  useCreateRazorpayOrder,
  useVerifyRazorpayPayment,
  useCreateStripeCheckout,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Check, Loader2, Zap, CreditCard, UserCheck, Stethoscope, Building2, IndianRupee, CheckCircle2 } from "lucide-react";
import { loadRazorpayScript, formatRupees, type RazorpayPaymentResponse } from "@/lib/razorpay";
import { getSpecialtyLabel } from "@/lib/specialties";

type RazorpayResponse = RazorpayPaymentResponse;

const PARENT_PLANS = [
  {
    id: "plan_a_subscription",
    icon: <Zap size={22} className="text-primary" />,
    iconBg: "bg-primary/10",
    title: "Parent Premium",
    price: "₹499",
    period: "/ 30 days",
    description: "Unlimited contact unlocks for 30 days. Find and connect with as many specialists as you need.",
    features: [
      "30-day unlimited access",
      "Unlock unlimited specialist contacts",
      "All specialties included",
      "Download contact info",
      "Priority listings first",
    ],
    highlight: true,
    badge: "Best value",
  },
  {
    id: "plan_b_per_contact",
    icon: <CreditCard size={22} className="text-muted-foreground" />,
    iconBg: "bg-muted/60",
    title: "Pay Per Contact",
    price: "₹99",
    period: "/ contact",
    description: "Unlock one specialist's contact details. Pay only when you need it.",
    features: [
      "Unlock one specialist's contact",
      "Never expires",
      "Instant access",
      "Add more any time",
    ],
    highlight: false,
    badge: null,
    profileUnlockOnly: true,
  },
];

const PROFESSIONAL_PLANS = [
  {
    specialties: ["shadow_teacher", "special_tutor", "occupational_therapy", "speech_therapy"],
    icon: <UserCheck size={22} className="text-blue-600" />,
    iconBg: "bg-blue-100",
    title: "Educator / Therapist",
    price: 99,
    description: "Shadow Teachers, Special Tutors, Occupational Therapists, Speech Therapists.",
    features: [
      "Verified listing visible to parents",
      "Parent enquiry & booking leads",
      "Session booking integration",
      "₹49 platform fee per confirmed session",
    ],
    commission: "₹49",
    highlight: false,
  },
  {
    specialties: ["psychiatrist", "neurologist", "developmental_pediatrician"],
    icon: <Stethoscope size={22} className="text-green-600" />,
    iconBg: "bg-green-100",
    title: "Medical Specialist",
    price: 299,
    description: "Psychiatrists, Neurologists, Developmental Pediatricians.",
    features: [
      "Premium listing badge",
      "Appointment booking",
      "Teleconsultation support",
      "₹99 platform fee per confirmed session",
    ],
    commission: "₹99",
    highlight: false,
  },
  {
    specialties: ["therapy_centre"],
    icon: <Building2 size={22} className="text-purple-600" />,
    iconBg: "bg-purple-100",
    title: "Therapy Centre",
    price: 999,
    description: "ABA centres, multi-discipline therapy hubs, special education centres.",
    features: [
      "Premium placement in search results",
      "Unlimited seat & session listings",
      "Centre profile + team bios",
      "₹149 platform fee per confirmed session",
    ],
    commission: "₹149",
    highlight: true,
    badge: "Most Popular",
  },
];

export default function PricingPage() {
  const [, setLocation] = useLocation();
  const { isSignedIn } = useAuth();
  const { toast } = useToast();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  const { data: me } = useGetMe();
  const { data: myProfile } = useGetMyProfessionalProfile();
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

  async function handleRazorpay(planId: string) {
    if (!requireSignIn()) return;
    const loaded = await loadRazorpayScript();
    if (!loaded) {
      toast({ title: "Could not load payment module", description: "Please try again.", variant: "destructive" });
      return;
    }
    setLoadingKey(`rzp-${planId}`);
    try {
      const order = await createOrder({
        data: { plan: planId as "plan_a_subscription" | "plan_b_per_contact" },
      });
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

  async function handleStripe(planId: string) {
    if (!requireSignIn()) return;
    setLoadingKey(`stripe-${planId}`);
    try {
      const origin = window.location.origin;
      const result = await createStripeCheckout({
        data: {
          plan: planId as "plan_a_subscription" | "plan_b_per_contact" | "plan_c_featured",
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

  const role = me?.role;
  const isProfessional = role === "professional";
  const hasActiveSub = sub?.hasActiveSubscription;
  const mySpecialty = myProfile?.specialty ?? "";
  const isActivated = myProfile?.paymentActivated ?? false;

  const myPlan = PROFESSIONAL_PLANS.find((p) => p.specialties.includes(mySpecialty));

  if (isProfessional) {
    return (
      <div className="min-h-screen bg-background py-12 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <h1 className="text-3xl font-serif font-bold text-foreground mb-3">Specialist Pricing</h1>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              Flat monthly subscription by specialty. First month is completely FREE.
            </p>
            {isActivated && (
              <div className="mt-4 inline-flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 rounded-full px-4 py-2 text-sm font-medium">
                <Check size={14} />
                Your listing is active
                {mySpecialty ? ` · ${getSpecialtyLabel(mySpecialty)}` : ""}
              </div>
            )}
          </div>

          {myPlan ? (
            <div className="max-w-md mx-auto mb-10">
              <ProfessionalPlanCard plan={myPlan} current />
            </div>
          ) : (
            <div className="grid sm:grid-cols-3 gap-6 mb-10">
              {PROFESSIONAL_PLANS.map((plan) => (
                <ProfessionalPlanCard key={plan.title} plan={plan} />
              ))}
            </div>
          )}

          <div className="bg-muted/30 border border-border rounded-xl p-6 space-y-3">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <IndianRupee size={16} className="text-primary" />
              How session commissions work
            </h3>
            <p className="text-sm text-muted-foreground">
              When a parent books and pays for a session through Sproutly, a small platform fee is deducted before your payout. This covers payment processing and platform maintenance.
            </p>
            <div className="grid sm:grid-cols-3 gap-3 mt-2">
              {[
                { label: "Educators & Therapists", amount: "₹49" },
                { label: "Medical Specialists", amount: "₹99" },
                { label: "Therapy Centres", amount: "₹149" },
              ].map((item) => (
                <div key={item.label} className="bg-background border border-border rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-foreground">{item.amount}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">per session — {item.label}</div>
                </div>
              ))}
            </div>
          </div>

          {!isActivated && (
            <div className="mt-8 text-center">
              <Link href="/onboard">
                <Button size="lg" className="gap-2">
                  <CheckCircle2 size={16} />
                  Complete setup to go live
                </Button>
              </Link>
              <p className="text-xs text-muted-foreground mt-2">
                First month is free. No payment required today.
              </p>
            </div>
          )}

          <div className="mt-8 text-center text-xs text-muted-foreground">
            Billing starts 30 days after activation via UPI auto-debit. Cancel anytime from your dashboard.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-serif font-bold text-foreground mb-3">Find the right specialist</h1>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            Connect with verified specialists for your child. Pay only for what you need.
          </p>
          {hasActiveSub && sub?.subscription && (
            <div className="mt-4 inline-flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 rounded-full px-4 py-2 text-sm font-medium">
              <Check size={14} />
              Premium active until {new Date(sub.subscription.expiresAt!).toLocaleDateString("en-IN", { month: "long", day: "numeric", year: "numeric" })}
            </div>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-6 max-w-2xl mx-auto mb-10">
          {PARENT_PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`relative bg-card border rounded-2xl p-6 flex flex-col shadow-sm ${
                plan.highlight ? "border-primary ring-1 ring-primary" : "border-border"
              }`}
            >
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-primary text-primary-foreground text-xs font-semibold px-3 py-1 rounded-full">
                    {plan.badge}
                  </span>
                </div>
              )}
              <div className={`w-10 h-10 ${plan.iconBg} rounded-lg flex items-center justify-center mb-4`}>
                {plan.icon}
              </div>
              <h2 className="text-xl font-bold text-foreground mb-1">{plan.title}</h2>
              <p className="text-sm text-muted-foreground mb-4 flex-1">{plan.description}</p>
              <div className="mb-5">
                <span className="text-3xl font-bold text-foreground">{plan.price}</span>
                <span className="text-muted-foreground text-sm ml-1">{plan.period}</span>
              </div>
              <ul className="space-y-2 mb-6">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Check size={14} className="text-green-500 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              {plan.profileUnlockOnly ? (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-muted-foreground/70 italic mb-1">
                    To unlock a specific specialist, click "Unlock" on their profile or in search results.
                  </p>
                  <Link href="/search">
                    <Button className="w-full" variant="outline">
                      Browse specialists
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {!isSignedIn ? (
                    <Link href="/sign-up">
                      <Button className="w-full" variant={plan.highlight ? "default" : "outline"}>
                        Get started
                      </Button>
                    </Link>
                  ) : (
                    <>
                      <Button
                        className="w-full"
                        variant={plan.highlight ? "default" : "outline"}
                        disabled={!!loadingKey || !!hasActiveSub}
                        onClick={() => handleRazorpay(plan.id)}
                        data-testid={`cta-rzp-${plan.id}`}
                      >
                        {loadingKey === `rzp-${plan.id}` ? (
                          <Loader2 size={14} className="animate-spin mr-2" />
                        ) : null}
                        {hasActiveSub ? "Already subscribed" : loadingKey === `rzp-${plan.id}` ? "Processing…" : "Pay via Razorpay"}
                      </Button>
                      <Button
                        className="w-full"
                        variant="outline"
                        disabled={!!loadingKey || !!hasActiveSub}
                        onClick={() => handleStripe(plan.id)}
                        data-testid={`cta-stripe-${plan.id}`}
                      >
                        {loadingKey === `stripe-${plan.id}` ? (
                          <Loader2 size={14} className="animate-spin mr-2" />
                        ) : null}
                        {loadingKey === `stripe-${plan.id}` ? "Redirecting…" : "Pay via Stripe"}
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="text-center text-xs text-muted-foreground">
          Payments processed securely via Razorpay (UPI, cards, netbanking) or Stripe (international cards).
          {" "}
          <Link href="/support" className="underline text-primary">Need help?</Link>
        </div>

        <div className="mt-10 bg-muted/30 border border-border rounded-xl p-6 text-center">
          <h3 className="font-semibold text-foreground mb-1">Are you a specialist or therapy centre?</h3>
          <p className="text-sm text-muted-foreground mb-4">Join Sproutly and reach families actively looking for specialists like you.</p>
          <Link href="/sign-up?as=professional">
            <Button variant="outline" size="sm" className="gap-2">
              <UserCheck size={14} />
              Get listed — first month free
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

function ProfessionalPlanCard({
  plan,
  current,
}: {
  plan: typeof PROFESSIONAL_PLANS[number];
  current?: boolean;
}) {
  return (
    <div
      className={`relative bg-card border rounded-2xl p-6 flex flex-col shadow-sm ${
        plan.highlight || current ? "border-primary ring-1 ring-primary" : "border-border"
      }`}
    >
      {plan.badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="bg-primary text-primary-foreground text-xs font-semibold px-3 py-1 rounded-full">
            {plan.badge}
          </span>
        </div>
      )}
      {current && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="bg-green-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
            Your plan
          </span>
        </div>
      )}
      <div className={`w-10 h-10 ${plan.iconBg} rounded-lg flex items-center justify-center mb-4`}>
        {plan.icon}
      </div>
      <h2 className="text-xl font-bold text-foreground mb-1">{plan.title}</h2>
      <p className="text-sm text-muted-foreground mb-4 flex-1">{plan.description}</p>
      <div className="mb-2">
        <span className="text-3xl font-bold text-foreground">₹{plan.price}</span>
        <span className="text-muted-foreground text-sm ml-1">/month</span>
      </div>
      <div className="text-xs text-primary font-medium mb-5">First month FREE — no payment today</div>
      <ul className="space-y-2 mb-4">
        {plan.features.map((f) => (
          <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
            <Check size={14} className="text-green-500 shrink-0" />
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}
