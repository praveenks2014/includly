import { pgTable, serial, integer, text, timestamp, pgEnum, boolean, real } from "drizzle-orm/pg-core";
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
  "trial_pending",
  "trial_started",
  "trial_done",
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
  // #18 — school location, captured at REQUEST time (not child onboarding,
  // which only has a home city/lat/lng). schoolName is always saved as
  // free text regardless of geocoding outcome. schoolLat/schoolLng are only
  // ever set when the parent explicitly selected one specific disambiguated
  // Photon suggestion — never from a raw top-hit — so a distance computed
  // from these is never silently wrong. Null pair means no distance is ever
  // shown, by design (see haversineKm call sites).
  schoolName: text("school_name"),
  schoolLat: real("school_lat"),
  schoolLng: real("school_lng"),
  // Compatibility signal only (see scoreStartDate in shadowTeacherScoring.ts)
  // — never excludes a candidate, only ranks them relative to how well their
  // effective availability lines up with this date.
  childDesiredStartDate: text("child_desired_start_date"),
  extraNotes: text("extra_notes"),
  selectedProfessionalId: integer("selected_professional_id").references(() => professionalProfilesTable.id, { onDelete: "set null" }),
  feePaidAt: timestamp("fee_paid_at", { withTimezone: true }),
  distinctTeachersShown: integer("distinct_teachers_shown").notNull().default(0),
  trialFeePaidInr: integer("trial_fee_paid_inr"),
  trialProviderOrderId: text("trial_provider_order_id"),
  trialProviderPaymentId: text("trial_provider_payment_id"),
  preMeetingRequested: boolean("pre_meeting_requested").notNull().default(false),
  preMeetingNote: text("pre_meeting_note"),
  trialStartOtp: text("trial_start_otp"),
  trialEndOtp: text("trial_end_otp"),
  trialLocation: text("trial_location"),
  // Same deterministic meet.jit.si pattern already used for interview
  // meetLink — generated once at verify-trial-payment/mark-trial-direct-pay-paid time.
  trialMeetLink: text("trial_meet_link"),
  // Stuck-engagement lazy-timeout resolution — precise "waiting since" marks,
  // stamped at the exact moment of transition in verify-trial-payment and
  // verify-trial-start-otp respectively. Write-only additions, no
  // business-logic change to those endpoints. See stuckEngagementResolver.ts.
  trialPendingSince: timestamp("trial_pending_since", { withTimezone: true }),
  trialStartedSince: timestamp("trial_started_since", { withTimezone: true }),
  // Teacher-accepts-before-parent-pays reorder (#14/#15) — "since" mark for
  // trial_done, needed because the "teacher never clicked Choose Engagement"
  // timeout has no engagement row to hang a timestamp off yet. Same
  // lazy-timeout convention as the two above. See stuckEngagementResolver.ts.
  trialDoneSince: timestamp("trial_done_since", { withTimezone: true }),
  // Monetization restructure — trial direct-pay flag, snapshotted from
  // admin_settings.trialDirectPayEnabled at trial-request time. Null if no trial was requested.
  trialDirectPay: boolean("trial_direct_pay"),
  trialDirectPayMarkedPaidAt: timestamp("trial_direct_pay_marked_paid_at", { withTimezone: true }),
  trialDirectPayConfirmedAt: timestamp("trial_direct_pay_confirmed_at", { withTimezone: true }),
  // Monetization restructure — placement-fee commit gate. The commit flow is two-phase
  // (order then verify); these columns hold the pending state between the two calls since
  // the engagement doesn't exist yet at order-creation time.
  pendingCommitProfessionalId: integer("pending_commit_professional_id").references(() => professionalProfilesTable.id, { onDelete: "set null" }),
  pendingCommitStartDate: text("pending_commit_start_date"),
  placementFeeOrderId: text("placement_fee_order_id"),
  placementFeeAmountInr: integer("placement_fee_amount_inr"),
  // Redesigned parent↔teacher journey (Task 1 schema-only).
  // activationFeeEnabled: per-match snapshot from admin_settings at match creation, with
  //   admin override capability (currently no API reads it — future work).
  // trialDays: confirmed trial days after teacher accepts (expected 1..3).
  activationFeeEnabled: boolean("activation_fee_enabled").notNull().default(true),
  trialDays: integer("trial_days"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertShadowTeacherMatchSchema = createInsertSchema(shadowTeacherMatchesTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertShadowTeacherMatch = z.infer<typeof insertShadowTeacherMatchSchema>;
export type ShadowTeacherMatch = typeof shadowTeacherMatchesTable.$inferSelect;
