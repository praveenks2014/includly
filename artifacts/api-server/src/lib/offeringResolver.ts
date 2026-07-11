import { eq, and } from "drizzle-orm";
import { db, professionalProfilesTable, professionalOfferingsTable } from "@workspace/db";

export type OfferingVertical = "shadow_teacher" | "home_tutor" | "therapist";

/**
 * THE single place that resolves "what are this offering's effective field
 * values" — whether the vertical is the professional's PRIMARY one (data on
 * professional_profiles) or an ADDITIONAL one (data on professional_offerings).
 *
 * Every feature that needs to read/branch on primary-vs-secondary storage
 * (verification gating, pricing in candidate surfacing, billing cadence,
 * listing-fee-paid) goes through this one function for single-professional
 * lookups — not a separate ad-hoc branch per feature. The one exception is
 * bulk candidate-surfacing queries (scoring hundreds of professionals at
 * once), which stay a SQL JOIN for performance — those use
 * buildOfferingListabilityCondition() below instead, which encodes the SAME
 * logical rule as a reusable Drizzle condition rather than a per-row call.
 */
export interface ResolvedOffering {
  isPrimary: boolean;
  offeringId: number | null; // null when isPrimary — lives on professional_profiles itself
  professionalId: number;
  vertical: OfferingVertical;
  pricingMinINR: number | null;
  pricingMaxINR: number | null;
  rciCrrNumber: string | null;
  billingCadence: string | null;
  verificationStatus: string;
  isVerified: boolean;
  listingFeePaidAt: Date | null;
  listingFeePaymentId: number | null;
  verticalDetails: unknown;
}

export async function resolveOffering(
  professionalId: number,
  vertical: OfferingVertical,
): Promise<ResolvedOffering | null> {
  const [profile] = await db
    .select({
      vertical: professionalProfilesTable.vertical,
      pricingMinINR: professionalProfilesTable.pricingMinINR,
      pricingMaxINR: professionalProfilesTable.pricingMaxINR,
      rciCrrNumber: professionalProfilesTable.rciCrrNumber,
      billingCadence: professionalProfilesTable.billingCadence,
      verificationStatus: professionalProfilesTable.verificationStatus,
      isVerified: professionalProfilesTable.isVerified,
      listingFeePaidAt: professionalProfilesTable.listingFeePaidAt,
      listingFeePaymentId: professionalProfilesTable.listingFeePaymentId,
      verticalDetails: professionalProfilesTable.verticalDetails,
    })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, professionalId));

  if (!profile) return null;

  if (profile.vertical === vertical) {
    return {
      isPrimary: true,
      offeringId: null,
      professionalId,
      vertical: profile.vertical,
      pricingMinINR: profile.pricingMinINR,
      pricingMaxINR: profile.pricingMaxINR,
      rciCrrNumber: profile.rciCrrNumber,
      billingCadence: profile.billingCadence,
      verificationStatus: profile.verificationStatus,
      isVerified: profile.isVerified,
      listingFeePaidAt: profile.listingFeePaidAt,
      listingFeePaymentId: profile.listingFeePaymentId,
      verticalDetails: profile.verticalDetails,
    };
  }

  const [offering] = await db
    .select()
    .from(professionalOfferingsTable)
    .where(
      and(
        eq(professionalOfferingsTable.professionalId, professionalId),
        eq(professionalOfferingsTable.vertical, vertical),
      ),
    );

  if (!offering) return null;

  return {
    isPrimary: false,
    offeringId: offering.id,
    professionalId,
    vertical: offering.vertical,
    pricingMinINR: offering.pricingMinINR,
    pricingMaxINR: offering.pricingMaxINR,
    rciCrrNumber: offering.rciCrrNumber,
    billingCadence: offering.billingCadence,
    verificationStatus: offering.verificationStatus,
    isVerified: offering.isVerified,
    listingFeePaidAt: offering.listingFeePaidAt,
    listingFeePaymentId: offering.listingFeePaymentId,
    verticalDetails: offering.verticalDetails,
  };
}
