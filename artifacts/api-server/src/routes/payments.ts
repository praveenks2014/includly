import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, and, gt } from "drizzle-orm";
import Stripe from "stripe";
import Razorpay from "razorpay";
import crypto from "crypto";
import { db, paymentsTable, subscriptionsTable, contactUnlocksTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { PLANS, type PlanId } from "../lib/paymentPlans";
import {
  CreateStripeCheckoutBody,
  CreateRazorpayOrderBody,
  VerifyRazorpayPaymentBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

function getStripe(): Stripe | null {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) return null;
  return new Stripe(key);
}

function getRazorpay(): Razorpay | null {
  const keyId = process.env["RAZORPAY_KEY_ID"];
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keyId || !keySecret) return null;
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

router.get("/payments/plans", (_req: Request, res: Response): void => {
  res.json({
    planA: PLANS.plan_a_subscription,
    planB: PLANS.plan_b_per_contact,
    planC: PLANS.plan_c_featured,
  });
});

router.get("/payments/subscription", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const now = new Date();
  const [sub] = await db
    .select()
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.userId, req.userId!),
        eq(subscriptionsTable.status, "active"),
        gt(subscriptionsTable.expiresAt, now),
      ),
    )
    .orderBy(desc(subscriptionsTable.expiresAt))
    .limit(1);

  if (!sub) {
    res.json({ hasActiveSubscription: false, subscription: null });
    return;
  }

  res.json({
    hasActiveSubscription: true,
    subscription: {
      id: sub.id,
      expiresAt: sub.expiresAt.toISOString(),
      provider: sub.provider,
      plan: sub.plan,
    },
  });
});

router.get("/payments/history", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const payments = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.userId, req.userId!))
    .orderBy(desc(paymentsTable.createdAt))
    .limit(50);

  res.json(
    payments.map((p) => ({
      id: p.id,
      plan: p.plan,
      provider: p.provider,
      amountPaise: p.amountPaise,
      currency: p.currency,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
      professionalId: p.professionalId ?? null,
    })),
  );
});

router.post("/payments/stripe/checkout", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const stripe = getStripe();
  if (!stripe) {
    res.status(503).json({ error: "Stripe is not configured. Please add STRIPE_SECRET_KEY." });
    return;
  }

  const parsed = CreateStripeCheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { plan, professionalId, successUrl, cancelUrl } = parsed.data;
  const planDetails = PLANS[plan as PlanId];

  if (!planDetails) {
    res.status(400).json({ error: "Invalid plan" });
    return;
  }

  const [payment] = await db
    .insert(paymentsTable)
    .values({
      userId: req.userId!,
      plan: plan as "plan_a_subscription" | "plan_b_per_contact" | "plan_c_featured",
      provider: "stripe",
      amountPaise: planDetails.amountPaise,
      currency: planDetails.currency,
      status: "pending",
      professionalId: professionalId ?? null,
    })
    .returning();

  let sessionConfig: Parameters<typeof stripe.checkout.sessions.create>[0];

  if (plan === "plan_a_subscription" && planDetails.stripePriceId) {
    sessionConfig = {
      mode: "subscription",
      line_items: [{ price: planDetails.stripePriceId, quantity: 1 }],
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}&payment_id=${payment.id}`,
      cancel_url: `${cancelUrl}?payment_id=${payment.id}`,
      metadata: { paymentId: String(payment.id), userId: String(req.userId), plan },
    };
  } else {
    const lineItem = planDetails.stripePriceId
      ? { price: planDetails.stripePriceId, quantity: 1 }
      : {
          price_data: {
            currency: planDetails.currency.toLowerCase(),
            product_data: { name: planDetails.name, description: planDetails.description },
            unit_amount: planDetails.amountPaise,
          },
          quantity: 1,
        };

    sessionConfig = {
      mode: "payment",
      line_items: [lineItem],
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}&payment_id=${payment.id}`,
      cancel_url: `${cancelUrl}?payment_id=${payment.id}`,
      metadata: {
        paymentId: String(payment.id),
        userId: String(req.userId),
        plan,
        professionalId: professionalId ? String(professionalId) : "",
      },
    };
  }

  const session = await stripe.checkout.sessions.create(sessionConfig);

  await db
    .update(paymentsTable)
    .set({ providerOrderId: session.id })
    .where(eq(paymentsTable.id, payment.id));

  res.json({ sessionId: session.id, url: session.url!, paymentId: payment.id });
});

