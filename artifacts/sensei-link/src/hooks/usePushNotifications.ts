import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function fetchVapidKey(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/api/notifications/vapid-public-key`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.publicKey ?? null;
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await (window as unknown as { __clerk_session?: { getToken: () => Promise<string | null> } }).__clerk_session?.getToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

export function usePushNotifications() {
  const { isSignedIn, getToken } = useAuth();
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported",
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const checkSubscription = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setIsSubscribed(!!sub);
    } catch {
      setIsSubscribed(false);
    }
  }, []);

  useEffect(() => {
    if (isSignedIn) {
      checkSubscription();
    }
  }, [isSignedIn, checkSubscription]);

  const requestPermissionAndSubscribe = useCallback(async (): Promise<boolean> => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
    if (typeof Notification === "undefined") return false;

    setIsLoading(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") return false;

      const vapidKey = await fetchVapidKey();
      if (!vapidKey) return false;

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      });

      const subJson = sub.toJSON();
      const token = await getToken();
      if (!token) return false;

      const resp = await fetch(`${BASE}/api/notifications/subscribe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          p256dh: subJson.keys?.p256dh,
          auth: subJson.keys?.auth,
        }),
      });

      if (resp.ok) {
        setIsSubscribed(true);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!("serviceWorker" in navigator)) return false;
    setIsLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setIsSubscribed(false);
        return true;
      }

      const endpoint = sub.endpoint;
      await sub.unsubscribe();

      const token = await getToken();
      if (token) {
        await fetch(`${BASE}/api/notifications/subscribe`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ endpoint }),
        });
      }

      setIsSubscribed(false);
      return true;
    } catch {
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  return {
    permission,
    isSubscribed,
    isLoading,
    isSupported: typeof Notification !== "undefined" && "serviceWorker" in navigator && "PushManager" in window,
    requestPermissionAndSubscribe,
    unsubscribe,
    checkSubscription,
  };
}
