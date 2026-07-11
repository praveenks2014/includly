import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tutorEngagementsTable } from "./tutorEngagements";

// Mirrors engagement_salary_confirmations' shape exactly (the direct-pay
// "parent marks paid, professional confirms received" half only — NOT
// engagement_salary_payments' platform-mediated payroll/escrow half, which
// isn't being mirrored here).
//
// Tutor billing is ALWAYS monthly. amountInr is never hardcoded — the
// mark-as-paid endpoint computes it as
// perSessionFeeInr × count(tutor_engagement_sessions WHERE status='completed'
// AND sessionDate falls within `month`) at the moment of marking, and shows
// that computed figure to the parent before they confirm.
export const tutorEngagementPaymentConfirmationsTable = pgTable("tutor_engagement_payment_confirmations", {
  id: serial("id").primaryKey(),
  engagementId: integer("engagement_id").notNull().references(() => tutorEngagementsTable.id, { onDelete: "cascade" }),
  month: text("month").notNull(),
  amountInr: integer("amount_inr").notNull(),
  markedPaidAt: timestamp("marked_paid_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTutorEngagementPaymentConfirmationSchema = createInsertSchema(tutorEngagementPaymentConfirmationsTable).omit({ id: true, createdAt: true });
export type InsertTutorEngagementPaymentConfirmation = z.infer<typeof insertTutorEngagementPaymentConfirmationSchema>;
export type TutorEngagementPaymentConfirmation = typeof tutorEngagementPaymentConfirmationsTable.$inferSelect;
