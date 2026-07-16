// Shared matching helpers for shadow-teacher candidate surfacing — used by
// both the routes (initial surfacing/refill in shadowTeacher.ts) and the
// candidate-refresh hooks (candidateRefresh.ts). Extracted from
// shadowTeacher.ts verbatim, not reimplemented, so both call sites stay
// behaviorally identical.
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  db,
  adminSettingsTable,
  childrenTable,
  shadowTeacherEngagementsTable,
  tutorEngagementsTable,
  tutorEngagementSessionsTable,
  therapistEngagementsTable,
  therapistEngagementSessionsTable,
  sessionBookingsTable,
} from "@workspace/db";
import { overlaps } from "./scheduleConflict";
import type { TierDef } from "./shadowTeacherScoring";

export async function getSettings() {
  const [s] = await db.select().from(adminSettingsTable).limit(1);
  return s ?? { matchingFeeInr: 500, matchingFeeRefundable: true, tiersJson: null, trialFeeInr: 500, noticePeriodDays: 30 };
}

export function parseTiers(tiersJson: string | null): TierDef[] {
  if (!tiersJson) return [];
  try { return JSON.parse(tiersJson) as TierDef[]; } catch { return []; }
}

/**
 * School-hours EXCLUSION for shadow-teacher matching (Rule 1). See the
 * original comment in shadowTeacher.ts's git history for the full
 * reasoning — unchanged here, just relocated.
 */
export async function filterBySchoolHours(
  professionals: { id: number }[],
  childId: number | null,
): Promise<number[]> {
  if (!childId || professionals.length === 0) return professionals.map((p) => p.id);

  const [child] = await db
    .select({ schoolStartTime: childrenTable.schoolStartTime, schoolEndTime: childrenTable.schoolEndTime })
    .from(childrenTable)
    .where(eq(childrenTable.id, childId))
    .limit(1);

  if (!child?.schoolStartTime || !child?.schoolEndTime) return professionals.map((p) => p.id);

  const schoolStart = child.schoolStartTime;
  const schoolEnd   = child.schoolEndTime;
  const proIds      = professionals.map((p) => p.id);

  const ownEngagements = await db
    .select({
      professionalId: shadowTeacherEngagementsTable.professionalId,
      recurringScheduleJson: shadowTeacherEngagementsTable.recurringScheduleJson,
    })
    .from(shadowTeacherEngagementsTable)
    .where(and(
      inArray(shadowTeacherEngagementsTable.professionalId, proIds),
      sql`${shadowTeacherEngagementsTable.status} != 'ended'`,
    ));

  const overlapIds = new Set<number>();
  for (const eng of ownEngagements) {
    const slots = (eng.recurringScheduleJson as { dayOfWeek: number; startTime: string; endTime: string }[] | null) ?? [];
    for (const s of slots) {
      if (s.dayOfWeek >= 1 && s.dayOfWeek <= 5 && overlaps(s.startTime, s.endTime, schoolStart, schoolEnd)) {
        overlapIds.add(eng.professionalId);
        break;
      }
    }
  }

  const [tutorSessions, therapistSessions, bookings] = await Promise.all([
    db
      .select({ professionalId: tutorEngagementsTable.professionalId, date: tutorEngagementSessionsTable.sessionDate, startTime: tutorEngagementSessionsTable.startTime, endTime: tutorEngagementSessionsTable.endTime })
      .from(tutorEngagementSessionsTable)
      .innerJoin(tutorEngagementsTable, eq(tutorEngagementSessionsTable.engagementId, tutorEngagementsTable.id))
      .where(and(
        inArray(tutorEngagementsTable.professionalId, proIds),
        inArray(tutorEngagementSessionsTable.status, ["scheduled", "started"]),
        isNotNull(tutorEngagementSessionsTable.startTime),
        isNotNull(tutorEngagementSessionsTable.endTime),
      )),
    db
      .select({ professionalId: therapistEngagementsTable.professionalId, date: therapistEngagementSessionsTable.sessionDate, startTime: therapistEngagementSessionsTable.startTime, endTime: therapistEngagementSessionsTable.endTime })
      .from(therapistEngagementSessionsTable)
      .innerJoin(therapistEngagementsTable, eq(therapistEngagementSessionsTable.engagementId, therapistEngagementsTable.id))
      .where(and(
        inArray(therapistEngagementsTable.professionalId, proIds),
        inArray(therapistEngagementSessionsTable.status, ["scheduled", "started"]),
        isNotNull(therapistEngagementSessionsTable.startTime),
        isNotNull(therapistEngagementSessionsTable.endTime),
      )),
    db
      .select({ professionalId: sessionBookingsTable.professionalId, date: sessionBookingsTable.bookedDate, startTime: sessionBookingsTable.startTime, endTime: sessionBookingsTable.endTime })
      .from(sessionBookingsTable)
      .where(and(
        inArray(sessionBookingsTable.professionalId, proIds),
        eq(sessionBookingsTable.status, "confirmed"),
      )),
  ]);

  for (const row of [...tutorSessions, ...therapistSessions, ...bookings]) {
    if (!row.startTime || !row.endTime) continue;
    const dayOfWeek = new Date(row.date + "T00:00:00Z").getUTCDay();
    if (dayOfWeek >= 1 && dayOfWeek <= 5 && overlaps(row.startTime, row.endTime, schoolStart, schoolEnd)) {
      overlapIds.add(row.professionalId);
    }
  }

  return professionals.filter((p) => !overlapIds.has(p.id)).map((p) => p.id);
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function maxDateStr(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/**
 * Effective "available from" date per candidate (Rule 2 support) — never an
 * exclusion, purely a display/scoring input. MAX(earliestStartDate, current
 * notice_period engagement's endDate + 1 day). No non-ended engagement, or
 * one that's not in notice_period (those are still hard-excluded by
 * busyProfIds and never reach this call) -> just earliestStartDate.
 */
export async function computeEffectiveAvailableFrom(
  professionals: { id: number; earliestStartDate: string | null }[],
): Promise<Map<number, string | null>> {
  const proIds = professionals.map((p) => p.id);
  const noticeRows = proIds.length > 0
    ? await db
        .select({ professionalId: shadowTeacherEngagementsTable.professionalId, endDate: shadowTeacherEngagementsTable.endDate })
        .from(shadowTeacherEngagementsTable)
        .where(and(
          inArray(shadowTeacherEngagementsTable.professionalId, proIds),
          eq(shadowTeacherEngagementsTable.status, "notice_period"),
        ))
    : [];

  const noticeEndByPro = new Map<number, string | null>();
  for (const row of noticeRows) noticeEndByPro.set(row.professionalId, row.endDate);

  const result = new Map<number, string | null>();
  for (const p of professionals) {
    const noticeEnd = noticeEndByPro.get(p.id);
    const availableAfterNotice = noticeEnd ? addDays(noticeEnd, 1) : null;
    result.set(p.id, maxDateStr(p.earliestStartDate, availableAfterNotice));
  }
  return result;
}
