import { pgTable, serial, integer, text, timestamp, boolean, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { professionalProfilesTable } from "./professionals";
import { usersTable } from "./users";
import { childrenTable } from "./children";

export const sessionStatusEnum = pgEnum("session_status", [
  "pending_payment",
  "confirmed",
  "cancelled_by_parent",
  "cancelled_by_professional",
  "completed",
  "no_show",
  // New Flow B state machine
  "requested",
  "confirmed_by_pro",
  "paid_held",
  "session_started",
  "session_completed",
  "releasable",
  "released",
  "cancelled",
  "refunded",
  "disputed",
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
  childId: integer("child_id").references(() => childrenTable.id, { onDelete: "setNull" }),
  notes: text("notes"),
  bookingType: text("booking_type").notNull().default("session"),
  assessmentOfferingId: integer("assessment_offering_id"),
  reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
  startOtp: text("start_otp"),
  endOtp: text("end_otp"),
  otpIssuedAt: timestamp("otp_issued_at", { withTimezone: true }),
  otpAttempts: integer("otp_attempts").notNull().default(0),
  otpLockedAt: timestamp("otp_locked_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  // Escrow amounts snapshot (stored at booking time, never recalculated)
  proAmountInr: integer("pro_amount_inr").notNull().default(0),
  markupInr: integer("markup_inr").notNull().default(0),
  gstInr: integer("gst_inr").notNull().default(0),
  // Release / dispute tracking
  disputeReason: text("dispute_reason"),
  disputedAt: timestamp("disputed_at", { withTimezone: true }),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  releasedBy: integer("released_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const bookingMessagesTable = pgTable(
  "booking_messages",
  {
    id: serial("id").primaryKey(),
    bookingId: integer("booking_id").notNull().references(() => sessionBookingsTable.id, { onDelete: "cascade" }),
    senderId: integer("sender_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("booking_messages_booking_id_created_at_idx").on(t.bookingId, t.createdAt)],
);

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
