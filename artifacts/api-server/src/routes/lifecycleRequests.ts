import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import crypto from "crypto";
import Razorpay from "razorpay";
import {
  db,
  shadowTeacherEngagementsTable,
  engagementLifecycleRequestsTable,
  adminSettingsTable,
  professionalProfilesTable,
  usersTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { sendPushNotification, createInAppNotification } from "../lib/notificationService";
import { z } from "zod";

const router: IRouter = Router();

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function getSettings() {
  const [s] = await db.select().from(adminSettingsTable).limit(1);
  return s ?? { noticePeriodDays: 30, parentBuyoutDays: 15, salaryPlatformCutPct: 5 };
}

function getRazorpay() {
  const keyId = process.env["RAZORPAY_KEY_ID"];
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keyId || !keySecret) return null;
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

async function getEngagementWithAccess(engagementId: number, userId: number, userRole: string) {
  const [eng] = await db
    .select()
    .from(shadowTeacherEngagementsTable)
    .where(eq(shadowTeacherEngagementsTable.id, engagementId))
    .limit(1);
  if (!eng) return { eng: null, role: null };
  if (userRole === "admin") return { eng, role: "admin" as const };
  if (eng.parentId === userId) return { eng, role: "parent" as const };
  const [prof] = await db
    .select({ id: professionalProfilesTable.id })
    .from(professionalProfilesTable)
    .where(and(eq(professionalProfilesTable.userId, userId), eq(professionalProfilesTable.id, eng.professionalId)))
    .limit(1);
  if (prof) return { eng, role: "teacher" as const };
  return { eng: null, role: null };
}

const RaiseLifecycleBody = z.object({
  type: z.enum(["stop", "change", "pause", "resume"]),
  method: z.enum(["notice", "buyout"]).optional(),
  reason: z.string().max(1000).optional(),
});

router.post("/engagements/:id/lifecycle", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = RaiseLifecycleBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { eng, role } = await getEngagementWithAccess(id, req.userId!, req.userRole!);
  if (!eng || !role) { res.status(404).json({ error: "Engagement not found or access denied" }); return; }

  const { type, method, reason } = parsed.data;

  // Handle pause — mutual consent; either parent or teacher may raise
  if (type === "pause") {
    if (eng.status !== "active") {
      res.status(409).json({ error: "Engagement must be active to request a pause" }); return;
    }
    const [req_] = await db
      .insert(engagementLifecycleRequestsTable)
      .values({
        engagementId: id,
        type: "pause",
        raisedByUserId: req.userId!,
        raisedByRole: role === "teacher" ? "teacher" : "parent",
        status: "pending",
        reason: reason ?? null,
      })
      .returning();

    // Notify the other party about the pause request
    try {
      if (role === "teacher") {
        await createInAppNotification(eng.parentId, {
          type: "pause_requested",
          title: "Your teacher requested a pause",
          body: "Your shadow teacher has requested a pause on the engagement. Log in to approve or decline.",
          relatedType: "engagement", relatedId: id,
        });
      } else {
        const [profRow] = await db.select({ userId: professionalProfilesTable.userId })
          .from(professionalProfilesTable).where(eq(professionalProfilesTable.id, eng.professionalId)).limit(1);
        if (profRow) await createInAppNotification(profRow.userId, {
          type: "pause_requested",
          title: "Parent requested a pause",
          body: "The parent has requested a pause on the engagement. Log in to approve or decline.",
          relatedType: "engagement", relatedId: id,
        });
      }
    } catch { /* non-blocking */ }

    res.status(201).json(req_);
    return;
  }

  // Handle resume — mutual consent; either parent or teacher may raise
  if (type === "resume") {
    if (eng.status !== "paused") {
      res.status(409).json({ error: "Engagement must be paused to request a resume" }); return;
    }
    const [req_] = await db
      .insert(engagementLifecycleRequestsTable)
      .values({
        engagementId: id,
        type: "resume",
        raisedByUserId: req.userId!,
        raisedByRole: role === "teacher" ? "teacher" : "parent",
        status: "pending",
        reason: reason ?? null,
      })
      .returning();

    // Notify the other party about the resume request
    try {
      if (role === "teacher") {
        await createInAppNotification(eng.parentId, {
          type: "resume_requested",
          title: "Your teacher requested to resume",
          body: "Your shadow teacher has requested to resume the paused engagement. Log in to approve or decline.",
          relatedType: "engagement", relatedId: id,
        });
      } else {
        const [profRow] = await db.select({ userId: professionalProfilesTable.userId })
          .from(professionalProfilesTable).where(eq(professionalProfilesTable.id, eng.professionalId)).limit(1);
        if (profRow) await createInAppNotification(profRow.userId, {
          type: "resume_requested",
          title: "Parent requested to resume",
          body: "The parent has requested to resume the paused engagement. Log in to approve or decline.",
          relatedType: "engagement", relatedId: id,
        });
      }
    } catch { /* non-blocking */ }

    res.status(201).json(req_);
    return;
  }

  if (!["active", "notice_period"].includes(eng.status)) {
    res.status(409).json({ error: "Engagement is not active" });
    return;
  }

  const settings = await getSettings();

  // Teachers can only raise "stop" requests
  if (role === "teacher" && type !== "stop") {
    res.status(403).json({ error: "Shadow teachers can only raise stop requests" });
    return;
  }

  // Teachers always serve notice; parents choose
  const resolvedMethod = role === "teacher" ? "notice" : (method ?? "notice");

  const today = new Date().toISOString().slice(0, 10);
  let effectiveEndDate: string;
  if (resolvedMethod === "buyout") {
    effectiveEndDate = addDays(today, settings.parentBuyoutDays);
  } else {
    effectiveEndDate = addDays(today, settings.noticePeriodDays);
  }

  const [req_] = await db
    .insert(engagementLifecycleRequestsTable)
    .values({
      engagementId: id,
      type,
      method: resolvedMethod,
      raisedByUserId: req.userId!,
      raisedByRole: role === "teacher" ? "teacher" : "parent",
      status: "pending",
      reason: reason ?? null,
      effectiveEndDate,
    })
    .returning();

  if (resolvedMethod === "notice") {
    await db
      .update(shadowTeacherEngagementsTable)
      .set({ status: "notice_period", endDate: effectiveEndDate, updatedAt: new Date() })
      .where(eq(shadowTeacherEngagementsTable.id, id));
  }

  // Notify the OTHER party about this lifecycle request
  try {
    if (resolvedMethod === "notice") {
      const isParentRaising = role === "parent";
      if (isParentRaising) {
        // Notify teacher
        const [profRow] = await db.select({ userId: professionalProfilesTable.userId })
          .from(professionalProfilesTable).where(eq(professionalProfilesTable.id, eng.professionalId)).limit(1);
        if (profRow) await createInAppNotification(profRow.userId, {
          type: "notice_raised",
          title: "Notice period started",
          body: `The parent has given notice. The engagement will end on ${effectiveEndDate}.`,
          relatedType: "engagement", relatedId: id,
        });
      } else {
        // Notify parent
        await createInAppNotification(eng.parentId, {
          type: "notice_raised",
          title: "Your teacher gave notice",
          body: `Your shadow teacher has given notice. The engagement will end on ${effectiveEndDate}.`,
          relatedType: "engagement", relatedId: id,
        });
      }
    } else if (resolvedMethod === "buyout") {
      // Notify teacher that a buyout was initiated (payment pending)
      const [profRow] = await db.select({ userId: professionalProfilesTable.userId })
        .from(professionalProfilesTable).where(eq(professionalProfilesTable.id, eng.professionalId)).limit(1);
      if (profRow) await createInAppNotification(profRow.userId, {
        type: "buyout_initiated",
        title: "Parent initiated early exit",
        body: `The parent has initiated an early exit buyout (ending ${effectiveEndDate}). Payment is pending.`,
        relatedType: "engagement", relatedId: id,
      });
    }
  } catch { /* non-blocking */ }

  if (resolvedMethod === "buyout" && role === "parent") {
    const razorpay = getRazorpay();
    if (!razorpay) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

    const buyoutFeeInr = Math.round(settings.parentBuyoutDays * eng.monthlyFeeInr / 30);
    const order = await razorpay.orders.create({
      amount: buyoutFeeInr * 100,
      currency: "INR",
      receipt: `buyout_${req_!.id}_${Date.now()}`,
    });
    const buyoutOrderId = order.id as string;

    await db
      .update(engagementLifecycleRequestsTable)
      .set({ buyoutOrderId, buyoutFeeInr })
      .where(eq(engagementLifecycleRequestsTable.id, req_!.id));

    res.status(201).json({
      ...req_,
      buyoutOrderId,
      buyoutFeeInr,
      keyId: process.env["RAZORPAY_KEY_ID"],
    });
    return;
  }

  res.status(201).json(req_);
});

