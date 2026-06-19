import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, childrenTable, professionalProfilesTable, sessionBookingsTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { z } from "zod";

const router: IRouter = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeCompletionPct(c: typeof childrenTable.$inferSelect): number {
  const checks = [
    Array.isArray(c.conditions) && c.conditions.length > 0,
    !!c.diagnosisStatus,
    Array.isArray(c.goalsAreas) && c.goalsAreas.length > 0,
    !!c.schoolType,
    Array.isArray(c.languages) && c.languages.length > 0,
    Array.isArray(c.preferredModes) && c.preferredModes.length > 0,
    c.budgetMinInr != null,
    c.careNotes != null,
  ];
  return Math.round((checks.filter(Boolean).length / 8) * 100);
}

function ageMonths(dob: string | null): number | null {
  if (!dob) return null;
  const b = new Date(dob);
  if (isNaN(b.getTime())) return null;
  const n = new Date();
  return (n.getFullYear() - b.getFullYear()) * 12 + (n.getMonth() - b.getMonth());
}

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const ConsentBody = z.object({
  intakeShare: z.boolean(),
  media: z.boolean(),
  reports: z.boolean(),
});

const CareNotesBody = z.object({
  calming: z.string().default(""),
  triggers: z.string().default(""),
  communicationMode: z.string().default(""),
  favorites: z.string().default(""),
});

const ChildBody = z.object({
  name: z.string().min(1).max(100),
  dob: z.string().optional(),
  gender: z.string().optional(),
  city: z.string().optional(),
  area: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  notes: z.string().optional(),
  documentsJson: z.string().optional(),
  diagnosisStatus: z.string().optional(),
  conditions: z.array(z.string()).optional(),
  languages: z.array(z.string()).optional(),
  schoolType: z.string().optional(),
  grade: z.string().optional(),
  existingTherapies: z.array(z.object({ type: z.string(), frequency: z.string() })).optional(),
  goalsAreas: z.array(z.string()).optional(),
  availableTimeWindows: z.array(z.string()).optional(),
  preferredModes: z.array(z.string()).optional(),
  budgetMinInr: z.number().int().nullable().optional(),
  budgetMaxInr: z.number().int().nullable().optional(),
  careNotes: CareNotesBody.optional(),
  consent: ConsentBody,
  schoolStartTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  schoolEndTime:   z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
});

const UpdateChildBody = ChildBody.omit({ consent: true }).partial().extend({
  consent: ConsentBody.optional(),
});

// ─── GET /children ────────────────────────────────────────────────────────────

router.get("/children", requireAuth, requireRole("parent", "admin"), async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(childrenTable)
    .where(eq(childrenTable.parentId, req.userId!))
    .orderBy(childrenTable.createdAt);

  res.json(rows.map((c) => ({ ...c, completionPct: computeCompletionPct(c) })));
});

// ─── POST /children ───────────────────────────────────────────────────────────

router.post("/children", requireAuth, requireRole("parent", "admin"), async (req, res): Promise<void> => {
  const parsed = ChildBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { consent, ...rest } = parsed.data;
  const consentWithTs = { ...consent, consentedAt: new Date().toISOString() };

  const [child] = await db
    .insert(childrenTable)
    .values({ ...rest, parentId: req.userId!, consent: consentWithTs })
    .returning();

  res.status(201).json({ ...child, completionPct: computeCompletionPct(child) });
});

// ─── GET /children/:id ────────────────────────────────────────────────────────

router.get("/children/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [child] = await db
    .select()
    .from(childrenTable)
    .where(eq(childrenTable.id, id));

  if (!child) { res.status(404).json({ error: "Not found" }); return; }

  // Parent or admin — full row
  if (child.parentId === req.userId || req.userRole === "admin") {
    res.json({ ...child, completionPct: computeCompletionPct(child) });
    return;
  }

  // Professional — intake card only, gated on consent.intakeShare + active booking
  if (req.userRole === "professional") {
    const consent = child.consent as { intakeShare?: boolean } | null;
    if (!consent?.intakeShare) {
      res.status(403).json({ error: "Parent has not enabled profile sharing" });
      return;
    }

    const [booking] = await db
      .select({ id: sessionBookingsTable.id })
      .from(sessionBookingsTable)
      .innerJoin(
        professionalProfilesTable,
        eq(professionalProfilesTable.id, sessionBookingsTable.professionalId),
      )
      .where(
        and(
          eq(professionalProfilesTable.userId, req.userId!),
          eq(sessionBookingsTable.childId, id),
          sql`${sessionBookingsTable.status}::text = ANY(ARRAY['paid_held','session_started','session_completed','releasable','released'])`,
        ),
      )
      .limit(1);

    if (!booking) {
      res.status(403).json({ error: "No qualifying booking found" });
      return;
    }

    res.json({
      id: child.id,
      name: child.name,
      ageMonths: ageMonths(child.dob ?? null),
      conditions: child.conditions ?? null,
      diagnosisStatus: child.diagnosisStatus ?? null,
      goalsAreas: child.goalsAreas ?? null,
      languages: child.languages ?? null,
      careNotes: child.careNotes ?? null,
    });
    return;
  }

  res.status(403).json({ error: "Forbidden" });
});

// ─── PUT /children/:id ────────────────────────────────────────────────────────

router.put("/children/:id", requireAuth, requireRole("parent", "admin"), async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = UpdateChildBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const [existing] = await db
    .select()
    .from(childrenTable)
    .where(and(eq(childrenTable.id, id), eq(childrenTable.parentId, req.userId!)));

  if (!existing) { res.status(404).json({ error: "Child not found" }); return; }

  // Preserve existing consentedAt; stamp now only if consent is newly being set
  let consentUpdate: Record<string, unknown> | null = null;
  if (parsed.data.consent) {
    const existing_consent = existing.consent as Record<string, unknown> | null;
    const preservedAt = existing_consent?.consentedAt ?? new Date().toISOString();
    consentUpdate = { ...parsed.data.consent, consentedAt: preservedAt };
  }

  const { consent: _c, ...rest } = parsed.data;
  const [updated] = await db
    .update(childrenTable)
    .set({
      ...rest,
      ...(consentUpdate ? { consent: consentUpdate } : {}),
      updatedAt: new Date(),
    })
    .where(eq(childrenTable.id, id))
    .returning();

  res.json({ ...updated, completionPct: computeCompletionPct(updated) });
});

// ─── DELETE /children/:id ─────────────────────────────────────────────────────

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
