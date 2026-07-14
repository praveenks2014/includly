import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { therapistEngagementsTable } from "./therapistEngagements";
import { usersTable } from "./users";
import { engagementSessionStatusEnum, sessionGoalProgressEnum } from "./tutorEngagementSessions";

// Per-session attendance log for an ongoing therapist engagement — see
// tutor_engagement_sessions for the full rationale. Reuses the same
// engagement_session_status enum (shared type, not duplicated) and the
// same OTP field shapes mirrored from session_bookings.
export const therapistEngagementSessionsTable = pgTable(
  "therapist_engagement_sessions",
  {
    id: serial("id").primaryKey(),
    engagementId: integer("engagement_id").notNull().references(() => therapistEngagementsTable.id, { onDelete: "cascade" }),
    sessionDate: text("session_date").notNull(),
    startTime: text("start_time"),
    endTime: text("end_time"),
    // Same deterministic meet.jit.si pattern already used for interview
    // meetLink — generated once at session-scheduling time.
    meetLink: text("meet_link"),
    status: engagementSessionStatusEnum("status").notNull().default("scheduled"),
    startOtp: text("start_otp"),
    endOtp: text("end_otp"),
    otpIssuedAt: timestamp("otp_issued_at", { withTimezone: true }),
    otpAttempts: integer("otp_attempts").notNull().default(0),
    otpLockedAt: timestamp("otp_locked_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    markedByUserId: integer("marked_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    // Per-session payment marking (Prompt 2C) — ONLY meaningful when the
    // parent engagement's billingCadence is 'per_session'. Not present on
    // tutor_engagement_sessions: tutor is always monthly, so a per-session
    // "mark paid" action never applies there.
    paidAmountInr: integer("paid_amount_inr"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    notes: text("notes"),
    // Post-session progress feedback (D2) — professional-authored, parent-
    // visible, only meaningful once status='completed'.
    topicsCovered: text("topics_covered"),
    childEngagementNotes: text("child_engagement_notes"),
    nextSessionNotes: text("next_session_notes"),
    goalProgress: sessionGoalProgressEnum("goal_progress"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index("therapist_engagement_sessions_engagement_id_idx").on(t.engagementId)],
);

export const insertTherapistEngagementSessionSchema = createInsertSchema(therapistEngagementSessionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTherapistEngagementSession = z.infer<typeof insertTherapistEngagementSessionSchema>;
export type TherapistEngagementSession = typeof therapistEngagementSessionsTable.$inferSelect;
