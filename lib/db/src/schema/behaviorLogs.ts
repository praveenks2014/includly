import { pgTable, serial, integer, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { childrenTable } from "./children";
import { shadowTeacherEngagementsTable } from "./engagements";
import { engagementDailyLogsTable } from "./engagementDailyLogs";

export const behaviorLogsTable = pgTable("behavior_logs", {
  id:              serial("id").primaryKey(),
  childId:         integer("child_id").notNull().references(() => childrenTable.id, { onDelete: "cascade" }),
  engagementId:    integer("engagement_id").references(() => shadowTeacherEngagementsTable.id, { onDelete: "set null" }),
  dailyLogId:      integer("daily_log_id").references(() => engagementDailyLogsTable.id, { onDelete: "set null" }),
  loggedBy:        integer("logged_by").notNull().references(() => usersTable.id),
  occurredAt:      timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  tantrumTypes:    text("tantrum_types").array().notNull(),
  triggers:        text("triggers").array(),
  durationMinutes: integer("duration_minutes"),
  intensity:       text("intensity").notNull(),
  notes:           text("notes"),
  strategies:      jsonb("strategies").notNull().default([]),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type BehaviorLog    = typeof behaviorLogsTable.$inferSelect;
export type InsertBehaviorLog = typeof behaviorLogsTable.$inferInsert;
