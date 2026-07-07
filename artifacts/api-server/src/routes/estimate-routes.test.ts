// Route-level regression tests for Task #397/398 — the customer's master
// labor rate is the authoritative source for new estimates and for
// estimates whose customer changes.
//
// These tests mount the *real* registerEstimateRoutes() against a fresh
// Express app with a tiny in-memory storage stub and exercise POST /api/
// estimates and PUT /api/estimates/:id over real HTTP. If the route
// handler ever stops calling resolveCreateLaborRate / resolvePutLaborRate
// (or otherwise skips the override), these tests fail.

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import express, { type Express, type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

import {
  registerEstimateRoutes,
  type EstimateRoutesStorage,
} from "./estimate-routes";
import type { AuditEventInput } from "./audit-log";
import {
  processEstimatePayload,
  type EstimatePayloadInput,
} from "../estimate-payload";
import type {
  Customer,
  Estimate,
  EstimateWithItems,
  InsertEstimate,
  InsertEstimateItem,
  User,
  WorkOrder,
} from "@workspace/db";

// Task #658 — typed shape of a seeded row in the DELETE/list stubs.
// Captures only the fields the DELETE handler reads; carries the same
// soft-delete tombstone columns that real storage stamps so we can
// assert on the GET ?includeDeleted=1 view without `as any` casts.
type SeededEstimate = EstimateWithItems & {
  deletedAt: Date | null;
  deletedBy: number | null;
};

// ─── Storage stub ─────────────────────────────────────────────────────────────
// Captures the InsertEstimate values that the route handed to storage so the
// tests can assert exactly what was about to be persisted.
type StorageStub = EstimateRoutesStorage & {
  customers: Map<number, Customer>;
  estimates: Map<number, EstimateWithItems>;
  lastCreatePayload?: EstimatePayloadInput;
  lastUpdate?: { id: number; estimate: InsertEstimate; items: InsertEstimateItem[] };
};

function makeStorageStub(): StorageStub {
  const stub: StorageStub = {
    customers: new Map(),
    estimates: new Map(),
    async getCustomer(id) {
      return stub.customers.get(id);
    },
    async getEstimate(id) {
      return stub.estimates.get(id);
    },
    async createEstimateFromPayload(payload) {
      stub.lastCreatePayload = payload;
      // Mirror DatabaseStorage.createEstimateFromPayload: it normalises
      // the payload via processEstimatePayload and persists the result.
      // Returning the normalised estimate lets the response body assertions
      // observe what would have been written to the DB.
      const { estimate, items } = processEstimatePayload(payload);
      const stored: EstimateWithItems = {
        ...(estimate as InsertEstimate),
        id: 9999,
        estimateNumber: "EST-TEST",
        items: items.map((it, i) => ({ ...it, id: i + 1, estimateId: 9999 })),
      } as unknown as EstimateWithItems;
      return stored;
    },
    async updateEstimateWithItems(id, estimate, items) {
      stub.lastUpdate = { id, estimate, items };
      const stored: EstimateWithItems = {
        ...(estimate as InsertEstimate),
        id,
        estimateNumber: `EST-${id}`,
        items: items.map((it, i) => ({ ...it, id: i + 1, estimateId: id })),
      } as unknown as EstimateWithItems;
      return stored;
    },
  };
  return stub;
}

function makeCustomer(id: number, laborRate: string | null): Customer {
  return {
    id,
    companyId: 1,
    name: `Customer ${id}`,
    contactName: null,
    email: null,
    phone: null,
    address: null,
    city: null,
    state: null,
    zipCode: null,
    laborRate: laborRate as unknown as string,
    emergencyLaborRate: null,
    notes: null,
    billingNotes: null,
    quickbooksCustomerId: null,
    isActive: true,
    createdAt: new Date(),
  } as unknown as Customer;
}

function makeExistingEstimate(opts: {
  id: number;
  customerId: number;
  laborRate: string;
  appliedLaborRate: string | null;
  laborMode?: "flat" | "per_part";
}): EstimateWithItems {
  return {
    id: opts.id,
    customerId: opts.customerId,
    laborRate: opts.laborRate,
    appliedLaborRate: opts.appliedLaborRate,
    laborMode: opts.laborMode ?? "flat",
    items: [],
  } as unknown as EstimateWithItems;
}

// Two parts at $100 each, 4 flat labor hours. At rate R: parts=200,
// labor=4R, total=200+4R. The route handler will overwrite laborRate
// before processEstimatePayload runs, so this is what we assert against.
function buildBody(opts: {
  customerId?: number | null;
  tamperedLaborRate: string | number;
}) {
  return {
    estimate: {
      customerId: opts.customerId ?? 1,
      customerName: "Test Customer",
      customerEmail: "test@example.com",
      projectName: "Test Project",
      laborRate: opts.tamperedLaborRate,
      laborMode: "flat",
      totalLaborHours: 4,
    },
    items: [
      { partId: 10, partName: "A", partPrice: 100, quantity: 1 },
      { partId: 11, partName: "B", partPrice: 100, quantity: 1 },
    ],
  };
}

// ─── HTTP harness ─────────────────────────────────────────────────────────────
// Mounts a real Express app with the *real* registerEstimateRoutes and a
// stub auth middleware that stamps `authenticatedUserCompanyId` so the
// hardened companyId guard (which rejects null with 400) doesn't block
// all tests. Pass `companyId: null` explicitly to test the rejection path.
async function startServer(
  stub: EstimateRoutesStorage,
  opts: { companyId?: number | null; role?: string } = {},
): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app: Express = express();
  app.use(express.json());
  const companyId = opts.companyId !== undefined ? opts.companyId : 1;
  // Seam 3 — the convert route now requires requireEstimateApprovalAccess,
  // so stubAuth must set a role. Default to "company_admin" so existing
  // tests that never set a role continue to exercise the convert path.
  const role = opts.role ?? "company_admin";
  const stubAuth: RequestHandler = (req, _res, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = req as unknown as Record<string, any>;
    r.authenticatedUserCompanyId = companyId;
    r.authenticatedUserRole = req.header("x-user-role") || role;
    next();
  };
  registerEstimateRoutes(app, stub, stubAuth);
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("POST /api/estimates — customer master labor rate is authoritative", () => {
  let stub: StorageStub;
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    stub = makeStorageStub();
    ({ baseUrl, close } = await startServer(stub));
  });
  afterEach(async () => {
    await close();
  });

  it("overrides a tampered laborRate with the customer's master rate, recomputes laborSubtotal/totalAmount, and persists the master rate", async () => {
    stub.customers.set(42, makeCustomer(42, "85.00"));
    const res = await fetch(`${baseUrl}/api/estimates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 42, tamperedLaborRate: 5 })),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as Record<string, unknown>;

    // Response (= what was about to be persisted) carries the master rate, not the tampered one.
    assert.equal(body.laborRate, "85.00");
    assert.equal(body.appliedLaborRate, "85.00");
    // 4h * $85 = $340; parts = $200; total = $540.
    assert.equal(body.laborSubtotal, "340.00");
    assert.equal(body.partsSubtotal, "200.00");
    assert.equal(body.totalAmount, "540.00");

    // The payload handed to storage was already overridden — proves the
    // route called the override before invoking storage.
    assert.equal(String(stub.lastCreatePayload!.estimate.laborRate), "85.00");
  });

  it("falls back to 45.00 when the customer has no rate on file", async () => {
    stub.customers.set(7, makeCustomer(7, null));
    const res = await fetch(`${baseUrl}/api/estimates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 7, tamperedLaborRate: 999 })),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.laborRate, "45.00");
    assert.equal(body.appliedLaborRate, "45.00");
    // 4h * $45 = $180; total = $380.
    assert.equal(body.laborSubtotal, "180.00");
    assert.equal(body.totalAmount, "380.00");
  });

  // Task #657 — Labor entry is flat-only on the write path. Even if a
  // legacy client sends `laborMode: "per_part"` plus per-row laborHours,
  // the server forces flat: per-row labor is zeroed and the labor
  // subtotal comes from the estimate-level `totalLaborHours` field.
  it("forces flat labor mode and zeroes per-row labor, regardless of incoming laborMode", async () => {
    stub.customers.set(50, makeCustomer(50, "75.00"));
    const body = {
      estimate: {
        customerId: 50,
        customerName: "Q",
        customerEmail: "q@example.com",
        projectName: "P",
        laborRate: 75,
        // Legacy client still sends per_part — server must ignore it.
        laborMode: "per_part",
        totalLaborHours: "3",
      },
      items: [
        { partId: 1, partName: "A", partPrice: 0, quantity: 4, laborHours: 0.5 },
        { partId: 2, partName: "B", partPrice: 0, quantity: 1, laborHours: 1.0 },
      ],
    };
    const res = await fetch(`${baseUrl}/api/estimates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 201);
    const created = (await res.json()) as Record<string, unknown>;
    // 3.0h flat × $75 = $225.00, parts $0.
    assert.equal(created.laborMode, "flat");
    assert.equal(created.totalLaborHours, "3.00");
    assert.equal(created.laborSubtotal, "225.00");
    assert.equal(created.partsSubtotal, "0.00");
    assert.equal(created.totalAmount, "225.00");

    const items = (created.items as Array<Record<string, unknown>>) ?? [];
    assert.equal(items[0]?.laborHours, "0.00");
    assert.equal(items[1]?.laborHours, "0.00");
  });

  it("returns 400 when the referenced customer does not exist", async () => {
    const res = await fetch(`${baseUrl}/api/estimates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 404, tamperedLaborRate: 5 })),
    });
    assert.equal(res.status, 400);
    assert.equal(stub.lastCreatePayload, undefined);
  });
});

