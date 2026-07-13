import { Router, type IRouter } from "express";
import { eq, ne, count, gte, and, sum, desc, isNotNull, inArray } from "drizzle-orm";
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
  sessionBookingsTable,
  bookingPayoutsTable,
  shadowTeacherMatchesTable,
  shadowTeacherEngagementsTable,
  childrenTable,
  engagementLifecycleRequestsTable,
  engagementSalaryPaymentsTable,
  waitlistTable,
  settingsAuditLogTable,
  professionalOfferingsTable,
  insertAdminSettingSchema,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { z } from "zod";
import {
  AdminListProfessionalsQueryParams,
} from "@workspace/api-zod";
import {
  getVerificationRequirementsForProfessional,
  getVerificationRequirementsForOffering,
  computeVerificationRequirements,
  RCI_CERTIFICATE_DOC_TYPE,
  type VerificationVertical,
} from "../lib/verificationRequirements";
import { resolveOffering } from "../lib/offeringResolver";

const OFFERING_VERTICALS: VerificationVertical[] = ["shadow_teacher", "home_tutor", "therapist"];

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
      rciCrrNumber: professionalProfilesTable.rciCrrNumber,
      vertical: professionalProfilesTable.vertical,
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

  // Batch-load identity docs + certifications for the page of rows so the
  // admin list can show, per professional, whether the vertical's mandatory
  // verification requirements have actually been met — not just their
  // current verificationStatus label (which an admin could otherwise
  // approve without realizing documents are still missing).
  const ids = rows.map((r) => r.id);
  const identityDocs = ids.length
    ? await db
        .select({ professionalId: identityVerificationsTable.professionalId })
        .from(identityVerificationsTable)
        .where(inArray(identityVerificationsTable.professionalId, ids))
    : [];
  const certs = ids.length
    ? await db
        .select({
          professionalId: professionalCertificationsTable.professionalId,
          documentType: professionalCertificationsTable.documentType,
        })
        .from(professionalCertificationsTable)
        .where(inArray(professionalCertificationsTable.professionalId, ids))
    : [];

  const identityDocIds = new Set(identityDocs.map((d) => d.professionalId));
  const certsByProfessional = new Map<number, string[]>();
  for (const c of certs) {
    const list = certsByProfessional.get(c.professionalId) ?? [];
    list.push(c.documentType);
    certsByProfessional.set(c.professionalId, list);
  }

  const professionals = rows.map((row) => {
    const { rciCrrNumber, vertical, ...rest } = row;
    const certDocumentTypes = certsByProfessional.get(row.id) ?? [];
    const requirements = computeVerificationRequirements(
      { vertical, rciCrrNumber },
      identityDocIds.has(row.id),
      certDocumentTypes,
    );
    return {
      ...rest,
      hasIdentityDoc: identityDocIds.has(row.id),
      hasRciCertificate: certDocumentTypes.includes(RCI_CERTIFICATE_DOC_TYPE),
      requirementsMet: requirements.met,
      missingRequirements: requirements.missing,
      requirementWarnings: requirements.warnings,
    };
  });

  res.json({
    professionals,
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

  const [existing] = await db
    .select({ id: professionalProfilesTable.id })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, id));

  if (!existing) {
    res.status(404).json({ error: "Professional not found" });
    return;
  }

  // Hard server-side gate: cannot approve (and thus make listable/matchable)
  // a professional whose vertical's mandatory verification requirements
  // (government ID for all verticals; RCI CRR number + RCI certificate for
  // therapists) have not actually been submitted. This is non-negotiable —
  // an admin click alone must never be sufficient to grant visibility.
  const requirements = await getVerificationRequirementsForProfessional(id);
  if (!requirements.met) {
    res.status(400).json({
      error: "verification_requirements_not_met",
      message: "Cannot approve — required verification documents are missing.",
      missing: requirements.missing,
      warnings: requirements.warnings,
    });
    return;
  }

  const profile = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(professionalProfilesTable)
      .set({ verificationStatus: "verified", isVerified: true })
      .where(eq(professionalProfilesTable.id, id))
      .returning();

    if (!row) return null;

    const [identityDoc] = await tx
      .select({ id: identityVerificationsTable.id })
      .from(identityVerificationsTable)
      .where(eq(identityVerificationsTable.professionalId, id));

    if (identityDoc) {
      await tx
        .update(identityVerificationsTable)
        .set({ status: "verified", reviewedAt: new Date() })
        .where(eq(identityVerificationsTable.professionalId, id));
    }

    return row;
  });

  if (!profile) {
    res.status(404).json({ error: "Professional not found" });
    return;
  }

  res.json({ ...profile, verificationRequirements: requirements });
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

  await db
    .update(identityVerificationsTable)
    .set({ status: "rejected", reviewedAt: new Date() })
    .where(eq(identityVerificationsTable.professionalId, id));

  res.json(profile);
});

