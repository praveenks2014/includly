import { Router, type IRouter } from "express";
import { eq, and, gte, ilike, or, gt, lte, sql, desc, asc, arrayOverlaps, notInArray, isNotNull, inArray, type SQL } from "drizzle-orm";
import Razorpay from "razorpay";
import crypto from "crypto";
import { db, usersTable, professionalProfilesTable, adminSettingsTable, specialtyEnum, coachingSubTypeEnum, professionalSubscriptionsTable, professionalCertificationsTable, identityVerificationsTable, contactUnlocksTable, shadowTeacherEngagementsTable, shadowTeacherMatchesTable } from "@workspace/db";
import { requireAuth, optionalAuth, requireRole } from "../middlewares/requireAuth";
import { notifyParentsOnProfileUpdate } from "../lib/notificationService";
import { getClerkPrimaryEmail } from "../lib/clerkUser";
import { recomputeSubmissionStatus, RCI_CERTIFICATE_DOC_TYPE } from "../lib/verificationRequirements";
import { onProfessionalBecameEligible } from "../lib/candidateRefresh";
import {
  GetMyProfessionalProfileResponse,
  CreateProfessionalProfileBody,
  UpdateProfessionalProfileBody,
  UpdateProfessionalProfileResponse,
  GetProfessionalParams,
  GetProfessionalResponse,
  SearchProfessionalsQueryParams,
  SearchProfessionalsResponse,
  CreateUpiVerificationOrderResponse,
  ConfirmUpiVerificationBody,
  ConfirmUpiVerificationResponse,
} from "@workspace/api-zod";

function getRazorpay(): Razorpay | null {
  const keyId = process.env["RAZORPAY_KEY_ID"];
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keyId || !keySecret) return null;
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

type SpecialtyValue = (typeof specialtyEnum.enumValues)[number];
type CoachingSubTypeValue = (typeof coachingSubTypeEnum.enumValues)[number];

const router: IRouter = Router();

function blurContact(value: string | null | undefined): string {
  if (!value) return "••••••••••";
  if (value.includes("@")) {
    const [local, domain] = value.split("@");
    return `${local[0]}•••@${domain}`;
  }
  return value.slice(0, 3) + "•".repeat(value.length - 3);
}

router.get("/settings/public", async (_req, res): Promise<void> => {
  const [settings] = await db.select().from(adminSettingsTable).limit(1);
  res.json({
    matchingFeeInr: settings?.matchingFeeInr ?? 500,
    matchingFeeRefundable: settings?.matchingFeeRefundable ?? true,
  });
});

type VerticalValue = "shadow_teacher" | "home_tutor" | "therapist";

function computeProfileComplete(profile: {
  fullName: string | null | undefined;
  vertical: VerticalValue;
  verticalDetails: unknown;
  rciCrrNumber: string | null | undefined;
}): boolean {
  if (!profile.fullName) return false;
  const vd = (profile.verticalDetails ?? {}) as Record<string, unknown>;
  const arr = (k: string) => Array.isArray(vd[k]) && (vd[k] as unknown[]).length > 0;
  switch (profile.vertical) {
    case "shadow_teacher":
      return !!(vd.highestEducation && arr("conditionsSupported") && arr("settings") && arr("gradeLevels"));
    case "home_tutor":
      return !!(arr("subjects") && arr("boards") && arr("gradeLevels"));
    case "therapist":
      return !!(
        vd.discipline &&
        vd.rciRegistered === true &&
        profile.rciCrrNumber &&
        arr("conditionsTreated")
      );
    default:
      return false;
  }
}

