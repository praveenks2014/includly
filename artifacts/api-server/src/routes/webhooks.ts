import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and } from "drizzle-orm";
import Stripe from "stripe";
import crypto from "crypto";
import { db, paymentsTable, subscriptionsTable, contactUnlocksTable } from "@workspace/db";
import { activatePayment } from "./payments";

const router: IRouter = Router();

router.post(
  "/webhooks/stripe",
  async (req: Request, res: Response): Promise<void> => {
    const stripeKey = process.env["STRIPE_SECRET_KEY"];
    const webhookSecret = process.env["STRIPE_WEBHOOK_SECRET"];

    if (!stripeKey) {
      res.status(503).json({ error: "Stripe not configured" });
      return;
    }

    const stripe = new Stripe(stripeKey);

    let event: Stripe.Event;

    if (webhookSecret) {
      const sig = req.headers["stripe-signature"] as string;
      if (!sig) {
        res.status(400).json({ error: "Missing stripe-signature header" });
        return;
      }
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
      if (!rawBody) {
        res.status(400).json({ error: "Raw body not available for signature verification" });
        return;
      }
      try {
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
      } catch (err) {
        res.status(400).json({ error: `Webhook signature verification failed: ${(err as Error).message}` });
        return;
      }
    } else {
      event = req.body as Stripe.Event;
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const paymentIdStr = session.metadata?.paymentId;
        const userIdStr = session.metadata?.userId;
        const plan = session.metadata?.plan;
        const professionalIdStr = session.metadata?.professionalId;

        if (!paymentIdStr || !userIdStr || !plan) break;

        const paymentId = parseInt(paymentIdStr, 10);
        const userId = parseInt(userIdStr, 10);
        const professionalId = professionalIdStr ? parseInt(professionalIdStr, 10) : null;

        const [existingPayment] = await db
          .select()
          .from(paymentsTable)
          .where(eq(paymentsTable.id, paymentId))
          .limit(1);

        if (existingPayment?.status === "completed") break;

        await db
          .update(paymentsTable)
          .set({
            status: "completed",
            providerPaymentId: typeof session.payment_intent === "string" ? session.payment_intent : session.id,
            updatedAt: new Date(),
          })
          .where(eq(paymentsTable.id, paymentId));

        const stripeSubId = typeof session.subscription === "string" ? session.subscription : null;
        await activatePayment(userId, plan, professionalId, "stripe", stripeSubId);
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = (invoice as { subscription?: string }).subscription;
        if (!subscriptionId) break;

        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const paymentIdStr = sub.metadata?.["paymentId"];
        const userIdStr = sub.metadata?.["userId"];

        if (!paymentIdStr || !userIdStr) break;

        const userId = parseInt(userIdStr, 10);
        const subAny = sub as unknown as { current_period_end?: number; current_period_start?: number };
        const expiresAt = new Date((subAny.current_period_end ?? 0) * 1000);

        const [existingSub] = await db
          .select()
          .from(subscriptionsTable)
          .where(and(eq(subscriptionsTable.userId, userId), eq(subscriptionsTable.providerSubscriptionId, subscriptionId)))
          .limit(1);

        if (existingSub) {
          await db
            .update(subscriptionsTable)
            .set({ expiresAt, status: "active" })
            .where(eq(subscriptionsTable.id, existingSub.id));
        } else {
          await db.insert(subscriptionsTable).values({
            userId,
            provider: "stripe",
            providerSubscriptionId: subscriptionId,
            plan: "plan_a",
            status: "active",
            startsAt: new Date((subAny.current_period_start ?? 0) * 1000),
            expiresAt,
          });
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await db
          .update(subscriptionsTable)
          .set({ status: "cancelled" })
          .where(eq(subscriptionsTable.providerSubscriptionId, sub.id));
        break;
      }

      default:
        break;
    }

    res.json({ status: "ok" });
  },
);

router.post(
  "/webhooks/razorpay",
  async (req: Request, res: Response): Promise<void> => {
    const webhookSecret = process.env["RAZORPAY_WEBHOOK_SECRET"];

    if (webhookSecret) {
      const sig = req.headers["x-razorpay-signature"] as string;
      if (!sig) {
        res.status(400).json({ error: "Missing x-razorpay-signature header" });
        return;
      }
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
      const bodyStr = rawBody ? rawBody.toString() : JSON.stringify(req.body);
      const expectedSig = crypto.createHmac("sha256", webhookSecret).update(bodyStr).digest("hex");
      if (expectedSig !== sig) {
        res.status(400).json({ error: "Invalid webhook signature" });
        return;
      }
    }

    const event = req.body as { event: string; payload: Record<string, unknown> };

    if (event.event === "payment.captured") {
      const paymentEntity = (event.payload as { payment?: { entity?: Record<string, unknown> } }).payment?.entity;
      if (!paymentEntity) {
        res.json({ status: "ok" });
        return;
      }

      const orderId = paymentEntity["order_id"] as string | undefined;
      const razorpayPaymentId = paymentEntity["id"] as string | undefined;

      if (!orderId || !razorpayPaymentId) {
        res.json({ status: "ok" });
        return;
      }

      const [payment] = await db
        .select()
        .from(paymentsTable)
        .where(and(eq(paymentsTable.providerOrderId, orderId), eq(paymentsTable.provider, "razorpay")))
        .limit(1);

      if (!payment || payment.status === "completed") {
        res.json({ status: "ok" });
        return;
      }

      await db
        .update(paymentsTable)
        .set({ status: "completed", providerPaymentId: razorpayPaymentId, updatedAt: new Date() })
        .where(eq(paymentsTable.id, payment.id));

      await activatePayment(payment.userId, payment.plan, payment.professionalId ?? null, "razorpay");
    }

    res.json({ status: "ok" });
  },
);

export default router;
