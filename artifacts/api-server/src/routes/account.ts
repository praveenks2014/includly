import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, professionalProfilesTable, userCertificationsTable, identityVerificationsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();

router.post("/account/delete", requireAuth, async (req, res): Promise<void> => {
  const { confirmPhrase } = req.body ?? {};

  if (confirmPhrase !== "DELETE MY ACCOUNT") {
    res.status(400).json({ error: "Please type DELETE MY ACCOUNT to confirm" });
    return;
  }

  const userId = req.userId!;

  const [profile] = await db
    .select()
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, userId));

  const storageService = new ObjectStorageService();

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
        // Ignore missing files
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
  }

  await db.delete(usersTable).where(eq(usersTable.id, userId));

  res.json({ success: true });
});

export default router;
