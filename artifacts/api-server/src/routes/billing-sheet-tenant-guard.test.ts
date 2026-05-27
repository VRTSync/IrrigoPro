// Behavioral regression tests for requireSameCompanyAsBillingSheet middleware.
//
// Imports the REAL middleware factory from billing-sheet-tenant-guard.ts and
// injects in-memory storage stubs — no DB, no session store, no reimplemented
// logic. Any change to the production middleware is automatically exercised.
//
// Scenarios covered:
//   1. cross-company field_tech GET billing sheet → 404
//   2. cross-company company_admin GET billing sheet → 404
//   3. cross-company billing_manager PATCH billing sheet → 404
//   4. cross-company company_admin DELETE billing sheet → 404
//   5. all four above succeed when caller is in Company A (same company)
//   6. super_admin → 200 on any company's billing sheet (full bypass)
//   7. no-auth GET → 401 (requireAuthentication fires before tenant guard)
//   8. cross-tenant probe emits exactly one [AUDIT] cross_tenant_billing_sheet_access line
//
// Slice 4: stubs now return companyId directly on the billing sheet row;
// no getCustomer call is needed.

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import express, { type Express, type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { makeRequireSameCompanyAsBillingSheet, type StorageForBillingSheetTenantGuard } from "./billing-sheet-tenant-guard";

// ── In-memory storage stubs ─────────────────────────────────────────────────

function makeStubStorage(): StorageForBillingSheetTenantGuard & {
  billingSheets: Map<number, { id: number; customerId: number | null; companyId: number | null }>;
} {
  const billingSheets = new Map([
    [10, { id: 10, customerId: 101, companyId: 1 }],  // Company A
    [20, { id: 20, customerId: 201, companyId: 2 }],  // Company B
  ]);
  return {
    billingSheets,
    async getBillingSheetById(id: number, _companyId: number | null) { return billingSheets.get(id) ?? null; },
  };
}

// ── Minimal requireAuthentication stub ─────────────────────────────────────
// Mirrors the production behaviour: reads x-user-* headers, sets req.authenticated*,
// returns 401 when the headers are absent.
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
  const tenantGuard = makeRequireSameCompanyAsBillingSheet(makeStubStorage());

  // Representative routes mirroring the production chain shape:
  //   [requireAuthentication, requireSameCompanyAsBillingSheet, ...role_guard..., handler]
  app.get("/api/billing-sheets/:id", requireAuthentication, tenantGuard, (req: any, res) => {
    res.json({ id: parseInt(req.params.id), cached: !!req.tenantScopedBillingSheet });
  });

  app.patch("/api/billing-sheets/:id", requireAuthentication, tenantGuard, (req: any, res) => {
    res.json({ updated: true });
  });

  app.delete("/api/billing-sheets/:id", requireAuthentication, tenantGuard, (req: any, res) => {
    res.json({ deleted: true });
  });

  app.get("/api/billing-sheets/:id/items", requireAuthentication, tenantGuard, (req: any, res) => {
    res.json({ items: [] });
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

// Company A callers
const companyAAdmin = {
  "x-user-id": "10",
  "x-user-role": "company_admin",
  "x-user-company-id": "1",
};

const companyAFieldTech = {
  "x-user-id": "11",
  "x-user-role": "field_tech",
  "x-user-company-id": "1",
};

// Company B callers
const companyBFieldTech = {
  "x-user-id": "20",
  "x-user-role": "field_tech",
  "x-user-company-id": "2",
};

const companyBAdmin = {
  "x-user-id": "21",
  "x-user-role": "company_admin",
  "x-user-company-id": "2",
};

const companyBBillingManager = {
  "x-user-id": "22",
  "x-user-role": "billing_manager",
  "x-user-company-id": "2",
};

const superAdmin = {
  "x-user-id": "1",
  "x-user-role": "super_admin",
  // super_admin companyId deliberately from Company B to verify bypass is role-based
  "x-user-company-id": "2",
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("requireSameCompanyAsBillingSheet — cross-tenant isolation (behavioural)", () => {
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

  it("1. cross-company field_tech GET billing sheet belonging to Company A → 404", async () => {
    const { status } = await apiFetch(harness.baseUrl, "GET", "/api/billing-sheets/10", companyBFieldTech);
    assert.equal(status, 404, "cross-tenant read should be 404, not 403");
  });

  it("2. cross-company company_admin GET billing sheet belonging to Company A → 404", async () => {
    const { status } = await apiFetch(harness.baseUrl, "GET", "/api/billing-sheets/10", companyBAdmin);
    assert.equal(status, 404, "cross-tenant read by company_admin should be 404");
  });

  it("3. cross-company billing_manager PATCH billing sheet belonging to Company A → 404", async () => {
    const { status } = await apiFetch(harness.baseUrl, "PATCH", "/api/billing-sheets/10", companyBBillingManager);
    assert.equal(status, 404, "cross-tenant patch by billing_manager should be 404");
  });

  it("4. cross-company company_admin DELETE billing sheet belonging to Company A → 404", async () => {
    const { status } = await apiFetch(harness.baseUrl, "DELETE", "/api/billing-sheets/10", companyBAdmin);
    assert.equal(status, 404, "cross-tenant delete should be 404");
  });

  it("5a. same-company company_admin GET billing sheet → 200 with cached billingSheet", async () => {
    const { status, body } = await apiFetch(harness.baseUrl, "GET", "/api/billing-sheets/10", companyAAdmin);
    assert.equal(status, 200);
    assert.equal((body as any).id, 10);
    assert.equal((body as any).cached, true, "tenantScopedBillingSheet should be cached on req");
  });

  it("5b. same-company field_tech PATCH billing sheet → 200", async () => {
    const { status } = await apiFetch(harness.baseUrl, "PATCH", "/api/billing-sheets/10", companyAFieldTech);
    assert.equal(status, 200);
  });

  it("5c. same-company company_admin DELETE billing sheet → 200", async () => {
    const { status } = await apiFetch(harness.baseUrl, "DELETE", "/api/billing-sheets/10", companyAAdmin);
    assert.equal(status, 200);
  });

  it("5d. same-company user GET billing-sheet items → 200", async () => {
    const { status } = await apiFetch(harness.baseUrl, "GET", "/api/billing-sheets/10/items", companyAAdmin);
    assert.equal(status, 200);
  });

  it("6. super_admin → 200 on any company's billing sheet (full bypass)", async () => {
    // super_admin with company 2 reads billing sheet 10 belonging to company 1
    const { status } = await apiFetch(harness.baseUrl, "GET", "/api/billing-sheets/10", superAdmin);
    assert.equal(status, 200, "super_admin bypass should allow cross-tenant access");
  });

  it("7. unauthenticated GET → 401 (requireAuthentication fires before tenant guard)", async () => {
    const { status } = await apiFetch(harness.baseUrl, "GET", "/api/billing-sheets/10");
    assert.equal(status, 401, "unauthenticated request should 401, not 404 from guard");
  });

  it("8. cross-tenant probe emits exactly one [AUDIT] cross_tenant_billing_sheet_access log line", async () => {
    await apiFetch(harness.baseUrl, "GET", "/api/billing-sheets/10", companyBFieldTech);

    assert.equal(warnSpy.mock.calls.length, 1, "exactly one audit warn per blocked request");

    const warnArg = String(warnSpy.mock.calls[0]?.arguments?.[0] ?? "");
    assert.ok(
      warnArg.includes("[AUDIT] cross_tenant_billing_sheet_access"),
      `audit line must include [AUDIT] cross_tenant_billing_sheet_access, got: ${warnArg}`,
    );
    assert.ok(
      warnArg.includes("targetBillingSheet=10"),
      `audit line must include the target billingSheetId, got: ${warnArg}`,
    );
    assert.ok(
      warnArg.includes("actorCompany=2"),
      `audit line must include the caller's companyId, got: ${warnArg}`,
    );

    // Second blocked request emits its own warn (one per request, not coalesced).
    await apiFetch(harness.baseUrl, "PATCH", "/api/billing-sheets/10", companyBAdmin);
    assert.equal(warnSpy.mock.calls.length, 2, "each blocked request emits its own audit warn");
  });
});