router.get("/professionals/me", requireAuth, async (req, res): Promise<void> => {
  let [profile] = await db
    .select()
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, req.userId!));

  if (!profile) {
    res.status(404).json({ error: "Professional profile not found" });
    return;
  }

  // Keep the profile's email in lockstep with the professional's Clerk login email —
  // fixes drift for profiles created/edited before this was enforced server-side.
  const clerkEmail = await getClerkPrimaryEmail(req.clerkId!);
  if (clerkEmail && clerkEmail !== profile.email) {
    const [synced] = await db
      .update(professionalProfilesTable)
      .set({ email: clerkEmail })
      .where(eq(professionalProfilesTable.id, profile.id))
      .returning();
    if (synced) profile = synced;
  }

  const profileComplete = computeProfileComplete(profile);
  res.json(GetMyProfessionalProfileResponse.parse({ ...profile, profileComplete }));
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

  // Enforce that only hands-on specialties may enable home visits
  const HOME_VISIT_SPECIALTIES = ["shadow_teacher", "special_tutor", "occupational_therapy", "speech_therapy", "coaching"];
  if (parsed.data.offersHomeVisits === true && !HOME_VISIT_SPECIALTIES.includes(parsed.data.specialty)) {
    res.status(400).json({ error: "Home visits are only available for Shadow Teachers, Special Educators, Occupational Therapists, Speech Therapists, and Coaches." });
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

  // Ignore any client-submitted email — the profile email always mirrors the
  // professional's Clerk login identity so it can't be spoofed via the API.
  const { email: _clientEmail, ...createData } = parsed.data;
  const clerkEmail = await getClerkPrimaryEmail(req.clerkId!);

  const [profile] = await db
    .insert(professionalProfilesTable)
    .values({
      userId: req.userId!,
      vertical: "shadow_teacher" as const,
      ...createData,
      email: clerkEmail,
    })
    .returning();

  const profileComplete = computeProfileComplete(profile);
  res.status(201).json(GetMyProfessionalProfileResponse.parse({ ...profile, profileComplete }));
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
  const HOME_VISIT_SPECIALTIES = ["shadow_teacher", "special_tutor", "occupational_therapy", "speech_therapy", "coaching"];
  const [existing] = await db
    .select({
      specialty: professionalProfilesTable.specialty,
      vertical: professionalProfilesTable.vertical,
      qualifications: professionalProfilesTable.qualifications,
      rciCrrNumber: professionalProfilesTable.rciCrrNumber,
      specializationTags: professionalProfilesTable.specializationTags,
      clinicAddress: professionalProfilesTable.clinicAddress,
      offersHomeVisits: professionalProfilesTable.offersHomeVisits,
      verticalDetails: professionalProfilesTable.verticalDetails,
      verificationStatus: professionalProfilesTable.verificationStatus,
    })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, req.userId!));

  if (parsed.data.offersHomeVisits === true) {
    const effectiveSpecialty = parsed.data.specialty ?? existing?.specialty;
    if (!effectiveSpecialty || !HOME_VISIT_SPECIALTIES.includes(effectiveSpecialty)) {
      res.status(400).json({ error: "Home visits are only available for Shadow Teachers, Special Educators, Occupational Therapists, Speech Therapists, and Coaches." });
      return;
    }
  }

  const { avatarUrl, verticalDetails: incomingVd, email: _clientEmail, ...profileData } = parsed.data;
  const updateData: typeof profileData & { offersHomeVisits?: boolean; verticalDetails?: unknown; email?: string; verificationStatus?: "pending"; clinicAddress?: string | null; pendingClinicAddress?: string | null; addressReviewStatus?: null } = { ...profileData };

  // Ignore any client-submitted email — always resync to the Clerk login email.
  const clerkEmail = await getClerkPrimaryEmail(req.clerkId!);
  if (clerkEmail) {
    updateData.email = clerkEmail;
  }

  // Auto-disable home visits if specialty is changing to ineligible
  if (
    parsed.data.specialty &&
    !HOME_VISIT_SPECIALTIES.includes(parsed.data.specialty) &&
    existing?.offersHomeVisits === true &&
    parsed.data.offersHomeVisits !== false
  ) {
    updateData.offersHomeVisits = false;
  }

  // Deep-merge verticalDetails so per-screen saves don't wipe earlier screens
  if (incomingVd !== undefined) {
    const existingVd = (existing?.verticalDetails ?? {}) as Record<string, unknown>;
    updateData.verticalDetails = { ...existingVd, ...(incomingVd as Record<string, unknown>) };
  }

  // Core-credential re-verification gate: once a profile is verified, a
  // change to any field the original review actually depended on
  // (specialty/vertical/qualifications/rciCrrNumber/verticalDetails/
  // specializationTags) re-enters the admin review queue. A resubmission
  // of the SAME value (e.g. a form re-save) must not trigger this — only
  // an actual value change does, hence the equality checks below rather
  // than "was this key present in the request".
  const jsonDiffers = (a: unknown, b: unknown): boolean => JSON.stringify(a) !== JSON.stringify(b);
  const coreCredentialChanged =
    (parsed.data.specialty !== undefined && parsed.data.specialty !== existing?.specialty) ||
    (parsed.data.vertical !== undefined && parsed.data.vertical !== existing?.vertical) ||
    (parsed.data.qualifications !== undefined && parsed.data.qualifications !== existing?.qualifications) ||
    (parsed.data.rciCrrNumber !== undefined && parsed.data.rciCrrNumber !== existing?.rciCrrNumber) ||
    (updateData.verticalDetails !== undefined && jsonDiffers(updateData.verticalDetails, existing?.verticalDetails ?? null)) ||
    (parsed.data.specializationTags !== undefined &&
      jsonDiffers([...parsed.data.specializationTags].sort(), [...(existing?.specializationTags ?? [])].sort()));

  if (coreCredentialChanged && existing?.verificationStatus === "verified") {
    updateData.verificationStatus = "pending";
  }

  // Held-pending address change — scoped to professionals who actually meet
  // a parent in person. offersHomeVisits is the best signal available today
  // for "has a walk-in/visited location" (there is no dedicated flag for
  // that); if one is ever added, it should take over this role instead.
  // clinicAddress itself is never used for search, matching, or distance
  // calculations (those use latitude/longitude) — only shown as a display
  // string once a booking is already confirmed — so an online-only
  // professional's address change is harmless and applies immediately.
  const effectiveOffersHomeVisits = updateData.offersHomeVisits ?? existing?.offersHomeVisits ?? false;

  const togglingHomeVisitsOn = parsed.data.offersHomeVisits === true && existing?.offersHomeVisits === false;

  if (existing?.verificationStatus === "verified" && effectiveOffersHomeVisits === true) {
    if (togglingHomeVisitsOn) {
      // Turning on in-person visits in THIS request — regardless of whether
      // clinicAddress is also being changed in the same request — means
      // whatever address ends up queued was never reviewed as a real,
      // visited location: it either predates this toggle (captured while
      // offersHomeVisits was false, when no admin had reason to scrutinize
      // it as a visit address) or is being submitted for the first time
      // right now. Either way the CURRENT live clinicAddress must not
      // remain visible during this review — unlike the branch below, there
      // is no already-vetted value to safely leave in place.
      const newAddressClaim = parsed.data.clinicAddress !== undefined ? parsed.data.clinicAddress : existing?.clinicAddress;
      if (newAddressClaim) {
        updateData.pendingClinicAddress = newAddressClaim;
        updateData.addressReviewStatus = null;
      }
      updateData.clinicAddress = null;
    } else if (
      parsed.data.clinicAddress !== undefined &&
      parsed.data.clinicAddress !== existing?.clinicAddress
    ) {
      // Already an in-person-visiting, verified professional: the CURRENT
      // live clinicAddress was already vetted (either at initial
      // verification or via a prior address-approve), so it's safe to leave
      // live while the NEW claim is reviewed — a fresh claim just
      // supersedes whatever review state an earlier queued address was in.
      updateData.pendingClinicAddress = parsed.data.clinicAddress;
      updateData.addressReviewStatus = null;
      delete updateData.clinicAddress;
    }
  }
  // else: either still online-only (clinicAddress applies directly, no
  // gating — profileData already carries it through untouched) or
  // pre-verification (normal onboarding review covers it).

  const [profile] = await db
    .update(professionalProfilesTable)
    .set(updateData)
    .where(eq(professionalProfilesTable.userId, req.userId!))
    .returning();

  if (avatarUrl !== undefined) {
    await db.update(usersTable).set({ avatarUrl }).where(eq(usersTable.id, req.userId!));
  }

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

  // rciCrrNumber (or other requirement-relevant fields) may have just been
  // set — recheck whether the profile now meets its vertical's requirements.
  if (parsed.data.rciCrrNumber !== undefined) {
    await recomputeSubmissionStatus(profile.id);
  }

  const profileComplete = computeProfileComplete(profile);
  res.json(UpdateProfessionalProfileResponse.parse({ ...profile, profileComplete }));
});