router.get("/engagements/:id/lifecycle", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { eng, role } = await getEngagementWithAccess(id, req.userId!, req.userRole!);
  if (!eng || !role) { res.status(404).json({ error: "Engagement not found or access denied" }); return; }

  const rows = await db
    .select({
      id: engagementLifecycleRequestsTable.id,
      engagementId: engagementLifecycleRequestsTable.engagementId,
      type: engagementLifecycleRequestsTable.type,
      method: engagementLifecycleRequestsTable.method,
      raisedByUserId: engagementLifecycleRequestsTable.raisedByUserId,
      raisedByRole: engagementLifecycleRequestsTable.raisedByRole,
      status: engagementLifecycleRequestsTable.status,
      reason: engagementLifecycleRequestsTable.reason,
      effectiveEndDate: engagementLifecycleRequestsTable.effectiveEndDate,
      adminNotes: engagementLifecycleRequestsTable.adminNotes,
      buyoutOrderId: engagementLifecycleRequestsTable.buyoutOrderId,
      buyoutPaymentId: engagementLifecycleRequestsTable.buyoutPaymentId,
      buyoutFeeInr: engagementLifecycleRequestsTable.buyoutFeeInr,
      raisedAt: engagementLifecycleRequestsTable.raisedAt,
      resolvedAt: engagementLifecycleRequestsTable.resolvedAt,
      raisedByName: usersTable.fullName,
    })
    .from(engagementLifecycleRequestsTable)
    .leftJoin(usersTable, eq(engagementLifecycleRequestsTable.raisedByUserId, usersTable.id))
    .where(eq(engagementLifecycleRequestsTable.engagementId, id))
    .orderBy(desc(engagementLifecycleRequestsTable.createdAt));

  res.json(rows);
});