describe("PUT /api/estimates/:id — customer master labor rate semantics", () => {
  let stub: StorageStub;
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    stub = makeStorageStub();
    ({ baseUrl, close } = await startServer(stub));
  });
  afterEach(async () => {
    await close();
  });

  it("preserves the originally stamped rate when the customer is unchanged, even if the client sends a different value", async () => {
    stub.estimates.set(
      100,
      makeExistingEstimate({
        id: 100,
        customerId: 42,
        laborRate: "85.00",
        appliedLaborRate: "85.00",
      }),
    );
    const res = await fetch(`${baseUrl}/api/estimates/100`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 42, tamperedLaborRate: 5 })),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;

    assert.equal(body.laborRate, "85.00");
    assert.equal(body.appliedLaborRate, "85.00");
    assert.equal(body.laborSubtotal, "340.00");
    assert.equal(body.totalAmount, "540.00");

    // What was actually written to storage:
    assert.equal(stub.lastUpdate!.id, 100);
    assert.equal(stub.lastUpdate!.estimate.laborRate, "85.00");
    assert.equal(stub.lastUpdate!.estimate.appliedLaborRate, "85.00");
  });

  it("uses the appliedLaborRate snapshot over the bare laborRate when they diverge (legacy records)", async () => {
    stub.estimates.set(
      101,
      makeExistingEstimate({
        id: 101,
        customerId: 42,
        laborRate: "60.00", // would-be drift if we picked the wrong field
        appliedLaborRate: "85.00", // authoritative snapshot
      }),
    );
    const res = await fetch(`${baseUrl}/api/estimates/101`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 42, tamperedLaborRate: 5 })),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.laborRate, "85.00");
    assert.equal(body.appliedLaborRate, "85.00");
  });

  it("replaces the stored rate with the new customer's master rate when the customer is swapped, and recomputes totals", async () => {
    stub.estimates.set(
      102,
      makeExistingEstimate({
        id: 102,
        customerId: 42,
        laborRate: "85.00",
        appliedLaborRate: "85.00",
      }),
    );
    stub.customers.set(99, makeCustomer(99, "120.00"));
    const res = await fetch(`${baseUrl}/api/estimates/102`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 99, tamperedLaborRate: 5 })),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;

    assert.equal(body.laborRate, "120.00");
    assert.equal(body.appliedLaborRate, "120.00");
    // 4h * $120 = $480; total = $680.
    assert.equal(body.laborSubtotal, "480.00");
    assert.equal(body.totalAmount, "680.00");
  });

  it("falls back to 45.00 when the swapped-in customer has no rate on file", async () => {
    stub.estimates.set(
      103,
      makeExistingEstimate({
        id: 103,
        customerId: 42,
        laborRate: "85.00",
        appliedLaborRate: "85.00",
      }),
    );
    stub.customers.set(99, makeCustomer(99, null));
    const res = await fetch(`${baseUrl}/api/estimates/103`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 99, tamperedLaborRate: 5 })),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.laborRate, "45.00");
    assert.equal(body.appliedLaborRate, "45.00");
    assert.equal(body.laborSubtotal, "180.00");
    assert.equal(body.totalAmount, "380.00");
  });

  it("returns 404 when the estimate does not exist", async () => {
    const res = await fetch(`${baseUrl}/api/estimates/999`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 42, tamperedLaborRate: 5 })),
    });
    assert.equal(res.status, 404);
    assert.equal(stub.lastUpdate, undefined);
  });
});

