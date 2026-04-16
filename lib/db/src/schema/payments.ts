import { pgTable, text, serial, timestamp, integer, real, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { professionalProfilesTable } from "./professionals";

export const paymentProviderEnum = pgEnum("payment_provider", ["stripe", "razorpay"]);
export const paymentStatusEnum = pgEnum("payment_status", ["pending", "completed", "failed", "refunded"]);
export const paymentPlanEnum = pgEnum("payment_plan", ["plan_a_subscription", "plan_b_per_contact", "plan_c_featured", "plan_d_pro_onetime", "plan_e_pro_monthly", "plan_f_per_booking", "plan_session_pass_5", "plan_session_pass_10"]);

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  plan: paymentPlanEnum("plan").notNull(),
  provider: paymentProviderEnum("provider").notNull(),
  providerPaymentId: text("provider_payment_id"),
  providerOrderId: text("provider_order_id"),
  amountPaise: integer("amount_paise").notNull(),
  currency: text("currency").notNull().default("INR"),
  status: paymentStatusEnum("status").notNull().default("pending"),
  professionalId: integer("professional_id").references(() => professionalProfilesTable.id, { onDelete: "set null" }),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptionsTable = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  provider: paymentProviderEnum("provider").notNull(),
  providerSubscriptionId: text("provider_subscription_id"),
  plan: text("plan").notNull().default("plan_a"),
  status: text("status").notNull().default("active"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const professionalSubscriptionsTable = pgTable("professional_subscriptions", {
  id: serial("id").primaryKey(),
  professionalId: integer("professional_id").notNull().references(() => professionalProfilesTable.id, { onDelete: "cascade" }),
  provider: paymentProviderEnum("provider").notNull(),
  providerSubscriptionId: text("provider_subscription_id"),
  plan: text("plan").notNull().default("plan_e_pro_monthly"),
  status: text("status").notNull().default("active"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;

export const insertSubscriptionSchema = createInsertSchema(subscriptionsTable).omit({ id: true, createdAt: true });
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptionsTable.$inferSelect;

export const insertProfessionalSubscriptionSchema = createInsertSchema(professionalSubscriptionsTable).omit({ id: true, createdAt: true });
export type InsertProfessionalSubscription = z.infer<typeof insertProfessionalSubscriptionSchema>;
export type ProfessionalSubscription = typeof professionalSubscriptionsTable.$inferSelect;
