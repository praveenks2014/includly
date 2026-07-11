import { pgTable, serial, integer, text, timestamp, pgEnum, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { professionalProfilesTable } from "./professionals";
import { childrenTable } from "./children";

// Separate, independent status enum from shadow_match_status (Path A —
// mirrors shadow_teacher_matches' lifecycle values today, free to diverge
// later without touching the shadow-teacher flow).
export const therapistMatchStatusEnum = pgEnum("therapist_match_status", [
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

// Mirrors the professional's own discipline options (onboard-stage2.tsx's
// THERAPIST_DISCIPLINES, slugified) plus clinical_psychology and a
// deliberate "not_sure" escape hatch for parents who don't know which
// discipline their child needs. Reconciling this against a professional's
// free-text discipline/disciplineOther is a matching-algorithm concern for
// Part B, not a schema one.
export const therapistDisciplineNeededEnum = pgEnum("therapist_discipline_needed", [
  "occupational_therapy",
  "speech_therapy",
  "aba",
  "behavioral_therapy",
  "physiotherapy",
  "developmental_therapy",
  "special_education",
  "psychotherapy_counselling",
  "clinical_psychology",
  "not_sure",
]);

export const diagnosisStatusEnum = pgEnum("diagnosis_status", ["yes", "no", "pending"]);

export const therapistMatchesTable = pgTable("therapist_matches", {
  id: serial("id").primaryKey(),
  parentId: integer("parent_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  matchedProfessionalId: integer("matched_professional_id").references(() => professionalProfilesTable.id, { onDelete: "set null" }),
  status: therapistMatchStatusEnum("status").notNull().default("pending_payment"),
  matchingFeeInr: integer("matching_fee_inr").notNull().default(0),
  matchingFeePaidInr: integer("matching_fee_paid_inr"),
  providerOrderId: text("provider_order_id"),
  providerPaymentId: text("provider_payment_id"),
  childId: integer("child_id").references(() => childrenTable.id, { onDelete: "set null" }),

  // ── Therapist intake (Prompt 2) — discrete columns, same rationale as
  // tutor_matches: small fixed set, used directly in matching/scoring.
  // Deliberately NO clinical-report upload field (omitted from v1 for
  // data-protection, per instruction).
  childAge: integer("child_age"),
  diagnosedConditions: text("diagnosed_conditions").array(),
  disciplineNeeded: therapistDisciplineNeededEnum("discipline_needed"),
  hasFormalDiagnosis: diagnosisStatusEnum("has_formal_diagnosis"),
  sessionModePreference: text("session_mode_preference").array(),
  frequencyPerWeek: integer("frequency_per_week"),
  budgetMinInr: integer("budget_min_inr"),
  budgetMaxInr: integer("budget_max_inr"),
  wantsAssessmentFirst: boolean("wants_assessment_first"),
  // Assessment-fee tracking (Pass 1 API) — mirrors the matching-fee pattern
  // above (direct match-level fields, not a payments-table row), since
  // there's exactly one assessment per match, same as exactly one matching
  // fee. Needed for book-assessment/refund-assessment.
  assessmentFeeOrderId: text("assessment_fee_order_id"),
  assessmentFeePaymentId: text("assessment_fee_payment_id"),
  assessmentFeePaidInr: integer("assessment_fee_paid_inr"),
  assessmentFeeRefundedAt: timestamp("assessment_fee_refunded_at", { withTimezone: true }),

  extraNotes: text("extra_notes"),
  adminNotes: text("admin_notes"),
  matchedAt: timestamp("matched_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  refundedAt: timestamp("refunded_at", { withTimezone: true }),
  selectedProfessionalId: integer("selected_professional_id").references(() => professionalProfilesTable.id, { onDelete: "set null" }),
  feePaidAt: timestamp("fee_paid_at", { withTimezone: true }),
  distinctTherapistsShown: integer("distinct_therapists_shown").notNull().default(0),

  trialFeePaidInr: integer("trial_fee_paid_inr"),
  trialProviderOrderId: text("trial_provider_order_id"),
  trialProviderPaymentId: text("trial_provider_payment_id"),
  trialStartOtp: text("trial_start_otp"),
  trialEndOtp: text("trial_end_otp"),
  trialLocation: text("trial_location"),
  trialDirectPay: boolean("trial_direct_pay"),
  trialDirectPayMarkedPaidAt: timestamp("trial_direct_pay_marked_paid_at", { withTimezone: true }),
  trialDirectPayConfirmedAt: timestamp("trial_direct_pay_confirmed_at", { withTimezone: true }),

  pendingCommitProfessionalId: integer("pending_commit_professional_id").references(() => professionalProfilesTable.id, { onDelete: "set null" }),
  pendingCommitStartDate: text("pending_commit_start_date"),
  placementFeeOrderId: text("placement_fee_order_id"),
  placementFeeAmountInr: integer("placement_fee_amount_inr"),

  // Per Prompt 2 Part B: activation fee defaults ON for therapist engagements.
  activationFeeEnabled: boolean("activation_fee_enabled").notNull().default(true),
  trialDays: integer("trial_days"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTherapistMatchSchema = createInsertSchema(therapistMatchesTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertTherapistMatch = z.infer<typeof insertTherapistMatchSchema>;
export type TherapistMatch = typeof therapistMatchesTable.$inferSelect;
