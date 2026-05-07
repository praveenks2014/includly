import { useState, useEffect } from "react";
import { useUser, useClerk } from "@clerk/react";
import { fetchWithAuth } from "@/lib/api";
import {
  useGetMe,
  getUpdateMeMutationOptions,
  getGetMeQueryKey,
  useGetNotificationPreferences,
  useUpdateNotificationPreferences,
  getGetNotificationPreferencesQueryKey,
  useGetMyProfessionalProfile,
  getGetMyProfessionalProfileQueryKey,
  useGetSessionCredits,
  getGetSessionCreditsQueryKey,
} from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, User, Bell, Trash2, ShieldAlert, CheckCircle2, Clock, XCircle, AlertCircle, Ticket, Crown, LocateFixed } from "lucide-react";
import { Link, useLocation } from "wouter";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  useCreateRazorpayOrder,
  useVerifyRazorpayPayment,
} from "@workspace/api-client-react";
import { loadRazorpayScript, formatRupees, type RazorpayPaymentResponse, type RazorpaySubscriptionResponse } from "@/lib/razorpay";

export default function AccountPage() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { data: me, isLoading } = useGetMe();
  const { data: notifPrefs } = useGetNotificationPreferences();
  const { data: proProfile } = useGetMyProfessionalProfile({
    query: { queryKey: getGetMyProfessionalProfileQueryKey(), enabled: me?.role === "professional", retry: false },
  });
  const { data: sessionCreditsData, refetch: refetchCredits } = useGetSessionCredits({
    query: { queryKey: getGetSessionCreditsQueryKey(), enabled: me?.role === "parent", retry: false },
  });
  const [showSessionPassModal, setShowSessionPassModal] = useState(false);
  const [sessionPassActivePlan, setSessionPassActivePlan] = useState<string | null>(null);
  const { mutateAsync: createOrder } = useCreateRazorpayOrder();
  const { mutateAsync: verifyPayment } = useVerifyRazorpayPayment();

  async function handleBuySessionPass(planId: "plan_session_pass_5" | "plan_session_pass_10") {
    const loaded = await loadRazorpayScript();
    if (!loaded) {
      toast({ title: "Could not load payment module", description: "Please try again.", variant: "destructive" });
      return;
    }
    setSessionPassActivePlan(planId);
    try {
      const order = await createOrder({ data: { plan: planId } });
      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount!,
        currency: order.currency,
        name: "Includly",
        description: order.planName,
        order_id: order.orderId!,
        handler: async (response: RazorpayPaymentResponse) => {
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
              toast({ title: "Session credits added!", description: planId === "plan_session_pass_5" ? "5 credits added to your account." : "10 credits added to your account." });
              setShowSessionPassModal(false);
              refetchCredits();
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
            setSessionPassActivePlan(null);
            toast({ title: "Payment cancelled" });
          },
        },
      });
      rzp.open();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast({ title: "Could not initiate payment", description: msg, variant: "destructive" });
    } finally {
      setSessionPassActivePlan(null);
    }
  }

  async function handleUpgradeToPro() {
    const loaded = await loadRazorpayScript();
    if (!loaded) {
      toast({ title: "Could not load payment module", description: "Please try again.", variant: "destructive" });
      return;
    }
    try {
      const order = await createOrder({ data: { plan: "plan_e_pro_monthly" } });
      if (order.isSubscription && order.subscriptionId) {
        const rzp = new window.Razorpay({
          key: order.keyId,
          subscription_id: order.subscriptionId,
          name: "Includly",
          description: order.planName,
          handler: async (response: RazorpaySubscriptionResponse) => {
            try {
              const result = await verifyPayment({
                data: {
                  razorpayPaymentId: response.razorpay_payment_id,
                  razorpaySubscriptionId: response.razorpay_subscription_id,
                  razorpaySignature: response.razorpay_signature,
                  paymentId: order.paymentId,
                },
              });
              if (result.success) {
                toast({ title: "Pro activated!", description: "Your Includly Pro subscription is now active." });
              } else {
                toast({ title: "Payment verification failed", variant: "destructive" });
              }
            } catch {
              toast({ title: "Verification error", description: "Please contact support.", variant: "destructive" });
            }
          },
          theme: { color: "#d97706" },
          modal: { ondismiss: () => toast({ title: "Subscription cancelled" }) },
        });
        rzp.open();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast({ title: "Could not initiate subscription", description: msg, variant: "destructive" });
    }
  }

  const [location, setLocation_] = useState("");
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const {
    isSupported: pushSupported,
    permission,
    isSubscribed,
    isLoading: pushLoading,
    requestPermissionAndSubscribe,
    unsubscribe,
  } = usePushNotifications();

  useEffect(() => {
    if (me) {
      setLocation_(me.location ?? "");
    }
  }, [me]);

  const updateMutation = useMutation({
    ...getUpdateMeMutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      toast({ title: "Account updated" });
    },
    onError: () => {
      toast({ title: "Error", description: "Could not update your account.", variant: "destructive" });
    },
  });

  const updatePrefsMutation = useUpdateNotificationPreferences({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetNotificationPreferencesQueryKey() });
      },
      onError: () => {
        toast({ title: "Error", description: "Could not update preferences.", variant: "destructive" });
      },
    },
  });

  function handleSave() {
    updateMutation.mutate({ data: { location } });
  }

  async function handleAutoDetect() {
    if (!navigator.geolocation) {
      toast({ title: "Not supported", description: "Your browser doesn't support location detection.", variant: "destructive" });
      return;
    }
    setIsGettingLocation(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
      );
      const { latitude: lat, longitude: lng } = pos.coords;
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
        { headers: { "Accept-Language": "en" } }
      );
      if (!res.ok) throw new Error("Geocode failed");
      const data = await res.json() as { address?: { suburb?: string; city_district?: string; city?: string; state_district?: string } };
      const area = data.address?.suburb || data.address?.city_district || "";
      const city = data.address?.city || data.address?.state_district || "";
      const detected = [area, city].filter(Boolean).join(", ");
      if (detected) {
        setLocation_(detected);
        toast({ title: "Location detected", description: detected });
      } else {
        toast({ title: "Could not identify area", description: "Please type your area manually.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Location access denied", description: "Please allow location access or enter your area manually.", variant: "destructive" });
    } finally {
      setIsGettingLocation(false);
    }
  }

  async function handleDeleteAccount() {
    if (deleteConfirm !== "DELETE MY ACCOUNT") {
      toast({ title: "Please type DELETE MY ACCOUNT exactly to confirm", variant: "destructive" });
      return;
    }
    setIsDeleting(true);
    try {
      const res = await fetchWithAuth("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmPhrase: "DELETE MY ACCOUNT" }),
      });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? "Failed to delete account");
      }
      await signOut();
      setLocation("/");
      toast({ title: "Account deleted", description: "Your data has been permanently removed." });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Could not delete account.", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleToggleNotifications() {
    if (isSubscribed) {
      await unsubscribe();
      toast({ title: "Notifications disabled" });
    } else {
      const ok = await requestPermissionAndSubscribe();
      if (ok) {
        toast({ title: "Notifications enabled" });
      } else if (permission === "denied") {
        toast({ title: "Blocked", description: "Allow notifications in your browser settings.", variant: "destructive" });
      }
    }
  }

  function handleTogglePref(key: "onUnlock" | "onReview" | "onProfileUpdate", value: boolean) {
    updatePrefsMutation.mutate({ data: { [key]: value } });
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={28} />
      </div>
    );
  }

  const prefs = {
    onUnlock: notifPrefs?.onUnlock ?? true,
    onReview: notifPrefs?.onReview ?? true,
    onProfileUpdate: notifPrefs?.onProfileUpdate ?? true,
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-10">
        <h1 className="text-2xl font-serif font-semibold text-foreground mb-6">Account settings</h1>

        {/* Profile info */}
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm mb-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
              <User size={20} className="text-primary" />
            </div>
            <div>
              <p className="font-semibold text-foreground">{me?.fullName ?? user?.fullName ?? "Your account"}</p>
              <div className="flex items-center gap-2">
                <p className="text-sm text-muted-foreground">{me?.phone ?? user?.primaryPhoneNumber?.phoneNumber}</p>
                {me?.role && (
                  <Badge variant="secondary" className="text-xs capitalize">{me.role}</Badge>
                )}
              </div>
            </div>
          </div>

          <Separator className="mb-5" />

          {me?.role === "parent" && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="location">Your location</Label>
                <p className="text-xs text-muted-foreground mb-1">
                  City, neighbourhood, or area — helps professionals understand where you're based.
                </p>
                <Input
                  id="location"
                  value={location}
                  onChange={(e) => setLocation_(e.target.value)}
                  placeholder="e.g. Bandra, Mumbai or Koramangala, Bengaluru"
                  className="mt-1"
                  data-testid="account-location"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAutoDetect}
                disabled={isGettingLocation || updateMutation.isPending}
                className="gap-2 w-full"
              >
                {isGettingLocation ? <Loader2 size={13} className="animate-spin" /> : <LocateFixed size={13} />}
                {isGettingLocation ? "Detecting location…" : "Auto-detect my location"}
              </Button>
              <Button
                onClick={handleSave}
                disabled={updateMutation.isPending || isGettingLocation}
                className="gap-2"
                data-testid="save-account-btn"
              >
                {updateMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                Save changes
              </Button>
            </div>
          )}
        </div>

        {/* Session Credits (parent only) */}
        {me?.role === "parent" && (
          <div className="bg-card border border-border rounded-xl p-6 shadow-sm mb-6" data-testid="session-credits-section">
            <div className="flex items-center gap-2 mb-4">
              <Ticket size={18} className="text-primary" />
              <h2 className="font-semibold">Session Credits</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Session credits let you book sessions with occupational therapists, speech therapists, and psychiatrists.
            </p>
            <div className="flex items-center justify-between bg-muted/40 rounded-lg px-4 py-3 mb-4">
              <div>
                <p className="text-sm text-muted-foreground">Available credits</p>
                <p className="text-3xl font-bold text-foreground" data-testid="session-credits-balance">
                  {sessionCreditsData?.credits ?? 0}
                </p>
              </div>
              <Ticket size={36} className="text-primary/20" />
            </div>
            <Button onClick={() => setShowSessionPassModal(true)} className="gap-2" data-testid="buy-session-pass-btn">
              <Ticket size={15} />
              Buy session pass
            </Button>
          </div>
        )}

        {/* Session Pass Dialog */}
        <Dialog open={showSessionPassModal} onOpenChange={(v) => !v && setShowSessionPassModal(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="font-serif">Buy session credits</DialogTitle>
              <DialogDescription>Credits are used to book sessions with occupational therapists, speech therapists, and psychiatrists.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 mt-2">
              <div className="border border-border rounded-xl p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wide">Starter pack</p>
                    <p className="font-semibold text-sm mt-0.5">5 session credits</p>
                    <p className="text-xs text-muted-foreground">Book up to 5 sessions</p>
                  </div>
                  <span className="text-xl font-bold">₹245</span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-2"
                  disabled={sessionPassActivePlan !== null}
                  onClick={() => handleBuySessionPass("plan_session_pass_5")}
                  data-testid="buy-pass-5"
                >
                  {sessionPassActivePlan === "plan_session_pass_5" ? <Loader2 size={13} className="animate-spin" /> : null}
                  Pay via UPI/Card — ₹245
                </Button>
              </div>
              <div className="border border-primary bg-primary/5 rounded-xl p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-xs text-primary uppercase font-semibold tracking-wide">Best value</p>
                    <p className="font-semibold text-sm mt-0.5">10 session credits</p>
                    <p className="text-xs text-muted-foreground">Book up to 10 sessions · Save ₹0 per session</p>
                  </div>
                  <span className="text-xl font-bold">₹490</span>
                </div>
                <Button
                  size="sm"
                  className="w-full gap-2"
                  disabled={sessionPassActivePlan !== null}
                  onClick={() => handleBuySessionPass("plan_session_pass_10")}
                  data-testid="buy-pass-10"
                >
                  {sessionPassActivePlan === "plan_session_pass_10" ? <Loader2 size={13} className="animate-spin" /> : null}
                  Pay via UPI/Card — ₹490
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Notifications */}
        {pushSupported && (
          <div className="bg-card border border-border rounded-xl p-6 shadow-sm mb-6" data-testid="notifications-section">
            <div className="flex items-center gap-2 mb-4">
              <Bell size={18} className="text-primary" />
              <h2 className="font-semibold">Notifications</h2>
            </div>

            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-medium">Push notifications</p>
                <p className="text-xs text-muted-foreground">
                  {permission === "denied"
                    ? "Blocked in browser — enable in browser settings"
                    : isSubscribed
                      ? "Active on this device"
                      : "Not enabled on this device"}
                </p>
              </div>
              <Switch
                checked={isSubscribed}
                onCheckedChange={handleToggleNotifications}
                disabled={pushLoading || permission === "denied"}
                data-testid="notifications-toggle"
              />
            </div>

            {isSubscribed && (
              <>
                <Separator className="mb-4" />
                <p className="text-xs text-muted-foreground mb-3 font-medium uppercase tracking-wide">Notification types</p>
                <div className="space-y-3">
                  {me?.role === "professional" && (
                    <>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm">Contact views</p>
                          <p className="text-xs text-muted-foreground">When a parent views your contact info</p>
                        </div>
                        <Switch
                          checked={prefs.onUnlock}
                          onCheckedChange={(v) => handleTogglePref("onUnlock", v)}
                          disabled={updatePrefsMutation.isPending}
                          data-testid="pref-on-unlock"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm">New reviews</p>
                          <p className="text-xs text-muted-foreground">When a parent submits a review</p>
                        </div>
                        <Switch
                          checked={prefs.onReview}
                          onCheckedChange={(v) => handleTogglePref("onReview", v)}
                          disabled={updatePrefsMutation.isPending}
                          data-testid="pref-on-review"
                        />
                      </div>
                    </>
                  )}
                  {me?.role === "parent" && (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm">Profile updates</p>
                        <p className="text-xs text-muted-foreground">When a professional you unlocked updates their profile</p>
                      </div>
                      <Switch
                        checked={prefs.onProfileUpdate}
                        onCheckedChange={(v) => handleTogglePref("onProfileUpdate", v)}
                        disabled={updatePrefsMutation.isPending}
                        data-testid="pref-on-profile-update"
                      />
                    </div>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 text-xs"
                  onClick={() => {
                    updatePrefsMutation.mutate({ data: { onUnlock: false, onReview: false, onProfileUpdate: false } });
                  }}
                  disabled={updatePrefsMutation.isPending}
                  data-testid="disable-all-notifs-btn"
                >
                  Disable all
                </Button>
              </>
            )}
          </div>
        )}

        {/* Verification status (professional only) */}
        {me?.role === "professional" && proProfile && (
          <VerificationStatusCard
            status={proProfile.verificationStatus}
            rejectionReason={proProfile.rejectionReason ?? null}
          />
        )}

        {/* Professional profile link */}
        {me?.role === "professional" && (
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm mb-6">
            <h2 className="font-semibold mb-1">Professional profile</h2>
            <p className="text-sm text-muted-foreground mb-3">Manage your public profile that parents see in search results.</p>
            <Link href="/onboard">
              <Button variant="outline" size="sm" data-testid="edit-pro-profile-btn">Edit professional profile</Button>
            </Link>
          </div>
        )}

        {/* Pro subscription upgrade for professional users */}
        {me?.role === "professional" && (
          <div className="bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-200 rounded-xl p-5 shadow-sm mb-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0">
                <Crown size={18} className="text-amber-600" />
              </div>
              <div>
                <h2 className="font-semibold text-amber-900 flex items-center gap-1.5">
                  Includly Pro
                  <span className="text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-300 px-1.5 py-0.5 rounded-full">₹499/month</span>
                </h2>
                <p className="text-sm text-amber-700 mt-1">
                  Get top placement in search results, a Pro badge on your profile, and access to multi-day schedule templates.
                </p>
                <ul className="text-xs text-amber-700 mt-2 space-y-1">
                  <li className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-amber-600" />⭐ Pro badge visible to parents</li>
                  <li className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-amber-600" />Priority ranking in search results</li>
                  <li className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-amber-600" />Multi-day schedule templates</li>
                </ul>
              </div>
            </div>
            <Button
              className="gap-2 bg-amber-600 hover:bg-amber-700 text-white border-0"
              onClick={handleUpgradeToPro}
              data-testid="upgrade-to-pro-btn"
            >
              <Crown size={14} />
              Subscribe — ₹499/month
            </Button>
            <p className="text-[11px] text-amber-600 mt-2">Auto-renews monthly. Cancel anytime from your Razorpay dashboard.</p>
          </div>
        )}

        {/* GDPR/DPDP Data Deletion */}
        <div className="bg-card border border-destructive/30 rounded-xl p-6 shadow-sm" data-testid="delete-account-section">
          <div className="flex items-center gap-2 mb-4">
            <ShieldAlert size={18} className="text-destructive" />
            <h2 className="font-semibold text-destructive">Delete My Account & Data</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-2">
            Under GDPR and India's DPDP Act 2023, you have the right to erasure of your personal data.
            This will permanently delete your account, all uploaded documents, and anonymize associated records.
            <strong className="block mt-1 text-foreground">This action cannot be undone.</strong>
          </p>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" className="gap-2 mt-2" data-testid="delete-account-btn">
                <Trash2 size={14} />
                Delete My Account
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Permanently delete your account?</AlertDialogTitle>
                <AlertDialogDescription className="space-y-3">
                  <span className="block">
                    All your personal data, documents, and associated records will be permanently deleted.
                    This cannot be undone.
                  </span>
                  <span className="block">
                    Type <strong>DELETE MY ACCOUNT</strong> to confirm:
                  </span>
                  <Input
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    placeholder="DELETE MY ACCOUNT"
                    className="mt-1"
                    data-testid="delete-confirm-input"
                  />
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setDeleteConfirm("")}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDeleteAccount}
                  disabled={isDeleting || deleteConfirm !== "DELETE MY ACCOUNT"}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2"
                  data-testid="confirm-delete-btn"
                >
                  {isDeleting && <Loader2 size={14} className="animate-spin" />}
                  Yes, delete everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}

