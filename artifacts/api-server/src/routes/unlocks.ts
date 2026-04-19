import { Router, type IRouter } from "express";
import { eq, and, gt, gte, or, isNull } from "drizzle-orm";
import { db, contactUnlocksTable, professionalProfilesTable, adminSettingsTable, DEFAULT_CONTACT_LIMIT } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import {
  CheckUnlockStatusParams,
  CheckUnlockStatusResponse,
  GetMyUnlocksResponse,
  CreateUnlockBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

function blurContact(value: string | null | undefined): string {
  if (!value) return "••••••••••";
  if (value.includes("@")) {
    const [local, domain] = value.split("@");
    return `${local[0]}•••@${domain}`;
  }
  return value.slice(0, 3) + "•".repeat(value.length - 3);
}

async function hasUnlimitedAccess(userId: number): Promise<boolean> {
  const [unlock] = await db
    .select({ id: contactUnlocksTable.id })
    .from(contactUnlocksTable)
    .where(
      and(
        eq(contactUnlocksTable.parentId, userId),
        isNull(contactUnlocksTable.expiresAt),
      ),
    )
    .limit(1);
  return !!unlock;
}

async function getContactLimit(): Promise<number> {
  try {
    const [settings] = await db
      .select({ contactLimitPerParent: adminSettingsTable.contactLimitPerParent })
      .from(adminSettingsTable)
      .limit(1);
    if (settings && settings.contactLimitPerParent > 0) {
      return settings.contactLimitPerParent;
    }
  } catch {
  }
  return DEFAULT_CONTACT_LIMIT;
}

function getMonthBounds(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
}

router.get("/contacts/usage", requireAuth, requireRole("parent", "admin"), async (req, res): Promise<void> => {
  const { start, end } = getMonthBounds();
  const limit = await getContactLimit();

  const unlocks = await db
    .select({ id: contactUnlocksTable.id })
    .from(contactUnlocksTable)
    .where(
      and(
        eq(contactUnlocksTable.parentId, req.userId!),
        gte(contactUnlocksTable.unlockedAt, start),
      ),
    );

  const used = unlocks.length;
  const now = new Date();
  const activeUnlocks = await db
    .select({ expiresAt: contactUnlocksTable.expiresAt })
    .from(contactUnlocksTable)
    .where(
      and(
        eq(contactUnlocksTable.parentId, req.userId!),
        or(
          isNull(contactUnlocksTable.expiresAt),
          gt(contactUnlocksTable.expiresAt, now),
        ),
      ),
    );

  const hasUnlimited = await hasUnlimitedAccess(req.userId!);
  const nearestExpiry = activeUnlocks
    .map((u) => u.expiresAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  res.json({
    used,
    limit,
    resetsAt: end.toISOString(),
    hasActiveSubscription: hasUnlimited,
    activeUnlockCount: activeUnlocks.length,
    nearestExpiryAt: nearestExpiry ? nearestExpiry.toISOString() : null,
  });
});

router.get("/unlocks/check/:professionalId", requireAuth, requireRole("parent", "admin"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.professionalId) ? req.params.professionalId[0] : req.params.professionalId;
  const params = CheckUnlockStatusParams.safeParse({ professionalId: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Check for an active teacher-scoped unlock:
  // - Plan B unlocks have no expiry (expiresAt IS NULL) and are permanent
  // - Plan A unlocks have expiresAt set (30-day access per teacher)
  const now = new Date();
  const [unlock] = await db
    .select()
    .from(contactUnlocksTable)
    .where(
      and(
        eq(contactUnlocksTable.parentId, req.userId!),
        eq(contactUnlocksTable.professionalId, params.data.professionalId),
        or(
          isNull(contactUnlocksTable.expiresAt),
          gt(contactUnlocksTable.expiresAt, now),
        ),
      ),
    );

  res.json(
    CheckUnlockStatusResponse.parse({
      isUnlocked: !!unlock,
      unlockedAt: unlock?.unlockedAt?.toISOString() ?? null,
    }),
  );
});

router.get("/unlocks", requireAuth, requireRole("parent", "admin"), async (req, res): Promise<void> => {
  const unlocks = await db
    .select({
      id: contactUnlocksTable.id,
      parentId: contactUnlocksTable.parentId,
      professionalId: contactUnlocksTable.professionalId,
      unlockedAt: contactUnlocksTable.unlockedAt,
      professional: professionalProfilesTable,
    })
    .from(contactUnlocksTable)
    .leftJoin(
      professionalProfilesTable,
      eq(contactUnlocksTable.professionalId, professionalProfilesTable.id),
    )
    .where(eq(contactUnlocksTable.parentId, req.userId!));

  const result = unlocks.map((u) => {
    const p = u.professional;
    return {
      id: u.id,
      parentId: u.parentId,
      professionalId: u.professionalId,
      unlockedAt: u.unlockedAt,
      professional: p
        ? {
            id: p.id,
            userId: p.userId,
            fullName: p.fullName,
            specialty: p.specialty,
            bio: p.bio,
            yearsExperience: p.yearsExperience,
            city: p.city,
            country: p.country,
            travelRadiusKm: p.travelRadiusKm,
            willingToTravel: p.willingToTravel,
            isVerified: p.isVerified,
            verificationStatus: p.verificationStatus,
            averageRating: p.averageRating,
            totalRatings: p.totalRatings,
            phoneBlurred: blurContact(p.phone),
            emailBlurred: blurContact(p.email),
            isUnlocked: true,
            phone: p.phone,
            email: p.email,
          }
        : null,
    };
  });

  res.json(GetMyUnlocksResponse.parse(result));
});

router.post("/unlocks", requireAuth, requireRole("parent", "admin"), async (req, res): Promise<void> => {
  const parsed = CreateUnlockBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { professionalId } = parsed.data;

  const [existing] = await db
    .select()
    .from(contactUnlocksTable)
    .where(
      and(
        eq(contactUnlocksTable.parentId, req.userId!),
        eq(contactUnlocksTable.professionalId, professionalId),
      ),
    );

  if (existing) {
    res.status(400).json({ error: "Contact already unlocked" });
    return;
  }

  const hasSub = await hasUnlimitedAccess(req.userId!);
  if (!hasSub) {
    res.status(402).json({
      error: "Payment required",
      code: "PAYMENT_REQUIRED",
      pricingUrl: "/pricing",
    });
    return;
  }

  const [unlock] = await db
    .insert(contactUnlocksTable)
    .values({
      parentId: req.userId!,
      professionalId,
    })
    .returning();

  const [prof] = await db
    .select()
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, professionalId));

  if (prof) {
    await db
      .update(professionalProfilesTable)
      .set({ totalUnlocks: (prof.totalUnlocks ?? 0) + 1 })
      .where(eq(professionalProfilesTable.id, professionalId));
  }

  const profWithUnlock = prof
    ? {
        id: prof.id,
        userId: prof.userId,
        fullName: prof.fullName,
        specialty: prof.specialty,
        bio: prof.bio,
        yearsExperience: prof.yearsExperience,
        city: prof.city,
        country: prof.country,
        travelRadiusKm: prof.travelRadiusKm,
        willingToTravel: prof.willingToTravel,
        isVerified: prof.isVerified,
        verificationStatus: prof.verificationStatus,
        averageRating: prof.averageRating,
        totalRatings: prof.totalRatings,
        phoneBlurred: blurContact(prof.phone),
        emailBlurred: blurContact(prof.email),
        isUnlocked: true,
        phone: prof.phone,
        email: prof.email,
      }
    : null;

  res.status(201).json({
    id: unlock!.id,
    parentId: unlock!.parentId,
    professionalId: unlock!.professionalId,
    unlockedAt: unlock!.unlockedAt,
    professional: profWithUnlock,
  });
});

export { getContactLimit, getMonthBounds };
export default router;
