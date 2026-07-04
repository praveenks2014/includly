import { pgTable, serial, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const settingsAuditLogTable = pgTable("settings_audit_log", {
  id: serial("id").primaryKey(),
  adminUserId: integer("admin_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  changes: jsonb("changes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSettingsAuditLogSchema = createInsertSchema(settingsAuditLogTable).omit({ id: true, createdAt: true });
export type InsertSettingsAuditLog = z.infer<typeof insertSettingsAuditLogSchema>;
export type SettingsAuditLog = typeof settingsAuditLogTable.$inferSelect;
