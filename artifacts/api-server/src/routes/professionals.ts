import { Router, type IRouter } from "express";
import { eq, and, gte, ilike, or, gt, lte, sql, desc, asc, arrayOverlaps, isNull, type SQL } from "drizzle-orm";
import { db, usersTable, professionalProfilesTable, contactUnlocksTable, specialtyEnum, professionalSubscriptionsTable } from "@workspace/db";
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

  if (parsed.data.specializationTags && parsed.data.specializationTags.length > 5) {
    res.status(400).json({ error: "A maximum of 5 specialization tags are allowed." });
    return;
  }

  // Enforce that only hands-on specialties may enable home visits (same allowlist as PATCH)
  const HOME_VISIT_SPECIALTIES = ["shadow_teacher", "special_tutor", "occupational_therapy", "speech_therapy"];
  if (parsed.data.offersHomeVisits === true && !HOME_VISIT_SPECIALTIES.includes(parsed.data.specialty)) {
    res.status(400).json({ error: "Home visits are only available for Shadow Teachers, Special Educators, Occupational Therapists, and Speech Therapists." });
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

  if (parsed.data.specializationTags && parsed.data.specializationTags.length > 5) {
    res.status(400).json({ error: "A maximum of 5 specialization tags are allowed." });
    return;
  }

  // Enforce home-visit specialty invariant
  const HOME_VISIT_SPECIALTIES = ["shadow_teacher", "special_tutor", "occupational_therapy", "speech_therapy"];
  const [existing] = await db
    .select({ specialty: professionalProfilesTable.specialty, offersHomeVisits: professionalProfilesTable.offersHomeVisits })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, req.userId!));

  if (parsed.data.offersHomeVisits === true) {
    // Reject explicit attempt to enable home visits on ineligible specialty
    const effectiveSpecialty = parsed.data.specialty ?? existing?.specialty;
    if (!effectiveSpecialty || !HOME_VISIT_SPECIALTIES.includes(effectiveSpecialty)) {
      res.status(400).json({ error: "Home visits are only available for Shadow Teachers, Special Educators, Occupational Therapists, and Speech Therapists." });
      return;
    }
  }

  // If specialty is changing to a non-eligible one while offersHomeVisits is currently true, auto-disable it
  const updateData = { ...parsed.data };
  if (
    parsed.data.specialty &&
    !HOME_VISIT_SPECIALTIES.includes(parsed.data.specialty) &&
    existing?.offersHomeVisits === true &&
    parsed.data.offersHomeVisits !== false
  ) {
    updateData.offersHomeVisits = false;
  }

  const [profile] = await db
    .update(professionalProfilesTable)
    .set(updateData)
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

  const { specialty, city, minExperience, minRating, willingToTravel, lat, lng, radiusKm, budgetMaxINR, tags, verifiedOnly, page, limit } = parsed.data;

  const pageNum = page ?? 1;
  const limitNum = limit ?? 20;
  const offsetNum = (pageNum - 1) * limitNum;

  const conditions: SQL<unknown>[] = [];

  // Only show approved (verified) profiles in public search — pending/rejected are invisible
  conditions.push(eq(professionalProfilesTable.verificationStatus, "verified"));

  if (verifiedOnly) {
    conditions.push(eq(professionalProfilesTable.isVerified, true));
  }

  if (tags) {
    const tagArray = tags.split(",").map((t) => t.trim()).filter(Boolean);
    if (tagArray.length > 0) {
      conditions.push(arrayOverlaps(professionalProfilesTable.specializationTags, tagArray));
    }
  }

  if (specialty) {
    conditions.push(eq(professionalProfilesTable.specialty, specialty as SpecialtyValue));
  }

  if (city) {
    const cityCondition = or(
      ilike(professionalProfilesTable.city, `%${city}%`),
      ilike(professionalProfilesTable.country, `%${city}%`),
    );
    if (cityCondition) conditions.push(cityCondition);
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

  // Compute isPremium dynamically from active subscription — prevents permanent boost after expiry
  const isPremiumLive = sql<boolean>`EXISTS (
    SELECT 1 FROM ${professionalSubscriptionsTable} ps
    WHERE ps.professional_id = ${professionalProfilesTable.id}
      AND ps.status = 'active'
      AND ps.expires_at > now()
  )`.as("is_premium_live");

  const orderByClauses = useGeo
    ? [sql`${isPremiumLive} DESC`, asc(distanceSql)]
    : [sql`${isPremiumLive} DESC`, desc(professionalProfilesTable.id)];

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
      displayArea: professionalProfilesTable.displayArea,
      offersHomeVisits: professionalProfilesTable.offersHomeVisits,
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
      isPremium: isPremiumLive,
      specializationTags: professionalProfilesTable.specializationTags,
      distanceKm: distanceSql,
    })
    .from(professionalProfilesTable)
    .where(whereClause)
    .orderBy(...orderByClauses)
    .limit(limitNum)
    .offset(offsetNum);

  const unlockSet = new Set<number>();
  if (req.userId) {
    const unlocks = await db
      .select()
      .from(contactUnlocksTable)
      .where(
        and(
          eq(contactUnlocksTable.parentId, req.userId),
          or(isNull(contactUnlocksTable.expiresAt), gt(contactUnlocksTable.expiresAt, new Date())),
        ),
      );
    unlocks.forEach((u) => unlockSet.add(u.professionalId));
  }

  const results = paginated.map((p) => {
    const isUnlocked = unlockSet.has(p.id);
    return {
      id: p.id,
      userId: p.userId,
      fullName: p.fullName,
      specialty: p.specialty,
      bio: p.bio,
      yearsExperience: p.yearsExperience,
      city: p.city,
      country: p.country,
      displayArea: p.displayArea ?? null,
      offersHomeVisits: p.offersHomeVisits,
      // Coordinates intentionally excluded from search response (pre-booking privacy)
      // Server-side geo filtering still uses exact coordinates internally
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
      isPremium: p.isPremium,
      specializationTags: p.specializationTags ?? [],
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

  // Gate unapproved profiles — only admins can view pending/rejected profiles publicly
  if (profile.verificationStatus !== "verified" && req.userRole !== "admin") {
    res.status(404).json({ error: "Professional not found" });
    return;
  }

  // Only increment views for approved profiles (admin previews don't count)
  if (profile.verificationStatus === "verified") {
    await db
      .update(professionalProfilesTable)
      .set({ totalViews: (profile.totalViews ?? 0) + 1 })
      .where(eq(professionalProfilesTable.id, profile.id));
  }

  let isUnlocked = false;
  if (req.userId) {
    const [unlock] = await db
      .select()
      .from(contactUnlocksTable)
      .where(
        and(
          eq(contactUnlocksTable.parentId, req.userId),
          eq(contactUnlocksTable.professionalId, profile.id),
          or(isNull(contactUnlocksTable.expiresAt), gt(contactUnlocksTable.expiresAt, new Date())),
        ),
      );
    isUnlocked = !!unlock;
  }

  // Compute isPremium from active subscription — prevents permanent boost after expiry/cancel
  const [activeProfSub] = await db
    .select({ id: professionalSubscriptionsTable.id })
    .from(professionalSubscriptionsTable)
    .where(
      and(
        eq(professionalSubscriptionsTable.professionalId, profile.id),
        eq(professionalSubscriptionsTable.status, "active"),
        gt(professionalSubscriptionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const isPremiumLive = !!activeProfSub;

  const { upiId: _upiId, latitude: _lat, longitude: _lng, clinicAddress: _clinicAddress, ...safeProfile } = profile;
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
    isPremium: isPremiumLive,
    specializationTags: profile.specializationTags ?? [],
    displayArea: profile.displayArea ?? null,
    offersHomeVisits: profile.offersHomeVisits,
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

router.post("/professionals/me/free-activate", requireAuth, requireRole("professional"), async (req, res): Promise<void> => {
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
