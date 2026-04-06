import { Link } from "wouter";
import { useUser } from "@clerk/react";
import {
  useGetMe,
  useGetParentDashboard,
  useGetProfessionalDashboard,
  useGetMySubscription,
  useGetPaymentHistory,
  useCreateStripeCheckout,
  getGetMySubscriptionQueryKey,
  getGetPaymentHistoryQueryKey,
  type ParentDashboard,
  type ProfessionalDashboard,
  type SubscriptionStatus,
  type PaymentRecord,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StarRating } from "@/components/StarRating";
import { getSpecialtyLabel } from "@/lib/specialties";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, User, BarChart3, Star, Eye, Phone, Sparkles, CreditCard, TrendingUp, XCircle } from "lucide-react";

export default function DashboardPage() {
  const { user } = useUser();
  const { data: me, isLoading: meLoading } = useGetMe();
  const role = me?.role;

  const { data: parentDash, isLoading: parentLoading } = useGetParentDashboard();
  const { data: proDash, isLoading: proLoading } = useGetProfessionalDashboard();
  const { data: subscription } = useGetMySubscription({
    query: { enabled: role === "parent", queryKey: getGetMySubscriptionQueryKey() },
  });
  const { data: paymentHistory } = useGetPaymentHistory({
    query: { enabled: role === "parent", queryKey: getGetPaymentHistoryQueryKey() },
  });

  if (meLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={28} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-serif font-semibold text-foreground">
            Welcome back, {me?.fullName?.split(" ")[0] ?? user?.firstName ?? "there"}
          </h1>
          <p className="text-muted-foreground mt-1">
            {role === "professional" ? "Manage your profile and track your engagement." : "Find and connect with specialists for your child."}
          </p>
        </div>

        {role === "parent" && (
          <ParentDashboard
            data={parentDash}
            isLoading={parentLoading}
            subscription={subscription}
            paymentHistory={paymentHistory ?? []}
          />
        )}
        {role === "professional" && (
          <ProfessionalDashboard data={proDash} isLoading={proLoading} />
        )}
        {!role && (
          <div className="text-center py-12">
            <Loader2 className="animate-spin text-primary mx-auto" size={28} />
          </div>
        )}
      </div>
    </div>
  );
}

