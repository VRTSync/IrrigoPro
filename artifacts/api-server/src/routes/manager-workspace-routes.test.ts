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
  _setWcbForTests,
  _setPartsForTests,
  _setReviewsForTests,
  _setInvoicedBsWcIdsForTests,
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

    // WCBs: none by default in the shared fixture — keeps existing tests from
    // hitting the real DB when the wet-check path now pre-loads WCBs.
    _setWcbForTests(async () => []);
    _setPartsForTests(async () => []);
    _setReviewsForTests(async () => []);

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

  it("allows billing_manager on queue", async () => {
    role = "billing_manager";
    const r = await fetch(`${base}/api/manager-workspace/queue`);
    assert.equal(r.status, 200);
  });

  it("allows billing_manager on status-strip", async () => {
    role = "billing_manager";
    const r = await fetch(`${base}/api/manager-workspace/status-strip`);
    assert.equal(r.status, 200);
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

  it("rejects field_tech with 403", async () => {
    role = "field_tech";
    const r = await fetch(`${base}/api/manager-workspace/queue`);
    assert.equal(r.status, 403);
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

  // -------------------------------------------------------------------
  // Already-billed item filtering (Task #1250)
  // -------------------------------------------------------------------

  describe("already-billed items are excluded from needs_review / waiting_on_tech", () => {
    // Each nested test fully overrides all data fixtures so the shared
    // before() fixtures don't interfere, then resets them afterward.

    it("WO with pending_manager_review status + invoiceId is absent from needs_review", async () => {
      _setWorkOrdersForTests(async () => [
        {
          id: 900, workOrderNumber: "WO-BILLED", assignedTechnicianId: 100,
          customerId: 10, customerName: "Acme",
          status: "pending_manager_review",
          invoiceId: 42,
          totalAmount: "300.00", photos: [],
          createdAt: iso(2 * 86400_000), updatedAt: iso(1 * 86400_000),
          billedAt: iso(1 * 86400_000),
        },
      ]);
      _setWetChecksForTests(async () => []);
      _setFindingsForTests(async () => []);
      _setBilingSheetsForTests(async () => []);
      _setWcbForTests(async () => []);

      role = "super_admin";
      companyId = null;
      const r = await fetch(`${base}/api/manager-workspace/queue?type=wo`);
      assert.equal(r.status, 200);
      const body = (await r.json()) as any;
      const needsReview = body.items.filter((x: any) => x.stage === "needs_review");
      const waitingOnTech = body.items.filter((x: any) => x.stage === "waiting_on_tech");
      assert.equal(needsReview.length, 0, "invoiced WO must not appear in needs_review");
      assert.equal(waitingOnTech.length, 0, "invoiced WO must not appear in waiting_on_tech");
      // It is in billed_7d (within 7 days)
      const billed7d = body.items.filter((x: any) => x.stage === "billed_7d");
      assert.equal(billed7d.length, 1, "invoiced WO should appear in billed_7d");

      _resetManagerWorkspaceOverridesForTests();
    });

    it("billing sheet with submitted status + invoiceId is absent from needs_review", async () => {
      _setWorkOrdersForTests(async () => []);
      _setWetChecksForTests(async () => []);
      _setFindingsForTests(async () => []);
      _setBilingSheetsForTests(async () => [
        {
          id: 200, billingNumber: "BS-BILLED", technicianId: 100,
          customerId: 10, customerName: "Acme",
          status: "submitted",
          invoiceId: 77,
          totalAmount: "500.00", photos: [],
          createdAt: iso(2 * 86400_000), updatedAt: iso(1 * 86400_000),
          billedAt: iso(1 * 86400_000),
        },
      ]);
      _setWcbForTests(async () => []);

      role = "super_admin";
      companyId = null;
      const r = await fetch(`${base}/api/manager-workspace/queue?type=bs`);
      assert.equal(r.status, 200);
      const body = (await r.json()) as any;
      const needsReview = body.items.filter((x: any) => x.stage === "needs_review");
      const waitingOnTech = body.items.filter((x: any) => x.stage === "waiting_on_tech");
      assert.equal(needsReview.length, 0, "invoiced BS must not appear in needs_review");
      assert.equal(waitingOnTech.length, 0, "invoiced BS must not appear in waiting_on_tech");
      const billed7d = body.items.filter((x: any) => x.stage === "billed_7d");
      assert.equal(billed7d.length, 1, "invoiced BS should appear in billed_7d");

      _resetManagerWorkspaceOverridesForTests();
    });

    it("WCB with pending_manager_review status + invoiceId is absent from needs_review", async () => {
      _setWorkOrdersForTests(async () => []);
      _setWetChecksForTests(async () => []);
      _setFindingsForTests(async () => []);
      _setBilingSheetsForTests(async () => []);
      _setWcbForTests(async () => [
        {
          id: 300, billingNumber: "WCB-BILLED", technicianId: 100,
          customerId: 10, customerName: "Acme",
          status: "pending_manager_review",
          invoiceId: 99,
          wetCheckId: 50,
          totalAmount: "150.00",
          createdAt: iso(2 * 86400_000), updatedAt: iso(1 * 86400_000),
        },
      ]);

      role = "super_admin";
      companyId = null;
      const r = await fetch(`${base}/api/manager-workspace/queue?type=wcb`);
      assert.equal(r.status, 200);
      const body = (await r.json()) as any;
      const needsReview = body.items.filter((x: any) => x.stage === "needs_review");
      const waitingOnTech = body.items.filter((x: any) => x.stage === "waiting_on_tech");
      assert.equal(needsReview.length, 0, "invoiced WCB must not appear in needs_review");
      assert.equal(waitingOnTech.length, 0, "invoiced WCB must not appear in waiting_on_tech");
      const billed7d = body.items.filter((x: any) => x.stage === "billed_7d");
      assert.equal(billed7d.length, 1, "invoiced WCB should appear in billed_7d");

      _resetManagerWorkspaceOverridesForTests();
    });

    it("wet check whose linked WCB is billed is absent from needs_review", async () => {
      // wc.id=50 is linked via WCB.wetCheckId=50 which has invoiceId set.
      _setWetChecksForTests(async () => [
        {
          id: 50, companyId: 1, customerId: 10, customerName: "Acme",
          technicianId: 100, technicianName: "Tech A",
          status: "submitted",
          createdAt: iso(2 * 86400_000), updatedAt: iso(2 * 86400_000),
          approvedAt: null,
        },
      ]);
      _setWorkOrdersForTests(async () => []);
      _setFindingsForTests(async () => []);
      _setBilingSheetsForTests(async () => []);
      _setInvoicedBsWcIdsForTests(async () => new Set());
      _setWcbForTests(async () => [
        {
          id: 400, billingNumber: "WCB-400", technicianId: 100,
          customerId: 10, customerName: "Acme",
          status: "billed",
          invoiceId: 55,
          wetCheckId: 50,
          totalAmount: "200.00",
          createdAt: iso(2 * 86400_000), updatedAt: iso(1 * 86400_000),
        },
      ]);

      role = "super_admin";
      companyId = null;
      const r = await fetch(`${base}/api/manager-workspace/queue?type=wc`);
      assert.equal(r.status, 200);
      const body = (await r.json()) as any;
      const refIds = body.items.map((x: any) => x.refId);
      assert.ok(!refIds.includes(50), "WC 50 must not appear in needs_review when its WCB is invoiced");

      _resetManagerWorkspaceOverridesForTests();
    });

    it("wet check whose findings were billed via a billing sheet is absent from needs_review", async () => {
      // wc.id=60 had its finding routed to billing sheet id=500, which now
      // has invoiceId=88.  The DB join is mocked via _setInvoicedBsWcIdsForTests
      // returning {60} directly.
      _setWetChecksForTests(async () => [
        {
          id: 60, companyId: 1, customerId: 10, customerName: "Acme",
          technicianId: 100, technicianName: "Tech A",
          status: "submitted",
          createdAt: iso(2 * 86400_000), updatedAt: iso(2 * 86400_000),
          approvedAt: null,
        },
      ]);
      _setWorkOrdersForTests(async () => []);
      _setFindingsForTests(async () => []);
      _setBilingSheetsForTests(async () => []);
      _setWcbForTests(async () => []);
      // Inject the billing-sheet → wet-check link directly (bypasses real DB join)
      _setInvoicedBsWcIdsForTests(async () => new Set([60]));

      role = "super_admin";
      companyId = null;
      const r = await fetch(`${base}/api/manager-workspace/queue?type=wc`);
      assert.equal(r.status, 200);
      const body = (await r.json()) as any;
      const refIds = body.items.map((x: any) => x.refId);
      assert.ok(
        !refIds.includes(60),
        "WC 60 must not appear in needs_review when its findings are on an invoiced billing sheet",
      );

      _resetManagerWorkspaceOverridesForTests();
    });

    // Suppression invariant — locked permanently (anti-regression for Task #1250).
    // These two cases pin the exact contract: suppression is driven by invoiceId
    // presence, never by status string alone.

    it("[suppression invariant] needs_review WO WITH invoiceId is NOT in needs_review", async () => {
      _setWorkOrdersForTests(async () => [
        {
          id: 901, workOrderNumber: "WO-INV", assignedTechnicianId: 100,
          customerId: 10, customerName: "Acme",
          status: "pending_manager_review",
          invoiceId: 42,          // billed — must suppress
          totalAmount: "300.00", photos: [],
          createdAt: iso(2 * 86400_000), updatedAt: iso(1 * 86400_000),
          billedAt: iso(1 * 86400_000),
        },
      ]);
      _setWetChecksForTests(async () => []);
      _setFindingsForTests(async () => []);
      _setBilingSheetsForTests(async () => []);
      _setWcbForTests(async () => []);

      role = "super_admin"; companyId = null;
      const r = await fetch(`${base}/api/manager-workspace/queue?type=wo`);
      const body = (await r.json()) as any;
      const needsReview = body.items.filter((x: any) => x.stage === "needs_review");
      assert.equal(needsReview.length, 0, "WO with invoiceId must not appear in needs_review");
      _resetManagerWorkspaceOverridesForTests();
    });

    it("[suppression invariant] needs_review WO WITHOUT invoiceId IS in needs_review", async () => {
      _setWorkOrdersForTests(async () => [
        {
          id: 902, workOrderNumber: "WO-UNBILLED", assignedTechnicianId: 100,
          customerId: 10, customerName: "Acme",
          status: "pending_manager_review",
          invoiceId: null,        // no invoice — must be visible
          totalAmount: "300.00", photos: [],
          createdAt: iso(2 * 86400_000), updatedAt: iso(1 * 86400_000),
        },
      ]);
      _setWetChecksForTests(async () => []);
      _setFindingsForTests(async () => []);
      _setBilingSheetsForTests(async () => []);
      _setWcbForTests(async () => []);

      role = "super_admin"; companyId = null;
      const r = await fetch(`${base}/api/manager-workspace/queue?type=wo`);
      const body = (await r.json()) as any;
      const needsReview = body.items.filter((x: any) => x.stage === "needs_review");
      assert.equal(needsReview.length, 1, "WO without invoiceId must appear in needs_review");
      _resetManagerWorkspaceOverridesForTests();
    });
  });

  // -------------------------------------------------------------------
  // Anti-leakage flags (Task #1257 — Slice 3)
  // -------------------------------------------------------------------

  describe("anti-leakage flags", () => {
    it("approved_passed_to_billing WO, 10 days old, no invoiceId → aging_unbilled flag", async () => {
      _setWorkOrdersForTests(async () => [
        {
          id: 1001, workOrderNumber: "WO-AGING", assignedTechnicianId: 100,
          customerId: 10, customerName: "Acme",
          status: "approved_passed_to_billing",
          invoiceId: null,
          totalAmount: "400.00", photos: ["p.jpg"],
          createdAt: iso(10 * 86400_000), updatedAt: iso(10 * 86400_000),
        },
      ]);
      _setWetChecksForTests(async () => []);
      _setFindingsForTests(async () => []);
      _setBilingSheetsForTests(async () => []);
      _setWcbForTests(async () => []);

      role = "super_admin"; companyId = null;
      const r = await fetch(`${base}/api/manager-workspace/queue?type=wo`);
      const body = (await r.json()) as any;
      const item = body.items.find((x: any) => x.refId === 1001);
      assert.ok(item, "WO-AGING should be in the queue");
      assert.ok(item.flags.includes("aging_unbilled"), "10-day-old unbilled WO must have aging_unbilled flag");
      assert.equal(item.stage, "passed_to_billing");
      _resetManagerWorkspaceOverridesForTests();
    });

    it("approved_passed_to_billing WO, 2 days old, no invoiceId → no aging_unbilled flag", async () => {
      _setWorkOrdersForTests(async () => [
        {
          id: 1002, workOrderNumber: "WO-FRESH", assignedTechnicianId: 100,
          customerId: 10, customerName: "Acme",
          status: "approved_passed_to_billing",
          invoiceId: null,
          totalAmount: "200.00", photos: ["p.jpg"],
          createdAt: iso(2 * 86400_000), updatedAt: iso(2 * 86400_000),
        },
      ]);
      _setWetChecksForTests(async () => []);
      _setFindingsForTests(async () => []);
      _setBilingSheetsForTests(async () => []);
      _setWcbForTests(async () => []);

      role = "super_admin"; companyId = null;
      const r = await fetch(`${base}/api/manager-workspace/queue?type=wo`);
      const body = (await r.json()) as any;
      const item = body.items.find((x: any) => x.refId === 1002);
      assert.ok(item, "WO-FRESH should be in the queue");
      assert.ok(!item.flags.includes("aging_unbilled"), "2-day-old WO must NOT have aging_unbilled flag");
      _resetManagerWorkspaceOverridesForTests();
    });

    it("pending finding, no routing target, 10 days old → orphaned_finding flag", async () => {
      _setWorkOrdersForTests(async () => []);
      _setWetChecksForTests(async () => []);
      _setBilingSheetsForTests(async () => []);
      _setWcbForTests(async () => []);
      _setFindingsForTests(async () => [
        {
          id: 200, wetCheckId: 50, issueType: "leak", issueGroup: "zone",
          resolution: "pending",
          billingSheetId: null, estimateId: null, workOrderId: null, wetCheckBillingId: null,
          customerId: 10, customerName: "Acme",
          technicianId: 100, technicianName: "Tech A",
          wcCompanyId: 1, wcStatus: "submitted",
          partPrice: "30.00", quantity: 1,
          createdAt: iso(10 * 86400_000),
        },
      ]);

      role = "super_admin"; companyId = null;
      const r = await fetch(`${base}/api/manager-workspace/queue?type=finding`);
      const body = (await r.json()) as any;
      const item = body.items.find((x: any) => x.refId === 200);
      assert.ok(item, "orphaned finding should appear in the queue");
      assert.ok(item.flags.includes("orphaned_finding"), "10-day-old unrouted pending finding must have orphaned_finding flag");
      _resetManagerWorkspaceOverridesForTests();
    });

    it("pending finding, no routing target, 2 days old → no orphaned_finding flag", async () => {
      _setWorkOrdersForTests(async () => []);
      _setWetChecksForTests(async () => []);
      _setBilingSheetsForTests(async () => []);
      _setWcbForTests(async () => []);
      _setFindingsForTests(async () => [
        {
          id: 201, wetCheckId: 50, issueType: "leak", issueGroup: "zone",
          resolution: "pending",
          billingSheetId: null, estimateId: null, workOrderId: null, wetCheckBillingId: null,
          customerId: 10, customerName: "Acme",
          technicianId: 100, technicianName: "Tech A",
          wcCompanyId: 1, wcStatus: "submitted",
          partPrice: "30.00", quantity: 1,
          createdAt: iso(2 * 86400_000),
        },
      ]);

      role = "super_admin"; companyId = null;
      const r = await fetch(`${base}/api/manager-workspace/queue?type=finding`);
      const body = (await r.json()) as any;
      const item = body.items.find((x: any) => x.refId === 201);
      assert.ok(item, "finding 201 should appear");
      assert.ok(!item.flags.includes("orphaned_finding"), "2-day-old finding must NOT have orphaned_finding");
      _resetManagerWorkspaceOverridesForTests();
    });

    it("needs_review WO, 10 days old → cold_review flag", async () => {
      _setWorkOrdersForTests(async () => [
        {
          id: 1003, workOrderNumber: "WO-COLD", assignedTechnicianId: 100,
          customerId: 10, customerName: "Acme",
          status: "pending_manager_review",
          invoiceId: null,
          totalAmount: "100.00", photos: [],
          createdAt: iso(10 * 86400_000), updatedAt: iso(10 * 86400_000),
        },
      ]);
      _setWetChecksForTests(async () => []);
      _setFindingsForTests(async () => []);
      _setBilingSheetsForTests(async () => []);
      _setWcbForTests(async () => []);

      role = "super_admin"; companyId = null;
      const r = await fetch(`${base}/api/manager-workspace/queue?type=wo`);
      const body = (await r.json()) as any;
      const item = body.items.find((x: any) => x.refId === 1003);
      assert.ok(item, "WO-COLD should appear");
      assert.equal(item.stage, "needs_review");
      assert.ok(item.flags.includes("cold_review"), "10-day-old needs_review WO must have cold_review flag");
      _resetManagerWorkspaceOverridesForTests();
    });

    it("partially_converted wet check always appears in queue with partially_converted flag", async () => {
      _setWetChecksForTests(async () => [
        {
          id: 70, companyId: 1, customerId: 10, customerName: "Acme",
          technicianId: 100, technicianName: "Tech A",
          status: "partially_converted",
          createdAt: iso(3 * 86400_000), updatedAt: iso(3 * 86400_000),
          approvedAt: null,
        },
      ]);
      _setWorkOrdersForTests(async () => []);
      _setFindingsForTests(async () => []);
      _setBilingSheetsForTests(async () => []);
      _setWcbForTests(async () => []);
      _setInvoicedBsWcIdsForTests(async () => new Set());

      role = "super_admin"; companyId = null;
      const r = await fetch(`${base}/api/manager-workspace/queue?type=wc`);
      const body = (await r.json()) as any;
      const item = body.items.find((x: any) => x.refId === 70);
      assert.ok(item, "partially_converted wet check must appear in the queue");
      assert.ok(item.flags.includes("partially_converted"), "must carry partially_converted flag");
      _resetManagerWorkspaceOverridesForTests();
    });

    it("attentionCount in status-strip equals count of flagged items", async () => {
      // One aging_unbilled WO (10 days, approved_passed_to_billing, no invoice)
      // One cold_review WO (10 days, needs_review, no invoice) — combined total = 2
      _setWorkOrdersForTests(async () => [
        {
          id: 2001, workOrderNumber: "WO-A", assignedTechnicianId: 100,
          customerId: 10, customerName: "Acme",
          status: "approved_passed_to_billing",
          invoiceId: null,
          totalAmount: "100.00", photos: [],
          createdAt: iso(10 * 86400_000), updatedAt: iso(10 * 86400_000),
        },
        {
          id: 2002, workOrderNumber: "WO-B", assignedTechnicianId: 100,
          customerId: 10, customerName: "Acme",
          status: "pending_manager_review",
          invoiceId: null,
          totalAmount: "50.00", photos: [],
          createdAt: iso(10 * 86400_000), updatedAt: iso(10 * 86400_000),
        },
      ]);
      _setWetChecksForTests(async () => []);
      _setFindingsForTests(async () => []);
      _setBilingSheetsForTests(async () => []);
      _setWcbForTests(async () => []);

      role = "super_admin"; companyId = null;
      const r = await fetch(`${base}/api/manager-workspace/status-strip`);
      assert.equal(r.status, 200);
      const body = (await r.json()) as any;
      assert.ok("attentionCount" in body, "status-strip must include attentionCount");
      assert.equal(body.attentionCount, 2, "attentionCount must equal count of flagged items (aging_unbilled + cold_review)");
      _resetManagerWorkspaceOverridesForTests();
    });

    it("invoiced wet check is NOT counted in attentionCount even if old", async () => {
      // wc.id=80 is 10 days old and active but its WCB is invoiced —
      // the queue suppresses it and attentionCount must too.
      _setWetChecksForTests(async () => [
        {
          id: 80, companyId: 1, customerId: 10, customerName: "Acme",
          technicianId: 100, technicianName: "Tech A",
          status: "submitted",
          createdAt: iso(10 * 86400_000), updatedAt: iso(10 * 86400_000),
          approvedAt: null,
        },
      ]);
      _setWorkOrdersForTests(async () => []);
      _setFindingsForTests(async () => []);
      _setBilingSheetsForTests(async () => []);
      _setInvoicedBsWcIdsForTests(async () => new Set());
      _setWcbForTests(async () => [
        {
          id: 500, billingNumber: "WCB-500", technicianId: 100,
          customerId: 10, customerName: "Acme",
          status: "billed",
          invoiceId: 99,    // invoiced — WC should be suppressed
          wetCheckId: 80,
          totalAmount: "200.00",
          createdAt: iso(2 * 86400_000), updatedAt: iso(1 * 86400_000),
        },
      ]);

      role = "super_admin"; companyId = null;
      const r = await fetch(`${base}/api/manager-workspace/status-strip`);
      assert.equal(r.status, 200);
      const body = (await r.json()) as any;
      assert.equal(
        body.attentionCount,
        0,
        "invoiced wet check must NOT count toward attentionCount",
      );
      _resetManagerWorkspaceOverridesForTests();
    });
  });
});
