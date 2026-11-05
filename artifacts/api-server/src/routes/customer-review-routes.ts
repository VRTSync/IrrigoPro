import type { Express, Request, RequestHandler } from "express";
import { z } from "zod/v4";
import { and, eq, inArray, sql, count, isNull, or } from "drizzle-orm";
import { customers, customerSyncReview } from "@workspace/db/schema";
import { db } from "../db";
import { storage } from "../storage";
import { buildQbCustomerInsert, mapQbCustomer, rankQbCandidates } from "../lib/qb-customer-sync";
import { recordAuditEvent } from "./audit-log";

export type QbReadIntegration = { realmId: string; accessToken: string };
export type QbReadError = { ok: false; status: number; message: string; needsReconnection?: boolean };
export type CustomerReviewDeps = {
  requireAuthentication: RequestHandler;
  requireQuickBooksAccess: RequestHandler;
  integrationFor(companyId: number): Promise<QbReadIntegration | null | undefined>;
  fetchAllQbCustomers(integration: QbReadIntegration, apiBase: string):
    Promise<{ ok: true; customers: Record<string, unknown>[] } | QbReadError>;
  fetchQbCustomerById(integration: QbReadIntegration, apiBase: string, qbId: string):
    Promise<{ ok: true; customer: Record<string, unknown> } | QbReadError>;
  fetchQbTermNames(integration: QbReadIntegration, apiBase: string): Promise<Map<string, string> | null>;
};
class ReviewError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const positiveId = z.number().int().positive();
const linkBody = z.object({ customerId: positiveId, qbCustomerId: z.string().trim().min(1) }).strict();
const exclusionBody = z.object({ customerId: positiveId, value: z.boolean() }).strict();
const emptyBody = z.object({}).strict();
const apiBase = () => process.env.NODE_ENV === "production"
  ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const customerScope = (cid: number, id: number) => and(eq(customers.companyId, cid), eq(customers.id, id));
const reviewScope = (cid: number, id: number) => and(eq(customerSyncReview.companyId, cid), eq(customerSyncReview.id, id));
async function qbLock(tx: Tx, cid: number, qbId: string) {
  // Serialize resolutions for one tenant/QB identity across server processes.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${cid}, hashtext(${qbId}))`);
}
async function claimed(tx: Tx, cid: number, qbId: string) {
  const [row] = await tx.select().from(customers).where(and(eq(customers.companyId, cid), eq(customers.quickbooksId, qbId)));
  return row;
}
async function audit(req: Request, tx: Tx, action: string, targetType: string, id: number, details?: Record<string, unknown>) {
  await recordAuditEvent(req, { actorCompanyId: req.authenticatedUserCompanyId,
    actorUserId: req.authenticatedUserId, actorRole: req.authenticatedUserRole,
    action, targetType, targetId: String(id), details }, { tx, strict: true });
}

