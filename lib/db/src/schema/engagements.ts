import { pgTable, serial, integer, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { professionalProfilesTable } from "./professionals";

export const engagementStatusEnum = pgEnum("engagement_status", ["active", "paused", "ended"]);

export const shadowTeacherEngagementsTable = pgTable("shadow_teacher_engagements", {
  id: serial("id").primaryKey(),
  parentId: integer("parent_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  professionalId: integer("professional_id").notNull().references(() => professionalProfilesTable.id, { onDelete: "cascade" }),
  childId: integer("child_id"),
  startDate: text("start_date").notNull(),
  hoursPerWeek: integer("hours_per_week").notNull(),
  monthlyFeeInr: integer("monthly_fee_inr").notNull(),
  status: engagementStatusEnum("status").notNull().default("active"),
  nextBillingDate: text("next_billing_date"),
  billedThroughDate: text("billed_through_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertEngagementSchema = createInsertSchema(shadowTeacherEngagementsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEngagement = z.infer<typeof insertEngagementSchema>;
export type ShadowTeacherEngagement = typeof shadowTeacherEngagementsTable.$inferSelect;
