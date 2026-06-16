// Task #1293 — POST /api/wet-checks/:id/reassign-customer handler tests.
//
// Tests call the REAL registerWetCheckReconciliationRoutes handler via
// injectable stub queries, so production logic is always under test.
// Covers:
//  1. Single non-invoiced WCB moves — wet check + WCB fields updated, companyId corrected.
//  2. Two non-invoiced WCBs both move.
//  3. WCB with invoiceId is skipped; moveable WCB is still moved.
//  4. Wet check with a derived work order: move proceeds, warning returned.
//  5. After valid reassign the target customer's billing scope includes the snapshot.
//  6. Security: non-super with missing company context is rejected (400) before any DB access.
//  7. Security: non-super cannot reassign a wet check that belongs to another company.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express, { type Express } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  registerWetCheckReconciliationRoutes,
  type WcReconciliationQueries,
  type WcRow,
  type WcbRow,
  type CustomerRow,
  type FindingRow,
  type ReassignParams,
} from "./wet-check-reconciliation-routes";

// ── Stub query builder ────────────────────────────────────────────────────────

interface MutableWcbRow extends WcbRow {
  customerId?: number;
  customerName?: string;
  propertyAddress?: string;
  branchName?: string | null;
}

interface StubState {
  wetCheck: WcRow | null;
  wcbs: MutableWcbRow[];
  customer: CustomerRow | null;
  findings: FindingRow[];
  // Capture what executeReassign was called with.
  reassignCalls: ReassignParams[];
}

function buildStubQueries(state: StubState): WcReconciliationQueries {
  return {
    async getUnbilledSnapshots() { return []; },
    async getWetCheck(id) {
      return state.wetCheck?.id === id ? state.wetCheck : null;
    },
    async getWcbs(wetCheckId) {
      return state.wcbs.filter((w) => w.wetCheckId === wetCheckId);
    },
    async getCustomer(id) {
      return state.customer?.id === id ? state.customer : null;
    },
    async getFindingsWithRouting() {
      return state.findings.filter((f) => f.workOrderId != null || f.estimateId != null);
    },
    async executeReassign(params) {
      state.reassignCalls.push(params);
      // Mirror what the real transaction does so post-reassign checks work.
      for (const w of state.wcbs) {
        if (params.moveableIds.includes(w.id)) {
          w.customerId = params.targetCustomerId;
          w.customerName = params.targetCustomerName;
          w.propertyAddress = params.targetAddress;
          w.branchName = params.targetBranchName;
        }
      }
    },
  };
}

// ── Express harness ───────────────────────────────────────────────────────────

interface Harness {
  baseUrl: string;
  close: () => Promise<void>;
  state: StubState;
}

interface HarnessOptions {
  role?: string;
  companyId?: number | null;
}

async function startServer(opts: HarnessOptions = {}): Promise<Harness> {
  const app: Express = express();
  app.use(express.json());

  const state: StubState = {
    wetCheck: null,
    wcbs: [],
    customer: null,
    findings: [],
    reassignCalls: [],
  };

  // Auth middleware stub — allows callers to control role and companyId.
  const noopAuth = (req: any, _res: any, next: any) => {
    req.authenticatedUserId = 1;
    req.authenticatedUserRole = opts.role ?? "company_admin";
    req.authenticatedUserCompanyId = "companyId" in opts ? opts.companyId : 10;
    req.log = { warn: () => {}, error: () => {} };
    next();
  };

  registerWetCheckReconciliationRoutes(app, {
    requireAuthentication: noopAuth,
    queries: buildStubQueries(state),
  });

  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    state,
  };
}

