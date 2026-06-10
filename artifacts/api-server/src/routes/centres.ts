import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  therapyCentresTable,
  centreTherapistsTable,
  centreTherapistSlotsTable,
  centreServicesTable,
  centreServicePricesTable,
  centreServicePackagesTable,
  centreCancellationPoliciesTable,
  priceChangeRequestsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { z } from "zod/v4";

const router: IRouter = Router();

const centreAdminGuard = [requireAuth, requireRole("centre_admin", "admin")] as const;
const authGuard = [requireAuth] as const;

function parsedId(raw: string): number | null {
  const n = parseInt(raw, 10);
  return isNaN(n) ? null : n;
}

async function resolveCentreForOwner(userId: number): Promise<{ id: number } | null> {
  const [centre] = await db
    .select({ id: therapyCentresTable.id })
    .from(therapyCentresTable)
    .where(eq(therapyCentresTable.ownerUserId, userId));
  return centre ?? null;
}

async function ownscentre(userId: number, centreId: number): Promise<boolean> {
  const [c] = await db
    .select({ id: therapyCentresTable.id })
    .from(therapyCentresTable)
    .where(and(eq(therapyCentresTable.id, centreId), eq(therapyCentresTable.ownerUserId, userId)));
  return !!c;
}

const UpsertCentreBody = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  website: z.string().optional(),
  photos: z.string().optional(),
  languagesSpoken: z.string().optional(),
  therapyTypesOffered: z.string().optional(),
  operatingHoursJson: z.string().optional(),
  registrationNumbers: z.string().optional(),
  certificatesJson: z.string().optional(),
  yearsInOperation: z.number().int().optional(),
});

const UpsertTherapistBody = z.object({
  name: z.string().min(1),
  photoUrl: z.string().optional(),
  specializations: z.string().optional(),
  qualifications: z.string().optional(),
  yearsExperience: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

const UpsertSlotBody = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string(),
  endTime: z.string(),
  slotDurationMinutes: z.number().int().min(15).optional(),
  isActive: z.boolean().optional(),
});

const UpsertServiceBody = z.object({
  name: z.string().min(1),
  serviceType: z.string().min(1),
  durationMinutes: z.number().int().min(15).optional(),
  mode: z.enum(["in_centre", "home_visit", "online"]).optional(),
  description: z.string().optional(),
  assessmentRequired: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const UpsertCancellationPolicyBody = z.object({
  window1Hours: z.number().int().min(0),
  window1RefundPct: z.number().int().min(0).max(100),
  window2Hours: z.number().int().min(0),
  window2RefundPct: z.number().int().min(0).max(100),
  insideWindow2RefundPct: z.number().int().min(0).max(100),
  noShowRefundPct: z.number().int().min(0).max(100),
  centreNoShowRefundPct: z.number().int().min(0).max(100),
  offerCompensationSlot: z.boolean().optional(),
});

const PriceChangeRequestBody = z.object({
  serviceId: z.number().int().positive(),
  requestedPriceInr: z.number().int().positive(),
  justification: z.string().optional(),
});

// ── GET /centres/mine — centre_admin's own centre ────────────────────────────
router.get("/centres/mine", ...centreAdminGuard, async (req, res): Promise<void> => {
  const centre = await resolveCentreForOwner(req.userId!);
  if (!centre) { res.status(404).json({ error: "No centre found" }); return; }
  const [full] = await db.select().from(therapyCentresTable).where(eq(therapyCentresTable.id, centre.id));
  res.json(full);
});

// ── POST /centres — create new centre ───────────────────────────────────────
router.post("/centres", ...centreAdminGuard, async (req, res): Promise<void> => {
  const parsed = UpsertCentreBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const existing = await resolveCentreForOwner(req.userId!);
  if (existing) { res.status(409).json({ error: "Centre already exists for this account" }); return; }
  const [centre] = await db.insert(therapyCentresTable).values({ ownerUserId: req.userId!, ...parsed.data }).returning();
  res.status(201).json(centre);
});

// ── PATCH /centres/:id — update centre profile ───────────────────────────────
router.patch("/centres/:id", ...centreAdminGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!(await ownscentre(req.userId!, id)) && req.userRole !== "admin") {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const parsed = UpsertCentreBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [updated] = await db.update(therapyCentresTable).set({ ...parsed.data, updatedAt: new Date() }).where(eq(therapyCentresTable.id, id)).returning();
  res.json(updated);
});

// ── POST /centres/:id/submit — submit for verification ──────────────────────
router.post("/centres/:id/submit", ...centreAdminGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!(await ownscentre(req.userId!, id))) { res.status(403).json({ error: "Forbidden" }); return; }
  const [updated] = await db.update(therapyCentresTable).set({ status: "submitted", updatedAt: new Date() }).where(eq(therapyCentresTable.id, id)).returning();
  res.json(updated);
});

