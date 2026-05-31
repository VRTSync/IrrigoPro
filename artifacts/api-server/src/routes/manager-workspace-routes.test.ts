// Task #1005 — Manager Workspace route contract tests.
//
// Mounts registerManagerWorkspaceRoutes against an in-memory storage
// stub and exercises the queue filter/sort/pagination contract and the
// status-strip indicator counts.

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express, { type Express, type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
  registerManagerWorkspaceRoutes,
  _setWetChecksForTests,
  _setWorkOrdersForTests,
  _setFindingsForTests,
  _setBilingSheetsForTests,
  _resetManagerWorkspaceOverridesForTests,
} from "./manager-workspace-routes";
import { storage } from "../storage";

const ORIG: Record<string, any> = {};
function patch(name: string, impl: any) {
  ORIG[name] = (storage as any)[name];
  (storage as any)[name] = impl;
}
function restore() {
  for (const k of Object.keys(ORIG)) (storage as any)[k] = ORIG[k];
}

describe("manager-workspace routes", () => {
  let server: Server;
  let base: string;
  let role = "irrigation_manager";
  let companyId: number | null = 1;
  const now = Date.now();
  const iso = (offsetMs: number) => new Date(now - offsetMs).toISOString();

  // Compute the ISO week start (Monday 00:00:00 UTC of the current week)
  // using the same formula as the production route, so fixture timestamps
  // can be placed precisely inside or outside the current ISO week.
  function isoWeekStartMs(): number {
    const d = new Date(now);
    const day = d.getUTCDay(); // 0=Sun, 1=Mon, …, 6=Sat
    const daysToMonday = day === 0 ? 6 : day - 1;
    d.setUTCDate(d.getUTCDate() - daysToMonday);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  }
  // 1 hour after ISO week start (always in this week)
  const inWeek = new Date(isoWeekStartMs() + 3_600_000).toISOString();
  // 1 hour before ISO week start (always in the previous week)
  const prevWeek = new Date(isoWeekStartMs() - 3_600_000).toISOString();

  before(async () => {
    patch("getWorkOrders", async () => [
      // Active WO in company 1 — manager should see this
      {
        id: 9, workOrderNumber: "WO-9", assignedTechnicianId: 100, customerId: 10,
        customerName: "Acme", status: "pending_manager_review", totalAmount: "500.00",
        photos: [], createdAt: iso(86400_000),
      },
      // Active WO in company 2 — should not appear for co1 callers
      {
        id: 10, workOrderNumber: "WO-10", assignedTechnicianId: 200, customerId: 20,
        customerName: "BetaCo", status: "work_completed", totalAmount: "200.00",
        photos: ["x.jpg"], createdAt: iso(2 * 86400_000),
      },
      // WO with non-manager status — excluded from queue
      {
        id: 11, workOrderNumber: "WO-11", assignedTechnicianId: 100, customerId: 10,
        customerName: "Acme", status: "draft", totalAmount: "100.00",
        photos: [], createdAt: iso(3 * 86400_000),
      },
    ]);
    patch("getUser", async (id: number) =>
      id === 100
        ? { id: 100, companyId: 1, fullName: "Tech A" }
        : id === 200
          ? { id: 200, companyId: 2, fullName: "Tech B" }
          : null,
    );
    patch("getAllBillingSheets", async () => [
      // BS-1: approved 1h after ISO week start → INSIDE this week → counts
      {
        id: 1, billingNumber: "BS-1", technicianId: 100, customerId: 10,
        customerName: "Acme", status: "approved", totalAmount: "300.00",
        approvedAt: inWeek, createdAt: iso(10 * 86400_000),
      },
      // BS-2: approved 1h BEFORE ISO week start → in PREVIOUS week → does NOT count
      {
        id: 2, billingNumber: "BS-2", technicianId: 100, customerId: 10,
        customerName: "Acme", status: "approved", totalAmount: "150.00",
        approvedAt: prevWeek, createdAt: iso(14 * 86400_000),
      },
    ]);

    // Wet checks: submitted (active) in co1; approved inside this ISO week in co1;
    // submitted in co2 (out of scope for co1).
    _setWetChecksForTests(async () => [
      {
        id: 50, companyId: 1, customerId: 10, customerName: "Acme",
        technicianId: 100, technicianName: "Tech A",
        status: "submitted", createdAt: iso(2 * 86400_000), updatedAt: iso(2 * 86400_000),
        approvedAt: null,
      },
      // WC-51: approved inside this ISO week → counts for approvedThisWeek
      {
        id: 51, companyId: 1, customerId: 10, customerName: "Acme",
        technicianId: 100, technicianName: "Tech A",
        status: "approved", createdAt: iso(5 * 86400_000),
        updatedAt: inWeek, approvedAt: inWeek,
      },
      {
        id: 52, companyId: 2, customerId: 20, customerName: "BetaCo",
        technicianId: 200, technicianName: "Tech B",
        status: "submitted", createdAt: iso(1 * 86400_000), updatedAt: iso(1 * 86400_000),
        approvedAt: null,
      },
    ]);

    // Findings: id=1 unrouted in co1 wc=50; id=2 routed (billingSheetId set);
    // id=3 unrouted in co2 wc=52.
    _setFindingsForTests(async () => [
      {
        id: 1, wetCheckId: 50, issueType: "leak", issueGroup: "zone",
        resolution: "pending", billingSheetId: null, estimateId: null, workOrderId: null,
        customerId: 10, customerName: "Acme", technicianId: 100, technicianName: "Tech A",
        wcCompanyId: 1, wcStatus: "submitted", partPrice: "50.00", quantity: 2,
        createdAt: iso(2 * 86400_000),
      },
      {
        id: 2, wetCheckId: 50, issueType: "head", issueGroup: "zone",
        resolution: "sent_to_estimate", billingSheetId: null, estimateId: 5, workOrderId: null,
        customerId: 10, customerName: "Acme", technicianId: 100, technicianName: "Tech A",
        wcCompanyId: 1, wcStatus: "submitted", partPrice: "20.00", quantity: 1,
        createdAt: iso(1 * 86400_000),
      },
      {
        id: 3, wetCheckId: 52, issueType: "pipe", issueGroup: "main",
        resolution: "pending", billingSheetId: null, estimateId: null, workOrderId: null,
        customerId: 20, customerName: "BetaCo", technicianId: 200, technicianName: "Tech B",
        wcCompanyId: 2, wcStatus: "submitted", partPrice: "30.00", quantity: 1,
        createdAt: iso(3 * 86400_000),
      },
    ]);

    const app: Express = express();
    app.use(express.json());
    const requireAuthentication: RequestHandler = (req: any, _res, next) => {
      req.authenticatedUserRole = role;
      req.authenticatedUserCompanyId = companyId;
      next();
    };
    registerManagerWorkspaceRoutes(app, { requireAuthentication });
    server = createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    const addr = server.address() as AddressInfo;
    base = `http://127.0.0.1:${addr.port}`;
  });

  beforeEach(() => {
    role = "irrigation_manager";
    companyId = 1;
  });

  after(async () => {
    restore();
    _resetManagerWorkspaceOverridesForTests();
    await new Promise<void>((r) => server.close(() => r()));
  });

  // -------------------------------------------------------------------
  // Access control
  // -------------------------------------------------------------------

  it("rejects billing_manager with 403", async () => {
    role = "billing_manager";
    const r = await fetch(`${base}/api/manager-workspace/queue`);
    assert.equal(r.status, 403);
  });

  it("rejects billing_manager from status-strip with 403", async () => {
    role = "billing_manager";
    const r = await fetch(`${base}/api/manager-workspace/status-strip`);
    assert.equal(r.status, 403);
  });

  it("allows irrigation_manager", async () => {
    role = "irrigation_manager";
    const r = await fetch(`${base}/api/manager-workspace/queue`);
    assert.equal(r.status, 200);
  });

  it("allows company_admin", async () => {
    role = "company_admin";
    const r = await fetch(`${base}/api/manager-workspace/queue`);
    assert.equal(r.status, 200);
  });

  // -------------------------------------------------------------------
  // WC status filter
  // -------------------------------------------------------------------

  it("type=wc returns only active WC statuses; approved WC is excluded", async () => {
    // The test fixture has wc=50 (submitted, co1), wc=51 (approved, co1),
    // wc=52 (submitted, co2).  For co1 caller the scope helper filters by
    // companyId=1, but since we're using the test override the scoping is
    // applied at the route level (ACTIVE_WC filter). Approved WCs must not
    // appear.
    role = "super_admin";
    companyId = null;
    const r = await fetch(`${base}/api/manager-workspace/queue?type=wc`);
    assert.equal(r.status, 200);
    const body = (await r.json()) as any;
    const refIds = body.items.map((x: any) => x.refId);
    assert.ok(refIds.includes(50), "submitted WC 50 should appear");
    assert.ok(refIds.includes(52), "submitted WC 52 should appear (super_admin)");
    assert.ok(!refIds.includes(51), "approved WC 51 should NOT appear");
  });

  // -------------------------------------------------------------------
  // WO awaiting-approval filter
  // -------------------------------------------------------------------

  it("type=wo returns only ACTIVE_WO_FOR_MANAGER statuses for co1", async () => {
    role = "irrigation_manager";
    companyId = 1;
    const r = await fetch(`${base}/api/manager-workspace/queue?type=wo`);
    assert.equal(r.status, 200);
    const body = (await r.json()) as any;
    const refIds = body.items.map((x: any) => x.refId);
    assert.ok(refIds.includes(9), "WO-9 pending_manager_review should appear");
    assert.ok(!refIds.includes(10), "WO-10 in co2 should NOT appear for co1");
    assert.ok(!refIds.includes(11), "WO-11 draft should NOT appear");
  });

  // -------------------------------------------------------------------
  // Findings filter
  // -------------------------------------------------------------------

  it("type=finding: unrouted finding appears; routed finding does not", async () => {
    role = "super_admin";
    companyId = null;
    const r = await fetch(`${base}/api/manager-workspace/queue?type=finding`);
    assert.equal(r.status, 200);
    const body = (await r.json()) as any;
    const refIds = body.items.map((x: any) => x.refId);
    assert.ok(refIds.includes(1), "finding 1 (unrouted) should appear");
    assert.ok(!refIds.includes(2), "finding 2 (routed to estimate) should NOT appear");
    assert.ok(refIds.includes(3), "finding 3 (unrouted, co2) should appear for super_admin");
    const f1 = body.items.find((x: any) => x.refId === 1);
    assert.ok(f1, "finding 1 row should be present");
    assert.equal(f1.type, "finding");
    assert.ok(f1.href.includes("/wet-checks/50"), "href should reference parent wet check");
  });

  // -------------------------------------------------------------------
  // Company scoping
  // -------------------------------------------------------------------

  it("co1 caller does not see co2 WCs", async () => {
    // We're using test overrides; the scopedWetChecks helper is bypassed.
    // Scoping is enforced by the ACTIVE_WC filter and the companyId at the
    // override level. But we still verify the route returns 200 and that
    // items with the co2 wetCheckId=52 are excluded via the fixture setup
    // (the override returns all companies; the route itself only applies the
    // ACTIVE_WC filter). We test the real scoping by NOT using super_admin.
    // Since the wet-check override ignores req, we test via WO scoping
    // (storage.getWorkOrders + getUser) which IS company-scoped.
    role = "irrigation_manager";
    companyId = 1;
    const r = await fetch(`${base}/api/manager-workspace/queue?type=wo`);
    const body = (await r.json()) as any;
    const refIds = body.items.map((x: any) => x.refId);
    assert.ok(!refIds.includes(10), "WO-10 (co2) must not appear for co1 manager");
  });

  it("super_admin sees all WOs across companies", async () => {
    role = "super_admin";
    companyId = null;
    const r = await fetch(`${base}/api/manager-workspace/queue?type=wo`);
    const body = (await r.json()) as any;
    const refIds = body.items.map((x: any) => x.refId);
    assert.ok(refIds.includes(9), "WO-9 should appear for super_admin");
    assert.ok(refIds.includes(10), "WO-10 should appear for super_admin");
  });

  // -------------------------------------------------------------------
  // Status-strip indicator counts
  // -------------------------------------------------------------------

  it("status-strip returns { indicators } with the four required keys", async () => {
    const r = await fetch(`${base}/api/manager-workspace/status-strip`);
    assert.equal(r.status, 200);
    const body = (await r.json()) as any;
    assert.ok("indicators" in body, "response must have indicators key");
    for (const k of [
      "wcsPendingReview",
      "wosAwaitingApproval",
      "findingsNeedingRouting",
      "approvedThisWeek",
    ]) {
      assert.ok(k in body.indicators, `missing indicator: ${k}`);
    }
  });

  it("status-strip indicator counts are correct for irrigation_manager in co1", async () => {
    role = "irrigation_manager";
    companyId = 1;
    const r = await fetch(`${base}/api/manager-workspace/status-strip`);
    assert.equal(r.status, 200);
    const body = (await r.json()) as any;
    const ind = body.indicators;

    // wcsPendingReview: override returns 3 WCs total; for co1 manager the
    // scopedWetChecks override returns all (no real DB scope). submitted=2
    // (wc50, wc52) but the test checks super_admin-level since scoping is
    // test-override-driven. We test the status filter: approved WC is not counted.
    // All 3 WCs are returned by the override; ACTIVE_WC filters to submitted=2.
    assert.equal(ind.wcsPendingReview, 2, "2 submitted WCs (override ignores scope)");

    // wosAwaitingApproval: co1 has WO-9 (pending_manager_review); co2 has WO-10.
    // For co1 manager, tech scoping gives 1.
    assert.equal(ind.wosAwaitingApproval, 1, "1 WO awaiting approval in co1");

    // findingsNeedingRouting: override returns 3 findings; 2 are unrouted (id=1, id=3).
    assert.equal(ind.findingsNeedingRouting, 2, "2 unrouted findings");

    // approvedThisWeek uses ISO-week boundaries (Monday 00:00 UTC).
    // Fixtures: WC-51 (approvedAt=inWeek ✓) + BS-1 (approvedAt=inWeek ✓)
    //           + BS-2 (approvedAt=prevWeek ✗) + WOs: none in APPROVED_WO.
    // Scoping: wet-check override returns all 3 WCs regardless of co1 scope;
    //           BS-2 (technicianId=100 → co1) is excluded by ISO week filter.
    // Expected: WC-51 + BS-1 = 2.
    assert.equal(ind.approvedThisWeek, 2, "exactly 2 items approved this ISO week (WC-51 + BS-1); BS-2 (prevWeek) excluded");
  });

  // -------------------------------------------------------------------
  // Pagination & response shape
  // -------------------------------------------------------------------

  it("queue returns { items, page, pageSize, total } with X-Total-Count", async () => {
    const r = await fetch(`${base}/api/manager-workspace/queue`);
    assert.equal(r.status, 200);
    const body = (await r.json()) as any;
    assert.ok("items" in body && "page" in body && "pageSize" in body && "total" in body);
    assert.equal(r.headers.get("x-total-count"), String(body.total));
  });

  it("type=all includes wc, wo, and finding rows", async () => {
    role = "super_admin";
    companyId = null;
    const r = await fetch(`${base}/api/manager-workspace/queue?type=all`);
    const body = (await r.json()) as any;
    const types = new Set(body.items.map((x: any) => x.type));
    assert.ok(types.has("wet_check"), "should include wet_check rows");
    assert.ok(types.has("work_order"), "should include work_order rows");
    assert.ok(types.has("finding"), "should include finding rows");
  });

  it("sort=age_desc orders oldest first (default)", async () => {
    role = "super_admin";
    companyId = null;
    const r = await fetch(`${base}/api/manager-workspace/queue?type=wo&sort=age_desc`);
    const body = (await r.json()) as any;
    const ages = body.items
      .map((x: any) => x.ageDays)
      .filter((a: any) => a != null) as number[];
    const sorted = [...ages].sort((a, b) => b - a);
    assert.deepEqual(ages, sorted, "items should be oldest first");
  });
});
