import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sessionBookingsTable } from "./sessions";
import { usersTable } from "./users";

export const sessionNotesTable = pgTable("session_notes", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull().references(() => sessionBookingsTable.id, { onDelete: "cascade" }),
  authorId: integer("author_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  privateNotes: text("private_notes"),
  parentSummary: text("parent_summary"),
  progressMarkers: text("progress_markers"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSessionNoteSchema = createInsertSchema(sessionNotesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSessionNote = z.infer<typeof insertSessionNoteSchema>;
export type SessionNote = typeof sessionNotesTable.$inferSelect;
