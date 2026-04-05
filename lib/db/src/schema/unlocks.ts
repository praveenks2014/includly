import { pgTable, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { professionalProfilesTable } from "./professionals";

export const contactUnlocksTable = pgTable("contact_unlocks", {
  id: serial("id").primaryKey(),
  parentId: integer("parent_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  professionalId: integer("professional_id").notNull().references(() => professionalProfilesTable.id, { onDelete: "cascade" }),
  unlockedAt: timestamp("unlocked_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertContactUnlockSchema = createInsertSchema(contactUnlocksTable).omit({ id: true, unlockedAt: true });
export type InsertContactUnlock = z.infer<typeof insertContactUnlockSchema>;
export type ContactUnlock = typeof contactUnlocksTable.$inferSelect;
