import { Router, type IRouter } from "express";
import { eq, and, gte, ilike, or, gt, lte, sql, desc, asc } from "drizzle-orm";
import { db, usersTable, professionalProfilesTable, contactUnlocksTable, specialtyEnum, professionalSubscriptionsTable } from "@workspace/db";
import { subscriptionsTable } from "@workspace/db";
import { requireAuth, optionalAuth, requireRole } from "../middlewares/requireAuth";
import { notifyParentsOnProfileUpdate } from "../lib/notificationService";
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

  const unlocks = await db
    .select({ parentId: contactUnlocksTable.parentId })
    .from(contactUnlocksTable)
    .where(eq(contactUnlocksTable.professionalId, profile.id));

  const parentIds = unlocks.map((u) => u.parentId);
  if (parentIds.length > 0) {
    void notifyParentsOnProfileUpdate(parentIds).catch(() => {});
  }

  res.json(UpdateProfessionalProfileResponse.parse(profile));
});

router.get("/professionals/search", optionalAuth, async (req, res): Promise<void> => {
  const parsed = SearchProfessionalsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { specialty, city, minExperience, minRating, willingToTravel, lat, lng, radiusKm, budgetMaxINR, page, limit } = parsed.data;

  const pageNum = page ?? 1;
  const limitNum = limit ?? 20;
  const offsetNum = (pageNum - 1) * limitNum;

  const conditions = [
    eq(professionalProfilesTable.verificationStatus, "verified"),
  ];

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

  if (minRating !== undefined) {
    conditions.push(gte(professionalProfilesTable.averageRating, minRating));
  }

  if (willingToTravel !== undefined) {
    conditions.push(eq(professionalProfilesTable.willingToTravel, willingToTravel));
  }

  if (budgetMaxINR !== undefined) {
    conditions.push(lte(professionalProfilesTable.pricingMinINR, budgetMaxINR));
  }

  const useGeo = lat !== undefined && lng !== undefined && radiusKm !== undefined;

  if (useGeo) {
    conditions.push(sql`${professionalProfilesTable.latitude} IS NOT NULL`);
    conditions.push(sql`${professionalProfilesTable.longitude} IS NOT NULL`);
    conditions.push(
      sql`6371 * acos(LEAST(1.0,
          cos(radians(${lat}::float8)) * cos(radians(${professionalProfilesTable.latitude}::float8)) *
          cos(radians(${professionalProfilesTable.longitude}::float8) - radians(${lng}::float8)) +
          sin(radians(${lat}::float8)) * sin(radians(${professionalProfilesTable.latitude}::float8))
        )) <= ${radiusKm}`,
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const distanceSql = useGeo
    ? sql<number | null>`ROUND((6371 * acos(LEAST(1.0,
          cos(radians(${lat}::float8)) * cos(radians(${professionalProfilesTable.latitude}::float8)) *
          cos(radians(${professionalProfilesTable.longitude}::float8) - radians(${lng}::float8)) +
          sin(radians(${lat}::float8)) * sin(radians(${professionalProfilesTable.latitude}::float8))
        )))::numeric, 1)::float8`.as("distance_km")
    : sql<number | null>`null`.as("distance_km");

  const [{ count: totalStr }] = await db
    .select({ count: sql<string>`count(*)` })
    .from(professionalProfilesTable)
    .where(whereClause);
  const total = parseInt(totalStr, 10);

  const orderByClauses = useGeo
    ? [asc(distanceSql)]
    : [desc(professionalProfilesTable.id)];

  const paginated = await db
    .select({
      id: professionalProfilesTable.id,
      userId: professionalProfilesTable.userId,
      fullName: professionalProfilesTable.fullName,
      specialty: professionalProfilesTable.specialty,
      bio: professionalProfilesTable.bio,
      yearsExperience: professionalProfilesTable.yearsExperience,
      city: professionalProfilesTable.city,
      country: professionalProfilesTable.country,
      latitude: professionalProfilesTable.latitude,
      longitude: professionalProfilesTable.longitude,
      travelRadiusKm: professionalProfilesTable.travelRadiusKm,
      willingToTravel: professionalProfilesTable.willingToTravel,
      isVerified: professionalProfilesTable.isVerified,
      verificationStatus: professionalProfilesTable.verificationStatus,
      averageRating: professionalProfilesTable.averageRating,
      totalRatings: professionalProfilesTable.totalRatings,
      phone: professionalProfilesTable.phone,
      email: professionalProfilesTable.email,
      pricingMinINR: professionalProfilesTable.pricingMinINR,
      pricingMaxINR: professionalProfilesTable.pricingMaxINR,
      paymentActivated: professionalProfilesTable.paymentActivated,
      distanceKm: distanceSql,
    })
    .from(professionalProfilesTable)
    .where(whereClause)
    .orderBy(...orderByClauses)
    .limit(limitNum)
    .offset(offsetNum);

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

  const { upiId: _upiId, ...safeProfile } = profile;
  const result = {
    ...safeProfile,
    phoneBlurred: blurContact(profile.phone),
    emailBlurred: blurContact(profile.email),
    isUnlocked,
    phone: isUnlocked ? profile.phone : null,
    email: isUnlocked ? profile.email : null,
    pricingMinINR: profile.pricingMinINR ?? null,
    pricingMaxINR: profile.pricingMaxINR ?? null,
    paymentActivated: profile.paymentActivated,
    upiId: null,
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

router.post("/professionals/me/free-activate", requireAuth, requireRole("professional"), async (req: Request, res: Response): Promise<void> => {
  const [profile] = await db
    .select()
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, req.userId!));

  if (!profile) {
    res.status(404).json({ error: "Professional profile not found" });
    return;
  }

  if (profile.paymentActivated) {
    res.json({ message: "Already activated", paymentActivated: true });
    return;
  }

  const [updated] = await db
    .update(professionalProfilesTable)
    .set({ paymentActivated: true, updatedAt: new Date() })
    .where(eq(professionalProfilesTable.id, profile.id))
    .returning();

  res.json({ message: "Profile activated (first month free)", paymentActivated: updated.paymentActivated });
});

export default router;