export function registerCustomerReviewRoutes(app: Express, deps: CustomerReviewDeps): void {
  const register = (method: "get" | "post", path: string, handler: (req: Request, cid: number) => Promise<unknown>) => {
    app[method](path, deps.requireAuthentication, deps.requireQuickBooksAccess, async (req, res) => {
      const cid = req.authenticatedUserCompanyId;
      if (cid == null) { res.status(400).json({ message: "Company context is required." }); return; }
      try { res.json(await handler(req, cid)); }
      catch (err) {
        if (err instanceof z.ZodError) { res.status(400).json({ message: "Invalid request." }); return; }
        if (err instanceof ReviewError) { res.status(err.status).json({ message: err.message }); return; }
        const code = (err as { code?: string; cause?: { code?: string } })?.cause?.code ?? (err as { code?: string })?.code;
        if (code === "23505") { res.status(409).json({ message: "This QuickBooks customer was linked by another request. Refresh and try again." }); return; }
        req.log?.error({ err }, "Customer review request failed");
        res.status(500).json({ message: "Failed to process customer review." });
      }
    });
  };
  const integration = async (cid: number) => {
    const value = await deps.integrationFor(cid);
    if (!value?.accessToken) throw new ReviewError(400, "QuickBooks not connected. Please connect to QuickBooks first.");
    return value;
  };
  const scopedReview = async (cid: number, id: number) => {
    const row = await storage.getCustomerSyncReviewById(cid, id);
    if (!row) throw new ReviewError(404, "Review not found.");
    return row;
  };
  const resolve = async (req: Request, tx: Tx, cid: number, id: number, status: "created" | "dismissed") => {
    const [row] = await tx.update(customerSyncReview).set({ status,
      resolvedAt: new Date(), resolvedByUserId: req.authenticatedUserId }).where(and(
      reviewScope(cid, id), eq(customerSyncReview.status, "open"))).returning();
    if (!row) throw new ReviewError(409, "This review is no longer open.");
    return row;
  };

  register("get", "/api/customer-review/summary", async (_req, cid) => {
    const [[held], [unlinked]] = await Promise.all([
      db.select({ count: count() }).from(customerSyncReview).where(and(
        eq(customerSyncReview.companyId, cid), eq(customerSyncReview.status, "open"))),
      db.select({ count: count() }).from(customers).where(and(eq(customers.companyId, cid),
        or(isNull(customers.quickbooksId), eq(customers.quickbooksId, "")), isNull(customers.qbNotInQuickbooksAt))),
    ]);
    return { held: held.count, unlinked: unlinked.count };
  });
  register("get", "/api/customer-review", async (_req, cid) => {
    const [rows, unlinked] = await Promise.all([storage.listCustomerSyncReview(cid), storage.getUnlinkedCustomers(cid)]);
    const ids = rows.flatMap(row => row.candidateCustomerId == null ? [] : [row.candidateCustomerId]);
    const candidates = ids.length ? await db.select({ id: customers.id, name: customers.name,
      irrigoName: customers.irrigoName, address: customers.address }).from(customers).where(and(
      eq(customers.companyId, cid), inArray(customers.id, ids))) : [];
    const held = rows.map(row => ({ ...row, candidateCustomer: candidates.find(c => c.id === row.candidateCustomerId) ?? null }));
    // A local DB error is not a QuickBooks outage; let the normal error handler report it.
    const linked = await db.select({ qbId: customers.quickbooksId }).from(customers).where(eq(customers.companyId, cid));
    const claimedIds = new Set(linked.map(c => c.qbId).filter(Boolean));
    let qbError: string | undefined;
    let mapped: ReturnType<typeof mapQbCustomer>[] = [];
    try {
      const fetched = await deps.fetchAllQbCustomers(await integration(cid), apiBase());
      if (!fetched.ok) throw new Error(fetched.message);
      mapped = fetched.customers.filter(row => row.Active !== false)
        .map(row => mapQbCustomer(row, null)).filter(c => c.qbId && !claimedIds.has(c.qbId));
    } catch (err) { qbError = err instanceof Error ? err.message : String(err); }
    return { held, unlinked: unlinked.map(customer => ({ customer, candidates: rankQbCandidates(customer, mapped) })),
      ...(qbError === undefined ? {} : { qbError }) };
  });
  register("post", "/api/customer-review/link", async (req, cid) => {
    const { customerId, qbCustomerId } = linkBody.parse(req.body);
    return db.transaction(async tx => {
      await qbLock(tx, cid, qbCustomerId);
      const [customer] = await tx.select().from(customers).where(customerScope(cid, customerId)).for("update");
      if (!customer) throw new ReviewError(404, "Customer not found.");
      if (customer.quickbooksId) throw new ReviewError(409, "This customer is already linked to QuickBooks.");
      if (customer.qbNotInQuickbooksAt) throw new ReviewError(409, "Clear Not in QuickBooks before linking this customer.");
      const owner = await claimed(tx, cid, qbCustomerId);
      if (owner) throw new ReviewError(409, `This QuickBooks customer is already linked to ${owner.name}.`);
      const [updated] = await tx.update(customers).set({ quickbooksId: qbCustomerId }).where(and(
        customerScope(cid, customerId), sql`(${customers.quickbooksId} IS NULL OR ${customers.quickbooksId} = '')`)).returning();
      if (!updated) throw new ReviewError(409, "This customer is already linked to QuickBooks.");
      await tx.update(customerSyncReview).set({ status: "linked", resolvedAt: new Date(),
        resolvedByUserId: req.authenticatedUserId }).where(and(eq(customerSyncReview.companyId, cid),
        eq(customerSyncReview.qbCustomerId, qbCustomerId), eq(customerSyncReview.status, "open")));
      await audit(req, tx, "customer.qb_linked", "customer", customerId, { qbCustomerId });
      return updated;
    });
  });
  register("post", "/api/customer-review/:id/create", async (req, cid) => {
    const id = positiveId.parse(Number(req.params.id));
    emptyBody.parse(req.body ?? {});
    const review = await scopedReview(cid, id);
    if (review.status !== "open") throw new ReviewError(409, "This review is no longer open.");
    const existing = await storage.getCustomerByQuickBooksId(cid, review.qbCustomerId);
    if (existing) throw new ReviewError(409, `Already linked to ${existing.name}`);
    const qb = await integration(cid);
    const result = await deps.fetchQbCustomerById(qb, apiBase(), review.qbCustomerId);
    if (!result.ok) throw new ReviewError(result.status, result.message);
    // Term failures remain nonfatal, just as in normal sync.
    let terms: Map<string, string> | null = null;
    try { terms = await deps.fetchQbTermNames(qb, apiBase()); } catch { /* unavailable terms retain defaults */ }
    const mapped = mapQbCustomer(result.customer, terms);
    if (mapped.qbId !== review.qbCustomerId || !mapped.name) throw new ReviewError(502, "Invalid QuickBooks customer response.");
    return db.transaction(async tx => {
      await qbLock(tx, cid, review.qbCustomerId);
      const [current] = await tx.select().from(customerSyncReview).where(reviewScope(cid, id)).for("update");
      if (!current) throw new ReviewError(404, "Review not found.");
      if (current.status !== "open") throw new ReviewError(409, "This review is no longer open.");
      const owner = await claimed(tx, cid, review.qbCustomerId);
      if (owner) throw new ReviewError(409, `Already linked to ${owner.name}`);
      const [customer] = await tx.insert(customers).values(buildQbCustomerInsert(cid, mapped)).returning();
      await resolve(req, tx, cid, id, "created");
      await audit(req, tx, "customer.qb_review_created", "customer", customer.id, { reviewId: id });
      return customer;
    });
  });
  register("post", "/api/customer-review/:id/dismiss", async (req, cid) => {
    const id = positiveId.parse(Number(req.params.id));
    emptyBody.parse(req.body ?? {});
    const review = await scopedReview(cid, id);
    return db.transaction(async tx => {
      await qbLock(tx, cid, review.qbCustomerId);
      const row = await resolve(req, tx, cid, id, "dismissed");
      await audit(req, tx, "customer.qb_review_dismissed", "customer_sync_review", id);
      return row;
    });
  });
  register("post", "/api/customer-review/not-in-quickbooks", async (req, cid) => {
    const { customerId, value } = exclusionBody.parse(req.body);
    return db.transaction(async tx => {
      const [customer] = await tx.update(customers).set({ qbNotInQuickbooksAt: value ? new Date() : null })
        .where(customerScope(cid, customerId)).returning();
      if (!customer) throw new ReviewError(404, "Customer not found.");
      await audit(req, tx, "customer.qb_not_in_quickbooks", "customer", customerId, { value });
      return customer;
    });
  });
}
