import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, parentNeedsRequestsTable, childrenTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { z } from "zod";

const router: IRouter = Router();

const SUPPORT_TYPES = [
  "shadow_teacher", "therapy_centre", "tutor", "occupational_therapist",
  "speech_therapist", "developmental_pediatrician", "psychologist",
  "psychiatrist", "individual_sports_trainer", "individual_arts_trainer",
] as const;

const UpsertNeedsBody = z.object({
  childId: z.number().int().positive().optional(),
  supportTypes: z.array(z.enum(SUPPORT_TYPES)),
  payload: z.record(z.unknown()).optional(),
  status: z.enum(["draft", "submitted"]).optional(),
});

router.get("/parent-needs", requireAuth, requireRole("parent"), async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(parentNeedsRequestsTable)
    .where(eq(parentNeedsRequestsTable.parentId, req.userId!))
    .orderBy(desc(parentNeedsRequestsTable.createdAt));
  res.json(rows);
});

router.post("/parent-needs", requireAuth, requireRole("parent"), async (req, res): Promise<void> => {
  const parsed = UpsertNeedsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { childId, supportTypes, payload, status } = parsed.data;

  if (childId) {
    const [child] = await db
      .select({ id: childrenTable.id })
      .from(childrenTable)
      .where(and(eq(childrenTable.id, childId), eq(childrenTable.parentId, req.userId!)))
      .limit(1);
    if (!child) { res.status(404).json({ error: "Child not found" }); return; }
  }

  const [row] = await db
    .insert(parentNeedsRequestsTable)
    .values({
      parentId: req.userId!,
      childId: childId ?? null,
      supportTypes: JSON.stringify(supportTypes),
      payload: JSON.stringify(payload ?? {}),
      status: status ?? "submitted",
    })
    .returning();

  res.status(201).json(row);
});

router.patch("/parent-needs/:id", requireAuth, requireRole("parent"), async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = UpsertNeedsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [existing] = await db
    .select({ id: parentNeedsRequestsTable.id })
    .from(parentNeedsRequestsTable)
    .where(and(eq(parentNeedsRequestsTable.id, id), eq(parentNeedsRequestsTable.parentId, req.userId!)))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const { childId, supportTypes, payload, status } = parsed.data;
  const [updated] = await db
    .update(parentNeedsRequestsTable)
    .set({
      childId: childId ?? null,
      supportTypes: JSON.stringify(supportTypes),
      payload: JSON.stringify(payload ?? {}),
      status: status ?? "submitted",
      updatedAt: new Date(),
    })
    .where(eq(parentNeedsRequestsTable.id, id))
    .returning();

  res.json(updated);
});

export default router;
