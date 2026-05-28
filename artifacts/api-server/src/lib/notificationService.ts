import webpush from "web-push";
import { db, pushSubscriptionsTable, notificationPreferencesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

function getWebPushConfig() {
  const publicKey = process.env["VAPID_PUBLIC_KEY"];
  const privateKey = process.env["VAPID_PRIVATE_KEY"];
  const subject = process.env["VAPID_SUBJECT"] ?? "mailto:admin@senseilink.com";

  if (!publicKey || !privateKey) return null;

  webpush.setVapidDetails(subject, publicKey, privateKey);
  return { publicKey, privateKey, subject };
}

interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

export async function sendPushNotification(userId: number, payload: PushPayload): Promise<void> {
  if (!getWebPushConfig()) return;

  const subscriptions = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.userId, userId));

  const payloadStr = JSON.stringify(payload);

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payloadStr,
        );
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, sub.id));
        }
      }
    }),
  );
}

export async function getUserPreferences(userId: number) {
  const [prefs] = await db
    .select()
    .from(notificationPreferencesTable)
    .where(eq(notificationPreferencesTable.userId, userId))
    .limit(1);
  return prefs ?? null;
}

export async function notifyProfessionalOnUnlock(professionalUserId: number): Promise<void> {
  const prefs = await getUserPreferences(professionalUserId);
  if (prefs && !prefs.onUnlock) return;

  await sendPushNotification(professionalUserId, {
    title: "New contact view",
    body: "A parent just viewed your contact info",
    url: "/dashboard",
  });
}

export async function notifyProfessionalOnReview(professionalUserId: number): Promise<void> {
  const prefs = await getUserPreferences(professionalUserId);
  if (prefs && !prefs.onReview) return;

  await sendPushNotification(professionalUserId, {
    title: "New review received",
    body: "A parent just submitted a review on your profile",
    url: "/dashboard",
  });
}

export async function notifyCommunityReply(postAuthorUserId: number, professionalName?: string | null): Promise<void> {
  const prefs = await getUserPreferences(postAuthorUserId);
  if (prefs && prefs.onCommunityReply === false) return;

  await sendPushNotification(postAuthorUserId, {
    title: "💬 New answer on your question",
    body: professionalName
      ? `${professionalName} answered your community question.`
      : "A specialist answered your community question.",
    url: "/forum",
  });
}

export async function notifyParentsOnProfileUpdate(parentUserIds: number[]): Promise<void> {
  await Promise.allSettled(
    parentUserIds.map(async (parentId) => {
      const prefs = await getUserPreferences(parentId);
      if (prefs && !prefs.onProfileUpdate) return;

      await sendPushNotification(parentId, {
        title: "Professional profile updated",
        body: "A professional you unlocked has updated their profile",
        url: "/search",
      });
    }),
  );
}
