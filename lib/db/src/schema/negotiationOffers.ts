import { pgTable, serial, integer, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { shadowTeacherMatchesTable } from "./shadowTeacher";
import { shadowMatchCandidatesTable } from "./shadowMatchCandidates";
import { usersTable } from "./users";

export const negotiationOfferStatusEnum = pgEnum("negotiation_offer_status", [
  "pending", "accepted", "superseded", "withdrawn",
]);

export const negotiationOffersTable = pgTable("negotiation_offers", {
  id: serial("id").primaryKey(),
  matchId: integer("match_id").notNull().references(() => shadowTeacherMatchesTable.id, { onDelete: "cascade" }),
  candidateId: integer("candidate_id").notNull().references(() => shadowMatchCandidatesTable.id, { onDelete: "cascade" }),
  raisedByUserId: integer("raised_by_user_id").notNull().references(() => usersTable.id),
  raisedByRole: text("raised_by_role").notNull(),
  amountInr: integer("amount_inr").notNull(),
  // Non-salary agreed terms, negotiated as part of the offer package.
  // Data-capture only: no downstream automation reads these yet. Loss-of-pay
  // calc, absence tracking, retainer payouts, and leave request flows are
  // separate future work — do not assume these are enforced.
  absenceRetainerPct: integer("absence_retainer_pct").notNull().default(50),
  absenceFreeDaysPerMonth: integer("absence_free_days_per_month").notNull().default(4),
  summerRetainerPct: integer("summer_retainer_pct").notNull().default(0),
  summerRetainerMonths: integer("summer_retainer_months").notNull().default(0),
  leaveTermsNotes: text("leave_terms_notes"),
  status: negotiationOfferStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type NegotiationOffer = typeof negotiationOffersTable.$inferSelect;
