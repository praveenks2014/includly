import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { shadowTeacherMatchesTable } from "./shadowTeacher";
import { shadowMatchCandidatesTable } from "./shadowMatchCandidates";
import { usersTable } from "./users";
import { negotiationOfferStatusEnum } from "./negotiationOffers";

// Bidirectional interview-time propose/counter/accept, same state-machine
// pattern as negotiationOffersTable (reuses its status enum) but NOT the
// same rows: negotiationOffersTable's amountInr is a hard not-null
// invariant every existing salary-offer query relies on, and its 8
// retainer/leave columns are meaningless for a date/time proposal.
// Mixing kinds into one table would also mean retrofitting an offerType
// filter into ~15 read/write sites built for #12's retainer work — real
// risk to code that already works. Purpose-built table instead, with the
// exact same propose(=insert-and-supersede-pending)/accept(=supersede-
// others-then-mark-accepted)/withdraw(=mark-withdrawn-and-restore-
// predecessor) transaction logic copy-adapted, including the advisory
// lock that makes "at most one pending offer" hold under concurrent
// counters. Either party can propose or counter; only the OTHER party's
// accept can ever finalize — a proposer can never confirm their own
// offer, since the accept endpoint rejects same-raiser confirmation.
export const interviewTimeOffersTable = pgTable("interview_time_offers", {
  id: serial("id").primaryKey(),
  matchId: integer("match_id").notNull().references(() => shadowTeacherMatchesTable.id, { onDelete: "cascade" }),
  candidateId: integer("candidate_id").notNull().references(() => shadowMatchCandidatesTable.id, { onDelete: "cascade" }),
  raisedByUserId: integer("raised_by_user_id").notNull().references(() => usersTable.id),
  raisedByRole: text("raised_by_role").notNull(),
  proposedDate: text("proposed_date").notNull(),
  proposedTime: text("proposed_time").notNull(),
  status: negotiationOfferStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type InterviewTimeOffer = typeof interviewTimeOffersTable.$inferSelect;
