import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, childrenTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { z } from "zod";

const router: IRouter = Router();

const CreateChildBody = z.object({
  name: z.string().min(1).max(100),
  dob: z.string().optional(),
  diagnosisTags: z.string().optional(),
  notes: z.string().optional(),
  city: z.string().optional(),
  area: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  documentsJson: z.string().optional(),
});

const UpdateChildBody = z.object({
  name: z.string().min(1).max(100).optional(),
  dob: z.string().optional(),
  diagnosisTags: z.string().optional(),
  notes: z.string().optional(),
  city: z.string().optional(),
  area: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  documentsJson: z.string().optional(),
});

router.get("/children", requireAuth, requireRole("parent", "admin"), async (req, res): Promise<void> => {
  const children = await db
    .select()
    .from(childrenTable)
    .where(eq(childrenTable.parentId, req.userId!))
    .orderBy(childrenTable.createdAt);

  res.json(children);
});

router.post("/children", requireAuth, requireRole("parent", "admin"), async (req, res): Promise<void> => {
  const parsed = CreateChildBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [child] = await db
    .insert(childrenTable)
    .values({ ...parsed.data, parentId: req.userId! })
    .returning();

  res.status(201).json(child);
});

router.patch("/children/:id", requireAuth, requireRole("parent", "admin"), async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = UpdateChildBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [existing] = await db
    .select({ id: childrenTable.id })
    .from(childrenTable)
    .where(and(eq(childrenTable.id, id), eq(childrenTable.parentId, req.userId!)));

  if (!existing) { res.status(404).json({ error: "Child not found" }); return; }

  const [updated] = await db
    .update(childrenTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(childrenTable.id, id))
    .returning();

  res.json(updated);
});

router.delete("/children/:id", requireAuth, requireRole("parent", "admin"), async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db
    .select({ id: childrenTable.id })
    .from(childrenTable)
    .where(and(eq(childrenTable.id, id), eq(childrenTable.parentId, req.userId!)));

  if (!existing) { res.status(404).json({ error: "Child not found" }); return; }

  await db.delete(childrenTable).where(eq(childrenTable.id, id));
  res.json({ success: true });
});

export default router;
