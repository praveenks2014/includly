import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  professionalProfilesTable,
  professionalCertificationsTable,
  identityVerificationsTable,
  pendingUploadsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { SubmitIdentityVerificationBody, SubmitCertificationBody } from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { recomputeSubmissionStatus } from "../lib/verificationRequirements";

const router: IRouter = Router();
const storageService = new ObjectStorageService();

const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Claim a pending upload: verify the caller owns the fileKey (was issued to this userId),
 * then validate the ACTUAL GCS object content-type and size from metadata.
 * Marks the record consumed so it cannot be claimed again.
 * Returns an error string on failure, or null on success.
 */
async function claimAndValidateUpload(
  userId: number,
  objectPath: string
): Promise<string | null> {
  // 1. Ownership: find an unconsumed ledger entry for this user + path
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

  if (!record) {
    return "File was not uploaded by you or has already been claimed";
  }

  // 2. Server-side validation: read real metadata from GCS (prevents bypass via forged JSON)
  let realContentType: string;
  let realSize: number;
  try {
    const meta = await storageService.getObjectEntityMetadata(objectPath);
    realContentType = meta.contentType;
    realSize = meta.size;
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      return "Uploaded file not found in storage — please try uploading again";
    }
    throw err;
  }

  if (!ALLOWED_CONTENT_TYPES.has(realContentType)) {
    return `File type '${realContentType}' is not allowed. Only PDF, JPG, and PNG are accepted`;
  }

  if (realSize > MAX_UPLOAD_BYTES) {
    return `File size ${(realSize / 1024 / 1024).toFixed(1)} MB exceeds the 10 MB limit`;
  }

  // 3. Mark consumed so the path cannot be re-claimed
  await db
    .update(pendingUploadsTable)
    .set({ consumed: true })
    .where(eq(pendingUploadsTable.id, record.id));

  return null; // success
}

function validateFileKey(fileKey: string): boolean {
  return typeof fileKey === "string" && fileKey.startsWith("/objects/");
}

/** POST /verifications/identity — submit KYC document */
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

    // Verify upload ownership + validate actual GCS content-type / size
    const claimError = await claimAndValidateUpload(req.userId!, fileKey);
    if (claimError) {
      res.status(403).json({ error: claimError });
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

    // Only flips unsubmitted/rejected -> pending once ALL of the vertical's
    // mandatory requirements (ID + therapist RCI cert/number) are met — an
    // ID upload alone is not enough to enter the admin review queue for a
    // therapist still missing their RCI certificate.
    await recomputeSubmissionStatus(profile.id);

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

/** GET /verifications/identity — fetch current KYC status */
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

/** POST /verifications/certifications — upload qualification certificate */
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

    // Verify upload ownership + validate actual GCS content-type / size
    const claimError = await claimAndValidateUpload(req.userId!, fileKey);
    if (claimError) {
      res.status(403).json({ error: claimError });
      return;
    }

    const [record] = await db
      .insert(professionalCertificationsTable)
      .values({
        professionalId: profile.id,
        documentType,
        fileKey,
      })
      .returning();

    // A certification (e.g. an RCI certificate for a therapist) can be the
    // last missing requirement — recheck whether the profile is now
    // reviewable.
    await recomputeSubmissionStatus(profile.id);

    res.status(201).json({
      id: record.id,
      professionalId: record.professionalId,
      documentType: record.documentType,
      fileKey: record.fileKey,
      uploadedAt: record.uploadedAt.toISOString(),
    });
  }
);

/** GET /verifications/certifications — list professional's certificates */
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
      .from(professionalCertificationsTable)
      .where(eq(professionalCertificationsTable.professionalId, profile.id));

    res.json(
      records.map((r) => ({
        id: r.id,
        professionalId: r.professionalId,
        documentType: r.documentType,
        fileKey: r.fileKey,
        uploadedAt: r.uploadedAt.toISOString(),
      }))
    );
  }
);

export default router;