/** GET /admin/professionals/:id/offerings — primary + additional offerings, each with its own gate status. */
router.get("/admin/professionals/:id/offerings", ...adminGuard, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [profile] = await db
    .select()
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, id));

  if (!profile) {
    res.status(404).json({ error: "Professional not found" });
    return;
  }

  const extra = await db
    .select()
    .from(professionalOfferingsTable)
    .where(eq(professionalOfferingsTable.professionalId, id));

  const verticals = [profile.vertical, ...extra.map((o) => o.vertical)];
  const offerings = await Promise.all(
    verticals.map(async (vertical) => {
      const requirements = await getVerificationRequirementsForOffering(id, vertical);
      const location = await resolveOffering(id, vertical);
      return {
        vertical,
        isPrimary: location?.isPrimary ?? (vertical === profile.vertical),
        verificationStatus: location?.verificationStatus ?? "unsubmitted",
        requirementsMet: requirements.met,
        missingRequirements: requirements.missing,
        requirementWarnings: requirements.warnings,
      };
    }),
  );

  res.json({ professionalId: id, offerings });
});

// Hard server-side gate, per-offering — cannot approve (and thus make an
// OFFERING listable/matchable) unless THAT vertical's own requirements are
// met. Reuses the exact same getVerificationRequirementsForOffering /
// computeVerificationRequirements gate as the primary-offering approve
// route above — never a separate/weaker check.
router.patch("/admin/professionals/:id/offerings/:vertical/approve", ...adminGuard, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const verticalRaw = Array.isArray(req.params.vertical) ? req.params.vertical[0] : req.params.vertical;
  if (isNaN(id) || !OFFERING_VERTICALS.includes(verticalRaw as VerificationVertical)) {
    res.status(400).json({ error: "Invalid id or vertical" });
    return;
  }
  const vertical = verticalRaw as VerificationVertical;

  const location = await resolveOffering(id, vertical);
  if (!location) {
    res.status(404).json({ error: "Offering not found" });
    return;
  }

  const requirements = await getVerificationRequirementsForOffering(id, vertical);
  if (!requirements.met) {
    res.status(400).json({
      error: "verification_requirements_not_met",
      message: "Cannot approve — required verification documents are missing for this offering.",
      missing: requirements.missing,
      warnings: requirements.warnings,
    });
    return;
  }

  if (location.isPrimary) {
    // Identical write to the existing single-offering approve route above.
    const [row] = await db
      .update(professionalProfilesTable)
      .set({ verificationStatus: "verified", isVerified: true })
      .where(eq(professionalProfilesTable.id, id))
      .returning();
    res.json({ vertical, isPrimary: true, ...row, verificationRequirements: requirements });
    return;
  }

  const [row] = await db
    .update(professionalOfferingsTable)
    .set({ verificationStatus: "verified", isVerified: true })
    .where(eq(professionalOfferingsTable.id, location.offeringId!))
    .returning();

  res.json({ vertical, isPrimary: false, ...row, verificationRequirements: requirements });
});