// ── THERAPISTS ───────────────────────────────────────────────────────────────

router.get("/centres/:id/therapists", ...authGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.select().from(centreTherapistsTable).where(eq(centreTherapistsTable.centreId, id)).orderBy(centreTherapistsTable.createdAt);
  res.json(rows);
});

router.post("/centres/:id/therapists", ...centreAdminGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!(await ownscentre(req.userId!, id)) && req.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const parsed = UpsertTherapistBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [therapist] = await db.insert(centreTherapistsTable).values({ centreId: id, ...parsed.data }).returning();
  res.status(201).json(therapist);
});

router.patch("/centres/:id/therapists/:tid", ...centreAdminGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  const tid = parsedId(req.params.tid);
  if (!id || !tid) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!(await ownscentre(req.userId!, id)) && req.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const parsed = UpsertTherapistBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [updated] = await db.update(centreTherapistsTable).set({ ...parsed.data, updatedAt: new Date() }).where(and(eq(centreTherapistsTable.id, tid), eq(centreTherapistsTable.centreId, id))).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

router.delete("/centres/:id/therapists/:tid", ...centreAdminGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  const tid = parsedId(req.params.tid);
  if (!id || !tid) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!(await ownscentre(req.userId!, id)) && req.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  await db.delete(centreTherapistsTable).where(and(eq(centreTherapistsTable.id, tid), eq(centreTherapistsTable.centreId, id)));
  res.json({ ok: true });
});

// ── THERAPIST SLOTS ──────────────────────────────────────────────────────────

router.get("/centres/:id/therapists/:tid/slots", ...authGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  const tid = parsedId(req.params.tid);
  if (!id || !tid) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.select().from(centreTherapistSlotsTable).where(and(eq(centreTherapistSlotsTable.therapistId, tid), eq(centreTherapistSlotsTable.centreId, id)));
  res.json(rows);
});

router.post("/centres/:id/therapists/:tid/slots", ...centreAdminGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  const tid = parsedId(req.params.tid);
  if (!id || !tid) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!(await ownscentre(req.userId!, id)) && req.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const parsed = UpsertSlotBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [slot] = await db.insert(centreTherapistSlotsTable).values({ therapistId: tid, centreId: id, ...parsed.data }).returning();
  res.status(201).json(slot);
});

router.delete("/centres/:id/therapists/:tid/slots/:sid", ...centreAdminGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  const tid = parsedId(req.params.tid);
  const sid = parsedId(req.params.sid);
  if (!id || !tid || !sid) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!(await ownscentre(req.userId!, id)) && req.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  await db.delete(centreTherapistSlotsTable).where(and(eq(centreTherapistSlotsTable.id, sid), eq(centreTherapistSlotsTable.centreId, id)));
  res.json({ ok: true });
});

// ── SERVICES ─────────────────────────────────────────────────────────────────

router.get("/centres/:id/services", ...authGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const services = await db.select().from(centreServicesTable).where(eq(centreServicesTable.centreId, id)).orderBy(centreServicesTable.createdAt);

  const today = new Date().toISOString().slice(0, 10);
  const serviceIds = services.map((s) => s.id);
  let prices: { serviceId: number; priceInr: number; effectiveFrom: string }[] = [];
  if (serviceIds.length > 0) {
    const allPrices = await db
      .select({ serviceId: centreServicePricesTable.serviceId, priceInr: centreServicePricesTable.priceInr, effectiveFrom: centreServicePricesTable.effectiveFrom })
      .from(centreServicePricesTable)
      .where(eq(centreServicePricesTable.centreId, id))
      .orderBy(desc(centreServicePricesTable.effectiveFrom));
    const latestByService = new Map<number, { serviceId: number; priceInr: number; effectiveFrom: string }>();
    for (const p of allPrices) {
      if (p.effectiveFrom <= today && !latestByService.has(p.serviceId)) {
        latestByService.set(p.serviceId, p);
      }
    }
    prices = Array.from(latestByService.values());
  }

  const priceMap = new Map(prices.map((p) => [p.serviceId, p.priceInr]));
  const isLoggedIn = !!req.userId;

  const result = services.map((s) => ({
    ...s,
    currentPriceInr: isLoggedIn ? (priceMap.get(s.id) ?? null) : null,
    priceSet: priceMap.has(s.id),
  }));
  res.json(result);
});

