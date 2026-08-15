import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { shadowTeacherMatchesTable } from "./shadowTeacher";
import { shadowMatchCandidatesTable } from "./shadowMatchCandidates";
import { usersTable } from "./users";
import { negotiationOfferStatusEnum } from "./negotiationOffers";

// Parent↔teacher weekly-schedule propose/counter, keyed to (matchId,
// candidateId) exactly like interviewTimeOffersTable — a professional only
// ever attaches to a match via a specific shadowMatchCandidatesTable row, so
// there is no well-defined "other party" to negotiate with before a
// candidate exists. The parent's very first stated desire is instead a
// plain, non-negotiated field (shadowTeacherMatchesTable.
// childDesiredDaysOfWeek, same pattern as the existing
// childDesiredStartDate) — this table only holds the back-and-forth that
// happens once a specific candidate is live -- see the schema comment on
// that field for why it's day-of-week-only, not day+time. Same
// supersede-then-insert/supersede-others-then-accept/mark-withdrawn-and-
// restore-predecessor transaction logic as interviewTimeOffersTable, reusing
// its status enum — not the same table, since slots (a weekly pattern) is a
// completely different shape from a single proposedDate/proposedTime pair,
// and there's no interview-style 3-day-window validation or Jitsi
// side-effect here.
export const weeklyScheduleOffersTable = pgTable("weekly_schedule_offers", {
  id: serial("id").primaryKey(),
  matchId: integer("match_id").notNull().references(() => shadowTeacherMatchesTable.id, { onDelete: "cascade" }),
  candidateId: integer("candidate_id").notNull().references(() => shadowMatchCandidatesTable.id, { onDelete: "cascade" }),
  raisedByUserId: integer("raised_by_user_id").notNull().references(() => usersTable.id),
  raisedByRole: text("raised_by_role").notNull(),
  // Shape: { dayOfWeek: 0-6, startTime: "HH:MM", endTime: "HH:MM" }[] — same
  // RecurringScheduleSlot shape as every other weekly-schedule column.
  slots: jsonb("slots").notNull(),
  status: negotiationOfferStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type WeeklyScheduleOffer = typeof weeklyScheduleOffersTable.$inferSelect;