function VerificationStatusCard({ status, rejectionReason }: { status: string; rejectionReason: string | null }) {
  const config: Record<string, { label: string; description: string; icon: React.ReactNode; cardClass: string; badgeClass: string }> = {
    verified: {
      label: "Approved",
      description: "Your profile has been reviewed and approved. It is now visible to parents in search results.",
      icon: <CheckCircle2 size={18} className="text-green-600" />,
      cardClass: "bg-green-50 border-green-200",
      badgeClass: "bg-green-100 text-green-700 border-green-300",
    },
    pending: {
      label: "Under Review",
      description: "Your profile is currently being reviewed by our team. This typically takes 1–2 business days.",
      icon: <Clock size={18} className="text-yellow-600" />,
      cardClass: "bg-yellow-50 border-yellow-200",
      badgeClass: "bg-yellow-100 text-yellow-700 border-yellow-300",
    },
    rejected: {
      label: "Rejected",
      description: "Your application was not approved. Please review the reason below, update your profile or documents, and resubmit.",
      icon: <XCircle size={18} className="text-red-600" />,
      cardClass: "bg-red-50 border-red-200",
      badgeClass: "bg-red-100 text-red-700 border-red-300",
    },
    unsubmitted: {
      label: "Not Submitted",
      description: "You haven't submitted your profile for review yet. Complete your profile and upload your documents to get started.",
      icon: <AlertCircle size={18} className="text-muted-foreground" />,
      cardClass: "border-border",
      badgeClass: "",
    },
  };

  const cfg = config[status] ?? config.unsubmitted;

  return (
    <div className={`border rounded-xl p-5 shadow-sm mb-6 ${cfg.cardClass}`} data-testid="verification-status-card">
      <div className="flex items-center gap-2 mb-3">
        {cfg.icon}
        <h2 className="font-semibold">Verification Status</h2>
        <Badge variant="outline" className={`text-xs ml-auto ${cfg.badgeClass}`} data-testid="verification-status-badge">
          {cfg.label}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">{cfg.description}</p>
      {status === "rejected" && rejectionReason && (
        <div className="mt-3 rounded-lg bg-red-100 border border-red-200 p-3 text-sm text-red-800">
          <p className="font-medium mb-0.5">Reason provided by admin:</p>
          <p>{rejectionReason}</p>
        </div>
      )}
    </div>
  );
}
