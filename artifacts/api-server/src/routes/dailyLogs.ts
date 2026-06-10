import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  shadowTeacherEngagementsTable,
  engagementDailyLogsTable,
  professionalProfilesTable,
  usersTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { z } from "zod";

const router: IRouter = Router();

async function getEngagementAccess(engagementId: number, userId: number, userRole: string) {
  const [eng] = await db
    .select()
    .from(shadowTeacherEngagementsTable)
    .where(eq(shadowTeacherEngagementsTable.id, engagementId))
    .limit(1);
  if (!eng) return { eng: null, role: null };
  if (userRole === "admin") return { eng, role: "admin" as const };
  if (eng.parentId === userId) return { eng, role: "parent" as const };
  const [prof] = await db
    .select({ id: professionalProfilesTable.id })
    .from(professionalProfilesTable)
    .where(and(eq(professionalProfilesTable.userId, userId), eq(professionalProfilesTable.id, eng.professionalId)))
    .limit(1);
  if (prof) return { eng, role: "teacher" as const };
  return { eng: null, role: null };
}

const TeacherLogContentSchema = z.object({
  taughtToday: z.string().max(2000).optional(),
  behaviorMood: z.string().max(2000).optional(),
  feedback: z.string().max(2000).optional(),
  reteachAtHome: z.string().max(2000).optional(),
});

const ParentLogContentSchema = z.object({
  eventsForTeacher: z.string().max(2000).optional(),
  extraSupportAreas: z.string().max(2000).optional(),
});

const PostDailyLogBody = z.object({
  logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  content: z.union([TeacherLogContentSchema, ParentLogContentSchema]),
});

router.get("/engagements/:id/daily-logs", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { eng, role } = await getEngagementAccess(id, req.userId!, req.userRole!);
  if (!eng || !role) { res.status(404).json({ error: "Engagement not found or access denied" }); return; }

  const rows = await db
    .select({
      id: engagementDailyLogsTable.id,
      engagementId: engagementDailyLogsTable.engagementId,
      authorRole: engagementDailyLogsTable.authorRole,
      authorUserId: engagementDailyLogsTable.authorUserId,
      logDate: engagementDailyLogsTable.logDate,
      content: engagementDailyLogsTable.content,
      createdAt: engagementDailyLogsTable.createdAt,
      updatedAt: engagementDailyLogsTable.updatedAt,
      authorName: usersTable.fullName,
    })
    .from(engagementDailyLogsTable)
    .leftJoin(usersTable, eq(engagementDailyLogsTable.authorUserId, usersTable.id))
    .where(eq(engagementDailyLogsTable.engagementId, id))
    .orderBy(desc(engagementDailyLogsTable.logDate));

  res.json(rows);
});

router.post("/engagements/:id/daily-logs", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { eng, role } = await getEngagementAccess(id, req.userId!, req.userRole!);
  if (!eng || !role) { res.status(404).json({ error: "Engagement not found or access denied" }); return; }
  if (role === "admin") { res.status(403).json({ error: "Admins cannot post daily logs" }); return; }

  const parsed = PostDailyLogBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { logDate, content } = parsed.data;

  // Check if already submitted today by this role (allow only one per role per day)
  const [existing] = await db
    .select({ id: engagementDailyLogsTable.id })
    .from(engagementDailyLogsTable)
    .where(
      and(
        eq(engagementDailyLogsTable.engagementId, id),
        eq(engagementDailyLogsTable.authorUserId, req.userId!),
        eq(engagementDailyLogsTable.logDate, logDate)
      )
    )
    .limit(1);

  if (existing) {
    // Update existing log (same-day edit)
    const [updated] = await db
      .update(engagementDailyLogsTable)
      .set({ content: JSON.stringify(content), updatedAt: new Date() })
      .where(eq(engagementDailyLogsTable.id, existing.id))
      .returning();
    res.json(updated);
    return;
  }

  const [log] = await db
    .insert(engagementDailyLogsTable)
    .values({
      engagementId: id,
      authorUserId: req.userId!,
      authorRole: role === "teacher" ? "teacher" : "parent",
      logDate,
      content: JSON.stringify(content),
    })
    .returning();

  res.status(201).json(log);
});

router.patch("/engagements/:id/daily-logs/:logId", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  const logId = parseInt(req.params["logId"] as string, 10);
  if (isNaN(id) || isNaN(logId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { eng, role } = await getEngagementAccess(id, req.userId!, req.userRole!);
  if (!eng || !role) { res.status(404).json({ error: "Engagement not found or access denied" }); return; }

  const [log] = await db
    .select()
    .from(engagementDailyLogsTable)
    .where(and(eq(engagementDailyLogsTable.id, logId), eq(engagementDailyLogsTable.engagementId, id)))
    .limit(1);

  if (!log) { res.status(404).json({ error: "Log not found" }); return; }
  if (log.authorUserId !== req.userId!) { res.status(403).json({ error: "You can only edit your own logs" }); return; }

  // Same-day edit only
  const today = new Date().toISOString().slice(0, 10);
  if (log.logDate !== today) { res.status(409).json({ error: "Logs can only be edited on the same day" }); return; }

  const parsed = PostDailyLogBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [updated] = await db
    .update(engagementDailyLogsTable)
    .set({ content: JSON.stringify(parsed.data.content), updatedAt: new Date() })
    .where(eq(engagementDailyLogsTable.id, logId))
    .returning();

  res.json(updated);
});

export default router;
