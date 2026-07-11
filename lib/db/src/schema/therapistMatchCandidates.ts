import { pgTable, serial, integer, real, text, timestamp, boolean, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { therapistMatchesTable } from "./therapistMatches";
import { professionalProfilesTable } from "./professionals";
import { usersTable } from "./users";

// Mirrors shadow_match_candidates, plus therapist-only assessment fields.
export const therapistMatchCandidatesTable = pgTable(
  "therapist_match_candidates",
  {
    id: serial("id").primaryKey(),
    matchId: integer("match_id")
      .notNull()
      .references(() => therapistMatchesTable.id, { onDelete: "cascade" }),
    professionalId: integer("professional_id")
      .notNull()
      .references(() => professionalProfilesTable.id, { onDelete: "cascade" }),
    score: real("score"),
    rank: integer("rank").notNull(),
    addedBy: text("added_by").notNull().default("auto"),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedByUserId: integer("removed_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    requestStatus: text("request_status").notNull().default("not_sent"),
    rejectionNote: text("rejection_note"),
    interviewSlotsJson: text("interview_slots_json"),
    interviewConfirmedSlot: text("interview_confirmed_slot"),
    meetLink: text("meet_link"),
    interviewDoneAt: timestamp("interview_done_at", { withTimezone: true }),
    trialDaysRequested: integer("trial_days_requested"),
    trialDaysAccepted: integer("trial_days_accepted"),
    // Therapist-only (Prompt 2 Part A item 3) — gates ongoing negotiation
    // when the match's wantsAssessmentFirst is true, parallel to how
    // interviewDoneAt gates negotiation for shadow-teacher/tutor.
    assessmentCompleted: boolean("assessment_completed").notNull().default(false),
    assessmentDoneAt: timestamp("assessment_done_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("therapist_match_candidates_match_id_idx").on(t.matchId),
    unique("therapist_match_candidates_match_pro_unique").on(t.matchId, t.professionalId),
  ],
);

export const insertTherapistMatchCandidateSchema = createInsertSchema(
  therapistMatchCandidatesTable,
).omit({ id: true, createdAt: true });
export type InsertTherapistMatchCandidate = z.infer<typeof insertTherapistMatchCandidateSchema>;
export type TherapistMatchCandidate = typeof therapistMatchCandidatesTable.$inferSelect;