router.post("/centres/:id/services", ...centreAdminGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!(await ownscentre(req.userId!, id)) && req.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const parsed = UpsertServiceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [service] = await db.insert(centreServicesTable).values({ centreId: id, ...parsed.data }).returning();
  res.status(201).json(service);
});

router.patch("/centres/:id/services/:sid", ...centreAdminGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  const sid = parsedId(req.params.sid);
  if (!id || !sid) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!(await ownscentre(req.userId!, id)) && req.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const parsed = UpsertServiceBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [updated] = await db.update(centreServicesTable).set({ ...parsed.data, updatedAt: new Date() }).where(and(eq(centreServicesTable.id, sid), eq(centreServicesTable.centreId, id))).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

// ── PACKAGES ─────────────────────────────────────────────────────────────────

router.get("/centres/:id/packages", ...authGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.select().from(centreServicePackagesTable).where(eq(centreServicePackagesTable.centreId, id));
  res.json(rows);
});

router.post("/centres/:id/packages", ...centreAdminGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!(await ownscentre(req.userId!, id)) && req.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const parsed = z.object({ serviceId: z.number().int().positive(), sessionCount: z.number().int().min(2), priceInr: z.number().int().positive() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [pkg] = await db.insert(centreServicePackagesTable).values({ centreId: id, ...parsed.data }).returning();
  res.status(201).json(pkg);
});

router.patch("/centres/:id/packages/:pid", ...centreAdminGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  const pid = parsedId(req.params.pid);
  if (!id || !pid) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!(await ownscentre(req.userId!, id)) && req.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const parsed = z.object({ sessionCount: z.number().int().min(1).optional(), priceInr: z.number().int().positive().optional(), isActive: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [updated] = await db.update(centreServicePackagesTable).set({ ...parsed.data, updatedAt: new Date() }).where(and(eq(centreServicePackagesTable.id, pid), eq(centreServicePackagesTable.centreId, id))).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

// ── CANCELLATION POLICY ──────────────────────────────────────────────────────

router.get("/centres/:id/cancellation-policy", ...authGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [policy] = await db.select().from(centreCancellationPoliciesTable).where(eq(centreCancellationPoliciesTable.centreId, id));
  res.json(policy ?? null);
});

router.put("/centres/:id/cancellation-policy", ...centreAdminGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!(await ownscentre(req.userId!, id)) && req.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const parsed = UpsertCancellationPolicyBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [existing] = await db.select().from(centreCancellationPoliciesTable).where(eq(centreCancellationPoliciesTable.centreId, id));
  let result;
  if (existing) {
    [result] = await db.update(centreCancellationPoliciesTable).set({ ...parsed.data, updatedAt: new Date() }).where(eq(centreCancellationPoliciesTable.centreId, id)).returning();
  } else {
    [result] = await db.insert(centreCancellationPoliciesTable).values({ centreId: id, ...parsed.data }).returning();
  }
  res.json(result);
});

// ── PRICE CHANGE REQUESTS ─────────────────────────────────────────────────────

router.get("/centres/:id/price-change-requests", ...centreAdminGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!(await ownscentre(req.userId!, id)) && req.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const rows = await db.select().from(priceChangeRequestsTable).where(eq(priceChangeRequestsTable.centreId, id)).orderBy(desc(priceChangeRequestsTable.createdAt));
  res.json(rows);
});

router.post("/centres/:id/price-change-requests", ...centreAdminGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!(await ownscentre(req.userId!, id))) { res.status(403).json({ error: "Forbidden" }); return; }
  const parsed = PriceChangeRequestBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [req2] = await db.insert(priceChangeRequestsTable).values({ centreId: id, ...parsed.data }).returning();
  res.status(201).json(req2);
});

