import { Router, type IRouter } from "express";
import { eq, and, desc, asc, inArray } from "drizzle-orm";
import {
  db,
  childGoalsTable,
  childrenTable,
  professionalProfilesTable,
  shadowTeacherEngagementsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { z } from "zod";

const router: IRouter = Router();

async function getGoalAccess(
  childId: number,
  userId: number,
  userRole: string,
): Promise<"parent" | "teacher" | "admin" | null> {
  if (userRole === "admin") return "admin";

  const [child] = await db
    .select({ parentId: childrenTable.parentId })
    .from(childrenTable)
    .where(eq(childrenTable.id, childId))
    .limit(1);

  if (!child) return null;
  if (child.parentId === userId) return "parent";

  const [prof] = await db
    .select({ id: professionalProfilesTable.id })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, userId))
    .limit(1);

  if (!prof) return null;

  const [eng] = await db
    .select({ id: shadowTeacherEngagementsTable.id })
    .from(shadowTeacherEngagementsTable)
    .where(
      and(
        eq(shadowTeacherEngagementsTable.childId, childId),
        eq(shadowTeacherEngagementsTable.professionalId, prof.id),
        inArray(shadowTeacherEngagementsTable.status, ["active", "notice_period"]),
      ),
    )
    .limit(1);

  return eng ? "teacher" : null;
}

const CreateGoalBody = z.object({
  label: z.string().min(1).max(200),
  category: z.string().max(100).optional(),
  engagementId: z.number().int().positive().optional(),
});

const UpdateGoalBody = z.object({
  label: z.string().min(1).max(200).optional(),
  category: z.string().max(100).nullable().optional(),
  isActive: z.boolean().optional(),
});

router.get("/children/:childId/goals", requireAuth, async (req, res): Promise<void> => {
  const childId = parseInt(req.params["childId"] as string, 10);
  if (isNaN(childId)) { res.status(400).json({ error: "Invalid childId" }); return; }

  const access = await getGoalAccess(childId, req.userId!, req.userRole!);
  if (!access) { res.status(404).json({ error: "Child not found or access denied" }); return; }

  const rows = await db
    .select()
    .from(childGoalsTable)
    .where(eq(childGoalsTable.childId, childId))
    .orderBy(desc(childGoalsTable.isActive), asc(childGoalsTable.label));

  res.json(rows);
});

router.post("/children/:childId/goals", requireAuth, async (req, res): Promise<void> => {
  const childId = parseInt(req.params["childId"] as string, 10);
  if (isNaN(childId)) { res.status(400).json({ error: "Invalid childId" }); return; }

  const access = await getGoalAccess(childId, req.userId!, req.userRole!);
  if (!access) { res.status(404).json({ error: "Child not found or access denied" }); return; }

  const parsed = CreateGoalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [goal] = await db
    .insert(childGoalsTable)
    .values({
      childId,
      createdByUserId: req.userId!,
      label: parsed.data.label,
      category: parsed.data.category ?? null,
      engagementId: parsed.data.engagementId ?? null,
    })
    .returning();

  res.status(201).json(goal);
});

router.patch("/children/:childId/goals/:goalId", requireAuth, async (req, res): Promise<void> => {
  const childId = parseInt(req.params["childId"] as string, 10);
  const goalId = parseInt(req.params["goalId"] as string, 10);
  if (isNaN(childId) || isNaN(goalId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const access = await getGoalAccess(childId, req.userId!, req.userRole!);
  if (!access) { res.status(404).json({ error: "Child not found or access denied" }); return; }

  const parsed = UpdateGoalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [goal] = await db
    .update(childGoalsTable)
    .set({
      ...(parsed.data.label !== undefined && { label: parsed.data.label }),
      ...(parsed.data.category !== undefined && { category: parsed.data.category }),
      ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
      updatedAt: new Date(),
    })
    .where(and(eq(childGoalsTable.id, goalId), eq(childGoalsTable.childId, childId)))
    .returning();

  if (!goal) { res.status(404).json({ error: "Goal not found" }); return; }
  res.json(goal);
});

export default router;
