import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
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

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const auth = getAuth(req);
  const clerkId = auth?.userId;

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

  const user = inserted[0] ?? (
    await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId))
  )[0];

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
  const auth = getAuth(req);
  const clerkId = auth?.userId;

  if (clerkId) {
    req.clerkId = clerkId;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
    if (user) {
      req.userId = user.id;
      req.userRole = user.role as UserRole;
    }
  }

  next();
};