// PATCH /engagements/:id/lifecycle/:reqId/consent — peer (non-requester) accepts or rejects a pause/resume
router.patch("/engagements/:id/lifecycle/:reqId/consent", requireAuth, async (req, res): Promise<void> => {
  const engId = parseInt(req.params["id"] as string, 10);
  const reqId = parseInt(req.params["reqId"] as string, 10);
  if (isNaN(engId) || isNaN(reqId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { status } = req.body ?? {};
  if (!["approved", "rejected"].includes(status as string)) {
    res.status(400).json({ error: "status must be approved or rejected" }); return;
  }

  const { eng, role } = await getEngagementWithAccess(engId, req.userId!, req.userRole!);
  if (!eng || !role) { res.status(404).json({ error: "Engagement not found or access denied" }); return; }
  if (role === "admin") { res.status(403).json({ error: "Admins use the admin lifecycle endpoint" }); return; }

  const [existing] = await db
    .select()
    .from(engagementLifecycleRequestsTable)
    .where(and(
      eq(engagementLifecycleRequestsTable.id, reqId),
      eq(engagementLifecycleRequestsTable.engagementId, engId),
    ))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "Request not found" }); return; }
  if (existing.status !== "pending") { res.status(409).json({ error: "Request is no longer pending" }); return; }
  if (!["pause", "resume"].includes(existing.type)) {
    res.status(400).json({ error: "Only pause/resume requests support peer consent" }); return;
  }
  if (existing.raisedByUserId === req.userId!) {
    res.status(403).json({ error: "You cannot consent to your own request" }); return;
  }

  const now = new Date();
  const [updated] = await db
    .update(engagementLifecycleRequestsTable)
    .set({ status: status as "approved" | "rejected", peerResponseByUserId: req.userId!, peerRespondedAt: now, resolvedAt: now, updatedAt: now })
    .where(eq(engagementLifecycleRequestsTable.id, reqId))
    .returning();

  if (status === "approved") {
    const newEngStatus = existing.type === "pause" ? "paused" : "active";
    await db
      .update(shadowTeacherEngagementsTable)
      .set({ status: newEngStatus, updatedAt: now })
      .where(eq(shadowTeacherEngagementsTable.id, engId));
  }

  // Notify the original requester about the decision
  try {
    const verb = status === "approved" ? "accepted" : "rejected";
    const action = existing.type === "pause" ? "pause request" : "resume request";
    await createInAppNotification(existing.raisedByUserId!, {
      type: `${existing.type}_${verb}` as string,
      title: `Your ${action} was ${verb}`,
      body: status === "approved"
        ? `Your ${action} has been accepted.`
        : `Your ${action} was declined — the engagement continues as before.`,
      relatedType: "engagement",
      relatedId: engId,
    });
  } catch { /* non-blocking */ }

  res.json(updated);
});

