import { and, eq, isNull, lt } from "drizzle-orm";
import {
  db,
  adminSettingsTable,
  engagementSalaryConfirmationsTable,
  tutorEngagementPaymentConfirmationsTable,
  therapistEngagementPaymentConfirmationsTable,
  shadowTeacherEngagementsTable,
  tutorEngagementsTable,
  therapistEngagementsTable,
  professionalProfilesTable,
} from "@workspace/db";
import { createInAppNotification } from "./notificationService";

/**
 * Lazy-evaluation resolver for direct-pay confirmations that the
 * professional never responded to — no cron, same pattern as
 * stuckEngagementResolver.ts. Call at the top of any read path that lists
 * confirmations for an engagement (GET .../payment-confirmations,
 * GET .../salary-confirmations). Auto-confirms any row still unconfirmed
 * after admin_settings.paymentConfirmationDefaultDays have passed since the
 * parent marked it paid.
 *
 * KNOWN GAP (accepted, same tradeoff as stuckEngagementResolver.ts): if
 * nobody reads the confirmation list again after the timeout passes, it
 * stays unresolved. No proactive push — a scheduled job was explicitly
 * ruled out for this pattern.
 */

async function getDefaultDays(): Promise<number> {
  const [s] = await db.select({ days: adminSettingsTable.paymentConfirmationDefaultDays }).from(adminSettingsTable).limit(1);
  return s?.days ?? 7;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function resolveOverdueShadowTeacherConfirmations(engagementId: number): Promise<void> {
  const defaultDays = await getDefaultDays();
  const overdue = await db
    .update(engagementSalaryConfirmationsTable)
    .set({ confirmedAt: new Date() })
    .where(
      and(
        eq(engagementSalaryConfirmationsTable.engagementId, engagementId),
        isNull(engagementSalaryConfirmationsTable.confirmedAt),
        lt(engagementSalaryConfirmationsTable.markedPaidAt, daysAgo(defaultDays)),
      ),
    )
    .returning({ id: engagementSalaryConfirmationsTable.id, month: engagementSalaryConfirmationsTable.month, amountInr: engagementSalaryConfirmationsTable.amountInr });

  if (overdue.length === 0) return;

  const [eng] = await db.select().from(shadowTeacherEngagementsTable).where(eq(shadowTeacherEngagementsTable.id, engagementId)).limit(1);
  if (!eng) return;
  await notifyAutoConfirmed(eng.parentId, eng.professionalId, overdue, "engagement");
}

export async function resolveOverdueTutorConfirmations(engagementId: number): Promise<void> {
  const defaultDays = await getDefaultDays();
  const overdue = await db
    .update(tutorEngagementPaymentConfirmationsTable)
    .set({ confirmedAt: new Date() })
    .where(
      and(
        eq(tutorEngagementPaymentConfirmationsTable.engagementId, engagementId),
        isNull(tutorEngagementPaymentConfirmationsTable.confirmedAt),
        lt(tutorEngagementPaymentConfirmationsTable.markedPaidAt, daysAgo(defaultDays)),
      ),
    )
    .returning({ id: tutorEngagementPaymentConfirmationsTable.id, month: tutorEngagementPaymentConfirmationsTable.month, amountInr: tutorEngagementPaymentConfirmationsTable.amountInr });

  if (overdue.length === 0) return;

  const [eng] = await db.select().from(tutorEngagementsTable).where(eq(tutorEngagementsTable.id, engagementId)).limit(1);
  if (!eng) return;
  await notifyAutoConfirmed(eng.parentId, eng.professionalId, overdue, "engagement");
}

export async function resolveOverdueTherapistConfirmations(engagementId: number): Promise<void> {
  const defaultDays = await getDefaultDays();
  const overdue = await db
    .update(therapistEngagementPaymentConfirmationsTable)
    .set({ confirmedAt: new Date() })
    .where(
      and(
        eq(therapistEngagementPaymentConfirmationsTable.engagementId, engagementId),
        isNull(therapistEngagementPaymentConfirmationsTable.confirmedAt),
        lt(therapistEngagementPaymentConfirmationsTable.markedPaidAt, daysAgo(defaultDays)),
      ),
    )
    .returning({ id: therapistEngagementPaymentConfirmationsTable.id, month: therapistEngagementPaymentConfirmationsTable.month, amountInr: therapistEngagementPaymentConfirmationsTable.amountInr });

  if (overdue.length === 0) return;

  const [eng] = await db.select().from(therapistEngagementsTable).where(eq(therapistEngagementsTable.id, engagementId)).limit(1);
  if (!eng) return;
  await notifyAutoConfirmed(eng.parentId, eng.professionalId, overdue, "engagement");
}

async function notifyAutoConfirmed(
  parentId: number,
  professionalId: number,
  rows: { id: number; month: string; amountInr: number }[],
  relatedType: string,
): Promise<void> {
  const months = rows.map((r) => r.month).join(", ");
  try {
    await createInAppNotification(parentId, {
      type: "payment_auto_confirmed",
      title: "Payment auto-confirmed",
      body: `Your payment for ${months} was automatically confirmed as received since your professional didn't respond in time.`,
      relatedType,
      relatedId: rows[0]!.id,
    });
  } catch { /* non-blocking */ }

  try {
    const [pro] = await db.select({ userId: professionalProfilesTable.userId }).from(professionalProfilesTable).where(eq(professionalProfilesTable.id, professionalId));
    if (pro) {
      await createInAppNotification(pro.userId, {
        type: "payment_auto_confirmed",
        title: "Payment auto-confirmed",
        body: `A parent's payment for ${months} was automatically marked confirmed since you didn't respond in time.`,
        relatedType,
        relatedId: rows[0]!.id,
      });
    }
  } catch { /* non-blocking */ }
}
