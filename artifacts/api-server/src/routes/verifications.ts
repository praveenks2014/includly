import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  professionalProfilesTable,
  userCertificationsTable,
  identityVerificationsTable,
  pendingUploadsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { SubmitIdentityVerificationBody, SubmitCertificationBody } from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * Verify the calling user owns a given objectPath by checking the pending_uploads ledger.
 * Marks the upload as consumed so it cannot be claimed again.
 * Returns false if the file was uploaded by a different user or not found.
 */
async function claimUpload(userId: number, objectPath: string): Promise<boolean> {
  const [record] = await db
    .select()
    .from(pendingUploadsTable)
    .where(
      and(
        eq(pendingUploadsTable.objectPath, objectPath),
        eq(pendingUploadsTable.userId, userId),
        eq(pendingUploadsTable.consumed, false),
      )
    )
    .limit(1);

  if (!record) return false;

  await db
    .update(pendingUploadsTable)
    .set({ consumed: true })
    .where(eq(pendingUploadsTable.id, record.id));

  return true;
}

function validateFileKey(fileKey: string): boolean {
  return fileKey.startsWith("/objects/");
}

router.post(
  "/verifications/identity",
  requireAuth,
  requireRole("professional"),
  async (req, res): Promise<void> => {
    const parsed = SubmitIdentityVerificationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    const { documentType, fileKey, dpdpConsent } = parsed.data;

    if (!dpdpConsent) {
      res.status(400).json({ error: "DPDP consent is required to submit identity verification" });
      return;
    }

    if (!validateFileKey(fileKey)) {
      res.status(400).json({ error: "Invalid file key" });
      return;
    }

    const [profile] = await db
      .select()
      .from(professionalProfilesTable)
      .where(eq(professionalProfilesTable.userId, req.userId!));

    if (!profile) {
      res.status(404).json({ error: "Professional profile not found" });
      return;
    }

    // Verify the calling user uploaded this file (ownership check via upload ledger)
    const owned = await claimUpload(req.userId!, fileKey);
    if (!owned) {
      res.status(403).json({ error: "File was not uploaded by you or has already been claimed" });
      return;
    }

    const [existing] = await db
      .select()
      .from(identityVerificationsTable)
      .where(eq(identityVerificationsTable.professionalId, profile.id));

    let record;
    if (existing) {
      [record] = await db
        .update(identityVerificationsTable)
        .set({
          documentType,
          fileKey,
          dpdpConsent,
          status: "pending",
          submittedAt: new Date(),
          reviewedAt: null,
        })
        .where(eq(identityVerificationsTable.id, existing.id))
        .returning();
    } else {
      [record] = await db
        .insert(identityVerificationsTable)
        .values({
          professionalId: profile.id,
          documentType,
          fileKey,
          dpdpConsent,
          status: "pending",
        })
        .returning();
    }

    await db
      .update(professionalProfilesTable)
      .set({ verificationStatus: "pending" })
      .where(eq(professionalProfilesTable.id, profile.id));

    res.status(201).json({
      id: record.id,
      professionalId: record.professionalId,
      documentType: record.documentType,
      fileKey: record.fileKey,
      status: record.status,
      dpdpConsent: record.dpdpConsent,
      submittedAt: record.submittedAt.toISOString(),
    });
  }
);

router.get(
  "/verifications/identity",
  requireAuth,
  requireRole("professional"),
  async (req, res): Promise<void> => {
    const [profile] = await db
      .select()
      .from(professionalProfilesTable)
      .where(eq(professionalProfilesTable.userId, req.userId!));

    if (!profile) {
      res.status(404).json({ error: "Professional profile not found" });
      return;
    }

    const [record] = await db
      .select()
      .from(identityVerificationsTable)
      .where(eq(identityVerificationsTable.professionalId, profile.id));

    if (!record) {
      res.status(404).json({ error: "No identity verification submitted" });
      return;
    }

    res.json({
      id: record.id,
      professionalId: record.professionalId,
      documentType: record.documentType,
      fileKey: record.fileKey,
      status: record.status,
      dpdpConsent: record.dpdpConsent,
      submittedAt: record.submittedAt.toISOString(),
    });
  }
);

router.post(
  "/verifications/certifications",
  requireAuth,
  requireRole("professional"),
  async (req, res): Promise<void> => {
    const parsed = SubmitCertificationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    const { documentType, fileKey } = parsed.data;

    if (!validateFileKey(fileKey)) {
      res.status(400).json({ error: "Invalid file key" });
      return;
    }

    const [profile] = await db
      .select()
      .from(professionalProfilesTable)
      .where(eq(professionalProfilesTable.userId, req.userId!));

    if (!profile) {
      res.status(404).json({ error: "Professional profile not found" });
      return;
    }

    // Verify the calling user uploaded this file (ownership check via upload ledger)
    const owned = await claimUpload(req.userId!, fileKey);
    if (!owned) {
      res.status(403).json({ error: "File was not uploaded by you or has already been claimed" });
      return;
    }

    const [record] = await db
      .insert(userCertificationsTable)
      .values({
        userId: req.userId!,
        documentType,
        documentUrl: fileKey,
        status: "pending",
      })
      .returning();

    res.status(201).json({
      id: record.id,
      professionalId: profile.id,
      documentType: record.documentType,
      fileKey: record.documentUrl,
      uploadedAt: record.createdAt.toISOString(),
    });
  }
);

router.get(
  "/verifications/certifications",
  requireAuth,
  requireRole("professional"),
  async (req, res): Promise<void> => {
    const [profile] = await db
      .select()
      .from(professionalProfilesTable)
      .where(eq(professionalProfilesTable.userId, req.userId!));

    if (!profile) {
      res.status(404).json({ error: "Professional profile not found" });
      return;
    }

    const records = await db
      .select()
      .from(userCertificationsTable)
      .where(eq(userCertificationsTable.userId, req.userId!));

    res.json(
      records.map((r) => ({
        id: r.id,
        professionalId: profile.id,
        documentType: r.documentType,
        fileKey: r.documentUrl,
        uploadedAt: r.createdAt.toISOString(),
      }))
    );
  }
);

export default router;
