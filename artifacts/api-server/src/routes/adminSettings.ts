import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, adminSettingsTable, DEFAULT_CONTACT_LIMIT } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";

const router: IRouter = Router();

async function getSetting(key: string): Promise<string | null> {
  const [setting] = await db
    .select({ value: adminSettingsTable.value })
    .from(adminSettingsTable)
    .where(eq(adminSettingsTable.key, key))
    .limit(1);
  return setting?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  const existing = await getSetting(key);
  if (existing !== null) {
    await db
      .update(adminSettingsTable)
      .set({ value })
      .where(eq(adminSettingsTable.key, key));
  } else {
    await db.insert(adminSettingsTable).values({ key, value });
  }
}

router.get("/admin/settings", requireAuth, requireRole("admin"), async (_req, res): Promise<void> => {
  const limitStr = await getSetting("contact_limit_per_month");
  const contactLimitPerMonth = limitStr ? parseInt(limitStr, 10) : DEFAULT_CONTACT_LIMIT;

  res.json({ contactLimitPerMonth });
});

router.patch("/admin/settings", requireAuth, requireRole("admin"), async (req, res): Promise<void> => {
  const { contactLimitPerMonth } = req.body ?? {};

  if (contactLimitPerMonth !== undefined) {
    const parsed = Number(contactLimitPerMonth);
    if (!Number.isInteger(parsed) || parsed < 1) {
      res.status(400).json({ error: "contactLimitPerMonth must be a positive integer" });
      return;
    }
    await setSetting("contact_limit_per_month", String(parsed));
  }

  const limitStr = await getSetting("contact_limit_per_month");
  const limit = limitStr ? parseInt(limitStr, 10) : DEFAULT_CONTACT_LIMIT;

  res.json({ contactLimitPerMonth: limit });
});

export default router;
