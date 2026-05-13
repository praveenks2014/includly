import app from "./app";
import { logger } from "./lib/logger";
import { db, usersTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";

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
 * Uses ADMIN_CLERK_ID (fastest, no Clerk API call) if set.
 * Falls back to looking up the Clerk user by ADMIN_EMAIL via the Clerk API.
 * Silently skips if neither can be resolved — the requireAuth middleware
 * provides an additional self-healing layer on every authenticated request.
 */
async function seedAdmin(): Promise<void> {
  const adminEmail = process.env["ADMIN_EMAIL"] ?? "praveenece.mit@gmail.com";
  const adminClerkId = process.env["ADMIN_CLERK_ID"];
  const clerkSecret = process.env["CLERK_SECRET_KEY"];

  let clerkId = adminClerkId ?? null;

  // If ADMIN_CLERK_ID isn't set, resolve via Clerk API
  if (!clerkId && clerkSecret) {
    try {
      const res = await fetch(
        `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(adminEmail)}&limit=1`,
        { headers: { Authorization: `Bearer ${clerkSecret}` } },
      );
      if (res.ok) {
        const users = (await res.json()) as Array<{ id: string }>;
        if (users.length) clerkId = users[0].id;
      } else {
        logger.warn({ status: res.status }, "Admin seed: Clerk lookup failed");
      }
    } catch (err) {
      logger.warn({ err }, "Admin seed: Clerk API call failed");
    }
  }

  if (!clerkId) {
    logger.warn("Admin seed: no ADMIN_CLERK_ID and Clerk lookup unavailable — skipping");
    return;
  }

  try {
    // Update both possible rows: by clerk_id AND by admin email (handles stale rows)
    const rows = await db
      .select({ id: usersTable.id, clerkId: usersTable.clerkId, role: usersTable.role })
      .from(usersTable)
      .where(or(eq(usersTable.clerkId, clerkId), eq(usersTable.email, adminEmail)));

    for (const row of rows) {
      const updates: Record<string, unknown> = { role: "admin" };
      if (row.clerkId !== clerkId) updates.clerkId = clerkId;
      await db.update(usersTable).set(updates).where(eq(usersTable.id, row.id));
      logger.info({ id: row.id, clerkId, wasRole: row.role }, "Admin seed: row updated → role=admin");
    }

    if (!rows.length) {
      // No row at all — insert one
      await db.insert(usersTable)
        .values({ clerkId, role: "admin", email: adminEmail })
        .onConflictDoNothing();
      logger.info({ clerkId }, "Admin seed: inserted new admin row");
    }
  } catch (err) {
    logger.warn({ err }, "Admin seed: DB update failed");
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
});
