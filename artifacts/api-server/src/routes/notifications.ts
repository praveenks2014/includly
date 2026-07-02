import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import webpush from "web-push";
import { db, pushSubscriptionsTable, notificationPreferencesTable, notificationsTable, usersTable, contactUnlocksTable, professionalProfilesTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";

const router: IRouter = Router();

function getVapidPublicKey(): string | null {
  return process.env["VAPID_PUBLIC_KEY"] ?? null;
}

function setupWebPush(): boolean {
  const publicKey = process.env["VAPID_PUBLIC_KEY"];
  const privateKey = process.env["VAPID_PRIVATE_KEY"];
  const subject = process.env["VAPID_SUBJECT"] ?? "mailto:theglobalpitstop@gmail.com";
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

// ── GET /notifications — in-app inbox (newest first, max 50) ─────────────────
router.get("/notifications", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, req.userId!))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(50);

  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(notificationsTable)
    .where(and(eq(notificationsTable.userId, req.userId!), eq(notificationsTable.isRead, false)));

  res.json({ notifications: rows, unreadCount: count ?? 0 });
});

// ── PATCH /notifications/:id/read — mark own notification as read ─────────────
router.patch("/notifications/:id/read", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.id, id))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.userId !== req.userId!) { res.status(403).json({ error: "Access denied" }); return; }

  const [updated] = await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(eq(notificationsTable.id, id))
    .returning();

  res.json(updated);
});

// ── PATCH /notifications/read-all — mark all own notifications as read ────────
router.patch("/notifications/read-all", requireAuth, async (req: Request, res: Response): Promise<void> => {
  await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.userId, req.userId!), eq(notificationsTable.isRead, false)));
  res.json({ ok: true });
});

router.get("/notifications/vapid-public-key", (_req: Request, res: Response): void => {
  const key = getVapidPublicKey();
  if (!key) {
    res.status(503).json({ error: "Push notifications not configured" });
    return;
  }
  res.json({ publicKey: key });
});

router.post("/notifications/subscribe", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { endpoint, p256dh, auth } = req.body ?? {};
  if (!endpoint || !p256dh || !auth) {
    res.status(400).json({ error: "endpoint, p256dh, and auth are required" });
    return;
  }

  const existing = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(
      and(
        eq(pushSubscriptionsTable.userId, req.userId!),
        eq(pushSubscriptionsTable.endpoint, endpoint),
      ),
    )
    .limit(1);

  if (existing.length === 0) {
    await db.insert(pushSubscriptionsTable).values({
      userId: req.userId!,
      endpoint,
      p256dh,
      auth,
    });
  }

  res.json({ success: true });
});

router.delete("/notifications/subscribe", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { endpoint } = req.body ?? {};
  if (endpoint) {
    await db
      .delete(pushSubscriptionsTable)
      .where(
        and(
          eq(pushSubscriptionsTable.userId, req.userId!),
          eq(pushSubscriptionsTable.endpoint, endpoint),
        ),
      );
  } else {
    await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, req.userId!));
  }

  res.json({ success: true });
});

router.get("/notifications/preferences", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const [prefs] = await db
    .select()
    .from(notificationPreferencesTable)
    .where(eq(notificationPreferencesTable.userId, req.userId!))
    .limit(1);

  if (!prefs) {
    res.json({ onUnlock: true, onReview: true, onProfileUpdate: true });
    return;
  }

  res.json({
    onUnlock: prefs.onUnlock,
    onReview: prefs.onReview,
    onProfileUpdate: prefs.onProfileUpdate,
  });
});

router.patch("/notifications/preferences", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { onUnlock, onReview, onProfileUpdate } = req.body ?? {};

  const updates: Partial<{ onUnlock: boolean; onReview: boolean; onProfileUpdate: boolean; updatedAt: Date }> = {
    updatedAt: new Date(),
  };
  if (typeof onUnlock === "boolean") updates.onUnlock = onUnlock;
  if (typeof onReview === "boolean") updates.onReview = onReview;
  if (typeof onProfileUpdate === "boolean") updates.onProfileUpdate = onProfileUpdate;

  const existing = await db
    .select()
    .from(notificationPreferencesTable)
    .where(eq(notificationPreferencesTable.userId, req.userId!))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(notificationPreferencesTable).values({
      userId: req.userId!,
      onUnlock: updates.onUnlock ?? true,
      onReview: updates.onReview ?? true,
      onProfileUpdate: updates.onProfileUpdate ?? true,
    });
  } else {
    await db
      .update(notificationPreferencesTable)
      .set(updates)
      .where(eq(notificationPreferencesTable.userId, req.userId!));
  }

  const [updated] = await db
    .select()
    .from(notificationPreferencesTable)
    .where(eq(notificationPreferencesTable.userId, req.userId!))
    .limit(1);

  res.json({
    onUnlock: updated!.onUnlock,
    onReview: updated!.onReview,
    onProfileUpdate: updated!.onProfileUpdate,
  });
});

router.post(
  "/admin/notifications/test",
  requireAuth,
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    if (!setupWebPush()) {
      res.status(503).json({ error: "Push notifications not configured" });
      return;
    }

    const subscriptions = await db
      .select()
      .from(pushSubscriptionsTable)
      .where(eq(pushSubscriptionsTable.userId, req.userId!));

    if (subscriptions.length === 0) {
      res.status(404).json({ error: "No push subscriptions found for your account. Enable push notifications in your browser first." });
      return;
    }

    const payload = JSON.stringify({
      title: "Test notification",
      body: "Push notifications are working correctly.",
      url: "/admin",
    });

    let sent = 0;
    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
          );
          sent++;
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, sub.id));
          }
        }
      }),
    );

    if (sent === 0) {
      res.status(500).json({ error: "Failed to deliver the test notification. Your subscription may have expired — try re-enabling push notifications." });
      return;
    }

    res.json({ sent, total: subscriptions.length });
  },
);

router.post(
  "/admin/notifications/broadcast",
  requireAuth,
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const { title, body, audience } = req.body ?? {};
    if (!title || !body) {
      res.status(400).json({ error: "title and body are required" });
      return;
    }

    if (!["all", "professionals", "parents"].includes(audience ?? "")) {
      res.status(400).json({ error: "audience must be 'all', 'professionals', or 'parents'" });
      return;
    }

    if (!setupWebPush()) {
      res.status(503).json({ error: "Push notifications not configured" });
      return;
    }

    let userIds: number[] = [];

    if (audience === "all") {
      const users = await db.select({ id: usersTable.id }).from(usersTable);
      userIds = users.map((u) => u.id);
    } else if (audience === "professionals") {
      const users = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.role, "professional"));
      userIds = users.map((u) => u.id);
    } else if (audience === "parents") {
      const users = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.role, "parent"));
      userIds = users.map((u) => u.id);
    }

    if (userIds.length === 0) {
      res.json({ sent: 0, message: "No users in audience" });
      return;
    }

    const subscriptions = await db
      .select()
      .from(pushSubscriptionsTable)
      .where(inArray(pushSubscriptionsTable.userId, userIds));

    const payload = JSON.stringify({ title, body, url: "/" });
    let sent = 0;
    const BATCH_SIZE = 50;

    for (let i = 0; i < subscriptions.length; i += BATCH_SIZE) {
      const batch = subscriptions.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map(async (sub) => {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              payload,
            );
            sent++;
          } catch (err: unknown) {
            const statusCode = (err as { statusCode?: number }).statusCode;
            if (statusCode === 404 || statusCode === 410) {
              await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, sub.id));
            }
          }
        }),
      );
    }

    res.json({ sent, total: subscriptions.length });
  },
);

export default router;
