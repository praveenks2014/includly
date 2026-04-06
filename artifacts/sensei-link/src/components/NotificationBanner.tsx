import { useState } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useToast } from "@/hooks/use-toast";

const DISMISSED_KEY = "notification_banner_dismissed";

export function NotificationBanner() {
  const { permission, isSupported, isSubscribed, isLoading, requestPermissionAndSubscribe } = usePushNotifications();
  const { toast } = useToast();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) === "true";
    } catch {
      return false;
    }
  });

  if (!isSupported || dismissed || isSubscribed || permission === "granted" || permission === "denied") {
    return null;
  }

  function handleDismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, "true");
    } catch {}
  }

  async function handleEnable() {
    const success = await requestPermissionAndSubscribe();
    if (success) {
      toast({ title: "Notifications enabled", description: "You'll receive updates for important activity." });
      setDismissed(true);
    } else if (Notification.permission === "denied") {
      toast({ title: "Notifications blocked", description: "Please allow notifications in your browser settings.", variant: "destructive" });
      setDismissed(true);
    }
  }

  return (
    <div className="bg-primary/10 border border-primary/20 rounded-xl px-4 py-3 flex items-start gap-3 mb-4">
      <Bell size={18} className="text-primary mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">Stay in the loop</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Enable notifications to be alerted when parents view your profile, or when professionals you follow update their info.
        </p>
        <div className="flex gap-2 mt-2">
          <Button size="sm" variant="default" className="h-7 text-xs" onClick={handleEnable} disabled={isLoading}>
            Enable notifications
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={handleDismiss}>
            Not now
          </Button>
        </div>
      </div>
      <button onClick={handleDismiss} className="text-muted-foreground hover:text-foreground">
        <X size={16} />
      </button>
    </div>
  );
}
