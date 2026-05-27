// Behavioral regression tests for requireSameCompanyAsWorkOrder middleware.
//
// Imports the REAL middleware factory from work-order-tenant-guard.ts and
// injects in-memory storage stubs — no DB, no session store, no reimplemented
// logic. Any change to the production middleware is automatically exercised.
//
// Scenarios covered:
//   1. cross-company field_tech GET → 404
//   2. same-company company_admin GET → 200 (tenantScopedWorkOrder cached)
//   3. super_admin → 200 on any company's work order (full bypass)
//   4. cross-company PATCH → 404
//   5. cross-company DELETE → 404
//   6. cross-company POST assign → 404
//   7. no-auth GET → 401 (requireAuthentication fires before tenant guard)
//   8. console.warn audit line appears exactly once per blocked request
//
// Slice 4: stubs now return companyId directly on the work order row;
// no getCustomer call is needed.

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import express, { type Express, type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { makeRequireSameCompanyAsWorkOrder, type StorageForTenantGuard } from "./work-order-tenant-guard";

// ── In-memory storage stubs ─────────────────────────────────────────────────

function makeStubStorage(): StorageForTenantGuard & {
  workOrders: Map<number, { id: number; customerId: number | null; companyId: number | null }>;
} {
  const workOrders = new Map([
    [1, { id: 1, customerId: 101, companyId: 1 }],  // Company A
    [2, { id: 2, customerId: 201, companyId: 2 }],  // Company B
  ]);
  return {
    workOrders,
    async getWorkOrder(id: number, _companyId: number | null) { return workOrders.get(id) ?? null; },
  };
}

// ── Minimal requireAuthentication stub ─────────────────────────────────────
// Mirrors the production behaviour: reads x-user-* headers, sets req.authenticated*,
// returns 401 when the headers are absent. Not reimplementing any guard logic —
// this is just the well-known header-auth contract the test harness relies on.
const requireAuthentication: RequestHandler = (req: any, res, next) => {
  const userId = req.headers["x-user-id"];
  const role = req.headers["x-user-role"];
  if (!userId || !role) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  req.authenticatedUserId = parseInt(String(userId), 10);
  req.authenticatedUserRole = String(role);
  const cid = req.headers["x-user-company-id"];
  req.authenticatedUserCompanyId = cid ? parseInt(String(cid), 10) : null;
  next();
};

// ── Harness ─────────────────────────────────────────────────────────────────

interface Harness {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startHarness(): Promise<Harness> {
  const app: Express = express();
  app.use(express.json());

  // Use the REAL middleware factory with in-memory stubs injected.
  const tenantGuard = makeRequireSameCompanyAsWorkOrder(makeStubStorage());

  // Representative routes mirroring the production chain shape:
  //   [requireAuthentication, requireSameCompanyAsWorkOrder, ...role_guard..., handler]
  app.get("/api/work-orders/:id", requireAuthentication, tenantGuard, (req: any, res) => {
    res.json({ id: parseInt(req.params.id), cached: !!req.tenantScopedWorkOrder });
  });

  app.patch("/api/work-orders/:id", requireAuthentication, tenantGuard, (req: any, res) => {
    res.json({ updated: true });
  });

  app.delete("/api/work-orders/:id", requireAuthentication, tenantGuard, (req: any, res) => {
    res.json({ deleted: true });
  });

  app.post("/api/work-orders/:id/assign", requireAuthentication, tenantGuard, (req: any, res) => {
    res.json({ assigned: true });
  });

  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    ),
  };
}

async function apiFetch(
  baseUrl: string,
  method: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: method === "GET" || method === "DELETE" ? undefined : "{}",
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// ── Caller fixtures ─────────────────────────────────────────────────────────

const companyAAdmin = {
  "x-user-id": "10",
  "x-user-role": "company_admin",
  "x-user-company-id": "1",
};

const companyBFieldTech = {
  "x-user-id": "20",
  "x-user-role": "field_tech",
  "x-user-company-id": "2",
};

const superAdmin = {
  "x-user-id": "1",
  "x-user-role": "super_admin",
  "x-user-company-id": "2",
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("requireSameCompanyAsWorkOrder — cross-tenant isolation (behavioural)", () => {
  let harness: Harness;
  let warnSpy: ReturnType<typeof mock.method>;

  beforeEach(async () => {
    harness = await startHarness();
    warnSpy = mock.method(console, "warn", () => {});
  });

  afterEach(async () => {
    warnSpy.mock.restore();
    await harness.close();
  });

  it("1. cross-company field_tech GET work order → 404", async () => {
    const { status } = await apiFetch(harness.baseUrl, "GET", "/api/work-orders/1", companyBFieldTech);
    assert.equal(status, 404, "cross-tenant read should be 404, not 403");
  });

  it("2. same-company company_admin GET work order → 200", async () => {
    const { status, body } = await apiFetch(harness.baseUrl, "GET", "/api/work-orders/1", companyAAdmin);
    assert.equal(status, 200);
    assert.equal((body as any).id, 1);
    assert.equal((body as any).cached, true, "tenantScopedWorkOrder should be cached on req");
  });

  it("3. super_admin → 200 on any company's work order (full bypass)", async () => {
    // super_admin in company 2 reads work order 1 which belongs to company 1
    const { status } = await apiFetch(harness.baseUrl, "GET", "/api/work-orders/1", superAdmin);
    assert.equal(status, 200);
  });

  it("4. cross-company PATCH → 404", async () => {
    const { status } = await apiFetch(harness.baseUrl, "PATCH", "/api/work-orders/1", companyBFieldTech);
    assert.equal(status, 404);
  });

  it("5. cross-company DELETE → 404", async () => {
    const { status } = await apiFetch(harness.baseUrl, "DELETE", "/api/work-orders/1", companyBFieldTech);
    assert.equal(status, 404);
  });

  it("6. cross-company POST assign → 404", async () => {
    const { status } = await apiFetch(harness.baseUrl, "POST", "/api/work-orders/1/assign", companyBFieldTech);
    assert.equal(status, 404);
  });

  it("7. no-auth GET → 401 (requireAuthentication fires before tenant guard)", async () => {
    const { status } = await apiFetch(harness.baseUrl, "GET", "/api/work-orders/1");
    assert.equal(status, 401, "unauthenticated request should 401, not 404 from guard");
  });

  it("8. console.warn audit line appears exactly once per blocked request", async () => {
    await apiFetch(harness.baseUrl, "GET", "/api/work-orders/1", companyBFieldTech);
    assert.equal(warnSpy.mock.calls.length, 1, "exactly one audit warn per blocked request");

    const warnArg = String(warnSpy.mock.calls[0]?.arguments?.[0] ?? "");
    assert.ok(warnArg.includes("[AUDIT-TENANT-MISMATCH]"), "audit line must include [AUDIT-TENANT-MISMATCH]");
    assert.ok(warnArg.includes("workOrderId=1"), "audit line must include the target workOrderId");
    assert.ok(warnArg.includes("callerCompanyId=2"), "audit line must include the caller's companyId");

    // Second blocked request → second warn (one per request, not coalesced)
    await apiFetch(harness.baseUrl, "PATCH", "/api/work-orders/1", companyBFieldTech);
    assert.equal(warnSpy.mock.calls.length, 2, "each blocked request emits its own audit warn");
  });
});
