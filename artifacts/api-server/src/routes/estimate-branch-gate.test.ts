// Task #2010 — regression guard for the estimate branch gate.
//
// The estimate builder was the only ticket-creation flow that never
// captured a branch. `estimates.branch_name` shipped long ago and the
// downstream already reads it (the PDF renders a `Branch:` line, the
// estimate → work-order conversion carries it), but nothing ever wrote
// it — so a repair estimate for a customer's north branch approved into
// a work order with no branch and billed to the parent.
//
// Two gates close that, and this file covers both:
//
//   1. The WRITE gate — POST /api/estimates, PUT /api/estimates/:id and
//      POST /api/estimates/:id/submit-for-review refuse a multi-branch
//      customer with no branch, with the in-wizard wording.
//   2. The SEND/APPROVE gate — a write gate alone is not enough, because
//      an estimate does not have to be saved to leave. Seven other
//      authenticated routes send it to the customer or push it into a
//      work order; a legacy branch-less row could be approved straight
//      out of the queue by a manager who never opened the wizard. All
//      seven now carry the guard, with the open-the-estimate wording.
//
// Plus the customer-token tripwire: a customer approving an already-sent
// branch-less estimate is NEVER refused (they cannot supply a branch, and
// blocking them over an internal field is not acceptable) — instead the
// assigned irrigation manager is notified and an audit event is recorded.
//
// The helper and the middleware are imported from the same modules the
// production routes import, so any drift between this file and the real
// code is a compile error rather than a silently passing test.

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import express, { type Express, type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// ── Real production exports — the same code the routes run ────────────────
import {
  registerEstimateRoutes,
  type EstimateRoutesStorage,
} from "./estimate-routes";
import { requireEstimateBranchForSend } from "./estimate-role-guards";
import {
  checkEstimateBranchGate,
  ESTIMATE_BRANCH_REQUIRED_IN_WIZARD_MESSAGE,
  ESTIMATE_BRANCH_REQUIRED_OPEN_ESTIMATE_MESSAGE,
  processEstimatePayload,
} from "../estimate-payload";
import type { AuditEventInput } from "./audit-log";
import { db } from "../db";
import type {
  Customer,
  EstimateWithItems,
  InsertEstimate,
  InsertEstimateItem,
  InsertNotification,
  Notification,
  User,
  WorkOrder,
} from "@workspace/db";

// ─── Unit tests on the one shared helper ─────────────────────────────────────
//
// There is exactly one branch-gate helper on the estimate paths, with two
// message variants. It is called by the three write paths and by the new
// middleware — no second copy of the logic anywhere.

describe("checkEstimateBranchGate — one helper, two message variants", () => {
  it("allows a single-location customer regardless of branch value", () => {
    assert.equal(checkEstimateBranchGate([], null, "in_wizard"), null);
    assert.equal(checkEstimateBranchGate([], "", "open_estimate"), null);
    assert.equal(checkEstimateBranchGate(null, null, "in_wizard"), null);
    assert.equal(checkEstimateBranchGate(undefined, null, "open_estimate"), null);
  });

  it("allows a multi-branch customer once a branch is supplied", () => {
    assert.equal(
      checkEstimateBranchGate(["North", "South"], "North", "in_wizard"),
      null,
    );
    assert.equal(
      checkEstimateBranchGate(["North", "South"], "South", "open_estimate"),
      null,
    );
  });

  it("treats an empty or whitespace-only branch as absent", () => {
    assert.equal(
      checkEstimateBranchGate(["North"], "", "in_wizard"),
      ESTIMATE_BRANCH_REQUIRED_IN_WIZARD_MESSAGE,
    );
    assert.equal(
      checkEstimateBranchGate(["North"], "   ", "in_wizard"),
      ESTIMATE_BRANCH_REQUIRED_IN_WIZARD_MESSAGE,
    );
  });

  it("returns the in-wizard wording for the write paths, verbatim from the billing sheet creator", () => {
    assert.equal(
      checkEstimateBranchGate(["North"], null, "in_wizard"),
      "Branch is required for this customer. Please select a branch before submitting.",
    );
  });

  it("returns the open-the-estimate wording for the send/approve paths", () => {
    // The user is on a list or detail modal here — the fix is elsewhere,
    // so the message has to say where to go.
    const msg = checkEstimateBranchGate(["North"], null, "open_estimate");
    assert.equal(msg, ESTIMATE_BRANCH_REQUIRED_OPEN_ESTIMATE_MESSAGE);
    assert.ok(
      /open the estimate/i.test(msg!),
      `expected the message to point at the estimate wizard, got: ${msg}`,
    );
  });

  it("the two variants are actually different strings", () => {
    assert.notEqual(
      ESTIMATE_BRANCH_REQUIRED_IN_WIZARD_MESSAGE,
      ESTIMATE_BRANCH_REQUIRED_OPEN_ESTIMATE_MESSAGE,
    );
  });
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BRANCHES = ["North Campus", "South Campus"];

function makeCustomer(opts: {
  id: number;
  companyId?: number;
  branches: string[] | null;
}): Customer {
  return {
    id: opts.id,
    companyId: opts.companyId ?? 1,
    name: `Customer ${opts.id}`,
    email: "test@example.com",
    phone: null,
    address: null,
    laborRate: "65.00",
    branches: opts.branches,
    isActive: true,
  } as unknown as Customer;
}

function makeEstimate(opts: {
  id: number;
  customerId: number;
  companyId?: number;
  branchName?: string | null;
  status?: string;
  lifecycle?: string;
  internalStatus?: string;
  approvalToken?: string | null;
}): EstimateWithItems {
  return {
    id: opts.id,
    estimateNumber: String(10000 + opts.id),
    customerId: opts.customerId,
    companyId: opts.companyId ?? 1,
    customerName: `Customer ${opts.customerId}`,
    customerEmail: "test@example.com",
    customerPhone: null,
    projectName: "Test Project",
    branchName: opts.branchName ?? null,
    status: opts.status ?? "pending",
    lifecycle: opts.lifecycle ?? "pending_approval",
    internalStatus: opts.internalStatus ?? "pending_approval",
    laborRate: "65.00",
    appliedLaborRate: "65.00",
    laborMode: "flat",
    totalLaborHours: "1.00",
    approvalToken: opts.approvalToken ?? null,
    tokenExpiresAt: null,
    items: [],
  } as unknown as EstimateWithItems;
}

// A minimal valid create/update body. `branchName` is only present when
// explicitly asked for, so the "update omits the field" case is real.
function buildBody(opts: {
  customerId: number;
  branchName?: string | null;
  omitBranch?: boolean;
}) {
  const estimate: Record<string, unknown> = {
    customerId: opts.customerId,
    customerName: `Customer ${opts.customerId}`,
    customerEmail: "test@example.com",
    projectName: "Test Project",
    laborRate: 65,
    laborMode: "flat",
    totalLaborHours: 1,
  };
  if (!opts.omitBranch) estimate.branchName = opts.branchName ?? null;
  return {
    estimate,
    items: [{ partId: 10, partName: "Head", partPrice: 100, quantity: 1 }],
  };
}

// ─── Storage stub ────────────────────────────────────────────────────────────

type StorageStub = EstimateRoutesStorage & {
  customers: Map<number, Customer>;
  estimates: Map<number, EstimateWithItems>;
  notifications: InsertNotification[];
  createdWorkOrders: WorkOrder[];
  assigned: Array<{ workOrderId: number; userId: number }>;
  lastCreatePayload?: { estimate: Record<string, unknown> };
  lastUpdate?: { id: number; estimate: InsertEstimate };
  getCustomerCalls: number[];
};

function makeStorageStub(): StorageStub {
  const stub: StorageStub = {
    customers: new Map(),
    estimates: new Map(),
    notifications: [],
    createdWorkOrders: [],
    assigned: [],
    getCustomerCalls: [],
    async getCustomer(id) {
      stub.getCustomerCalls.push(id);
      return stub.customers.get(id);
    },
    async getEstimate(id) {
      return stub.estimates.get(id);
    },
    async getEstimates() {
      return [...stub.estimates.values()] as never;
    },
    async createEstimateFromPayload(payload) {
      stub.lastCreatePayload = payload as never;
      const { estimate, items } = processEstimatePayload(payload);
      return {
        ...(estimate as InsertEstimate),
        id: 9999,
        estimateNumber: "10099",
        items: items.map((it, i) => ({ ...it, id: i + 1, estimateId: 9999 })),
      } as unknown as EstimateWithItems;
    },
    async updateEstimateWithItems(id, estimate, items: InsertEstimateItem[]) {
      stub.lastUpdate = { id, estimate };
      return {
        ...(estimate as InsertEstimate),
        id,
        estimateNumber: String(10000 + id),
        items,
      } as unknown as EstimateWithItems;
    },
    async updateEstimate(id, updates) {
      const cur = stub.estimates.get(id);
      const next = { ...(cur ?? {}), ...updates, id } as unknown as EstimateWithItems;
      stub.estimates.set(id, next);
      return next as never;
    },
    async internallyApproveEstimateIfPending(id) {
      return stub.estimates.get(id) as never;
    },
    async approveEstimateAndCreateWorkOrder(id) {
      const est = stub.estimates.get(id)!;
      return { estimate: est as never, workOrder: null };
    },
    async markEstimateSentToCustomer(id) {
      return stub.estimates.get(id) as never;
    },
    async createWorkOrderFromEstimate(id) {
      const est = stub.estimates.get(id)!;
      const wo = {
        id: 500 + id,
        workOrderNumber: `WO-${500 + id}`,
        estimateId: id,
        companyId: est.companyId,
        branchName: (est as unknown as { branchName?: string | null }).branchName ?? null,
      } as unknown as WorkOrder;
      stub.createdWorkOrders.push(wo);
      return wo;
    },
    async getIrrigationManagerForCompany() {
      return { id: 77, name: "Irrigation Manager" } as unknown as User;
    },
    async assignWorkOrder(workOrderId, userId) {
      stub.assigned.push({ workOrderId, userId });
      return true;
    },
    async createNotification(payload: InsertNotification) {
      stub.notifications.push(payload);
      return { ...payload, id: stub.notifications.length } as unknown as Notification;
    },
    async getUsers() {
      return [];
    },
    async getUser() {
      return { id: 5, name: "Test User" } as unknown as User;
    },
    async getCompanyProfile() {
      return null;
    },
  };
  return stub;
}

// ─── HTTP harness ────────────────────────────────────────────────────────────

interface Harness {
  baseUrl: string;
  auditEvents: AuditEventInput[];
  close: () => Promise<void>;
}

async function startServer(
  stub: EstimateRoutesStorage,
  opts: { companyId?: number | null; role?: string } = {},
): Promise<Harness> {
  const app: Express = express();
  app.use(express.json({ limit: "5mb" }));
  // Production mounts pino-http app-wide, so every handler — including the
  // unauthenticated customer token route — has req.log. Mirror that here or
  // an error path would blow up on a missing logger instead of being caught.
  app.use((req, _res, next) => {
    (req as unknown as Record<string, unknown>).log = {
      warn() {},
      info() {},
      error() {},
      debug() {},
    };
    next();
  });
  const companyId = opts.companyId !== undefined ? opts.companyId : 1;
  const role = opts.role ?? "company_admin";
  const stubAuth: RequestHandler = (req, _res, next) => {
    const r = req as unknown as Record<string, unknown>;
    r.authenticatedUserId = 5;
    r.authenticatedUserCompanyId = companyId;
    r.authenticatedUserRole = req.header("x-user-role") || role;
    next();
  };
  const auditEvents: AuditEventInput[] = [];
  registerEstimateRoutes(app, stub, stubAuth, {
    recordAuditEvent: async (_req, evt) => {
      auditEvents.push(evt);
    },
  });
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    auditEvents,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { __raw: text };
  }
}

// ─── 1. The write gate ───────────────────────────────────────────────────────

describe("Task #2010 — write gate on the three estimate write paths", () => {
  let stub: StorageStub;
  let h: Harness;

  beforeEach(async () => {
    stub = makeStorageStub();
    stub.customers.set(1, makeCustomer({ id: 1, branches: null }));
    stub.customers.set(2, makeCustomer({ id: 2, branches: BRANCHES }));
    h = await startServer(stub);
  });
  afterEach(async () => {
    await h.close();
  });

  it("POST /api/estimates — 400 with the in-wizard wording when a multi-branch customer has no branch", async () => {
    const res = await fetch(`${h.baseUrl}/api/estimates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 2, branchName: null })),
    });
    assert.equal(res.status, 400);
    assert.equal(
      (await readJson(res)).message,
      ESTIMATE_BRANCH_REQUIRED_IN_WIZARD_MESSAGE,
    );
    assert.equal(stub.lastCreatePayload, undefined, "nothing may reach storage");
  });

  it("POST /api/estimates — succeeds and persists the branch once one is chosen", async () => {
    const res = await fetch(`${h.baseUrl}/api/estimates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 2, branchName: "North Campus" })),
    });
    assert.equal(res.status, 201);
    assert.equal(
      stub.lastCreatePayload!.estimate.branchName,
      "North Campus",
      "the branch must reach storage, not be dropped on the way",
    );
  });

  it("POST /api/estimates — a single-location customer is unaffected and stores NULL, not an empty string", async () => {
    const res = await fetch(`${h.baseUrl}/api/estimates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 1, branchName: null })),
    });
    assert.equal(res.status, 201);
    const persisted = stub.lastCreatePayload!.estimate.branchName;
    assert.equal(persisted, null);
    assert.notEqual(persisted, "");
  });

  it("PUT /api/estimates/:id — an update that OMITS the field on a row that already has a branch succeeds", async () => {
    // The gate is judged against the effective branch: an omitted field
    // keeps whatever is on the row, so a plain content edit of a branched
    // estimate must not be blocked.
    stub.estimates.set(
      31,
      makeEstimate({ id: 31, customerId: 2, branchName: "South Campus" }),
    );
    const res = await fetch(`${h.baseUrl}/api/estimates/31`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 2, omitBranch: true })),
    });
    assert.equal(res.status, 200, await res.text());
    assert.ok(stub.lastUpdate, "the update must have reached storage");
  });

  it("PUT /api/estimates/:id — a legacy branch-less row for a multi-branch customer 400s on its next save", async () => {
    // No grandfather clause by design: the wizard shows the required
    // card the moment it opens, so the fix is one click.
    stub.estimates.set(32, makeEstimate({ id: 32, customerId: 2, branchName: null }));
    const res = await fetch(`${h.baseUrl}/api/estimates/32`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 2, omitBranch: true })),
    });
    assert.equal(res.status, 400);
    assert.equal(
      (await readJson(res)).message,
      ESTIMATE_BRANCH_REQUIRED_IN_WIZARD_MESSAGE,
    );
    assert.equal(stub.lastUpdate, undefined);
  });

  it("PUT /api/estimates/:id — the same legacy row saves once a branch is supplied", async () => {
    stub.estimates.set(33, makeEstimate({ id: 33, customerId: 2, branchName: null }));
    const res = await fetch(`${h.baseUrl}/api/estimates/33`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 2, branchName: "North Campus" })),
    });
    assert.equal(res.status, 200, await res.text());
    assert.equal(
      (stub.lastUpdate!.estimate as unknown as { branchName?: string }).branchName,
      "North Campus",
    );
  });

  it("PUT /api/estimates/:id — a single-location customer is unaffected", async () => {
    stub.estimates.set(34, makeEstimate({ id: 34, customerId: 1, branchName: null }));
    const res = await fetch(`${h.baseUrl}/api/estimates/34`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 1, omitBranch: true })),
    });
    assert.equal(res.status, 200, await res.text());
  });

  it("PUT /api/estimates/:id — the customer it already fetched is reused, not queried twice", async () => {
    stub.estimates.set(
      35,
      makeEstimate({ id: 35, customerId: 1, branchName: null }),
    );
    stub.getCustomerCalls.length = 0;
    // Customer changes from 1 → 2, so the handler loads customer 2 for the
    // labor rate. The branch gate must reuse that record.
    const res = await fetch(`${h.baseUrl}/api/estimates/35`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 2, branchName: "North Campus" })),
    });
    assert.equal(res.status, 200, await res.text());
    assert.deepEqual(
      stub.getCustomerCalls,
      [2],
      "exactly one customer read on the customer-changed path",
    );
  });

  it("POST /api/estimates/:id/submit-for-review — 400 for a branch-less multi-branch customer", async () => {
    stub.estimates.set(
      36,
      makeEstimate({
        id: 36,
        customerId: 2,
        branchName: null,
        lifecycle: "draft",
        internalStatus: "draft",
      }),
    );
    const res = await fetch(`${h.baseUrl}/api/estimates/36/submit-for-review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 2, omitBranch: true })),
    });
    assert.equal(res.status, 400);
    assert.equal(
      (await readJson(res)).message,
      ESTIMATE_BRANCH_REQUIRED_IN_WIZARD_MESSAGE,
    );
  });

  it("POST /api/estimates/:id/submit-for-review — succeeds once a branch is chosen", async () => {
    stub.estimates.set(
      37,
      makeEstimate({
        id: 37,
        customerId: 2,
        branchName: null,
        lifecycle: "draft",
        internalStatus: "draft",
      }),
    );
    const res = await fetch(`${h.baseUrl}/api/estimates/37/submit-for-review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 2, branchName: "South Campus" })),
    });
    assert.notEqual(res.status, 400, await res.text());
  });
});

// ─── 2. The send / approve gate ──────────────────────────────────────────────

// The seven authenticated doors that send an estimate to the customer or
// push it forward into a work order. `mark-sent` is deliberately absent —
// it records that a manual send already happened, and blocking it would
// not stop the send, only make the record wrong.
const GATED_ROUTES: Array<{ method: string; path: (id: number) => string }> = [
  { method: "POST", path: (id) => `/api/estimates/${id}/email` },
  { method: "POST", path: (id) => `/api/estimates/${id}/approve` },
  { method: "PATCH", path: (id) => `/api/estimates/${id}/internal-approve` },
  { method: "PATCH", path: (id) => `/api/estimates/${id}/approve` },
  { method: "POST", path: (id) => `/api/estimates/${id}/send-approval-email` },
  { method: "POST", path: (id) => `/api/estimates/${id}/resend` },
  { method: "POST", path: (id) => `/api/estimates/${id}/convert-to-work-order` },
];

describe("Task #2010 — send/approve gate on all seven authenticated doors", () => {
  let stub: StorageStub;
  let h: Harness;

  beforeEach(async () => {
    stub = makeStorageStub();
    stub.customers.set(1, makeCustomer({ id: 1, branches: null }));
    stub.customers.set(2, makeCustomer({ id: 2, branches: BRANCHES }));
    // 41 — legacy branch-less estimate for a multi-branch customer.
    stub.estimates.set(41, makeEstimate({ id: 41, customerId: 2, branchName: null }));
    // 42 — same customer, branch chosen.
    stub.estimates.set(
      42,
      makeEstimate({ id: 42, customerId: 2, branchName: "North Campus" }),
    );
    // 43 — single-location customer, no branch (and none required).
    stub.estimates.set(43, makeEstimate({ id: 43, customerId: 1, branchName: null }));
    h = await startServer(stub);
  });
  afterEach(async () => {
    await h.close();
  });

  for (const route of GATED_ROUTES) {
    it(`${route.method} ${route.path(0).replace("/0/", "/:id/")} — 400 with the open-the-estimate wording on a branch-less multi-branch estimate`, async () => {
      const res = await fetch(`${h.baseUrl}${route.path(41)}`, {
        method: route.method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 400);
      assert.equal(
        (await readJson(res)).message,
        ESTIMATE_BRANCH_REQUIRED_OPEN_ESTIMATE_MESSAGE,
      );
    });

    it(`${route.method} ${route.path(0).replace("/0/", "/:id/")} — the guard lets the handler run once a branch is set`, async () => {
      const res = await fetch(`${h.baseUrl}${route.path(42)}`, {
        method: route.method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await readJson(res);
      assert.notEqual(
        body.message,
        ESTIMATE_BRANCH_REQUIRED_OPEN_ESTIMATE_MESSAGE,
        `the guard must not fire on a branched estimate (status ${res.status})`,
      );
    });

    it(`${route.method} ${route.path(0).replace("/0/", "/:id/")} — a single-location customer is unaffected`, async () => {
      const res = await fetch(`${h.baseUrl}${route.path(43)}`, {
        method: route.method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await readJson(res);
      assert.notEqual(body.message, ESTIMATE_BRANCH_REQUIRED_OPEN_ESTIMATE_MESSAGE);
    });

    it(`${route.method} ${route.path(0).replace("/0/", "/:id/")} — an unknown estimate id returns the handler's own 404, not the guard's 400`, async () => {
      const res = await fetch(`${h.baseUrl}${route.path(4242)}`, {
        method: route.method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.notEqual(
        res.status,
        400,
        "a missing estimate must fall through to the handler",
      );
      const body = await readJson(res);
      assert.notEqual(body.message, ESTIMATE_BRANCH_REQUIRED_OPEN_ESTIMATE_MESSAGE);
    });
  }

  it("mark-sent is NOT gated — it still succeeds on a branch-less estimate", async () => {
    // It records that a manual send already happened. Gate the doors that
    // cause an estimate to leave, never the ones that record that it left.
    const res = await fetch(`${h.baseUrl}/api/estimates/41/mark-sent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await readJson(res);
    assert.notEqual(res.status, 400);
    assert.notEqual(body.message, ESTIMATE_BRANCH_REQUIRED_OPEN_ESTIMATE_MESSAGE);
  });

  it("a user without approval rights gets 403, never a 400 that would leak the branch state", async () => {
    // Guard ordering is a security property: the branch guard sits AFTER
    // the approval-access guard on every route that carries one.
    for (const route of GATED_ROUTES) {
      if (route.path(0).includes("/resend")) continue; // no approval guard today
      const res = await fetch(`${h.baseUrl}${route.path(41)}`, {
        method: route.method,
        headers: { "content-type": "application/json", "x-user-role": "field_tech" },
        body: JSON.stringify({}),
      });
      assert.equal(
        res.status,
        403,
        `${route.method} ${route.path(41)} must answer 403 before the branch guard runs`,
      );
    }
  });
});

