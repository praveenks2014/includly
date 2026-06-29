import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
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

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { userId: clerkId } = getAuth(req);

  if (!clerkId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.clerkId = clerkId;

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
  const { userId: clerkId } = getAuth(req);

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

  next();
};
