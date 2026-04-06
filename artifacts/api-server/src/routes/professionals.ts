import { Router, type IRouter } from "express";
import { eq, and, gte, ilike, or, gt, lte } from "drizzle-orm";
import { db, usersTable, professionalProfilesTable, contactUnlocksTable, specialtyEnum, professionalSubscriptionsTable } from "@workspace/db";
import { subscriptionsTable } from "@workspace/db";
import { requireAuth, optionalAuth, requireRole } from "../middlewares/requireAuth";
import {
  GetMyProfessionalProfileResponse,
  CreateProfessionalProfileBody,
  UpdateProfessionalProfileBody,
  UpdateProfessionalProfileResponse,
  GetProfessionalParams,
  GetProfessionalResponse,
  SearchProfessionalsQueryParams,
  SearchProfessionalsResponse,
} from "@workspace/api-zod";

type SpecialtyValue = (typeof specialtyEnum.enumValues)[number];

const router: IRouter = Router();

function blurContact(value: string | null | undefined): string {
  if (!value) return "••••••••••";
  if (value.includes("@")) {
    const [local, domain] = value.split("@");
    return `${local[0]}•••@${domain}`;
  }
  return value.slice(0, 3) + "•".repeat(value.length - 3);
}

router.get("/professionals/me", requireAuth, async (req, res): Promise<void> => {
  const [profile] = await db
    .select()
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, req.userId!));

  if (!profile) {
    res.status(404).json({ error: "Professional profile not found" });
    return;
  }

  res.json(GetMyProfessionalProfileResponse.parse(profile));
});

router.post("/professionals/me", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateProfessionalProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await db
    .select()
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, req.userId!));

  if (existing.length > 0) {
    res.status(400).json({ error: "Professional profile already exists" });
    return;
  }

  await db.update(usersTable).set({ role: "professional" }).where(eq(usersTable.id, req.userId!));

  const [profile] = await db
    .insert(professionalProfilesTable)
    .values({
      userId: req.userId!,
      ...parsed.data,
    })
    .returning();

  res.status(201).json(GetMyProfessionalProfileResponse.parse(profile));
});

router.patch("/professionals/me", requireAuth, requireRole("professional", "admin"), async (req, res): Promise<void> => {
  const parsed = UpdateProfessionalProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [profile] = await db
    .update(professionalProfilesTable)
    .set(parsed.data)
    .where(eq(professionalProfilesTable.userId, req.userId!))
    .returning();

  if (!profile) {
    res.status(404).json({ error: "Professional profile not found" });
    return;
  }

  res.json(UpdateProfessionalProfileResponse.parse(profile));
});

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