// ── ADMIN ROUTES ─────────────────────────────────────────────────────────────

const adminGuard = [requireAuth, requireRole("admin")] as const;

router.get("/admin/centres", ...adminGuard, async (req, res): Promise<void> => {
  const statusQ = req.query.status as string | undefined;
  let query = db
    .select({
      id: therapyCentresTable.id,
      name: therapyCentresTable.name,
      city: therapyCentresTable.city,
      state: therapyCentresTable.state,
      status: therapyCentresTable.status,
      phone: therapyCentresTable.phone,
      email: therapyCentresTable.email,
      website: therapyCentresTable.website,
      description: therapyCentresTable.description,
      therapyTypesOffered: therapyCentresTable.therapyTypesOffered,
      registrationNumbers: therapyCentresTable.registrationNumbers,
      yearsInOperation: therapyCentresTable.yearsInOperation,
      verificationNotes: therapyCentresTable.verificationNotes,
      rejectedReason: therapyCentresTable.rejectedReason,
      ownerUserId: therapyCentresTable.ownerUserId,
      ownerEmail: usersTable.email,
      ownerName: usersTable.fullName,
      commissionPctOverride: therapyCentresTable.commissionPctOverride,
      platformDefaultCommissionPct: therapyCentresTable.platformDefaultCommissionPct,
      createdAt: therapyCentresTable.createdAt,
      verifiedAt: therapyCentresTable.verifiedAt,
    })
    .from(therapyCentresTable)
    .leftJoin(usersTable, eq(usersTable.id, therapyCentresTable.ownerUserId))
    .$dynamic();
  if (statusQ) {
    query = query.where(eq(therapyCentresTable.status, statusQ as "draft" | "submitted" | "verified" | "live" | "rejected" | "suspended"));
  }
  const rows = await query.orderBy(desc(therapyCentresTable.createdAt));
  res.json(rows);
});

router.get("/admin/centres/:id/services", ...adminGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const services = await db.select().from(centreServicesTable).where(eq(centreServicesTable.centreId, id));
  const prices = await db.select().from(centreServicePricesTable).where(eq(centreServicePricesTable.centreId, id)).orderBy(desc(centreServicePricesTable.createdAt));
  const latestPriceByService: Record<number, number> = {};
  for (const p of prices) {
    if (latestPriceByService[p.serviceId] === undefined) latestPriceByService[p.serviceId] = p.priceInr;
  }
  const result = services.map(s => ({ ...s, currentPriceInr: latestPriceByService[s.id] ?? null }));
  res.json(result);
});

router.get("/admin/centres/:id", ...adminGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [centre] = await db.select().from(therapyCentresTable).where(eq(therapyCentresTable.id, id));
  if (!centre) { res.status(404).json({ error: "Not found" }); return; }
  const therapists = await db.select().from(centreTherapistsTable).where(eq(centreTherapistsTable.centreId, id));
  const services = await db.select().from(centreServicesTable).where(eq(centreServicesTable.centreId, id));
  const prices = await db.select().from(centreServicePricesTable).where(eq(centreServicePricesTable.centreId, id)).orderBy(desc(centreServicePricesTable.createdAt));
  const packages = await db.select().from(centreServicePackagesTable).where(eq(centreServicePackagesTable.centreId, id));
  const [policy] = await db.select().from(centreCancellationPoliciesTable).where(eq(centreCancellationPoliciesTable.centreId, id));
  res.json({ ...centre, therapists, services, prices, packages, cancellationPolicy: policy ?? null });
});

