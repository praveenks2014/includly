import { pgTable, serial, integer, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { shadowTeacherEngagementsTable } from "./engagements";

export const salaryPaymentStatusEnum = pgEnum("salary_payment_status", ["pending", "paid", "overdue", "failed"]);

export const engagementSalaryPaymentsTable = pgTable("engagement_salary_payments", {
  id: serial("id").primaryKey(),
  engagementId: integer("engagement_id").notNull().references(() => shadowTeacherEngagementsTable.id, { onDelete: "cascade" }),
  month: text("month").notNull(),
  grossInr: integer("gross_inr").notNull(),
  platformCutInr: integer("platform_cut_inr").notNull(),
  netInr: integer("net_inr").notNull(),
  razorpayOrderId: text("razorpay_order_id"),
  razorpayPaymentId: text("razorpay_payment_id"),
  status: salaryPaymentStatusEnum("status").notNull().default("pending"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSalaryPaymentSchema = createInsertSchema(engagementSalaryPaymentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSalaryPayment = z.infer<typeof insertSalaryPaymentSchema>;
export type EngagementSalaryPayment = typeof engagementSalaryPaymentsTable.$inferSelect;
