import app from "./app";
import { logger } from "./lib/logger";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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

async function seedAdmin(): Promise<void> {
  const adminEmail = process.env["ADMIN_EMAIL"] ?? "praveenece.mit@gmail.com";
  const clerkSecret = process.env["CLERK_SECRET_KEY"];
  const adminPassword = process.env["ADMIN_PASSWORD"];

  if (!clerkSecret) {
    logger.warn("CLERK_SECRET_KEY not set — skipping admin seed");
    return;
  }

  try {
    const res = await fetch(
      `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(adminEmail)}&limit=1`,
      { headers: { Authorization: `Bearer ${clerkSecret}` } },
    );
    if (!res.ok) {
      logger.warn({ status: res.status }, "Admin seed: Clerk user lookup failed");
      return;
    }
    const users = (await res.json()) as Array<{ id: string }>;

    let clerkId: string;

    if (users.length) {
      clerkId = users[0].id;
      if (adminPassword) {
        await fetch(`https://api.clerk.com/v1/users/${clerkId}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${clerkSecret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ password: adminPassword, skip_password_checks: true }),
        });
      }
    } else {
      if (!adminPassword) {
        logger.warn("Admin seed: no Clerk user found and ADMIN_PASSWORD not set — cannot create");
        return;
      }
      const createRes = await fetch("https://api.clerk.com/v1/users", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${clerkSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email_address: [adminEmail],
          password: adminPassword,
          skip_password_checks: true,
        }),
      });
      if (!createRes.ok) {
        logger.warn({ status: createRes.status }, "Admin seed: failed to create Clerk user");
        return;
      }
      const created = (await createRes.json()) as { id: string };
      clerkId = created.id;
    }

    const existing = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkId));

    if (existing.length) {
      await db
        .update(usersTable)
        .set({ role: "admin", email: adminEmail })
        .where(eq(usersTable.clerkId, clerkId));
      logger.info({ clerkId }, "Admin seed: updated existing row → role=admin");
    } else {
      const byEmail = await db
        .select({ id: usersTable.id, clerkId: usersTable.clerkId })
        .from(usersTable)
        .where(eq(usersTable.email, adminEmail));

      if (byEmail.length) {
        await db
          .update(usersTable)
          .set({ role: "admin", clerkId })
          .where(eq(usersTable.email, adminEmail));
        logger.info({ clerkId }, "Admin seed: fixed clerk_id on existing email row → role=admin");
      } else {
        await db
          .insert(usersTable)
          .values({ clerkId, role: "admin", email: adminEmail })
          .onConflictDoNothing();
        logger.info({ clerkId }, "Admin seed: inserted new admin row");
      }
    }
  } catch (err) {
    logger.warn({ err }, "Admin seed: unexpected error — skipping");
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
