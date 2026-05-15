import type { Request, Response, NextFunction } from "express";
import { createRemoteJWKSet, jwtVerify, decodeJwt } from "jose";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

type UserRole = "parent" | "professional" | "admin";

declare global {
  namespace Express {
    interface Request {
      userId?: number;
      clerkId?: string;
      userRole?: UserRole;
    }
  }
}

/**
 * Derive the Clerk FAPI host from a publishable key.
 * Format: pk_live_<base64> or pk_test_<base64>
 * The base64 part decodes to "<fapi-host>$"
 */
function fapiHostFromKey(pk: string): string | null {
  const base64Part = pk.replace(/^pk_(live|test)_/, "");
  try {
    const decoded = Buffer.from(base64Part, "base64").toString("utf8");
    const host = decoded.replace(/\$+$/, "");
    return host || null;
  } catch {
    return null;
  }
}

/**
 * Build the set of trusted Clerk issuers and their pre-cached JWKS instances.
 *
 * We always trust:
 *  1. The production/live issuer derived from CLERK_PUBLISHABLE_KEY / VITE_CLERK_PUBLISHABLE_KEY
 *  2. The development issuer derived from the hardcoded DEV_CLERK_KEY used by App.tsx
 *     when import.meta.env.DEV === true (pk_test_Y2hvaWNlLWxpb24tNTcuY2xlcmsuYWNjb3VudHMuZGV2JA
 *     → choice-lion-57.clerk.accounts.dev)
 *
 * Using a whitelist means we never blindly trust an issuer from the JWT payload.
 */
function buildTrustedJwksSets(): Map<string, ReturnType<typeof createRemoteJWKSet>> {
  const map = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

  const keySources = [
    process.env.VITE_CLERK_PUBLISHABLE_KEY,
    process.env.CLERK_PUBLISHABLE_KEY,
    // DEV key hardcoded in App.tsx (choice-lion-57.clerk.accounts.dev)
    "pk_test_Y2hvaWNlLWxpb24tNTcuY2xlcmsuYWNjb3VudHMuZGV2JA",
  ].filter(Boolean) as string[];

  for (const pk of keySources) {
    const host = fapiHostFromKey(pk);
    if (!host) continue;
    const issuer = `https://${host}`;
    if (map.has(issuer)) continue;
    const jwksUrl = `${issuer}/.well-known/jwks.json`;
    console.log(`[requireAuth] Trusting Clerk issuer: ${issuer}`);
    map.set(issuer, createRemoteJWKSet(new URL(jwksUrl)));
  }

  return map;
}

const TRUSTED_JWKS = buildTrustedJwksSets();

/**
 * Extract the Bearer token from the Authorization header.
 */
function extractToken(req: Request): string | null {
  const header = req.headers["authorization"];
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/**
 * Verify a Clerk JWT. Reads the `iss` claim to select the right JWKS from
 * the whitelist of trusted issuers, then verifies the signature.
 * Returns the Clerk user ID (the `sub` claim) or null on failure.
 */
async function verifyClerkToken(token: string): Promise<string | null> {
  try {
    // Decode without verification to read the issuer claim
    const unverified = decodeJwt(token);
    const iss = typeof unverified.iss === "string" ? unverified.iss : null;

    if (!iss) {
      console.error("[requireAuth] JWT has no iss claim");
      return null;
    }

    const jwks = TRUSTED_JWKS.get(iss);
    if (!jwks) {
      console.error(`[requireAuth] Untrusted JWT issuer: ${iss}`);
      return null;
    }

    const { payload } = await jwtVerify(token, jwks);
    return payload.sub ?? null;
  } catch (err) {
    console.error("[requireAuth] JWT verification failed:", (err as Error).message);
    return null;
  }
}

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const token = extractToken(req);

  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const clerkId = await verifyClerkToken(token);

  if (!clerkId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.clerkId = clerkId;

  // Use upsert to avoid a race condition where two concurrent requests for a
  // brand-new user both see no row and both attempt INSERT, causing the second
  // one to fail with a unique-constraint violation.
  const inserted = await db
    .insert(usersTable)
    .values({ clerkId, role: "parent" })
    .onConflictDoNothing()
    .returning();

  let user =
    inserted[0] ??
    (await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)))[0];

  if (!user) {
    res.status(500).json({ error: "Failed to resolve user" });
    return;
  }

  const adminEmail = process.env["ADMIN_EMAIL"] ?? "praveenece.mit@gmail.com";
  const adminClerkId = process.env["ADMIN_CLERK_ID"];

  // On a brand-new user insert, fetch their primary email from Clerk (once per
  // user) so we can store it and use it for admin self-healing below.
  let resolvedEmail = user.email ?? null;
  if (inserted[0] && !resolvedEmail) {
    const clerkSecret = process.env["CLERK_SECRET_KEY"];
    if (clerkSecret) {
      try {
        const clerkRes = await fetch(`https://api.clerk.com/v1/users/${clerkId}`, {
          headers: { Authorization: `Bearer ${clerkSecret}` },
        });
        if (clerkRes.ok) {
          const cu = await clerkRes.json() as {
            email_addresses?: { email_address: string; verification?: { status: string } }[];
          };
          const primary =
            cu.email_addresses?.find((e) => e.verification?.status === "verified")?.email_address
            ?? cu.email_addresses?.[0]?.email_address;
          if (primary) {
            resolvedEmail = primary;
            await db.update(usersTable).set({ email: primary }).where(eq(usersTable.id, user.id));
          }
        }
      } catch {
        // Non-fatal — email sync is best-effort
      }
    }
  }

  // Self-heal: ensure the admin account always has role=admin regardless of
  // how they log in (email+password or Google OAuth) and in both dev/prod.
  const isAdmin =
    (adminClerkId && clerkId === adminClerkId) ||
    (resolvedEmail && resolvedEmail === adminEmail);

  if (isAdmin && user.role !== "admin") {
    const [fixed] = await db
      .update(usersTable)
      .set({ role: "admin" })
      .where(eq(usersTable.id, user.id))
      .returning();
    if (fixed) {
      user = fixed;
    }
  }

  req.userId = user.id;
  req.userRole = user.role as UserRole;
  next();
};

/**
 * Middleware that requires the user to have one of the specified roles.
 * Must be used AFTER requireAuth.
 */
export function requireRole(...roles: UserRole[]) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const req = _req;
    if (!req.userRole || !roles.includes(req.userRole)) {
      res.status(403).json({ error: "Forbidden: insufficient role" });
      return;
    }
    next();
  };
}

export const optionalAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const token = extractToken(req);

  if (token) {
    const clerkId = await verifyClerkToken(token);
    if (clerkId) {
      req.clerkId = clerkId;
      const [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.clerkId, clerkId));
      if (user) {
        req.userId = user.id;
        req.userRole = user.role as UserRole;
      }
    }
  }

  next();
};
