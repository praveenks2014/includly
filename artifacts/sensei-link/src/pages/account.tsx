import { useState, useEffect } from "react";
import { useUser, useClerk } from "@clerk/react";
import {
  useGetMe,
  getUpdateMeMutationOptions,
  getGetMeQueryKey,
  useGetNotificationPreferences,
  useUpdateNotificationPreferences,
  getGetNotificationPreferencesQueryKey,
  useGetMyProfessionalProfile,
  getGetMyProfessionalProfileQueryKey,
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
import { Loader2, User, Bell, Trash2, ShieldAlert, CheckCircle2, Clock, XCircle, AlertCircle } from "lucide-react";
import { Link, useLocation } from "wouter";
import { usePushNotifications } from "@/hooks/usePushNotifications";

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

  const [fullName, setFullName] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [location, setLocation_] = useState("");
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
      setFullName(me.fullName ?? "");
      setCity(me.city ?? "");
      setCountry(me.country ?? "");
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
    updateMutation.mutate({ data: { fullName, city, country, location } });
  }

  async function handleDeleteAccount() {
    if (deleteConfirm !== "DELETE MY ACCOUNT") {
      toast({ title: "Please type DELETE MY ACCOUNT exactly to confirm", variant: "destructive" });
      return;
    }
    setIsDeleting(true);
    try {
      const res = await fetch("/api/account/delete", {
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

          <div className="space-y-4">
            <div>
              <Label htmlFor="fullName">Full name</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your full name"
                className="mt-1"
                data-testid="account-fullName"
              />
            </div>
            {me?.role === "parent" && (
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
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Mumbai"
                  className="mt-1"
                  data-testid="account-city"
                />
              </div>
              <div>
                <Label htmlFor="country">Country</Label>
                <Input
                  id="country"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="India"
                  className="mt-1"
                  data-testid="account-country"
                />
              </div>
            </div>
          </div>

          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="mt-5 gap-2"
            data-testid="save-account-btn"
          >
            {updateMutation.isPending && <Loader2 size={14} className="animate-spin" />}
            Save changes
          </Button>
        </div>

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
            rejectionReason={(proProfile as unknown as { rejectionReason?: string | null }).rejectionReason ?? null}
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
