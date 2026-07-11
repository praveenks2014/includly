import { pgTable, serial, integer, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tutorEngagementsTable } from "./tutorEngagements";
import { usersTable } from "./users";

// Per-session attendance log for an ongoing (weekly, recurring) tutor
// engagement — one row per scheduled session. This is what "mark session
// done" reads from and writes to, for both payment-dispute evidence and any
// future package/frequency features.
//
// Nothing in the shadow-teacher engagement model tracks individual sessions
// (it's billed monthly, so it only ever needed ONE start OTP for the whole
// engagement — see shadow_teacher_engagements.startOtp). The OTP field
// shapes here (startOtp/endOtp/otpIssuedAt/otpAttempts/otpLockedAt/
// startedAt) are instead mirrored from session_bookings (the unrelated
// Flow B / sessionsV2 escrow-booking system), which is the only existing
// table with genuine per-session OTP semantics — reusing its field shapes
// and the shared generateOtp() helper, not inventing new OTP mechanics.
export const engagementSessionStatusEnum = pgEnum("engagement_session_status", [
  "scheduled",
  "started",
  "completed",
  "cancelled",
  "no_show",
]);

export const tutorEngagementSessionsTable = pgTable(
  "tutor_engagement_sessions",
  {
    id: serial("id").primaryKey(),
    engagementId: integer("engagement_id").notNull().references(() => tutorEngagementsTable.id, { onDelete: "cascade" }),
    sessionDate: text("session_date").notNull(),
    startTime: text("start_time"),
    endTime: text("end_time"),
    status: engagementSessionStatusEnum("status").notNull().default("scheduled"),
    startOtp: text("start_otp"),
    endOtp: text("end_otp"),
    otpIssuedAt: timestamp("otp_issued_at", { withTimezone: true }),
    otpAttempts: integer("otp_attempts").notNull().default(0),
    otpLockedAt: timestamp("otp_locked_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    markedByUserId: integer("marked_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index("tutor_engagement_sessions_engagement_id_idx").on(t.engagementId)],
);

export const insertTutorEngagementSessionSchema = createInsertSchema(tutorEngagementSessionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTutorEngagementSession = z.infer<typeof insertTutorEngagementSessionSchema>;
export type TutorEngagementSession = typeof tutorEngagementSessionsTable.$inferSelect;
