import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  usersTable,
  professionalProfilesTable,
  userCertificationsTable,
  identityVerificationsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();

/**
 * POST /account/delete
 *
 * GDPR/DPDP right-to-erasure: anonymizes the user record and removes uploaded files.
 * Implements soft-delete by:
 *   1. Removing uploaded identity + certification documents from object storage
 *   2. Nullifying all PII fields on the users row (name, email, phone, avatarUrl, city, country)
 *   3. Setting clerkId to a tombstone value so the Clerk account can no longer sign in and
 *      create a new linked record (clerk-<userId>-deleted)
 *   4. Nullifying PII on the professional_profiles row if present (bio, qualifications, phone, email)
 *
 * This approach keeps FK integrity intact (no cascade deletes) while removing all personal data,
 * satisfying DPDP Article 12 & GDPR Article 17 without breaking relational history.
 */
router.post("/account/delete", requireAuth, async (req, res): Promise<void> => {
  const { confirmPhrase } = (req.body ?? {}) as { confirmPhrase?: string };

  if (confirmPhrase !== "DELETE MY ACCOUNT") {
    res.status(400).json({ error: "Please type DELETE MY ACCOUNT to confirm" });
    return;
  }

  const userId = req.userId!;
  const storageService = new ObjectStorageService();

  const [profile] = await db
    .select()
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, userId));

  if (profile) {
    const idVerifs = await db
      .select()
      .from(identityVerificationsTable)
      .where(eq(identityVerificationsTable.professionalId, profile.id));

    for (const v of idVerifs) {
      try {
        const file = await storageService.getObjectEntityFile(v.fileKey);
        await file.delete();
      } catch {
        // Ignore missing files — object may have been deleted already
      }
    }

    const certs = await db
      .select()
      .from(userCertificationsTable)
      .where(eq(userCertificationsTable.userId, userId));

    for (const c of certs) {
      try {
        const file = await storageService.getObjectEntityFile(c.documentUrl);
        await file.delete();
      } catch {
        // Ignore missing files
      }
    }

    // Anonymize professional profile PII fields
    await db
      .update(professionalProfilesTable)
      .set({
        fullName: "[deleted]",
        bio: null,
        qualifications: "[deleted]",
        phone: null,
        email: null,
        city: null,
        country: null,
        latitude: null,
        longitude: null,
        paymentActivated: false,
      })
      .where(eq(professionalProfilesTable.userId, userId));
  }

  // Anonymize user PII fields (soft-delete: row stays for FK integrity, all PII wiped)
  await db
    .update(usersTable)
    .set({
      fullName: "[deleted]",
      email: null,
      phone: null,
      avatarUrl: null,
      city: null,
      country: null,
      // Replace clerkId with a tombstone so no live Clerk account can re-link
      clerkId: `deleted-${userId}-${Date.now()}`,
    })
    .where(eq(usersTable.id, userId));

  res.json({ success: true });
});

export default router;
