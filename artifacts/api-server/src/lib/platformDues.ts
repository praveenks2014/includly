import { and, eq, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { db, platformDuesInvoicesTable, platformDuesChargesTable, adminSettingsTable } from "@workspace/db";

export type DuesOwnerType = "centre" | "professional";

async function getSettings() {
  const [s] = await db.select().from(adminSettingsTable).limit(1);
  return s ?? { platformDuesTimeoutDays: 5 };
}

// Posts one atomic, never-mutated charge and attaches it to the owner's
// currently OPEN (pending) invoice, or opens a new one with
// dueAt = now + platformDuesTimeoutDays. dueAt is set once at invoice
// creation and never extended by later charges attaching — see
// platformDues.ts's schema comment for why. No cron/batch process for
// invoice creation: this function is the only thing that ever creates one,
// driven entirely by charge-posting time. Nothing calls this yet — the
// attendance sub-build will, once per OTP-confirmed completed session.
export async function postDuesCharge(params: {
  ownerType: DuesOwnerType;
  ownerId: number;
  sourceType: string;
  sourceId: number;
  amountInr: number;
}): Promise<{ chargeId: number; invoiceId: number }> {
  const { ownerType, ownerId, sourceType, sourceId, amountInr } = params;

  return db.transaction(async (tx) => {
    // Advisory lock per owner — without it, two concurrent charges for the
    // same owner could both see "no open invoice" and each create one,
    // splitting what should be a single rollup. Same supersede-then-insert
    // locking pattern already used for negotiation/weekly-schedule offers
    // elsewhere in this codebase.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ownerType} || ':' || ${ownerId}::text))`);

    let [invoice] = await tx.select().from(platformDuesInvoicesTable)
      .where(and(
        eq(platformDuesInvoicesTable.ownerType, ownerType),
        eq(platformDuesInvoicesTable.ownerId, ownerId),
        eq(platformDuesInvoicesTable.status, "pending"),
      ))
      .limit(1);

    if (!invoice) {
      const settings = await getSettings();
      const dueAt = new Date(Date.now() + settings.platformDuesTimeoutDays * 24 * 60 * 60 * 1000);
      [invoice] = await tx.insert(platformDuesInvoicesTable)
        .values({ ownerType, ownerId, totalAmountInr: 0, status: "pending", dueAt })
        .returning();
    }

    const [charge] = await tx.insert(platformDuesChargesTable)
      .values({ ownerType, ownerId, sourceType, sourceId, amountInr, duesInvoiceId: invoice!.id })
      .returning();

    await tx.update(platformDuesInvoicesTable)
      .set({ totalAmountInr: sql`${platformDuesInvoicesTable.totalAmountInr} + ${amountInr}`, updatedAt: new Date() })
      .where(eq(platformDuesInvoicesTable.id, invoice!.id));

    return { chargeId: charge!.id, invoiceId: invoice!.id };
  });
}

// Lazy resolver — flips pending -> overdue for any of ONE owner's invoices
// whose dueAt has passed. Same "resolve in place on read, no cron"
// convention as stuckEngagementResolver.ts/paymentConfirmationResolver.ts.
// Never resolves the other direction — only an explicit admin mark-paid/
// waive action, or a fresh invoice, changes status after this.
export async function resolveOverdueDuesInvoices(ownerType: DuesOwnerType, ownerId: number): Promise<void> {
  await db.update(platformDuesInvoicesTable)
    .set({ status: "overdue", updatedAt: new Date() })
    .where(and(
      eq(platformDuesInvoicesTable.ownerType, ownerType),
      eq(platformDuesInvoicesTable.ownerId, ownerId),
      eq(platformDuesInvoicesTable.status, "pending"),
      sql`${platformDuesInvoicesTable.dueAt} < now()`,
    ));
}

// SQL-fragment delisting gate, same shape as verificationRequirements.ts's
// buildTherapistCredentialGateSql — composes directly into a query's WHERE
// conditions. Deliberately self-sufficient: computes overdue-ness directly
// (status = 'overdue' OR a pending invoice whose dueAt has already passed)
// rather than trusting the lazy resolver above to have already run for
// this specific owner, so the gate is correct in real time regardless of
// read-path timing. True (passes / listable) when the owner has no
// overdue-or-should-be-overdue invoice.
export function buildNotOverdueGateSql(ownerType: DuesOwnerType, ownerIdColumn: SQLWrapper): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM ${platformDuesInvoicesTable} pdi
    WHERE pdi.owner_type = ${ownerType}
      AND pdi.owner_id = ${ownerIdColumn}
      AND (pdi.status = 'overdue' OR (pdi.status = 'pending' AND pdi.due_at < now()))
  )`;
}
