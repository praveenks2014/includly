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
 * POST /account/schedule-delete
 *
 * Schedules account deletion 60 days from now. The user is removed from
 * search immediately (professional profile set to unsubmitted) but all data
 * is preserved. The user can undo this within the 60-day window.
 * After 60 days a background cleanup (or the next login check) will
 * permanently anonymize the record and delete from Clerk.
 */
router.post("/account/schedule-delete", requireAuth, async (req, res): Promise<void> => {
  const { confirmPhrase } = (req.body ?? {}) as { confirmPhrase?: string };

  if (confirmPhrase !== "DELETE MY ACCOUNT") {
    res.status(400).json({ error: "Please type DELETE MY ACCOUNT to confirm" });
    return;
  }

  const userId = req.userId!;

  const deletionScheduledAt = new Date();
  deletionScheduledAt.setDate(deletionScheduledAt.getDate() + 60);

  await db.transaction(async (tx) => {
    await tx
      .update(usersTable)
      .set({ deletionScheduledAt })
      .where(eq(usersTable.id, userId));

    await tx
      .update(professionalProfilesTable)
      .set({ verificationStatus: "unsubmitted", isVerified: false })
      .where(eq(professionalProfilesTable.userId, userId));
  });

  res.json({ success: true, deletionScheduledAt: deletionScheduledAt.toISOString() });
});

/**
 * POST /account/cancel-delete
 *
 * Undoes a scheduled deletion within the 60-day grace window.
 */
router.post("/account/cancel-delete", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId!;

  const [user] = await db
    .select({ deletionScheduledAt: usersTable.deletionScheduledAt })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user?.deletionScheduledAt) {
    res.status(400).json({ error: "No deletion is scheduled for this account." });
    return;
  }

  if (user.deletionScheduledAt < new Date()) {
    res.status(400).json({ error: "The 60-day grace period has expired. Please contact support." });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(usersTable)
      .set({ deletionScheduledAt: null })
      .where(eq(usersTable.id, userId));

    await tx
      .update(professionalProfilesTable)
      .set({ verificationStatus: "pending" })
      .where(eq(professionalProfilesTable.userId, userId));
  });

  res.json({ success: true });
});

/**
 * POST /account/delete
 *
 * GDPR/DPDP right-to-erasure: immediately anonymizes the user record and removes
 * uploaded files. For scheduled deletions past their grace period, or for immediate
 * hard-delete requests from admin flows.
 *
 * Soft-delete approach (preserves FK integrity for relational history):
 *   1. Attempts to delete uploaded identity + certification documents from object storage
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

  const [profile] = await db
    .select()
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, userId));

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

  const clerkId = req.clerkId!;

  await db.transaction(async (tx) => {
    if (profile) {
      await tx
        .update(identityVerificationsTable)
        .set({ fileKey: "[deleted]", status: "rejected" })
        .where(eq(identityVerificationsTable.professionalId, profile.id));

      await tx
        .update(professionalCertificationsTable)
        .set({ fileKey: "[deleted]" })
        .where(eq(professionalCertificationsTable.professionalId, profile.id));

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
        deletionScheduledAt: null,
        clerkId: `deleted-${userId}-${Date.now()}`,
      })
      .where(eq(usersTable.id, userId));
  });

  try {
    await clerkClient.users.deleteUser(clerkId);
  } catch (err) {
    req.log.error({ err, clerkId }, "account/delete: failed to delete user from Clerk — email may remain blocked");
  }

  res.json({ success: true });
});

export default router;
