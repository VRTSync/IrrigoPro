// Task #709 — Billing Workspace route contract tests.
//
// Mounts registerBillingWorkspaceRoutes against an in-memory storage
// stub and exercises the queue filter/sort/pagination contract, the
// status-strip semantics (awaitingApproval / approvedThisWeek /
// draftsLast24h / quickbooks+overdue), the overdue-summary shape
// and 15-minute cache, and the 301 redirects from legacy paths.

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express, { type Express, type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
  registerBillingWorkspaceRoutes,
  _resetOverdueCacheForTests,
  _resetFlagsForTests,
} from "./billing-workspace-routes";
import { storage } from "../storage";

const ORIG: Record<string, any> = {};
function patch(name: string, impl: any) {
  ORIG[name] = (storage as any)[name];
  (storage as any)[name] = impl;
}
function restore() {
  for (const k of Object.keys(ORIG)) (storage as any)[k] = ORIG[k];
}

let invoiceFixture: any[] = [];
let getAllInvoicesCallCount = 0;

describe("billing-workspace routes", () => {
  let server: Server;
  let base: string;
  let role = "billing_manager";
  let companyId: number | null = 1;
  const now = Date.now();
  const iso = (offsetMs: number) => new Date(now - offsetMs).toISOString();

  // WCB seed fixture — two WCBs in two different companies.
  // wcb id=1 (company 1, submitted — active)
  // wcb id=2 (company 2, submitted — active, out-of-scope for co1)
  // wcb id=3 (company 1, approved_passed_to_billing — counts toward approvedThisWeek)
  function seedWcbs() {
    patch("getAllWetCheckBillingsWithCounts", async () => [
      { id: 1, billingNumber: "WCB-1", customerId: 10, customerName: "Acme",
        technicianId: 100, technicianName: "Tech A", wetCheckId: 50,
        status: "submitted", totalAmount: "200.00",
        createdAt: iso(2 * 86400_000), updatedAt: iso(2 * 86400_000) },
      { id: 2, billingNumber: "WCB-2", customerId: 20, customerName: "BetaCo",
        technicianId: 200, technicianName: "Tech B", wetCheckId: 51,
        status: "submitted", totalAmount: "300.00",
        createdAt: iso(1 * 86400_000), updatedAt: iso(1 * 86400_000) },
      { id: 3, billingNumber: "WCB-3", customerId: 10, customerName: "Acme",
        technicianId: 100, technicianName: "Tech A", wetCheckId: 52,
        status: "approved_passed_to_billing", totalAmount: "150.00",
        createdAt: iso(5 * 86400_000), updatedAt: iso(4 * 86400_000) },
    ]);
  }

  before(async () => {
    patch("getAllBillingSheets", async () => [
      // active (awaiting), in company 1, 9 days old (stale flag)
      // wetCheckView: undefined — confirms non-WC sheets are unaffected by the BS-WC feature
      { id: 1, billingSheetNumber: "BS-1", technicianId: 100, customerId: 10, customerName: "Acme",
        status: "pending_manager_review", totalAmount: "150.00", photos: [], createdAt: iso(9 * 86400_000),
        wetCheckView: undefined },
      // active in company 2 (should not show for billing_manager in co 1)
      { id: 2, billingSheetNumber: "BS-2", technicianId: 200, customerId: 20, customerName: "BetaCo",
        status: "pending_manager_review", totalAmount: "250.00", photos: ["x.jpg"], createdAt: iso(2 * 86400_000),
        wetCheckView: undefined },
      // approved 3 days ago (counts toward approvedThisWeek)
      { id: 3, billingSheetNumber: "BS-3", technicianId: 100, customerId: 11, customerName: "Charlie",
        status: "approved", totalAmount: "300.00", photos: ["a.jpg"],
        approvedAt: iso(3 * 86400_000), createdAt: iso(10 * 86400_000), wetCheckView: undefined },
      // draft last 24h (drafts tile)
      { id: 4, billingSheetNumber: "BS-4", technicianId: 100, customerId: 12, customerName: "Delta",
        status: "draft", totalAmount: "50.00", photos: [], createdAt: iso(3600_000), wetCheckView: undefined },
    ]);
    patch("getWorkOrders", async () => [
      // active WO 1 day old in company 1
      { id: 9, workOrderNumber: "WO-9", assignedTechnicianId: 100, customerId: 10, customerName: "Acme",
        status: "pending_manager_review", totalAmount: "500.00", photos: [], createdAt: iso(86400_000) },
    ]);
    patch("getUser", async (id: number) =>
      id === 100 ? { id: 100, companyId: 1, fullName: "Tech A" } :
      id === 200 ? { id: 200, companyId: 2, fullName: "Tech B" } : null,
    );
    patch("getAllWetCheckBillingsWithCounts", async () => []);
    patch("getPendingParts", async (_cid: number) => []);
    patch("getManualPartReviews", async (_cid: number) => []);
    patch("getCustomer", async (id: number) => ({
      id, companyId: id < 20 ? 1 : 2, name: `cust-${id}`,
    }));
    getAllInvoicesCallCount = 0;
    invoiceFixture = [
      // overdue, co 1
      { id: 1, customerId: 10, status: "sent", totalAmount: "100.00", dueDate: iso(5 * 86400_000) },
      // not overdue (future due)
      { id: 2, customerId: 10, status: "sent", totalAmount: "50.00", dueDate: new Date(now + 86400_000).toISOString() },
      // paid (should be excluded)
      { id: 3, customerId: 10, status: "paid", totalAmount: "75.00", dueDate: iso(5 * 86400_000) },
      // overdue, co 2 (excluded for billing_manager in co 1)
      { id: 4, customerId: 20, status: "sent", totalAmount: "200.00", dueDate: iso(5 * 86400_000) },
    ];
    (storage as any).getAllInvoices = async () => {
      getAllInvoicesCallCount++;
      return invoiceFixture;
    };

    const app: Express = express();
    app.use(express.json());
    const requireAuthentication: RequestHandler = (req: any, _res, next) => {
      req.authenticatedUserRole = role;
      req.authenticatedUserCompanyId = companyId;
      next();
    };
    registerBillingWorkspaceRoutes(app, { requireAuthentication });
    server = createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    const addr = server.address() as AddressInfo;
    base = `http://127.0.0.1:${addr.port}`;
  });

  beforeEach(() => {
    role = "billing_manager";
    companyId = 1;
    _resetOverdueCacheForTests();
    getAllInvoicesCallCount = 0;
  });

  after(async () => {
    restore();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("301-redirects legacy /billing-dashboard, /billing, /billing/dashboard", async () => {
    for (const p of ["/billing-dashboard", "/billing", "/billing/dashboard"]) {
      const r = await fetch(`${base}${p}`, { redirect: "manual" });
      assert.equal(r.status, 301, `${p} should 301`);
      assert.equal(r.headers.get("location"), "/billing-workspace");
    }
  });

  it("rejects non-billing roles with 403", async () => {
    role = "field_tech";
    const r = await fetch(`${base}/api/billing-workspace/queue`);
    assert.equal(r.status, 403);
  });

  it("queue scopes to caller's company and returns {items,page,pageSize,total}", async () => {
    const r = await fetch(`${base}/api/billing-workspace/queue?type=bs`);
    assert.equal(r.status, 200);
    const body = (await r.json()) as any;
    assert.equal(body.pageSize, 50);
    assert.equal(body.page, 1);
    assert.equal(r.headers.get("x-total-count"), String(body.total));
    const refIds = body.items.map((x: any) => x.refId).sort();
    assert.deepEqual(refIds, [1], "only co1 active BS should show");
    assert.ok(body.items[0].flags.includes("stale"), "9d row gets stale flag");
    assert.ok(body.items[0].flags.includes("missing_photos"));
  });

  it("queue supports customer + tech + status + age filters", async () => {
    const u = (qs: string) => fetch(`${base}/api/billing-workspace/queue?${qs}`).then(r => r.json() as Promise<any>);
    const byCust = await u("customer=10");
    assert.ok(byCust.items.every((x: any) => x.customerId === 10));
    const byTech = await u("tech=100");
    assert.ok(byTech.items.every((x: any) => x.technicianId === 100 || x.technicianId == null));
    const byStatus = await u("status=pending_manager_review");
    assert.ok(byStatus.items.every((x: any) => x.status === "pending_manager_review"));
    const old = await u("age=7%2B");
    assert.ok(old.items.every((x: any) => (x.ageDays ?? 0) >= 7));
    const recent = await u("age=%3C1");
    assert.ok(recent.items.every((x: any) => (x.ageDays ?? 99) < 1));
  });

  it("queue sort=total_desc orders by amount descending", async () => {
    role = "super_admin"; companyId = null;
    const r = await fetch(`${base}/api/billing-workspace/queue?type=bs&status=pending_manager_review&sort=total_desc`);
    const body = (await r.json()) as any;
    const totals = body.items.map((x: any) => x.total);
    const sorted = [...totals].sort((a, b) => b - a);
    assert.deepEqual(totals, sorted);
  });

  it("queue pagination respects page + pageSize and X-Total-Count", async () => {
    role = "super_admin"; companyId = null;
    const r1 = await fetch(`${base}/api/billing-workspace/queue?pageSize=1&page=1`);
    const b1 = (await r1.json()) as any;
    const r2 = await fetch(`${base}/api/billing-workspace/queue?pageSize=1&page=2`);
    const b2 = (await r2.json()) as any;
    assert.equal(b1.items.length, 1);
    assert.equal(b2.items.length, 1);
    assert.notEqual(b1.items[0].id, b2.items[0].id);
    assert.equal(b1.total, b2.total);
    assert.equal(r1.headers.get("x-total-count"), String(b1.total));
  });

  it("status-strip returns the four required indicators", async () => {
    const r = await fetch(`${base}/api/billing-workspace/status-strip`);
    assert.equal(r.status, 200);
    const body = (await r.json()) as any;
    for (const k of ["awaitingApproval", "approvedThisWeek", "draftsLast24h", "quickbooks"]) {
      assert.ok(k in body, `missing ${k}`);
    }
    // BS-1 + WO-9 awaiting in co1
    assert.equal(body.awaitingApproval, 2);
    // BS-3 approved within last week
    assert.equal(body.approvedThisWeek, 1);
    // BS-4 created within last 24h, draft
    assert.equal(body.draftsLast24h, 1);
    assert.ok("state" in body.quickbooks);
    assert.ok("overdueCount" in body.quickbooks, "QB tile carries the overdue pill count");
  });

  it("overdue-summary returns {overdueCount, overdueAmount, agingReportUrl}", async () => {
    const r = await fetch(`${base}/api/quickbooks/overdue-summary`);
    assert.equal(r.status, 200);
    const body = (await r.json()) as any;
    // Only invoice 1 is overdue + scoped to co1
    assert.equal(body.overdueCount, 1);
    assert.equal(body.overdueAmount, 100);
    assert.ok(typeof body.agingReportUrl === "string" && body.agingReportUrl.length > 0);
  });

  it("overdue-summary caches results for 15 minutes per (role, company)", async () => {
    await fetch(`${base}/api/quickbooks/overdue-summary`);
    const after1 = getAllInvoicesCallCount;
    await fetch(`${base}/api/quickbooks/overdue-summary`);
    const after2 = getAllInvoicesCallCount;
    assert.equal(after2, after1, "second call within TTL should hit cache");
    _resetOverdueCacheForTests();
    await fetch(`${base}/api/quickbooks/overdue-summary`);
    assert.ok(getAllInvoicesCallCount > after2, "cache reset should re-fetch");
  });

  it("super_admin sees all tenants", async () => {
    role = "super_admin";
    companyId = null;
    const r = await fetch(`${base}/api/billing-workspace/queue?type=bs&status=pending_manager_review`);
    const body = (await r.json()) as any;
    const refIds = body.items.map((x: any) => x.refId).sort();
    assert.deepEqual(refIds, [1, 2]);
  });

  describe("queue — WCB rows (Slice 6)", () => {
    beforeEach(() => {
      role = "billing_manager";
      companyId = 1;
      _resetOverdueCacheForTests();
      _resetFlagsForTests();
      seedWcbs();
    });

    it("type=wcb returns only active WCB rows scoped to caller's company", async () => {
      const r = await fetch(`${base}/api/billing-workspace/queue?type=wcb`);
      assert.equal(r.status, 200);
      const body = (await r.json()) as any;
      const refIds = body.items.map((x: any) => x.refId).sort((a: number, b: number) => a - b);
      assert.deepEqual(refIds, [1], "co1 has only WCB-1 in active status");
    });

    it("non-active WCB statuses are excluded from the queue", async () => {
      const r = await fetch(`${base}/api/billing-workspace/queue?type=wcb`);
      const body = (await r.json()) as any;
      const numbers = body.items.map((x: any) => x.number);
      assert.ok(!numbers.includes("WCB-3"), "approved WCB should not appear in queue");
    });

    it("WCB queue item carries wetCheckId", async () => {
      const r = await fetch(`${base}/api/billing-workspace/queue?type=wcb`);
      const body = (await r.json()) as any;
      const row = body.items.find((x: any) => x.number === "WCB-1");
      assert.ok(row, "WCB-1 row should be present");
      assert.equal(row.wetCheckId, 50, "wetCheckId should be the wet check's id");
      assert.equal(row.type, "wet_check_billing");
    });

    it("type=all includes WCB rows alongside BS and WO rows", async () => {
      const r = await fetch(`${base}/api/billing-workspace/queue?type=all`);
      const body = (await r.json()) as any;
      const types = new Set(body.items.map((x: any) => x.type));
      assert.ok(types.has("billing_sheet"), "should include billing sheets");
      assert.ok(types.has("work_order"), "should include work orders");
      assert.ok(types.has("wet_check_billing"), "should include wet check billings");
    });

    it("type=bs does not include WCB rows", async () => {
      const r = await fetch(`${base}/api/billing-workspace/queue?type=bs`);
      const body = (await r.json()) as any;
      const types = body.items.map((x: any) => x.type);
      assert.ok(!types.includes("wet_check_billing"), "bs filter should exclude WCBs");
    });

    it("status-strip awaitingApproval and approvedThisWeek include WCBs; draftsLast24h does not", async () => {
      const r = await fetch(`${base}/api/billing-workspace/status-strip`);
      assert.equal(r.status, 200);
      const body = (await r.json()) as any;
      // BS-1 + WO-9 + WCB-1 = 3 awaiting (co1 only)
      assert.equal(body.awaitingApproval, 3, "awaitingApproval should include 1 active WCB");
      // BS-3 approved + WCB-3 approved this week = 2
      assert.equal(body.approvedThisWeek, 2, "approvedThisWeek should include 1 approved WCB");
      // draftsLast24h stays at 1 (BS-4), no WCB drafts
      assert.equal(body.draftsLast24h, 1, "draftsLast24h should not include WCBs");
    });

    it("tenant scoping: co1 sees 1 active WCB, super_admin sees 2", async () => {
      // co1 — already covered above (id=1)
      const r1 = await fetch(`${base}/api/billing-workspace/queue?type=wcb`);
      const b1 = (await r1.json()) as any;
      assert.equal(b1.items.length, 1, "co1 should see 1 active WCB");

      role = "super_admin";
      companyId = null;
      const r2 = await fetch(`${base}/api/billing-workspace/queue?type=wcb`);
      const b2 = (await r2.json()) as any;
      assert.equal(b2.items.length, 2, "super_admin should see 2 active WCBs");
    });
  });
});