// ₹1 reverse-penny-drop UPI verification: create a UPI-only order for ₹1.
router.post("/professionals/me/upi-verification/order", requireAuth, requireRole("professional", "admin"), async (req, res): Promise<void> => {
  const [profile] = await db
    .select({ id: professionalProfilesTable.id })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, req.userId!));

  if (!profile) {
    res.status(404).json({ error: "Professional profile not found" });
    return;
  }

  const razorpay = getRazorpay();
  if (!razorpay) {
    res.status(503).json({ error: "Payments are not configured" });
    return;
  }

  const order = await razorpay.orders.create({
    amount: 100,
    currency: "INR",
    receipt: `upi_verify_${profile.id}_${Date.now()}`,
    notes: {
      purpose: "upi_verification",
      professionalId: String(profile.id),
      userId: String(req.userId),
    },
  });

  res.json(
    CreateUpiVerificationOrderResponse.parse({
      orderId: order.id,
      amount: 100,
      currency: "INR",
      keyId: process.env["RAZORPAY_KEY_ID"]!,
    }),
  );
});

// Confirm the ₹1 UPI verification payment: server-side fetch the payment entity from
// Razorpay (never trust a client-submitted VPA), save the verified VPA, then auto-refund.
router.post("/professionals/me/upi-verification/confirm", requireAuth, requireRole("professional", "admin"), async (req, res): Promise<void> => {
  const parsed = ConfirmUpiVerificationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { razorpayPaymentId, razorpayOrderId, razorpaySignature } = parsed.data;

  const [profile] = await db
    .select({ id: professionalProfilesTable.id })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, req.userId!));

  if (!profile) {
    res.status(404).json({ error: "Professional profile not found" });
    return;
  }

  const razorpay = getRazorpay();
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!razorpay || !keySecret) {
    res.status(503).json({ error: "Payments are not configured" });
    return;
  }

  const expectedSignature = crypto
    .createHmac("sha256", keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");
  if (expectedSignature !== razorpaySignature) {
    res.status(400).json({ error: "Invalid payment signature" });
    return;
  }

  type RazorpayOrderEntity = { notes?: Record<string, string> };
  type RazorpayPaymentEntity = {
    order_id?: string;
    status?: string;
    method?: string;
    amount?: number;
    vpa?: string;
    upi?: { vpa?: string };
  };

  let order: RazorpayOrderEntity;
  let payment: RazorpayPaymentEntity;
  try {
    order = (await razorpay.orders.fetch(razorpayOrderId)) as unknown as RazorpayOrderEntity;
    payment = (await razorpay.payments.fetch(razorpayPaymentId)) as unknown as RazorpayPaymentEntity;
  } catch (err) {
    console.error("[upi-verification] Razorpay fetch failed:", err);
    res.status(400).json({ error: "Unable to verify payment with Razorpay" });
    return;
  }

  if (order.notes?.["purpose"] !== "upi_verification" || order.notes?.["userId"] !== String(req.userId!)) {
    res.status(400).json({ error: "Order does not belong to this verification request" });
    return;
  }

  if (
    payment.order_id !== razorpayOrderId ||
    payment.status !== "captured" ||
    payment.method !== "upi" ||
    payment.amount !== 100
  ) {
    res.status(400).json({ error: "Payment could not be verified as a valid ₹1 UPI payment" });
    return;
  }

  const vpa = payment.vpa ?? payment.upi?.vpa;
  if (!vpa) {
    res.status(400).json({ error: "Could not read a UPI VPA from this payment" });
    return;
  }

  const upiVerifiedAt = new Date();
  const [updated] = await db
    .update(professionalProfilesTable)
    .set({ upiVpa: vpa, upiVerificationPaymentId: razorpayPaymentId, upiVerifiedAt })
    .where(eq(professionalProfilesTable.id, profile.id))
    .returning();

  // Best-effort auto-refund of the ₹1 verification charge — never block on failure,
  // the VPA is already saved and verified.
  try {
    await (razorpay.payments as unknown as { refund: (id: string, opts: Record<string, unknown>) => Promise<unknown> }).refund(
      razorpayPaymentId,
      { notes: { reason: "UPI verification refund" } },
    );
  } catch (err) {
    console.error("[upi-verification] Refund of ₹1 verification payment failed:", err);
  }

  res.json(
    ConfirmUpiVerificationResponse.parse({
      success: true,
      upiVpa: updated?.upiVpa ?? vpa,
      upiVerifiedAt: updated?.upiVerifiedAt ?? upiVerifiedAt,
      message: "UPI verified — your ₹1 has been refunded.",
    }),
  );
});

