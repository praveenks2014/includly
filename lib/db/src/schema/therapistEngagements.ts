import { pgTable, serial, integer, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { professionalProfilesTable } from "./professionals";
import { therapistMatchesTable } from "./therapistMatches";
import { childrenTable } from "./children";
import { engagementStatusEnum } from "./engagements";
import { therapistBillingCadenceEnum } from "./professionals";

// Mirrors shadow_teacher_engagements structurally, adapted for per-session
// billing — see tutor_engagements for the detailed rationale on each
// omitted/renamed field (monthlyFeeInr -> perSessionFeeInr, hoursPerWeek ->
// sessionsPerWeek, no billing-cycle cursor, no absence/retainer terms).
export const therapistEngagementsTable = pgTable("therapist_engagements", {
  id: serial("id").primaryKey(),
  parentId: integer("parent_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  professionalId: integer("professional_id").notNull().references(() => professionalProfilesTable.id, { onDelete: "cascade" }),
  childId: integer("child_id").references(() => childrenTable.id, { onDelete: "set null" }),
  matchRequestId: integer("match_request_id").references(() => therapistMatchesTable.id, { onDelete: "set null" }),
  startDate: text("start_date").notNull(),
  sessionsPerWeek: integer("sessions_per_week").notNull().default(0),
  perSessionFeeInr: integer("per_session_fee_inr").notNull(),
  // Snapshotted from the offering's billingCadence at commit time (Prompt
  // 2C) — same snapshot discipline as placementFeeInr/activationFeeInr, so
  // a professional changing their cadence choice later doesn't retroactively
  // alter an engagement already underway.
  billingCadence: therapistBillingCadenceEnum("billing_cadence").notNull(),
  status: engagementStatusEnum("status").notNull().default("active"),
  endDate: text("end_date"),
  endedReason: text("ended_reason"),
  notes: text("notes"),
  trialCreditInr: integer("trial_credit_inr").notNull().default(0),
  trialCreditApplied: boolean("trial_credit_applied").notNull().default(false),
  // Engagement-start OTP (once, at commit) — same mechanism/shape as
  // shadow_teacher_engagements.startOtp. Recurring per-session attendance is
  // tracked separately in therapist_engagement_sessions.
  startOtp: text("start_otp"),
  placementFeeInr: integer("placement_fee_inr"),
  placementFeePaymentId: integer("placement_fee_payment_id"),
  activationFeeInr: integer("activation_fee_inr"),
  activationFeePaymentId: integer("activation_fee_payment_id"),
  activationFeeOrderId: text("activation_fee_order_id"),
  // Ongoing SESSION payment mode — snapshotted from admin_settings.
  // therapistDirectPayEnabled at commit time (see that column for the
  // compliance rationale). true = direct-pay (default); false = collected
  // via Razorpay instead of direct UPI.
  directPayEnabled: boolean("direct_pay_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTherapistEngagementSchema = createInsertSchema(therapistEngagementsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTherapistEngagement = z.infer<typeof insertTherapistEngagementSchema>;
export type TherapistEngagement = typeof therapistEngagementsTable.$inferSelect;