router.patch("/admin/professionals/:id/offerings/:vertical/reject", ...adminGuard, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const verticalRaw = Array.isArray(req.params.vertical) ? req.params.vertical[0] : req.params.vertical;
  if (isNaN(id) || !OFFERING_VERTICALS.includes(verticalRaw as VerificationVertical)) {
    res.status(400).json({ error: "Invalid id or vertical" });
    return;
  }
  const vertical = verticalRaw as VerificationVertical;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : null;

  const location = await resolveOffering(id, vertical);
  if (!location) {
    res.status(404).json({ error: "Offering not found" });
    return;
  }

  if (location.isPrimary) {
    const [row] = await db
      .update(professionalProfilesTable)
      .set({ verificationStatus: "rejected", isVerified: false, rejectionReason: reason || null })
      .where(eq(professionalProfilesTable.id, id))
      .returning();
    res.json({ vertical, isPrimary: true, ...row });
    return;
  }

  const [row] = await db
    .update(professionalOfferingsTable)
    .set({ verificationStatus: "rejected", isVerified: false, rejectionReason: reason || null })
    .where(eq(professionalOfferingsTable.id, location.offeringId!))
    .returning();

  res.json({ vertical, isPrimary: false, ...row });
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

router.get("/settings/me", requireAuth, async (_req, res): Promise<void> => {
  let [settings] = await db.select().from(adminSettingsTable).limit(1);
  if (!settings) {
    [settings] = await db.insert(adminSettingsTable).values({}).returning();
  }

  res.json({
    placementFeeInr: settings.placementFeeInr,
    activationFeeInr: settings.activationFeeInr,
    platformSalaryEnabled: settings.platformSalaryEnabled,
    trialDirectPayEnabled: settings.trialDirectPayEnabled,
    trialFeeInr: settings.trialFeeInr,
  });
});

router.patch("/admin/settings", ...adminGuard, async (req, res): Promise<void> => {
  const parsed = insertAdminSettingSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let [settings] = await db.select().from(adminSettingsTable).limit(1);
  if (!settings) {
    [settings] = await db.insert(adminSettingsTable).values({}).returning();
  }

  // Diff only the fields the caller actually sent, and only when the value differs
  // from what's currently stored — keeps the audit trail meaningful.
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(parsed.data) as (keyof typeof parsed.data)[]) {
    const nextVal = parsed.data[key];
    const prevVal = (settings as Record<string, unknown>)[key as string];
    if (nextVal !== undefined && nextVal !== prevVal) {
      changes[key as string] = { from: prevVal, to: nextVal };
    }
  }

  const [updated] = await db
    .update(adminSettingsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(adminSettingsTable.id, settings.id))
    .returning();

  if (Object.keys(changes).length > 0) {
    await db.insert(settingsAuditLogTable).values({
      adminUserId: req.userId!,
      changes,
    });
  }

  res.json(updated);
});

router.get("/admin/settings/audit-log", ...adminGuard, async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: settingsAuditLogTable.id,
      adminUserId: settingsAuditLogTable.adminUserId,
      adminName: usersTable.fullName,
      changes: settingsAuditLogTable.changes,
      createdAt: settingsAuditLogTable.createdAt,
    })
    .from(settingsAuditLogTable)
    .leftJoin(usersTable, eq(settingsAuditLogTable.adminUserId, usersTable.id))
    .orderBy(desc(settingsAuditLogTable.createdAt))
    .limit(100);

  res.json(rows);
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
        fullName: usersTable.fullName,
        city: usersTable.city,
        location: usersTable.location,
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
      city: r.city ?? r.location ?? null,
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

// ─── Admin: Booking management (Flow B) ────────────────────────────────────

