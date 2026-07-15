import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  db,
  tutorEngagementsTable,
  tutorEngagementSessionsTable,
  therapistEngagementsTable,
  therapistEngagementSessionsTable,
  sessionBookingsTable,
} from "@workspace/db";

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return timeToMinutes(aStart) < timeToMinutes(bEnd) && timeToMinutes(bStart) < timeToMinutes(aEnd);
}

/**
 * True interval-overlap check across all three places a professional can
 * hold a same-day commitment: their own tutor sessions, their own therapist
 * sessions (cross-vertical — a professional can hold both offerings), and
 * general session_bookings. Only fires when the incoming request has both
 * startTime/endTime; rows on either side missing times are skipped since
 * there's nothing to compare against (both fields are optional at
 * scheduling time).
 */
export async function hasScheduleConflict(
  professionalId: number,
  date: string,
  startTime: string,
  endTime: string,
): Promise<boolean> {
  const [tutorConflicts, therapistConflicts, bookingConflicts] = await Promise.all([
    db
      .select({ startTime: tutorEngagementSessionsTable.startTime, endTime: tutorEngagementSessionsTable.endTime })
      .from(tutorEngagementSessionsTable)
      .innerJoin(tutorEngagementsTable, eq(tutorEngagementSessionsTable.engagementId, tutorEngagementsTable.id))
      .where(and(
        eq(tutorEngagementsTable.professionalId, professionalId),
        eq(tutorEngagementSessionsTable.sessionDate, date),
        inArray(tutorEngagementSessionsTable.status, ["scheduled", "started"]),
        isNotNull(tutorEngagementSessionsTable.startTime),
        isNotNull(tutorEngagementSessionsTable.endTime),
      )),
    db
      .select({ startTime: therapistEngagementSessionsTable.startTime, endTime: therapistEngagementSessionsTable.endTime })
      .from(therapistEngagementSessionsTable)
      .innerJoin(therapistEngagementsTable, eq(therapistEngagementSessionsTable.engagementId, therapistEngagementsTable.id))
      .where(and(
        eq(therapistEngagementsTable.professionalId, professionalId),
        eq(therapistEngagementSessionsTable.sessionDate, date),
        inArray(therapistEngagementSessionsTable.status, ["scheduled", "started"]),
        isNotNull(therapistEngagementSessionsTable.startTime),
        isNotNull(therapistEngagementSessionsTable.endTime),
      )),
    db
      .select({ startTime: sessionBookingsTable.startTime, endTime: sessionBookingsTable.endTime })
      .from(sessionBookingsTable)
      .where(and(
        eq(sessionBookingsTable.professionalId, professionalId),
        eq(sessionBookingsTable.bookedDate, date),
        eq(sessionBookingsTable.status, "confirmed"),
      )),
  ]);

  return [...tutorConflicts, ...therapistConflicts, ...bookingConflicts]
    .some((r) => r.startTime && r.endTime && overlaps(startTime, endTime, r.startTime, r.endTime));
}