// ─── Task #606 — Atomic submit-for-review ────────────────────────────────────
describe("POST /api/estimates/:id/submit-for-review — atomic draft → pending_approval", () => {
  let stub: StorageStub;
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    stub = makeStorageStub();
    ({ baseUrl, close } = await startServer(stub));
  });
  afterEach(async () => {
    await close();
  });

  function makeDraft(id: number): EstimateWithItems {
    return {
      ...makeExistingEstimate({
        id,
        customerId: 42,
        laborRate: "85.00",
        appliedLaborRate: "85.00",
      }),
      internalStatus: "draft",
    } as unknown as EstimateWithItems;
  }

  it("flips internalStatus to pending_approval and persists the wizard payload in a single call", async () => {
    stub.estimates.set(200, makeDraft(200));
    const res = await fetch(`${baseUrl}/api/estimates/200/submit-for-review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 42, tamperedLaborRate: 5 })),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;

    // Status flipped …
    assert.equal(body.internalStatus, "pending_approval");
    // … alongside the content update (totals recomputed from the
    // stamped rate, not the tampered one).
    assert.equal(body.laborRate, "85.00");
    assert.equal(body.laborSubtotal, "340.00");
    assert.equal(body.totalAmount, "540.00");

    // What was actually handed to storage — single write carrying both
    // the content and the status pin.
    assert.equal(stub.lastUpdate!.id, 200);
    assert.equal(
      (stub.lastUpdate!.estimate as { internalStatus?: string }).internalStatus,
      "pending_approval",
    );
    assert.equal(stub.lastUpdate!.items.length, 2);
  });

  it("rolls back atomically when the storage write fails — no status flip, no content change", async () => {
    stub.estimates.set(201, makeDraft(201));
    const originalUpdate = stub.updateEstimateWithItems.bind(stub);
    stub.updateEstimateWithItems = async () => {
      // Simulates the DB transaction throwing (e.g. constraint
      // violation, connection drop): the route handler must NOT have
      // applied any partial state and must surface a 5xx to the
      // wizard so the user sees a retryable error.
      throw new Error("simulated DB failure");
    };

    const res = await fetch(`${baseUrl}/api/estimates/201/submit-for-review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 42, tamperedLaborRate: 5 })),
    });
    assert.equal(res.status, 500);
    // The seeded estimate is still a draft — no out-of-band status
    // mutation happened on the way to the failed storage write.
    assert.equal(stub.estimates.get(201)!.internalStatus, "draft");

    // Restore the original implementation so afterEach close() works.
    stub.updateEstimateWithItems = originalUpdate;
  });

  it("rejects a non-draft estimate with 409 so the wizard can re-fetch instead of double-flipping", async () => {
    const already = {
      ...makeDraft(202),
      internalStatus: "pending_approval",
    } as unknown as EstimateWithItems;
    stub.estimates.set(202, already);
    const res = await fetch(`${baseUrl}/api/estimates/202/submit-for-review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 42, tamperedLaborRate: 5 })),
    });
    assert.equal(res.status, 409);
    // No write attempted.
    assert.equal(stub.lastUpdate, undefined);
  });

  it("returns 404 when the estimate does not exist", async () => {
    const res = await fetch(`${baseUrl}/api/estimates/9999/submit-for-review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody({ customerId: 42, tamperedLaborRate: 5 })),
    });
    assert.equal(res.status, 404);
    assert.equal(stub.lastUpdate, undefined);
  });
});

