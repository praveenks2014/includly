import { eq, and } from "drizzle-orm";
import {
  db,
  professionalProfilesTable,
  professionalOfferingsTable,
  identityVerificationsTable,
  professionalCertificationsTable,
  adminSettingsTable,
} from "@workspace/db";
import { resolveOffering } from "./offeringResolver";

/**
 * Document-type convention used by the Certifications upload flow to mark a
 * file as the therapist's RCI (Rehabilitation Council of India) registration
 * certificate. There is no dedicated enum for this — a human admin visually
 * reviews the actual uploaded file before approving, so the string tag is
 * only used to prove *something* claiming to be the RCI cert was submitted.
 */
export const RCI_CERTIFICATE_DOC_TYPE = "rci_certificate";

/**
 * Same string-tag convention as RCI_CERTIFICATE_DOC_TYPE above, used to mark
 * a certification upload as proof of the professional's clinic/practice
 * address — required before a held-pending clinicAddress change (see
 * pendingClinicAddress on professionalProfilesTable) becomes reviewable.
 */
export const PROOF_OF_ADDRESS_DOC_TYPE = "proof_of_address";

export type VerificationVertical = "shadow_teacher" | "home_tutor" | "therapist";

export interface ProfileForRequirements {
  vertical: VerificationVertical;
  rciCrrNumber?: string | null;
  verticalDetails?: unknown;
}

// ─── Therapist discipline → credential-kind mapping ────────────────────────
// Not every therapist discipline is RCI-regulated in India — mirrors the
// discipline list in artifacts/sensei-link/src/pages/onboard-stage2.tsx
// (THERAPIST_DISCIPLINES). Duplicated, not shared, because the frontend and
// backend are separate packages with no shared constants module — if the
// discipline list or credential-kind mapping ever changes, update BOTH.
export type TherapistDisciplineCredentialKind = "rci" | "ot" | "medical" | "aba" | "ancillary";

const RCI_REQUIRED_DISCIPLINES = new Set([
  "Speech & Language Therapy (SLT)",
  "Special Education",
  "Clinical Psychology",
  "Rehabilitation Counselling",
]);
const MEDICAL_COUNCIL_DISCIPLINES = new Set(["Developmental Pediatrician", "Psychiatrist"]);
const ABA_DISCIPLINES = new Set(["Applied Behavior Analysis (ABA)", "Behavioral Therapy"]);

export function disciplineCredentialKind(discipline: string): TherapistDisciplineCredentialKind {
  if (discipline === "Occupational Therapy (OT)") return "ot";
  if (RCI_REQUIRED_DISCIPLINES.has(discipline)) return "rci";
  if (MEDICAL_COUNCIL_DISCIPLINES.has(discipline)) return "medical";
  if (ABA_DISCIPLINES.has(discipline)) return "aba";
  // Physiotherapy, Developmental Therapy, Psychotherapy/Counselling, Other —
  // none has one clean, nationally consistent mandatory credential in India
  // (physiotherapy councils are fragmented state-by-state with no central
  // body; developmental therapy is an approach, not a credential;
  // psychotherapy/counselling has no regulator at all).
  return "ancillary";
}

export interface VerificationRequirements {
  met: boolean;
  missing: string[];
  warnings: string[];
}

/**
 * Pure function: given what we know about a professional's submitted
 * documents, decide whether they meet the minimum bar to be reviewable /
 * approvable / listable. This is the SINGLE source of truth — it must be
 * called both before allowing a "pending" (submitted for review) transition
 * and, again, as a hard gate inside the admin approve endpoint.
 */
