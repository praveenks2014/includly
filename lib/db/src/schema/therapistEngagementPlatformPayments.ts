import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { therapistEngagementsTable } from "./therapistEngagements";
import { therapistEngagementSessionsTable } from "./therapistEngagementSessions";
import { salaryPaymentStatusEnum } from "./engagementSalaryPayments";

// Razorpay-collect-and-remit path for ongoing therapist session payments —
// see tutor_engagement_platform_payments for the full compliance rationale
// (identical here). Covers BOTH billing cadences in one table: exactly one
// of `month` (monthly cadence) / `sessionId` (per_session cadence) is set
// per row, application-side — mirrors the same monthly-vs-per-session
// duality already used on the direct-pay side (payment_confirmations table
// for monthly XOR paidAmountInr/paidAt directly on the session row for
// per_session), rather than inventing a third shape.
export const therapistEngagementPlatformPaymentsTable = pgTable("therapist_engagement_platform_payments", {
  id: serial("id").primaryKey(),
  engagementId: integer("engagement_id").notNull().references(() => therapistEngagementsTable.id, { onDelete: "cascade" }),
  month: text("month"),
  sessionId: integer("session_id").references(() => therapistEngagementSessionsTable.id, { onDelete: "cascade" }),
  grossInr: integer("gross_inr").notNull(),
  trialCreditInr: integer("trial_credit_inr").notNull().default(0),
  razorpayOrderId: text("razorpay_order_id"),
  razorpayPaymentId: text("razorpay_payment_id"),
  status: salaryPaymentStatusEnum("status").notNull().default("pending"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTherapistEngagementPlatformPaymentSchema = createInsertSchema(therapistEngagementPlatformPaymentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTherapistEngagementPlatformPayment = z.infer<typeof insertTherapistEngagementPlatformPaymentSchema>;
export type TherapistEngagementPlatformPayment = typeof therapistEngagementPlatformPaymentsTable.$inferSelect;
