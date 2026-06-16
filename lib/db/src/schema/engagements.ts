import { pgTable, serial, integer, text, timestamp, pgEnum, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { professionalProfilesTable } from "./professionals";
import { shadowTeacherMatchesTable } from "./shadowTeacher";
import { childrenTable } from "./children";

export const engagementStatusEnum = pgEnum("engagement_status", ["active", "paused", "notice_period", "ended"]);

export const shadowTeacherEngagementsTable = pgTable("shadow_teacher_engagements", {
  id: serial("id").primaryKey(),
  parentId: integer("parent_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  professionalId: integer("professional_id").notNull().references(() => professionalProfilesTable.id, { onDelete: "cascade" }),
  childId: integer("child_id").references(() => childrenTable.id, { onDelete: "set null" }),
  matchRequestId: integer("match_request_id").references(() => shadowTeacherMatchesTable.id, { onDelete: "set null" }),
  tier: text("tier"),
  startDate: text("start_date").notNull(),
  hoursPerWeek: integer("hours_per_week").notNull().default(0),
  monthlyFeeInr: integer("monthly_fee_inr").notNull(),
  status: engagementStatusEnum("status").notNull().default("active"),
  endDate: text("end_date"),
  endedReason: text("ended_reason"),
  nextBillingDate: text("next_billing_date"),
  billedThroughDate: text("billed_through_date"),
  notes: text("notes"),
  trialCreditInr: integer("trial_credit_inr").notNull().default(0),
  trialCreditApplied: boolean("trial_credit_applied").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertEngagementSchema = createInsertSchema(shadowTeacherEngagementsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEngagement = z.infer<typeof insertEngagementSchema>;
export type ShadowTeacherEngagement = typeof shadowTeacherEngagementsTable.$inferSelect;
