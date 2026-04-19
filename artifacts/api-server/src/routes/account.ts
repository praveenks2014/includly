import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { createClerkClient } from "@clerk/express";
import {
  db,
  usersTable,
  professionalProfilesTable,
  identityVerificationsTable,
  professionalCertificationsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { ObjectStorageService } from "../lib/objectStorage";

const clerkClient = createClerkClient({ secretKey: process.env["CLERK_SECRET_KEY"] });

const router: IRouter = Router();

/**
 * POST /account/delete
 *
 * GDPR/DPDP right-to-erasure: anonymizes the user record and removes uploaded files.
 * Soft-delete approach (preserves FK integrity for relational history):
 *   1. Attempts to delete uploaded identity + certification documents from object storage
 *      (object-delete failures are logged but do not abort the operation)
 *   2. Nullifies file references in identity_verifications and professional_certifications rows
 *   3. Anonymizes professional_profiles PII
 *   4. Anonymizes users PII and sets clerkId tombstone
 *
 * All DB mutations run inside a single transaction so partial failures leave no mixed state.
 */
router.post("/account/delete", requireAuth, async (req, res): Promise<void> => {
  const { confirmPhrase } = (req.body ?? {}) as { confirmPhrase?: string };

  if (confirmPhrase !== "DELETE MY ACCOUNT") {
    res.status(400).json({ error: "Please type DELETE MY ACCOUNT to confirm" });
    return;
  }

  const userId = req.userId!;
  const storageService = new ObjectStorageService();

  // Fetch data outside the transaction (read-only, no contention)
  const [profile] = await db
    .select()
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, userId));

  // Attempt file deletions before the transaction (failures logged, never fatal)
  if (profile) {
    const [idVerifs, certs] = await Promise.all([
      db.select().from(identityVerificationsTable).where(eq(identityVerificationsTable.professionalId, profile.id)),
      db.select().from(professionalCertificationsTable).where(eq(professionalCertificationsTable.professionalId, profile.id)),
    ]);

    for (const v of idVerifs) {
      try {
        const file = await storageService.getObjectEntityFile(v.fileKey);
        await file.delete();
      } catch (err) {
        req.log.warn({ err, fileKey: v.fileKey }, "account/delete: identity doc not deleted from storage");
      }
    }

    for (const c of certs) {
      try {
        const file = await storageService.getObjectEntityFile(c.fileKey);
        await file.delete();
      } catch (err) {
        req.log.warn({ err, fileKey: c.fileKey }, "account/delete: cert file not deleted from storage");
      }
    }
  }

  // Save the Clerk ID before we tombstone it in the DB
  const clerkId = req.clerkId!;

  // All DB anonymization in a single transaction — no partial state on failure
  await db.transaction(async (tx) => {
    if (profile) {
      // Null file references so paths cannot be used to infer document identity
      await tx
        .update(identityVerificationsTable)
        .set({ fileKey: "[deleted]", status: "rejected" })
        .where(eq(identityVerificationsTable.professionalId, profile.id));

      await tx
        .update(professionalCertificationsTable)
        .set({ fileKey: "[deleted]" })
        .where(eq(professionalCertificationsTable.professionalId, profile.id));

      // Anonymize professional profile PII
      await tx
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

    // Anonymize user PII + tombstone clerkId to prevent re-linking
    await tx
      .update(usersTable)
      .set({
        fullName: "[deleted]",
        email: null,
        phone: null,
        avatarUrl: null,
        city: null,
        country: null,
        location: null,
        latitude: null,
        longitude: null,
        shareHomeLocation: false,
        clerkId: `deleted-${userId}-${Date.now()}`,
      })
      .where(eq(usersTable.id, userId));
  });

  // Delete the user from Clerk so the email/OAuth identity is fully released.
  // This runs after the DB transaction so a Clerk API failure doesn't roll back
  // the anonymization, but we log the error so it can be retried manually.
  try {
    await clerkClient.users.deleteUser(clerkId);
  } catch (err) {
    req.log.error({ err, clerkId }, "account/delete: failed to delete user from Clerk — email may remain blocked");
  }

  res.json({ success: true });
});

export default router;
