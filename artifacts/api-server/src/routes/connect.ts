import { Router, type IRouter } from "express";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import {
  db,
  connectThreadsTable,
  connectMessagesTable,
  contactUnlocksTable,
  professionalProfilesTable,
  usersTable,
  shadowTeacherEngagementsTable,
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
  return null; // not used — professional sends via thread-based routes below
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

// GET /connect/thread/:threadId/messages — fetch messages for a thread (both parties)
router.get(
  "/connect/thread/:threadId/messages",
  requireAuth,
  async (req, res): Promise<void> => {
    const threadId = parseInt(req.params["threadId"] as string, 10);
    if (isNaN(threadId)) { res.status(400).json({ error: "Invalid thread id" }); return; }

    const [thread] = await db
      .select()
      .from(connectThreadsTable)
      .where(eq(connectThreadsTable.id, threadId))
      .limit(1);

    if (!thread) { res.status(404).json({ error: "Thread not found" }); return; }

    // Check access: parent is a direct participant; professional must own the thread
    const userId = req.userId!;
    const role = req.userRole!;
    let hasAccess = role === "admin" || thread.parentId === userId;

    if (!hasAccess) {
      const [prof] = await db
        .select({ id: professionalProfilesTable.id })
        .from(professionalProfilesTable)
        .where(eq(professionalProfilesTable.userId, userId))
        .limit(1);
      hasAccess = !!prof && prof.id === thread.professionalId;
    }

    if (!hasAccess) { res.status(403).json({ error: "Access denied" }); return; }

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
      .where(eq(connectMessagesTable.threadId, threadId))
      .orderBy(desc(connectMessagesTable.id))
      .limit(100);

    res.json({ messages: [...messages].reverse() });
  },
);

// POST /connect/thread/:threadId/messages — send a message to an existing thread (both parties)
router.post(
  "/connect/thread/:threadId/messages",
  requireAuth,
  async (req, res): Promise<void> => {
    const threadId = parseInt(req.params["threadId"] as string, 10);
    if (isNaN(threadId)) { res.status(400).json({ error: "Invalid thread id" }); return; }

    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!body || body.length === 0) { res.status(400).json({ error: "Message body is required" }); return; }
    if (body.length > 2000) { res.status(400).json({ error: "Message too long" }); return; }

    const [thread] = await db
      .select()
      .from(connectThreadsTable)
      .where(eq(connectThreadsTable.id, threadId))
      .limit(1);

    if (!thread) { res.status(404).json({ error: "Thread not found" }); return; }

    const userId = req.userId!;
    const role = req.userRole!;
    let hasAccess = role === "admin" || thread.parentId === userId;

    if (!hasAccess) {
      const [prof] = await db
        .select({ id: professionalProfilesTable.id })
        .from(professionalProfilesTable)
        .where(eq(professionalProfilesTable.userId, userId))
        .limit(1);
      hasAccess = !!prof && prof.id === thread.professionalId;
    }

    if (!hasAccess) { res.status(403).json({ error: "Access denied" }); return; }

    const [message] = await db
      .insert(connectMessagesTable)
      .values({ threadId, senderId: userId, body })
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

// GET /connect/parent-inbox — list all connect threads for the signed-in parent
// Returns thread metadata only (no contact info / phone / email) with chattable flag
// derived from whether there is an active (non-ended) shadow-teacher engagement.
// Masking is preserved: the underlying /connect/thread/:threadId/messages route
// already enforces thread.parentId === userId before serving messages.
router.get(
  "/connect/parent-inbox",
  requireAuth,
  requireRole("parent", "admin"),
  async (req, res): Promise<void> => {
    const userId = req.userId!;

    const threads = await db
      .select({
        threadId: connectThreadsTable.id,
        professionalId: connectThreadsTable.professionalId,
        professionalName: professionalProfilesTable.fullName,
        specialty: professionalProfilesTable.specialty,
        createdAt: connectThreadsTable.createdAt,
      })
      .from(connectThreadsTable)
      .innerJoin(professionalProfilesTable, eq(connectThreadsTable.professionalId, professionalProfilesTable.id))
      .where(eq(connectThreadsTable.parentId, userId))
      .orderBy(desc(connectThreadsTable.createdAt));

    if (threads.length === 0) {
      res.json([]);
      return;
    }

    // Chattable = this parent has a non-ended engagement with that professional
    const activeEngProfIds = (
      await db
        .select({ professionalId: shadowTeacherEngagementsTable.professionalId })
        .from(shadowTeacherEngagementsTable)
        .where(
          and(
            eq(shadowTeacherEngagementsTable.parentId, userId),
            sql`${shadowTeacherEngagementsTable.status} != 'ended'`,
          ),
        )
    ).map((r) => r.professionalId);
    const chattableSet = new Set(activeEngProfIds);

    // Last message per thread + unread count (msgs from professional after parent's last sent msg)
    const threadIds = threads.map((t) => t.threadId);
    const allMsgs = await db
      .select({
        id: connectMessagesTable.id,
        threadId: connectMessagesTable.threadId,
        senderId: connectMessagesTable.senderId,
        body: connectMessagesTable.body,
        createdAt: connectMessagesTable.createdAt,
      })
      .from(connectMessagesTable)
      .where(inArray(connectMessagesTable.threadId, threadIds))
      .orderBy(desc(connectMessagesTable.id));

    const lastMsgMap = new Map<number, { body: string; createdAt: string }>();
    // Track the max message id sent by the parent per thread (proxy for "last read")
    const lastParentMsgId = new Map<number, number>();
    // Count messages from the other party (professional) per thread
    const professionalMsgCount = new Map<number, { id: number }[]>();

    for (const m of allMsgs) {
      if (!lastMsgMap.has(m.threadId)) {
        const at = m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt);
        lastMsgMap.set(m.threadId, { body: m.body, createdAt: at });
      }
      if (m.senderId === userId) {
        // allMsgs is desc by id, so first occurrence is the latest parent msg
        if (!lastParentMsgId.has(m.threadId)) {
          lastParentMsgId.set(m.threadId, m.id);
        }
      } else {
        if (!professionalMsgCount.has(m.threadId)) professionalMsgCount.set(m.threadId, []);
        professionalMsgCount.get(m.threadId)!.push({ id: m.id });
      }
    }

    res.json(
      threads.map((t) => {
        const lastSentById = lastParentMsgId.get(t.threadId) ?? 0;
        const profMsgs = professionalMsgCount.get(t.threadId) ?? [];
        // Unread = professional messages with id > parent's last sent message id
        const unread = profMsgs.filter((m) => m.id > lastSentById).length;
        return {
          threadId: t.threadId,
          professionalId: t.professionalId,
          professionalName: t.professionalName,
          specialty: t.specialty,
          chattable: chattableSet.has(t.professionalId),
          lastMessage: lastMsgMap.get(t.threadId)?.body ?? null,
          lastAt: lastMsgMap.get(t.threadId)?.createdAt ?? null,
          unread,
        };
      }),
    );
  },
);

export default router;
