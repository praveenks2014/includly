import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const adminSettingsTable = pgTable("admin_settings", {
  id: serial("id").primaryKey(),
  contactLimitPerParent: integer("contact_limit_per_parent").notNull().default(5),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAdminSettingSchema = createInsertSchema(adminSettingsTable).omit({ id: true, updatedAt: true });
export type InsertAdminSetting = z.infer<typeof insertAdminSettingSchema>;
export type AdminSettings = typeof adminSettingsTable.$inferSelect;

export const DEFAULT_CONTACT_LIMIT = 5;