// ─── Task #658 — DELETE /api/estimates/:id role × lifecycle matrix ────────────
describe("DELETE /api/estimates/:id — role × lifecycle matrix (Task #658)", () => {
  type DeleteStub = EstimateRoutesStorage & {
    estimates: Map<number, SeededEstimate>;
    softDeleted: number[];
    auditCalls: AuditEventInput[];
  };

  function makeDeleteStub(): DeleteStub {
    const stub: DeleteStub = {
      estimates: new Map(),
      softDeleted: [],
      auditCalls: [],
      async getCustomer() {
        return undefined;
      },
      async getEstimate(id) {
        const row = stub.estimates.get(id);
        // Soft-deleted rows are filtered by the storage layer in
        // production unless `includeDeleted: true` is passed. Mirror
        // that here so the route's post-delete read returns undefined.
        if (!row || row.deletedAt) return undefined;
        return row;
      },
      async getEstimates(opts) {
        const includeDeleted = opts?.includeDeleted ?? false;
        const rows: Estimate[] = [];
        for (const row of stub.estimates.values()) {
          if (!includeDeleted && row.deletedAt) continue;
          rows.push(row as unknown as Estimate);
        }
        return rows;
      },
      async createEstimateFromPayload() {
        throw new Error("not used");
      },
      async updateEstimateWithItems() {
        throw new Error("not used");
      },
      async softDeleteEstimate(id, userId) {
        const row = stub.estimates.get(id);
        if (!row || row.deletedAt) return false;
        // Mirror the production WHERE clause: only the pre-sent
        // internal statuses can be soft-deleted from storage.
        const internal = row.internalStatus;
        if (
          internal !== "draft" &&
          internal !== "pending_approval" &&
          internal !== "approved_internal"
        ) {
          return false;
        }
        stub.softDeleted.push(id);
        row.deletedAt = new Date();
        row.deletedBy = userId;
        return true;
      },
    };
    return stub;
  }

  function seedEstimate(
    stub: DeleteStub,
    id: number,
    fields: { status: string; internalStatus: string },
  ): void {
    const seeded = {
      id,
      companyId: 1,
      customerId: 1,
      estimateNumber: `EST-${id}`,
      status: fields.status,
      internalStatus: fields.internalStatus,
      estimateDate: new Date(),
      items: [],
      deletedAt: null,
      deletedBy: null,
    } as unknown as SeededEstimate;
    stub.estimates.set(id, seeded);
  }

  async function deleteAs(
    baseUrl: string,
    id: number,
    role: string | null,
    userId = 1,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-user-id": String(userId),
      "x-user-company-id": "1",
    };
    if (role) headers["x-user-role"] = role;
    return fetch(`${baseUrl}/api/estimates/${id}`, { method: "DELETE", headers });
  }

  let stub: DeleteStub;
  let baseUrl: string;
  let close: () => Promise<void>;

  // Typed augmentation for the auth-context fields the routes read off
  // `req`. Avoids `req: any` in the header-auth shim while still
  // matching the production header-auth contract.
  type AuthedRequest = import("express").Request & {
    authenticatedUserId?: number;
    authenticatedUserRole?: string;
    authenticatedUserCompanyId?: number | null;
  };

  async function startWithHeaderAuth(s: DeleteStub): Promise<{
    baseUrl: string;
    close: () => Promise<void>;
  }> {
    const app: Express = express();
    app.use(express.json());
    const headerAuth: RequestHandler = (req, _res, next) => {
      const r = req as AuthedRequest;
      r.authenticatedUserId = Number(req.header("x-user-id")) || 0;
      r.authenticatedUserRole = req.header("x-user-role") || undefined;
      r.authenticatedUserCompanyId =
        Number(req.header("x-user-company-id")) || null;
      next();
    };
    registerEstimateRoutes(app, s, headerAuth, {
      // Capture every estimate.deleted audit emission so the
      // "lifecycle in details" test can assert the payload directly
      // instead of round-tripping through DB-backed recordAuditEvent.
      recordAuditEvent: async (_req, evt) => {
        s.auditCalls.push(evt);
      },
    });
    const server: Server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    return {
      baseUrl: `http://127.0.0.1:${port}`,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  beforeEach(async () => {
    stub = makeDeleteStub();
    ({ baseUrl, close } = await startWithHeaderAuth(stub));
  });
  afterEach(async () => {
    await close();
  });

  it("manager roles can delete a pending-review estimate", async () => {
    for (const role of [
      "super_admin",
      "company_admin",
      "irrigation_manager",
      "billing_manager",
    ]) {
      const id = 100 + Math.floor(Math.random() * 100000);
      seedEstimate(stub, id, {
        status: "pending",
        internalStatus: "pending_approval",
      });
      const res = await deleteAs(baseUrl, id, role);
      assert.equal(res.status, 200, `expected 200 deleting pending as ${role}`);
      assert.ok(stub.softDeleted.includes(id), `softDelete called for ${role}`);
    }
  });

  it("field_tech is refused (403) on a pending-review estimate", async () => {
    seedEstimate(stub, 1, {
      status: "pending",
      internalStatus: "pending_approval",
    });
    const res = await deleteAs(baseUrl, 1, "field_tech");
    assert.equal(res.status, 403);
    assert.equal(stub.softDeleted.length, 0);
  });

  it("field_tech can still delete their own draft estimate", async () => {
    seedEstimate(stub, 2, { status: "draft", internalStatus: "draft" });
    const res = await deleteAs(baseUrl, 2, "field_tech");
    assert.equal(res.status, 200);
    assert.ok(stub.softDeleted.includes(2));
  });

  it("returns 409 for sent / approved / rejected (non-deletable) lifecycles", async () => {
    const cases: Array<{ status: string; internalStatus: string; label: string }> = [
      { status: "pending", internalStatus: "sent_to_customer", label: "sent" },
      { status: "approved", internalStatus: "sent_to_customer", label: "approved" },
      { status: "rejected", internalStatus: "sent_to_customer", label: "rejected" },
    ];
    let nextId = 200;
    for (const c of cases) {
      const id = nextId++;
      seedEstimate(stub, id, { status: c.status, internalStatus: c.internalStatus });
      const res = await deleteAs(baseUrl, id, "company_admin");
      assert.equal(res.status, 409, `expected 409 for ${c.label}`);
    }
    assert.equal(stub.softDeleted.length, 0);
  });

  it("delete on pending-review records audit details including lifecycle", async () => {
    seedEstimate(stub, 3, {
      status: "pending",
      internalStatus: "approved_internal",
    });
    const res = await deleteAs(baseUrl, 3, "irrigation_manager");
    assert.equal(res.status, 200);
    assert.ok(stub.softDeleted.includes(3));
    // The route MUST emit exactly one estimate.deleted audit event
    // and the `details.lifecycle` field MUST carry the derived
    // lifecycle bucket so App Health → Audit can render
    // "deleted from pending" without re-deriving from the legacy
    // (status, internalStatus) axes.
    const deleted = stub.auditCalls.filter((e) => e.action === "estimate.deleted");
    assert.equal(deleted.length, 1, "exactly one estimate.deleted audit row");
    const evt = deleted[0]!;
    assert.equal(evt.targetType, "estimate");
    assert.equal(evt.targetId, "3");
    assert.equal(evt.actorRole, "irrigation_manager");
    const details = (evt.details ?? {}) as Record<string, unknown>;
    assert.equal(details.lifecycle, "pending_review");
    assert.equal(details.internalStatus, "approved_internal");
    assert.equal(details.estimateId, 3);
  });

  it("delete on a draft records audit details with lifecycle='draft'", async () => {
    seedEstimate(stub, 4, { status: "draft", internalStatus: "draft" });
    const res = await deleteAs(baseUrl, 4, "field_tech");
    assert.equal(res.status, 200);
    const deleted = stub.auditCalls.filter((e) => e.action === "estimate.deleted");
    assert.equal(deleted.length, 1);
    const details = (deleted[0]!.details ?? {}) as Record<string, unknown>;
    assert.equal(details.lifecycle, "draft");
  });

  it("soft-deleted rows are hidden from GET /api/estimates and visible with ?includeDeleted=1 for super_admin", async () => {
    seedEstimate(stub, 50, {
      status: "pending",
      internalStatus: "pending_approval",
    });
    seedEstimate(stub, 51, { status: "draft", internalStatus: "draft" });
    // Delete the pending row via the real route — exercises the
    // end-to-end soft-delete path including the storage tombstone.
    const del = await deleteAs(baseUrl, 50, "company_admin");
    assert.equal(del.status, 200);

    // Default GET hides the deleted row for every role.
    const headers: Record<string, string> = {
      "x-user-id": "1",
      "x-user-company-id": "1",
      "x-user-role": "super_admin",
    };
    const listRes = await fetch(`${baseUrl}/api/estimates`, { headers });
    assert.equal(listRes.status, 200);
    const list = (await listRes.json()) as Array<{ id: number }>;
    const ids = list.map((r) => r.id).sort();
    assert.deepEqual(ids, [51]);

    // super_admin with ?includeDeleted=1 sees the soft-deleted row again.
    const includeRes = await fetch(
      `${baseUrl}/api/estimates?includeDeleted=1`,
      { headers },
    );
    assert.equal(includeRes.status, 200);
    const includeList = (await includeRes.json()) as Array<{
      id: number;
      deletedAt: string | null;
    }>;
    const includeIds = includeList.map((r) => r.id).sort();
    assert.deepEqual(includeIds, [50, 51]);
    const deletedRow = includeList.find((r) => r.id === 50)!;
    assert.ok(deletedRow.deletedAt, "tombstone column carries deletedAt");
  });

  it("non-super_admin role cannot bypass soft-delete filtering via ?includeDeleted=1", async () => {
    seedEstimate(stub, 60, {
      status: "pending",
      internalStatus: "pending_approval",
    });
    await deleteAs(baseUrl, 60, "company_admin");
    const headers: Record<string, string> = {
      "x-user-id": "1",
      "x-user-company-id": "1",
      "x-user-role": "company_admin",
    };
    const res = await fetch(
      `${baseUrl}/api/estimates?includeDeleted=1`,
      { headers },
    );
    assert.equal(res.status, 200);
    const list = (await res.json()) as Array<{ id: number }>;
    assert.equal(list.length, 0, "company_admin must not see soft-deleted rows");
  });

});

// ─── Task #1424 — POST /api/estimates/:id/convert-to-work-order ───────────────
// (a) a no-body request must not 500 (Express 5 delivers an empty body as
//     `undefined`, so the optional `assignedTechnicianId` reads have to be
//     null-safe), and (b) a request carrying `assignedTechnicianId` must
//     create *and* assign the work order in one call.
describe("POST /api/estimates/:id/convert-to-work-order — assign-tech + empty-body safety", () => {
  type ConvertStub = EstimateRoutesStorage & {
    estimates: Map<number, EstimateWithItems>;
    users: Map<number, User>;
    workOrders: Map<number, WorkOrder>;
    assignCalls: Array<{ workOrderId: number; userId: number; userName: string }>;
    nextWorkOrderId: number;
  };

  function makeConvertStub(): ConvertStub {
    const stub: ConvertStub = {
      estimates: new Map(),
      users: new Map(),
      workOrders: new Map(),
      assignCalls: [],
      nextWorkOrderId: 5000,
      async getCustomer() {
        return undefined;
      },
      async getEstimate(id) {
        return stub.estimates.get(id);
      },
      async createEstimateFromPayload() {
        throw new Error("not used");
      },
      async updateEstimateWithItems() {
        throw new Error("not used");
      },
      async createWorkOrderFromEstimate(id) {
        const wo = {
          id: stub.nextWorkOrderId++,
          workOrderNumber: `WO-${id}`,
          estimateId: id,
          assignedTechnicianId: null,
          assignedTechnicianName: null,
        } as unknown as WorkOrder;
        stub.workOrders.set(wo.id, wo);
        return wo;
      },
      async getUser(id) {
        return stub.users.get(id);
      },
      async assignWorkOrder(workOrderId, userId, userName) {
        stub.assignCalls.push({ workOrderId, userId, userName });
        const wo = stub.workOrders.get(workOrderId);
        if (wo) {
          (wo as { assignedTechnicianId: number }).assignedTechnicianId = userId;
          (wo as { assignedTechnicianName: string }).assignedTechnicianName =
            userName;
        }
        return wo ?? null;
      },
      async updateWorkOrder(id, updates) {
        const wo = stub.workOrders.get(id);
        if (wo) Object.assign(wo, updates);
        return wo ?? null;
      },
    };
    return stub;
  }

  function seedConvertEstimate(stub: ConvertStub, id: number): void {
    stub.estimates.set(id, {
      id,
      companyId: 1,
      customerId: 1,
      estimateNumber: `EST-${id}`,
      status: "approved",
      internalStatus: "approved_internal",
      workOrderId: null,
      items: [],
    } as unknown as EstimateWithItems);
  }

  function seedTech(stub: ConvertStub, id: number, name: string): void {
    stub.users.set(id, {
      id,
      name,
      role: "field_tech",
      isActive: true,
    } as unknown as User);
  }

  let stub: ConvertStub;
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    stub = makeConvertStub();
    ({ baseUrl, close } = await startServer(stub));
  });
  afterEach(async () => {
    await close();
  });

  it("does not 500 on an empty/missing request body", async () => {
    seedConvertEstimate(stub, 29);
    // No Content-Type, no body — mirrors the legacy fire-and-convert call
    // that triggered the production TypeError under Express 5.
    const res = await fetch(`${baseUrl}/api/estimates/29/convert-to-work-order`, {
      method: "POST",
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { workOrder: { id: number } };
    assert.ok(body.workOrder?.id, "a work order was created");
    // No technician supplied → no assignment side-effect.
    assert.equal(stub.assignCalls.length, 0);
  });

  it("creates and assigns the work order when assignedTechnicianId is sent", async () => {
    seedConvertEstimate(stub, 30);
    seedTech(stub, 7, "Pat Tech");
    const res = await fetch(`${baseUrl}/api/estimates/30/convert-to-work-order`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assignedTechnicianId: 7 }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      workOrder: { id: number; assignedTechnicianId: number | null };
    };
    assert.ok(body.workOrder?.id, "a work order was created");
    // Exactly one assignment, to the chosen technician.
    assert.equal(stub.assignCalls.length, 1);
    assert.equal(stub.assignCalls[0]!.userId, 7);
    assert.equal(stub.assignCalls[0]!.userName, "Pat Tech");
    assert.equal(stub.assignCalls[0]!.workOrderId, body.workOrder.id);
  });
});