// GET /admin/bookings — list bookings with optional status filter
router.get("/admin/bookings", ...adminGuard, async (req, res): Promise<void> => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "30"), 10)));
  const offset = (page - 1) * limit;

  const conditions = status
    ? [eq(sessionBookingsTable.status, status as any)]
    : [];

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: sessionBookingsTable.id,
        status: sessionBookingsTable.status,
        parentId: sessionBookingsTable.parentId,
        parentName: usersTable.fullName,
        professionalId: sessionBookingsTable.professionalId,
        proName: professionalProfilesTable.fullName,
        proUpiVpa: professionalProfilesTable.upiVpa,
        bookedDate: sessionBookingsTable.bookedDate,
        startTime: sessionBookingsTable.startTime,
        amountInr: sessionBookingsTable.amountInr,
        proAmountInr: sessionBookingsTable.proAmountInr,
        markupInr: sessionBookingsTable.markupInr,
        gstInr: sessionBookingsTable.gstInr,
        disputeReason: sessionBookingsTable.disputeReason,
        disputedAt: sessionBookingsTable.disputedAt,
        releasedAt: sessionBookingsTable.releasedAt,
        createdAt: sessionBookingsTable.createdAt,
      })
      .from(sessionBookingsTable)
      .leftJoin(usersTable, eq(sessionBookingsTable.parentId, usersTable.id))
      .leftJoin(professionalProfilesTable, eq(sessionBookingsTable.professionalId, professionalProfilesTable.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(sessionBookingsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: count() }).from(sessionBookingsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined),
  ]);

  res.json({ bookings: rows, total: Number(totalRows[0]?.count ?? 0), page, limit });
});

// PATCH /admin/bookings/:id/release — mark payout as RELEASED (DB only; no live RazorpayX)
router.patch("/admin/bookings/:id/release", ...adminGuard, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { note } = req.body as { note?: string };

  const [booking] = await db.select().from(sessionBookingsTable).where(eq(sessionBookingsTable.id, id));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  if (booking.status !== "releasable") { res.status(400).json({ error: `Can only release bookings in RELEASABLE status, currently: ${booking.status}` }); return; }

  const now = new Date();
  const adminUser = req.userId!;

  // Get professional's user ID for payout record
  const [prof] = await db
    .select({ userId: professionalProfilesTable.userId, upiVpa: professionalProfilesTable.upiVpa })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, booking.professionalId));

  await db.transaction(async (tx) => {
    await tx.update(sessionBookingsTable)
      .set({ status: "released", releasedAt: now, releasedBy: adminUser, updatedAt: now })
      .where(eq(sessionBookingsTable.id, id));

    await tx.insert(bookingPayoutsTable).values({
      bookingId: id,
      professionalUserId: prof?.userId ?? null,
      proAmountInr: booking.proAmountInr ?? 0,
      markupInr: booking.markupInr ?? 0,
      gstInr: booking.gstInr ?? 0,
      totalCollectedInr: booking.amountInr ?? 0,
      upiVpa: prof?.upiVpa ?? null,
      status: "released",
      note: note ?? null,
      releasedBy: adminUser,
      releasedAt: now,
    });
  });

  const [updated] = await db.select().from(sessionBookingsTable).where(eq(sessionBookingsTable.id, id));
  res.json(updated);
});