// ─── 3. Tenancy ──────────────────────────────────────────────────────────────

describe("Task #2010 — tenancy: a cross-company estimate is never confirmed by the guard", () => {
  let stub: StorageStub;
  let h: Harness;

  beforeEach(async () => {
    stub = makeStorageStub();
    // The estimate and its customer belong to company 2.
    stub.customers.set(2, makeCustomer({ id: 2, companyId: 2, branches: BRANCHES }));
    stub.estimates.set(
      51,
      makeEstimate({ id: 51, customerId: 2, companyId: 2, branchName: null }),
    );
    // …but the caller is authenticated against company 1.
    h = await startServer(stub, { companyId: 1 });
  });
  afterEach(async () => {
    await h.close();
  });

  for (const route of GATED_ROUTES) {
    it(`${route.method} ${route.path(0).replace("/0/", "/:id/")} — company-A user on a company-B estimate gets 404, never a 400`, async () => {
      const res = await fetch(`${h.baseUrl}${route.path(51)}`, {
        method: route.method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await readJson(res);
      assert.notEqual(
        body.message,
        ESTIMATE_BRANCH_REQUIRED_OPEN_ESTIMATE_MESSAGE,
        "a 400 here would confirm the row exists in another tenant",
      );
      assert.equal(res.status, 404);
    });
  }
});

// The send/approve doors above are only half the tenancy surface. The three
// write paths reach storage through `handleEstimateUpdate` / the create route
// rather than through the middleware, so they need their own proof: without
// it, a company-A caller could rewrite a company-B estimate outright, and the
// branch gate would double as an oracle for a foreign customer's branch list.
describe("Task #2010 — tenancy on the three write paths", () => {
  let stub: StorageStub;
  let h: Harness;

  beforeEach(async () => {
    stub = makeStorageStub();
    // Company 1 — the caller's own tenant.
    stub.customers.set(1, makeCustomer({ id: 1, companyId: 1, branches: BRANCHES }));
    // Company 2 — a foreign tenant, with both a customer and an estimate.
    stub.customers.set(2, makeCustomer({ id: 2, companyId: 2, branches: BRANCHES }));
    stub.estimates.set(
      51,
      makeEstimate({ id: 51, customerId: 2, companyId: 2, branchName: null }),
    );
    stub.estimates.set(
      52,
      makeEstimate({
        id: 52,
        customerId: 2,
        companyId: 2,
        branchName: null,
        internalStatus: "draft",
      }),
    );
    h = await startServer(stub, { companyId: 1 });
  });
  afterEach(async () => {
    await h.close();
  });

  it("PUT /api/estimates/:id — a company-A user cannot update a company-B estimate", async () => {
    const res = await fetch(`${h.baseUrl}/api/estimates/51`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 2, branchName: "North Campus" })),
    });
    assert.equal(res.status, 404, "a cross-tenant update must 404, not succeed");
    assert.equal(stub.lastUpdate, undefined, "no write may reach storage");
  });

  it("PUT /api/estimates/:id — supplying a branch cannot be used to slip past the gate cross-tenant", async () => {
    // The branch gate is satisfied here, so only the ownership check can
    // stop this request. If it 400s or 200s, ownership is not being enforced.
    const res = await fetch(`${h.baseUrl}/api/estimates/51`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 2, branchName: "South Campus" })),
    });
    const body = await readJson(res);
    assert.equal(res.status, 404);
    assert.equal(body.message, "Estimate not found");
  });

  it("POST /api/estimates/:id/submit-for-review — cross-tenant submit is refused with 404", async () => {
    const res = await fetch(`${h.baseUrl}/api/estimates/52/submit-for-review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 2, branchName: "North Campus" })),
    });
    assert.equal(res.status, 404);
    assert.equal(stub.lastUpdate, undefined);
  });

  it("submit-for-review — ownership is checked before the draft-state 409, so states are not distinguishable", async () => {
    // Estimate 51 is company-2 AND not a draft. A caller from company 1 must
    // not be able to tell those two rejection reasons apart.
    const res = await fetch(`${h.baseUrl}/api/estimates/51/submit-for-review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 2, branchName: "North Campus" })),
    });
    assert.equal(res.status, 404, "409 here would leak the row's internal status");
  });

  it("POST /api/estimates — cannot create against another tenant's customer", async () => {
    const res = await fetch(`${h.baseUrl}/api/estimates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 2, branchName: "North Campus" })),
    });
    assert.equal(res.status, 400);
    assert.equal(stub.lastCreatePayload, undefined, "no estimate may be created");
  });

  it("POST /api/estimates — a foreign customer is indistinguishable from a missing one", async () => {
    // Both must answer identically, or the difference reveals that customer 2
    // exists in another tenant (and, via the gate, that it has branches).
    const foreign = await fetch(`${h.baseUrl}/api/estimates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 2, omitBranch: true })),
    });
    const missing = await fetch(`${h.baseUrl}/api/estimates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 4242, omitBranch: true })),
    });
    const foreignBody = await readJson(foreign);
    const missingBody = await readJson(missing);
    assert.equal(foreign.status, missing.status);
    assert.equal(foreignBody.message, "Customer 2 not found");
    assert.equal(missingBody.message, "Customer 4242 not found");
    assert.notEqual(
      foreignBody.message,
      ESTIMATE_BRANCH_REQUIRED_IN_WIZARD_MESSAGE,
      "the branch gate must never speak for a foreign customer",
    );
  });

  it("PUT /api/estimates/:id — an owned estimate cannot be repointed at a foreign customer", async () => {
    stub.estimates.set(
      60,
      makeEstimate({ id: 60, customerId: 1, companyId: 1, branchName: "North Campus" }),
    );
    const res = await fetch(`${h.baseUrl}/api/estimates/60`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 2, branchName: "North Campus" })),
    });
    assert.equal(res.status, 400);
    assert.equal((await readJson(res)).message, "Customer 2 not found");
    assert.equal(stub.lastUpdate, undefined);
  });

  it("a super_admin is not blocked by the ownership checks", async () => {
    const res = await fetch(`${h.baseUrl}/api/estimates/51`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-user-role": "super_admin" },
      body: JSON.stringify(buildBody({ customerId: 2, branchName: "North Campus" })),
    });
    assert.equal(res.status, 200, "super_admin bypasses the cross-company check");
  });

  it("the caller's own tenant still writes normally", async () => {
    stub.estimates.set(
      61,
      makeEstimate({ id: 61, customerId: 1, companyId: 1, branchName: "North Campus" }),
    );
    const res = await fetch(`${h.baseUrl}/api/estimates/61`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 1, branchName: "South Campus" })),
    });
    assert.equal(res.status, 200);
    assert.equal(
      (stub.lastUpdate?.estimate as unknown as { branchName?: string }).branchName,
      "South Campus",
    );
  });
});

// `resend` carries no approval-access guard, so its own role check is the only
// thing standing in front of the branch gate. If that check runs inside the
// handler it runs *after* the middleware, and an unauthorised caller learns
// the estimate's branch state from the 400 they get instead of a 403.
describe("Task #2010 — resend authorises before it evaluates the branch", () => {
  let stub: StorageStub;
  let h: Harness;

  beforeEach(async () => {
    stub = makeStorageStub();
    stub.customers.set(1, makeCustomer({ id: 1, companyId: 1, branches: BRANCHES }));
    stub.estimates.set(
      70,
      makeEstimate({ id: 70, customerId: 1, companyId: 1, branchName: null, lifecycle: "sent" }),
    );
    h = await startServer(stub, { companyId: 1 });
  });
  afterEach(async () => {
    await h.close();
  });

  it("an unauthorised role gets 403, not a branch-state-dependent 400", async () => {
    const res = await fetch(`${h.baseUrl}/api/estimates/70/resend`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-role": "technician" },
      body: JSON.stringify({}),
    });
    const body = await readJson(res);
    assert.equal(res.status, 403);
    assert.notEqual(
      body.message,
      ESTIMATE_BRANCH_REQUIRED_OPEN_ESTIMATE_MESSAGE,
      "the branch gate must not answer an unauthorised caller",
    );
  });

  it("an authorised role still meets the branch gate", async () => {
    const res = await fetch(`${h.baseUrl}/api/estimates/70/resend`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-role": "irrigation_manager" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    assert.equal((await readJson(res)).message, ESTIMATE_BRANCH_REQUIRED_OPEN_ESTIMATE_MESSAGE);
  });

  it("the role set is unchanged — the three previously-allowed roles still pass the guard", async () => {
    // With a branch set, the guard is transparent and each allowed role
    // reaches the handler's own lifecycle logic rather than a 403.
    stub.estimates.set(
      71,
      makeEstimate({
        id: 71,
        customerId: 1,
        companyId: 1,
        branchName: "North Campus",
        lifecycle: "sent",
      }),
    );
    for (const role of ["irrigation_manager", "company_admin", "super_admin"]) {
      const res = await fetch(`${h.baseUrl}/api/estimates/71/resend`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-role": role },
        body: JSON.stringify({}),
      });
      assert.notEqual(res.status, 403, `${role} must still be allowed to resend`);
    }
  });
});

// ─── 4. The middleware in isolation ──────────────────────────────────────────
//
// Mounted directly, so the guard's own contract is pinned independently
// of any handler that sits behind it.

describe("requireEstimateBranchForSend — middleware contract", () => {
  async function run(opts: {
    estimate?: { customerId?: number | null; branchName?: string | null };
    customer?: { branches: unknown } | undefined;
    id?: string;
  }): Promise<{ status: number; body: Record<string, unknown>; nextCalled: boolean }> {
    let nextCalled = false;
    const app: Express = express();
    const guard = requireEstimateBranchForSend({
      async getEstimate() {
        return opts.estimate;
      },
      async getCustomer() {
        return opts.customer;
      },
    });
    app.post("/x/:id", guard, (_req, res) => {
      nextCalled = true;
      res.status(200).json({ ok: true });
    });
    const server = createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/x/${opts.id ?? "1"}`, {
      method: "POST",
    });
    const body = await readJson(res);
    await new Promise<void>((r) => server.close(() => r()));
    return { status: res.status, body, nextCalled };
  }

  it("blocks with 400 and does not call next when the customer has branches and the estimate has none", async () => {
    const r = await run({
      estimate: { customerId: 2, branchName: null },
      customer: { branches: BRANCHES },
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.message, ESTIMATE_BRANCH_REQUIRED_OPEN_ESTIMATE_MESSAGE);
    assert.equal(r.nextCalled, false);
  });

  it("calls next when the estimate has a branch", async () => {
    const r = await run({
      estimate: { customerId: 2, branchName: "North Campus" },
      customer: { branches: BRANCHES },
    });
    assert.equal(r.status, 200);
    assert.equal(r.nextCalled, true);
  });

  it("calls next for a single-location customer", async () => {
    const r = await run({
      estimate: { customerId: 1, branchName: null },
      customer: { branches: [] },
    });
    assert.equal(r.status, 200);
  });

  it("calls next when the estimate is missing, so the handler's own 404 still stands", async () => {
    const r = await run({ estimate: undefined, customer: { branches: BRANCHES } });
    assert.equal(r.status, 200);
    assert.equal(r.nextCalled, true);
  });

  it("calls next for a non-numeric id rather than swallowing the handler's own validation", async () => {
    const r = await run({
      estimate: { customerId: 2, branchName: null },
      customer: { branches: BRANCHES },
      id: "abc",
    });
    assert.equal(r.status, 200);
  });
});