router.post("/payments/razorpay/order", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const razorpay = getRazorpay();
  if (!razorpay) {
    res.status(503).json({ error: "Razorpay is not configured. Please add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET." });
    return;
  }

  const parsed = CreateRazorpayOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { plan, professionalId } = parsed.data;
  const planDetails = PLANS[plan as PlanId];

  if (!planDetails) {
    res.status(400).json({ error: "Invalid plan" });
    return;
  }

  const [payment] = await db
    .insert(paymentsTable)
    .values({
      userId: req.userId!,
      plan: plan as "plan_a_subscription" | "plan_b_per_contact" | "plan_c_featured",
      provider: "razorpay",
      amountPaise: planDetails.amountPaise,
      currency: planDetails.currency,
      status: "pending",
      professionalId: professionalId ?? null,
    })
    .returning();

  const order = await razorpay.orders.create({
    amount: planDetails.amountPaise,
    currency: planDetails.currency,
    receipt: `payment_${payment.id}`,
    notes: {
      paymentId: String(payment.id),
      userId: String(req.userId),
      plan,
      professionalId: professionalId ? String(professionalId) : "",
    },
  });

  await db
    .update(paymentsTable)
    .set({ providerOrderId: order.id })
    .where(eq(paymentsTable.id, payment.id));

  res.json({
    orderId: order.id,
    amount: planDetails.amountPaise,
    currency: planDetails.currency,
    keyId: process.env["RAZORPAY_KEY_ID"]!,
    paymentId: payment.id,
    planName: planDetails.name,
  });
});

router.post("/payments/razorpay/verify", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = VerifyRazorpayPaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { razorpayPaymentId, razorpayOrderId, razorpaySignature, paymentId } = parsed.data;

  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keySecret) {
    res.status(503).json({ error: "Razorpay is not configured" });
    return;
  }

  const [payment] = await db
    .select()
    .from(paymentsTable)
    .where(and(eq(paymentsTable.id, paymentId), eq(paymentsTable.userId, req.userId!)))
    .limit(1);

  if (!payment) {
    res.status(404).json({ error: "Payment record not found" });
    return;
  }

  if (payment.status === "completed") {
    res.status(400).json({ error: "Payment already processed" });
    return;
  }

  if (payment.providerOrderId !== razorpayOrderId) {
    res.status(400).json({ error: "Order ID mismatch" });
    return;
  }

  const expectedSignature = crypto
    .createHmac("sha256", keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

  if (expectedSignature !== razorpaySignature) {
    res.status(400).json({ error: "Invalid payment signature" });
    return;
  }

  await db
    .update(paymentsTable)
    .set({ status: "completed", providerPaymentId: razorpayPaymentId, updatedAt: new Date() })
    .where(eq(paymentsTable.id, paymentId));

  const result = await activatePayment(payment.userId, payment.plan, payment.professionalId ?? null, "razorpay");

  res.json({
    success: true,
    message: result.isSubscriptionActive
      ? "Premium subscription activated"
      : result.unlockedProfessionalId
        ? "Contact unlocked successfully"
        : "Payment recorded",
    ...result,
  });
});

export async function activatePayment(
  userId: number,
  plan: string,
  professionalId: number | null,
  provider: "stripe" | "razorpay" = "razorpay",
): Promise<{ isSubscriptionActive: boolean; unlockedProfessionalId: number | null }> {
  if (plan === "plan_a_subscription") {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    await db.insert(subscriptionsTable).values({
      userId,
      provider,
      plan: "plan_a",
      status: "active",
      startsAt: new Date(),
      expiresAt,
    });
    return { isSubscriptionActive: true, unlockedProfessionalId: null };
  }

  if (plan === "plan_b_per_contact" && professionalId) {
    const existing = await db
      .select()
      .from(contactUnlocksTable)
      .where(and(eq(contactUnlocksTable.parentId, userId), eq(contactUnlocksTable.professionalId, professionalId)))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(contactUnlocksTable).values({ parentId: userId, professionalId });
    }
    return { isSubscriptionActive: false, unlockedProfessionalId: professionalId };
  }

  return { isSubscriptionActive: false, unlockedProfessionalId: null };
}

export default router;
