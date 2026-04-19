/**
 * seed-admin.ts
 *
 * Idempotent script to provision the Sproutly admin account.
 *
 * What it does:
 *  1. Searches for an existing Clerk user by email. If none exists, creates one.
 *  2. Ensures a password is set so the admin can log in via both Google-OAuth
 *     and email+password.
 *  3. Upserts a row in the `users` table with role = 'admin'.
 *
 * Usage:
 *   ADMIN_PASSWORD=<secret> pnpm --filter @workspace/api-server run seed:admin
 *
 * Required environment variables (already set as Replit secrets):
 *   CLERK_SECRET_KEY   — Clerk backend secret key
 *   DATABASE_URL       — PostgreSQL connection string
 *   ADMIN_PASSWORD     — password to set on the admin Clerk account (REQUIRED, no default)
 *
 * Optional overrides:
 *   ADMIN_EMAIL        — defaults to "praveenece.mit@gmail.com"
 *   ADMIN_FIRST_NAME   — defaults to "Admin"
 *   ADMIN_LAST_NAME    — defaults to "Sproutly"
 */

import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "praveenece.mit@gmail.com";
const ADMIN_FIRST_NAME = process.env.ADMIN_FIRST_NAME ?? "Admin";
const ADMIN_LAST_NAME = process.env.ADMIN_LAST_NAME ?? "Sproutly";
const ADMIN_FULL_NAME = `${ADMIN_FIRST_NAME} ${ADMIN_LAST_NAME}`;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;

if (!CLERK_SECRET_KEY) {
  console.error("Error: CLERK_SECRET_KEY env var is required");
  process.exit(1);
}

if (!ADMIN_PASSWORD) {
  console.error("Error: ADMIN_PASSWORD env var is required (e.g. ADMIN_PASSWORD=<secret> pnpm seed:admin)");
  process.exit(1);
}

async function clerkRequest<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
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
  return res.json() as Promise<T>;
}

type ClerkUser = { id: string; first_name?: string | null; last_name?: string | null };

async function main() {
  console.log(`Provisioning admin account for: ${ADMIN_EMAIL}`);

  // 1. Find the Clerk user by email; create one if missing
  const searchResult = await clerkRequest<ClerkUser[]>(
    `/users?email_address=${encodeURIComponent(ADMIN_EMAIL)}&limit=1`,
  );

  let clerkId: string;

  if (searchResult.length) {
    clerkId = searchResult[0].id;
    console.log(`Found existing Clerk user: ${clerkId}`);

    // Update name fields to match canonical admin identity
    await clerkRequest(`/users/${clerkId}`, {
      method: "PATCH",
      body: JSON.stringify({
        first_name: ADMIN_FIRST_NAME,
        last_name: ADMIN_LAST_NAME,
        password: ADMIN_PASSWORD,
        skip_password_checks: true,
      }),
    });
    console.log("Updated name + password on existing Clerk account");
  } else {
    console.log("No existing Clerk user found — creating one");
    const created = await clerkRequest<ClerkUser>("/users", {
      method: "POST",
      body: JSON.stringify({
        email_address: [ADMIN_EMAIL],
        first_name: ADMIN_FIRST_NAME,
        last_name: ADMIN_LAST_NAME,
        password: ADMIN_PASSWORD,
        skip_password_checks: true,
      }),
    });
    clerkId = created.id;
    console.log(`Created new Clerk user: ${clerkId}`);
  }

  // 2. Upsert the user in the application database with role = 'admin'
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
