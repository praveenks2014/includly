import { pgTable, serial, integer, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { professionalProfilesTable } from "./professionals";
import { tutorMatchesTable } from "./tutorMatches";
import { childrenTable } from "./children";
import { engagementStatusEnum } from "./engagements";

// Mirrors shadow_teacher_engagements structurally, adapted for per-session
// (not monthly-salary) billing:
//   - monthlyFeeInr -> perSessionFeeInr; hoursPerWeek -> sessionsPerWeek.
//   - nextBillingDate/billedThroughDate omitted — a monthly billing-cycle
//     cursor doesn't apply to per-session billing; progress is tracked per
//     row in tutor_engagement_sessions instead.
//   - platformSalaryEnabled omitted — that flag is specifically about the
//     monthly-salary payout model.
//   - absenceRetainerPct/absenceFreeDaysPerMonth/summerRetainerPct/
//     summerRetainerMonths/leaveTermsNotes omitted — retainer-during-absence
//     has no equivalent when billing is per-session (a missed session is
//     simply not charged).
// Reuses engagement_status (pending_start/active/paused/notice_period/ended/
// pending_teacher_acceptance/pending_activation_fee) as-is rather than
// duplicating it — the "teacher" in one value name is a legacy naming
// artifact of the enum, not a behavioral coupling to shadow-teacher.
export const tutorEngagementsTable = pgTable("tutor_engagements", {
  id: serial("id").primaryKey(),
  parentId: integer("parent_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  professionalId: integer("professional_id").notNull().references(() => professionalProfilesTable.id, { onDelete: "cascade" }),
  childId: integer("child_id").references(() => childrenTable.id, { onDelete: "set null" }),
  matchRequestId: integer("match_request_id").references(() => tutorMatchesTable.id, { onDelete: "set null" }),
  startDate: text("start_date").notNull(),
  sessionsPerWeek: integer("sessions_per_week").notNull().default(0),
  perSessionFeeInr: integer("per_session_fee_inr").notNull(),
  status: engagementStatusEnum("status").notNull().default("active"),
  endDate: text("end_date"),
  endedReason: text("ended_reason"),
  notes: text("notes"),
  trialCreditInr: integer("trial_credit_inr").notNull().default(0),
  trialCreditApplied: boolean("trial_credit_applied").notNull().default(false),
  // Engagement-start OTP (once, at commit) — same mechanism/shape as
  // shadow_teacher_engagements.startOtp. Recurring per-session attendance is
  // tracked separately in tutor_engagement_sessions.
  startOtp: text("start_otp"),
  placementFeeInr: integer("placement_fee_inr"),
  placementFeePaymentId: integer("placement_fee_payment_id"),
  activationFeeInr: integer("activation_fee_inr"),
  activationFeePaymentId: integer("activation_fee_payment_id"),
  activationFeeOrderId: text("activation_fee_order_id"),
  // Ongoing SESSION payment mode — snapshotted from admin_settings.
  // tutorDirectPayEnabled at commit time (see that column for the
  // compliance rationale). true = direct-pay (default); false = collected
  // via Razorpay instead of direct UPI.
  directPayEnabled: boolean("direct_pay_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTutorEngagementSchema = createInsertSchema(tutorEngagementsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTutorEngagement = z.infer<typeof insertTutorEngagementSchema>;
export type TutorEngagement = typeof tutorEngagementsTable.$inferSelect;
