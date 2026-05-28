import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  connectThreadsTable,
  connectMessagesTable,
  contactUnlocksTable,
  professionalProfilesTable,
  usersTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { z } from "zod";

const router: IRouter = Router();

async function getOrCreateThread(parentId: number, professionalId: number) {
  const [existing] = await db
    .select()
    .from(connectThreadsTable)
    .where(
      and(
        eq(connectThreadsTable.parentId, parentId),
        eq(connectThreadsTable.professionalId, professionalId),
      ),
    )
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(connectThreadsTable)
    .values({ parentId, professionalId })
    .returning();
  return created!;
}

async function assertConnectAccess(
  parentId: number,
  professionalId: number,
): Promise<boolean> {
  const now = new Date();
  const [unlock] = await db
    .select({ chatAccessOnly: contactUnlocksTable.chatAccessOnly })
    .from(contactUnlocksTable)
    .where(
      and(
        eq(contactUnlocksTable.parentId, parentId),
        eq(contactUnlocksTable.professionalId, professionalId),
      ),
    )
    .limit(1);
  return !!unlock;
}

router.get(
  "/connect/:professionalId/thread",
  requireAuth,
  requireRole("parent", "admin"),
  async (req, res): Promise<void> => {
    const profId = parseInt(req.params["professionalId"] as string, 10);
    if (isNaN(profId)) { res.status(400).json({ error: "Invalid professional id" }); return; }

    const hasAccess = await assertConnectAccess(req.userId!, profId);
    if (!hasAccess) { res.status(403).json({ error: "No connect access — please connect first" }); return; }

    const thread = await getOrCreateThread(req.userId!, profId);

    const messages = await db
      .select({
        id: connectMessagesTable.id,
        threadId: connectMessagesTable.threadId,
        senderId: connectMessagesTable.senderId,
        senderName: usersTable.fullName,
        body: connectMessagesTable.body,
        createdAt: connectMessagesTable.createdAt,
      })
      .from(connectMessagesTable)
      .leftJoin(usersTable, eq(connectMessagesTable.senderId, usersTable.id))
      .where(eq(connectMessagesTable.threadId, thread.id))
      .orderBy(desc(connectMessagesTable.id))
      .limit(100);

    const [prof] = await db
      .select({
        fullName: professionalProfilesTable.fullName,
        specialty: professionalProfilesTable.specialty,
      })
      .from(professionalProfilesTable)
      .where(eq(professionalProfilesTable.id, profId))
      .limit(1);

    res.json({
      thread,
      messages: [...messages].reverse(),
      professional: prof ?? null,
    });
  },
);

router.post(
  "/connect/:professionalId/messages",
  requireAuth,
  async (req, res): Promise<void> => {
    const profIdRaw = parseInt(req.params["professionalId"] as string, 10);
    if (isNaN(profIdRaw)) { res.status(400).json({ error: "Invalid professional id" }); return; }

    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!body || body.length === 0) { res.status(400).json({ error: "Message body is required" }); return; }
    if (body.length > 2000) { res.status(400).json({ error: "Message too long" }); return; }

    const isParent = req.userRole === "parent" || req.userRole === "admin";

    if (isParent) {
      const hasAccess = await assertConnectAccess(req.userId!, profIdRaw);
      if (!hasAccess) { res.status(403).json({ error: "No connect access" }); return; }
    } else {
      const [prof] = await db
        .select({ id: professionalProfilesTable.id })
        .from(professionalProfilesTable)
        .where(eq(professionalProfilesTable.id, profIdRaw))
        .limit(1);
      if (!prof) { res.status(404).json({ error: "Professional not found" }); return; }
    }

    const thread = await getOrCreateThread(
      isParent ? req.userId! : (await getProfessionalParentId(profIdRaw, req.userId!)) ?? req.userId!,
      profIdRaw,
    );

    const [message] = await db
      .insert(connectMessagesTable)
      .values({ threadId: thread.id, senderId: req.userId!, body })
      .returning();

    const [withSender] = await db
      .select({
        id: connectMessagesTable.id,
        threadId: connectMessagesTable.threadId,
        senderId: connectMessagesTable.senderId,
        senderName: usersTable.fullName,
        body: connectMessagesTable.body,
        createdAt: connectMessagesTable.createdAt,
      })
      .from(connectMessagesTable)
      .leftJoin(usersTable, eq(connectMessagesTable.senderId, usersTable.id))
      .where(eq(connectMessagesTable.id, message!.id));

    res.status(201).json(withSender);
  },
);

async function getProfessionalParentId(profId: number, fallback: number): Promise<number | null> {
  return null;
}

router.get(
  "/connect/inbox",
  requireAuth,
  requireRole("professional", "admin"),
  async (req, res): Promise<void> => {
    const [prof] = await db
      .select({ id: professionalProfilesTable.id })
      .from(professionalProfilesTable)
      .where(eq(professionalProfilesTable.userId, req.userId!))
      .limit(1);

    if (!prof) { res.status(404).json({ error: "Professional profile not found" }); return; }

    const threads = await db
      .select({
        id: connectThreadsTable.id,
        parentId: connectThreadsTable.parentId,
        createdAt: connectThreadsTable.createdAt,
        parentName: usersTable.fullName,
      })
      .from(connectThreadsTable)
      .leftJoin(usersTable, eq(connectThreadsTable.parentId, usersTable.id))
      .where(eq(connectThreadsTable.professionalId, prof.id))
      .orderBy(desc(connectThreadsTable.createdAt));

    res.json(threads);
  },
);

export default router;
