import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { shadowTeacherEngagementsTable } from "./engagements";

export const engagementSalaryConfirmationsTable = pgTable("engagement_salary_confirmations", {
  id: serial("id").primaryKey(),
  engagementId: integer("engagement_id").notNull().references(() => shadowTeacherEngagementsTable.id, { onDelete: "cascade" }),
  month: text("month").notNull(),
  amountInr: integer("amount_inr").notNull(),
  markedPaidAt: timestamp("marked_paid_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEngagementSalaryConfirmationSchema = createInsertSchema(engagementSalaryConfirmationsTable).omit({ id: true, createdAt: true });
export type InsertEngagementSalaryConfirmation = z.infer<typeof insertEngagementSalaryConfirmationSchema>;
export type EngagementSalaryConfirmation = typeof engagementSalaryConfirmationsTable.$inferSelect;