router.get("/professionals/search", optionalAuth, async (req, res): Promise<void> => {
  const parsed = SearchProfessionalsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { specialty, city, minExperience, minRating, willingToTravel, lat, lng, radiusKm, budgetMaxINR, tags, verifiedOnly, coachingSubType, inclusiveExperience, page, limit } = parsed.data;

  const pageNum = page ?? 1;
  const limitNum = limit ?? 20;
  const offsetNum = (pageNum - 1) * limitNum;

  const conditions: SQL<unknown>[] = [];

  // Only show approved (verified) profiles in public search — pending/rejected are invisible
  conditions.push(eq(professionalProfilesTable.verificationStatus, "verified"));
  // Only show activation-complete profiles (Stage 2 onboarding done)
  conditions.push(eq(professionalProfilesTable.paymentActivated, true));
  // Therapists must have a CRR number on file — prevents unlicensed profiles appearing in search
  conditions.push(sql`(${professionalProfilesTable.vertical} != 'therapist' OR (${professionalProfilesTable.rciCrrNumber} IS NOT NULL AND ${professionalProfilesTable.rciCrrNumber} != ''))`);
  // Defense-in-depth: every listed specialist must have a government ID on file, and
  // therapists must additionally have their RCI certificate on file. This is enforced
  // directly at query time (not just at admin-approval time) so that legacy/manually
  // mutated rows can never surface an under-verified specialist to parents.
  conditions.push(
    sql`EXISTS (SELECT 1 FROM ${identityVerificationsTable} iv WHERE iv.professional_id = ${professionalProfilesTable.id})`,
  );
  conditions.push(
    sql`(${professionalProfilesTable.vertical} != 'therapist' OR EXISTS (
      SELECT 1 FROM ${professionalCertificationsTable} pc
      WHERE pc.professional_id = ${professionalProfilesTable.id} AND pc.document_type = ${RCI_CERTIFICATE_DOC_TYPE}
    ))`,
  );

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

  if (coachingSubType) {
    conditions.push(eq(professionalProfilesTable.coachingSubType, coachingSubType as CoachingSubTypeValue));
  }

  if (inclusiveExperience) {
    conditions.push(eq(professionalProfilesTable.inclusiveExperience, true));
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

  // Exclude shadow teachers who already have an active (non-ended) engagement
  // or who are selected in an in-flight match (pre-engagement-creation)
  if (specialty === "shadow_teacher") {
    const engBusyRows = await db
      .select({ professionalId: shadowTeacherEngagementsTable.professionalId })
      .from(shadowTeacherEngagementsTable)
      .where(sql`${shadowTeacherEngagementsTable.status} != 'ended'`);

    const matchBusyRows = await db
      .select({ professionalId: shadowTeacherMatchesTable.selectedProfessionalId })
      .from(shadowTeacherMatchesTable)
      .where(and(
        isNotNull(shadowTeacherMatchesTable.selectedProfessionalId),
        inArray(shadowTeacherMatchesTable.status, [
          "pending_commitment",
          "trial_pending", "trial_started", "trial_done",
        ]),
      ));

    const busyIds = [...new Set([
      ...engBusyRows.map((r) => r.professionalId),
      ...matchBusyRows.map((r) => r.professionalId!),
    ])];
    if (busyIds.length > 0) {
      conditions.push(notInArray(professionalProfilesTable.id, busyIds));
    }
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
      coachingSubType: professionalProfilesTable.coachingSubType,
      inclusiveExperience: professionalProfilesTable.inclusiveExperience,
      distanceKm: distanceSql,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(professionalProfilesTable)
    .leftJoin(usersTable, eq(usersTable.id, professionalProfilesTable.userId))
    .where(whereClause)
    .orderBy(...orderByClauses)
    .limit(limitNum)
    .offset(offsetNum);

  const results = paginated.map((p) => {
    const isShadowTeacher = p.specialty === "shadow_teacher";
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
      phoneBlurred: isShadowTeacher ? null : blurContact(p.phone),
      emailBlurred: isShadowTeacher ? null : blurContact(p.email),
      isUnlocked: !isShadowTeacher,
      chatAccessOnly: false,
      phone: isShadowTeacher ? null : p.phone,
      email: isShadowTeacher ? null : p.email,
      distanceKm: p.distanceKm ?? null,
      pricingMinINR: p.pricingMinINR ?? null,
      pricingMaxINR: p.pricingMaxINR ?? null,
      paymentActivated: p.paymentActivated,
      isPremium: p.isPremium,
      specializationTags: p.specializationTags ?? [],
      coachingSubType: p.coachingSubType ?? null,
      inclusiveExperience: p.inclusiveExperience,
      avatarUrl: p.avatarUrl ?? null,
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

  const [userRow] = await db
    .select({ avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(eq(usersTable.id, profile.userId));

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

  const isShadowTeacher = profile.specialty === "shadow_teacher";

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

  const {
    upiId: _upiId,
    upiVpa: _upiVpa,
    upiVerificationPaymentId: _upiVerificationPaymentId,
    upiVerifiedAt: _upiVerifiedAt,
    latitude: _lat,
    longitude: _lng,
    clinicAddress: _clinicAddress,
    ...safeProfile
  } = profile;
  const result = {
    ...safeProfile,
    avatarUrl: userRow?.avatarUrl ?? null,
    phoneBlurred: isShadowTeacher ? null : blurContact(profile.phone),
    emailBlurred: isShadowTeacher ? null : blurContact(profile.email),
    isUnlocked: !isShadowTeacher,
    chatAccessOnly: false,
    phone: isShadowTeacher ? null : profile.phone,
    email: isShadowTeacher ? null : profile.email,
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

  try { await onProfessionalBecameEligible(profile.id); } catch { /* non-blocking */ }

  res.json({ message: "Profile activated (first month free)", paymentActivated: updated.paymentActivated });
});

router.get("/professionals/:id/certifications", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [profile] = await db
    .select({ verificationStatus: professionalProfilesTable.verificationStatus })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, id))
    .limit(1);

  if (!profile || profile.verificationStatus !== "verified") {
    res.json([]);
    return;
  }

  const certs = await db
    .select({
      id: professionalCertificationsTable.id,
      documentType: professionalCertificationsTable.documentType,
      uploadedAt: professionalCertificationsTable.uploadedAt,
    })
    .from(professionalCertificationsTable)
    .where(eq(professionalCertificationsTable.professionalId, id));

  res.json(certs.map((c) => ({ ...c, uploadedAt: c.uploadedAt.toISOString() })));
});

export default router;
