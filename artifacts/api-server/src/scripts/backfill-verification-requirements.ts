import { eq, and } from "drizzle-orm";
import {
  db,
  professionalProfilesTable,
  professionalCertificationsTable,
} from "@workspace/db";
import {
  getVerificationRequirementsForProfessional,
  RCI_CERTIFICATE_DOC_TYPE,
} from "../lib/verificationRequirements";

/**
 * Backfill script for the trust & safety verification gate.
 *
 * Before this fix, some professionals were marked verificationStatus="verified"
 * without going through the new mandatory-document requirements (e.g. a
 * therapist with no RCI certificate on file, or any vertical missing a
 * government ID). This script:
 *
 *   1. Migrates any legacy `verticalDetails.certKey` file into the real
 *      `professional_certifications` table (as "rci_certificate" for
 *      therapists, "training_certificate" for shadow_teacher/home_tutor) so
 *      legitimately-uploaded documents aren't lost/ignored by the new gate.
 *   2. Re-evaluates every "verified" profile against
 *      computeVerificationRequirements. Any profile that does NOT meet the
 *      requirements is demoted: verificationStatus -> "pending" (so it
 *      re-enters the admin review queue) and isVerified -> false. This makes
 *      the profile immediately non-searchable/non-matchable.
 *
 * Run modes:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/backfill-verification-requirements.ts
 *     -> DRY RUN (default). Prints what WOULD change, writes nothing.
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/backfill-verification-requirements.ts --apply
 *     -> Actually performs the migration + demotion writes.
 */

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`[backfill] Mode: ${APPLY ? "APPLY (writing changes)" : "DRY RUN (no writes)"}`);

  const profiles = await db
    .select({
      id: professionalProfilesTable.id,
      fullName: professionalProfilesTable.fullName,
      vertical: professionalProfilesTable.vertical,
      verificationStatus: professionalProfilesTable.verificationStatus,
      isVerified: professionalProfilesTable.isVerified,
      rciCrrNumber: professionalProfilesTable.rciCrrNumber,
      verticalDetails: professionalProfilesTable.verticalDetails,
    })
    .from(professionalProfilesTable);

  console.log(`[backfill] Loaded ${profiles.length} professional profiles.`);

  let migratedCertCount = 0;
  let demotedCount = 0;
  const demoted: { id: number; fullName: string | null; vertical: string; missing: string[] }[] = [];

  for (const profile of profiles) {
    // Step 1: migrate legacy verticalDetails.certKey -> professional_certifications
    const vd = (profile.verticalDetails ?? {}) as Record<string, unknown>;
    const legacyCertKey = typeof vd.certKey === "string" && vd.certKey.trim() ? vd.certKey.trim() : null;

    if (legacyCertKey) {
      const docType = profile.vertical === "therapist" ? RCI_CERTIFICATE_DOC_TYPE : "training_certificate";

      const [existing] = await db
        .select({ id: professionalCertificationsTable.id })
        .from(professionalCertificationsTable)
        .where(
          and(
            eq(professionalCertificationsTable.professionalId, profile.id),
            eq(professionalCertificationsTable.documentType, docType),
          ),
        );

      if (!existing) {
        console.log(
          `[backfill] ${APPLY ? "Migrating" : "Would migrate"} legacy certKey for professional #${profile.id} (${profile.fullName ?? "?"}, ${profile.vertical}) -> professional_certifications.${docType}`,
        );
        migratedCertCount++;
        if (APPLY) {
          await db.insert(professionalCertificationsTable).values({
            professionalId: profile.id,
            documentType: docType,
            fileKey: legacyCertKey,
          });
        }
      }
    }

    // Step 2: re-evaluate "verified" profiles against the real requirements
    if (profile.verificationStatus === "verified") {
      const requirements = await getVerificationRequirementsForProfessional(profile.id);
      if (!requirements.met) {
        demotedCount++;
        demoted.push({
          id: profile.id,
          fullName: profile.fullName,
          vertical: profile.vertical,
          missing: requirements.missing,
        });
        console.log(
          `[backfill] ${APPLY ? "Demoting" : "Would demote"} professional #${profile.id} (${profile.fullName ?? "?"}, ${profile.vertical}) — missing: ${requirements.missing.join(", ")}`,
        );
        if (APPLY) {
          await db
            .update(professionalProfilesTable)
            .set({ verificationStatus: "pending", isVerified: false })
            .where(eq(professionalProfilesTable.id, profile.id));
        }
      }
    }
  }

  console.log("\n[backfill] Summary");
  console.log(`  Certifications migrated from legacy verticalDetails.certKey: ${migratedCertCount}`);
  console.log(`  "Verified" profiles failing requirements (demoted to pending, isVerified=false): ${demotedCount}`);
  if (demoted.length > 0) {
    console.log("  Demoted profiles:");
    for (const d of demoted) {
      console.log(`    #${d.id} ${d.fullName ?? "?"} [${d.vertical}] — missing: ${d.missing.join(", ")}`);
    }
  }
  if (!APPLY) {
    console.log("\n[backfill] DRY RUN complete — no changes were written. Re-run with --apply to commit these changes.");
  } else {
    console.log("\n[backfill] APPLY complete — changes committed.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[backfill] Failed:", err);
  process.exit(1);
});