// POST /admin/bookings/batch-release — release multiple RELEASABLE bookings
router.post("/admin/bookings/batch-release", ...adminGuard, async (req, res): Promise<void> => {
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids array required" }); return;
  }

  const adminUser = req.userId!;
  const now = new Date();
  const results: Array<{ id: number; ok: boolean; error?: string }> = [];

  for (const id of ids) {
    try {
      const [booking] = await db.select().from(sessionBookingsTable).where(eq(sessionBookingsTable.id, id));
      if (!booking || booking.status !== "releasable") {
        results.push({ id, ok: false, error: `Not releasable (status: ${booking?.status ?? "not found"})` });
        continue;
      }

      const [prof] = await db
        .select({ userId: professionalProfilesTable.userId, upiVpa: professionalProfilesTable.upiVpa })
        .from(professionalProfilesTable)
        .where(eq(professionalProfilesTable.id, booking.professionalId));

      await db.transaction(async (tx) => {
        await tx.update(sessionBookingsTable)
          .set({ status: "released", releasedAt: now, releasedBy: adminUser, updatedAt: now })
          .where(eq(sessionBookingsTable.id, id));
        await tx.insert(bookingPayoutsTable).values({
          bookingId: id,
          professionalUserId: prof?.userId ?? null,
          proAmountInr: booking.proAmountInr ?? 0,
          markupInr: booking.markupInr ?? 0,
          gstInr: booking.gstInr ?? 0,
          totalCollectedInr: booking.amountInr ?? 0,
          upiVpa: prof?.upiVpa ?? null,
          status: "released",
          releasedBy: adminUser,
          releasedAt: now,
        });
      });
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, error: String(err) });
    }
  }

  res.json({ results, releasedCount: results.filter((r) => r.ok).length });
});

// PATCH /admin/bookings/:id/refund — refund a DISPUTED or PAID_HELD booking via Razorpay
router.patch("/admin/bookings/:id/refund", ...adminGuard, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { note } = req.body as { note?: string };

  const [booking] = await db.select().from(sessionBookingsTable).where(eq(sessionBookingsTable.id, id));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }

  const refundable = ["disputed", "paid_held", "cancelled"];
  if (!refundable.includes(booking.status ?? "")) {
    res.status(400).json({ error: `Cannot refund in status: ${booking.status}` }); return;
  }

  let razorpayRefundId: string | null = null;
  if (booking.providerPaymentId) {
    try {
      const keyId = process.env["RAZORPAY_KEY_ID"];
      const keySecret = process.env["RAZORPAY_KEY_SECRET"];
      if (keyId && keySecret) {
        const Razorpay = (await import("razorpay")).default;
        const rz = new Razorpay({ key_id: keyId, key_secret: keySecret });
        const refund = await (rz.payments as any).refund(booking.providerPaymentId, {
          amount: (booking.amountInr ?? 0) * 100,
          notes: { reason: note ?? "Admin refund", bookingId: String(id) },
        }) as { id?: string };
        razorpayRefundId = refund?.id ?? null;
      }
    } catch (err) {
      console.error("[admin/refund] Razorpay refund failed:", err);
    }
  }

  const now = new Date();
  const [updated] = await db
    .update(sessionBookingsTable)
    .set({ status: "refunded", releasedAt: now, releasedBy: req.userId!, updatedAt: now })
    .where(eq(sessionBookingsTable.id, id))
    .returning();

  res.json({ ...updated, razorpayRefundId });
});

// PATCH /admin/bookings/:id/resolve-dispute — admin resolves a dispute
router.patch("/admin/bookings/:id/resolve-dispute", ...adminGuard, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { resolution } = req.body as { resolution?: "release" | "refund" };
  if (!resolution || !["release", "refund"].includes(resolution)) {
    res.status(400).json({ error: "resolution must be 'release' or 'refund'" }); return;
  }

  const [booking] = await db.select().from(sessionBookingsTable).where(eq(sessionBookingsTable.id, id));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  if (booking.status !== "disputed") { res.status(400).json({ error: "Booking is not in DISPUTED status" }); return; }

  const newStatus = resolution === "release" ? "releasable" : "refunded";
  const now = new Date();
  const [updated] = await db
    .update(sessionBookingsTable)
    .set({ status: newStatus, releasedBy: req.userId!, updatedAt: now })
    .where(eq(sessionBookingsTable.id, id))
    .returning();

  res.json(updated);
});

// ── Admin Engagement Management ─────────────────────────────────────────────

