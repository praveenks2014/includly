import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, and, gt } from "drizzle-orm";
import Stripe from "stripe";
import Razorpay from "razorpay";
import crypto from "crypto";
import { db, paymentsTable, subscriptionsTable, contactUnlocksTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
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

router.post(
  "/payments/stripe/checkout",
  requireAuth,
  requireRole("parent", "professional", "admin"),
  async (req: Request, res: Response): Promise<void> => {
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

    // Plan C is professional-only
    if (plan === "plan_c_featured" && req.userRole !== "professional" && req.userRole !== "admin") {
      res.status(403).json({ error: "Featured listing is only available to professional accounts." });
      return;
    }

    // Plan A/B are parent-only
    if ((plan === "plan_a_subscription" || plan === "plan_b_per_contact") && req.userRole === "professional") {
      res.status(403).json({ error: "Subscription and per-contact plans are for parents only." });
      return;
    }

    // Plan B requires professionalId
    if (plan === "plan_b_per_contact" && !professionalId) {
      res.status(400).json({ error: "professionalId is required for per-contact unlock." });
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

    const commonMeta = {
      paymentId: String(payment.id),
      userId: String(req.userId),
      plan,
      professionalId: professionalId ? String(professionalId) : "",
    };

    let sessionConfig: Parameters<typeof stripe.checkout.sessions.create>[0];

    if (plan === "plan_a_subscription" && planDetails.stripePriceId) {
      sessionConfig = {
        mode: "subscription",
        line_items: [{ price: planDetails.stripePriceId, quantity: 1 }],
        success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}&payment_id=${payment.id}`,
        cancel_url: `${cancelUrl}?payment_id=${payment.id}`,
        metadata: commonMeta,
        subscription_data: { metadata: commonMeta },
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
        metadata: commonMeta,
      };
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    await db
      .update(paymentsTable)
      .set({ providerOrderId: session.id })
      .where(eq(paymentsTable.id, payment.id));

    res.json({ sessionId: session.id, url: session.url!, paymentId: payment.id });
  },
);

router.get("/payments/stripe/session/:sessionId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const stripe = getStripe();
  if (!stripe) {
    res.status(503).json({ error: "Stripe is not configured." });
    return;
  }

  const rawSessionId = req.params.sessionId;
  const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
  if (!sessionId) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const paymentIdStr = session.metadata?.paymentId;
    const userIdStr = session.metadata?.userId;

    if (!paymentIdStr || !userIdStr || parseInt(userIdStr, 10) !== req.userId) {
      res.status(403).json({ error: "Session does not belong to this user" });
      return;
    }

    const paymentId = parseInt(paymentIdStr, 10);
    const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId)).limit(1);

    if (!payment) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }

    if (session.payment_status === "paid" && payment.status !== "completed") {
      await db
        .update(paymentsTable)
        .set({
          status: "completed",
          providerPaymentId: typeof session.payment_intent === "string" ? session.payment_intent : session.id,
          updatedAt: new Date(),
        })
        .where(eq(paymentsTable.id, paymentId));

      const stripeSubId = typeof session.subscription === "string" ? session.subscription : null;
      const result = await activatePayment(
        payment.userId,
        payment.plan,
        payment.professionalId ?? null,
        "stripe",
        stripeSubId,
      );

      res.json({
        status: "completed",
        plan: payment.plan,
        professionalId: payment.professionalId ?? null,
        ...result,
      });
      return;
    }

    res.json({
      status: payment.status,
      plan: payment.plan,
      professionalId: payment.professionalId ?? null,
      isSubscriptionActive: payment.plan === "plan_a_subscription" && payment.status === "completed",
      unlockedProfessionalId: payment.plan === "plan_b_per_contact" && payment.status === "completed"
        ? payment.professionalId
        : null,
    });
  } catch {
    res.status(400).json({ error: "Invalid session ID" });
  }
});

router.post(
  "/payments/razorpay/order",
  requireAuth,
  requireRole("parent", "professional", "admin"),
  async (req: Request, res: Response): Promise<void> => {
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

  // Plan C is Stripe-only; disallow via Razorpay
  if (plan === "plan_c_featured") {
    res.status(400).json({ error: "Featured listing (Plan C) is only available via Stripe." });
    return;
  }

  // Plan A/B are parent-only
  if ((plan === "plan_a_subscription" || plan === "plan_b_per_contact") && req.userRole === "professional") {
    res.status(403).json({ error: "Subscription and per-contact plans are for parents only." });
    return;
  }

  // Plan B requires professionalId
  if (plan === "plan_b_per_contact" && !professionalId) {
    res.status(400).json({ error: "professionalId is required for per-contact unlock." });
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
  providerSubscriptionId: string | null = null,
): Promise<{ isSubscriptionActive: boolean; unlockedProfessionalId: number | null }> {
  if (plan === "plan_a_subscription") {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    await db.insert(subscriptionsTable).values({
      userId,
      provider,
      providerSubscriptionId: providerSubscriptionId ?? undefined,
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
