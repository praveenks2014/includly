import { pgTable, serial, integer, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { shadowTeacherEngagementsTable } from "./engagements";
import { usersTable } from "./users";

export const dailyLogAuthorRoleEnum = pgEnum("daily_log_author_role", ["teacher", "parent"]);

export const engagementDailyLogsTable = pgTable("engagement_daily_logs", {
  id: serial("id").primaryKey(),
  engagementId: integer("engagement_id").notNull().references(() => shadowTeacherEngagementsTable.id, { onDelete: "cascade" }),
  authorUserId: integer("author_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  authorRole: dailyLogAuthorRoleEnum("author_role").notNull(),
  logDate: text("log_date").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDailyLogSchema = createInsertSchema(engagementDailyLogsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDailyLog = z.infer<typeof insertDailyLogSchema>;
export type EngagementDailyLog = typeof engagementDailyLogsTable.$inferSelect;
