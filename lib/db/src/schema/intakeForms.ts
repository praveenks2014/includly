import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sessionBookingsTable } from "./sessions";
import { usersTable } from "./users";

export const intakeFormsTable = pgTable("intake_forms", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull().references(() => sessionBookingsTable.id, { onDelete: "cascade" }),
  parentId: integer("parent_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  goals: text("goals"),
  concerns: text("concerns"),
  additionalInfo: text("additional_info"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertIntakeFormSchema = createInsertSchema(intakeFormsTable).omit({ id: true, createdAt: true });
export type InsertIntakeForm = z.infer<typeof insertIntakeFormSchema>;
export type IntakeForm = typeof intakeFormsTable.$inferSelect;
