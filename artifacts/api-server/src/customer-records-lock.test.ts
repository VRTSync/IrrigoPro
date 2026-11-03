import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type RequestHandler } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { companies, customers, quickbooksIntegration, auditLog, users, insertCompanySchema } from "@workspace/db/schema";
import { QB_OWNED_CUSTOMER_FIELDS } from "@workspace/shared";
import { db, pool } from "./db";
import { storage } from "./storage";
import { logger } from "./lib/logger";
import { getCustomerRecordsLock } from "./lib/customer-records-lock";
import { registerCustomerRoutes } from "./routes/customer-routes";
import { registerCustomerRecordsRoutes } from "./routes/customer-records-routes";
import { makeRequireCustomerInTenant } from "./routes/customer-tenant-guard";

// No real company or real OAuth connection is changed. All HTTP requests hit
// real handlers/storage/tenant middleware with test-only authentication.
describe("customer records lock (real development database)", { concurrency: false }, () => {
  const companyIds: number[] = [];
  let L: number, U: number, L1: number, L2: number, U1: number, actor: number;
  let server: Server | undefined;
  let base: string;
  const action = "company.customer_records_lock_changed";
  const denied = { message: "Access denied. Company admins can only manage their own company settings." };
  const connect = { message: "Connect QuickBooks before locking customer details. While locked, customers can only arrive from QuickBooks." };
  const authenticate: RequestHandler = (req, res, next) => {
    if (!req.headers["test-role"]) { res.sendStatus(401); return; }
    req.authenticatedUserRole = String(req.headers["test-role"]);
    req.authenticatedUserCompanyId = req.headers["test-company"] ? Number(req.headers["test-company"]) : null;
    req.authenticatedUserId = actor;
    req.log = logger;
    next();
  };
  const admin: RequestHandler = (req, res, next) => {
    if (req.authenticatedUserRole !== "company_admin") { res.sendStatus(403); return; }
    next();
  };
  async function request(method: string, path: string, body?: unknown, company: number | null = L, role = "company_admin") {
    const response = await fetch(`${base}${path}`, {
      method, headers: { "content-type": "application/json", "test-role": role,
        ...(company == null ? {} : { "test-company": String(company) }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = { status: response.status, body: await response.json() as Record<string, unknown> };
    // Scoped synthetic fixtures only; no cookies, tokens, or real customer data.
    console.info("NETWORK", JSON.stringify({ method, path, request: body, ...result }));
    return result;
  }
  const settings = (id: number) => `/api/company/${id}/customer-records`;
  const customer = (id: number) => `/api/customers/${id}`;
  const auditRows = () => db.select().from(auditLog).where(and(
    eq(auditLog.action, action), inArray(auditLog.targetId, companyIds.map(String)),
  )).orderBy(auditLog.id);
  before(async () => {
    assert.notEqual(process.env.NODE_ENV, "production", "development-only fixtures");
    const migration = readFileSync(new URL("../../../lib/db/migrations/0026_customer_records_lock.sql", import.meta.url), "utf8");
    await db.execute(sql.raw(migration));
    await db.execute(sql.raw(migration));
    const ts = `${Date.now()}-${process.pid}`;
    for (const label of ["L", "U"]) {
      const [row] = await db.insert(companies).values({ name: `cr3a-${label}-${ts}` }).returning();
      companyIds.push(row.id);
      assert.equal(row.customerRecordsLocked, false);
      assert.equal(row.customerRecordsSystemName, null);
    }
    [L, U] = companyIds;
    const [user] = await db.insert(users).values({ username: `cr3a-${ts}`, name: "Lock test actor",
      password: "unused-test-password", role: "company_admin", companyId: L }).returning();
    actor = user.id;
    await db.update(companies).set({ customerRecordsLocked: true, customerRecordsSystemName: "High Plains CRM" }).where(eq(companies.id, L));
    await db.insert(quickbooksIntegration).values({ companyId: String(L), accessToken: "test", refreshToken: "test",
      realmId: `cr3a-test-${ts}`, expiresAt: new Date(Date.now() + 3600_000), connectionStatus: "connected" });
    const rows = await db.insert(customers).values([
      { companyId: L, name: "L1", email: "l1@example.invalid", quickbooksId: "501", phone: null },
      { companyId: L, name: "L2", email: "l2@example.invalid" },
      { companyId: U, name: "U1", email: "u1@example.invalid" },
    ]).returning();
    [L1, L2, U1] = rows.map(r => r.id);
    const app = express();
    app.use(express.json({ strict: false }));
    registerCustomerRoutes(app, { requireAuthentication: authenticate, requireCompanyAdminAccess: admin,
      requireCustomerEditAccess: admin, requireCustomerInTenant: makeRequireCustomerInTenant(storage),
      applyBillingNotesVisibility: (_req, data) => data });
    registerCustomerRecordsRoutes(app, { requireAuthentication: authenticate });
    server = createServer(app);
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    try {
      if (server?.listening) await new Promise<void>((resolve, reject) => server!.close(err => err ? reject(err) : resolve()));
    } finally {
      try {
        if (companyIds.length) {
          // Restore off even if an assertion failed, then remove every fixture.
          await db.update(companies).set({ customerRecordsLocked: false }).where(inArray(companies.id, companyIds));
          await db.delete(auditLog).where(inArray(auditLog.actorCompanyId, companyIds));
          await db.delete(quickbooksIntegration).where(inArray(quickbooksIntegration.companyId, companyIds.map(String)));
          await db.delete(customers).where(inArray(customers.companyId, companyIds));
          await db.delete(users).where(inArray(users.companyId, companyIds));
          await db.delete(companies).where(inArray(companies.id, companyIds));
        }
      } finally { await pool.end(); }
    }
  });
  it("1. locked create rejects before customer and curve parsing, using authenticated company", async () => {
    assert.deepEqual(await request("POST", "/api/customers", { companyId: U, budgetSeasonCurveOverride: [] }), {
      status: 403, body: { code: "CUSTOMER_RECORDS_LOCKED", message: "New customers are added in High Plains CRM." },
    });
  });
  it("2. unlocked create/edit/delete retain existing behavior", async () => {
    const created = await request("POST", "/api/customers", { name: "Temporary", email: "temp@example.invalid", companyId: L }, U);
    assert.equal(created.status, 201);
    assert.equal(created.body.companyId, U);
    const createdId = Number(created.body.id);
    assert.ok(Number.isInteger(createdId));
    assert.equal((await request("PUT", customer(createdId), { name: "Edited" }, U)).status, 200);
    assert.equal((await request("DELETE", customer(createdId), undefined, U)).status, 200);
    assert.equal(await storage.getCustomer(createdId), undefined);
  });
  it("3. full unchanged owned form allows rate/budget/notes edits and drops normalized keys", async () => {
    const current = (await storage.getCustomer(L1))!;
    const form = Object.fromEntries(QB_OWNED_CUSTOMER_FIELDS.map(f => [f, current[f] ?? ""]));
    const result = await request("PUT", customer(L1), { ...form, name: ` ${current.name} `, laborRate: "52.00",
      monthlyBudgetCap: "1000.00", billingNotes: "must be stripped", propertyNotes: "editable" });
    assert.equal(result.status, 200);
    const saved = (await storage.getCustomer(L1))!;
    assert.equal(saved.laborRate, "52.00");
    assert.equal(saved.monthlyBudgetCap, "1000.00");
    assert.equal(saved.propertyNotes, "editable");
    assert.equal(saved.billingNotes, current.billingNotes);
    for (const f of QB_OWNED_CUSTOMER_FIELDS) assert.equal(saved[f], current[f]);
  });
  it("4. PUT changing name returns exact conflict and preserves the whole row", async () => {
    const current = await storage.getCustomer(L1);
    assert.deepEqual(await request("PUT", customer(L1), { name: "Changed", laborRate: "99.00" }), {
      status: 409, body: { code: "CUSTOMER_RECORDS_LOCKED", lockedFields: ["name"],
        message: "name is managed in High Plains CRM. Edit it there." },
    });
    assert.deepEqual(await storage.getCustomer(L1), current);
  });
  it("5. PATCH treats null phone and blank as equal without writing blank", async () => {
    assert.equal((await request("PATCH", customer(L1), { phone: "", email: "l1@example.invalid" })).status, 200);
    assert.equal((await storage.getCustomer(L1))!.phone, null);
  });
  it("6. PATCH permits display name", async () => {
    assert.equal((await request("PATCH", customer(L1), { irrigoName: "Front lot" })).status, 200);
    assert.equal((await storage.getCustomer(L1))!.irrigoName, "Front lot");
  });
  it("7. unlocked customer owned details remain editable", async () => {
    assert.equal((await request("PUT", customer(U1), { name: "Changed" }, U)).status, 200);
    assert.equal((await storage.getCustomer(U1))!.name, "Changed");
  });
  it("8. locked linked deletion is rejected with exact body and preserves row", async () => {
    const current = await storage.getCustomer(L1);
    assert.deepEqual(await request("DELETE", customer(L1)), { status: 409, body: {
      code: "CUSTOMER_RECORDS_LOCKED",
      message: "This customer comes from QuickBooks. It can't be deleted in IrrigoPro while customer details are managed in High Plains CRM.",
    } });
    assert.deepEqual(await storage.getCustomer(L1), current);
  });
  it("9. locked unlinked deletion is allowed", async () => {
    assert.equal((await request("DELETE", customer(L2))).status, 200);
    assert.equal(await storage.getCustomer(L2), undefined);
  });
  it("10. all authenticated roles can GET own lock and exact connected state", async () => {
    for (const role of ["company_admin", "field_tech", "billing_manager", "bookkeeper"]) {
      assert.deepEqual(await request("GET", "/api/company/customer-records", undefined, L, role), {
        status: 200, body: { locked: true, systemName: "High Plains CRM", quickbooksConnected: true },
      });
    }
  });
  it("11. cannot turn on without connected QuickBooks", async () => {
    assert.deepEqual(await request("PUT", settings(U), { locked: true, systemName: null }, U), { status: 409, body: connect });
    assert.deepEqual(await getCustomerRecordsLock(U), { locked: false, systemName: null });
    assert.equal((await auditRows()).length, 0);
  });
  it("12. unlocking writes exactly one complete audit event", async () => {
    assert.equal((await request("PUT", settings(L), { locked: false, systemName: "High Plains CRM" })).status, 200);
    const rows = await auditRows();
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.actorUserId, actor);
    assert.equal(row.actorRole, "company_admin");
    assert.equal(row.actorCompanyId, L);
    assert.equal(row.targetType, "company");
    assert.equal(row.targetId, String(L));
    assert.equal(row.summary, "Customer records unlocked");
    assert.deepEqual(row.details, { from: { locked: true, systemName: "High Plains CRM" },
      to: { locked: false, systemName: "High Plains CRM" } });
  });
  it("13. cross-company and every non-company-admin role is denied", async () => {
    assert.deepEqual(await request("PUT", settings(L), { locked: true, systemName: null }, U), { status: 403, body: denied });
    for (const role of ["super_admin", "billing_manager", "irrigation_manager", "field_tech", "bookkeeper"]) {
      assert.deepEqual(await request("PUT", settings(L), { locked: true, systemName: null }, L, role), { status: 403, body: denied });
    }
    assert.equal((await auditRows()).length, 1);
  });
  it("cross-company customer writes are denied by the real guard before lock disclosure", async () => {
    const before = await storage.getCustomer(L1);
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      assert.deepEqual(await request(method, customer(L1), method === "DELETE" ? undefined : { name: "Changed" }, U),
        { status: 404, body: { message: "Customer not found" } });
    }
    assert.deepEqual(await storage.getCustomer(L1), before);
  });
  it("14. generic POST and partial PUT profile schemas strip both lock properties", () => {
    const malicious = { customerRecordsLocked: true, customerRecordsSystemName: "bypass" };
    assert.deepEqual(insertCompanySchema.parse({ name: "Profile", ...malicious }), { name: "Profile" });
    assert.deepEqual(insertCompanySchema.partial().parse(malicious), {});
  });
  it("strict required input validation rejects coercion, extra keys and long names without auditing", async () => {
    const before = (await auditRows()).length;
    for (const body of [{}, { locked: true }, { systemName: null }, { locked: "true", systemName: null },
      { locked: 1, systemName: null }, { locked: false, systemName: 2 },
      { locked: false, systemName: "x".repeat(61) }, { locked: false, systemName: null, extra: true }, null, []]) {
      assert.deepEqual(await request("PUT", settings(L), body), { status: 400, body: { message: "Invalid settings" } });
    }
    assert.equal((await auditRows()).length, before);
  });
  it("no-op saves do not audit, including after normalization", async () => {
    const count = (await auditRows()).length;
    assert.equal((await request("PUT", settings(L), { locked: false, systemName: " High Plains CRM " })).status, 200);
    assert.equal((await auditRows()).length, count);
  });
  it("null-company super admin and missing-company helper read unlocked", async () => {
    assert.deepEqual(await request("GET", "/api/company/customer-records", undefined, null, "super_admin"), {
      status: 200, body: { locked: false, systemName: null, quickbooksConnected: false },
    });
    assert.deepEqual(await getCustomerRecordsLock(-2147483648), { locked: false, systemName: null });
  });
  it("connected lock/create/rate/email/unlock network acceptance with scoped audit query", async () => {
    assert.deepEqual(await request("PUT", settings(L), { locked: true, systemName: "High Plains CRM" }), {
      status: 200, body: { locked: true, systemName: "High Plains CRM", quickbooksConnected: true },
    });
    assert.equal((await request("POST", "/api/customers", { name: "Blocked", email: "blocked@example.invalid" })).status, 403);
    assert.equal((await request("PUT", customer(L1), { laborRate: "53.00" })).status, 200);
    const before = await storage.getCustomer(L1);
    assert.deepEqual(await request("PUT", customer(L1), { email: "changed@example.invalid" }), { status: 409,
      body: { code: "CUSTOMER_RECORDS_LOCKED", lockedFields: ["email"], message: "email is managed in High Plains CRM. Edit it there." } });
    assert.deepEqual(await storage.getCustomer(L1), before);
    assert.equal((await request("PUT", settings(L), { locked: false, systemName: "High Plains CRM" })).status, 200);
    const rows = await auditRows();
    assert.equal(rows.length, 3);
    console.info("SCOPED AUDIT QUERY: action = company.customer_records_lock_changed AND target_id IN fixture company IDs");
    console.info("AUDIT ROWS", JSON.stringify(rows));
    assert.equal((await getCustomerRecordsLock(L)).locked, false);
  });
  it("disconnected name-only changes and unlock work; only off-to-on requires exact connected", async () => {
    await request("PUT", settings(L), { locked: true, systemName: "High Plains CRM" });
    await db.update(quickbooksIntegration).set({ connectionStatus: "reconnect_required" }).where(eq(quickbooksIntegration.companyId, String(L)));
    assert.deepEqual(await request("PUT", settings(L), { locked: true, systemName: " Renamed CRM " }), {
      status: 200, body: { locked: true, systemName: "Renamed CRM", quickbooksConnected: false },
    });
    assert.equal((await auditRows()).at(-1)!.summary, "Customer records system name changed");
    assert.deepEqual(await request("PUT", settings(L), { locked: false, systemName: " " }), {
      status: 200, body: { locked: false, systemName: null, quickbooksConnected: false },
    });
    assert.deepEqual(await request("PUT", settings(L), { locked: true, systemName: null }), { status: 409, body: connect });
    assert.equal((await request("PUT", settings(U), { locked: false, systemName: " Offline CRM " }, U)).status, 200);
    assert.equal((await getCustomerRecordsLock(U)).systemName, "Offline CRM");
    await request("PUT", settings(U), { locked: false, systemName: null }, U);
  });
  it("customer company governs super-admin edits; PATCH blocks multiple fields in constant order", async () => {
    await db.update(companies).set({ customerRecordsLocked: true, customerRecordsSystemName: " " }).where(eq(companies.id, L));
    // A separate test app permits super-admin edits to exercise the real guard's
    // cross-tenant exception without changing the product's role middleware.
    const app = express();
    app.use(express.json());
    const pass: RequestHandler = (_req, _res, next) => next();
    registerCustomerRoutes(app, { requireAuthentication: authenticate, requireCompanyAdminAccess: pass,
      requireCustomerEditAccess: pass, requireCustomerInTenant: makeRequireCustomerInTenant(storage),
      applyBillingNotesVisibility: (_req, data) => data });
    const extra = createServer(app);
    await new Promise<void>(resolve => extra.listen(0, "127.0.0.1", resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${(extra.address() as AddressInfo).port}${customer(L1)}`, {
        method: "PATCH", headers: { "content-type": "application/json", "test-role": "super_admin", "test-company": String(U) },
        body: JSON.stringify({ email: "changed@example.invalid", name: "Changed" }),
      });
      assert.equal(res.status, 409);
      assert.deepEqual(await res.json(), { code: "CUSTOMER_RECORDS_LOCKED", lockedFields: ["name", "email"],
        message: "name, email are managed in your customer system. Edit them there." });
      assert.equal((await request("POST", "/api/customers", {})).body.message, "New customers are added in your customer system.");
    } finally { await new Promise<void>((resolve, reject) => extra.close(err => err ? reject(err) : resolve())); }
    await request("PUT", settings(L), { locked: false, systemName: null });
    console.info("FINAL LOCKS", JSON.stringify({ L: await getCustomerRecordsLock(L), U: await getCustomerRecordsLock(U) }));
  });
});
