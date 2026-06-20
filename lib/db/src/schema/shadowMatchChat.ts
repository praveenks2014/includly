import { pgTable, serial, integer, text, timestamp, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { shadowTeacherMatchesTable } from "./shadowTeacher";
import { professionalProfilesTable } from "./professionals";
import { usersTable } from "./users";

export const shadowMatchThreadsTable = pgTable(
  "shadow_match_threads",
  {
    id: serial("id").primaryKey(),
    matchId: integer("match_id")
      .notNull()
      .references(() => shadowTeacherMatchesTable.id, { onDelete: "cascade" }),
    professionalId: integer("professional_id")
      .notNull()
      .references(() => professionalProfilesTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("shadow_match_threads_match_pro_unique").on(t.matchId, t.professionalId),
    index("shadow_match_threads_match_id_idx").on(t.matchId),
  ],
);

export const shadowMatchMessagesTable = pgTable(
  "shadow_match_messages",
  {
    id: serial("id").primaryKey(),
    threadId: integer("thread_id")
      .notNull()
      .references(() => shadowMatchThreadsTable.id, { onDelete: "cascade" }),
    senderId: integer("sender_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    msgType: text("msg_type").notNull().default("text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("shadow_match_messages_thread_id_created_at_idx").on(t.threadId, t.createdAt)],
);

export const insertShadowMatchThreadSchema = createInsertSchema(shadowMatchThreadsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertShadowMatchThread = z.infer<typeof insertShadowMatchThreadSchema>;
export type ShadowMatchThread = typeof shadowMatchThreadsTable.$inferSelect;

export const insertShadowMatchMessageSchema = createInsertSchema(shadowMatchMessagesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertShadowMatchMessage = z.infer<typeof insertShadowMatchMessageSchema>;
export type ShadowMatchMessage = typeof shadowMatchMessagesTable.$inferSelect;
