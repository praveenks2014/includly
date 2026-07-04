import { eq, sql } from "drizzle-orm";
import { db, paymentLedgerTable, commissionRatesTable, usersTable, walletTransactionsTable } from "@workspace/db";

export type LedgerBookingType = "session" | "package" | "subscription" | "engagement" | "assessment";

async function getCommissionRate(bookingType: LedgerBookingType): Promise<number> {
  const defaultRates: Record<LedgerBookingType, number> = {
    session: 10,
    package: 7,
    subscription: 5,
    engagement: 5,
    assessment: 10,
  };
  try {
    const [row] = await db
      .select({ ratePct: commissionRatesTable.ratePct })
      .from(commissionRatesTable)
      .where(eq(commissionRatesTable.bookingType, bookingType))
      .limit(1);
    return row?.ratePct ?? defaultRates[bookingType];
  } catch {
    return defaultRates[bookingType];
  }
}

export async function createLedgerHeld({
  bookingId,
  engagementId,
  parentId,
  professionalUserId,
  amountInr,
  bookingType = "session",
}: {
  bookingId?: number;
  engagementId?: number;
  parentId: number;
  professionalUserId?: number | null;
  amountInr: number;
  bookingType?: LedgerBookingType;
}): Promise<number> {
  const [row] = await db
    .insert(paymentLedgerTable)
    .values({
      bookingId: bookingId ?? null,
      engagementId: engagementId ?? null,
      parentId,
      professionalUserId: professionalUserId ?? null,
      amountInr,
      status: "held",
      bookingType,
    })
    .returning({ id: paymentLedgerTable.id });
  return row!.id;
}

export async function releaseWithCommission(
  ledgerEntryId: number,
): Promise<void> {
  const [entry] = await db
    .select()
    .from(paymentLedgerTable)
    .where(eq(paymentLedgerTable.id, ledgerEntryId))
    .limit(1);

  if (!entry || entry.status !== "held") return;

  const ratePct = await getCommissionRate(entry.bookingType as LedgerBookingType);
  const commissionInr = Math.round((entry.amountInr * ratePct) / 100);

  await db
    .update(paymentLedgerTable)
    .set({
      status: "released",
      commissionPct: ratePct,
      commissionInr,
      releasedAt: new Date(),
    })
    .where(eq(paymentLedgerTable.id, ledgerEntryId));
}

export async function refundToWallet(
  ledgerEntryId: number,
  reason?: string,
): Promise<void> {
  const [entry] = await db
    .select()
    .from(paymentLedgerTable)
    .where(eq(paymentLedgerTable.id, ledgerEntryId))
    .limit(1);

  if (!entry || entry.status === "refunded") return;

  await db.transaction(async (tx) => {
    await tx
      .update(paymentLedgerTable)
      .set({ status: "refunded", releasedAt: new Date(), note: reason ?? null })
      .where(eq(paymentLedgerTable.id, ledgerEntryId));

    const [updated] = await tx
      .update(usersTable)
      .set({ walletBalanceInr: sql`${usersTable.walletBalanceInr} + ${entry.amountInr}` })
      .where(eq(usersTable.id, entry.parentId))
      .returning({ walletBalanceInr: usersTable.walletBalanceInr });

    const newBalance = updated?.walletBalanceInr ?? entry.amountInr;

    await tx.insert(walletTransactionsTable).values({
      userId: entry.parentId,
      amountInr: entry.amountInr,
      type: "credit",
      sourceType: "refund",
      referenceId: ledgerEntryId,
      description: reason ?? "Session cancelled — refunded to wallet",
      balanceAfter: newBalance,
    });
  });
}

export type WalletSourceType = "refund" | "topup" | "booking" | "engagement";

/**
 * Generic wallet credit helper — increments the user's wallet balance and
 * records a walletTransactions row in the same atomic step. Used for
 * refunds (e.g. placement-fee refund on teacher decline) and for crediting
 * stranded trial-fee amounts that have no salary payment to apply against
 * (platformSalaryEnabled=false engagements).
 */
export async function creditWallet(
  userId: number,
  amountInr: number,
  sourceType: WalletSourceType,
  referenceId: number | null,
  description: string,
): Promise<number> {
  return await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(usersTable)
      .set({ walletBalanceInr: sql`${usersTable.walletBalanceInr} + ${amountInr}` })
      .where(eq(usersTable.id, userId))
      .returning({ walletBalanceInr: usersTable.walletBalanceInr });

    const newBalance = updated?.walletBalanceInr ?? amountInr;

    await tx.insert(walletTransactionsTable).values({
      userId,
      amountInr,
      type: "credit",
      sourceType,
      referenceId,
      description,
      balanceAfter: newBalance,
    });

    return newBalance;
  });
}

export async function findLedgerByBooking(bookingId: number) {
  const [entry] = await db
    .select()
    .from(paymentLedgerTable)
    .where(eq(paymentLedgerTable.bookingId, bookingId))
    .limit(1);
  return entry ?? null;
}
