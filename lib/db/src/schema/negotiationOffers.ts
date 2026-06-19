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
  status: negotiationOfferStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type NegotiationOffer = typeof negotiationOffersTable.$inferSelect;
