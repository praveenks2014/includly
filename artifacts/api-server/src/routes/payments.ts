import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, and, gt, gte, sql, isNull, or } from "drizzle-orm";
import Stripe from "stripe";
import Razorpay from "razorpay";
import crypto from "crypto";
import { db, paymentsTable, subscriptionsTable, contactUnlocksTable, professionalProfilesTable, professionalSubscriptionsTable, adminSettingsTable, usersTable, DEFAULT_CONTACT_LIMIT } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { PLANS, type PlanId } from "../lib/paymentPlans";
import {
  CreateStripeCheckoutBody,
  CreateRazorpayOrderBody,
  VerifyRazorpayPaymentBody,
} from "@workspace/api-zod";
import { notifyProfessionalOnUnlock } from "../lib/notificationService";
import { onProfessionalBecameEligible } from "../lib/candidateRefresh";

const router: IRouter = Router();

interface ProfessionalSnapshot {
  fullName: string;
  avatarUrl: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  expiresAt: string | null;
}

async function fetchProfessionalSnapshot(
  userId: number,
  professionalId: number,
): Promise<ProfessionalSnapshot | null> {
  const [prof] = await db
    .select({
      fullName: professionalProfilesTable.fullName,
      phone: professionalProfilesTable.phone,
      email: professionalProfilesTable.email,
      city: professionalProfilesTable.city,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(professionalProfilesTable)
    .leftJoin(usersTable, eq(usersTable.id, professionalProfilesTable.userId))
    .where(eq(professionalProfilesTable.id, professionalId))
    .limit(1);

  if (!prof) return null;

  const now = new Date();
  const [unlock] = await db
    .select({ expiresAt: contactUnlocksTable.expiresAt })
    .from(contactUnlocksTable)
    .where(
      and(
        eq(contactUnlocksTable.parentId, userId),
        eq(contactUnlocksTable.professionalId, professionalId),
      ),
    )
    .limit(1);

  // Only expose contact details when the unlock is currently active
  const isUnlockActive = unlock
    ? (unlock.expiresAt === null || unlock.expiresAt > now)
    : false;

  return {
    fullName: prof.fullName ?? "",
    avatarUrl: prof.avatarUrl ?? null,
    phone: isUnlockActive ? prof.phone : null,
    email: isUnlockActive ? prof.email : null,
    city: prof.city,
    expiresAt: unlock?.expiresAt ? unlock.expiresAt.toISOString() : null,
  };
}

async function getContactLimit(): Promise<number> {
  try {
    const [settings] = await db
      .select({ contactLimitPerParent: adminSettingsTable.contactLimitPerParent })
      .from(adminSettingsTable)
      .limit(1);
    if (settings && settings.contactLimitPerParent > 0) {
      return settings.contactLimitPerParent;
    }
  } catch {
  }
  return DEFAULT_CONTACT_LIMIT;
}

async function getMonthlyUnlockCount(userId: number): Promise<number> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const unlocks = await db
    .select({ id: contactUnlocksTable.id })
    .from(contactUnlocksTable)
    .where(
      and(
        eq(contactUnlocksTable.parentId, userId),
        gte(contactUnlocksTable.unlockedAt, monthStart),
      ),
    );
  return unlocks.length;
}

async function parentHasActiveSubscription(userId: number): Promise<boolean> {
  const now = new Date();
  const [sub] = await db
    .select({ id: subscriptionsTable.id })
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.userId, userId),
        eq(subscriptionsTable.status, "active"),
        gt(subscriptionsTable.expiresAt, now),
      ),
    )
    .limit(1);
  return !!sub;
}

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
    planD: PLANS.plan_d_pro_onetime,
    planE: PLANS.plan_e_pro_monthly,
    planF: PLANS.plan_f_per_booking,
    planSessionPass5: PLANS.plan_session_pass_5,
    planSessionPass10: PLANS.plan_session_pass_10,
  });
});

router.get("/payments/session-credits", requireAuth, requireRole("parent"), async (req: Request, res: Response): Promise<void> => {
  const [user] = await db
    .select({ sessionCredits: usersTable.sessionCredits })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!))
    .limit(1);

  res.json({ credits: user?.sessionCredits ?? 0 });
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

