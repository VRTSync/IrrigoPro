// Integration test: GET /api/work-orders tenant isolation.
//
// Verifies that the route's callerCompanyId derivation correctly scopes the
// storage query so non-super-admin users never receive other tenants' rows.
//
// Uses registerWorkOrderListRoute() — a thin extracted wrapper that mirrors
// the exact callerCompanyId logic in routes.ts — with an in-memory storage
// stub.  No DB, no session store, no live Postgres required.
//
// Scenarios:
//   1. company_admin (company 5) → getWorkOrders(5) called, response = company 5 rows only
//   2. field_tech (company 5)    → getWorkOrders(5) called, response = company 5 rows only
//   3. super_admin (no company)  → getWorkOrders(null) called, response = all rows
//   4. unauthenticated           → 401 before storage is touched
//   5. company_admin (company 9) → getWorkOrders(9) called, response = company 9 rows only
//      (proves isolation across two non-super-admin companies)

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express, { type Express, type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { registerWorkOrderListRoute, type WorkOrderListStorage } from "./work-order-list-route";

// ── Minimal requireAuthentication stub ────────────────────────────────────────
// Mirrors the production header-auth contract: sets req.authenticated* from
// x-user-* headers, returns 401 when absent.
const requireAuthentication: RequestHandler = (req: any, res, next) => {
  const userId = req.headers["x-user-id"];
  const role   = req.headers["x-user-role"];
  if (!userId || !role) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  req.authenticatedUserId      = parseInt(String(userId), 10);
  req.authenticatedUserRole    = String(role);
  const cid = req.headers["x-user-company-id"];
  req.authenticatedUserCompanyId = cid ? parseInt(String(cid), 10) : null;
  next();
};

// ── In-memory stub storage ────────────────────────────────────────────────────

interface CallRecord { companyId: number | null }

function makeStubStorage(): WorkOrderListStorage & { calls: CallRecord[] } {
  // Rows per company (companyId → work orders)
  const fixture: Record<number, { id: number; customerId: number }[]> = {
    5: [{ id: 101, customerId: 501 }, { id: 102, customerId: 501 }],
    9: [{ id: 201, customerId: 901 }],
  };
  const allRows = Object.values(fixture).flat();

  const calls: CallRecord[] = [];

  return {
    calls,
    async getWorkOrders(companyId: number | null) {
      calls.push({ companyId });
      if (companyId === null) return allRows;
      return fixture[companyId] ?? [];
    },
  };
}

// ── Harness ───────────────────────────────────────────────────────────────────

interface Harness {
  baseUrl: string;
  storage: WorkOrderListStorage & { calls: CallRecord[] };
  close: () => Promise<void>;
}

function startHarness(): Promise<Harness> {
  return new Promise((resolve) => {
    const storage = makeStubStorage();
    const app: Express = express();
    app.use(express.json());

    registerWorkOrderListRoute(app, storage, requireAuthentication);

    const server: Server = createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        storage,
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
      });
    });
  });
}

async function get(
  baseUrl: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}/api/work-orders`, { headers });
  const body = await res.json();
  return { status: res.status, body };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/work-orders — tenant isolation", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await startHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it("company_admin (company 5): getWorkOrders called with 5, response limited to company-5 rows", async () => {
    const { status, body } = await get(harness.baseUrl, {
      "x-user-id":         "10",
      "x-user-role":       "company_admin",
      "x-user-company-id": "5",
    });

    assert.equal(status, 200);
    assert.deepEqual(harness.storage.calls, [{ companyId: 5 }]);

    const rows = body as { id: number }[];
    assert.ok(Array.isArray(rows), "response should be an array");
    assert.deepEqual(rows.map(r => r.id).sort(), [101, 102]);
  });

  it("field_tech (company 5): getWorkOrders called with 5, response limited to company-5 rows", async () => {
    const { status, body } = await get(harness.baseUrl, {
      "x-user-id":         "20",
      "x-user-role":       "field_tech",
      "x-user-company-id": "5",
    });

    assert.equal(status, 200);
    assert.deepEqual(harness.storage.calls, [{ companyId: 5 }]);

    const rows = body as { id: number }[];
    assert.deepEqual(rows.map(r => r.id).sort(), [101, 102]);
  });

  it("super_admin: getWorkOrders called with null, response includes all tenants' rows", async () => {
    const { status, body } = await get(harness.baseUrl, {
      "x-user-id":   "1",
      "x-user-role": "super_admin",
      // intentionally no x-user-company-id
    });

    assert.equal(status, 200);
    assert.deepEqual(harness.storage.calls, [{ companyId: null }]);

    const rows = body as { id: number }[];
    assert.deepEqual(rows.map(r => r.id).sort(), [101, 102, 201]);
  });

  it("unauthenticated: 401 returned before storage is touched", async () => {
    const { status } = await get(harness.baseUrl, {});

    assert.equal(status, 401);
    assert.deepEqual(harness.storage.calls, [], "storage must not be called on 401");
  });

  it("company_admin (company 9): isolated from company-5 rows", async () => {
    const { status, body } = await get(harness.baseUrl, {
      "x-user-id":         "30",
      "x-user-role":       "company_admin",
      "x-user-company-id": "9",
    });

    assert.equal(status, 200);
    assert.deepEqual(harness.storage.calls, [{ companyId: 9 }]);

    const rows = body as { id: number }[];
    // must see only company-9's row and NOT company-5's rows
    assert.deepEqual(rows.map(r => r.id), [201]);
  });
});
