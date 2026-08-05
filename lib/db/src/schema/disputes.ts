import { pgTable, serial, integer, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { therapyCentresTable } from "./therapyCentres";

export const disputeStatusEnum = pgEnum("dispute_status", ["open", "under_review", "resolved_upheld", "resolved_rejected", "withdrawn"]);

// Shared dispute mechanism — ONE table, ONE admin review queue, used by
// BOTH B8 settlement disputes (centre vs platform) and the later OTP
// attendance-tracking work (parent vs centre/therapist) — built once, not
// twice. disputeType/subjectType are deliberately text, not enum, mirroring
// shadowMatchCandidatesTable.requestStatus's own precedent: avoids an
// ALTER TYPE migration every time this gets extended by a sub-build that
// doesn't exist yet. This table only tracks/reviews a dispute; it never
// itself executes the remedial action (waiving an invoice, refunding a
// session) — that routes through whatever endpoint is appropriate for the
// subjectType, logged here via resolutionAction after the fact.
export const disputesTable = pgTable("disputes", {
  id: serial("id").primaryKey(),
  // 'settlement' today; 'attendance' once the OTP sub-build lands.
  disputeType: text("dispute_type").notNull(),
  // 'dues_invoice' | 'dues_charge' today; 'therapy_session' once the OTP
  // sub-build lands — defined here in comment only, not the DB, so no
  // migration is needed when that day comes.
  subjectType: text("subject_type").notNull(),
  // Polymorphic, no FK — same soft-reference reasoning as
  // platformDuesChargesTable.ownerId/sourceId.
  subjectId: integer("subject_id").notNull(),
  // Denormalized for "show me every dispute touching centre X" without a
  // type-specific join through every possible subjectType. Null for a
  // dispute that doesn't involve a centre at all (e.g. an individual
  // professional's own settlement dispute).
  involvedCentreId: integer("involved_centre_id").references(() => therapyCentresTable.id, { onDelete: "set null" }),
  raisedByUserId: integer("raised_by_user_id").notNull().references(() => usersTable.id),
  raisedByRole: text("raised_by_role").notNull(),
  reason: text("reason").notNull(),
  status: disputeStatusEnum("status").notNull().default("open"),
  adminNotes: text("admin_notes"),
  resolutionAction: text("resolution_action"),
  resolvedByUserId: integer("resolved_by_user_id").references(() => usersTable.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Dispute = typeof disputesTable.$inferSelect;