router.patch("/admin/centres/:id/verify", ...adminGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = z.object({
    action: z.enum(["approve", "verify", "reject", "suspend", "set_live"]),
    notes: z.string().optional(),
    reason: z.string().optional(),
    commissionPctOverride: z.number().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { action, notes, reason, commissionPctOverride } = parsed.data;
  const now = new Date();
  let update: Record<string, unknown> = { updatedAt: now };
  if (action === "approve" || action === "verify") {
    update = { ...update, status: "verified", verifiedAt: now, verifiedBy: req.userId, verificationNotes: notes ?? null };
  } else if (action === "set_live") {
    update = { ...update, status: "live", verifiedAt: update.verifiedAt ?? now, verifiedBy: req.userId };
  } else if (action === "reject") {
    update = { ...update, status: "rejected", rejectedAt: now, rejectedBy: req.userId, rejectedReason: reason ?? notes ?? null };
  } else if (action === "suspend") {
    update = { ...update, status: "suspended", verificationNotes: notes ?? null };
  }
  if (commissionPctOverride !== undefined) {
    update.commissionPctOverride = commissionPctOverride;
  }
  const [updated] = await db.update(therapyCentresTable).set(update).where(eq(therapyCentresTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

router.post("/admin/centres/:id/service-prices", ...adminGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = z.object({
    serviceId: z.number().int().positive(),
    priceInr: z.number().int().positive(),
    commissionPctOverride: z.number().optional(),
    effectiveFrom: z.string(),
    notes: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [price] = await db.insert(centreServicePricesTable).values({ centreId: id, setByAdminId: req.userId!, ...parsed.data }).returning();
  res.status(201).json(price);
});

router.get("/admin/price-change-requests", ...adminGuard, async (req, res): Promise<void> => {
  const statusFilter = req.query.status as string | undefined;
  const rows = await db
    .select({
      id: priceChangeRequestsTable.id,
      centreId: priceChangeRequestsTable.centreId,
      serviceId: priceChangeRequestsTable.serviceId,
      requestedPriceInr: priceChangeRequestsTable.requestedPriceInr,
      justification: priceChangeRequestsTable.justification,
      status: priceChangeRequestsTable.status,
      decidedAt: priceChangeRequestsTable.decidedAt,
      createdAt: priceChangeRequestsTable.createdAt,
      centreName: therapyCentresTable.name,
      serviceName: centreServicesTable.name,
    })
    .from(priceChangeRequestsTable)
    .leftJoin(therapyCentresTable, eq(therapyCentresTable.id, priceChangeRequestsTable.centreId))
    .leftJoin(centreServicesTable, eq(centreServicesTable.id, priceChangeRequestsTable.serviceId))
    .where(statusFilter ? eq(priceChangeRequestsTable.status, statusFilter as "pending" | "approved" | "rejected") : undefined)
    .orderBy(desc(priceChangeRequestsTable.createdAt));
  res.json(rows);
});

router.patch("/admin/price-change-requests/:id", ...adminGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = z.object({
    action: z.enum(["approve", "reject"]),
    decisionNote: z.string().optional(),
    priceInr: z.number().int().positive().optional(),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { action, decisionNote, priceInr, effectiveFrom } = parsed.data;
  const [pcr] = await db.select().from(priceChangeRequestsTable).where(eq(priceChangeRequestsTable.id, id));
  if (!pcr) { res.status(404).json({ error: "Not found" }); return; }
  const [updated] = await db.update(priceChangeRequestsTable).set({
    status: action === "approve" ? "approved" : "rejected",
    decidedBy: req.userId,
    decidedAt: new Date(),
    decisionNote: decisionNote ?? null,
  }).where(eq(priceChangeRequestsTable.id, id)).returning();

  if (action === "approve" && priceInr && effectiveFrom) {
    await db.insert(centreServicePricesTable).values({
      centreId: pcr.centreId,
      serviceId: pcr.serviceId,
      priceInr,
      effectiveFrom,
      setByAdminId: req.userId!,
      notes: `Approved price change request #${id}`,
    });
  }
  res.json(updated);
});

router.get("/admin/centres/:id/price-history", ...adminGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db
    .select({
      id: centreServicePricesTable.id,
      serviceId: centreServicePricesTable.serviceId,
      serviceName: centreServicesTable.name,
      priceInr: centreServicePricesTable.priceInr,
      commissionPctOverride: centreServicePricesTable.commissionPctOverride,
      effectiveFrom: centreServicePricesTable.effectiveFrom,
      setByAdminId: centreServicePricesTable.setByAdminId,
      notes: centreServicePricesTable.notes,
      createdAt: centreServicePricesTable.createdAt,
    })
    .from(centreServicePricesTable)
    .leftJoin(centreServicesTable, eq(centreServicesTable.id, centreServicePricesTable.serviceId))
    .where(eq(centreServicePricesTable.centreId, id))
    .orderBy(desc(centreServicePricesTable.createdAt));
  res.json(rows);
});

export default router;
