import { eq } from "drizzle-orm";
import {
  db,
  professionalProfilesTable,
  identityVerificationsTable,
  professionalCertificationsTable,
} from "@workspace/db";

/**
 * Document-type convention used by the Certifications upload flow to mark a
 * file as the therapist's RCI (Rehabilitation Council of India) registration
 * certificate. There is no dedicated enum for this — a human admin visually
 * reviews the actual uploaded file before approving, so the string tag is
 * only used to prove *something* claiming to be the RCI cert was submitted.
 */
export const RCI_CERTIFICATE_DOC_TYPE = "rci_certificate";

export type VerificationVertical = "shadow_teacher" | "home_tutor" | "therapist";

export interface ProfileForRequirements {
  vertical: VerificationVertical;
  rciCrrNumber?: string | null;
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
    // THERAPIST: RCI/CRR number AND the actual RCI certificate upload are
    // both mandatory. RCI Act requires registration to practice — this is a
    // legal requirement, not just a trust signal.
    if (!profile.rciCrrNumber || !profile.rciCrrNumber.trim()) {
      missing.push("rci_crr_number");
    }
    if (!certDocumentTypes.includes(RCI_CERTIFICATE_DOC_TYPE)) {
      missing.push("rci_certificate");
    }
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
