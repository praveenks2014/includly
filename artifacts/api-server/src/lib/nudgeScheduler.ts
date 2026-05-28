import { and, eq, gte, isNull, lt, lte, ne, sql } from "drizzle-orm";
import {
  db,
  sessionBookingsTable,
  usersTable,
  notificationPreferencesTable,
  communityPostsTable,
} from "@workspace/db";
import { sendPushNotification } from "./notificationService";
import { logger } from "./logger";

const LOW_CREDIT_THRESHOLD_INR = 200;
const WINBACK_INACTIVITY_DAYS = 7;
const NUDGE_COOLDOWN_DAYS = 7;

// ── Session reminders (24 h before confirmed sessions) ──────────────────────────
async function sendSessionReminders(): Promise<void> {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);

    const bookings = await db
      .select({
        id: sessionBookingsTable.id,
        parentId: sessionBookingsTable.parentId,
        bookedDate: sessionBookingsTable.bookedDate,
        startTime: sessionBookingsTable.startTime,
      })
      .from(sessionBookingsTable)
      .where(
        and(
          eq(sessionBookingsTable.bookedDate, tomorrowStr),
          eq(sessionBookingsTable.status, "confirmed"),
          isNull(sessionBookingsTable.reminderSentAt),
        ),
      );

    for (const booking of bookings) {
      const prefs = await db
        .select({ onSessionReminder: notificationPreferencesTable.onSessionReminder })
        .from(notificationPreferencesTable)
        .where(eq(notificationPreferencesTable.userId, booking.parentId))
        .limit(1);

      const wantsReminder = prefs.length === 0 || prefs[0]!.onSessionReminder !== false;
      if (!wantsReminder) continue;

      await sendPushNotification(booking.parentId, {
        title: "📅 Session tomorrow",
        body: `Your child's session is confirmed for tomorrow at ${formatTime(booking.startTime)}.`,
        url: "/dashboard",
      });

      await db
        .update(sessionBookingsTable)
        .set({ reminderSentAt: new Date() })
        .where(eq(sessionBookingsTable.id, booking.id));
    }

    if (bookings.length > 0) {
      logger.info({ count: bookings.length }, "Session reminders sent");
    }
  } catch (err) {
    logger.warn({ err }, "Session reminder nudge failed");
  }
}

// ── Win-back: "next session due" for parents idle 7+ days ──────────────────────
async function sendWinbackNudges(): Promise<void> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - WINBACK_INACTIVITY_DAYS);

    const cooloffCutoff = new Date();
    cooloffCutoff.setDate(cooloffCutoff.getDate() - NUDGE_COOLDOWN_DAYS);

    // Find parents whose most recent confirmed/completed session ended before cutoff
    // and who have no upcoming confirmed session and haven't been nudged recently
    const rows = await db.execute(sql`
      SELECT DISTINCT sb.parent_id
      FROM session_bookings sb
      JOIN users u ON u.id = sb.parent_id
      WHERE sb.status IN ('confirmed', 'completed')
        AND sb.booked_date::date <= ${cutoff.toISOString().slice(0, 10)}::date
        AND (u.last_winback_nudge_at IS NULL OR u.last_winback_nudge_at < ${cooloffCutoff.toISOString()}::timestamptz)
        AND u.role = 'parent'
        AND NOT EXISTS (
          SELECT 1 FROM session_bookings sb2
          WHERE sb2.parent_id = sb.parent_id
            AND sb2.status = 'confirmed'
            AND sb2.booked_date::date > ${new Date().toISOString().slice(0, 10)}::date
        )
    `);

    for (const row of rows.rows as Array<{ parent_id: number }>) {
      const parentId = row.parent_id;

      const prefs = await db
        .select({ onSessionReminder: notificationPreferencesTable.onSessionReminder })
        .from(notificationPreferencesTable)
        .where(eq(notificationPreferencesTable.userId, parentId))
        .limit(1);

      const wantsNudge = prefs.length === 0 || prefs[0]!.onSessionReminder !== false;
      if (!wantsNudge) continue;

      await sendPushNotification(parentId, {
        title: "⏰ Time for your child's next session?",
        body: "It's been a while — your child's specialist is ready when you are.",
        url: "/search",
      });

      await db
        .update(usersTable)
        .set({ lastWinbackNudgeAt: new Date() })
        .where(eq(usersTable.id, parentId));
    }

    if (rows.rows.length > 0) {
      logger.info({ count: rows.rows.length }, "Win-back nudges sent");
    }
  } catch (err) {
    logger.warn({ err }, "Win-back nudge failed");
  }
}

// ── Low credits nudge ────────────────────────────────────────────────────────────
async function sendLowCreditNudges(): Promise<void> {
  try {
    const cooloffCutoff = new Date();
    cooloffCutoff.setDate(cooloffCutoff.getDate() - NUDGE_COOLDOWN_DAYS);

    const users = await db
      .select({ id: usersTable.id, walletBalanceInr: usersTable.walletBalanceInr })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.role, "parent"),
          lt(usersTable.walletBalanceInr, LOW_CREDIT_THRESHOLD_INR),
          sql`${usersTable.walletBalanceInr} > 0`,
          sql`(${usersTable.lastLowCreditNudgeAt} IS NULL OR ${usersTable.lastLowCreditNudgeAt} < ${cooloffCutoff.toISOString()}::timestamptz)`,
        ),
      );

    for (const user of users) {
      const prefs = await db
        .select({ onLowCredits: notificationPreferencesTable.onLowCredits })
        .from(notificationPreferencesTable)
        .where(eq(notificationPreferencesTable.userId, user.id))
        .limit(1);

      const wantsNudge = prefs.length === 0 || prefs[0]!.onLowCredits !== false;
      if (!wantsNudge) continue;

      await sendPushNotification(user.id, {
        title: "💰 Your wallet is running low",
        body: `You have ₹${user.walletBalanceInr} left. Top up to keep booking sessions.`,
        url: "/dashboard",
      });

      await db
        .update(usersTable)
        .set({ lastLowCreditNudgeAt: new Date() })
        .where(eq(usersTable.id, user.id));
    }

    if (users.length > 0) {
      logger.info({ count: users.length }, "Low-credit nudges sent");
    }
  } catch (err) {
    logger.warn({ err }, "Low-credit nudge failed");
  }
}

function formatTime(t: string): string {
  const [h, m] = t.split(":");
  const hr = Number(h);
  return `${hr % 12 || 12}:${m} ${hr < 12 ? "AM" : "PM"}`;
}

// ── Scheduler init — runs all nudges every hour ─────────────────────────────────
export function initNudgeScheduler(): void {
  const INTERVAL_MS = 60 * 60 * 1000;

  const runAll = () => {
    void sendSessionReminders();
    void sendWinbackNudges();
    void sendLowCreditNudges();
  };

  setInterval(runAll, INTERVAL_MS);
  logger.info("Nudge scheduler started (1 h interval)");
}