// ── POST /api/estimates — companyId guard ──────────────────────────────────────
// Validates that the hardened create route rejects requests from auth contexts
// that have no companyId rather than silently minting a timestamp-based number.

describe("POST /api/estimates — companyId guard", () => {
  it("returns 400 when authenticatedUserCompanyId is null (no company context)", async () => {
    const stub = makeStorageStub();
    stub.customers.set(1, makeCustomer(1, "45.00"));
    // Start server with companyId: null to simulate a company-less auth context.
    const { baseUrl, close } = await startServer(stub, { companyId: null });
    try {
      const res = await fetch(`${baseUrl}/api/estimates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildBody({ customerId: 1, tamperedLaborRate: 45 })),
      });
      assert.equal(res.status, 400, "should be rejected with 400 when no company context");
      const body = (await res.json()) as { message: string };
      assert.ok(
        body.message.toLowerCase().includes("company"),
        `response message should mention company, got: ${body.message}`,
      );
    } finally {
      await close();
    }
  });

  it("stamps companyId from auth context onto the estimate payload", async () => {
    const stub = makeStorageStub();
    stub.customers.set(1, makeCustomer(1, "50.00"));
    // Company 42 from auth — the payload must not be trusted for this field.
    const { baseUrl, close } = await startServer(stub, { companyId: 42 });
    try {
      const res = await fetch(`${baseUrl}/api/estimates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildBody({ customerId: 1, tamperedLaborRate: 50 })),
      });
      assert.equal(res.status, 201);
      // The storage stub captures the raw payload; the companyId on the estimate
      // must match the auth-stamped value, not whatever the client may have sent.
      const estimateCompanyId = (stub.lastCreatePayload?.estimate as Record<string, unknown>)?.companyId;
      assert.equal(estimateCompanyId, 42, "companyId should be stamped from auth context");
    } finally {
      await close();
    }
  });
});
