import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { professionalProfilesTable } from "./professionals";

export const connectThreadsTable = pgTable("connect_threads", {
  id: serial("id").primaryKey(),
  parentId: integer("parent_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  professionalId: integer("professional_id").notNull().references(() => professionalProfilesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const connectMessagesTable = pgTable(
  "connect_messages",
  {
    id: serial("id").primaryKey(),
    threadId: integer("thread_id").notNull().references(() => connectThreadsTable.id, { onDelete: "cascade" }),
    senderId: integer("sender_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("connect_messages_thread_id_created_at_idx").on(t.threadId, t.createdAt)],
);

export const insertConnectThreadSchema = createInsertSchema(connectThreadsTable).omit({ id: true, createdAt: true });
export type InsertConnectThread = z.infer<typeof insertConnectThreadSchema>;
export type ConnectThread = typeof connectThreadsTable.$inferSelect;

export const insertConnectMessageSchema = createInsertSchema(connectMessagesTable).omit({ id: true, createdAt: true });
export type InsertConnectMessage = z.infer<typeof insertConnectMessageSchema>;
export type ConnectMessage = typeof connectMessagesTable.$inferSelect;
