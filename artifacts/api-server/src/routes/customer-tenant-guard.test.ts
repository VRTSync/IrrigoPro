// Real middleware with in-memory storage; no database reads or writes.
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express, { type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import { transformSync } from "esbuild";
import type { AddressInfo } from "node:net";
import type { Customer } from "@workspace/db";
import { insertCustomerSchema } from "@workspace/db/schema";
import { makeRequireCustomerInTenant } from "./customer-tenant-guard";

// customer-routes exports the real schemas but also imports runtime storage.
// Isolate those dependencies before importing it: storage's constructor runs
// migrations, so importing the unmocked module would violate this suite's
// database-free contract even if no handler was called.
mock.module("@workspace/db", {
  namedExports: { insertCustomerSchema, withDbRetry: async (fn: () => unknown) => fn() },
});
mock.module("../storage", { namedExports: { storage: {} } });
mock.module("../lib/customer-records-lock", {
  namedExports: {
    getCustomerRecordsLock: () => { throw new Error("Unexpected lock lookup in database-free schema/guard suite"); },
  },
});
mock.module("../services/generate-budget-months", {
  namedExports: {
    applyMonthOverride: () => { throw new Error("Unexpected budget write"); },
    generateBudgetMonths: () => { throw new Error("Unexpected budget write"); },
    validateCurve: () => { throw new Error("Unexpected curve validation"); },
  },
});
const { createCustomerSchema, updateCustomerSchema } = await import("./customer-routes");

// Only these test-only headers populate authenticated context. Raw x-user-*
// headers deliberately remain unrelated to authentication, as with a session.
const authenticate: RequestHandler = (req, res, next) => {
  if (!req.headers["test-role"]) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  req.authenticatedUserId = 7;
  req.authenticatedUserRole = String(req.headers["test-role"]);
  req.authenticatedUserCompanyId = req.headers["test-company"]
    ? Number(req.headers["test-company"]) : null;
  next();
};

describe("customer tenant guard — behavioral matrix", () => {
  let server: Server;
  let base: string;
  let reads: number[];
  let failStorage: boolean;
  let warn: ReturnType<typeof mock.method>;
  const customers = new Map<number, Customer>([
    [10, { id: 10, companyId: 1 } as Customer],
    [20, { id: 20, companyId: 2 } as Customer],
  ]);

  beforeEach(async () => {
    reads = [];
    failStorage = false;
    warn = mock.method(console, "warn", () => {});
    const app = express();
    const guard = makeRequireCustomerInTenant({
      async getCustomer(id) {
        reads.push(id);
        if (failStorage) throw new Error("storage unavailable");
        return customers.get(id);
      },
    });
    for (const method of ["get", "patch"] as const) {
      app[method]("/c/:id", authenticate, guard, (req, res) => {
        assert.equal(req.tenantScopedCustomer, customers.get(req.tenantScopedCustomer!.id));
        res.json({ ok: true, id: req.tenantScopedCustomer!.id });
      });
    }
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    warn.mock.restore();
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  });

  async function request(
    id: string, role: string, company: number | null,
    method = "GET", extra: Record<string, string> = {},
  ) {
    const response = await fetch(`${base}/c/${id}`, {
      method,
      headers: {
        ...(role ? { "test-role": role } : {}),
        ...(company === null ? {} : { "test-company": String(company) }),
        ...extra,
      },
    });
    return { status: response.status, body: await response.json() };
  }

  it("1. same-company admin succeeds, attaches the actual row and loads once", async () => {
    assert.deepEqual(await request("10", "company_admin", 1), { status: 200, body: { ok: true, id: 10 } });
    assert.deepEqual(reads, [10]);
  });
  it("2. cross-company admin GET is indistinguishable from missing", async () => {
    assert.deepEqual(await request("20", "company_admin", 1), { status: 404, body: { message: "Customer not found" } });
  });
  it("3. cross-company billing manager PATCH is denied", async () => {
    assert.deepEqual(await request("20", "billing_manager", 1, "PATCH"), { status: 404, body: { message: "Customer not found" } });
  });
  it("4. cross-company field tech GET is denied", async () => {
    assert.equal((await request("10", "field_tech", 2)).status, 404);
  });
  it("5. super admin without a company can load another company's customer", async () => {
    assert.deepEqual(await request("20", "super_admin", null), { status: 200, body: { ok: true, id: 20 } });
    assert.deepEqual(reads, [20]);
  });
  it("6. non-super-admin without a company is denied", async () => {
    assert.equal((await request("10", "company_admin", null)).status, 404);
  });
  it("7. missing customer returns 404 without a cross-tenant audit", async () => {
    assert.deepEqual(await request("999", "company_admin", 1), { status: 404, body: { message: "Customer not found" } });
    assert.equal(warn.mock.calls.length, 0);
  });
  it("8. invalid, zero, negative and fractional IDs return 400 before storage", async () => {
    for (const id of ["abc", "0", "-1", "1.5", "10abc", "Infinity"]) {
      assert.deepEqual(await request(id, "company_admin", 1), { status: 400, body: { message: "Invalid customer ID" } });
    }
    assert.deepEqual(reads, []);
  });
  it("9. spoofed raw role and company headers cannot override authenticated context", async () => {
    assert.equal((await request("20", "company_admin", 1, "GET", {
      "x-user-role": "super_admin", "x-user-company-id": "2",
    })).status, 404);
  });
  it("10. denied cross-company GET emits exactly one complete audit line", async () => {
    await request("20", "company_admin", 1);
    assert.equal(warn.mock.calls.length, 1);
    assert.deepEqual(warn.mock.calls[0].arguments, [
      "[AUDIT] cross_tenant_customer_access actor=7 actorCompany=1 targetCustomer=20 targetCompany=2 route=GET /c/20",
    ]);
  });
  it("authentication runs before storage, even with spoofed raw headers", async () => {
    assert.equal((await request("10", "", null, "GET", { "x-user-role": "super_admin" })).status, 401);
    assert.deepEqual(reads, []);
  });
  it("storage errors return the specified 500 and do not reach the handler", async () => {
    failStorage = true;
    const error = mock.method(console, "error", () => {});
    try {
      assert.deepEqual(await request("10", "company_admin", 1), { status: 500, body: { message: "Failed to load customer" } });
      assert.deepEqual(reads, [10]);
      assert.equal(error.mock.calls.length, 1);
    } finally { error.mock.restore(); }
  });
});

const crud = readFileSync(new URL("./customer-routes.ts", import.meta.url), "utf8");
const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
function registration(source: string, verb: string, path: string): string {
  // Accept both single- and multiline registration formatting.
  const marker = new RegExp(`app\\.${verb}\\(\\s*"${path}"`);
  const match = marker.exec(source);
  assert.ok(match, `Missing ${verb} ${path}`);
  const tail = source.slice(match.index);
  const end = tail.indexOf("async ");
  assert.ok(end >= 0);
  return tail.slice(0, end);
}

describe("customer route registrations and ownership", () => {
  const inventory: Array<[string, string, string, string?]> = [
    [crud, "put", "/api/customers/:id", "requireCustomerEditAccess"],
    [crud, "patch", "/api/customers/:id", "requireCustomerEditAccess"],
    [crud, "patch", "/api/customers/:id/labor-rates"],
    [crud, "delete", "/api/customers/:id", "requireCompanyAdminAccess"],
    ...["", "/billing", "/estimates", "/work-orders", "/billing-sheets"].map(
      (suffix): [string, string, string] => [routes, "get", `/api/customers/:id${suffix}`],
    ),
    [routes, "get", "/api/customers/:id/property-boundary"],
    [routes, "put", "/api/customers/:id/property-boundary", "requireBoundaryEditAccess"],
    [routes, "delete", "/api/customers/:id/property-boundary", "requireBoundaryEditAccess"],
  ];
  for (const [source, verb, path, role] of inventory) {
    it(`${verb.toUpperCase()} ${path} has the exact middleware order`, () => {
      const chunk = registration(source, verb, path);
      const middleware = chunk.slice(chunk.indexOf(`"${path}"`) + path.length + 2)
        .split(",").map((part) => part.trim()).filter(Boolean);
      assert.deepEqual(middleware, [
        "requireAuthentication", ...(role ? [role] : []), "requireCustomerInTenant",
      ]);
    });
  }
  it("uses one injected guard instance", () => {
    assert.match(routes, /const requireCustomerInTenant = makeRequireCustomerInTenant\(storage\)/);
    assert.match(routes, /registerCustomerRoutes\(app, \{[^}]*requireCustomerInTenant/s);
  });
  it("removes the shadow detail route and the obsolete boundary helper", () => {
    assert.doesNotMatch(crud, /app\.get\("\/api\/customers\/:id"/);
    // Split the retired name so the acceptance clean grep remains clean.
    assert.equal(routes.includes("loadCustomer" + "WithTenantCheck"), false);
  });
  it("creates with authenticated company and parses only the ownership-safe schemas", () => {
    assert.ok(crud.includes("createCustomerSchema.parse({ ...req.body, companyId })"));
    assert.match(crud, /const companyId = req\.authenticatedUserCompanyId/);
    assert.ok(crud.includes("Forbidden: user has no company association"));
    assert.doesNotMatch(crud, /insertCustomerSchema(?:\.partial\(\))?\.parse\(req\.body\)/);
    assert.equal(crud.match(/updateCustomerSchema\.parse\(req\.body\)/g)?.length, 2);
  });
  it("retired customer import preserves middleware and responds without writes", () => {
    const start = routes.indexOf('app.post("/api/customers/import-csv"');
    assert.ok(start >= 0);
    const chunk = routes.slice(start, routes.indexOf("\n  });", start));
    assert.match(chunk, /requireAuthentication, requireCompanyAdminAccess, async/);
    assert.match(chunk, /res\.status\(410\)/);
    assert.ok(chunk.includes("Customer CSV import was retired. Customers come from QuickBooks or the customer form."));
    assert.doesNotMatch(chunk, /createCustomer\(/);
  });
});

describe("customer schemas silently strip server-owned identifiers", () => {
  it("create drops QuickBooks ID without changing editable fields", () => {
    const data = createCustomerSchema.parse({ name: "A", email: "a@x.invalid", companyId: 1, quickbooksId: "57",
      qbNotInQuickbooksAt: new Date() });
    assert.equal("quickbooksId" in data, false);
    assert.equal("qbNotInQuickbooksAt" in data, false);
    assert.equal(data.companyId, 1);
    assert.equal(data.name, "A");
  });
  it("update drops company and QuickBooks IDs but retains labor rate", () => {
    assert.deepEqual(updateCustomerSchema.parse({ companyId: 2, quickbooksId: "57", qbNotInQuickbooksAt: new Date(), laborRate: "50.00" }), { laborRate: "50.00" });
  });
});

describe("actual customer read handlers use the guard's resolved customer ID", () => {
  // Evaluate only each real registration, not the monolith's initialization.
  // The source handlers themselves run unchanged; no handler logic is copied.
  // Unrelated formatting/financial helpers are stubbed, storage is in-memory.
  let server: Server;
  let base: string;
  let targetReads: number[];
  const own = { id: 10, companyId: 1 } as Customer;
  const foreign = { id: 1, companyId: 2 } as Customer;
  const rows = [
    { id: 101, customerId: 1, projectName: "foreign", totalAmount: "1.00" },
    { id: 110, customerId: 10, projectName: "own", totalAmount: "10.00" },
  ];
  beforeEach(async () => {
    targetReads = [];
    const byCustomer = async (id: number) => {
      targetReads.push(id);
      return rows.filter((row) => row.customerId === id);
    };
    const storage = {
      async getCustomer(id: number) { return id === 10 ? own : id === 1 ? foreign : undefined; },
      async getCustomerById(id: number) {
        targetReads.push(id);
        return id === 10 ? own : id === 1 ? foreign : undefined;
      },
      async getWorkOrders() { return rows; },
      async getAllBillingSheets() { return rows; },
      async getEstimates() { return rows; },
      getWetCheckBillingsByCustomer: byCustomer,
      getEstimatesByCustomer: byCustomer,
      getWorkOrdersByCustomer: byCustomer,
      getBillingSheetsByCustomer: byCustomer,
    };
    const app = express();
    const deps = {
      app, storage,
      requireAuthentication: authenticate,
      requireCustomerInTenant: makeRequireCustomerInTenant(storage),
      previousCalendarMonth: () => "2026-10",
      resolveAsOfCutoff: () => new Date("2026-11-01T00:00:00Z"),
      computeUnbilledPartition: () => ({
        total: 0, approvedWorkOrders: [], approvedBillingSheets: [], approvedWetCheckBillings: [],
      }),
      money: (value: unknown) => Number(value ?? 0),
      applyPricingVisibility: (_req: unknown, data: unknown) => data,
      applyBillingNotesVisibility: (_req: unknown, data: unknown) => data,
    };
    for (const suffix of ["billing", "estimates", "work-orders", "billing-sheets"]) {
      const marker = `app.get("/api/customers/:id/${suffix}"`;
      const start = routes.indexOf(marker);
      assert.ok(start >= 0);
      const end = routes.indexOf("\n  });", start);
      assert.ok(end > start);
      const source = routes.slice(start, end + "\n  });".length);
      const compiled = transformSync(source, { loader: "ts", target: "es2022" }).code;
      new Function(...Object.keys(deps), compiled)(...Object.values(deps));
    }
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  for (const suffix of ["billing", "estimates", "work-orders", "billing-sheets"]) {
    for (const rawId of ["10", "1e1", "0xA", "10.0"]) {
      it(`${suffix}: ${rawId} queries only the authorized customer 10, never foreign customer 1`, async () => {
        const res = await fetch(`${base}/api/customers/${rawId}/${suffix}`, {
          headers: { "test-role": "company_admin", "test-company": "1" },
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.ok(targetReads.length > 0);
        assert.ok(targetReads.every((id) => id === 10), `Unexpected downstream IDs: ${targetReads}`);
        if (suffix === "billing") {
          const billing = body as { customer: { id: number } } &
            Record<string, Array<{ customerId: number }>>;
          assert.equal(billing.customer.id, 10);
          for (const key of ["workOrders", "billingSheets", "estimates", "wetCheckBillings"]) {
            assert.equal(billing[key].length, 1);
            assert.equal(billing[key][0].customerId, 10);
          }
        } else {
          assert.deepEqual(body, [rows[1]]);
        }
      });
    }
  }
});
