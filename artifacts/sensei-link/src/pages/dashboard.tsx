import { Link, useLocation } from "wouter";
import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "@clerk/react";
import {
  useGetMe,
  useUpdateMe,
  getGetMeQueryKey,
  useGetParentDashboard,
  useGetProfessionalDashboard,
  useGetMySubscription,
  useGetPaymentHistory,
  useGetContactUsage,
  useCreateRazorpayOrder,
  useVerifyRazorpayPayment,
  useBroadcastNotification,
  useSetAvailability,
  useUpdateProfessionalProfile,
  getGetMyProfessionalProfileQueryKey,
  getGetProfessionalDashboardQueryKey,
  getGetMySubscriptionQueryKey,
  getGetPaymentHistoryQueryKey,
  getGetContactUsageQueryKey,
  type ParentDashboard,
  type ProfessionalDashboard,
  type SubscriptionStatus,
  type PaymentRecord,
  type ContactUsage,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StarRating } from "@/components/StarRating";
import { getSpecialtyLabel } from "@/lib/specialties";
import { useToast } from "@/hooks/use-toast";
import { NotificationBanner } from "@/components/NotificationBanner";
import { PlacesAutocomplete, type PlaceResult } from "@/components/PlacesAutocomplete";
import { Switch } from "@/components/ui/switch";
import { Loader2, Search, User, BarChart3, Star, Eye, Phone, Sparkles, CreditCard, TrendingUp, XCircle, AlertCircle, Bell, CalendarCheck, CalendarClock, Crown, Columns, Lock, CheckCheck, Home, MapPin } from "lucide-react";
import { loadRazorpayScript, type RazorpayPaymentResponse } from "@/lib/razorpay";