router.get("/professionals/search", optionalAuth, async (req, res): Promise<void> => {
  const parsed = SearchProfessionalsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { specialty, city, minExperience, minRating, willingToTravel, lat, lng, radiusKm, budgetMaxINR, page, limit } = parsed.data;

  const conditions = [];

  if (specialty) {
    conditions.push(eq(professionalProfilesTable.specialty, specialty as SpecialtyValue));
  }

  if (city) {
    conditions.push(
      or(
        ilike(professionalProfilesTable.city, `%${city}%`),
        ilike(professionalProfilesTable.country, `%${city}%`),
      ),
    );
  }

  if (minExperience !== undefined) {
    conditions.push(gte(professionalProfilesTable.yearsExperience, minExperience));
  }

  if (willingToTravel !== undefined) {
    conditions.push(eq(professionalProfilesTable.willingToTravel, willingToTravel));
  }

  if (budgetMaxINR !== undefined) {
    conditions.push(
      and(
        lte(professionalProfilesTable.pricingMinINR, budgetMaxINR),
      ),
    );
  }

  const pageNum = page ?? 1;
  const limitNum = limit ?? 20;
  const offset = (pageNum - 1) * limitNum;

  const allProfiles = await db
    .select()
    .from(professionalProfilesTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  type ProfileWithDistance = (typeof allProfiles)[number] & { distanceKm: number | null };

  let filtered: ProfileWithDistance[] = allProfiles.map((p) => ({ ...p, distanceKm: null }));

  if (minRating !== undefined) {
    filtered = filtered.filter((p) => p.averageRating !== null && p.averageRating >= minRating);
  }

  if (lat !== undefined && lng !== undefined && radiusKm !== undefined) {
    filtered = filtered
      .map((p) => {
        if (p.latitude === null || p.latitude === undefined || p.longitude === null || p.longitude === undefined) {
          return null;
        }
        const dist = haversineKm(lat, lng, p.latitude, p.longitude);
        if (dist <= radiusKm) {
          return { ...p, distanceKm: Math.round(dist * 10) / 10 };
        }
        return null;
      })
      .filter((p): p is ProfileWithDistance => p !== null)
      .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
  }

  const total = filtered.length;
  const paginated = filtered.slice(offset, offset + limitNum);

  const unlockSet = new Set<number>();
  let hasActiveSubscription = false;
  if (req.userId) {
    const unlocks = await db
      .select()
      .from(contactUnlocksTable)
      .where(eq(contactUnlocksTable.parentId, req.userId));
    unlocks.forEach((u) => unlockSet.add(u.professionalId));

    const [activeSub] = await db
      .select()
      .from(subscriptionsTable)
      .where(
        and(
          eq(subscriptionsTable.userId, req.userId),
          eq(subscriptionsTable.status, "active"),
          gt(subscriptionsTable.expiresAt, new Date()),
        ),
      )
      .limit(1);
    hasActiveSubscription = !!activeSub;
  }

  const results = paginated.map((p) => {
    const isUnlocked = hasActiveSubscription || unlockSet.has(p.id);
    return {
      id: p.id,
      userId: p.userId,
      fullName: p.fullName,
      specialty: p.specialty,
      bio: p.bio,
      yearsExperience: p.yearsExperience,
      city: p.city,
      country: p.country,
      latitude: p.latitude ?? null,
      longitude: p.longitude ?? null,
      travelRadiusKm: p.travelRadiusKm,
      willingToTravel: p.willingToTravel,
      isVerified: p.isVerified,
      verificationStatus: p.verificationStatus,
      averageRating: p.averageRating,
      totalRatings: p.totalRatings,
      phoneBlurred: blurContact(p.phone),
      emailBlurred: blurContact(p.email),
      isUnlocked,
      phone: isUnlocked ? p.phone : null,
      email: isUnlocked ? p.email : null,
      distanceKm: p.distanceKm ?? null,
      pricingMinINR: p.pricingMinINR ?? null,
      pricingMaxINR: p.pricingMaxINR ?? null,
      paymentActivated: p.paymentActivated,
    };
  });

  res.json(
    SearchProfessionalsResponse.parse({
      professionals: results,
      total,
      page: pageNum,
      limit: limitNum,
    }),
  );
});

router.get("/professionals/:id", optionalAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetProfessionalParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [profile] = await db
    .select()
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, params.data.id));

  if (!profile) {
    res.status(404).json({ error: "Professional not found" });
    return;
  }

  await db
    .update(professionalProfilesTable)
    .set({ totalViews: (profile.totalViews ?? 0) + 1 })
    .where(eq(professionalProfilesTable.id, profile.id));

  let isUnlocked = false;
  if (req.userId) {
    const [activeSub] = await db
      .select()
      .from(subscriptionsTable)
      .where(
        and(
          eq(subscriptionsTable.userId, req.userId),
          eq(subscriptionsTable.status, "active"),
          gt(subscriptionsTable.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (activeSub) {
      isUnlocked = true;
    } else {
      const [unlock] = await db
        .select()
        .from(contactUnlocksTable)
        .where(
          and(
            eq(contactUnlocksTable.parentId, req.userId),
            eq(contactUnlocksTable.professionalId, profile.id),
          ),
        );
      isUnlocked = !!unlock;
    }
  }

  const result = {
    ...profile,
    phoneBlurred: blurContact(profile.phone),
    emailBlurred: blurContact(profile.email),
    isUnlocked,
    phone: isUnlocked ? profile.phone : null,
    email: isUnlocked ? profile.email : null,
    pricingMinINR: profile.pricingMinINR ?? null,
    pricingMaxINR: profile.pricingMaxINR ?? null,
    paymentActivated: profile.paymentActivated,
  };

  res.json(GetProfessionalResponse.parse(result));
});

router.get("/admin/professionals/billing", requireAuth, requireRole("admin"), async (_req, res): Promise<void> => {
  const profiles = await db
    .select()
    .from(professionalProfilesTable);

  const now = new Date();

  const results = await Promise.all(
    profiles.map(async (p) => {
      const [activeSub] = await db
        .select()
        .from(professionalSubscriptionsTable)
        .where(
          and(
            eq(professionalSubscriptionsTable.professionalId, p.id),
            eq(professionalSubscriptionsTable.status, "active"),
            gt(professionalSubscriptionsTable.expiresAt, now),
          ),
        )
        .limit(1);

      return {
        id: p.id,
        userId: p.userId,
        fullName: p.fullName,
        specialty: p.specialty,
        paymentActivated: p.paymentActivated,
        hasActiveMonthlySubscription: !!activeSub,
        monthlySubscriptionExpiresAt: activeSub ? activeSub.expiresAt.toISOString() : null,
      };
    }),
  );

  res.json({ professionals: results, total: results.length });
});

export default router;
