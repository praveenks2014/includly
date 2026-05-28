import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { shadowTeacherEngagementsTable } from "./engagements";
import { usersTable } from "./users";

export const engagementLogsTable = pgTable("engagement_logs", {
  id: serial("id").primaryKey(),
  engagementId: integer("engagement_id").notNull().references(() => shadowTeacherEngagementsTable.id, { onDelete: "cascade" }),
  weekStartDate: text("week_start_date").notNull(),
  hoursLogged: integer("hours_logged").notNull(),
  notes: text("notes"),
  loggedByUserId: integer("logged_by_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEngagementLogSchema = createInsertSchema(engagementLogsTable).omit({ id: true, createdAt: true });
export type InsertEngagementLog = z.infer<typeof insertEngagementLogSchema>;
export type EngagementLog = typeof engagementLogsTable.$inferSelect;
