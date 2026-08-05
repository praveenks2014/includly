import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, platformDuesInvoicesTable, platformDuesChargesTable, disputesTable, therapyCentresTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { z } from "zod/v4";

const router: IRouter = Router();
const adminGuard = [requireAuth, requireRole("admin")] as const;

function parsedId(raw: string): number | null {
  const n = parseInt(raw, 10);
  return isNaN(n) ? null : n;
}

// ── B8 — admin dues review ───────────────────────────────────────────────

router.get("/admin/dues/invoices", ...adminGuard, async (req, res): Promise<void> => {
  const ownerType = typeof req.query["ownerType"] === "string" ? req.query["ownerType"] : undefined;
  const status = typeof req.query["status"] === "string" ? req.query["status"] : undefined;
  const conditions = [];
  if (ownerType) conditions.push(eq(platformDuesInvoicesTable.ownerType, ownerType));
  if (status) conditions.push(eq(platformDuesInvoicesTable.status, status as "pending" | "paid" | "overdue" | "waived"));
  const rows = await db.select().from(platformDuesInvoicesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(platformDuesInvoicesTable.createdAt));
  res.json(rows);
});

router.get("/admin/dues/invoices/:id", ...adminGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [invoice] = await db.select().from(platformDuesInvoicesTable).where(eq(platformDuesInvoicesTable.id, id));
  if (!invoice) { res.status(404).json({ error: "Not found" }); return; }
  const charges = await db.select().from(platformDuesChargesTable)
    .where(eq(platformDuesChargesTable.duesInvoiceId, id))
    .orderBy(desc(platformDuesChargesTable.createdAt));
  res.json({ ...invoice, charges });
});

router.patch("/admin/dues/invoices/:id/mark-paid", ...adminGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [invoice] = await db.select().from(platformDuesInvoicesTable).where(eq(platformDuesInvoicesTable.id, id));
  if (!invoice) { res.status(404).json({ error: "Not found" }); return; }
  if (invoice.status === "paid") { res.status(409).json({ error: "Already paid" }); return; }
  const [updated] = await db.update(platformDuesInvoicesTable)
    .set({ status: "paid", paidAt: new Date(), markedPaidByUserId: req.userId!, updatedAt: new Date() })
    .where(eq(platformDuesInvoicesTable.id, id))
    .returning();
  res.json(updated);
});

const WaiveBody = z.object({ waivedReason: z.string().min(1) });
router.patch("/admin/dues/invoices/:id/waive", ...adminGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = WaiveBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [invoice] = await db.select().from(platformDuesInvoicesTable).where(eq(platformDuesInvoicesTable.id, id));
  if (!invoice) { res.status(404).json({ error: "Not found" }); return; }
  if (invoice.status === "paid") { res.status(409).json({ error: "Already paid" }); return; }
  const [updated] = await db.update(platformDuesInvoicesTable)
    .set({ status: "waived", waivedReason: parsed.data.waivedReason, updatedAt: new Date() })
    .where(eq(platformDuesInvoicesTable.id, id))
    .returning();
  res.json(updated);
});

// ── Shared dispute mechanism ─────────────────────────────────────────────
// One table/queue for both B8 settlement disputes and the later OTP
// attendance disputes — see disputes.ts's schema comment. These routes
// only ever track/review a dispute; resolving one never itself moves money
// or flips a session's status — that happens through the endpoints above
// (or the attendance sub-build's own endpoints later), logged here via
// resolutionAction after the fact.

const FileDisputeBody = z.object({
  disputeType: z.enum(["settlement", "attendance"]),
  subjectType: z.enum(["dues_invoice", "dues_charge", "therapy_session"]),
  subjectId: z.number().int().positive(),
  involvedCentreId: z.number().int().positive().optional(),
  reason: z.string().min(1).max(2000),
});
router.post("/disputes", requireAuth, async (req, res): Promise<void> => {
  const parsed = FileDisputeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [dispute] = await db.insert(disputesTable).values({
    disputeType: parsed.data.disputeType,
    subjectType: parsed.data.subjectType,
    subjectId: parsed.data.subjectId,
    involvedCentreId: parsed.data.involvedCentreId ?? null,
    raisedByUserId: req.userId!,
    raisedByRole: req.userRole!,
    reason: parsed.data.reason,
  }).returning();
  res.status(201).json(dispute);
});

router.get("/admin/disputes", ...adminGuard, async (req, res): Promise<void> => {
  const disputeType = typeof req.query["disputeType"] === "string" ? req.query["disputeType"] : undefined;
  const status = typeof req.query["status"] === "string" ? req.query["status"] : undefined;
  const conditions = [];
  if (disputeType) conditions.push(eq(disputesTable.disputeType, disputeType));
  if (status) conditions.push(eq(disputesTable.status, status as "open" | "under_review" | "resolved_upheld" | "resolved_rejected" | "withdrawn"));
  const rows = await db.select().from(disputesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(disputesTable.createdAt));
  res.json(rows);
});

const ResolveDisputeBody = z.object({
  status: z.enum(["under_review", "resolved_upheld", "resolved_rejected", "withdrawn"]),
  adminNotes: z.string().max(2000).optional(),
  resolutionAction: z.string().max(500).optional(),
});
router.patch("/admin/disputes/:id/resolve", ...adminGuard, async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = ResolveDisputeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const isTerminal = parsed.data.status !== "under_review";
  const [updated] = await db.update(disputesTable)
    .set({
      status: parsed.data.status,
      adminNotes: parsed.data.adminNotes ?? null,
      resolutionAction: parsed.data.resolutionAction ?? null,
      resolvedByUserId: isTerminal ? req.userId! : null,
      resolvedAt: isTerminal ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(disputesTable.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

// ── POST /centres/:id/dues/invoices/:invoiceId/dispute — convenience
// wrapper for a centre admin disputing their own invoice. Ownership- and
// invoice-existence-checked here (rather than relying on the generic
// POST /disputes above) so a centre can never reference an invoice that
// isn't actually theirs.
const CentreDisputeBody = z.object({ reason: z.string().min(1).max(2000) });
router.post("/centres/:id/dues/invoices/:invoiceId/dispute", requireAuth, requireRole("centre_admin", "admin"), async (req, res): Promise<void> => {
  const id = parsedId(req.params.id);
  const invoiceId = parsedId(req.params.invoiceId);
  if (!id || !invoiceId) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = CentreDisputeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [centre] = await db.select({ id: therapyCentresTable.id }).from(therapyCentresTable)
    .where(and(eq(therapyCentresTable.id, id), eq(therapyCentresTable.ownerUserId, req.userId!)));
  if (!centre && req.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const [invoice] = await db.select().from(platformDuesInvoicesTable)
    .where(and(
      eq(platformDuesInvoicesTable.id, invoiceId),
      eq(platformDuesInvoicesTable.ownerType, "centre"),
      eq(platformDuesInvoicesTable.ownerId, id),
    ));
  if (!invoice) { res.status(404).json({ error: "Invoice not found for this centre" }); return; }

  const [dispute] = await db.insert(disputesTable).values({
    disputeType: "settlement",
    subjectType: "dues_invoice",
    subjectId: invoiceId,
    involvedCentreId: id,
    raisedByUserId: req.userId!,
    raisedByRole: req.userRole!,
    reason: parsed.data.reason,
  }).returning();
  res.status(201).json(dispute);
});

export default router;
