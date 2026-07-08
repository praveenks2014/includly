import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db, professionalProfilesTable, professionalOfferingsTable, professionalVerticalEnum } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import {
  getVerificationRequirementsForOffering,
  recomputeSubmissionStatusForOffering,
  type VerificationVertical,
} from "../lib/verificationRequirements";

const router: IRouter = Router();

const VERTICALS = professionalVerticalEnum.enumValues;

const CreateOfferingBody = z.object({
  vertical: z.enum(VERTICALS),
});

const UpdateOfferingBody = z.object({
  verticalDetails: z.record(z.string(), z.unknown()).optional(),
  pricingMinINR: z.number().int().nonnegative().optional(),
  pricingMaxINR: z.number().int().nonnegative().optional(),
  rciCrrNumber: z.string().optional(),
});

async function getMyProfile(userId: number) {
  const [profile] = await db
    .select()
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.userId, userId));
  return profile ?? null;
}

/** GET /professionals/me/offerings — primary (profile row) + any additional offerings. */
router.get("/professionals/me/offerings", requireAuth, requireRole("professional"), async (req, res): Promise<void> => {
  const profile = await getMyProfile(req.userId!);
  if (!profile) {
    res.status(404).json({ error: "Professional profile not found" });
    return;
  }

  const extra = await db
    .select()
    .from(professionalOfferingsTable)
    .where(eq(professionalOfferingsTable.professionalId, profile.id));

  const offerings = [
    {
      isPrimary: true,
      vertical: profile.vertical,
      verticalDetails: profile.verticalDetails,
      pricingMinINR: profile.pricingMinINR,
      pricingMaxINR: profile.pricingMaxINR,
      rciCrrNumber: profile.rciCrrNumber,
      verificationStatus: profile.verificationStatus,
      isVerified: profile.isVerified,
      rejectionReason: profile.rejectionReason,
    },
    ...extra.map((o) => ({
      isPrimary: false,
      vertical: o.vertical,
      verticalDetails: o.verticalDetails,
      pricingMinINR: o.pricingMinINR,
      pricingMaxINR: o.pricingMaxINR,
      rciCrrNumber: o.rciCrrNumber,
      verificationStatus: o.verificationStatus,
      isVerified: o.isVerified,
      rejectionReason: o.rejectionReason,
    })),
  ];

  res.json({ offerings });
});

/** POST /professionals/me/offerings — add an ADDITIONAL vertical (not the primary one). */
router.post("/professionals/me/offerings", requireAuth, requireRole("professional"), async (req, res): Promise<void> => {
  const parsed = CreateOfferingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const profile = await getMyProfile(req.userId!);
  if (!profile) {
    res.status(404).json({ error: "Professional profile not found" });
    return;
  }

  const { vertical } = parsed.data;

  if (vertical === profile.vertical) {
    res.status(400).json({ error: "This is already your primary offering" });
    return;
  }

  const [existing] = await db
    .select({ id: professionalOfferingsTable.id })
    .from(professionalOfferingsTable)
    .where(
      and(
        eq(professionalOfferingsTable.professionalId, profile.id),
        eq(professionalOfferingsTable.vertical, vertical),
      ),
    );

  if (existing) {
    res.status(400).json({ error: "You already have this offering" });
    return;
  }

  const [offering] = await db
    .insert(professionalOfferingsTable)
    .values({ professionalId: profile.id, vertical })
    .returning();

  res.status(201).json(offering);
});

/** PATCH /professionals/me/offerings/:vertical — update pricing / vertical-specific details for ONE offering. */
router.patch("/professionals/me/offerings/:vertical", requireAuth, requireRole("professional"), async (req, res): Promise<void> => {
  const verticalRaw = Array.isArray(req.params.vertical) ? req.params.vertical[0] : req.params.vertical;
  if (!VERTICALS.includes(verticalRaw as VerificationVertical)) {
    res.status(400).json({ error: "Invalid vertical" });
    return;
  }
  const vertical = verticalRaw as VerificationVertical;

  const parsed = UpdateOfferingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const profile = await getMyProfile(req.userId!);
  if (!profile) {
    res.status(404).json({ error: "Professional profile not found" });
    return;
  }

  const { verticalDetails: incomingVd, pricingMinINR, pricingMaxINR, rciCrrNumber } = parsed.data;

  if (vertical === profile.vertical) {
    // Primary offering — same storage the existing single-vertical flow has
    // always used. Deep-merge verticalDetails exactly like PATCH /professionals/me.
    const updateData: Record<string, unknown> = {};
    if (incomingVd !== undefined) {
      const existingVd = (profile.verticalDetails ?? {}) as Record<string, unknown>;
      updateData.verticalDetails = { ...existingVd, ...incomingVd };
    }
    if (pricingMinINR !== undefined) updateData.pricingMinINR = pricingMinINR;
    if (pricingMaxINR !== undefined) updateData.pricingMaxINR = pricingMaxINR;
    if (rciCrrNumber !== undefined) updateData.rciCrrNumber = rciCrrNumber;

    const [updated] = await db
      .update(professionalProfilesTable)
      .set(updateData)
      .where(eq(professionalProfilesTable.id, profile.id))
      .returning();

    if (rciCrrNumber !== undefined) {
      await recomputeSubmissionStatusForOffering(profile.id, vertical);
    }

    res.json({ isPrimary: true, ...updated });
    return;
  }

  const [existingOffering] = await db
    .select()
    .from(professionalOfferingsTable)
    .where(
      and(
        eq(professionalOfferingsTable.professionalId, profile.id),
        eq(professionalOfferingsTable.vertical, vertical),
      ),
    );

  if (!existingOffering) {
    res.status(404).json({ error: "Offering not found — create it first via POST /professionals/me/offerings" });
    return;
  }

  const updateData: Record<string, unknown> = {};
  if (incomingVd !== undefined) {
    const existingVd = (existingOffering.verticalDetails ?? {}) as Record<string, unknown>;
    updateData.verticalDetails = { ...existingVd, ...incomingVd };
  }
  if (pricingMinINR !== undefined) updateData.pricingMinINR = pricingMinINR;
  if (pricingMaxINR !== undefined) updateData.pricingMaxINR = pricingMaxINR;
  if (rciCrrNumber !== undefined) updateData.rciCrrNumber = rciCrrNumber;

  const [updated] = await db
    .update(professionalOfferingsTable)
    .set(updateData)
    .where(eq(professionalOfferingsTable.id, existingOffering.id))
    .returning();

  if (rciCrrNumber !== undefined) {
    await recomputeSubmissionStatusForOffering(profile.id, vertical);
  }

  res.json({ isPrimary: false, ...updated });
});

/** GET /professionals/me/offerings/:vertical/requirements — what's missing before this offering is listable. */
router.get("/professionals/me/offerings/:vertical/requirements", requireAuth, requireRole("professional"), async (req, res): Promise<void> => {
  const verticalRaw = Array.isArray(req.params.vertical) ? req.params.vertical[0] : req.params.vertical;
  if (!VERTICALS.includes(verticalRaw as VerificationVertical)) {
    res.status(400).json({ error: "Invalid vertical" });
    return;
  }

  const profile = await getMyProfile(req.userId!);
  if (!profile) {
    res.status(404).json({ error: "Professional profile not found" });
    return;
  }

  const requirements = await getVerificationRequirementsForOffering(profile.id, verticalRaw as VerificationVertical);
  res.json(requirements);
});

export default router;
