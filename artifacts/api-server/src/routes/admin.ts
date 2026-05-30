import { Router, type IRouter } from "express";
import { eq, count, gte, and, sum, desc } from "drizzle-orm";
import { createClerkClient } from "@clerk/express";
import {
  db,
  usersTable,
  professionalProfilesTable,
  contactUnlocksTable,
  adminSettingsTable,
  identityVerificationsTable,
  professionalCertificationsTable,
  paymentsTable,
  commissionRatesTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import {
  AdminListProfessionalsQueryParams,
  UpdateAdminSettingsBody,
} from "@workspace/api-zod";

const clerkClient = createClerkClient({ secretKey: process.env["CLERK_SECRET_KEY"] });
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
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
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
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : null;

  const [profile] = await db
    .update(professionalProfilesTable)
    .set({ verificationStatus: "rejected", isVerified: false, rejectionReason: reason || null })
    .where(eq(professionalProfilesTable.id, id))
    .returning();

  if (!profile) {
    res.status(404).json({ error: "Professional not found" });
    return;
  }

  res.json(profile);
});

router.get("/admin/stats", ...adminGuard, async (_req, res): Promise<void> => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    totalUsersResult,
    totalProfessionalsResult,
    totalParentsResult,
    totalUnlocksThisMonthResult,
    pendingResult,
    verifiedResult,
    rejectedResult,
    completedPaymentsResult,
    revenueResult,
    bookingsThisMonthResult,
    newUsersThisMonthResult,
  ] = await Promise.all([
    db.select({ count: count() }).from(usersTable),
    db.select({ count: count() }).from(professionalProfilesTable),
    db.select({ count: count() }).from(usersTable).where(eq(usersTable.role, "parent")),
    db.select({ count: count() }).from(contactUnlocksTable).where(gte(contactUnlocksTable.unlockedAt, startOfMonth)),
    db.select({ count: count() }).from(professionalProfilesTable).where(eq(professionalProfilesTable.verificationStatus, "pending")),
    db.select({ count: count() }).from(professionalProfilesTable).where(eq(professionalProfilesTable.verificationStatus, "verified")),
    db.select({ count: count() }).from(professionalProfilesTable).where(eq(professionalProfilesTable.verificationStatus, "rejected")),
    db.select({ count: count() }).from(paymentsTable).where(eq(paymentsTable.status, "completed")),
    db.select({ total: sum(paymentsTable.amountPaise) }).from(paymentsTable).where(eq(paymentsTable.status, "completed")),
    db.select({ count: count() }).from(paymentsTable).where(
      and(eq(paymentsTable.plan, "plan_f_per_booking"), eq(paymentsTable.status, "completed"), gte(paymentsTable.createdAt, startOfMonth))
    ),
    db.select({ count: count() }).from(usersTable).where(gte(usersTable.createdAt, startOfMonth)),
  ]);

  const specialtyRows = await db
    .select({ specialty: professionalProfilesTable.specialty, cnt: count() })
    .from(professionalProfilesTable)
    .groupBy(professionalProfilesTable.specialty);

  const professionalsBySpecialty: Record<string, number> = {};
  for (const row of specialtyRows) {
    professionalsBySpecialty[row.specialty] = Number(row.cnt);
  }

  res.json({
    totalUsers: Number(totalUsersResult[0]?.count ?? 0),
    totalProfessionals: Number(totalProfessionalsResult[0]?.count ?? 0),
    totalParents: Number(totalParentsResult[0]?.count ?? 0),
    totalUnlocksThisMonth: Number(totalUnlocksThisMonthResult[0]?.count ?? 0),
    pendingProfessionals: Number(pendingResult[0]?.count ?? 0),
    verifiedProfessionals: Number(verifiedResult[0]?.count ?? 0),
    rejectedProfessionals: Number(rejectedResult[0]?.count ?? 0),
    totalPaymentsCompleted: Number(completedPaymentsResult[0]?.count ?? 0),
    totalRevenueInPaise: Number(revenueResult[0]?.total ?? 0),
    totalBookingsThisMonth: Number(bookingsThisMonthResult[0]?.count ?? 0),
    newUsersThisMonth: Number(newUsersThisMonthResult[0]?.count ?? 0),
    professionalsBySpecialty,
  });
});