// GET /admin/engagements — list all shadow teacher engagements
router.get("/admin/engagements", ...adminGuard, async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: shadowTeacherEngagementsTable.id,
      parentId: shadowTeacherEngagementsTable.parentId,
      professionalId: shadowTeacherEngagementsTable.professionalId,
      childId: shadowTeacherEngagementsTable.childId,
      matchRequestId: shadowTeacherEngagementsTable.matchRequestId,
      tier: shadowTeacherEngagementsTable.tier,
      startDate: shadowTeacherEngagementsTable.startDate,
      monthlyFeeInr: shadowTeacherEngagementsTable.monthlyFeeInr,
      status: shadowTeacherEngagementsTable.status,
      endDate: shadowTeacherEngagementsTable.endDate,
      notes: shadowTeacherEngagementsTable.notes,
      createdAt: shadowTeacherEngagementsTable.createdAt,
      parentName: usersTable.fullName,
      professionalName: professionalProfilesTable.fullName,
      childName: childrenTable.name,
      platformSalaryEnabled: shadowTeacherEngagementsTable.platformSalaryEnabled,
      placementFeeInr: shadowTeacherEngagementsTable.placementFeeInr,
      placementFeePaymentId: shadowTeacherEngagementsTable.placementFeePaymentId,
      activationFeeInr: shadowTeacherEngagementsTable.activationFeeInr,
      activationFeePaymentId: shadowTeacherEngagementsTable.activationFeePaymentId,
    })
    .from(shadowTeacherEngagementsTable)
    .leftJoin(usersTable, eq(shadowTeacherEngagementsTable.parentId, usersTable.id))
    .leftJoin(professionalProfilesTable, eq(shadowTeacherEngagementsTable.professionalId, professionalProfilesTable.id))
    .leftJoin(childrenTable, eq(shadowTeacherEngagementsTable.childId, childrenTable.id))
    .orderBy(desc(shadowTeacherEngagementsTable.createdAt));

  res.json(rows);
});

// POST /admin/engagements — admin creates a new engagement (from a matched request)
router.post("/admin/engagements", ...adminGuard, async (req, res): Promise<void> => {
  const { parentId, professionalId, childId, matchRequestId, tier, startDate, monthlyFeeInr, notes } = req.body ?? {};
  if (!parentId || !professionalId || !startDate || !monthlyFeeInr) {
    res.status(400).json({ error: "parentId, professionalId, startDate, monthlyFeeInr are required" });
    return;
  }

  const [eng] = await db
    .insert(shadowTeacherEngagementsTable)
    .values({
      parentId: Number(parentId),
      professionalId: Number(professionalId),
      childId: childId ? Number(childId) : null,
      matchRequestId: matchRequestId ? Number(matchRequestId) : null,
      tier: tier ?? null,
      startDate,
      hoursPerWeek: 0,
      monthlyFeeInr: Number(monthlyFeeInr),
      notes: notes ?? null,
      status: "active",
    })
    .returning();

  // If created from a match request, mark it as matched
  if (matchRequestId) {
    await db
      .update(shadowTeacherMatchesTable)
      .set({ status: "matched", matchedAt: new Date(), updatedAt: new Date() })
      .where(eq(shadowTeacherMatchesTable.id, Number(matchRequestId)));
  }

  res.status(201).json(eng);
});

// GET /admin/engagements/:id/lifecycle — admin views lifecycle requests for engagement
router.get("/admin/engagements/:id/lifecycle", ...adminGuard, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const rows = await db
    .select()
    .from(engagementLifecycleRequestsTable)
    .where(eq(engagementLifecycleRequestsTable.engagementId, id))
    .orderBy(desc(engagementLifecycleRequestsTable.createdAt));
  res.json(rows);
});

