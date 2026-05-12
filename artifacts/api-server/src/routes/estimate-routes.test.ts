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
import {
  processEstimatePayload,
  type EstimatePayloadInput,
} from "../estimate-payload";
import type {
  Customer,
  EstimateWithItems,
  InsertEstimate,
  InsertEstimateItem,
} from "@workspace/db";

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
// noop auth middleware so request validation, status codes, and response
// bodies are all exercised the same way they would be in production.
async function startServer(stub: EstimateRoutesStorage): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app: Express = express();
  app.use(express.json());
  const noopAuth: RequestHandler = (_req, _res, next) => next();
  registerEstimateRoutes(app, stub, noopAuth);
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

  // Task #228 — regression. Per-unit laborHours must be multiplied by
  // quantity at the API boundary so the labor subtotal counts every unit
  // of every line. Acceptance example from the task: 4 × 0.5h + 1 × 1.0h
  // @ $75/h = $225 (parts $0 here for clarity).
  it("multiplies per-line laborHours by quantity when computing the labor subtotal (per_part mode)", async () => {
    stub.customers.set(50, makeCustomer(50, "75.00"));
    const body = {
      estimate: {
        customerId: 50,
        customerName: "Q",
        customerEmail: "q@example.com",
        projectName: "P",
        laborRate: 75,
        laborMode: "per_part",
      },
      items: [
        // 4 units, 0.5h per unit = 2.0h
        { partId: 1, partName: "A", partPrice: 0, quantity: 4, laborHours: 0.5 },
        // 1 unit, 1.0h per unit = 1.0h
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
    // Quantity-aware total: 3.0h * $75 = $225.00.
    assert.equal(created.laborSubtotal, "225.00");
    assert.equal(created.partsSubtotal, "0.00");
    assert.equal(created.totalAmount, "225.00");

    // The items persisted to storage carry the per-line total (per-unit ×
    // quantity), so the read-time recompute (sum(item.laborHours) * rate)
    // matches the write-time total — they cannot drift.
    const items = (created.items as Array<Record<string, unknown>>) ?? [];
    assert.equal(items[0]?.laborHours, "2.00");
    assert.equal(items[1]?.laborHours, "1.00");
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
