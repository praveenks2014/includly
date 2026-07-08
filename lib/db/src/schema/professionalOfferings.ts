import { pgTable, serial, integer, text, timestamp, boolean, json, unique } from "drizzle-orm/pg-core";
import { professionalProfilesTable, professionalVerticalEnum, verificationStatusEnum } from "./professionals";

// A professional's ADDITIONAL (non-primary) service offerings. The professional's
// original/primary vertical stays exactly where it always was — on
// professional_profiles itself (vertical, verticalDetails, pricingMinINR/MaxINR,
// rciCrrNumber, verificationStatus, isVerified, rejectionReason) — so the existing
// single-vertical shadow-teacher flow reads/writes that row completely unchanged.
// This table only holds a SECOND (or third) vertical a professional adds later,
// each independently gated by the same verification requirements as if it were
// its own profile. See artifacts/api-server/src/lib/verificationRequirements.ts.
export const professionalOfferingsTable = pgTable("professional_offerings", {
  id: serial("id").primaryKey(),
  professionalId: integer("professional_id")
    .notNull()
    .references(() => professionalProfilesTable.id, { onDelete: "cascade" }),
  vertical: professionalVerticalEnum("vertical").notNull(),
  verticalDetails: json("vertical_details"),
  pricingMinINR: integer("pricing_min_inr"),
  pricingMaxINR: integer("pricing_max_inr"),
  rciCrrNumber: text("rci_crr_number"),
  verificationStatus: verificationStatusEnum("verification_status").notNull().default("unsubmitted"),
  isVerified: boolean("is_verified").notNull().default(false),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  unique("professional_offerings_professional_vertical_unique").on(table.professionalId, table.vertical),
]);

export type ProfessionalOffering = typeof professionalOfferingsTable.$inferSelect;
export type InsertProfessionalOffering = typeof professionalOfferingsTable.$inferInsert;
