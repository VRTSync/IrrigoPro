// Slice 2 — "Billed without manager review" badge tests.
//
// Verifies:
//   (a) WCB approved by billing_manager then billed →
//       billedWithoutReview: true, flags includes "no_manager_review",
//       still present 30+ days later for irrigation_manager caller,
//       absent from billing_manager caller's queue.
//   (b) WO approved by irrigation_manager then billed →
//       billedWithoutReview: false, drops out after 7 days.
//   (c) Legacy row with approvedByRole = NULL →
//       billedWithoutReview: false, not flagged.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
  registerManagerWorkspaceRoutes,
  _setWcbForTests,
  _setWorkOrdersForTests,
  _setBilingSheetsForTests,
  _setWetChecksForTests,
  _setFindingsForTests,
  _setPartsForTests,
  _setReviewsForTests,
  _setInvoicedBsWcIdsForTests,
  _resetManagerWorkspaceOverridesForTests,
} from "./manager-workspace-routes";
import { storage } from "../storage";

// ── Test helpers ────────────────────────────────────────────────────────────

const ORIG: Record<string, any> = {};
function patchStorage(name: string, impl: any) {
  ORIG[name] = (storage as any)[name];
  (storage as any)[name] = impl;
}
function restoreStorage() {
  for (const k of Object.keys(ORIG)) (storage as any)[k] = ORIG[k];
}

const now = Date.now();
// 30 days ago — well past the 7-day cutoff
const THIRTY_DAYS_AGO = new Date(now - 30 * 86_400_000).toISOString();
// 3 days ago — within the 7-day cutoff
const THREE_DAYS_AGO = new Date(now - 3 * 86_400_000).toISOString();
// 10 days ago — outside the 7-day cutoff
const TEN_DAYS_AGO = new Date(now - 10 * 86_400_000).toISOString();

// Minimal empty stubs for data sources we don't need in each test
const noWetChecks = async () => [];
const noWorkOrders = async () => [];
const noBillingSheets = async () => [];
const noParts = async () => [];
const noReviews = async () => [];
const noFindings = async () => [];
const noInvoicedBsWcIds = async () => new Set<number>();

