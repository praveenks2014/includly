import { pgTable, serial, integer, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const ledgerStatusEnum = pgEnum("ledger_status", ["held", "released", "refunded"]);
export const ledgerBookingTypeEnum = pgEnum("ledger_booking_type", ["session", "package", "subscription", "engagement"]);

export const paymentLedgerTable = pgTable("payment_ledger", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id"),
  engagementId: integer("engagement_id"),
  parentId: integer("parent_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  professionalUserId: integer("professional_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  amountInr: integer("amount_inr").notNull(),
  commissionInr: integer("commission_inr").notNull().default(0),
  commissionPct: integer("commission_pct").notNull().default(0),
  bookingType: ledgerBookingTypeEnum("booking_type").notNull().default("session"),
  status: ledgerStatusEnum("status").notNull().default("held"),
  note: text("note"),
  heldAt: timestamp("held_at", { withTimezone: true }).notNull().defaultNow(),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPaymentLedgerSchema = createInsertSchema(paymentLedgerTable).omit({ id: true, createdAt: true, heldAt: true });
export type InsertPaymentLedger = z.infer<typeof insertPaymentLedgerSchema>;
export type PaymentLedger = typeof paymentLedgerTable.$inferSelect;
