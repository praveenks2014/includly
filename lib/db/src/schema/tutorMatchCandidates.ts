import { pgTable, serial, integer, real, text, timestamp, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tutorMatchesTable } from "./tutorMatches";
import { professionalProfilesTable } from "./professionals";
import { usersTable } from "./users";
import { sessionBookingsTable } from "./sessions";

// Mirrors shadow_match_candidates exactly (Path A — separate table, same shape).
export const tutorMatchCandidatesTable = pgTable(
  "tutor_match_candidates",
  {
    id: serial("id").primaryKey(),
    matchId: integer("match_id")
      .notNull()
      .references(() => tutorMatchesTable.id, { onDelete: "cascade" }),
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
    // Superseded by booking-based interview scheduling (reuses
    // professional_availability/bookable-slots + session_bookings, see
    // interviewBookingId below) — kept populated by nothing going forward,
    // left as dead columns rather than dropped outright.
    interviewSlotsJson: text("interview_slots_json"),
    interviewConfirmedSlot: text("interview_confirmed_slot"),
    meetLink: text("meet_link"),
    // Booking-based interview scheduling — points at the session_bookings
    // row created by POST /tutor/.../book-interview (bookingType:
    // "interview", amountInr: 0, status: "confirmed" directly, no payment).
    // meetLink is derived deterministically from this row's id at read
    // time, not stored (see JITSI_CONFIG_SUFFIX usage in tutor.ts).
    interviewBookingId: integer("interview_booking_id").references(() => sessionBookingsTable.id, { onDelete: "set null" }),
    interviewDoneAt: timestamp("interview_done_at", { withTimezone: true }),
    trialDaysRequested: integer("trial_days_requested"),
    trialDaysAccepted: integer("trial_days_accepted"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tutor_match_candidates_match_id_idx").on(t.matchId),
    unique("tutor_match_candidates_match_pro_unique").on(t.matchId, t.professionalId),
  ],
);

export const insertTutorMatchCandidateSchema = createInsertSchema(
  tutorMatchCandidatesTable,
).omit({ id: true, createdAt: true });
export type InsertTutorMatchCandidate = z.infer<typeof insertTutorMatchCandidateSchema>;
export type TutorMatchCandidate = typeof tutorMatchCandidatesTable.$inferSelect;