export default function DashboardPage() {
  const { user } = useUser();
  const { data: me, isLoading: meLoading } = useGetMe();
  const [, setLocation] = useLocation();
  const role = me?.role;

  // Safety net: if the user signed up intending to be a professional but Clerk
  // redirected them here instead of /onboard (e.g. after Google OAuth), catch it
  // and send them to /onboard so their role gets set correctly.
  useEffect(() => {
    if (meLoading) return;
    const intent = localStorage.getItem("sproutly_signup_as");
    if (intent === "professional" && role !== "professional" && role !== "admin") {
      setLocation("/onboard");
    }
  }, [meLoading, role, setLocation]);

  const { data: parentDash, isLoading: parentLoading } = useGetParentDashboard();
  const { data: proDash, isLoading: proLoading } = useGetProfessionalDashboard();
  const { data: subscription } = useGetMySubscription({
    query: { enabled: role === "parent", queryKey: getGetMySubscriptionQueryKey() },
  });
  const { data: paymentHistory } = useGetPaymentHistory({
    query: { enabled: role === "parent", queryKey: getGetPaymentHistoryQueryKey() },
  });
  const { data: contactUsage } = useGetContactUsage({
    query: { enabled: role === "parent", queryKey: getGetContactUsageQueryKey() },
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

        <NotificationBanner />

        {role === "parent" && (
          <ParentDashboard
            data={parentDash}
            isLoading={parentLoading}
            subscription={subscription}
            paymentHistory={paymentHistory ?? []}
            contactUsage={contactUsage}
          />
        )}
        {role === "professional" && (
          <ProfessionalDashboard data={proDash} isLoading={proLoading} />
        )}
        {role === "admin" && (
          <AdminDashboard />
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
  contactUsage,
}: {
  data: ParentDashboard | undefined;
  isLoading: boolean;
  subscription: SubscriptionStatus | undefined;
  paymentHistory: PaymentRecord[];
  contactUsage: ContactUsage | undefined;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: me } = useGetMe();
  const { mutateAsync: updateMe } = useUpdateMe();
  const [locationDraft, setLocationDraft] = useState<string>("");
  const [locationCoords, setLocationCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationEditing, setLocationEditing] = useState(false);
  const [locationSaving, setLocationSaving] = useState(false);
  const [consentSaving, setConsentSaving] = useState(false);

  // Sync draft when me loads
  useEffect(() => {
    if (me?.location !== undefined) setLocationDraft(me.location ?? "");
  }, [me?.location]);

  function handleLocationSelect(place: PlaceResult) {
    setLocationDraft(place.city || place.description);
    setLocationCoords({ lat: place.lat, lng: place.lng });
  }

  async function handleSaveLocation() {
    setLocationSaving(true);
    try {
      const payload: { location?: string; latitude?: number; longitude?: number } = {
        location: locationDraft.trim() || undefined,
      };
      if (locationCoords) {
        payload.latitude = locationCoords.lat;
        payload.longitude = locationCoords.lng;
      }
      await updateMe({ data: payload });
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      setLocationEditing(false);
      setLocationCoords(null);
      toast({ title: "Area saved" });
    } catch {
      toast({ title: "Could not save area", variant: "destructive" });
    } finally {
      setLocationSaving(false);
    }
  }

  async function handleToggleConsent(enabled: boolean) {
    setConsentSaving(true);
    try {
      await updateMe({ data: { shareHomeLocation: enabled } });
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      toast({ title: enabled ? "Location sharing enabled" : "Location sharing disabled" });
    } catch {
      toast({ title: "Could not update setting", variant: "destructive" });
    } finally {
      setConsentSaving(false);
    }
  }

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
            <p className="text-xs text-muted-foreground">Subscribe for ₹499/30 days (up to 5 contacts) or unlock individual contacts for ₹149 each.</p>
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

      {/* Contact usage card (non-premium parents only) */}
      {contactUsage && !contactUsage.hasActiveSubscription && (
        <ContactUsageCard usage={contactUsage} />
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

      {/* Parent location + home-visit consent */}
      <div className="bg-card border border-border rounded-xl shadow-sm">
        <div className="p-5 border-b border-border">
          <h2 className="font-semibold">Your area &amp; home-visit preferences</h2>
          <p className="text-xs text-muted-foreground mt-1">Specialists offering home visits can see your area only on confirmed bookings — and only if you opt in below.</p>
        </div>
        <div className="p-5 space-y-4">
          {/* Location field */}
          <div>
            <Label className="text-sm font-medium">Your area</Label>
            {locationEditing ? (
              <div className="flex gap-2 mt-1">
                <div className="flex-1">
                  <PlacesAutocomplete
                    value={locationDraft}
                    onChange={setLocationDraft}
                    onPlaceSelect={handleLocationSelect}
                    placeholder="e.g. Bandra West, Mumbai"
                    data-testid="input-parent-location"
                  />
                </div>
                <Button size="sm" onClick={handleSaveLocation} disabled={locationSaving || !locationDraft.trim()}>
                  {locationSaving ? <Loader2 size={13} className="animate-spin" /> : "Save"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setLocationDraft(me?.location ?? ""); setLocationCoords(null); setLocationEditing(false); }}>Cancel</Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  <MapPin size={13} />
                  {me?.location ? me.location : <em>Not set</em>}
                </span>
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setLocationEditing(true)} data-testid="btn-edit-parent-location">Edit</Button>
              </div>
            )}
          </div>
          {/* Consent toggle */}
          <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
            <div className="flex items-center gap-2">
              <Home size={15} className="text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Share my area for home visits</p>
                <p className="text-xs text-muted-foreground">Your area will be visible to the specialist only after a home-visit booking is confirmed</p>
              </div>
            </div>
            <Switch
              checked={!!me?.shareHomeLocation}
              onCheckedChange={handleToggleConsent}
              disabled={consentSaving || !me?.location}
              data-testid="switch-parent-share-location"
            />
          </div>
          {me?.shareHomeLocation && !me?.location && (
            <p className="text-xs text-amber-600 flex items-center gap-1">
              <AlertCircle size={12} />
              Add your area above to enable location sharing
            </p>
          )}
        </div>
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

const SCHEDULE_TEMPLATES = [
  {
    label: "Weekday mornings",
    description: "Mon–Fri • 9 AM–12 PM",
    days: ["M", "T", "W", "Th", "F"],
    iconColor: "text-primary",
    iconType: "columns" as const,
    slots: [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startTime: "09:00", endTime: "12:00", slotDurationMinutes: 60, priceInr: 500 })),
  },
  {
    label: "Alternating days",
    description: "Mon, Wed, Fri • 9 AM–5 PM",
    days: ["M", "W", "F"],
    iconColor: "text-green-600",
    iconType: "check" as const,
    slots: [1, 3, 5].map((d) => ({ dayOfWeek: d, startTime: "09:00", endTime: "17:00", slotDurationMinutes: 60, priceInr: 500 })),
  },
  {
    label: "Weekends",
    description: "Sat & Sun • 9 AM–5 PM",
    days: ["Sa", "Su"],
    iconColor: "text-blue-600",
    iconType: "calendar" as const,
    slots: [6, 0].map((d) => ({ dayOfWeek: d, startTime: "09:00", endTime: "17:00", slotDurationMinutes: 60, priceInr: 500 })),
  },
];

function ProfessionalDashboard({ data, isLoading }: { data: ProfessionalDashboard | undefined; isLoading: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { mutateAsync: createOrder } = useCreateRazorpayOrder();
  const { mutateAsync: verifyPayment } = useVerifyRazorpayPayment();
  const { mutateAsync: patchProfile } = useUpdateProfessionalProfile();
  const [featuredLoading, setFeaturedLoading] = useState(false);
  const [homeVisitsLoading, setHomeVisitsLoading] = useState(false);
  const { mutateAsync: setAvailability, isPending: applyingTemplate } = useSetAvailability();
  const [applyingLabel, setApplyingLabel] = useState<string | null>(null);

  async function handleToggleHomeVisits(enabled: boolean) {
    setHomeVisitsLoading(true);
    try {
      await patchProfile({ data: { offersHomeVisits: enabled } });
      toast({ title: enabled ? "Home visits enabled" : "Home visits disabled", description: enabled ? "Parents can now request home sessions." : "Home visit requests are now paused." });
      queryClient.invalidateQueries({ queryKey: getGetMyProfessionalProfileQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetProfessionalDashboardQueryKey() });
    } catch {
      toast({ title: "Could not update setting", variant: "destructive" });
    } finally {
      setHomeVisitsLoading(false);
    }
  }

  async function handleApplyTemplate(label: string, slots: { dayOfWeek: number; startTime: string; endTime: string; slotDurationMinutes: number; priceInr: number }[]) {
    setApplyingLabel(label);
    try {
      await setAvailability({ data: { slots } });
      toast({ title: "Schedule applied", description: `${label} pattern set for this week.` });
    } catch {
      toast({ title: "Could not apply template", description: "Please try again or set availability manually.", variant: "destructive" });
    } finally {
      setApplyingLabel(null);
    }
  }

  async function handleFeaturedListing() {
    setFeaturedLoading(true);
    try {
      const loaded = await loadRazorpayScript();
      if (!loaded) {
        toast({ title: "Could not load payment module", description: "Please try again or contact support.", variant: "destructive" });
        return;
      }
      const orderResult = await createOrder({ data: { plan: "plan_c_featured" } });
      await new Promise<void>((resolve, reject) => {
        const rzp = new (window as unknown as { Razorpay: new (opts: unknown) => { open: () => void } }).Razorpay({
          key: orderResult.keyId,
          amount: orderResult.amount,
          currency: orderResult.currency,
          name: "Sproutly",
          description: orderResult.planName,
          order_id: orderResult.orderId,
          handler: async function (response: RazorpayPaymentResponse) {
            try {
              await verifyPayment({
                data: {
                  razorpayOrderId: response.razorpay_order_id,
                  razorpayPaymentId: response.razorpay_payment_id,
                  razorpaySignature: response.razorpay_signature,
                  paymentId: orderResult.paymentId,
                },
              });
              toast({ title: "Featured listing activated!", description: "Your profile is now featured in search results." });
              resolve();
            } catch {
              reject(new Error("Payment verification failed."));
            }
          },
          modal: { ondismiss: () => reject(new Error("cancelled")) },
          theme: { color: "#7c3aed" },
        });
        rzp.open();
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      if (msg !== "cancelled") {
        toast({ title: "Payment failed", description: msg, variant: "destructive" });
      }
    } finally {
      setFeaturedLoading(false);
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

  // Gate: if not yet approved, show only the status screen — no stats, upsells, or schedule tools
  if (profile.verificationStatus !== "verified") {
    return (
      <div className="space-y-4">
        {(profile.verificationStatus === "pending" || profile.verificationStatus === "unsubmitted") && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 flex items-start gap-3" data-testid="pending-approval-notice">
            <AlertCircle size={22} className="text-yellow-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-yellow-800 text-base">
                {profile.verificationStatus === "pending" ? "Awaiting admin approval" : "Profile not yet submitted for review"}
              </p>
              <p className="text-sm text-yellow-700 mt-1.5">
                {profile.verificationStatus === "pending"
                  ? "Your profile is under review. Once approved by an admin, you will appear in search results and this dashboard will unlock. No action needed from your side."
                  : "You haven't submitted your verification documents yet. Complete your profile to start appearing in search results."}
              </p>
              <div className="mt-4 flex gap-2">
                {profile.verificationStatus === "unsubmitted" && (
                  <Link href="/onboard">
                    <Button size="sm" className="gap-1">
                      Complete profile
                    </Button>
                  </Link>
                )}
                <Link href="/onboard">
                  <Button size="sm" variant="outline" className="gap-1">
                    Edit profile
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        )}
        {profile.verificationStatus === "rejected" && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 flex items-start gap-3" data-testid="rejection-notice">
            <XCircle size={22} className="text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-800 text-base">Your application was not approved</p>
              <p className="text-sm text-red-700 mt-1.5">
                Your professional profile application has been reviewed and could not be approved at this time.
                {(profile as { rejectionReason?: string | null }).rejectionReason && (
                  <span> Reason: <em>{(profile as { rejectionReason?: string | null }).rejectionReason}</em>.</span>
                )}
              </p>
              <p className="text-sm text-red-700 mt-1">
                If you have questions or believe this is a mistake, please{" "}
                <a href="/support" className="underline font-medium">contact our support team</a>.
              </p>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
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
          disabled={featuredLoading}
          onClick={handleFeaturedListing}
          data-testid="featured-listing-cta"
        >
          {featuredLoading ? <Loader2 size={13} className="animate-spin" /> : <CreditCard size={13} />}
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

      {/* Sessions quick-actions */}
      <div className="grid grid-cols-2 gap-4">
        <Link href="/sessions">
          <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3 hover:shadow-md transition-shadow cursor-pointer group">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0 group-hover:bg-green-200 transition-colors">
              <CalendarCheck size={18} className="text-green-700" />
            </div>
            <div>
              <p className="font-semibold text-sm text-foreground">My Sessions</p>
              <p className="text-xs text-muted-foreground">View booked sessions</p>
            </div>
          </div>
        </Link>
        <Link href="/availability">
          <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3 hover:shadow-md transition-shadow cursor-pointer group">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0 group-hover:bg-blue-200 transition-colors">
              <CalendarClock size={18} className="text-blue-700" />
            </div>
            <div>
              <p className="font-semibold text-sm text-foreground">Availability</p>
              <p className="text-xs text-muted-foreground">Manage your schedule</p>
            </div>
          </div>
        </Link>
      </div>

      {/* Premium Pro Schedule — multi-day template management, gated by active subscription */}
      {profile.isPremium ? (
        <div className="bg-card border border-amber-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-amber-100 bg-gradient-to-r from-amber-50 to-yellow-50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Crown size={16} className="text-amber-600" />
              <h2 className="font-semibold text-sm text-amber-900">Pro Schedule Templates</h2>
              <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded-full">PRO</span>
            </div>
            <Link href="/availability">
              <Button size="sm" variant="outline" className="text-xs h-7 border-amber-300 text-amber-800 hover:bg-amber-100 gap-1">
                <CalendarClock size={12} />
                Edit slots
              </Button>
            </Link>
          </div>
          <div className="p-5">
            <p className="text-xs text-muted-foreground mb-4">Click a pattern to instantly apply it to your availability calendar.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {SCHEDULE_TEMPLATES.map((template) => {
                const isApplying = applyingLabel === template.label;
                const icon = template.iconType === "columns"
                  ? <Columns size={14} className={template.iconColor} />
                  : template.iconType === "check"
                  ? <CheckCheck size={14} className={template.iconColor} />
                  : <CalendarCheck size={14} className={template.iconColor} />;
                return (
                  <button
                    key={template.label}
                    disabled={applyingTemplate}
                    onClick={() => handleApplyTemplate(template.label, template.slots)}
                    className="text-left border border-border rounded-lg p-3 hover:border-primary/40 hover:bg-primary/5 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                    data-testid={`apply-template-${template.label.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <div className="flex items-center gap-1.5 mb-2">
                      {isApplying ? <Loader2 size={14} className="animate-spin text-primary" /> : icon}
                      <span className="text-xs font-semibold text-foreground">{template.label}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mb-2">{template.description}</p>
                    <div className="flex gap-1">
                      {template.days.map((d) => (
                        <span key={d} className="text-[10px] font-bold bg-primary/10 text-primary rounded px-1.5 py-0.5">{d}</span>
                      ))}
                    </div>
                    <p className="text-[10px] text-primary font-medium mt-2">
                      {isApplying ? "Applying…" : "Tap to apply →"}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0">
              <Lock size={15} className="text-amber-600" />
            </div>
            <div>
              <p className="font-semibold text-sm text-amber-900 flex items-center gap-1.5">
                <Crown size={13} className="text-amber-600" />
                Pro Schedule Templates
              </p>
              <p className="text-xs text-amber-700 mt-0.5">
                Apply multi-day availability patterns instantly. Exclusive to Pro members.
              </p>
            </div>
          </div>
          <Link href="/account">
            <Button size="sm" className="gap-1.5 shrink-0 bg-amber-600 hover:bg-amber-700 text-white border-0">
              <Crown size={12} />
              Upgrade
            </Button>
          </Link>
        </div>
      )}

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
          {/* Home visits toggle — only relevant for hands-on specialties */}
          {["shadow_teacher", "special_tutor", "occupational_therapy", "speech_therapy"].includes(profile.specialty) && (
            <div className="mt-4 pt-4 border-t border-border flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Home size={15} className="text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Home visits</p>
                  <p className="text-xs text-muted-foreground">Let parents book sessions at their home</p>
                </div>
              </div>
              <Switch
                checked={!!profile.offersHomeVisits}
                onCheckedChange={handleToggleHomeVisits}
                disabled={homeVisitsLoading}
                data-testid="switch-home-visits"
              />
            </div>
          )}
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

function ContactUsageCard({ usage }: { usage: ContactUsage }) {
  const { used, limit, resetsAt, activeUnlockCount, nearestExpiryAt } = usage;
  const pct = Math.min((used / limit) * 100, 100);
  const isNearLimit = used >= limit - 1;
  const isAtLimit = used >= limit;

  const resetsAtDate = new Date(resetsAt);
  const nearestExpiry = nearestExpiryAt ? new Date(nearestExpiryAt) : null;
  const daysUntilExpiry = nearestExpiry
    ? Math.max(0, Math.ceil((nearestExpiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  return (
    <div
      className={`border rounded-xl p-4 ${isAtLimit ? "bg-red-50 border-red-200" : isNearLimit ? "bg-yellow-50 border-yellow-200" : "bg-card border-border"}`}
      data-testid="contact-usage-card"
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <p className={`font-semibold text-sm ${isAtLimit ? "text-red-800" : isNearLimit ? "text-yellow-800" : "text-foreground"}`}>
            Teachers unlocked this month
          </p>
          <p className={`text-xs mt-0.5 ${isAtLimit ? "text-red-700" : isNearLimit ? "text-yellow-700" : "text-muted-foreground"}`}>
            Resets {resetsAtDate.toLocaleDateString("en-IN", { month: "long", day: "numeric" })}
            {activeUnlockCount != null && activeUnlockCount > 0 && (
              <span className="ml-2">· {activeUnlockCount} active unlock{activeUnlockCount !== 1 ? "s" : ""}</span>
            )}
          </p>
        </div>
        <span className={`text-xl font-bold ${isAtLimit ? "text-red-700" : isNearLimit ? "text-yellow-700" : "text-foreground"}`}>
          {used} / {limit}
        </span>
      </div>

      <div className="w-full bg-muted rounded-full h-2 mb-3">
        <div
          className={`h-2 rounded-full transition-all ${isAtLimit ? "bg-red-500" : isNearLimit ? "bg-yellow-400" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {daysUntilExpiry !== null && daysUntilExpiry <= 7 && !isAtLimit && (
        <div className="flex items-start gap-2 text-sm text-muted-foreground mb-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5 text-orange-500" />
          <span className="text-orange-700">
            Your earliest unlock expires in {daysUntilExpiry === 0 ? "less than a day" : `${daysUntilExpiry} day${daysUntilExpiry !== 1 ? "s" : ""}`}.
          </span>
        </div>
      )}

      {isAtLimit && (
        <div className="flex items-start gap-2 text-sm text-red-700">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>
            You've reached your monthly unlock limit. <Link href="/pricing" className="font-semibold underline">See our plans</Link> for more access.
          </span>
        </div>
      )}
      {isNearLimit && !isAtLimit && (
        <div className="flex items-start gap-2 text-sm text-yellow-700">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>
            You're almost at your monthly limit. <Link href="/pricing" className="font-semibold underline">See our plans</Link> for more access.
          </span>
        </div>
      )}
    </div>
  );
}


function AdminDashboard() {
  const { toast } = useToast();
  const { mutateAsync: broadcast, isPending } = useBroadcastNotification();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"all" | "professionals" | "parents">("all");

  async function handleBroadcast() {
    if (!title.trim() || !body.trim()) {
      toast({ title: "Title and message are required", variant: "destructive" });
      return;
    }
    try {
      const result = await broadcast({ data: { title: title.trim(), body: body.trim(), audience } });
      toast({ title: "Notification sent", description: `Sent to ${result.sent} device(s).` });
      setTitle("");
      setBody("");
    } catch {
      toast({ title: "Failed to send", description: "An error occurred.", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Bell size={18} className="text-primary" />
          <h2 className="font-semibold">Send push notification</h2>
        </div>
        <div className="space-y-4">
          <div>
            <Label htmlFor="broadcast-title">Title</Label>
            <Input
              id="broadcast-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Notification title"
              className="mt-1"
              data-testid="broadcast-title"
            />
          </div>
          <div>
            <Label htmlFor="broadcast-body">Message</Label>
            <Textarea
              id="broadcast-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Notification message"
              className="mt-1"
              rows={3}
              data-testid="broadcast-body"
            />
          </div>
          <div>
            <Label>Audience</Label>
            <div className="flex gap-2 mt-1">
              {(["all", "professionals", "parents"] as const).map((a) => (
                <Button
                  key={a}
                  size="sm"
                  variant={audience === a ? "default" : "outline"}
                  onClick={() => setAudience(a)}
                  className="capitalize"
                  data-testid={`audience-${a}`}
                >
                  {a}
                </Button>
              ))}
            </div>
          </div>
          <Button
            onClick={handleBroadcast}
            disabled={isPending || !title.trim() || !body.trim()}
            className="gap-2"
            data-testid="send-broadcast-btn"
          >
            {isPending && <Loader2 size={14} className="animate-spin" />}
            Send notification
          </Button>
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
