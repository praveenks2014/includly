import { Router, type IRouter } from "express";
import { eq, and, desc, gte } from "drizzle-orm";
import { db, behaviorLogsTable, childrenTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { z } from "zod";

const router: IRouter = Router();

// ALL behavior-log routes are parent-only — enforced here at the router level.
// No teacher, admin, or centre_admin token ever reaches the handlers below.
router.use(requireAuth);
router.use(requireRole("parent"));

// ─── Schemas ─────────────────────────────────────────────────────────────────

const StrategySchema = z.object({
  strategy: z.string().min(1).max(200),
  worked:   z.enum(["yes", "no", "too_early"]),
});

const CreateBehaviorLogBody = z.object({
  childId:         z.number().int().positive(),
  engagementId:    z.number().int().positive().optional(),
  dailyLogId:      z.number().int().positive().optional(),
  tantrumTypes:    z.array(z.string().min(1).max(200)).min(1),
  triggers:        z.array(z.string().min(1).max(200)).optional(),
  durationMinutes: z.number().int().min(0).max(1440).optional(),
  intensity:       z.enum(["mild", "moderate", "severe"]),
  notes:           z.string().max(2000).optional(),
  strategies:      z.array(StrategySchema).default([]),
});

// ─── Helper ──────────────────────────────────────────────────────────────────

/** Returns true if the child belongs to this parent. */
async function assertChildOwnership(childId: number, parentId: number): Promise<boolean> {
  const [child] = await db
    .select({ id: childrenTable.id })
    .from(childrenTable)
    .where(and(eq(childrenTable.id, childId), eq(childrenTable.parentId, parentId)))
    .limit(1);
  return !!child;
}

// ─── GET /api/behavior-logs/weekly-summary?childId=X ─────────────────────────
// Must be declared BEFORE /:id to avoid "weekly-summary" being matched as an id.
router.get("/behavior-logs/weekly-summary", async (req, res): Promise<void> => {
  const childId = parseInt(req.query["childId"] as string, 10);
  if (isNaN(childId)) { res.status(400).json({ error: "childId required" }); return; }

  const owned = await assertChildOwnership(childId, req.userId!);
  if (!owned) { res.status(404).json({ error: "Child not found" }); return; }

  const since = new Date();
  since.setDate(since.getDate() - 7);

  const logs = await db
    .select()
    .from(behaviorLogsTable)
    .where(and(eq(behaviorLogsTable.childId, childId), gte(behaviorLogsTable.occurredAt, since)));

  if (logs.length === 0) { res.json(null); return; }

  const triggerFreq: Record<string, number> = {};
  for (const log of logs) {
    for (const t of (log.triggers ?? [])) {
      triggerFreq[t] = (triggerFreq[t] ?? 0) + 1;
    }
  }
  const topTrigger = Object.entries(triggerFreq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const strategyWorked: Record<string, number> = {};
  for (const log of logs) {
    const strategies = log.strategies as { strategy: string; worked: string }[] ?? [];
    for (const s of strategies) {
      if (s.worked === "yes") {
        strategyWorked[s.strategy] = (strategyWorked[s.strategy] ?? 0) + 1;
      }
    }
  }
  const topStrategy = Object.entries(strategyWorked).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  res.json({ weekCount: logs.length, topTrigger, topStrategy });
});

// ─── POST /api/behavior-logs ─────────────────────────────────────────────────

router.post("/behavior-logs", async (req, res): Promise<void> => {
  const parsed = CreateBehaviorLogBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const owned = await assertChildOwnership(parsed.data.childId, req.userId!);
  if (!owned) { res.status(404).json({ error: "Child not found" }); return; }

  const { childId, engagementId, dailyLogId, tantrumTypes, triggers, durationMinutes, intensity, notes, strategies } = parsed.data;

  const [log] = await db
    .insert(behaviorLogsTable)
    .values({
      childId,
      engagementId:    engagementId ?? null,
      dailyLogId:      dailyLogId   ?? null,
      loggedBy:        req.userId!,
      tantrumTypes,
      triggers:        triggers        ?? [],
      durationMinutes: durationMinutes ?? null,
      intensity,
      notes:           notes ?? null,
      strategies,
    })
    .returning();

  res.status(201).json(log);
});

// ─── GET /api/behavior-logs?childId=X ────────────────────────────────────────
// Returns ALL incidents for the child (both attached and standalone).

router.get("/behavior-logs", async (req, res): Promise<void> => {
  const childId = parseInt(req.query["childId"] as string, 10);
  if (isNaN(childId)) { res.status(400).json({ error: "childId required" }); return; }

  const owned = await assertChildOwnership(childId, req.userId!);
  if (!owned) { res.status(404).json({ error: "Child not found" }); return; }

  const logs = await db
    .select()
    .from(behaviorLogsTable)
    .where(eq(behaviorLogsTable.childId, childId))
    .orderBy(desc(behaviorLogsTable.occurredAt));

  res.json(logs);
});

// ─── GET /api/behavior-logs/:id ──────────────────────────────────────────────

router.get("/behavior-logs/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [log] = await db
    .select()
    .from(behaviorLogsTable)
    .where(eq(behaviorLogsTable.id, id))
    .limit(1);

  if (!log) { res.status(404).json({ error: "Not found" }); return; }

  const owned = await assertChildOwnership(log.childId, req.userId!);
  if (!owned) { res.status(404).json({ error: "Not found" }); return; }

  res.json(log);
});

export default router;