router.get("/payments/unlock-snapshot/:professionalId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const raw = Array.isArray(req.params.professionalId) ? req.params.professionalId[0] : req.params.professionalId;
  const professionalId = parseInt(raw, 10);
  if (isNaN(professionalId)) {
    res.status(400).json({ error: "Invalid professionalId" });
    return;
  }

  // Verify caller has an active unlock for this professional before returning contact data
  const now = new Date();
  const [unlock] = await db
    .select({ id: contactUnlocksTable.id })
    .from(contactUnlocksTable)
    .where(
      and(
        eq(contactUnlocksTable.parentId, req.userId!),
        eq(contactUnlocksTable.professionalId, professionalId),
        or(isNull(contactUnlocksTable.expiresAt), gt(contactUnlocksTable.expiresAt, now)),
      ),
    )
    .limit(1);

  if (!unlock) {
    res.status(403).json({ error: "No active unlock for this professional" });
    return;
  }

  const snapshot = await fetchProfessionalSnapshot(req.userId!, professionalId);
  if (!snapshot) {
    res.status(404).json({ error: "Professional not found" });
    return;
  }

  res.json(snapshot);
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

    const plan: PlanId = parsed.data.plan as PlanId;
    const { professionalId, successUrl, cancelUrl } = parsed.data;
    const planDetails = PLANS[plan];

    if (!planDetails) {
      res.status(400).json({ error: "Invalid plan" });
      return;
    }

    // Validate redirect URLs are same-origin to prevent open-redirect abuse
    const allowedOrigins = process.env["ALLOWED_REDIRECT_ORIGINS"]
      ? process.env["ALLOWED_REDIRECT_ORIGINS"].split(",").map((s) => s.trim())
      : null;

    function isOriginAllowed(url: string): boolean {
      try {
        const parsed = new URL(url);
        if (allowedOrigins) {
          return allowedOrigins.some((o) => o === parsed.origin);
        }
        // In dev (no env var), allow any https or localhost
        return parsed.protocol === "https:" || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
      } catch {
        return false;
      }
    }

    if (!isOriginAllowed(successUrl) || !isOriginAllowed(cancelUrl)) {
      res.status(400).json({ error: "Invalid redirect URL: must be a trusted origin." });
      return;
    }

    // Plan C is professional-only
    if (plan === "plan_c_featured" && req.userRole !== "professional" && req.userRole !== "admin") {
      res.status(403).json({ error: "Featured listing is only available to professional accounts." });
      return;
    }

    // Plan A/B/F are parent-only
    if ((plan === "plan_a_subscription" || plan === "plan_b_per_contact" || plan === "plan_f_per_booking") && req.userRole === "professional") {
      res.status(403).json({ error: "Subscription and per-contact plans are for parents only." });
      return;
    }

    // Plan D/E are professional-only
    if ((plan === "plan_d_pro_onetime" || plan === "plan_e_pro_monthly") && req.userRole === "parent") {
      res.status(403).json({ error: "Professional billing plans are for professional accounts only." });
      return;
    }

    // Session-pass plans are Razorpay-only (UPI/cards via India payment gateway)
    if (plan === "plan_session_pass_5" || plan === "plan_session_pass_10") {
      res.status(400).json({ error: "Session pass plans are only available via Razorpay. Please use the in-app purchase flow." });
      return;
    }

    // Plan B/F require professionalId (teacher-scoped unlocks and session bookings)
    if ((plan === "plan_b_per_contact" || plan === "plan_f_per_booking") && !professionalId) {
      res.status(400).json({ error: "professionalId is required for contact unlocks and session bookings." });
      return;
    }

    // Plan B: enforce monthly contact limit (spam protection)
    if (plan === "plan_b_per_contact" && req.userRole === "parent") {
      const limit = await getContactLimit();
      const used = await getMonthlyUnlockCount(req.userId!);
      if (used >= limit) {
        res.status(403).json({
          error: `You've reached your contact limit for this month (${used}/${limit}). Upgrade to Plan A for a 30-day teacher unlock.`,
          code: "CONTACT_LIMIT_REACHED",
          used,
          limit,
        });
        return;
      }
    }

    const [payment] = await db
      .insert(paymentsTable)
      .values({
        userId: req.userId!,
        plan: plan as "plan_a_subscription" | "plan_b_per_contact" | "plan_c_featured" | "plan_d_pro_onetime" | "plan_e_pro_monthly" | "plan_f_per_booking",
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

    // Append Stripe session params safely — successUrl may already contain query params
    // (e.g. professionalId, plan) appended by the frontend, so use & instead of ? when needed.
    const successSep = successUrl.includes("?") ? "&" : "?";
    const cancelSep = cancelUrl.includes("?") ? "&" : "?";

    let sessionConfig: Parameters<typeof stripe.checkout.sessions.create>[0];

    if (plan === "plan_a_subscription" && planDetails.stripePriceId) {
      sessionConfig = {
        mode: "subscription",
        line_items: [{ price: planDetails.stripePriceId, quantity: 1 }],
        success_url: `${successUrl}${successSep}session_id={CHECKOUT_SESSION_ID}&payment_id=${payment.id}`,
        cancel_url: `${cancelUrl}${cancelSep}payment_id=${payment.id}`,
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
        success_url: `${successUrl}${successSep}session_id={CHECKOUT_SESSION_ID}&payment_id=${payment.id}`,
        cancel_url: `${cancelUrl}${cancelSep}payment_id=${payment.id}`,
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
    const [payment] = await db
      .select()
      .from(paymentsTable)
      .where(and(eq(paymentsTable.id, paymentId), eq(paymentsTable.userId, req.userId!)))
      .limit(1);

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

      const profSnapshot = payment.professionalId
        ? await fetchProfessionalSnapshot(payment.userId, payment.professionalId)
        : null;

      res.json({
        status: "completed",
        plan: payment.plan,
        professionalId: payment.professionalId ?? null,
        ...result,
        professional: profSnapshot,
      });
      return;
    }

    const alreadyProfSnapshot = payment.professionalId && payment.status === "completed"
      ? await fetchProfessionalSnapshot(payment.userId, payment.professionalId)
      : null;

    res.json({
      status: payment.status,
      plan: payment.plan,
      professionalId: payment.professionalId ?? null,
      isSubscriptionActive: payment.plan === "plan_a_subscription" && payment.status === "completed",
      unlockedProfessionalId: payment.plan === "plan_b_per_contact" && payment.status === "completed"
        ? payment.professionalId
        : null,
      professional: alreadyProfSnapshot,
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

  const plan: PlanId = parsed.data.plan as PlanId;
  const { professionalId } = parsed.data;
  const planDetails = PLANS[plan];

  if (!planDetails) {
    res.status(400).json({ error: "Invalid plan" });
    return;
  }

  // Plan A/B/F are parent-only
  if ((plan === "plan_a_subscription" || plan === "plan_b_per_contact" || plan === "plan_f_per_booking") && req.userRole === "professional") {
    res.status(403).json({ error: "Subscription and per-contact plans are for parents only." });
    return;
  }

  // Plan C is professional/admin-only (Featured Listing)
  if (plan === "plan_c_featured" && req.userRole !== "professional" && req.userRole !== "admin") {
    res.status(403).json({ error: "Featured listing is only available to professional accounts." });
    return;
  }

  // Plan D/E are professional-only
  if ((plan === "plan_d_pro_onetime" || plan === "plan_e_pro_monthly") && req.userRole === "parent") {
    res.status(403).json({ error: "Professional billing plans are for professional accounts only." });
    return;
  }

  // Session pass plans are parent-only
  if ((plan === "plan_session_pass_5" || plan === "plan_session_pass_10") && req.userRole !== "parent") {
    res.status(403).json({ error: "Session passes are for parent accounts only." });
    return;
  }

  // Plan B/F require professionalId (teacher-scoped unlocks and session bookings)
  if ((plan === "plan_b_per_contact" || plan === "plan_f_per_booking") && !professionalId) {
    res.status(400).json({ error: "professionalId is required for contact unlocks and session bookings." });
    return;
  }

  // Plan B: enforce monthly contact limit (spam protection)
  if (plan === "plan_b_per_contact" && req.userRole === "parent") {
    const limit = await getContactLimit();
    const used = await getMonthlyUnlockCount(req.userId!);
    if (used >= limit) {
      res.status(403).json({
        error: `You've reached your contact limit for this month (${used}/${limit}). Upgrade to Plan A for a 30-day teacher unlock.`,
        code: "CONTACT_LIMIT_REACHED",
        used,
        limit,
      });
      return;
    }
  }

  const [payment] = await db
    .insert(paymentsTable)
    .values({
      userId: req.userId!,
      plan: plan as "plan_a_subscription" | "plan_b_per_contact" | "plan_c_featured" | "plan_d_pro_onetime" | "plan_e_pro_monthly" | "plan_f_per_booking",
      provider: "razorpay",
      amountPaise: planDetails.amountPaise,
      currency: planDetails.currency,
      status: "pending",
      professionalId: professionalId ?? null,
    })
    .returning();

  // plan_e_pro_monthly: use Razorpay recurring subscription instead of one-time order
  if (plan === "plan_e_pro_monthly") {
    // Guard: prevent duplicate active Pro subscription (use live subscription status, not isPremium flag)
    const [activePro] = await db
      .select({ id: professionalSubscriptionsTable.id })
      .from(professionalSubscriptionsTable)
      .innerJoin(
        professionalProfilesTable,
        eq(professionalProfilesTable.id, professionalSubscriptionsTable.professionalId),
      )
      .where(
        and(
          eq(professionalProfilesTable.userId, req.userId!),
          eq(professionalSubscriptionsTable.status, "active"),
          gt(professionalSubscriptionsTable.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (activePro) {
      res.status(409).json({ error: "You already have an active Pro subscription." });
      return;
    }

    // Create a Razorpay billing plan for the monthly subscription
    const rzPlan = await razorpay.plans.create({
      period: "monthly",
      interval: 1,
      item: {
        name: planDetails.name,
        amount: planDetails.amountPaise,
        currency: planDetails.currency,
        description: planDetails.description,
      },
      notes: { paymentId: String(payment.id) },
    } as Parameters<typeof razorpay.plans.create>[0]);

    // Create a recurring subscription against that plan
    const subscription = await razorpay.subscriptions.create({
      plan_id: rzPlan.id,
      customer_notify: 1,
      total_count: 12, // up to 12 monthly cycles
      quantity: 1,
      notes: {
        paymentId: String(payment.id),
        userId: String(req.userId),
        plan,
      },
    } as Parameters<typeof razorpay.subscriptions.create>[0]);

    await db
      .update(paymentsTable)
      .set({ providerOrderId: subscription.id })
      .where(eq(paymentsTable.id, payment.id));

    res.json({
      subscriptionId: subscription.id,
      isSubscription: true,
      currency: planDetails.currency,
      keyId: process.env["RAZORPAY_KEY_ID"]!,
      paymentId: payment.id,
      planName: planDetails.name,
    });
    return;
  }

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

// Razorpay webhook for subscription lifecycle (renewal, halt, cancellation)
// Configure RAZORPAY_WEBHOOK_SECRET in the Razorpay dashboard webhook settings
router.post("/payments/razorpay/webhook", async (req: Request, res: Response): Promise<void> => {
  const webhookSecret = process.env["RAZORPAY_WEBHOOK_SECRET"];
  const signature = req.headers["x-razorpay-signature"] as string | undefined;
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

  if (webhookSecret) {
    // Secret is configured: strictly enforce signature — fail closed on any missing/invalid input
    if (!signature || !rawBody) {
      res.status(401).json({ error: "Missing webhook signature or body" });
      return;
    }
    const expectedSig = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");
    if (expectedSig !== signature) {
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }
  } else if (process.env["NODE_ENV"] === "production") {
    // In production without a configured secret, reject all webhook calls to prevent subscription tampering
    res.status(503).json({ error: "RAZORPAY_WEBHOOK_SECRET must be configured in production" });
    return;
  }

  const event = req.body as {
    event?: string;
    payload?: {
      subscription?: {
        entity?: {
          id?: string;
          status?: string;
          current_end?: number;
        };
      };
    };
  };

  const subscriptionId = event?.payload?.subscription?.entity?.id;
  const eventType = event?.event;

  if (!subscriptionId || !eventType) {
    res.json({ ok: true });
    return;
  }

  if (eventType === "subscription.charged") {
    // Extend professional subscription by 30 days on successful auto-debit
    const currentEnd = event.payload?.subscription?.entity?.current_end;
    const expiresAt = currentEnd
      ? new Date(currentEnd * 1000)
      : (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d; })();

    await db
      .update(professionalSubscriptionsTable)
      .set({ status: "active", expiresAt })
      .where(eq(professionalSubscriptionsTable.providerSubscriptionId, subscriptionId));
  } else if (eventType === "subscription.halted") {
    const [sub] = await db
      .update(professionalSubscriptionsTable)
      .set({ status: "halted" })
      .where(eq(professionalSubscriptionsTable.providerSubscriptionId, subscriptionId))
      .returning({ professionalId: professionalSubscriptionsTable.professionalId });
    if (sub) {
      await db
        .update(professionalProfilesTable)
        .set({ isPremium: false })
        .where(eq(professionalProfilesTable.id, sub.professionalId));
    }
  } else if (eventType === "subscription.cancelled") {
    const [sub] = await db
      .update(professionalSubscriptionsTable)
      .set({ status: "cancelled" })
      .where(eq(professionalSubscriptionsTable.providerSubscriptionId, subscriptionId))
      .returning({ professionalId: professionalSubscriptionsTable.professionalId });
    if (sub) {
      await db
        .update(professionalProfilesTable)
        .set({ isPremium: false })
        .where(eq(professionalProfilesTable.id, sub.professionalId));
    }
  }

  res.json({ ok: true });
});

router.post("/payments/razorpay/verify", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = VerifyRazorpayPaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { razorpayPaymentId, razorpayOrderId, razorpaySubscriptionId, razorpaySignature, paymentId } = parsed.data;

  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keySecret) {
    res.status(503).json({ error: "Razorpay is not configured" });
    return;
  }

  if (!razorpayOrderId && !razorpaySubscriptionId) {
    res.status(400).json({ error: "Either razorpayOrderId or razorpaySubscriptionId is required" });
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

  // Subscription payment: HMAC is payment_id|subscription_id
  // Order payment: HMAC is order_id|payment_id
  let expectedSignature: string;
  if (razorpaySubscriptionId) {
    if (payment.providerOrderId !== razorpaySubscriptionId) {
      res.status(400).json({ error: "Subscription ID mismatch" });
      return;
    }
    expectedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(`${razorpayPaymentId}|${razorpaySubscriptionId}`)
      .digest("hex");
  } else {
    if (payment.providerOrderId !== razorpayOrderId) {
      res.status(400).json({ error: "Order ID mismatch" });
      return;
    }
    expectedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest("hex");
  }

  if (expectedSignature !== razorpaySignature) {
    res.status(400).json({ error: "Invalid payment signature" });
    return;
  }

  await db
    .update(paymentsTable)
    .set({ status: "completed", providerPaymentId: razorpayPaymentId, updatedAt: new Date() })
    .where(eq(paymentsTable.id, paymentId));

  const result = await activatePayment(
    payment.userId,
    payment.plan,
    payment.professionalId ?? null,
    "razorpay",
    razorpaySubscriptionId ?? null,
  );

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
): Promise<{ isSubscriptionActive: boolean; unlockedProfessionalId: number | null; paymentActivated?: boolean }> {
  // Plan A without professionalId: general 30-day subscription (bought from pricing page)
  if (plan === "plan_a_subscription" && !professionalId) {
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + 30);
    await db.insert(subscriptionsTable).values({
      userId,
      provider,
      plan: "plan_a",
      status: "active",
      startsAt: now,
      expiresAt,
      providerSubscriptionId: providerSubscriptionId ?? undefined,
    });
    return { isSubscriptionActive: true, unlockedProfessionalId: null };
  }

  // Plan A with professionalId: teacher-scoped 30-day contact unlock
  if (plan === "plan_a_subscription" && professionalId) {
    const now = new Date();

    // Find any existing unlock (active or expired) for this parent+professional pair
    const [existingUnlock] = await db
      .select({ id: contactUnlocksTable.id, expiresAt: contactUnlocksTable.expiresAt })
      .from(contactUnlocksTable)
      .where(
        and(
          eq(contactUnlocksTable.parentId, userId),
          eq(contactUnlocksTable.professionalId, professionalId),
        ),
      )
      .limit(1);

    if (existingUnlock) {
      if (existingUnlock.expiresAt !== null) {
        // Extend by 30 days from the later of current expiry or now (handles pre-expiry renewal)
        const baseDate = existingUnlock.expiresAt > now ? existingUnlock.expiresAt : now;
        const newExpiresAt = new Date(baseDate);
        newExpiresAt.setDate(newExpiresAt.getDate() + 30);
        await db
          .update(contactUnlocksTable)
          .set({ expiresAt: newExpiresAt })
          .where(eq(contactUnlocksTable.id, existingUnlock.id));
      }
      // If expiresAt IS NULL (permanent unlock from plan_b), no update needed — it already grants access
    } else {
      // First-time unlock: insert new 30-day unlock (chatAccessOnly=true — no raw contact revealed)
      const expiresAt = new Date(now);
      expiresAt.setDate(expiresAt.getDate() + 30);
      await db.insert(contactUnlocksTable).values({
        parentId: userId,
        professionalId,
        expiresAt,
        chatAccessOnly: true,
      });

      const [prof] = await db
        .select({ userId: professionalProfilesTable.userId })
        .from(professionalProfilesTable)
        .where(eq(professionalProfilesTable.id, professionalId))
        .limit(1);

      if (prof) {
        void notifyProfessionalOnUnlock(prof.userId).catch(() => {});
      }
    }
    return { isSubscriptionActive: false, unlockedProfessionalId: professionalId };
  }

  if ((plan === "plan_b_per_contact" || plan === "plan_f_per_booking") && professionalId) {
    // Plan B/F = permanent unlock (expiresAt IS NULL). Always ensure the parent has permanent access.
    const [existing] = await db
      .select({ id: contactUnlocksTable.id, expiresAt: contactUnlocksTable.expiresAt })
      .from(contactUnlocksTable)
      .where(and(eq(contactUnlocksTable.parentId, userId), eq(contactUnlocksTable.professionalId, professionalId)))
      .limit(1);

    const [prof] = await db
      .select({ userId: professionalProfilesTable.userId })
      .from(professionalProfilesTable)
      .where(eq(professionalProfilesTable.id, professionalId))
      .limit(1);

    if (existing) {
      if (existing.expiresAt !== null) {
        // Upgrade expired or time-limited unlock (Plan A) to permanent (Plan B)
        await db
          .update(contactUnlocksTable)
          .set({ expiresAt: null })
          .where(eq(contactUnlocksTable.id, existing.id));
        if (prof) void notifyProfessionalOnUnlock(prof.userId).catch(() => {});
      }
      // If expiresAt IS NULL, unlock is already permanent — no action needed
    } else {
      // First-time unlock: insert permanent record (chatAccessOnly=true — no raw contact revealed)
      await db.insert(contactUnlocksTable).values({ parentId: userId, professionalId, chatAccessOnly: true });
      if (prof) void notifyProfessionalOnUnlock(prof.userId).catch(() => {});
    }
    return { isSubscriptionActive: false, unlockedProfessionalId: professionalId };
  }

  if (plan === "plan_d_pro_onetime") {
    const [prof] = await db
      .select()
      .from(professionalProfilesTable)
      .where(eq(professionalProfilesTable.userId, userId))
      .limit(1);

    if (prof) {
      await db
        .update(professionalProfilesTable)
        .set({ paymentActivated: true })
        .where(eq(professionalProfilesTable.id, prof.id));
      // Candidate-list auto-refresh — no-ops for non-shadow-teacher-eligible
      // professionals (checked inside), so safe to call unconditionally here.
      try { await onProfessionalBecameEligible(prof.id); } catch { /* non-blocking */ }
    }
    return { isSubscriptionActive: false, unlockedProfessionalId: null, paymentActivated: true };
  }

  if (plan === "plan_e_pro_monthly") {
    const [prof] = await db
      .select()
      .from(professionalProfilesTable)
      .where(eq(professionalProfilesTable.userId, userId))
      .limit(1);

    if (prof) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);
      await db.insert(professionalSubscriptionsTable).values({
        professionalId: prof.id,
        provider,
        providerSubscriptionId: providerSubscriptionId ?? undefined,
        plan: "plan_e_pro_monthly",
        status: "active",
        startsAt: new Date(),
        expiresAt,
      });
      await db
        .update(professionalProfilesTable)
        .set({ isPremium: true })
        .where(eq(professionalProfilesTable.id, prof.id));
    }
    return { isSubscriptionActive: false, unlockedProfessionalId: null };
  }

  if (plan === "plan_session_pass_5") {
    await db
      .update(usersTable)
      .set({ sessionCredits: sql`${usersTable.sessionCredits} + 5` })
      .where(eq(usersTable.id, userId));
    return { isSubscriptionActive: false, unlockedProfessionalId: null };
  }

  if (plan === "plan_session_pass_10") {
    await db
      .update(usersTable)
      .set({ sessionCredits: sql`${usersTable.sessionCredits} + 10` })
      .where(eq(usersTable.id, userId));
    return { isSubscriptionActive: false, unlockedProfessionalId: null };
  }

  return { isSubscriptionActive: false, unlockedProfessionalId: null };
}

export default router;
