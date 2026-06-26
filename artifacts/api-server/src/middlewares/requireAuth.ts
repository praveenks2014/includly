import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "@clerk/backend";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

type UserRole = "parent" | "professional" | "admin" | "centre_admin";

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
 * Verify a Clerk JWT using @clerk/backend's verifyToken.
 *
 * verifyToken with secretKey fetches JWKS from the Clerk Backend API
 * (https://api.clerk.com/v1/jwks) — NOT from the custom FAPI domain.
 * This means JWT verification works even if clerk.includly.in is
 * unreachable from the production server.
 */
async function verifyClerkToken(token: string): Promise<string | null> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    console.error("[requireAuth] CLERK_SECRET_KEY is not set");
    return null;
  }
  try {
    const payload = await verifyToken(token, { secretKey });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch (err) {
    console.error("[requireAuth] JWT verification failed:", (err as Error).message);
    return null;
  }
}

/**
 * Extract the Bearer token from the Authorization header.
 */
function extractToken(req: Request): string | null {
  const header = req.headers["authorization"];
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
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
  const adminClerkIdSet = new Set(
    [
      process.env["ADMIN_CLERK_ID"],
      ...(process.env["ADMIN_CLERK_IDS"] ?? "").split(","),
    ]
      .map((s) => s?.trim())
      .filter(Boolean) as string[],
  );

  // Fetch email + fullName from Clerk for any user whose email or fullName is
  // not yet stored. Covers brand-new inserts and rows created before sync was added.
  let resolvedEmail = user.email ?? null;
  const needsClerkSync = (!resolvedEmail || !user.fullName) && user.role !== "admin";
  if (needsClerkSync) {
    const clerkSecret = process.env["CLERK_SECRET_KEY"];
    if (clerkSecret) {
      try {
        const clerkRes = await fetch(`https://api.clerk.com/v1/users/${clerkId}`, {
          headers: { Authorization: `Bearer ${clerkSecret}` },
        });
        if (clerkRes.ok) {
          const cu = await clerkRes.json() as {
            email_addresses?: { email_address: string; verification?: { status: string } }[];
            first_name?: string | null;
            last_name?: string | null;
          };
          const primary =
            cu.email_addresses?.find((e) => e.verification?.status === "verified")?.email_address
            ?? cu.email_addresses?.[0]?.email_address;
          const fullNameFromClerk = [cu.first_name, cu.last_name].filter(Boolean).join(" ") || null;
          const updates: { email?: string; fullName?: string } = {};
          if (primary && !user.email) { updates.email = primary; resolvedEmail = primary; }
          if (fullNameFromClerk && !user.fullName) { updates.fullName = fullNameFromClerk; }
          if (Object.keys(updates).length > 0) {
            await db.update(usersTable).set(updates).where(eq(usersTable.id, user.id));
          }
        }
      } catch {
        // Non-fatal — sync is best-effort; will retry on the next request.
      }
    }
  }

  // Self-heal: ensure the admin account always has role=admin regardless of
  // how they log in (email+password or Google OAuth) and in both dev/prod.
  const isAdmin =
    adminClerkIdSet.has(clerkId) ||
    (resolvedEmail != null && resolvedEmail === adminEmail);

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
