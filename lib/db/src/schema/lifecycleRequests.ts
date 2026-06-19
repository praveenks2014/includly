import { pgTable, serial, integer, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { shadowTeacherEngagementsTable } from "./engagements";
import { usersTable } from "./users";

export const lifecycleRequestTypeEnum = pgEnum("lifecycle_request_type", ["stop", "change"]);
export const lifecycleRequestMethodEnum = pgEnum("lifecycle_request_method", ["notice", "buyout"]);
export const lifecycleRequestStatusEnum = pgEnum("lifecycle_request_status", ["pending", "approved", "rejected", "completed"]);
export const lifecycleRaisedByRoleEnum = pgEnum("lifecycle_raised_by_role", ["parent", "teacher"]);

export const engagementLifecycleRequestsTable = pgTable("engagement_lifecycle_requests", {
  id: serial("id").primaryKey(),
  engagementId: integer("engagement_id").notNull().references(() => shadowTeacherEngagementsTable.id, { onDelete: "cascade" }),
  type: lifecycleRequestTypeEnum("type").notNull(),
  method: lifecycleRequestMethodEnum("method"),
  raisedByUserId: integer("raised_by_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  raisedByRole: lifecycleRaisedByRoleEnum("raised_by_role").notNull(),
  status: lifecycleRequestStatusEnum("status").notNull().default("pending"),
  reason: text("reason"),
  effectiveEndDate: text("effective_end_date"),
  adminNotes: text("admin_notes"),
  buyoutOrderId: text("buyout_order_id"),
  buyoutPaymentId: text("buyout_payment_id"),
  buyoutFeeInr: integer("buyout_fee_inr"),
  raisedAt: timestamp("raised_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertLifecycleRequestSchema = createInsertSchema(engagementLifecycleRequestsTable).omit({ id: true, createdAt: true, updatedAt: true, raisedAt: true });
export type InsertLifecycleRequest = z.infer<typeof insertLifecycleRequestSchema>;
export type EngagementLifecycleRequest = typeof engagementLifecycleRequestsTable.$inferSelect;
