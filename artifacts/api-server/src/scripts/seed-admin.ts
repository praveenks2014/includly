/**
 * seed-admin.ts
 *
 * One-time (idempotent) script to provision the Sproutly admin account.
 *
 * What it does:
 *  1. Looks up the Clerk user for ADMIN_EMAIL in the Clerk API.
 *  2. Enables email/password login on that Clerk account (so the admin can
 *     log in via both Google-OAuth and email+password).
 *  3. Upserts a row in the `users` table with role = 'admin'.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run seed:admin
 *
 * Required environment variables (already set as Replit secrets):
 *   CLERK_SECRET_KEY   — Clerk backend secret key
 *   DATABASE_URL       — PostgreSQL connection string
 *
 * Optional override:
 *   ADMIN_EMAIL        — defaults to "praveenece.mit@gmail.com"
 *   ADMIN_PASSWORD     — defaults to "Emerald-09A" (Clerk password to set)
 *   ADMIN_FULL_NAME    — defaults to "Praveen Kumar"
 */

import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "praveenece.mit@gmail.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "Emerald-09A";
const ADMIN_FULL_NAME = process.env.ADMIN_FULL_NAME ?? "Praveen Kumar";
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;

if (!CLERK_SECRET_KEY) {
  console.error("CLERK_SECRET_KEY env var is required");
  process.exit(1);
}

async function clerkRequest(path: string, options: RequestInit = {}) {
  const res = await fetch(`https://api.clerk.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${CLERK_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Clerk ${options.method ?? "GET"} ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

async function main() {
  console.log(`Provisioning admin account for: ${ADMIN_EMAIL}`);

  // 1. Find the Clerk user by email
  const searchResult = await clerkRequest(
    `/users?email_address=${encodeURIComponent(ADMIN_EMAIL)}&limit=1`,
  ) as Array<{ id: string; first_name?: string | null; last_name?: string | null }>;

  if (!searchResult.length) {
    console.error(`No Clerk user found with email ${ADMIN_EMAIL}. Create the account first.`);
    process.exit(1);
  }

  const clerkUser = searchResult[0];
  const clerkId = clerkUser.id;
  console.log(`Found Clerk user: ${clerkId}`);

  // 2. Set a password so the admin can log in with email+password (idempotent)
  await clerkRequest(`/users/${clerkId}`, {
    method: "PATCH",
    body: JSON.stringify({ password: ADMIN_PASSWORD, skip_password_checks: true }),
  });
  console.log("Password set (or updated) on Clerk account");

  // 3. Upsert the user in the application database with role = 'admin'
  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId));

  if (existing.length) {
    await db
      .update(usersTable)
      .set({ role: "admin", email: ADMIN_EMAIL, fullName: ADMIN_FULL_NAME })
      .where(eq(usersTable.clerkId, clerkId));
    console.log(`Updated existing user row (id=${existing[0].id}) → role=admin`);
  } else {
    const [inserted] = await db
      .insert(usersTable)
      .values({ clerkId, role: "admin", email: ADMIN_EMAIL, fullName: ADMIN_FULL_NAME })
      .returning({ id: usersTable.id });
    console.log(`Inserted new user row (id=${inserted.id}) → role=admin`);
  }

  console.log("Admin account provisioning complete.");
}

main().catch((err) => {
  console.error("seed-admin failed:", err);
  process.exit(1);
});
