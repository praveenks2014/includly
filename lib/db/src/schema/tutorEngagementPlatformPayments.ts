import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tutorEngagementsTable } from "./tutorEngagements";
import { salaryPaymentStatusEnum } from "./engagementSalaryPayments";

// Razorpay-collect-and-remit path for ongoing tutor session payments — the
// OPPOSITE of the direct-pay default (tutor_engagement_payment_confirmations).
// This table only fills up when an engagement's directPayEnabled snapshot is
// false, i.e. an admin has deliberately switched this professional's
// ongoing payments to platform-collected. See the compliance comment on the
// pay-month/verify-month-payment routes in tutor.ts before adding anything
// that reads or writes here — collecting many professionals' session fees
// through the platform reintroduces the salary-aggregation exposure
// (TDS/GST/aggregation) that shadow-teacher's own platformSalaryEnabled
// toggle exists to isolate, not something to enable casually.
//
// No commission/cut columns (unlike engagement_salary_payments) — this
// mode was requested purely as a compliance-routing choice (who legally
// touches the money), not a new monetization lever, so the full grossInr
// is what gets collected.
export const tutorEngagementPlatformPaymentsTable = pgTable("tutor_engagement_platform_payments", {
  id: serial("id").primaryKey(),
  engagementId: integer("engagement_id").notNull().references(() => tutorEngagementsTable.id, { onDelete: "cascade" }),
  month: text("month").notNull(),
  grossInr: integer("gross_inr").notNull(),
  trialCreditInr: integer("trial_credit_inr").notNull().default(0),
  razorpayOrderId: text("razorpay_order_id"),
  razorpayPaymentId: text("razorpay_payment_id"),
  status: salaryPaymentStatusEnum("status").notNull().default("pending"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTutorEngagementPlatformPaymentSchema = createInsertSchema(tutorEngagementPlatformPaymentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTutorEngagementPlatformPayment = z.infer<typeof insertTutorEngagementPlatformPaymentSchema>;
export type TutorEngagementPlatformPayment = typeof tutorEngagementPlatformPaymentsTable.$inferSelect;
