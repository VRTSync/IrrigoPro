import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import express from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { auditLog, companies, customers, customerSyncReview, users, type Customer } from "@workspace/db/schema";
import { db, pool } from "../db";
import { storage } from "../storage";
import { applyQbCustomers } from "../lib/qb-customer-sync";
import { getCustomerRecordsLock } from "../lib/customer-records-lock";
import { registerCustomerReviewRoutes, type CustomerReviewDeps } from "./customer-review-routes";
import { requireQuickBooksAccess } from "./role-guards";
import { registerCustomerRoutes } from "./customer-routes";
import { makeRequireCustomerInTenant } from "./customer-tenant-guard";

describe("customer sync review resolution (real development database, injected QB reads)", () => {
  const companyIds: number[] = [];
  const actorIds: number[] = [];
  let server: Server;
  let base: string;
  let fetches = 0;
  let singleFetches = 0;
  let remoteFailure = false;
  let remoteRows: Record<string, unknown>[] = [];
  let duplicate: Customer;
  let foreignCustomer: Customer;
  let holdId: number;
  let foreignHoldId: number;
  const migration = readFileSync(new URL("../../../../lib/db/migrations/0028_customer_sync_review.sql", import.meta.url), "utf8");
  const stamp = `review-test-${Date.now()}-${process.pid}`;
  const evidence: Record<string, unknown> = {};

  const customer = async (name: string, tenant = 0, extra: Partial<Customer> = {}) => {
    const [row] = await db.insert(customers).values({
      companyId: companyIds[tenant], name, email: "", ...extra,
    }).returning();
    return row;
  };
  const review = async (qbId: string, tenant = 0, extra: Partial<typeof customerSyncReview.$inferInsert> = {}) => {
    const [row] = await db.insert(customerSyncReview).values({
      companyId: companyIds[tenant], qbCustomerId: qbId, qbName: `Held ${qbId}`, kind: "possible_duplicate", ...extra,
    }).returning();
    return row;
  };
  const request = async (path: string, body?: unknown, tenant: number | null = 0, role = "company_admin") => {
    const response = await fetch(`${base}/api/customer-review${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", "x-test-tenant": tenant === null ? "none" : String(tenant),
        "x-test-role": role }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const audits = async (action: string, targetId?: number) => db.select().from(auditLog).where(and(
    eq(auditLog.actorCompanyId, companyIds[0]), eq(auditLog.action, action),
    ...(targetId === undefined ? [] : [eq(auditLog.targetId, String(targetId))])));
  const sync = (rows: Record<string, unknown>[]) => applyQbCustomers({
    companyId: companyIds[0], termNames: null, qbCustomers: rows, deps: {
      getCustomerRecordsLock,
      getCustomerByQuickBooksId: (cid, qb) => storage.getCustomerByQuickBooksId(cid, qb),
      getReviewRow: async (cid, qb) => {
        const row = await storage.getCustomerSyncReviewRow(cid, qb);
        return row ? { status: row.status as "open" | "dismissed" } : undefined;
      },
      getUnlinkedCustomers: cid => storage.getUnlinkedCustomers(cid),
      insertReviewRow: row => storage.insertCustomerSyncReviewRow(row),
      createCustomer: row => storage.createCustomer(row),
      updateCustomer: async (id, patch) => {
        const [row] = await db.update(customers).set(patch).where(and(
          eq(customers.companyId, companyIds[0]), eq(customers.id, id))).returning();
        return row;
      },
    },
  });

  before(async () => {
    assert.notEqual(process.env.NODE_ENV, "production", "development-only fixtures");
    await db.execute(sql.raw(migration));
    await db.execute(sql.raw(migration));
    for (const label of ["A", "B"]) {
      const [company] = await db.insert(companies).values({ name: `${stamp}-${label}`, customerRecordsLocked: true }).returning();
      companyIds.push(company.id);
      const [actor] = await db.insert(users).values({ companyId: company.id, username: `${stamp}-${label}`,
        name: "Review fixture actor", password: "not-a-login-credential", role: "company_admin" }).returning();
      actorIds.push(actor.id);
    }
    duplicate = await customer("Cedar Ridge", 0, { irrigoName: "Property Alias", address: "1 Main St", street: "1 Main St", zip: "80000" });
    foreignCustomer = await customer("Foreign customer", 1);
    holdId = (await review("700", 0, { candidateCustomerId: duplicate.id })).id;
    foreignHoldId = (await review("foreign", 1, { candidateCustomerId: foreignCustomer.id })).id;
    await review("closed", 0, { status: "dismissed" });
    await customer("Linked candidate", 0, { quickbooksId: "claimed" });
    remoteRows = [
      { Id: "700", DisplayName: "Cedar Ridge HOA" },
      { Id: "claimed", DisplayName: "Cedar Ridge" },
      { Id: "other", DisplayName: "Other", BillAddr: { PostalCode: "80000" } },
    ];
    const deps: CustomerReviewDeps = {
      requireAuthentication(req, res, next) {
        if (req.headers["x-test-role"] === "anonymous") { res.status(401).json({ message: "Authentication required" }); return; }
        const tenant = req.headers["x-test-tenant"] === "none" ? null : Number(req.headers["x-test-tenant"]);
        req.authenticatedUserCompanyId = tenant == null ? null : companyIds[tenant];
        req.authenticatedUserId = actorIds[tenant ?? 0];
        req.authenticatedUserRole = String(req.headers["x-test-role"]);
        next();
      },
      requireQuickBooksAccess,
      async integrationFor(cid) {
        assert.ok(companyIds.includes(cid));
        return { realmId: "injected-fixture", accessToken: "injected-not-a-credential" };
      },
      async fetchActiveQbCustomers() {
        fetches++;
        return remoteFailure ? { ok: false, status: 503, message: "Sandbox unavailable" } : { ok: true, customers: remoteRows };
      },
      async fetchQbCustomerById(_integration, _base, qbId) {
        singleFetches++;
        return { ok: true, customer: { Id: qbId, DisplayName: `Created ${qbId}`, ParentRef: { value: "parent" },
          PrimaryEmailAddr: { Address: "created@example.invalid" }, SalesTermRef: { value: "3" },
          MetaData: { LastUpdatedTime: "2026-11-04T12:00:00Z" } } };
      },
      async fetchQbTermNames() { return new Map([["3", "Net 15"]]); },
    };
    const app = express();
    app.use(express.json());
    registerCustomerReviewRoutes(app, deps);
    registerCustomerRoutes(app, {
      requireAuthentication: deps.requireAuthentication,
      requireCompanyAdminAccess: (req, res, next) => {
        if (req.authenticatedUserRole !== "company_admin") { res.sendStatus(403); return; }
        next();
      },
      requireCustomerEditAccess: deps.requireQuickBooksAccess,
      requireCustomerInTenant: makeRequireCustomerInTenant(storage),
      applyBillingNotesVisibility: (_req, data) => data,
    });
    server = await new Promise<Server>(resolve => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  after(async () => {
    try {
      if (server) await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
      if (companyIds.length) {
        await db.delete(auditLog).where(inArray(auditLog.actorCompanyId, companyIds));
        await db.delete(customerSyncReview).where(inArray(customerSyncReview.companyId, companyIds));
        await db.delete(customers).where(inArray(customers.companyId, companyIds));
        await db.delete(users).where(inArray(users.companyId, companyIds));
        await db.delete(companies).where(inArray(companies.id, companyIds));
      }
      if (process.env.CUSTOMER_REVIEW_EVIDENCE_DIR) {
        const directory = process.env.CUSTOMER_REVIEW_EVIDENCE_DIR;
        mkdirSync(directory, { recursive: true });
        writeFileSync(`${directory}/customer-review-injected-evidence.json`, JSON.stringify({
          mode: "Real development database with injected QuickBooks reads; NOT live sandbox proof",
          evidence, fixturesRemoved: true,
        }, null, 2));
      }
    } finally { await pool.end(); }
  });

  it("1. GET includes only caller-company open reviews/unlinked and enriched candidates; fetches once", async () => {
    const start = fetches;
    const result = await request("");
    assert.equal(result.status, 200);
    assert.equal(fetches, start + 1);
    assert.deepEqual(result.body.held.map((r: any) => r.id), [holdId]);
    assert.deepEqual(result.body.held[0].candidateCustomer, { id: duplicate.id, name: "Cedar Ridge",
      irrigoName: "Property Alias", address: "1 Main St" });
    assert.deepEqual(result.body.unlinked.map((r: any) => r.customer.id), [duplicate.id]);
    assert.deepEqual(result.body.unlinked[0].candidates.map((r: any) => r.qbId), ["700", "other"]);
    assert.ok(!JSON.stringify(result.body).includes("Foreign customer"));
  });
  it("2. link writes only the QB ID, resolves the review and records exactly one attributed audit", async () => {
    const before = (await db.select().from(customers).where(eq(customers.id, duplicate.id)))[0];
    const result = await request("/link", { customerId: duplicate.id, qbCustomerId: "700" });
    assert.equal(result.status, 200);
    const after = (await db.select().from(customers).where(eq(customers.id, duplicate.id)))[0];
    assert.deepEqual(after, { ...before, quickbooksId: "700" });
    const row = await storage.getCustomerSyncReviewById(companyIds[0], holdId);
    assert.equal(row?.status, "linked");
    assert.equal(row?.resolvedByUserId, actorIds[0]);
    assert.ok(row?.resolvedAt);
    const events = await audits("customer.qb_linked", duplicate.id);
    assert.equal(events.length, 1);
    assert.equal(events[0].actorUserId, actorIds[0]);
    assert.equal(events[0].actorRole, "company_admin");
  });
  it("3. conflicts have the exact already-linked messages, no audit on failure", async () => {
    const other = await customer("Another");
    const result = await request("/link", { customerId: other.id, qbCustomerId: "700" });
    assert.equal(result.status, 409);
    assert.equal(result.body.message, "This QuickBooks customer is already linked to Cedar Ridge.");
    const again = await request("/link", { customerId: duplicate.id, qbCustomerId: "unused" });
    assert.equal(again.status, 409);
    assert.equal(again.body.message, "This customer is already linked to QuickBooks.");
    assert.equal((await audits("customer.qb_linked")).length, 1);
  });
  it("4. foreign customers/reviews are 404 before state disclosure or remote calls", async () => {
    const start = singleFetches;
    for (const path of [`/${holdId}/create`, `/${holdId}/dismiss`]) {
      assert.equal((await request(path, {}, 1)).status, 404);
    }
    assert.equal((await request("/link", { customerId: duplicate.id, qbCustomerId: "700" }, 1)).status, 404);
    assert.equal((await request("/not-in-quickbooks", { customerId: foreignCustomer.id, value: true })).status, 404);
    assert.equal((await request(`/${foreignHoldId}/create`, {})).status, 404);
    assert.equal(singleFetches, start);
  });
  it("5. create fetches a single raw customer, reuses mapper/defaults, atomically resolves and audits", async () => {
    const row = await review("create", 0, { kind: "sub_customer", qbParentId: "parent" });
    const result = await request(`/${row.id}/create`, {});
    assert.equal(result.status, 200);
    assert.equal(result.body.quickbooksId, "create");
    assert.equal(result.body.companyId, companyIds[0]);
    assert.equal(result.body.paymentTerms, "net_15");
    assert.equal(result.body.laborRate, "45.00");
    assert.equal(result.body.email, "created@example.invalid");
    assert.equal(result.body.qbLastUpdatedAt, "2026-11-04T12:00:00.000Z");
    assert.equal((await storage.getCustomerSyncReviewById(companyIds[0], row.id))?.status, "created");
    const events = await audits("customer.qb_review_created", result.body.id);
    assert.equal(events.length, 1);
    assert.equal(events[0].actorUserId, actorIds[0]);
    assert.equal((await request(`/${row.id}/create`, {})).status, 409);
    const claimedRow = await review("700");
    const already = await request(`/${claimedRow.id}/create`, {});
    assert.equal(already.status, 409);
    assert.equal(already.body.message, "Already linked to Cedar Ridge");
  });
  it("6. dismiss records actor/time, future sync ignores indefinitely and cannot dismiss again", async () => {
    const row = await review("dismiss");
    const result = await request(`/${row.id}/dismiss`, {});
    assert.equal(result.status, 200);
    assert.equal(result.body.status, "dismissed");
    assert.equal(result.body.resolvedByUserId, actorIds[0]);
    assert.ok(result.body.resolvedAt);
    const summary = await sync([{ Id: "dismiss", DisplayName: "Dismissed", ParentRef: { value: "parent" } }]);
    assert.equal(summary.ignored, 1);
    assert.equal(summary.customersAdded, 0);
    assert.equal((await audits("customer.qb_review_dismissed", row.id)).length, 1);
    assert.equal((await request(`/${row.id}/dismiss`, {})).status, 409);
    assert.equal((await audits("customer.qb_review_dismissed", row.id)).length, 1);
  });
  it("7. exclusion sets/clears timestamp and immediately controls list and duplicate-guard eligibility", async () => {
    const local = await customer("Excluded fixture LLC");
    const enabled = await request("/not-in-quickbooks", { customerId: local.id, value: true });
    assert.equal(enabled.status, 200);
    assert.ok(enabled.body.qbNotInQuickbooksAt);
    assert.ok(!(await request("")).body.unlinked.some((r: any) => r.customer.id === local.id));
    assert.equal((await request("/link", { customerId: local.id, qbCustomerId: "excluded-link" })).status, 409);
    const notHeld = await sync([{ Id: "excluded-remote", DisplayName: "Excluded fixture" }]);
    assert.equal(notHeld.customersAdded, 1);
    const disabled = await request("/not-in-quickbooks", { customerId: local.id, value: false });
    assert.equal(disabled.body.qbNotInQuickbooksAt, null);
    assert.ok((await request("")).body.unlinked.some((r: any) => r.customer.id === local.id));
    const held = await sync([{ Id: "excluded-remote-2", DisplayName: "Excluded fixture" }]);
    assert.equal(held.heldForReview, 1);
    assert.equal((await audits("customer.qb_not_in_quickbooks", local.id)).length, 2);
  });
  it("8. remote failure preserves local review data, 200, qbError and empty candidates", async () => {
    remoteFailure = true;
    try {
      const result = await request("");
      assert.equal(result.status, 200);
      assert.equal(result.body.qbError, "Sandbox unavailable");
      assert.ok(result.body.held.length);
      assert.ok(result.body.unlinked.length);
      assert.ok(result.body.unlinked.every((r: any) => r.candidates.length === 0));
    } finally { remoteFailure = false; }
  });
  it("9. missing company is 400 on every endpoint", async () => {
    for (const [path, body] of [["", undefined], ["/summary", undefined], ["/link", {}],
      [`/${holdId}/create`, {}], [`/${holdId}/dismiss`, {}], ["/not-in-quickbooks", {}]] as const) {
      const result = await request(path, body, null);
      assert.equal(result.status, 400);
      assert.equal(result.body.message, "Company context is required.");
    }
  });
  it("10. summary matches list counts and never fetches QuickBooks", async () => {
    const list = await request("");
    const start = fetches;
    const result = await request("/summary");
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { held: list.body.held.length, unlinked: list.body.unlinked.length });
    assert.equal(fetches, start);
  });
  it("validates bodies and positive IDs, rejects roles on every endpoint", async () => {
    for (const body of [{ customerId: 0, qbCustomerId: "x" }, { customerId: duplicate.id, qbCustomerId: " " },
      { customerId: "1", qbCustomerId: "x" }, { customerId: duplicate.id, qbCustomerId: "x", companyId: companyIds[1] }]) {
      assert.equal((await request("/link", body)).status, 400);
    }
    for (const body of [{ customerId: -1, value: true }, { customerId: duplicate.id, value: "true" }]) {
      assert.equal((await request("/not-in-quickbooks", body)).status, 400);
    }
    for (const id of ["0", "-1", "abc", "1.2"]) {
      assert.equal((await request(`/${id}/create`, {})).status, 400);
      assert.equal((await request(`/${id}/dismiss`, {})).status, 400);
    }
    for (const [path, body] of [["", undefined], ["/summary", undefined], ["/link", {}],
      [`/${holdId}/create`, {}], [`/${holdId}/dismiss`, {}], ["/not-in-quickbooks", {}]] as const) {
      assert.equal((await request(path, body, 0, "field_tech")).status, 403);
      assert.equal((await request(path, body, 0, "anonymous")).status, 401);
    }
  });
  it("storage is scoped, ordered, conflict-safe and leaves resolved states untouched", async () => {
    const first = await review("storage-1");
    const second = await review("storage-2");
    await storage.insertCustomerSyncReviewRow({ companyId: companyIds[0], qbCustomerId: "storage-1", kind: "sub_customer" });
    assert.equal((await storage.listCustomerSyncReview(companyIds[0])).filter(r => r.qbCustomerId === "storage-1").length, 1);
    const rows = await storage.listCustomerSyncReview(companyIds[0]);
    assert.ok(rows.findIndex(r => r.id === second.id) < rows.findIndex(r => r.id === first.id));
    assert.equal(await storage.getCustomerSyncReviewById(companyIds[1], first.id), undefined);
    await storage.resolveCustomerSyncReview(companyIds[1], first.id, "dismissed", actorIds[1]);
    assert.equal((await storage.getCustomerSyncReviewById(companyIds[0], first.id))?.status, "open");
    await storage.resolveCustomerSyncReview(companyIds[0], first.id, "dismissed", actorIds[0]);
    await storage.resolveCustomerSyncReview(companyIds[0], first.id, "created", actorIds[0]);
    assert.equal((await storage.getCustomerSyncReviewRow(companyIds[0], "storage-1"))?.status, "dismissed");
    await storage.resolveOpenReviewRowsForQbId(companyIds[1], "storage-2", "linked", actorIds[1]);
    assert.equal((await storage.getCustomerSyncReviewById(companyIds[0], second.id))?.status, "open");
    await storage.resolveOpenReviewRowsForQbId(companyIds[0], "storage-2", "linked", actorIds[0]);
    assert.equal(await storage.getCustomerSyncReviewRow(companyIds[0], "storage-2"), undefined);
    const unlinked = await storage.getUnlinkedCustomers(companyIds[0]);
    assert.deepEqual(unlinked.map(c => c.id), unlinked.map(c => c.id).sort((a, b) => a - b));
    await assert.rejects(storage.insertCustomerSyncReviewRow({ companyId: companyIds[0], qbCustomerId: "foreign-candidate",
      kind: "possible_duplicate", candidateCustomerId: foreignCustomer.id }), /Candidate customer not found/);
  });
  it("competing links cannot overwrite one customer or claim one QB ID twice", async () => {
    const local = await customer("Race local");
    const results = await Promise.all(["race-a", "race-b"].map(qbCustomerId =>
      request("/link", { customerId: local.id, qbCustomerId })));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    assert.equal((await audits("customer.qb_linked", local.id)).length, 1);
    const pair = await Promise.all([customer("Race one"), customer("Race two")]);
    const competing = await Promise.all(pair.map(c => request("/link", { customerId: c.id, qbCustomerId: "race-shared" })));
    assert.deepEqual(competing.map(r => r.status).sort(), [200, 409]);
    assert.equal((await db.select().from(customers).where(and(eq(customers.companyId, companyIds[0]),
      eq(customers.quickbooksId, "race-shared")))).length, 1);
  });
  it("competing create/create and create/dismiss requests leave exactly one consistent resolution", async () => {
    for (const other of ["create", "dismiss"]) {
      const row = await review(`race-resolution-${other}`);
      const results = await Promise.all([request(`/${row.id}/create`, {}), request(`/${row.id}/${other}`, {})]);
      assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
      const resolved = await storage.getCustomerSyncReviewById(companyIds[0], row.id);
      const created = await storage.getCustomerByQuickBooksId(companyIds[0], row.qbCustomerId);
      assert.equal(Boolean(created), resolved?.status === "created");
      const events = await db.select().from(auditLog).where(and(eq(auditLog.actorCompanyId, companyIds[0]),
        inArray(auditLog.action, ["customer.qb_review_created", "customer.qb_review_dismissed"])));
      assert.equal(events.filter(e => (e.details as Record<string, unknown> | null)?.reviewId === row.id ||
        (e.targetType === "customer_sync_review" && e.targetId === String(row.id))).length, 1);
    }
  });
  it("competing link/create and link/dismiss requests resolve without orphan customers or 500s", async () => {
    for (const other of ["create", "dismiss"]) {
      const local = await customer(`Race link ${other}`);
      const row = await review(`race-link-${other}`);
      const results = await Promise.all([
        request("/link", { customerId: local.id, qbCustomerId: row.qbCustomerId }),
        request(`/${row.id}/${other}`, {}),
      ]);
      assert.ok(results.every(r => r.status === 200 || r.status === 409));
      const resolved = await storage.getCustomerSyncReviewById(companyIds[0], row.id);
      const owner = await storage.getCustomerByQuickBooksId(companyIds[0], row.qbCustomerId);
      assert.ok(owner);
      assert.notEqual(resolved?.status, "open");
      if (resolved?.status === "created") assert.notEqual(owner.id, local.id);
      if (resolved?.status === "linked") assert.equal(owner.id, local.id);
    }
  });
  it("deleting held and historical candidates clears only the hint and leaves open reviews resolvable", async () => {
    for (const status of ["open", "linked", "created", "dismissed"] as const) {
      const candidate = await customer(`Deletable ${status} candidate`);
      const held = await review(`delete-candidate-${status}`, 0, { candidateCustomerId: candidate.id, status });
      const response = await fetch(`${base}/api/customers/${candidate.id}`, {
        method: "DELETE", headers: { "x-test-tenant": "0", "x-test-role": "company_admin" },
      });
      assert.equal(response.status, 200, await response.text());
      const [remainingCustomer] = await db.select().from(customers).where(and(
        eq(customers.companyId, companyIds[0]), eq(customers.id, candidate.id)));
      assert.equal(remainingCustomer, undefined);
      const retained = await storage.getCustomerSyncReviewById(companyIds[0], held.id);
      assert.equal(retained?.candidateCustomerId, null);
      assert.equal(retained?.status, status);
      if (status === "open") {
        const listing = await request("");
        assert.equal(listing.body.held.find((r: any) => r.id === held.id).candidateCustomer, null);
        const created = await request(`/${held.id}/create`, {});
        assert.equal(created.status, 200);
        assert.equal(created.body.quickbooksId, held.qbCustomerId);
        assert.equal((await storage.getCustomerSyncReviewById(companyIds[0], held.id))?.status, "created");
      }
    }
  });
  it("development duplicate hold → HTTP link → next-sync update; sub-customer remains held (injected QB)", async () => {
    const local = await customer("Test Duplicate LLC");
    const raw = { Id: "acceptance-duplicate", DisplayName: "Test Duplicate",
      PrimaryEmailAddr: { Address: "next-sync@example.invalid" } };
    const held = await sync([raw]);
    assert.equal(held.heldForReview, 1);
    assert.equal(held.customersAdded, 0);
    const before = await db.select().from(customers).where(and(eq(customers.companyId, companyIds[0]),
      inArray(customers.name, ["Test Duplicate", "Test Duplicate LLC"])));
    assert.equal(before.length, 1);
    const linked = await request("/link", { customerId: local.id, qbCustomerId: raw.Id });
    assert.equal(linked.status, 200);
    assert.equal(linked.body.email, "");
    const next = await sync([raw]);
    assert.equal(next.heldForReview, 0);
    assert.equal(next.customersUpdated, 1);
    const updated = await storage.getCustomerByQuickBooksId(companyIds[0], raw.Id);
    assert.equal(updated?.id, local.id);
    assert.equal(updated?.email, "next-sync@example.invalid");
    const sub = await sync([{ Id: "acceptance-child", DisplayName: "Sandbox Child", ParentRef: { value: "parent" } }]);
    assert.equal(sub.heldForReview, 1);
    assert.equal(sub.customersAdded, 0);
    const child = await storage.getCustomerSyncReviewRow(companyIds[0], "acceptance-child");
    assert.equal(child?.kind, "sub_customer");
    assert.equal(await storage.getCustomerByQuickBooksId(companyIds[0], "acceptance-child"), undefined);
    Object.assign(evidence, { duplicateHold: held, duplicateCustomerCountBeforeLink: before.length,
      httpLink: linked, nextSync: next, updatedCustomer: updated, subCustomerSync: sub, subCustomerReview: child });
  });
});
