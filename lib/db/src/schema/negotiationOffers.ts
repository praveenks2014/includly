import { pgTable, serial, integer, text, timestamp, pgEnum, boolean } from "drizzle-orm/pg-core";
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
  // #12 retainer-defaults update: absenceFreeDaysPerMonth 4->2,
  // absenceRetainerPct 50->0 (teacher's own absence beyond the free days is
  // now unpaid by default, matching the confirmed defaults).
  absenceRetainerPct: integer("absence_retainer_pct").notNull().default(0),
  absenceFreeDaysPerMonth: integer("absence_free_days_per_month").notNull().default(2),
  summerRetainerPct: integer("summer_retainer_pct").notNull().default(0),
  summerRetainerMonths: integer("summer_retainer_months").notNull().default(0),
  leaveTermsNotes: text("leave_terms_notes"),
  // #12 — child's OWN sick-leave/absence (distinct from the teacher's own
  // absence above): full pay up to the free-days allowance, then a retainer
  // % beyond it. Same data-capture-only status as the fields above.
  childSickLeaveFreeDaysPerMonth: integer("child_sick_leave_free_days_per_month").notNull().default(7),
  childSickLeaveRetainerPct: integer("child_sick_leave_retainer_pct").notNull().default(50),
  // #12 — gates the term/school-holiday break retainer (summerRetainerPct
  // above): the break retainer only applies if the teacher has explicitly
  // agreed to remain available for occasional online/at-home sessions
  // during breaks. Enforced at the FORM level (frontend forces
  // summerRetainerPct toward 0 when this is unchecked), not a DB constraint,
  // since summerRetainerPct remains the single source of truth for the %.
  availableDuringBreaks: boolean("available_during_breaks").notNull().default(false),
  status: negotiationOfferStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type NegotiationOffer = typeof negotiationOffersTable.$inferSelect;
