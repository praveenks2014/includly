import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { eq, and } from "drizzle-orm";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { requireAuth } from "../middlewares/requireAuth";
import { db, userCertificationsTable, identityVerificationsTable, professionalProfilesTable } from "@workspace/db";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
]);

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload. Requires authentication.
 * Enforces server-side MIME allowlist (PDF, JPG, PNG) and 10MB size limit.
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
    res.status(400).json({ error: "File size must be 10MB or less" });
    return;
  }

  if (!name || name.trim().length === 0) {
    res.status(400).json({ error: "File name is required" });
    return;
  }

  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
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
 * Authorization: user must own the object (via certification or identity_verification record),
 * or be an admin. This prevents any authenticated user from reading another user's KYC docs.
 */
router.get("/storage/objects/*path", requireAuth, async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;

    const userId = req.userId!;
    const userRole = req.userRole;

    if (userRole !== "admin") {
      // Check: does the calling user own a certification with this objectPath?
      const certMatch = await db
        .select({ id: userCertificationsTable.id })
        .from(userCertificationsTable)
        .where(
          and(
            eq(userCertificationsTable.documentUrl, objectPath),
            eq(userCertificationsTable.userId, userId),
          )
        )
        .limit(1);

      let isOwner = certMatch.length > 0;

      if (!isOwner) {
        // Check: does the calling professional own an identity_verification with this objectPath?
        const [profile] = await db
          .select({ id: professionalProfilesTable.id })
          .from(professionalProfilesTable)
          .where(eq(professionalProfilesTable.userId, userId));

        if (profile) {
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