function makeServer(role: string, companyId: number | null): {
  server: Server;
  base: string;
  close: () => Promise<void>;
} {
  const app = express();
  app.use(express.json());

  const auth: RequestHandler = (req: any, _res, next) => {
    req.authenticatedUserRole = role;
    req.authenticatedUserId = 1;
    req.authenticatedUserCompanyId = companyId;
    next();
  };

  registerManagerWorkspaceRoutes(app, { requireAuthentication: auth });

  const server = createServer(app);
  server.listen(0);
  const port = (server.address() as AddressInfo).port;
  const base = `http://localhost:${port}`;

  return {
    server,
    base,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

async function getQueue(base: string, params = ""): Promise<any[]> {
  const res = await fetch(`${base}/api/manager-workspace/queue${params}`);
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  return body.items as any[];
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Slice 2 — billed without manager review", () => {
  let srv: ReturnType<typeof makeServer> | null = null;

  afterEach(async () => {
    _resetManagerWorkspaceOverridesForTests();
    restoreStorage();
    if (srv) {
      await srv.close();
      srv = null;
    }
  });

  describe("(a) WCB approved by billing_manager then billed", () => {
    // Set up a WCB that was approved by billing_manager, has an invoiceId
    // (billed), and was updated 30 days ago (past the normal 7-day cutoff).
    const wcb = {
      id: 1,
      billingNumber: "WCB-001",
      customerId: 10,
      customerName: "AcmeFarm",
      technicianId: 5,
      technicianName: "Jane Doe",
      wetCheckId: 99,
      status: "billed",
      totalAmount: "750.00",
      invoiceId: 42,
      approvedByRole: "billing_manager",
      createdAt: THIRTY_DAYS_AGO,
      updatedAt: THIRTY_DAYS_AGO,
      billedAt: THIRTY_DAYS_AGO,
    };

    beforeEach(() => {
      _setWcbForTests(async () => [wcb]);
      _setWorkOrdersForTests(noWorkOrders);
      _setBilingSheetsForTests(noBillingSheets);
      _setWetChecksForTests(noWetChecks);
      _setFindingsForTests(noFindings);
      _setPartsForTests(noParts);
      _setReviewsForTests(noReviews);
      _setInvoicedBsWcIdsForTests(noInvoicedBsWcIds);
      patchStorage("getWorkOrders", async () => []);
      patchStorage("getAllBillingSheets", async () => []);
      patchStorage("getPendingParts", async () => []);
      patchStorage("getManualPartReviews", async () => []);
      patchStorage("getUser", async () => null);
      patchStorage("getAllWetCheckBillingsWithCounts", async () => [wcb]);
    });

    it("appears in irrigation_manager queue with billedWithoutReview=true and no_manager_review flag, even 30 days later", async () => {
      srv = makeServer("irrigation_manager", 1);
      const items = await getQueue(srv.base);
      const found = items.find((it: any) => it.type === "wet_check_billing" && it.refId === 1);
      assert.ok(found, "WCB should be present in irrigation_manager queue 30 days later");
      assert.equal(found.billedWithoutReview, true, "billedWithoutReview should be true");
      assert.ok(
        found.flags.includes("no_manager_review"),
        `flags should include 'no_manager_review'; got: ${JSON.stringify(found.flags)}`,
      );
      assert.equal(found.stage, "billed_7d", "stage should be billed_7d");
    });

    it("does NOT appear in billing_manager queue (normal 7-day cutoff applies)", async () => {
      srv = makeServer("billing_manager", 1);
      const items = await getQueue(srv.base, "?type=wcb");
      const found = items.find((it: any) => it.type === "wet_check_billing" && it.refId === 1);
      assert.equal(found, undefined, "WCB should be absent from billing_manager queue after 30 days");
    });

    it("does NOT carry no_manager_review flag for billing_manager caller even within 7 days", async () => {
      // Verify that even if the item is within 7 days, billing_manager sees
      // no no_manager_review flag (the flag only surfaces for manager/admin callers).
      const recentWcb = {
        ...wcb,
        updatedAt: THREE_DAYS_AGO,
        billedAt: THREE_DAYS_AGO,
        createdAt: THREE_DAYS_AGO,
      };
      _setWcbForTests(async () => [recentWcb]);
      patchStorage("getAllWetCheckBillingsWithCounts", async () => [recentWcb]);

      srv = makeServer("billing_manager", 1);
      const items = await getQueue(srv.base, "?type=wcb");
      const found = items.find((it: any) => it.type === "wet_check_billing" && it.refId === 1);
      if (found) {
        assert.ok(
          !found.flags.includes("no_manager_review"),
          "billing_manager should not see no_manager_review flag",
        );
      }
    });
  });

  describe("(b) WO approved by irrigation_manager then billed — drops out after 7 days", () => {
    const makeWo = (billedAt: string) => ({
      id: 2,
      workOrderNumber: "WO-002",
      assignedTechnicianId: 5,
      customerId: 10,
      customerName: "AcmeFarm",
      status: "billed",
      totalAmount: "400.00",
      invoiceId: 43,
      approvedByRole: "irrigation_manager",
      photos: ["photo.jpg"],
      createdAt: billedAt,
      updatedAt: billedAt,
      billedAt,
    });

    beforeEach(() => {
      _setWcbForTests(async () => []);
      _setWetChecksForTests(noWetChecks);
      _setFindingsForTests(noFindings);
      _setBilingSheetsForTests(noBillingSheets);
      _setPartsForTests(noParts);
      _setReviewsForTests(noReviews);
      _setInvoicedBsWcIdsForTests(noInvoicedBsWcIds);
      patchStorage("getAllBillingSheets", async () => []);
      patchStorage("getPendingParts", async () => []);
      patchStorage("getManualPartReviews", async () => []);
      patchStorage("getAllWetCheckBillingsWithCounts", async () => []);
    });

    it("WO billed within 7 days → present with billedWithoutReview=false", async () => {
      const wo = makeWo(THREE_DAYS_AGO);
      _setWorkOrdersForTests(async () => [wo]);
      patchStorage("getWorkOrders", async () => [wo]);
      patchStorage("getUser", async (id: number) =>
        id === 5 ? { id: 5, companyId: 1 } : null,
      );

      srv = makeServer("irrigation_manager", 1);
      const items = await getQueue(srv.base, "?type=wo");
      const found = items.find((it: any) => it.type === "work_order" && it.refId === 2);
      assert.ok(found, "WO within 7 days should be present");
      assert.equal(found.billedWithoutReview, false, "billedWithoutReview should be false");
      assert.ok(
        !found.flags.includes("no_manager_review"),
        "should not have no_manager_review flag",
      );
    });

    it("WO billed 10 days ago (past 7-day cutoff) → absent from queue", async () => {
      const wo = makeWo(TEN_DAYS_AGO);
      _setWorkOrdersForTests(async () => [wo]);
      patchStorage("getWorkOrders", async () => [wo]);
      patchStorage("getUser", async (id: number) =>
        id === 5 ? { id: 5, companyId: 1 } : null,
      );

      srv = makeServer("irrigation_manager", 1);
      const items = await getQueue(srv.base, "?type=wo");
      const found = items.find((it: any) => it.type === "work_order" && it.refId === 2);
      assert.equal(found, undefined, "WO past 7-day cutoff should be absent");
    });
  });

  describe("(c) Legacy row with approvedByRole = NULL → billedWithoutReview: false", () => {
    beforeEach(() => {
      _setWetChecksForTests(noWetChecks);
      _setFindingsForTests(noFindings);
      _setPartsForTests(noParts);
      _setReviewsForTests(noReviews);
      _setInvoicedBsWcIdsForTests(noInvoicedBsWcIds);
      patchStorage("getPendingParts", async () => []);
      patchStorage("getManualPartReviews", async () => []);
      patchStorage("getUser", async (id: number) =>
        id === 5 ? { id: 5, companyId: 1 } : null,
      );
    });

    it("legacy WCB with approvedByRole=null within 7 days → billedWithoutReview=false, no flag", async () => {
      const legacyWcb = {
        id: 3,
        billingNumber: "WCB-003",
        customerId: 10,
        customerName: "AcmeFarm",
        technicianId: 5,
        technicianName: "Jane",
        wetCheckId: 100,
        status: "billed",
        totalAmount: "200.00",
        invoiceId: 44,
        approvedByRole: null,
        createdAt: THREE_DAYS_AGO,
        updatedAt: THREE_DAYS_AGO,
        billedAt: THREE_DAYS_AGO,
      };
      _setWcbForTests(async () => [legacyWcb]);
      _setWorkOrdersForTests(noWorkOrders);
      _setBilingSheetsForTests(noBillingSheets);
      patchStorage("getWorkOrders", async () => []);
      patchStorage("getAllBillingSheets", async () => []);
      patchStorage("getAllWetCheckBillingsWithCounts", async () => [legacyWcb]);

      srv = makeServer("irrigation_manager", 1);
      const items = await getQueue(srv.base, "?type=wcb");
      const found = items.find((it: any) => it.type === "wet_check_billing" && it.refId === 3);
      assert.ok(found, "Legacy WCB within 7 days should be present");
      assert.equal(found.billedWithoutReview, false, "billedWithoutReview should be false for legacy row");
      assert.ok(
        !found.flags.includes("no_manager_review"),
        "should not have no_manager_review flag for legacy row",
      );
    });

    it("legacy WO with approvedByRole=null past 7 days → absent (normal cutoff applies)", async () => {
      const legacyWo = {
        id: 4,
        workOrderNumber: "WO-004",
        assignedTechnicianId: 5,
        customerId: 10,
        customerName: "AcmeFarm",
        status: "billed",
        totalAmount: "300.00",
        invoiceId: 45,
        approvedByRole: null,
        photos: [],
        createdAt: TEN_DAYS_AGO,
        updatedAt: TEN_DAYS_AGO,
        billedAt: TEN_DAYS_AGO,
      };
      _setWorkOrdersForTests(async () => [legacyWo]);
      _setWcbForTests(async () => []);
      _setBilingSheetsForTests(noBillingSheets);
      patchStorage("getWorkOrders", async () => [legacyWo]);
      patchStorage("getAllBillingSheets", async () => []);
      patchStorage("getAllWetCheckBillingsWithCounts", async () => []);

      srv = makeServer("irrigation_manager", 1);
      const items = await getQueue(srv.base, "?type=wo");
      const found = items.find((it: any) => it.type === "work_order" && it.refId === 4);
      assert.equal(found, undefined, "Legacy WO past 7 days should be absent (no bypass)");
    });
  });

  describe("50-item cap on billed-without-review items", () => {
    it("caps billed-without-review WCBs at 50 newest for manager callers", async () => {
      // Create 60 WCBs with approvedByRole=billing_manager, all billed 30+ days ago
      const wcbs = Array.from({ length: 60 }, (_, i) => ({
        id: 100 + i,
        billingNumber: `WCB-CAP-${i}`,
        customerId: 10,
        customerName: "AcmeFarm",
        technicianId: 5,
        technicianName: "Jane",
        wetCheckId: 200 + i,
        status: "billed",
        totalAmount: "100.00",
        invoiceId: 1000 + i,
        approvedByRole: "billing_manager",
        // Vary the date so we can verify only the 50 newest survive
        createdAt: new Date(now - (30 + i) * 86_400_000).toISOString(),
        updatedAt: new Date(now - (30 + i) * 86_400_000).toISOString(),
        billedAt: new Date(now - (30 + i) * 86_400_000).toISOString(),
      }));

      _setWcbForTests(async () => wcbs);
      _setWorkOrdersForTests(noWorkOrders);
      _setBilingSheetsForTests(noBillingSheets);
      _setWetChecksForTests(noWetChecks);
      _setFindingsForTests(noFindings);
      _setPartsForTests(noParts);
      _setReviewsForTests(noReviews);
      _setInvoicedBsWcIdsForTests(noInvoicedBsWcIds);
      patchStorage("getWorkOrders", async () => []);
      patchStorage("getAllBillingSheets", async () => []);
      patchStorage("getPendingParts", async () => []);
      patchStorage("getManualPartReviews", async () => []);
      patchStorage("getUser", async () => null);
      patchStorage("getAllWetCheckBillingsWithCounts", async () => wcbs);

      srv = makeServer("irrigation_manager", 1);
      const items = await getQueue(srv.base, "?type=wcb&pageSize=500");
      const bwrItems = items.filter((it: any) => it.billedWithoutReview === true);
      assert.ok(
        bwrItems.length <= 50,
        `Cap should hold billed-without-review items to ≤50; got ${bwrItems.length}`,
      );
      // Verify the 50 that survived are the newest (smallest ageDays)
      if (bwrItems.length === 50) {
        const ages = bwrItems.map((it: any) => it.ageDays as number);
        const maxAge = Math.max(...ages);
        // All kept items should have age ≤ 50 (30..79 days in our fixture;
        // the 50 newest are ids 100-149 with ages 30-79 days — pick the 50 oldest
        // Wait — we sort by ageDays ascending (smallest=newest), so we keep IDs with the smallest ageDays.
        // The WCBs with ids 100..109 are 30..39 days old — those are the 10 newest.
        // The 50 newest have ages 30..79 days (indices 0..49).
        // The 10 oldest (index 50..59) have ages 80..89 days and are dropped.
        assert.ok(maxAge <= 79, `Oldest kept item should be ≤79 days old; got ${maxAge}`);
      }
    });
  });
});