function post(baseUrl: string, path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/wet-checks/:id/reassign-customer — Task #1293", () => {

  it("1. single non-invoiced snapshot moves — companyId corrected to target", async () => {
    const h = await startServer();
    try {
      h.state.wetCheck = {
        id: 1, companyId: 10, customerId: 100,
        customerName: "Old Customer", propertyAddress: "123 Old St", status: "submitted",
      };
      h.state.wcbs = [{
        id: 200, wetCheckId: 1, billingNumber: "WCB-001",
        status: "submitted", invoiceId: null,
      }];
      h.state.customer = {
        id: 999, companyId: 10, name: "New Customer",
        address: "456 New Ave", hiddenFromBilling: false,
      };

      const res = await post(h.baseUrl, "/api/wet-checks/1/reassign-customer", {
        customerId: 999, branchName: "North Branch",
      });
      assert.equal(res.status, 200);
      const body = await res.json() as any;

      assert.deepEqual(body.moved, [200]);
      assert.equal(body.skipped.length, 0);
      assert.equal(body.warnings, null);
      assert.equal(body.targetCustomer.name, "New Customer");
      assert.equal(body.targetCustomer.companyId, 10);

      // executeReassign was called with correct params.
      assert.equal(h.state.reassignCalls.length, 1);
      assert.equal(h.state.reassignCalls[0].targetCustomerId, 999);
      assert.equal(h.state.reassignCalls[0].targetCompanyId, 10);
      assert.equal(h.state.reassignCalls[0].targetBranchName, "North Branch");
      assert.deepEqual(h.state.reassignCalls[0].moveableIds, [200]);
    } finally {
      await h.close();
    }
  });

  it("2. two non-invoiced snapshots both move", async () => {
    const h = await startServer();
    try {
      h.state.wetCheck = {
        id: 2, companyId: 10, customerId: 100,
        customerName: "Old Customer", propertyAddress: "Old St", status: "submitted",
      };
      h.state.wcbs = [
        { id: 201, wetCheckId: 2, billingNumber: "WCB-201", status: "submitted", invoiceId: null },
        { id: 202, wetCheckId: 2, billingNumber: "WCB-202", status: "pending_manager_review", invoiceId: null },
      ];
      h.state.customer = {
        id: 888, companyId: 10, name: "Target Customer",
        address: "789 Target Rd", hiddenFromBilling: false,
      };

      const res = await post(h.baseUrl, "/api/wet-checks/2/reassign-customer", { customerId: 888 });
      assert.equal(res.status, 200);
      const body = await res.json() as any;

      assert.deepEqual(body.moved.sort(), [201, 202].sort());
      assert.equal(body.skipped.length, 0);

      // Both ids passed to executeReassign.
      assert.deepEqual(h.state.reassignCalls[0].moveableIds.sort(), [201, 202].sort());
    } finally {
      await h.close();
    }
  });

  it("3. invoiced snapshot is skipped; moveable snapshot is still moved", async () => {
    const h = await startServer();
    try {
      h.state.wetCheck = {
        id: 3, companyId: 10, customerId: 100,
        customerName: "Old Customer", propertyAddress: "Old St", status: "submitted",
      };
      h.state.wcbs = [
        { id: 301, wetCheckId: 3, billingNumber: "WCB-301", status: "billed", invoiceId: 5000 },
        { id: 302, wetCheckId: 3, billingNumber: "WCB-302", status: "submitted", invoiceId: null },
      ];
      h.state.customer = {
        id: 777, companyId: 10, name: "Good Target",
        address: "99 Target St", hiddenFromBilling: false,
      };

      const res = await post(h.baseUrl, "/api/wet-checks/3/reassign-customer", { customerId: 777 });
      assert.equal(res.status, 200);
      const body = await res.json() as any;

      assert.deepEqual(body.moved, [302]);
      assert.equal(body.skipped.length, 1);
      assert.equal(body.skipped[0].id, 301);
      assert.equal(body.skipped[0].billingNumber, "WCB-301");
      assert.equal(body.skipped[0].reason, "invoiced");

      // executeReassign only got the moveable id.
      assert.deepEqual(h.state.reassignCalls[0].moveableIds, [302]);
    } finally {
      await h.close();
    }
  });

  it("4. wet check with derived work order: move proceeds, warning returned", async () => {
    const h = await startServer();
    try {
      h.state.wetCheck = {
        id: 4, companyId: 10, customerId: 100,
        customerName: "Old Customer", propertyAddress: "Old St", status: "partially_converted",
      };
      h.state.wcbs = [
        { id: 401, wetCheckId: 4, billingNumber: "WCB-401", status: "submitted", invoiceId: null },
      ];
      h.state.customer = {
        id: 666, companyId: 10, name: "Target with WO",
        address: "1 WO Blvd", hiddenFromBilling: false,
      };
      // Findings: one routed to a work order, one not routed.
      h.state.findings = [
        { id: 50, workOrderId: 9001, estimateId: null },
        { id: 51, workOrderId: null, estimateId: null },
      ];

      const res = await post(h.baseUrl, "/api/wet-checks/4/reassign-customer", { customerId: 666 });
      assert.equal(res.status, 200);
      const body = await res.json() as any;

      assert.deepEqual(body.moved, [401]);
      assert.ok(body.warnings, "should have warnings");
      assert.deepEqual(body.warnings.derivedWorkOrderIds, [9001]);
      assert.deepEqual(body.warnings.derivedEstimateIds, []);
      assert.match(body.warnings.message, /work orders/i);

      // The WO id is only a warning, not in moved.
      assert.ok(!(body.moved as number[]).includes(9001));
    } finally {
      await h.close();
    }
  });

  it("5. after valid reassign target customer billing scope includes the snapshot", async () => {
    const h = await startServer();
    try {
      h.state.wetCheck = {
        id: 5, companyId: 10, customerId: 100,
        customerName: "Old Customer", propertyAddress: "Old Address", status: "submitted",
      };
      h.state.wcbs = [
        { id: 501, wetCheckId: 5, billingNumber: "WCB-501", status: "submitted", invoiceId: null },
      ];
      h.state.customer = {
        id: 555, companyId: 10, name: "New Target",
        address: "New Address", hiddenFromBilling: false,
      };

      const res = await post(h.baseUrl, "/api/wet-checks/5/reassign-customer", { customerId: 555 });
      assert.equal(res.status, 200);

      // executeReassign ran — stub mutated the WCB's customerId.
      const wcbsForTarget = h.state.wcbs.filter((w) => w.customerId === 555);
      assert.equal(wcbsForTarget.length, 1);
      assert.equal(wcbsForTarget[0].id, 501);

      const wcbsForOld = h.state.wcbs.filter((w) => (w.customerId ?? 100) === 100);
      assert.equal(wcbsForOld.length, 0, "old customer should have no snapshots after move");
    } finally {
      await h.close();
    }
  });

  it("6. security: non-super with missing company context is rejected before any DB access", async () => {
    // companyId: null simulates a request with no company context header.
    const h = await startServer({ role: "company_admin", companyId: null });
    try {
      // Populate DB so we know a 400 isn't from "not found".
      h.state.wetCheck = {
        id: 1, companyId: 10, customerId: 100,
        customerName: "Old", propertyAddress: null, status: "submitted",
      };
      h.state.wcbs = [
        { id: 200, wetCheckId: 1, billingNumber: "WCB-001", status: "submitted", invoiceId: null },
      ];
      h.state.customer = {
        id: 999, companyId: 10, name: "New", address: null, hiddenFromBilling: false,
      };

      const res = await post(h.baseUrl, "/api/wet-checks/1/reassign-customer", { customerId: 999 });
      assert.equal(res.status, 400);
      const body = await res.json() as any;
      assert.match(body.message, /company context/i);

      // executeReassign must NOT have been called.
      assert.equal(h.state.reassignCalls.length, 0);
    } finally {
      await h.close();
    }
  });

  it("7. security: non-super cannot reassign a wet check from another company", async () => {
    // Caller is company 10, wet check belongs to company 20.
    const h = await startServer({ role: "company_admin", companyId: 10 });
    try {
      h.state.wetCheck = {
        id: 1, companyId: 20, customerId: 200,
        customerName: "Other Company Customer", propertyAddress: null, status: "submitted",
      };
      h.state.wcbs = [
        { id: 200, wetCheckId: 1, billingNumber: "WCB-001", status: "submitted", invoiceId: null },
      ];
      h.state.customer = {
        id: 999, companyId: 10, name: "Caller's Customer", address: null, hiddenFromBilling: false,
      };

      const res = await post(h.baseUrl, "/api/wet-checks/1/reassign-customer", { customerId: 999 });
      assert.equal(res.status, 403);
      const body = await res.json() as any;
      assert.match(body.message, /forbidden/i);

      // executeReassign must NOT have been called.
      assert.equal(h.state.reassignCalls.length, 0);
    } finally {
      await h.close();
    }
  });
});
