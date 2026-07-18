import { pgTable, serial, integer, real, text, timestamp, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { shadowTeacherMatchesTable } from "./shadowTeacher";
import { professionalProfilesTable } from "./professionals";
import { usersTable } from "./users";

export const shadowMatchCandidatesTable = pgTable(
  "shadow_match_candidates",
  {
    id: serial("id").primaryKey(),
    matchId: integer("match_id")
      .notNull()
      .references(() => shadowTeacherMatchesTable.id, { onDelete: "cascade" }),
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
    // Teacher-accepts-before-parent-pays reorder (#14/#15) — category tag for
    // WHY this candidate was removed, distinct from the normal "parent picked
    // someone else" case (removedReason stays null there, same as today).
    // "teacher_declined" = active decline at choose-engagement, with the
    // dropdown reason in declineReasonDetail (and free-text in
    // declineReasonNote when declineReasonDetail = "other").
    // "timed_out_teacher_response" = auto-timeout, no reason chosen by anyone.
    removedReason: text("removed_reason"),
    declineReasonDetail: text("decline_reason_detail"),
    declineReasonNote: text("decline_reason_note"),
    // Redesigned parent↔teacher journey (Task 1 schema-only — request → interview → trial).
    // Data-capture only for now; no API/frontend built yet, no automation reads these.
    // requestStatus values: not_sent | sent | accepted | rejected (stored as text, not
    //   enum, to avoid enum-alter migration friction while the flow is still being
    //   iterated).
    requestStatus: text("request_status").notNull().default("not_sent"),
    rejectionNote: text("rejection_note"),
    interviewSlotsJson: text("interview_slots_json"),
    interviewConfirmedSlot: text("interview_confirmed_slot"),
    meetLink: text("meet_link"),
    interviewDoneAt: timestamp("interview_done_at", { withTimezone: true }),
    trialDaysRequested: integer("trial_days_requested"),
    trialDaysAccepted: integer("trial_days_accepted"),
    // Auto-refresh notice tracking — set once the parent has been shown the
    // "a stronger match is now available" banner for this candidate (only
    // ever meaningful when addedBy = 'auto_refresh'). Null means the notice
    // hasn't been dismissed/seen yet.
    seenAt: timestamp("seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("shadow_match_candidates_match_id_idx").on(t.matchId),
    unique("shadow_match_candidates_match_pro_unique").on(t.matchId, t.professionalId),
  ],
);

export const insertShadowMatchCandidateSchema = createInsertSchema(
  shadowMatchCandidatesTable,
).omit({ id: true, createdAt: true });
export type InsertShadowMatchCandidate = z.infer<typeof insertShadowMatchCandidateSchema>;
export type ShadowMatchCandidate = typeof shadowMatchCandidatesTable.$inferSelect;
