import { pgTable, serial, integer, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { sessionBookingsTable } from "./sessions";

export const payoutStatusEnum = pgEnum("payout_status", [
  "pending",
  "released",
  "failed",
  "refunded",
]);

export const bookingPayoutsTable = pgTable("booking_payouts", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull().references(() => sessionBookingsTable.id, { onDelete: "cascade" }),
  professionalUserId: integer("professional_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  proAmountInr: integer("pro_amount_inr").notNull(),
  markupInr: integer("markup_inr").notNull().default(0),
  gstInr: integer("gst_inr").notNull().default(0),
  totalCollectedInr: integer("total_collected_inr").notNull(),
  upiVpa: text("upi_vpa"),
  razorpayPayoutId: text("razorpay_payout_id"),
  status: payoutStatusEnum("status").notNull().default("pending"),
  note: text("note"),
  releasedBy: integer("released_by").references(() => usersTable.id, { onDelete: "set null" }),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBookingPayoutSchema = createInsertSchema(bookingPayoutsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertBookingPayout = z.infer<typeof insertBookingPayoutSchema>;
export type BookingPayout = typeof bookingPayoutsTable.$inferSelect;
