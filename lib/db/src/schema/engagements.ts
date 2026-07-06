import { pgTable, serial, integer, text, timestamp, pgEnum, boolean } from "drizzle-orm/pg-core";
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
  // Monetization restructure — per-row snapshot of the salary model in effect for this
  // engagement. Backfilled true for all pre-existing rows so their behavior never changes;
  // new rows snapshot the live admin_settings.platformSalaryEnabled value at commit time.
  platformSalaryEnabled: boolean("platform_salary_enabled").notNull().default(true),
  placementFeeInr: integer("placement_fee_inr"),
  placementFeePaymentId: integer("placement_fee_payment_id"),
  activationFeeInr: integer("activation_fee_inr"),
  activationFeePaymentId: integer("activation_fee_payment_id"),
  activationFeeOrderId: text("activation_fee_order_id"),
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
