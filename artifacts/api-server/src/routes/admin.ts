import { Router, type IRouter } from "express";
import { eq, count, gte, and } from "drizzle-orm";
import {
  db,
  usersTable,
  professionalProfilesTable,
  contactUnlocksTable,
  adminSettingsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import {
  AdminListProfessionalsQueryParams,
  AdminUpdateSettingsBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

const adminGuard = [requireAuth, requireRole("admin")] as const;

router.get("/admin/professionals", ...adminGuard, async (req, res): Promise<void> => {
  const parsed = AdminListProfessionalsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { status, page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  const conditions = status
    ? [eq(professionalProfilesTable.verificationStatus, status)]
    : [];

  const rows = await db
    .select({
      id: professionalProfilesTable.id,
      userId: professionalProfilesTable.userId,
      fullName: professionalProfilesTable.fullName,
      specialty: professionalProfilesTable.specialty,
      verificationStatus: professionalProfilesTable.verificationStatus,
      city: professionalProfilesTable.city,
      country: professionalProfilesTable.country,
      createdAt: professionalProfilesTable.createdAt,
      userEmail: usersTable.email,
      userName: usersTable.fullName,
    })
    .from(professionalProfilesTable)
    .leftJoin(usersTable, eq(professionalProfilesTable.userId, usersTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(professionalProfilesTable.createdAt)
    .offset(offset)
    .limit(limit);

  const [totalResult] = await db
    .select({ count: count() })
    .from(professionalProfilesTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  res.json({
    professionals: rows,
    total: Number(totalResult?.count ?? 0),
    page,
    limit,
  });
});

router.patch("/admin/professionals/:id/approve", ...adminGuard, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [profile] = await db
    .update(professionalProfilesTable)
    .set({ verificationStatus: "verified", isVerified: true })
    .where(eq(professionalProfilesTable.id, id))
    .returning();

  if (!profile) {
    res.status(404).json({ error: "Professional not found" });
    return;
  }

  res.json(profile);
});

router.patch("/admin/professionals/:id/reject", ...adminGuard, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [profile] = await db
    .update(professionalProfilesTable)
    .set({ verificationStatus: "rejected", isVerified: false })
    .where(eq(professionalProfilesTable.id, id))
    .returning();

  if (!profile) {
    res.status(404).json({ error: "Professional not found" });
    return;
  }

  res.json(profile);
});

router.get("/admin/stats", ...adminGuard, async (_req, res): Promise<void> => {
  const [totalUsersResult] = await db.select({ count: count() }).from(usersTable);
  const [totalProfessionalsResult] = await db.select({ count: count() }).from(professionalProfilesTable);
  const [totalParentsResult] = await db
    .select({ count: count() })
    .from(usersTable)
    .where(eq(usersTable.role, "parent"));

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [totalUnlocksThisMonthResult] = await db
    .select({ count: count() })
    .from(contactUnlocksTable)
    .where(gte(contactUnlocksTable.unlockedAt, startOfMonth));

  const [pendingResult] = await db
    .select({ count: count() })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.verificationStatus, "pending"));

  const [verifiedResult] = await db
    .select({ count: count() })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.verificationStatus, "verified"));

  const [rejectedResult] = await db
    .select({ count: count() })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.verificationStatus, "rejected"));

  res.json({
    totalUsers: Number(totalUsersResult?.count ?? 0),
    totalProfessionals: Number(totalProfessionalsResult?.count ?? 0),
    totalParents: Number(totalParentsResult?.count ?? 0),
    totalUnlocksThisMonth: Number(totalUnlocksThisMonthResult?.count ?? 0),
    pendingProfessionals: Number(pendingResult?.count ?? 0),
    verifiedProfessionals: Number(verifiedResult?.count ?? 0),
    rejectedProfessionals: Number(rejectedResult?.count ?? 0),
  });
});

router.get("/admin/settings", ...adminGuard, async (_req, res): Promise<void> => {
  let [settings] = await db.select().from(adminSettingsTable).limit(1);

  if (!settings) {
    [settings] = await db.insert(adminSettingsTable).values({}).returning();
  }

  res.json(settings);
});

router.patch("/admin/settings", ...adminGuard, async (req, res): Promise<void> => {
  const parsed = AdminUpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let [settings] = await db.select().from(adminSettingsTable).limit(1);
  if (!settings) {
    [settings] = await db.insert(adminSettingsTable).values({}).returning();
  }

  const [updated] = await db
    .update(adminSettingsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(adminSettingsTable.id, settings.id))
    .returning();

  res.json(updated);
});

export default router;
