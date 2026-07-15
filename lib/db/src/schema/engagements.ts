import { pgTable, serial, integer, text, timestamp, pgEnum, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { professionalProfilesTable } from "./professionals";
import { shadowTeacherMatchesTable } from "./shadowTeacher";
import { childrenTable } from "./children";

export const engagementStatusEnum = pgEnum("engagement_status", ["pending_start", "active", "paused", "notice_period", "ended", "pending_teacher_acceptance", "pending_activation_fee"]);

export const shadowTeacherEngagementsTable = pgTable("shadow_teacher_engagements", {
  id: serial("id").primaryKey(),
  parentId: integer("parent_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  professionalId: integer("professional_id").notNull().references(() => professionalProfilesTable.id, { onDelete: "cascade" }),
  childId: integer("child_id").references(() => childrenTable.id, { onDelete: "set null" }),
  matchRequestId: integer("match_request_id").references(() => shadowTeacherMatchesTable.id, { onDelete: "set null" }),
  tier: text("tier"),
  startDate: text("start_date").notNull(),
  hoursPerWeek: integer("hours_per_week").notNull().default(0),
  monthlyFeeInr: integer("monthly_fee_inr").notNull(),
  status: engagementStatusEnum("status").notNull().default("active"),
  endDate: text("end_date"),
  endedReason: text("ended_reason"),
  nextBillingDate: text("next_billing_date"),
  billedThroughDate: text("billed_through_date"),
  notes: text("notes"),
  trialCreditInr: integer("trial_credit_inr").notNull().default(0),
  trialCreditApplied: boolean("trial_credit_applied").notNull().default(false),
  startOtp: text("start_otp"),
  // Block-only weekly commitment, captured from the TEACHER at accept time (not
  // the parent at commit) — the teacher is the one whose calendar this
  // represents. Required on the accept action itself; nullable only because
  // pre-feature rows (accepted before this existed) have none. Shape:
  // { dayOfWeek: 0-6, startTime: "HH:MM", endTime: "HH:MM" }[]
  recurringScheduleJson: jsonb("recurring_schedule_json"),
  // Terms-of-engagement acknowledgment — a record of agreed terms, not a
  // binding contract. Stamped independently since parent acknowledges at
  // commit and teacher acknowledges at accept (two different moments).
  // Nullable for pre-feature rows.
  parentTermsAcknowledgedAt: timestamp("parent_terms_acknowledged_at", { withTimezone: true }),
  teacherTermsAcknowledgedAt: timestamp("teacher_terms_acknowledged_at", { withTimezone: true }),
  // Monetization restructure — per-row snapshot of the salary model in effect for this
  // engagement. Backfilled true for all pre-existing rows so their behavior never changes;
  // new rows snapshot the live admin_settings.platformSalaryEnabled value at commit time.
  platformSalaryEnabled: boolean("platform_salary_enabled").notNull().default(true),
  placementFeeInr: integer("placement_fee_inr"),
  placementFeePaymentId: integer("placement_fee_payment_id"),
  activationFeeInr: integer("activation_fee_inr"),
  activationFeePaymentId: integer("activation_fee_payment_id"),
  activationFeeOrderId: text("activation_fee_order_id"),
  // Stuck-engagement lazy-timeout resolution — precise "waiting since" marks
  // for the two states createdAt doesn't cover (pending_teacher_acceptance's
  // clock is just createdAt, already exact). Stamped at the exact moment of
  // transition in teacher-acceptance (accept branch) and activation-fee/verify
  // — write-only additions, no business-logic change to those endpoints. See
  // stuckEngagementResolver.ts for how these are read.
  pendingActivationFeeSince: timestamp("pending_activation_fee_since", { withTimezone: true }),
  pendingStartSince: timestamp("pending_start_since", { withTimezone: true }),
  // Snapshotted from the accepted negotiation offer at commit time. Nullable so
  // pre-feature engagements don't falsely appear to have agreed to specific
  // terms. Data-capture only: no downstream automation reads these yet
  // (retainer payouts, absence tracking, leave flows are future work).
  absenceRetainerPct: integer("absence_retainer_pct"),
  absenceFreeDaysPerMonth: integer("absence_free_days_per_month"),
  summerRetainerPct: integer("summer_retainer_pct"),
  summerRetainerMonths: integer("summer_retainer_months"),
  leaveTermsNotes: text("leave_terms_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertEngagementSchema = createInsertSchema(shadowTeacherEngagementsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEngagement = z.infer<typeof insertEngagementSchema>;
export type ShadowTeacherEngagement = typeof shadowTeacherEngagementsTable.$inferSelect;
