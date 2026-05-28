import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, sql, desc } from "drizzle-orm";
import { db, usersTable, walletTransactionsTable, referralsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { sendPushNotification } from "../lib/notificationService";

const router: IRouter = Router();

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 7; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function getOrCreateReferralCode(userId: number): Promise<string> {
  const [user] = await db
    .select({ referralCode: usersTable.referralCode })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (user?.referralCode) return user.referralCode;

  let code = generateCode();
  let attempts = 0;
  while (attempts < 10) {
    const existing = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.referralCode, code))
      .limit(1);
    if (existing.length === 0) break;
    code = generateCode();
    attempts++;
  }

  await db.update(usersTable).set({ referralCode: code }).where(eq(usersTable.id, userId));
  return code;
}

// GET /referrals/my-code  — get (or lazy-create) my referral code + stats
router.get("/referrals/my-code", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId!;
  const code = await getOrCreateReferralCode(userId);

  const rows = await db
    .select({
      status: referralsTable.status,
      rewardInr: referralsTable.rewardInr,
      convertedAt: referralsTable.convertedAt,
      createdAt: referralsTable.createdAt,
    })
    .from(referralsTable)
    .where(eq(referralsTable.referrerUserId, userId))
    .orderBy(desc(referralsTable.createdAt));

  const converted = rows.filter((r) => r.status === "converted");
  const totalEarnedInr = converted.reduce((sum, r) => sum + (r.rewardInr ?? 100), 0);

  res.json({
    code,
    shareUrl: `https://includly.in/?ref=${code}`,
    totalReferrals: rows.length,
    convertedReferrals: converted.length,
    totalEarnedInr,
  });
});

// POST /referrals/claim  — parent enters someone else's code; stored on their profile
router.post("/referrals/claim", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId!;
  const { code } = req.body as { code?: string };
  if (!code || typeof code !== "string") {
    res.status(400).json({ error: "code is required" });
    return;
  }

  const [self] = await db
    .select({ referredByCode: usersTable.referredByCode, referralCode: usersTable.referralCode })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (self?.referredByCode) {
    res.status(409).json({ error: "You have already claimed a referral code" });
    return;
  }

  const normalised = code.trim().toUpperCase();

  if (self?.referralCode === normalised) {
    res.status(400).json({ error: "You cannot use your own referral code" });
    return;
  }

  const [referrer] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.referralCode, normalised))
    .limit(1);

  if (!referrer) {
    res.status(404).json({ error: "Referral code not found" });
    return;
  }

  // Store the code so first booking can convert it
  await db.update(usersTable).set({ referredByCode: normalised }).where(eq(usersTable.id, userId));

  // Create a pending referral row
  await db.insert(referralsTable).values({
    referrerUserId: referrer.id,
    referredUserId: userId,
    status: "pending",
  });

  res.json({ success: true, message: "Code claimed! You'll both earn ₹100 when you complete your first session." });
});

// ── Internal helper — called after first session payment confirmed ──────────────
export async function convertReferralIfNeeded(parentUserId: number): Promise<void> {
  try {
    const [user] = await db
      .select({ referredByCode: usersTable.referredByCode })
      .from(usersTable)
      .where(eq(usersTable.id, parentUserId))
      .limit(1);

    if (!user?.referredByCode) return;

    const [referral] = await db
      .select()
      .from(referralsTable)
      .where(
        and(
          eq(referralsTable.referredUserId, parentUserId),
          eq(referralsTable.status, "pending"),
        ),
      )
      .limit(1);

    if (!referral) return;

    const rewardInr = referral.rewardInr ?? 100;

    await db.transaction(async (tx) => {
      // Mark referral converted
      await tx
        .update(referralsTable)
        .set({ status: "converted", convertedAt: new Date() })
        .where(eq(referralsTable.id, referral.id));

      // Credit referee (the parent who used the code)
      const [updatedReferee] = await tx
        .update(usersTable)
        .set({ walletBalanceInr: sql`${usersTable.walletBalanceInr} + ${rewardInr}` })
        .where(eq(usersTable.id, parentUserId))
        .returning({ walletBalanceInr: usersTable.walletBalanceInr });

      await tx.insert(walletTransactionsTable).values({
        userId: parentUserId,
        amountInr: rewardInr,
        type: "credit",
        sourceType: "refund",
        referenceId: referral.id,
        description: `Referral bonus — welcome to Includly!`,
        balanceAfter: updatedReferee!.walletBalanceInr,
      });

      // Credit referrer
      const [updatedReferrer] = await tx
        .update(usersTable)
        .set({ walletBalanceInr: sql`${usersTable.walletBalanceInr} + ${rewardInr}` })
        .where(eq(usersTable.id, referral.referrerUserId))
        .returning({ walletBalanceInr: usersTable.walletBalanceInr });

      await tx.insert(walletTransactionsTable).values({
        userId: referral.referrerUserId,
        amountInr: rewardInr,
        type: "credit",
        sourceType: "refund",
        referenceId: referral.id,
        description: `Referral reward — your friend booked their first session!`,
        balanceAfter: updatedReferrer!.walletBalanceInr,
      });
    });

    // Push notification to referrer
    void sendPushNotification(referral.referrerUserId, {
      title: "🎉 Referral converted!",
      body: `Your friend just booked their first session. ₹${rewardInr} has been added to your wallet.`,
      url: "/dashboard",
    });
  } catch {
    // Referral conversion must never fail the session payment flow
  }
}

export default router;
