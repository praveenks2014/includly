import type { Request, Response, NextFunction } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
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
 * Derive the Clerk FAPI base URL from the publishable key.
 * Format: pk_live_<base64> or pk_test_<base64>
 * The base64 decodes to "<fapi-host>$"
 */
function getFapiUrl(): string {
  const pk =
    process.env.VITE_CLERK_PK ?? process.env.CLERK_PUBLISHABLE_KEY ?? "";
  const base64Part = pk.replace(/^pk_(live|test)_/, "");
  try {
    const decoded = Buffer.from(base64Part, "base64").toString("utf8");
    const host = decoded.replace(/\$+$/, "");
    if (host) return `https://${host}`;
  } catch {
    // fall through
  }
  return "https://clerk.includly.in";
}

const fapiUrl = getFapiUrl();
const jwksUrl = `${fapiUrl}/.well-known/jwks.json`;

console.log(`[requireAuth] Using JWKS URL: ${jwksUrl}`);

const JWKS = createRemoteJWKSet(new URL(jwksUrl));

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
 * Verify a Clerk JWT using the JWKS endpoint. Returns the Clerk user ID
 * (the `sub` claim) or null if verification fails.
 */
async function verifyClerkToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, JWKS);
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

  const user =
    inserted[0] ??
    (await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)))[0];

  if (!user) {
    res.status(500).json({ error: "Failed to resolve user" });
    return;
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
