import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  usersTable,
  professionalProfilesTable,
  identityVerificationsTable,
  professionalCertificationsTable,
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
 *   2. Nullifying file references in identity_verifications and professional_certifications rows
 *   3. Nullifying all PII fields on the professional_profiles row (bio, qualifications, phone, email…)
 *   4. Nullifying all PII fields on the users row (name, email, phone, avatarUrl, city, country)
 *   5. Tombstoning clerkId as deleted-{userId}-{ts} so no live Clerk account can re-link
 *
 * FK integrity is preserved (no cascade deletes). Relational history (ratings, unlocks,
 * payments) stays intact but all PII and document references are erased.
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
    // --- Delete identity verification files + null file references ---
    const idVerifs = await db
      .select()
      .from(identityVerificationsTable)
      .where(eq(identityVerificationsTable.professionalId, profile.id));

    for (const v of idVerifs) {
      try {
        const file = await storageService.getObjectEntityFile(v.fileKey);
        await file.delete();
      } catch {
        // Ignore missing files — already deleted or never uploaded
      }
    }

    // Null the file reference so the path cannot be used to infer document identity
    await db
      .update(identityVerificationsTable)
      .set({ fileKey: "[deleted]", status: "rejected" })
      .where(eq(identityVerificationsTable.professionalId, profile.id));

    // --- Delete certification files + null file references ---
    const certs = await db
      .select()
      .from(professionalCertificationsTable)
      .where(eq(professionalCertificationsTable.professionalId, profile.id));

    for (const c of certs) {
      try {
        const file = await storageService.getObjectEntityFile(c.fileKey);
        await file.delete();
      } catch {
        // Ignore missing files
      }
    }

    // Null the file reference on each certification row
    await db
      .update(professionalCertificationsTable)
      .set({ fileKey: "[deleted]" })
      .where(eq(professionalCertificationsTable.professionalId, profile.id));

    // Anonymize professional profile PII
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

  // Anonymize user PII (soft-delete: row stays for FK integrity, all PII wiped)
  await db
    .update(usersTable)
    .set({
      fullName: "[deleted]",
      email: null,
      phone: null,
      avatarUrl: null,
      city: null,
      country: null,
      clerkId: `deleted-${userId}-${Date.now()}`,
    })
    .where(eq(usersTable.id, userId));

  res.json({ success: true });
});

export default router;