// DELETE /engagements/:id/lifecycle/:reqId — requester withdraws their own pending pause/resume request
router.delete("/engagements/:id/lifecycle/:reqId", requireAuth, async (req, res): Promise<void> => {
  const engId = parseInt(req.params["id"] as string, 10);
  const reqId = parseInt(req.params["reqId"] as string, 10);
  if (isNaN(engId) || isNaN(reqId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db
    .select()
    .from(engagementLifecycleRequestsTable)
    .where(and(
      eq(engagementLifecycleRequestsTable.id, reqId),
      eq(engagementLifecycleRequestsTable.engagementId, engId),
    ))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "Request not found" }); return; }
  if (!["pause", "resume"].includes(existing.type)) {
    res.status(400).json({ error: "Only pause/resume requests can be withdrawn" }); return;
  }
  if (existing.raisedByUserId !== req.userId!) {
    res.status(403).json({ error: "Only the requester can withdraw this request" }); return;
  }
  if (existing.status !== "pending") {
    res.status(409).json({ error: "Request is no longer pending" }); return;
  }

  await db
    .delete(engagementLifecycleRequestsTable)
    .where(eq(engagementLifecycleRequestsTable.id, reqId));

  res.status(204).end();
});

router.post("/engagements/:id/lifecycle/:reqId/verify-buyout-payment", requireAuth, async (req, res): Promise<void> => {
  const engId = parseInt(req.params["id"] as string, 10);
  const reqId = parseInt(req.params["reqId"] as string, 10);
  if (isNaN(engId) || isNaN(reqId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body ?? {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    res.status(400).json({ error: "Missing payment fields" }); return;
  }

  const { eng, role } = await getEngagementWithAccess(engId, req.userId!, req.userRole!);
  if (!eng || role !== "parent") { res.status(403).json({ error: "Access denied" }); return; }

  const [existing] = await db
    .select()
    .from(engagementLifecycleRequestsTable)
    .where(and(
      eq(engagementLifecycleRequestsTable.id, reqId),
      eq(engagementLifecycleRequestsTable.engagementId, engId),
    ))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "Request not found" }); return; }
  if (existing.method !== "buyout") { res.status(400).json({ error: "Not a buyout request" }); return; }
  if (existing.buyoutOrderId !== razorpay_order_id) { res.status(400).json({ error: "Order ID mismatch" }); return; }

  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keySecret) { res.status(503).json({ error: "Payment gateway not configured" }); return; }

  const expectedSig = crypto
    .createHmac("sha256", keySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");
  if (expectedSig !== razorpay_signature) {
    res.status(400).json({ error: "Payment signature verification failed" }); return;
  }

  // Auto-complete the lifecycle request — no admin gate needed for standard buyout
  const [updated] = await db
    .update(engagementLifecycleRequestsTable)
    .set({
      buyoutPaymentId: razorpay_payment_id,
      status: "completed",
      resolvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(engagementLifecycleRequestsTable.id, reqId))
    .returning();

  // Move engagement to notice_period — scheduler transitions to ended on effectiveEndDate
  await db
    .update(shadowTeacherEngagementsTable)
    .set({ status: "notice_period", endDate: existing.effectiveEndDate, endedReason: "buyout", updatedAt: new Date() })
    .where(eq(shadowTeacherEngagementsTable.id, engId));

  // Notify teacher that payment cleared and engagement is winding down
  try {
    const [engRow] = await db.select({ professionalId: shadowTeacherEngagementsTable.professionalId })
      .from(shadowTeacherEngagementsTable).where(eq(shadowTeacherEngagementsTable.id, engId)).limit(1);
    if (engRow) {
      const [prof] = await db.select({ userId: professionalProfilesTable.userId })
        .from(professionalProfilesTable).where(eq(professionalProfilesTable.id, engRow.professionalId)).limit(1);
      if (prof) await createInAppNotification(prof.userId, {
        type: "buyout_paid",
        title: "Buyout payment confirmed",
        body: `The parent's early-exit fee has been paid. Your engagement ends on ${existing.effectiveEndDate ?? "the scheduled date"}.`,
        relatedType: "engagement", relatedId: engId,
      });
    }
  } catch { /* non-blocking */ }

  res.json(updated);
});

