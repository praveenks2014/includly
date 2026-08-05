import { pgTable, serial, integer, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const platformDuesInvoiceStatusEnum = pgEnum("platform_dues_invoice_status", ["pending", "paid", "overdue", "waived"]);

// B8 — platform-owed-money ledger. Generic across owner types (a centre
// owing its commission cut today; an individual professional's own
// commission-owed case later, without rebuilding this) rather than
// centre-specific, per the explicit decision to build B8 once, reusably.
// Two-tier: charges are the atomic, never-mutated unit; invoices are the
// payable rollup an owner actually settles against. A charge only ever
// comes from an OTP-confirmed completed session (see the upcoming
// attendance sub-build) — never a scheduled/expected count, so an invoice
// can never overstate what actually happened.
export const platformDuesChargesTable = pgTable("platform_dues_charges", {
  id: serial("id").primaryKey(),
  // Polymorphic — 'centre' -> therapy_centres.id, 'professional' ->
  // professional_profiles.id. No FK: a single column can't reference two
  // different tables; enforced at the application layer, same soft-
  // reference convention already used elsewhere in this codebase
  // (verifiedBy/rejectedBy/decidedBy/releasedBy).
  ownerType: text("owner_type").notNull(),
  ownerId: integer("owner_id").notNull(),
  // What generated this charge — e.g. 'session_commission' today.
  // Deliberately text, not enum, so a new sourceType never needs a
  // migration to add.
  sourceType: text("source_type").notNull(),
  // The originating row (a session/booking id) — soft reference, same
  // reasoning as ownerId above. Essential for tracing an invoice line item
  // back to the exact session it came from during a dispute review.
  sourceId: integer("source_id").notNull(),
  amountInr: integer("amount_inr").notNull(),
  duesInvoiceId: integer("dues_invoice_id").references(() => platformDuesInvoicesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One payable unit. New charges for an owner attach to their currently
// OPEN (pending) invoice if one exists; otherwise a new invoice is created
// with dueAt = now + platformDuesTimeoutDays. dueAt is set once and never
// extended by later charges — deliberately no cron/batch process for
// invoice creation, driven entirely by charge-posting time, same
// "do it inline at the point of the writing event" style already used
// elsewhere (e.g. commission deduction at release time).
export const platformDuesInvoicesTable = pgTable("platform_dues_invoices", {
  id: serial("id").primaryKey(),
  ownerType: text("owner_type").notNull(),
  ownerId: integer("owner_id").notNull(),
  totalAmountInr: integer("total_amount_inr").notNull().default(0),
  status: platformDuesInvoiceStatusEnum("status").notNull().default("pending"),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  markedPaidByUserId: integer("marked_paid_by_user_id").references(() => usersTable.id),
  waivedReason: text("waived_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type PlatformDuesCharge = typeof platformDuesChargesTable.$inferSelect;
export type PlatformDuesInvoice = typeof platformDuesInvoicesTable.$inferSelect;