export function computeVerificationRequirements(
  profile: ProfileForRequirements,
  hasIdentityDoc: boolean,
  certDocumentTypes: string[],
): VerificationRequirements {
  const missing: string[] = [];
  const warnings: string[] = [];

  // ALL VERTICALS: at least one government ID document is mandatory.
  if (!hasIdentityDoc) missing.push("identity_document");

  if (profile.vertical === "therapist") {
    const vd = (profile.verticalDetails ?? {}) as Record<string, unknown>;
    const discipline = typeof vd["discipline"] === "string" ? (vd["discipline"] as string) : "";
    const kind = disciplineCredentialKind(discipline);

    if (kind === "rci") {
      // RCI/CRR number AND the actual RCI certificate upload are both
      // mandatory. RCI Act requires registration to practice for these
      // disciplines — this is a legal requirement, not just a trust signal.
      if (!profile.rciCrrNumber || !profile.rciCrrNumber.trim()) {
        missing.push("rci_crr_number");
      }
      if (!certDocumentTypes.includes(RCI_CERTIFICATE_DOC_TYPE)) {
        missing.push("rci_certificate");
      }
    } else if (kind === "ot") {
      // Occupational therapists are regulated via AIOTA membership, not RCI.
      // NCAHP registration is captured if present but stays optional —
      // NCAHP registers are still being rolled out nationally.
      const aiota = vd["aiotaMembershipNumber"];
      if (typeof aiota !== "string" || !aiota.trim()) missing.push("aiota_membership_number");
    } else if (kind === "medical") {
      // Developmental pediatricians and psychiatrists are medical doctors —
      // regulated by NMC/State Medical Council, not RCI.
      const nmc = vd["medicalCouncilRegistrationNumber"];
      if (typeof nmc !== "string" || !nmc.trim()) missing.push("medical_council_registration_number");
    } else if (kind === "aba") {
      // ABA/behavioral therapists are certified via an international body
      // (BCBA/RBT/QABA), not RCI. Whether they must additionally practice
      // under RCI-registered supervision is a genuinely unsettled compliance
      // question in India — supervisingProfessionalName/supervisingRciNumber
      // are captured on the profile but deliberately NOT enforced here.
      const credType = vd["abaCredentialType"];
      const credNumber = vd["abaCredentialNumber"];
      if (typeof credType !== "string" || !credType.trim() || typeof credNumber !== "string" || !credNumber.trim()) {
        missing.push("aba_credential");
      }
    }
    // kind === "ancillary" (Physiotherapy, Developmental Therapy,
    // Psychotherapy/Counselling, Other): no discipline-specific credential
    // is gated — identity document (already checked above) is the only
    // mandatory requirement for this bucket.
  }

  if (profile.vertical === "shadow_teacher") {
    // SHADOW_TEACHER: training certificate is encouraged, not mandatory —
    // surfaced as a warning to admin (lower trust) rather than a hard block.
    if (certDocumentTypes.length === 0) {
      warnings.push("training_certificate_missing");
    }
  }

  return { met: missing.length === 0, missing, warnings };
}

/**
 * DB-backed convenience wrapper: loads the profile's identity document and
 * certifications and runs computeVerificationRequirements against them.
 */
export async function getVerificationRequirementsForProfessional(
  professionalId: number,
): Promise<VerificationRequirements> {
  const [profile] = await db
    .select({
      vertical: professionalProfilesTable.vertical,
      rciCrrNumber: professionalProfilesTable.rciCrrNumber,
      verticalDetails: professionalProfilesTable.verticalDetails,
    })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, professionalId));

  if (!profile) {
    return { met: false, missing: ["profile_not_found"], warnings: [] };
  }

  const [identityDoc] = await db
    .select({ id: identityVerificationsTable.id })
    .from(identityVerificationsTable)
    .where(eq(identityVerificationsTable.professionalId, professionalId));

  const certs = await db
    .select({ documentType: professionalCertificationsTable.documentType })
    .from(professionalCertificationsTable)
    .where(eq(professionalCertificationsTable.professionalId, professionalId));

  return computeVerificationRequirements(
    profile,
    !!identityDoc,
    certs.map((c) => c.documentType),
  );
}

/**
 * Called after any event that could newly satisfy a vertical's requirements
 * (identity doc submitted, certification uploaded, RCI CRR number set).
 * Flips verificationStatus from "unsubmitted"/"rejected" to "pending" ONLY
 * once all mandatory requirements are met — this is what makes a profile
 * appear in the admin review queue. Never touches an already-"verified"
 * profile (admin approval is a one-way door until explicitly rejected).
 */
export async function recomputeSubmissionStatus(professionalId: number): Promise<void> {
  const [profile] = await db
    .select({ verificationStatus: professionalProfilesTable.verificationStatus })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, professionalId));

  if (!profile || profile.verificationStatus === "verified") return;

  const requirements = await getVerificationRequirementsForProfessional(professionalId);

  if (requirements.met && profile.verificationStatus !== "pending") {
    await db
      .update(professionalProfilesTable)
      .set({ verificationStatus: "pending" })
      .where(eq(professionalProfilesTable.id, professionalId));
  }
}

/**
 * Companion to recomputeSubmissionStatus, scoped to the held-pending
 * clinicAddress flow (Step 2, professional-verification-integrity batch):
 * a verified profile with a pendingClinicAddress set doesn't become
 * reviewable until a proof_of_address certification actually exists — an
 * address change alone, with no proof yet, must not surface to admin.
 * Called after every certification upload (same call site as
 * recomputeSubmissionStatus), a no-op unless both conditions are met.
 *
 * Deliberately sets addressReviewStatus, NEVER verificationStatus — an
 * address review must never affect search/matching/listing (all of which
 * gate on verificationStatus/isVerified only). The professional stays
 * fully listed and bookable for the entire duration of an address review.
 */