router.delete("/admin/users/:userId", ...adminGuard, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const userId = parseInt(rawId, 10);
  if (isNaN(userId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }

  const [user] = await db
    .select({ id: usersTable.id, clerkId: usersTable.clerkId, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (user.role === "admin") {
    res.status(403).json({ error: "Cannot delete admin accounts" });
    return;
  }

  await db.delete(usersTable).where(eq(usersTable.id, userId));

  if (user.clerkId && !user.clerkId.startsWith("deleted-")) {
    try {
      await clerkClient.users.deleteUser(user.clerkId);
    } catch (err) {
      console.error("admin/users delete: failed to delete from Clerk", { err, clerkId: user.clerkId });
    }
  }

  res.json({ success: true });
});

router.get("/admin/settings", ...adminGuard, async (_req, res): Promise<void> => {
  let [settings] = await db.select().from(adminSettingsTable).limit(1);

  if (!settings) {
    [settings] = await db.insert(adminSettingsTable).values({}).returning();
  }

  res.json(settings);
});

router.patch("/admin/settings", ...adminGuard, async (req, res): Promise<void> => {
  const parsed = UpdateAdminSettingsBody.safeParse(req.body);
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

router.get("/admin/professionals/:id/documents", ...adminGuard, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [identity] = await db
    .select()
    .from(identityVerificationsTable)
    .where(eq(identityVerificationsTable.professionalId, id));

  const certifications = await db
    .select()
    .from(professionalCertificationsTable)
    .where(eq(professionalCertificationsTable.professionalId, id));

  res.json({
    identity: identity
      ? {
          id: identity.id,
          documentType: identity.documentType,
          fileKey: identity.fileKey,
          status: identity.status,
          submittedAt: identity.submittedAt.toISOString(),
        }
      : null,
    certifications: certifications.map((c) => ({
      id: c.id,
      documentType: c.documentType,
      fileKey: c.fileKey,
      uploadedAt: c.uploadedAt.toISOString(),
    })),
  });
});

router.get("/admin/verifications", ...adminGuard, async (req, res): Promise<void> => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10)));
  const offset = (page - 1) * limit;

  const conditions = status ? [eq(identityVerificationsTable.status, status as "pending" | "approved" | "rejected")] : [];

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: identityVerificationsTable.id,
        professionalId: identityVerificationsTable.professionalId,
        documentType: identityVerificationsTable.documentType,
        fileKey: identityVerificationsTable.fileKey,
        status: identityVerificationsTable.status,
        submittedAt: identityVerificationsTable.submittedAt,
        fullName: professionalProfilesTable.fullName,
        email: usersTable.email,
      })
      .from(identityVerificationsTable)
      .leftJoin(professionalProfilesTable, eq(identityVerificationsTable.professionalId, professionalProfilesTable.id))
      .leftJoin(usersTable, eq(professionalProfilesTable.userId, usersTable.id))
      .where(and(...conditions))
      .orderBy(desc(identityVerificationsTable.submittedAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: count() })
      .from(identityVerificationsTable)
      .where(and(...conditions)),
  ]);

  res.json({
    verifications: rows.map((r) => ({
      ...r,
      submittedAt: r.submittedAt?.toISOString() ?? null,
    })),
    total: Number(totalRows[0]?.count ?? 0),
    page,
    limit,
  });
});

router.get("/admin/parents", ...adminGuard, async (req, res): Promise<void> => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10)));
  const offset = (page - 1) * limit;

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.fullName,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .where(eq(usersTable.role, "parent"))
      .orderBy(desc(usersTable.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: count() }).from(usersTable).where(eq(usersTable.role, "parent")),
  ]);

  res.json({
    parents: rows.map((r) => ({
      ...r,
      fullName: r.name,
      createdAt: r.createdAt?.toISOString() ?? null,
    })),
    total: Number(totalRows[0]?.count ?? 0),
    page,
    limit,
  });
});

router.get("/admin/commission-rates", ...adminGuard, async (req, res): Promise<void> => {
  const rows = await db.select().from(commissionRatesTable).orderBy(commissionRatesTable.bookingType);
  res.json(rows);
});

router.patch("/admin/commission-rates/:bookingType", ...adminGuard, async (req, res): Promise<void> => {
  const bookingType = req.params["bookingType"] as string;
  const { ratePct, notes, isActive } = req.body ?? {};

  if (typeof ratePct !== "number" || ratePct < 0 || ratePct > 100) {
    res.status(400).json({ error: "ratePct must be 0–100" });
    return;
  }

  const [existing] = await db
    .select({ id: commissionRatesTable.id })
    .from(commissionRatesTable)
    .where(eq(commissionRatesTable.bookingType, bookingType))
    .limit(1);

  let updated;
  if (existing) {
    [updated] = await db
      .update(commissionRatesTable)
      .set({
        ratePct,
        ...(typeof notes === "string" ? { notes } : {}),
        ...(typeof isActive === "boolean" ? { isActive } : {}),
        updatedAt: new Date(),
      })
      .where(eq(commissionRatesTable.bookingType, bookingType))
      .returning();
  } else {
    [updated] = await db
      .insert(commissionRatesTable)
      .values({ bookingType, ratePct, notes: notes ?? null, isActive: isActive ?? true })
      .returning();
  }

  res.json(updated);
});

export default router;
