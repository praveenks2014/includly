import { Router, type IRouter } from "express";
import { eq, count, gt, and } from "drizzle-orm";
import { db, usersTable, professionalProfilesTable, ratingsTable, contactUnlocksTable, professionalSubscriptionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import {
  GetParentDashboardResponse,
  GetProfessionalDashboardResponse,
  GetPlatformStatsResponse,
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

router.get("/dashboard/parent", requireAuth, async (req, res): Promise<void> => {
  const unlocks = await db
    .select({
      id: contactUnlocksTable.id,
      parentId: contactUnlocksTable.parentId,
      professionalId: contactUnlocksTable.professionalId,
      unlockedAt: contactUnlocksTable.unlockedAt,
      professional: professionalProfilesTable,
    })
    .from(contactUnlocksTable)
    .innerJoin(
      professionalProfilesTable,
      and(
        eq(contactUnlocksTable.professionalId, professionalProfilesTable.id),
        eq(professionalProfilesTable.verificationStatus, "verified"),
      ),
    )
    .where(eq(contactUnlocksTable.parentId, req.userId!))
    .limit(5);

  const recentUnlocks = unlocks.map((u) => {
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

  const [totalResult] = await db
    .select({ count: count() })
    .from(contactUnlocksTable)
    .where(eq(contactUnlocksTable.parentId, req.userId!));

  res.json(
    GetParentDashboardResponse.parse({
      totalUnlocks: Number(totalResult?.count ?? 0),
      recentUnlocks,
      hasActiveSubscription: false,
      subscriptionExpiresAt: null,
    }),
  );
});

router.get("/dashboard/professional", requireAuth, async (req, res): Promise<void> => {
  const [profile] = await db
    .select()
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, req.userId!));

  if (!profile) {
    res.status(404).json({ error: "Professional profile not found" });
    return;
  }

  // Compute isPremium live from active professional subscription — never trust stored flag
  // Must check both status='active' AND expiresAt > now (consistent with search/profile routes)
  const now = new Date();
  const [activeSub] = await db
    .select({ id: professionalSubscriptionsTable.id })
    .from(professionalSubscriptionsTable)
    .where(
      and(
        eq(professionalSubscriptionsTable.professionalId, profile.id),
        eq(professionalSubscriptionsTable.status, "active"),
        gt(professionalSubscriptionsTable.expiresAt, now),
      ),
    )
    .limit(1);

  const isPremiumLive = !!activeSub;

  const recentRatings = await db
    .select()
    .from(ratingsTable)
    .where(eq(ratingsTable.professionalId, profile.id))
    .limit(5);

  res.json(
    GetProfessionalDashboardResponse.parse({
      profile: { ...profile, isPremium: isPremiumLive },
      totalViews: profile.totalViews ?? 0,
      totalUnlocks: profile.totalUnlocks ?? 0,
      averageRating: profile.averageRating,
      totalRatings: profile.totalRatings,
      recentRatings,
    }),
  );
});

router.get("/dashboard/stats", async (_req, res): Promise<void> => {
  const [profCount] = await db.select({ count: count() }).from(professionalProfilesTable);
  const [parentCount] = await db
    .select({ count: count() })
    .from(usersTable)
    .where(eq(usersTable.role, "parent"));
  const [ratingsCount] = await db.select({ count: count() }).from(ratingsTable);
  const [verifiedCount] = await db
    .select({ count: count() })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.isVerified, true));

  const allProfs = await db.select({ specialty: professionalProfilesTable.specialty }).from(professionalProfilesTable);

  const specialtyCounts: Record<string, number> = {};
  for (const prof of allProfs) {
    const key = prof.specialty;
    specialtyCounts[key] = (specialtyCounts[key] ?? 0) + 1;
  }

  res.json(
    GetPlatformStatsResponse.parse({
      totalProfessionals: Number(profCount?.count ?? 0),
      totalParents: Number(parentCount?.count ?? 0),
      totalRatings: Number(ratingsCount?.count ?? 0),
      specialtyCounts,
      verifiedCount: Number(verifiedCount?.count ?? 0),
    }),
  );
});

export default router;