export async function recomputeAddressChangeReviewable(professionalId: number): Promise<void> {
  const [profile] = await db
    .select({
      verificationStatus: professionalProfilesTable.verificationStatus,
      pendingClinicAddress: professionalProfilesTable.pendingClinicAddress,
    })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.id, professionalId));

  if (!profile || !profile.pendingClinicAddress || profile.verificationStatus !== "verified") return;

  const [proofDoc] = await db
    .select({ id: professionalCertificationsTable.id })
    .from(professionalCertificationsTable)
    .where(and(
      eq(professionalCertificationsTable.professionalId, professionalId),
      eq(professionalCertificationsTable.documentType, PROOF_OF_ADDRESS_DOC_TYPE),
    ));

  if (!proofDoc) return;

  await db
    .update(professionalProfilesTable)
    .set({ addressReviewStatus: "pending" })
    .where(eq(professionalProfilesTable.id, professionalId));
}

// ─── Multi-vertical offerings ──────────────────────────────────────────────
// A professional's ORIGINAL vertical stays on professional_profiles itself
// (untouched, same columns as always). Any ADDITIONAL vertical they add lives
// in professional_offerings, one row per (professionalId, vertical).
// resolveOffering() (offeringResolver.ts) is the SINGLE shared function that
// resolves which of the two locations a given vertical lives in — every
// function below calls it rather than re-implementing that branch, then
// defers to the exact same computeVerificationRequirements /
// recomputeSubmissionStatus logic already used for the single-vertical path.

/**
 * Per-offering equivalent of getVerificationRequirementsForProfessional —
 * same identity-doc / certification loading, same
 * computeVerificationRequirements() call. The only difference is which
 * table supplies {vertical, rciCrrNumber}.
 */
export async function getVerificationRequirementsForOffering(
  professionalId: number,
  vertical: VerificationVertical,
): Promise<VerificationRequirements> {
  const offering = await resolveOffering(professionalId, vertical);
  if (!offering) {
    return { met: false, missing: ["offering_not_found"], warnings: [] };
  }

  const [identityDoc] = await db
    .select({ id: identityVerificationsTable.id })
    .from(identityVerificationsTable)
    .where(eq(identityVerificationsTable.professionalId, professionalId));

  const certs = await db
    .select({ documentType: professionalCertificationsTable.documentType })
    .from(professionalCertificationsTable)
    .where(eq(professionalCertificationsTable.professionalId, professionalId));

  return computeVerificationRequirements(
    { vertical: offering.vertical, rciCrrNumber: offering.rciCrrNumber, verticalDetails: offering.verticalDetails },
    !!identityDoc,
    certs.map((c) => c.documentType),
  );
}

/**
 * The actual listability gate: is this professional's OFFERING for this
 * vertical admin-approved AND verified? Used by tutor/therapist candidate
 * surfacing exactly as shadow-teacher's surfacing uses the equivalent
 * profile-row check — same resolveOffering() call, not a separate/weaker check.
 *
 * CROSS-REFERENCE: this single-professional check is DUPLICATED — not shared
 * code — in shadow-teacher's bulk candidate-surfacing SQL query
 * (surfaceCandidatesForMatch() in artifacts/api-server/src/routes/
 * shadowTeacher.ts, the primary-row-OR-offering-row WHERE clause). That
 * query can't call this function directly (would be N+1 against hundreds of
 * candidates per match), so it re-encodes the same rule as a SQL JOIN
 * instead. If what makes an offering "listable" ever changes here (e.g. the
 * listing-fee gate), THAT query must be updated too — check both before
 * assuming a change here is complete.
 */
export async function isOfferingListable(professionalId: number, vertical: VerificationVertical): Promise<boolean> {
  const offering = await resolveOffering(professionalId, vertical);
  if (!offering || offering.verificationStatus !== "verified") return false;

  // Listing-fee gate (admin-toggle-controlled, per category). No-op when a
  // category's toggle is off — see the cross-reference comment above: any
  // change here must be mirrored in the bulk candidate-surfacing SQL queries.
  const [settings] = await db.select().from(adminSettingsTable).limit(1);
  const listingFeeEnabled =
    vertical === "shadow_teacher" ? settings?.shadowTeacherListingFeeEnabled
    : vertical === "home_tutor" ? settings?.tutorListingFeeEnabled
    : settings?.therapistListingFeeEnabled;

  if (listingFeeEnabled && !offering.listingFeePaidAt) return false;

  return true;
}

/**
 * Per-offering equivalent of recomputeSubmissionStatus. For the primary
 * vertical this delegates straight to the existing, untouched function. For
 * an additional offering it applies the identical "flip to pending once
 * requirements are met, never touch verified" rule to the offerings row.
 */
export async function recomputeSubmissionStatusForOffering(
  professionalId: number,
  vertical: VerificationVertical,
): Promise<void> {
  const offering = await resolveOffering(professionalId, vertical);
  if (!offering || offering.verificationStatus === "verified") return;

  if (offering.isPrimary) {
    await recomputeSubmissionStatus(professionalId);
    return;
  }

  const requirements = await getVerificationRequirementsForOffering(professionalId, vertical);

  if (requirements.met && offering.verificationStatus !== "pending") {
    await db
      .update(professionalOfferingsTable)
      .set({ verificationStatus: "pending" })
      .where(eq(professionalOfferingsTable.id, offering.offeringId!));
  }
}
