import { pgTable, serial, integer, text, timestamp, boolean, pgEnum } from "drizzle-orm/pg-core";
import { professionalProfilesTable } from "./professionals";

export const idDocumentTypeEnum = pgEnum("id_document_type", [
  "aadhar",
  "passport",
  "driving_licence",
  "national_id",
]);

export const idVerificationStatusEnum = pgEnum("id_verification_status", [
  "pending",
  "verified",
  "rejected",
]);

export const identityVerificationsTable = pgTable("identity_verifications", {
  id: serial("id").primaryKey(),
  professionalId: integer("professional_id")
    .notNull()
    .references(() => professionalProfilesTable.id, { onDelete: "cascade" }),
  documentType: idDocumentTypeEnum("document_type").notNull(),
  fileKey: text("file_key").notNull(),
  status: idVerificationStatusEnum("status").notNull().default("pending"),
  dpdpConsent: boolean("dpdp_consent").notNull().default(false),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
});
