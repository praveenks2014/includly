import { pgTable, serial, integer, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { professionalProfilesTable } from "./professionals";
import { childrenTable } from "./children";

export const shadowMatchStatusEnum = pgEnum("shadow_match_status", [
  "pending_payment",
  "payment_failed",
  "queued",
  "matched",
  "cancelled",
  "refunded",
  "pending",
  "shortlisted",
  "pending_commitment",
  "committed",
]);

export const shadowTeacherMatchesTable = pgTable("shadow_teacher_matches", {
  id: serial("id").primaryKey(),
  parentId: integer("parent_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  matchedProfessionalId: integer("matched_professional_id").references(() => professionalProfilesTable.id, { onDelete: "set null" }),
  status: shadowMatchStatusEnum("status").notNull().default("pending_payment"),
  matchingFeeInr: integer("matching_fee_inr").notNull().default(0),
  providerOrderId: text("provider_order_id"),
  providerPaymentId: text("provider_payment_id"),
  childDetails: text("child_details"),
  requirements: text("requirements"),
  adminNotes: text("admin_notes"),
  matchedAt: timestamp("matched_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  refundedAt: timestamp("refunded_at", { withTimezone: true }),
  childId: integer("child_id").references(() => childrenTable.id, { onDelete: "set null" }),
  childCity: text("child_city"),
  childConditions: text("child_conditions").array(),
  childLanguages: text("child_languages").array(),
  childBudgetMinInr: integer("child_budget_min_inr"),
  childBudgetMaxInr: integer("child_budget_max_inr"),
  childGoalsAreas: text("child_goals_areas").array(),
  childPreferredModes: text("child_preferred_modes").array(),
  extraNotes: text("extra_notes"),
  selectedProfessionalId: integer("selected_professional_id").references(() => professionalProfilesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertShadowTeacherMatchSchema = createInsertSchema(shadowTeacherMatchesTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertShadowTeacherMatch = z.infer<typeof insertShadowTeacherMatchSchema>;
export type ShadowTeacherMatch = typeof shadowTeacherMatchesTable.$inferSelect;
