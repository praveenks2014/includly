import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import Razorpay from "razorpay";
import crypto from "crypto";
import {
  db,
  walletTransactionsTable,
  usersTable,
  paymentsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { z } from "zod";

const router: IRouter = Router();

function getRazorpay() {
  const keyId = process.env["RAZORPAY_KEY_ID"];
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keyId || !keySecret) return null;
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

router.get("/wallet/balance", requireAuth, requireRole("parent", "admin"), async (req, res): Promise<void> => {
  const [user] = await db
    .select({ walletBalanceInr: usersTable.walletBalanceInr })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!))
    .limit(1);

  res.json({ balanceInr: user?.walletBalanceInr ?? 0 });
});

router.get("/wallet/history", requireAuth, requireRole("parent", "admin"), async (req, res): Promise<void> => {
  const limit = Math.min(50, parseInt(String(req.query.limit ?? "20"), 10));
  const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10));

  const rows = await db
    .select()
    .from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.userId, req.userId!))
    .orderBy(desc(walletTransactionsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.userId, req.userId!));

  res.json({ transactions: rows, total });
});

router.post("/wallet/topup/order", requireAuth, requireRole("parent", "admin"), async (req, res): Promise<void> => {
  const parsed = z.object({ amountInr: z.number().int().min(100).max(50000) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const razorpay = getRazorpay();
  if (!razorpay) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  const { amountInr } = parsed.data;

  const order = await razorpay.orders.create({
    amount: amountInr * 100,
    currency: "INR",
    receipt: `wallet_topup_${Date.now()}`,
  });

  const [payment] = await db
    .insert(paymentsTable)
    .values({
      userId: req.userId!,
      plan: "plan_b_per_contact",
      provider: "razorpay",
      providerOrderId: order.id as string,
      amountPaise: amountInr * 100,
      currency: "INR",
      status: "pending",
      metadata: JSON.stringify({ type: "wallet_topup", amountInr }),
    })
    .returning();

  res.json({
    orderId: order.id,
    paymentId: payment!.id,
    amount: amountInr * 100,
    currency: "INR",
    keyId: process.env["RAZORPAY_KEY_ID"]!,
  });
});

router.post("/wallet/topup/verify", requireAuth, requireRole("parent", "admin"), async (req, res): Promise<void> => {
  const parsed = z.object({
    paymentId: z.number().int(),
    razorpayPaymentId: z.string(),
    razorpayOrderId: z.string(),
    razorpaySignature: z.string(),
  }).safeParse(req.body);

  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keySecret) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  const { paymentId, razorpayPaymentId, razorpayOrderId, razorpaySignature } = parsed.data;

  const [payment] = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.id, paymentId))
    .limit(1);

  if (!payment || payment.userId !== req.userId!) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }

  const expectedSig = crypto
    .createHmac("sha256", keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

  if (expectedSig !== razorpaySignature) {
    res.status(400).json({ error: "Payment signature verification failed" });
    return;
  }

  const meta = payment.metadata ? JSON.parse(payment.metadata) : {};
  const amountInr = meta.amountInr ?? Math.round(payment.amountPaise / 100);

  await db.transaction(async (tx) => {
    await tx
      .update(paymentsTable)
      .set({ status: "completed", providerPaymentId: razorpayPaymentId })
      .where(eq(paymentsTable.id, paymentId));

    const [updated] = await tx
      .update(usersTable)
      .set({ walletBalanceInr: sql`${usersTable.walletBalanceInr} + ${amountInr}` })
      .where(eq(usersTable.id, req.userId!))
      .returning({ walletBalanceInr: usersTable.walletBalanceInr });

    await tx.insert(walletTransactionsTable).values({
      userId: req.userId!,
      amountInr,
      type: "credit",
      sourceType: "topup",
      referenceId: paymentId,
      description: `Wallet top-up ₹${amountInr}`,
      balanceAfter: updated!.walletBalanceInr,
    });
  });

  res.json({ success: true, balanceInr: (await db.select({ w: usersTable.walletBalanceInr }).from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1))[0]?.w ?? amountInr });
});

export default router;
