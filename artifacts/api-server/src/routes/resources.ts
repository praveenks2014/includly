import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, gt } from "drizzle-orm";
import { db, resourcesTable, subscriptionsTable, usersTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

async function getPlusStatus(userId: number): Promise<{ isPlus: boolean; expiresAt: Date | null }> {
  const now = new Date();
  const rows = await db
    .select({ expiresAt: subscriptionsTable.expiresAt })
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.userId, userId),
        eq(subscriptionsTable.plan, "plus"),
        eq(subscriptionsTable.status, "active"),
        gt(subscriptionsTable.expiresAt, now),
      ),
    )
    .limit(1);
  if (rows.length > 0) return { isPlus: true, expiresAt: rows[0].expiresAt };
  return { isPlus: false, expiresAt: null };
}

// GET /resources — list all published resources
router.get("/resources", async (req: Request, res: Response): Promise<void> => {
  const category = req.query["category"] as string | undefined;
  const rows = await db
    .select()
    .from(resourcesTable)
    .where(eq(resourcesTable.isPublished, true));

  const filtered = category && category !== "all"
    ? rows.filter((r) => r.category === category)
    : rows;

  res.json(filtered);
});

// GET /resources/plus-status — check current user's Plus subscription
router.get("/resources/plus-status", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId: number = res.locals["userId"];
  const status = await getPlusStatus(userId);
  res.json(status);
});

// GET /resources/:id — get resource detail (body gated for premium if no Plus)
router.get("/resources/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const rows = await db
    .select()
    .from(resourcesTable)
    .where(and(eq(resourcesTable.id, id), eq(resourcesTable.isPublished, true)))
    .limit(1);

  if (rows.length === 0) { res.status(404).json({ error: "Not found" }); return; }
  const resource = rows[0];

  if (resource.isPremium && resource.body) {
    const userId: number | undefined = res.locals["userId"];
    if (!userId) {
      res.json({ ...resource, body: null, gated: true });
      return;
    }
    const { isPlus } = await getPlusStatus(userId);
    if (!isPlus) {
      res.json({ ...resource, body: null, gated: true });
      return;
    }
  }

  res.json({ ...resource, gated: false });
});

export default router;
