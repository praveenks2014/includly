import { useState, useEffect } from "react";
import { useUser } from "@clerk/react";
import {
  useGetMe,
  getUpdateMeMutationOptions,
  getGetMeQueryKey,
  useGetNotificationPreferences,
  useUpdateNotificationPreferences,
  getGetNotificationPreferencesQueryKey,
} from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, User, Bell } from "lucide-react";
import { Link } from "wouter";
import { usePushNotifications } from "@/hooks/usePushNotifications";

export default function AccountPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: me, isLoading } = useGetMe();
  const { data: notifPrefs } = useGetNotificationPreferences();

  const [fullName, setFullName] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");

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
    updateMutation.mutate({ data: { fullName, city, country } });
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

        {/* Professional profile link */}
        {me?.role === "professional" && (
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
            <h2 className="font-semibold mb-1">Professional profile</h2>
            <p className="text-sm text-muted-foreground mb-3">Manage your public profile that parents see in search results.</p>
            <Link href="/onboard">
              <Button variant="outline" size="sm" data-testid="edit-pro-profile-btn">Edit professional profile</Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
