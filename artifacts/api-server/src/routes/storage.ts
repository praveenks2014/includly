import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { eq, and, sql } from "drizzle-orm";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { requireAuth } from "../middlewares/requireAuth";
import {
  db,
  professionalCertificationsTable,
  identityVerificationsTable,
  professionalProfilesTable,
  pendingUploadsTable,
  engagementDailyLogsTable,
  shadowTeacherEngagementsTable,
} from "@workspace/db";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
]);

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned PUT URL for a private file upload. Requires authentication.
 * Enforces server-side MIME allowlist (PDF, JPG, PNG) and 10 MB size limit on declared values.
 * Actual object content-type and size are re-validated from GCS metadata when the caller
 * submits the fileKey to a verification endpoint (see verifications.ts → claimAndValidateUpload).
 * Records the upload intent in the pending_uploads ledger so verification routes can
 * confirm ownership before accepting the fileKey.
 */
router.post("/storage/uploads/request-url", requireAuth, async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  const { name, size, contentType } = parsed.data;

  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    res.status(400).json({ error: "Only PDF, JPG, and PNG files are allowed" });
    return;
  }

  if (size > MAX_UPLOAD_BYTES) {
    res.status(400).json({ error: "File size must be 10 MB or less" });
    return;
  }

  if (!name || name.trim().length === 0) {
    res.status(400).json({ error: "File name is required" });
    return;
  }

  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    // Record in upload ledger — verification endpoints use this to confirm ownership
    await db.insert(pendingUploadsTable).values({
      userId: req.userId!,
      objectPath,
      contentType,
      fileSizeBytes: size,
    });

    res.json(RequestUploadUrlResponse.parse({ uploadURL, objectPath }));
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS. No auth required.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve private object entities. Requires authentication.
 * Authorization (non-admins): caller must own the object via:
 *   - professional_certifications: fileKey = objectPath AND professionalId matches caller's profile
 *   - identity_verifications:      fileKey = objectPath AND professionalId matches caller's profile
 * Admins bypass the owner check.
 */
router.get("/storage/objects/*path", requireAuth, async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;

    const userId = req.userId!;
    const userRole = req.userRole;

    if (userRole !== "admin") {
      // Resolve caller's professional profile (needed for both ownership checks)
      const [profile] = await db
        .select({ id: professionalProfilesTable.id })
        .from(professionalProfilesTable)
        .where(eq(professionalProfilesTable.userId, userId));

      let isOwner = false;

      if (profile) {
        // Check certification ownership
        const certMatch = await db
          .select({ id: professionalCertificationsTable.id })
          .from(professionalCertificationsTable)
          .where(
            and(
              eq(professionalCertificationsTable.fileKey, objectPath),
              eq(professionalCertificationsTable.professionalId, profile.id),
            )
          )
          .limit(1);

        isOwner = certMatch.length > 0;

        if (!isOwner) {
          // Check identity verification ownership
          const idVerifMatch = await db
            .select({ id: identityVerificationsTable.id })
            .from(identityVerificationsTable)
            .where(
              and(
                eq(identityVerificationsTable.fileKey, objectPath),
                eq(identityVerificationsTable.professionalId, profile.id),
              )
            )
            .limit(1);

          isOwner = idVerifMatch.length > 0;
        }
      }

      if (!isOwner) {
        // Check engagement daily-log photo ownership:
        // the user must be the parent or teacher (professional) of the engagement
        // whose log content references this objectPath as photoKey.
        const [logEng] = await db
          .select({
            parentId:       shadowTeacherEngagementsTable.parentId,
            professionalId: shadowTeacherEngagementsTable.professionalId,
          })
          .from(engagementDailyLogsTable)
          .innerJoin(
            shadowTeacherEngagementsTable,
            eq(engagementDailyLogsTable.engagementId, shadowTeacherEngagementsTable.id),
          )
          .where(
            sql`${engagementDailyLogsTable.content}::jsonb @> ${JSON.stringify({ photoKey: objectPath })}::jsonb`,
          )
          .limit(1);

        if (logEng) {
          if (logEng.parentId === userId) isOwner = true;
          else if (profile && logEng.professionalId === profile.id) isOwner = true;
        }
      }

      if (!isOwner) {
        res.status(403).json({ error: "Forbidden: you do not own this object" });
        return;
      }
    }

    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