// GET /admin/salary-payments — list all salary payments
router.get("/admin/salary-payments", ...adminGuard, async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: engagementSalaryPaymentsTable.id,
      engagementId: engagementSalaryPaymentsTable.engagementId,
      month: engagementSalaryPaymentsTable.month,
      grossInr: engagementSalaryPaymentsTable.grossInr,
      platformCutInr: engagementSalaryPaymentsTable.platformCutInr,
      netInr: engagementSalaryPaymentsTable.netInr,
      status: engagementSalaryPaymentsTable.status,
      paidAt: engagementSalaryPaymentsTable.paidAt,
      parentName: usersTable.fullName,
    })
    .from(engagementSalaryPaymentsTable)
    .leftJoin(shadowTeacherEngagementsTable, eq(engagementSalaryPaymentsTable.engagementId, shadowTeacherEngagementsTable.id))
    .leftJoin(usersTable, eq(shadowTeacherEngagementsTable.parentId, usersTable.id))
    .orderBy(desc(engagementSalaryPaymentsTable.createdAt));
  res.json(rows);
});

// GET /admin/payouts — list all booking payouts
router.get("/admin/payouts", ...adminGuard, async (req, res): Promise<void> => {
  const rows = await db
    .select({
      id: bookingPayoutsTable.id,
      bookingId: bookingPayoutsTable.bookingId,
      proName: professionalProfilesTable.fullName,
      upiVpa: bookingPayoutsTable.upiVpa,
      proAmountInr: bookingPayoutsTable.proAmountInr,
      markupInr: bookingPayoutsTable.markupInr,
      gstInr: bookingPayoutsTable.gstInr,
      totalCollectedInr: bookingPayoutsTable.totalCollectedInr,
      status: bookingPayoutsTable.status,
      note: bookingPayoutsTable.note,
      releasedAt: bookingPayoutsTable.releasedAt,
    })
    .from(bookingPayoutsTable)
    .leftJoin(usersTable, eq(bookingPayoutsTable.professionalUserId, usersTable.id))
    .leftJoin(professionalProfilesTable, eq(usersTable.id, professionalProfilesTable.userId))
    .orderBy(desc(bookingPayoutsTable.createdAt));

  res.json(rows);
});

// ─── Admin: User role management ────────────────────────────────────────────

// GET /admin/users — list all users (any role) with search
router.get("/admin/users", ...adminGuard, async (req, res): Promise<void> => {
  const { search, role, page: rawPage, limit: rawLimit } = req.query;
  const page = Math.max(1, parseInt(String(rawPage ?? "1"), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(rawLimit ?? "30"), 10)));
  const offset = (page - 1) * limit;

  const conditions: ReturnType<typeof eq>[] = [];
  if (role && typeof role === "string") conditions.push(eq(usersTable.role, role as any));

  let rows = await db
    .select({
      id: usersTable.id,
      clerkId: usersTable.clerkId,
      email: usersTable.email,
      fullName: usersTable.fullName,
      role: usersTable.role,
      city: usersTable.city,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(conditions.length ? conditions[0] : undefined)
    .orderBy(desc(usersTable.createdAt))
    .limit(limit)
    .offset(offset);

  if (search && typeof search === "string") {
    const q = search.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.email?.toLowerCase().includes(q) ||
        r.fullName?.toLowerCase().includes(q) ||
        String(r.id).includes(q),
    );
  }

  res.json({
    users: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt?.toISOString() ?? null,
    })),
    page,
    limit,
  });
});

// PATCH /admin/users/:id/role — change a user's role
router.patch("/admin/users/:id/role", ...adminGuard, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] ?? "", 10);
  const { role } = req.body ?? {};

  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  const allowed = ["parent", "professional", "admin"] as const;
  if (!allowed.includes(role)) {
    res.status(400).json({ error: `role must be one of: ${allowed.join(", ")}` });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set({ role, updatedAt: new Date() })
    .where(eq(usersTable.id, id))
    .returning({ id: usersTable.id, role: usersTable.role, email: usersTable.email });

  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(updated);
});

