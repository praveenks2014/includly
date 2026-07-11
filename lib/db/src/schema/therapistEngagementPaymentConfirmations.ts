import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { therapistEngagementsTable } from "./therapistEngagements";

// Mirrors engagement_salary_confirmations' shape — used ONLY when the
// engagement's billingCadence is 'monthly' (per_session cadence uses the
// paidAmountInr/paidAt columns on therapist_engagement_sessions instead).
// Same computed-not-hardcoded amountInr rule as tutor_engagement_payment_
// confirmations: perSessionFeeInr × completed-session-count for the month.
export const therapistEngagementPaymentConfirmationsTable = pgTable("therapist_engagement_payment_confirmations", {
  id: serial("id").primaryKey(),
  engagementId: integer("engagement_id").notNull().references(() => therapistEngagementsTable.id, { onDelete: "cascade" }),
  month: text("month").notNull(),
  amountInr: integer("amount_inr").notNull(),
  markedPaidAt: timestamp("marked_paid_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTherapistEngagementPaymentConfirmationSchema = createInsertSchema(therapistEngagementPaymentConfirmationsTable).omit({ id: true, createdAt: true });
export type InsertTherapistEngagementPaymentConfirmation = z.infer<typeof insertTherapistEngagementPaymentConfirmationSchema>;
export type TherapistEngagementPaymentConfirmation = typeof therapistEngagementPaymentConfirmationsTable.$inferSelect;
