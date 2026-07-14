import { pgTable, serial, integer, text, timestamp, pgEnum, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { professionalProfilesTable } from "./professionals";
import { childrenTable } from "./children";

// Separate, independent status enum from shadow_match_status (Path A —
// mirrors shadow_teacher_matches' lifecycle values today, but the two are
// free to diverge later without touching the shadow-teacher flow).
export const tutorMatchStatusEnum = pgEnum("tutor_match_status", [
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
  "trial_pending",
  "trial_started",
  "trial_done",
]);

export const tutorMatchesTable = pgTable("tutor_matches", {
  id: serial("id").primaryKey(),
  parentId: integer("parent_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  matchedProfessionalId: integer("matched_professional_id").references(() => professionalProfilesTable.id, { onDelete: "set null" }),
  status: tutorMatchStatusEnum("status").notNull().default("pending_payment"),
  matchingFeeInr: integer("matching_fee_inr").notNull().default(0),
  matchingFeePaidInr: integer("matching_fee_paid_inr"),
  providerOrderId: text("provider_order_id"),
  providerPaymentId: text("provider_payment_id"),
  childId: integer("child_id").references(() => childrenTable.id, { onDelete: "set null" }),

  // ── Tutor intake (Prompt 2) — discrete columns, mirroring the pattern
  // shadow_teacher_matches already uses for its child* intake fields (not a
  // JSON blob) since these are a small, fixed, queryable set used directly
  // in matching/scoring, same as childBudgetMinInr/childBudgetMaxInr today.
  childAge: integer("child_age"),
  subjects: text("subjects").array(),
  board: text("board"),
  mode: text("mode").array(),
  hasDiagnosedLearningDifference: boolean("has_diagnosed_learning_difference"),
  frequencyPerWeek: integer("frequency_per_week"),
  budgetMinInr: integer("budget_min_inr"),
  budgetMaxInr: integer("budget_max_inr"),
  locationArea: text("location_area"),

  extraNotes: text("extra_notes"),
  adminNotes: text("admin_notes"),
  matchedAt: timestamp("matched_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  refundedAt: timestamp("refunded_at", { withTimezone: true }),
  selectedProfessionalId: integer("selected_professional_id").references(() => professionalProfilesTable.id, { onDelete: "set null" }),
  feePaidAt: timestamp("fee_paid_at", { withTimezone: true }),
  distinctTutorsShown: integer("distinct_tutors_shown").notNull().default(0),

  trialFeePaidInr: integer("trial_fee_paid_inr"),
  trialProviderOrderId: text("trial_provider_order_id"),
  trialProviderPaymentId: text("trial_provider_payment_id"),
  trialStartOtp: text("trial_start_otp"),
  trialEndOtp: text("trial_end_otp"),
  trialLocation: text("trial_location"),
  // Same deterministic meet.jit.si pattern already used for interview
  // meetLink — generated once at verify-trial-payment time.
  trialMeetLink: text("trial_meet_link"),
  trialDirectPay: boolean("trial_direct_pay"),
  trialDirectPayMarkedPaidAt: timestamp("trial_direct_pay_marked_paid_at", { withTimezone: true }),
  trialDirectPayConfirmedAt: timestamp("trial_direct_pay_confirmed_at", { withTimezone: true }),

  pendingCommitProfessionalId: integer("pending_commit_professional_id").references(() => professionalProfilesTable.id, { onDelete: "set null" }),
  pendingCommitStartDate: text("pending_commit_start_date"),
  placementFeeOrderId: text("placement_fee_order_id"),
  placementFeeAmountInr: integer("placement_fee_amount_inr"),

  // Per Prompt 2 Part B: activation fee defaults OFF for tutor engagements.
  activationFeeEnabled: boolean("activation_fee_enabled").notNull().default(false),
  trialDays: integer("trial_days"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTutorMatchSchema = createInsertSchema(tutorMatchesTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertTutorMatch = z.infer<typeof insertTutorMatchSchema>;
export type TutorMatch = typeof tutorMatchesTable.$inferSelect;
