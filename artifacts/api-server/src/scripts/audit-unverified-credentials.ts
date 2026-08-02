import { eq } from "drizzle-orm";
import {
  db,
  professionalProfilesTable,
  professionalOfferingsTable,
  identityVerificationsTable,
  professionalCertificationsTable,
} from "@workspace/db";
import {
  computeVerificationRequirements,
  disciplineCredentialKind,
} from "../lib/verificationRequirements";

/**
 * READ-ONLY visibility script — companion to the OT/medical/ABA credential-
 * document gate fix. Writes nothing to the database.
 *
 * That fix is deliberately forward-only (see the approved plan): any profile
 * or offering already verificationStatus="verified" under the OLD, weaker
 * rule keeps that status untouched, even if it would now fail
 * computeVerificationRequirements(). This script exists purely so a human
 * can see exactly who that applies to (profile 47 and anything else) and
 * decide by hand whether to manually flip any of them back to "pending" via
 * the existing admin UI/API for real re-verification.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx src/scripts/audit-unverified-credentials.ts
 */

async function main() {
  console.log("[audit] Re-checking every verified therapist profile/offering against the updated credential rule (read-only — no writes).\n");

  const identityDocProfIds = new Set(
    (await db.select({ professionalId: identityVerificationsTable.professionalId }).from(identityVerificationsTable)).map(
      (r) => r.professionalId,
    ),
  );

  const allCerts = await db
    .select({ professionalId: professionalCertificationsTable.professionalId, documentType: professionalCertificationsTable.documentType })
    .from(professionalCertificationsTable);
  const certsByProfId = new Map<number, string[]>();
  for (const c of allCerts) {
    const list = certsByProfId.get(c.professionalId) ?? [];
    list.push(c.documentType);
    certsByProfId.set(c.professionalId, list);
  }

  let failingCount = 0;

  // Primary-vertical profiles
  const profiles = await db
    .select({
      id: professionalProfilesTable.id,
      fullName: professionalProfilesTable.fullName,
      vertical: professionalProfilesTable.vertical,
      verticalDetails: professionalProfilesTable.verticalDetails,
      rciCrrNumber: professionalProfilesTable.rciCrrNumber,
      upiVerifiedAt: professionalProfilesTable.upiVerifiedAt,
      verificationStatus: professionalProfilesTable.verificationStatus,
    })
    .from(professionalProfilesTable)
    .where(eq(professionalProfilesTable.verificationStatus, "verified"));

  for (const p of profiles) {
    if (p.vertical !== "therapist") continue;
    const vd = (p.verticalDetails ?? {}) as Record<string, unknown>;
    const discipline = typeof vd["discipline"] === "string" ? (vd["discipline"] as string) : "";
    const kind = disciplineCredentialKind(discipline);
    if (kind === "ancillary" || kind === "rci") continue; // rci already gated correctly before this fix

    const requirements = computeVerificationRequirements(
      { vertical: p.vertical, rciCrrNumber: p.rciCrrNumber, verticalDetails: p.verticalDetails, upiVerifiedAt: p.upiVerifiedAt },
      identityDocProfIds.has(p.id),
      certsByProfId.get(p.id) ?? [],
    );

    if (!requirements.met) {
      failingCount++;
      console.log(
        `[audit] PRIMARY profile #${p.id} "${p.fullName ?? "?"}" — discipline: ${discipline || "(unset)"} (kind: ${kind}) — missing: ${requirements.missing.join(", ")}`,
      );
    }
  }

  // Additional (non-primary) therapist offerings
  const offerings = await db
    .select({
      id: professionalOfferingsTable.id,
      professionalId: professionalOfferingsTable.professionalId,
      vertical: professionalOfferingsTable.vertical,
      verticalDetails: professionalOfferingsTable.verticalDetails,
      rciCrrNumber: professionalOfferingsTable.rciCrrNumber,
      verificationStatus: professionalOfferingsTable.verificationStatus,
    })
    .from(professionalOfferingsTable)
    .where(eq(professionalOfferingsTable.verificationStatus, "verified"));

  const profNames = new Map(profiles.map((p) => [p.id, p.fullName]));
  const profUpi = await db.select({ id: professionalProfilesTable.id, upiVerifiedAt: professionalProfilesTable.upiVerifiedAt }).from(professionalProfilesTable);
  const upiByProfId = new Map(profUpi.map((p) => [p.id, p.upiVerifiedAt]));

  for (const o of offerings) {
    if (o.vertical !== "therapist") continue;
    const vd = (o.verticalDetails ?? {}) as Record<string, unknown>;
    const discipline = typeof vd["discipline"] === "string" ? (vd["discipline"] as string) : "";
    const kind = disciplineCredentialKind(discipline);
    if (kind === "ancillary" || kind === "rci") continue;

    const requirements = computeVerificationRequirements(
      { vertical: o.vertical, rciCrrNumber: o.rciCrrNumber, verticalDetails: o.verticalDetails, upiVerifiedAt: upiByProfId.get(o.professionalId) },
      identityDocProfIds.has(o.professionalId),
      certsByProfId.get(o.professionalId) ?? [],
    );

    if (!requirements.met) {
      failingCount++;
      console.log(
        `[audit] OFFERING #${o.id} (professional #${o.professionalId} "${profNames.get(o.professionalId) ?? "?"}") — discipline: ${discipline || "(unset)"} (kind: ${kind}) — missing: ${requirements.missing.join(", ")}`,
      );
    }
  }

  console.log(`\n[audit] Total verified therapist profiles/offerings that would now fail: ${failingCount}`);
  console.log("[audit] No changes written. Any manual re-verification decision is yours to make via the admin UI.");

  process.exit(0);
}

main().catch((err) => {
  console.error("[audit] Failed:", err);
  process.exit(1);
});