router.patch("/admin/lifecycle/:reqId", requireAuth, requireRole("admin"), async (req, res): Promise<void> => {
  const reqId = parseInt(req.params["reqId"] as string, 10);
  if (isNaN(reqId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { status, adminNotes } = req.body ?? {};
  if (!["approved", "rejected", "completed"].includes(status)) {
    res.status(400).json({ error: "status must be approved | rejected | completed" });
    return;
  }

  const [existing] = await db
    .select()
    .from(engagementLifecycleRequestsTable)
    .where(eq(engagementLifecycleRequestsTable.id, reqId))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "Request not found" }); return; }

  if (existing.method === "buyout" && status === "approved" && !existing.buyoutPaymentId) {
    res.status(409).json({ error: "Buyout payment not yet confirmed" });
    return;
  }

  const [updated] = await db
    .update(engagementLifecycleRequestsTable)
    .set({ status, adminNotes: adminNotes ?? null, resolvedAt: new Date(), updatedAt: new Date() })
    .where(eq(engagementLifecycleRequestsTable.id, reqId))
    .returning();

  if (status === "approved" && existing.method === "buyout") {
    await db
      .update(shadowTeacherEngagementsTable)
      .set({ status: "ended", endDate: existing.effectiveEndDate, endedReason: "buyout", updatedAt: new Date() })
      .where(eq(shadowTeacherEngagementsTable.id, existing.engagementId));

    try {
      const [engRow] = await db
        .select({ professionalId: shadowTeacherEngagementsTable.professionalId })
        .from(shadowTeacherEngagementsTable)
        .where(eq(shadowTeacherEngagementsTable.id, existing.engagementId))
        .limit(1);
      if (engRow) {
        const [prof] = await db
          .select({ userId: professionalProfilesTable.userId })
          .from(professionalProfilesTable)
          .where(eq(professionalProfilesTable.id, engRow.professionalId))
          .limit(1);
        if (prof) {
          const dateStr = existing.effectiveEndDate ?? new Date().toISOString().slice(0, 10);
          void sendPushNotification(prof.userId, {
            title: "Engagement ended — early exit",
            body: `Your engagement has been ended via early exit, effective ${dateStr}. Log in for details.`,
            url: "/dashboard",
          });
        }
      }
    } catch { /* push failure is non-blocking */ }
  }

  if (status === "completed") {
    await db
      .update(shadowTeacherEngagementsTable)
      .set({ status: "ended", endDate: existing.effectiveEndDate ?? new Date().toISOString().slice(0, 10), updatedAt: new Date() })
      .where(eq(shadowTeacherEngagementsTable.id, existing.engagementId));
  }

  res.json(updated);
});

router.get("/admin/lifecycle", requireAuth, requireRole("admin"), async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: engagementLifecycleRequestsTable.id,
      engagementId: engagementLifecycleRequestsTable.engagementId,
      type: engagementLifecycleRequestsTable.type,
      method: engagementLifecycleRequestsTable.method,
      raisedByRole: engagementLifecycleRequestsTable.raisedByRole,
      status: engagementLifecycleRequestsTable.status,
      reason: engagementLifecycleRequestsTable.reason,
      effectiveEndDate: engagementLifecycleRequestsTable.effectiveEndDate,
      adminNotes: engagementLifecycleRequestsTable.adminNotes,
      buyoutOrderId: engagementLifecycleRequestsTable.buyoutOrderId,
      buyoutPaymentId: engagementLifecycleRequestsTable.buyoutPaymentId,
      buyoutFeeInr: engagementLifecycleRequestsTable.buyoutFeeInr,
      raisedAt: engagementLifecycleRequestsTable.raisedAt,
      resolvedAt: engagementLifecycleRequestsTable.resolvedAt,
      raisedByName: usersTable.fullName,
    })
    .from(engagementLifecycleRequestsTable)
    .leftJoin(usersTable, eq(engagementLifecycleRequestsTable.raisedByUserId, usersTable.id))
    .orderBy(desc(engagementLifecycleRequestsTable.raisedAt));

  res.json(rows);
});

export default router;