// ─── 5. The customer token tripwire ──────────────────────────────────────────
//
// The customer approval path is NEVER gated. A branch-less estimate
// already sitting in a customer's inbox still approves, still produces a
// work order, and still auto-assigns — but the assigned manager is told
// and the work order carries an audit trail.
//
// The route performs its CAS write through `db` directly, so `db.update`
// is swapped for the duration of these tests. Everything else runs
// through the real handler and the storage stub.

describe("Task #2010 — customer token approval tripwire", () => {
  let stub: StorageStub;
  let h: Harness;
  let origUpdate: typeof db.update;

  function fakeUpdate(estimateId: number) {
    return () => ({
      set: () => ({
        where: () => ({
          returning: async () => [stub.estimates.get(estimateId)],
        }),
      }),
    });
  }

  const SIGNATURE = {
    signatureType: "typed",
    signatureData: "Jane Customer",
    signerName: "Jane Customer",
    consentAccepted: true,
    consentText: "I approve this estimate.",
  };

  beforeEach(async () => {
    stub = makeStorageStub();
    stub.customers.set(1, makeCustomer({ id: 1, branches: null }));
    stub.customers.set(2, makeCustomer({ id: 2, branches: BRANCHES }));
    h = await startServer(stub);
    origUpdate = db.update;
  });
  afterEach(async () => {
    (db as unknown as { update: unknown }).update = origUpdate;
    await h.close();
  });

  it("a branch-less estimate still approves, still creates the work order, and still auto-assigns", async () => {
    stub.estimates.set(
      61,
      makeEstimate({ id: 61, customerId: 2, branchName: null, approvalToken: "tok-61" }),
    );
    (db as unknown as { update: unknown }).update = fakeUpdate(61);

    const res = await fetch(`${h.baseUrl}/api/estimates/approve-via-token/tok-61`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(SIGNATURE),
    });
    assert.equal(res.status, 200, await res.text());
    assert.equal(stub.createdWorkOrders.length, 1, "work order still created");
    assert.deepEqual(stub.assigned, [{ workOrderId: 561, userId: 77 }]);
  });

  it("notifies the assigned irrigation manager with work_order_missing_branch, naming the work order, customer and estimate", async () => {
    stub.estimates.set(
      62,
      makeEstimate({ id: 62, customerId: 2, branchName: null, approvalToken: "tok-62" }),
    );
    (db as unknown as { update: unknown }).update = fakeUpdate(62);

    await fetch(`${h.baseUrl}/api/estimates/approve-via-token/tok-62`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(SIGNATURE),
    });

    const note = stub.notifications.find((n) => n.type === "work_order_missing_branch");
    assert.ok(note, "the tripwire notification must be written");
    assert.equal(note!.userId, 77, "goes to the manager the WO was assigned to");
    const msg = String(note!.message);
    assert.ok(msg.includes("WO-562"), `names the work order: ${msg}`);
    assert.ok(msg.includes("Customer 2"), `names the customer: ${msg}`);
    assert.ok(msg.includes("10062"), `names the estimate: ${msg}`);
    assert.ok(/branch/i.test(msg), `says the branch must be set: ${msg}`);
  });

  it("records a matching audit event against the work order", async () => {
    stub.estimates.set(
      63,
      makeEstimate({ id: 63, customerId: 2, branchName: null, approvalToken: "tok-63" }),
    );
    (db as unknown as { update: unknown }).update = fakeUpdate(63);

    await fetch(`${h.baseUrl}/api/estimates/approve-via-token/tok-63`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(SIGNATURE),
    });

    const evt = h.auditEvents.find((e) => e.action === "work_order.missing_branch");
    assert.ok(evt, "the audit event must be recorded");
    assert.equal(evt!.targetType, "work_order");
    assert.equal(evt!.targetId, "563");
    assert.equal(evt!.severity, "warning");
    assert.equal(
      (evt!.details as Record<string, unknown>).approvalSource,
      "email_link",
    );
  });

  it("an estimate that HAS a branch produces no such notification and no such audit event", async () => {
    stub.estimates.set(
      64,
      makeEstimate({
        id: 64,
        customerId: 2,
        branchName: "North Campus",
        approvalToken: "tok-64",
      }),
    );
    (db as unknown as { update: unknown }).update = fakeUpdate(64);

    await fetch(`${h.baseUrl}/api/estimates/approve-via-token/tok-64`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(SIGNATURE),
    });

    assert.equal(
      stub.notifications.filter((n) => n.type === "work_order_missing_branch").length,
      0,
    );
    assert.equal(
      h.auditEvents.filter((e) => e.action === "work_order.missing_branch").length,
      0,
    );
    assert.equal(stub.createdWorkOrders[0]!.branchName, "North Campus");
  });

  it("a single-location customer produces no tripwire", async () => {
    stub.estimates.set(
      65,
      makeEstimate({ id: 65, customerId: 1, branchName: null, approvalToken: "tok-65" }),
    );
    (db as unknown as { update: unknown }).update = fakeUpdate(65);

    await fetch(`${h.baseUrl}/api/estimates/approve-via-token/tok-65`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(SIGNATURE),
    });

    assert.equal(
      stub.notifications.filter((n) => n.type === "work_order_missing_branch").length,
      0,
    );
  });

  it("a notification failure cannot fail the customer's approval", async () => {
    stub.estimates.set(
      66,
      makeEstimate({ id: 66, customerId: 2, branchName: null, approvalToken: "tok-66" }),
    );
    (db as unknown as { update: unknown }).update = fakeUpdate(66);
    const realCreateNotification = stub.createNotification!;
    stub.createNotification = async (payload) => {
      if (payload.type === "work_order_missing_branch") {
        throw new Error("notification backend down");
      }
      return realCreateNotification(payload);
    };

    const res = await fetch(`${h.baseUrl}/api/estimates/approve-via-token/tok-66`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(SIGNATURE),
    });
    assert.equal(res.status, 200, await res.text());
  });
});