function ParentDashboard({
  data,
  isLoading,
  subscription,
  paymentHistory,
}: {
  data: ParentDashboard | undefined;
  isLoading: boolean;
  subscription: SubscriptionStatus | undefined;
  paymentHistory: PaymentRecord[];
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-primary" size={28} />
      </div>
    );
  }

  const hasActiveSub = subscription?.hasActiveSubscription ?? false;
  const sub = subscription?.subscription;

  return (
    <div className="space-y-6">
      {/* Subscription banner */}
      {!hasActiveSub && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-sm text-foreground">Get unlimited access</p>
            <p className="text-xs text-muted-foreground">Subscribe for ₹499/30 days or unlock individual contacts for ₹99 each.</p>
          </div>
          <Link href="/pricing">
            <Button size="sm" className="gap-2 shrink-0" data-testid="upgrade-cta">
              <Sparkles size={14} />
              See plans
            </Button>
          </Link>
        </div>
      )}

      {hasActiveSub && sub?.expiresAt && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
          <Sparkles size={18} className="text-green-600 shrink-0" />
          <div>
            <p className="font-semibold text-sm text-green-800">Premium active</p>
            <p className="text-xs text-green-700">
              Expires {new Date(sub.expiresAt).toLocaleDateString("en-IN", { month: "long", day: "numeric", year: "numeric" })}
            </p>
          </div>
        </div>
      )}

      {/* Quick stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          icon={<Phone size={18} className="text-primary" />}
          label="Contacts unlocked"
          value={data?.totalUnlocks ?? 0}
        />
        <StatCard
          icon={<Star size={18} className="text-yellow-500" />}
          label="Subscription"
          value={hasActiveSub ? "Premium" : "Free plan"}
        />
        <StatCard
          icon={<Search size={18} className="text-accent" />}
          label="Search professionals"
          value={<Link href="/search"><Button size="sm" className="mt-1" data-testid="parent-search-cta">Find now</Button></Link>}
        />
      </div>

      {/* Recent unlocks */}
      <div className="bg-card border border-border rounded-xl shadow-sm">
        <div className="p-5 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold text-foreground">Recent contacts unlocked</h2>
          <Link href="/search">
            <Button variant="outline" size="sm" className="gap-1">
              <Search size={14} /> Search more
            </Button>
          </Link>
        </div>
        <div className="p-5">
          {(!data?.recentUnlocks || data.recentUnlocks.length === 0) ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">You haven't unlocked any contacts yet.</p>
              <Link href="/search">
                <Button className="mt-4 gap-2" data-testid="find-specialist-btn">
                  <Search size={15} />
                  Find a specialist
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {data.recentUnlocks.map((unlock) => (
                <div key={unlock.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                  <div>
                    <p className="font-medium text-sm">{unlock.professional?.fullName ?? "Professional"}</p>
                    <p className="text-xs text-muted-foreground">
                      {unlock.professional?.specialty ? getSpecialtyLabel(unlock.professional.specialty) : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {new Date(unlock.unlockedAt).toLocaleDateString("en-IN", { month: "short", day: "numeric" })}
                    </span>
                    <Link href={`/professionals/${unlock.professionalId}`}>
                      <Button variant="outline" size="sm">View</Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Payment history */}
      {paymentHistory.length > 0 && (
        <div className="bg-card border border-border rounded-xl shadow-sm">
          <div className="p-5 border-b border-border">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <CreditCard size={16} className="text-muted-foreground" />
              Payment history
            </h2>
          </div>
          <div className="p-5">
            <div className="space-y-3">
              {paymentHistory.slice(0, 5).map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2 border-b border-border/60 last:border-0 last:pb-0">
                  <div>
                    <p className="text-sm font-medium capitalize">{p.plan.replace(/_/g, " ")}</p>
                    <p className="text-xs text-muted-foreground capitalize">{p.provider} · {new Date(p.createdAt).toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" })}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">₹{(p.amountPaise / 100).toFixed(0)}</p>
                    <p className={`text-xs font-medium capitalize ${p.status === "completed" ? "text-green-600" : p.status === "failed" ? "text-red-500" : "text-yellow-600"}`}>
                      {p.status}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfessionalDashboard({ data, isLoading }: { data: ProfessionalDashboard | undefined; isLoading: boolean }) {
  const { toast } = useToast();
  const { mutateAsync: createStripeCheckout, isPending: stripeLoading } = useCreateStripeCheckout();

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  async function handleFeaturedListing() {
    try {
      const origin = window.location.origin;
      const result = await createStripeCheckout({
        data: {
          plan: "plan_c_featured",
          successUrl: `${origin}${basePath}/payment/success?plan=plan_c_featured`,
          cancelUrl: `${origin}${basePath}/payment/cancel`,
        },
      });
      window.location.href = result.url;
    } catch {
      toast({
        title: "Stripe not configured",
        description: "Featured listing requires Stripe. Please contact support.",
        variant: "destructive",
      });
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-primary" size={28} />
      </div>
    );
  }

  const profile = data?.profile;

  if (!profile) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center shadow-sm">
        <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <User size={24} className="text-primary" />
        </div>
        <h2 className="text-lg font-semibold mb-2">Set up your profile</h2>
        <p className="text-muted-foreground text-sm mb-6">Create your professional profile to start appearing in search results.</p>
        <Link href="/onboard">
          <Button data-testid="create-profile-btn">Create profile</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Rejection notice */}
      {profile.verificationStatus === "rejected" && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-start gap-3" data-testid="rejection-notice">
          <XCircle size={20} className="text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-800">Your application was not approved</p>
            <p className="text-sm text-red-700 mt-1">
              Unfortunately, your professional profile application has been reviewed and could not be approved at this time.
              If you have questions or believe this is a mistake, please{" "}
              <a href="/support" className="underline font-medium">contact our support team</a>.
            </p>
          </div>
        </div>
      )}

      {/* Featured listing upsell */}
      <div className="bg-gradient-to-r from-violet-50 to-blue-50 border border-violet-200 rounded-xl p-4 flex items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <TrendingUp size={20} className="text-violet-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-sm text-foreground">Get featured at the top of search</p>
            <p className="text-xs text-muted-foreground">₹299 for 30 days — more parents find you, more inquiries.</p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-2 shrink-0 border-violet-300 text-violet-700 hover:bg-violet-50"
          disabled={stripeLoading}
          onClick={handleFeaturedListing}
          data-testid="featured-listing-cta"
        >
          {stripeLoading ? <Loader2 size={13} className="animate-spin" /> : <CreditCard size={13} />}
          Get featured
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard icon={<Eye size={18} className="text-primary" />} label="Profile views" value={data.totalViews ?? 0} />
        <StatCard icon={<Phone size={18} className="text-accent" />} label="Contact unlocks" value={data.totalUnlocks ?? 0} />
        <StatCard icon={<Star size={18} className="text-yellow-500" />} label="Average rating" value={data.averageRating ? data.averageRating.toFixed(1) : "—"} />
        <StatCard icon={<BarChart3 size={18} className="text-primary" />} label="Total reviews" value={data.totalRatings ?? 0} />
      </div>

      {/* Profile card */}
      <div className="bg-card border border-border rounded-xl shadow-sm">
        <div className="p-5 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold">Your profile</h2>
          <Link href="/onboard">
            <Button variant="outline" size="sm">Edit profile</Button>
          </Link>
        </div>
        <div className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <div>
              <p className="font-semibold">{profile.fullName ?? "Your name"}</p>
              <span className="text-sm text-muted-foreground">{getSpecialtyLabel(profile.specialty)}</span>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Badge
              variant={profile.verificationStatus === "verified" ? "default" : profile.verificationStatus === "rejected" ? "destructive" : "secondary"}
            >
              {profile.verificationStatus === "verified" ? "Verified" :
               profile.verificationStatus === "pending" ? "Pending verification" :
               profile.verificationStatus === "rejected" ? "Application rejected" :
               "Not verified"}
            </Badge>
            {profile.city && <Badge variant="outline">{profile.city}</Badge>}
          </div>
        </div>
      </div>

      {/* Recent ratings */}
      <div className="bg-card border border-border rounded-xl shadow-sm">
        <div className="p-5 border-b border-border">
          <h2 className="font-semibold">Recent reviews</h2>
        </div>
        <div className="p-5">
          {(!data.recentRatings || data.recentRatings.length === 0) ? (
            <p className="text-muted-foreground text-sm text-center py-4">No reviews yet.</p>
          ) : (
            <div className="space-y-3">
              {data.recentRatings.map((r) => (
                <div key={r.id} className="pb-3 border-b border-border/60 last:border-0 last:pb-0">
                  <div className="flex items-center gap-2 mb-1">
                    <StarRating value={r.score} size={13} />
                    <span className="text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" })}
                    </span>
                  </div>
                  {r.comment && <p className="text-sm text-muted-foreground">{r.comment}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-semibold text-foreground">{value}</div>
    </div>
  );
}
