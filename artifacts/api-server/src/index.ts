import app from "./app";
import { logger } from "./lib/logger";
import { db, usersTable, connectThreadsTable, shadowTeacherMatchesTable } from "@workspace/db";
import { eq, or, and, isNotNull, sql } from "drizzle-orm";
import { initNudgeScheduler } from "./lib/nudgeScheduler";
import { runAutoCancelJob } from "./routes/sessionsV2";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

/**
 * Seed the admin account on every boot.
 *
 * Resolves ALL Clerk user IDs that match ADMIN_EMAIL (Google OAuth and
 * email/password may produce separate Clerk accounts for the same address),
 * then promotes every matching DB row to role=admin.
 *
 * Priority order for discovering clerkIds:
 *  1. ADMIN_CLERK_IDS env var (comma-separated list) — instant, no API call.
 *  2. ADMIN_CLERK_ID env var (single ID, legacy).
 *  3. Clerk API lookup by ADMIN_EMAIL — catches any new accounts automatically.
 */
async function seedAdmin(): Promise<void> {
  const adminEmail = process.env["ADMIN_EMAIL"] ?? "praveenece.mit@gmail.com";
  const clerkSecret = process.env["CLERK_SECRET_KEY"];

  // Collect all known admin Clerk IDs from env vars first.
  const clerkIds = new Set<string>(
    [
      process.env["ADMIN_CLERK_ID"],
      ...(process.env["ADMIN_CLERK_IDS"] ?? "").split(","),
    ]
      .map((s) => s?.trim())
      .filter(Boolean) as string[],
  );

  // Also fetch ALL Clerk users with the admin email — handles the case where
  // Google OAuth creates a second account separate from email/password.
  if (clerkSecret) {
    try {
      const res = await fetch(
        `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(adminEmail)}&limit=10`,
        { headers: { Authorization: `Bearer ${clerkSecret}` } },
      );
      if (res.ok) {
        const users = (await res.json()) as Array<{ id: string }>;
        for (const u of users) clerkIds.add(u.id);
        logger.info({ found: users.length }, "Admin seed: Clerk lookup by email");
      } else {
        logger.warn({ status: res.status }, "Admin seed: Clerk lookup failed");
      }
    } catch (err) {
      logger.warn({ err }, "Admin seed: Clerk API call failed");
    }
  }

  if (!clerkIds.size) {
    logger.warn("Admin seed: no admin Clerk IDs resolved — skipping");
    return;
  }

  try {
    // Collect all DB rows that belong to the admin — either by a known clerkId
    // or by the admin email. Deduplicate by row id so we update each row once.
    const seenIds = new Set<number>();
    let insertedAny = false;

    for (const clerkId of clerkIds) {
      const rows = await db
        .select({ id: usersTable.id, clerkId: usersTable.clerkId, role: usersTable.role })
        .from(usersTable)
        .where(or(eq(usersTable.clerkId, clerkId), eq(usersTable.email, adminEmail)));

      if (!rows.length && !insertedAny) {
        // No row at all for this clerkId — insert one.
        await db
          .insert(usersTable)
          .values({ clerkId, role: "admin", email: adminEmail })
          .onConflictDoNothing();
        insertedAny = true;
        logger.info({ clerkId }, "Admin seed: inserted new admin row");
        continue;
      }

      for (const row of rows) {
        if (seenIds.has(row.id)) continue;
        seenIds.add(row.id);
        // Only update role and email — never overwrite an existing valid clerkId.
        // The admin may have multiple Clerk accounts (Google + email/password);
        // each row keeps its own clerkId.
        await db
          .update(usersTable)
          .set({ role: "admin", email: adminEmail })
          .where(eq(usersTable.id, row.id));
        logger.info({ id: row.id, clerkId: row.clerkId, wasRole: row.role }, "Admin seed: row updated → role=admin");
      }
    }
  } catch (err) {
    logger.warn({ err }, "Admin seed: DB update failed");
  }
}

async function backfillConnectThreads() {
  try {
    await db.execute(sql`
      INSERT INTO connect_threads (parent_id, professional_id, child_id)
      SELECT DISTINCT ON (stm.parent_id, stm.selected_professional_id, stm.child_id)
        stm.parent_id, stm.selected_professional_id, stm.child_id
      FROM shadow_teacher_matches stm
      WHERE stm.status = 'committed'
        AND stm.selected_professional_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM connect_threads ct
          WHERE ct.parent_id = stm.parent_id
            AND ct.professional_id = stm.selected_professional_id
            AND ct.child_id IS NOT DISTINCT FROM stm.child_id
        )
    `);
    logger.info("connect_threads backfill complete");
  } catch (err) {
    logger.error({ err }, "connect_threads backfill failed (non-fatal)");
  }
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  const vapidConfigured = !!(process.env["VAPID_PUBLIC_KEY"] && process.env["VAPID_PRIVATE_KEY"]);
  logger.info({ vapidConfigured }, "Push notification VAPID config status");

  seedAdmin().catch((e) => logger.warn({ e }, "Admin seed failed"));
  initNudgeScheduler();
  backfillConnectThreads().catch((e) => logger.warn({ e }, "connect_threads backfill error"));
  // Auto-cancel unpaid confirmed bookings every 5 minutes
  setInterval(() => { runAutoCancelJob().catch((e) => logger.warn({ e }, "AutoCancel job error")); }, 5 * 60 * 1000);
});