// DELETE /admin/users/:id — remove a user from the database
// The user's Clerk account is preserved; they can re-onboard on next sign-in.
router.delete("/admin/users/:id", ...adminGuard, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  const [user] = await db
    .select({ id: usersTable.id, role: usersTable.role, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, id))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (user.role === "admin") {
    res.status(403).json({ error: "Cannot delete an admin account" });
    return;
  }

  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.json({ deleted: true, id, email: user.email });
});

router.get("/admin/professionals/pending-rci", ...adminGuard, async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: professionalProfilesTable.id,
      fullName: professionalProfilesTable.fullName,
      city: professionalProfilesTable.city,
      country: professionalProfilesTable.country,
      rciCrrNumber: professionalProfilesTable.rciCrrNumber,
      vertical: professionalProfilesTable.vertical,
      createdAt: professionalProfilesTable.createdAt,
      userEmail: usersTable.email,
    })
    .from(professionalProfilesTable)
    .leftJoin(usersTable, eq(professionalProfilesTable.userId, usersTable.id))
    .where(
      and(
        eq(professionalProfilesTable.vertical, "therapist"),
        isNotNull(professionalProfilesTable.rciCrrNumber),
        ne(professionalProfilesTable.rciCrrNumber, ""),
        eq(professionalProfilesTable.rciVerified, false),
      ),
    )
    .orderBy(professionalProfilesTable.createdAt);

  res.json({ professionals: rows, total: rows.length });
});

router.patch("/admin/professionals/:id/verify-rci", ...adminGuard, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [profile] = await db
    .update(professionalProfilesTable)
    .set({ rciVerified: true, updatedAt: new Date() })
    .where(and(eq(professionalProfilesTable.id, id), eq(professionalProfilesTable.vertical, "therapist")))
    .returning();

  if (!profile) {
    res.status(404).json({ error: "Professional not found or not a therapist" });
    return;
  }

  res.json({ id: profile.id, rciVerified: profile.rciVerified, fullName: profile.fullName });
});

router.get("/admin/waitlist", ...adminGuard, async (req, res): Promise<void> => {
  const { category } = req.query as { category?: string };
  const conditions = category ? [eq(waitlistTable.category, category)] : [];
  const rows = await db
    .select()
    .from(waitlistTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(waitlistTable.createdAt));
  res.json(rows);
});

router.delete("/purge-non-admin-users", async (req, res): Promise<void> => {
  const secret = req.headers["x-purge-secret"];
  if (secret !== "includly-purge-2026-xk9q") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const deleted = await db
    .delete(usersTable)
    .where(ne(usersTable.role, "admin"))
    .returning({ id: usersTable.id, role: usersTable.role });
  res.json({ deleted: deleted.length, ids: deleted.map((u) => u.id) });
});

// ── PATCH /admin/shadow-match/:matchId/settings — per-match admin toggles ─
// Task 2d. Currently supports activationFeeEnabled only; extend the Zod body
// when more per-match toggles are needed.
const UpdateShadowMatchSettingsBody = z.object({
  activationFeeEnabled: z.boolean(),
});
router.patch("/admin/shadow-match/:matchId/settings", requireAuth, requireRole("admin"), async (req, res): Promise<void> => {
  const matchId = parseInt(req.params["matchId"] as string, 10);
  if (isNaN(matchId)) { res.status(400).json({ error: "Invalid matchId" }); return; }
  const parsed = UpdateShadowMatchSettingsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [updated] = await db
    .update(shadowTeacherMatchesTable)
    .set({ activationFeeEnabled: parsed.data.activationFeeEnabled, updatedAt: new Date() })
    .where(eq(shadowTeacherMatchesTable.id, matchId))
    .returning({ id: shadowTeacherMatchesTable.id, activationFeeEnabled: shadowTeacherMatchesTable.activationFeeEnabled });
  if (!updated) { res.status(404).json({ error: "Match not found" }); return; }
  res.json({ matchId: updated.id, activationFeeEnabled: updated.activationFeeEnabled });
});

export default router;
