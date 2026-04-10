import { pgTable, serial, integer, text, timestamp, boolean, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { professionalProfilesTable } from "./professionals";
import { usersTable } from "./users";

export const sessionStatusEnum = pgEnum("session_status", [
  "pending_payment",
  "confirmed",
  "cancelled_by_parent",
  "cancelled_by_professional",
  "completed",
  "no_show",
]);

export const professionalAvailabilityTable = pgTable("professional_availability", {
  id: serial("id").primaryKey(),
  professionalId: integer("professional_id").notNull().references(() => professionalProfilesTable.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  slotDurationMinutes: integer("slot_duration_minutes").notNull().default(60),
  priceInr: integer("price_inr").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const sessionBookingsTable = pgTable("session_bookings", {
  id: serial("id").primaryKey(),
  professionalId: integer("professional_id").notNull().references(() => professionalProfilesTable.id, { onDelete: "cascade" }),
  parentId: integer("parent_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  bookedDate: text("booked_date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  amountInr: integer("amount_inr").notNull(),
  commissionInr: integer("commission_inr").notNull().default(0),
  status: sessionStatusEnum("status").notNull().default("pending_payment"),
  providerOrderId: text("provider_order_id"),
  providerPaymentId: text("provider_payment_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProfessionalAvailabilitySchema = createInsertSchema(professionalAvailabilityTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProfessionalAvailability = z.infer<typeof insertProfessionalAvailabilitySchema>;
export type ProfessionalAvailability = typeof professionalAvailabilityTable.$inferSelect;

export const insertSessionBookingSchema = createInsertSchema(sessionBookingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
  providerOrderId: true,
  providerPaymentId: true,
});
export type InsertSessionBooking = z.infer<typeof insertSessionBookingSchema>;
export type SessionBooking = typeof sessionBookingsTable.$inferSelect;
