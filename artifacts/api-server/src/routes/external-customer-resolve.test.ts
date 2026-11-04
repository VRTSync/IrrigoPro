import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Customer, InsertCustomer } from "@workspace/db";
import type { ExternalCustomerDeps, ExternalCustomerInput } from "./customer-records-routes";

// Isolate initialization, not the resolver: importing storage would start
// migrations even though every resolver dependency below is an in-memory stub.
mock.module("../db", { namedExports: { db: {} } });
mock.module("../storage", { namedExports: { storage: {} } });
mock.module("../lib/customer-records-lock", { namedExports: {
  getCustomerRecordsLock: () => { throw new Error("Unexpected real lock reader"); },
} });
mock.module("./audit-log", { namedExports: {
  recordAuditEvent: () => { throw new Error("Unexpected audit write"); },
} });
const { resolveExternalCustomer } = await import("./customer-records-routes");

function fixture(locked: boolean, systemName: string | null = "High Plains CRM") {
  // Only the fields consumed by this helper matter; no DB/schema defaults run.
  const customers = [
    { id: 1, companyId: 7, name: "A", email: "ops@acme.test", quickbooksId: "301" },
    { id: 2, companyId: 7, name: "B", email: "OPS@acme.test", quickbooksId: null },
    { id: 3, companyId: 7, name: "Cedar HOA", email: "cedar@x.test", quickbooksId: null },
  ] as Customer[];
  const calls: { locks: number[]; qb: [number, string][]; lists: number[]; creates: InsertCustomer[]; order: string[] } =
    { locks: [], qb: [], lists: [], creates: [], order: [] };
  const deps: ExternalCustomerDeps = {
    async getCustomerRecordsLock(cid) {
      calls.locks.push(cid); calls.order.push("lock");
      return { locked, systemName };
    },
    async getCustomerByQuickBooksId(cid, qb) {
      calls.qb.push([cid, qb]); calls.order.push("qb");
      return customers.find(c => c.companyId === cid && c.quickbooksId === qb);
    },
    async getCustomers(cid) {
      calls.lists.push(cid); calls.order.push("list");
      return customers.filter(c => c.companyId === cid);
    },
    async createCustomer(data) {
      calls.creates.push(data); calls.order.push("create");
      return { ...data, id: 99 } as Customer;
    },
  };
  return { customers, calls, deps, resolve: (input: ExternalCustomerInput) => resolveExternalCustomer(7, input, deps) };
}

const notFound = (label: string) => ({
  ok: false, status: 422, body: { error: "CUSTOMER_NOT_FOUND",
    message: `No customer matches. Customer details for this company are managed in ${label}; the customer must exist in QuickBooks and be synced to IrrigoPro first. Send customer.quickbooksId.` },
});

describe("external customer resolver — attachment cases", () => {
  for (const [number, locked] of [[1, true], [9, false]] as const) {
    it(`${number}. QuickBooks ID wins over conflicting email and name`, async () => {
      const f = fixture(locked);
      assert.deepEqual(await f.resolve({ name: "Cedar HOA", email: "cedar@x.test", quickbooksId: "301" }),
        { ok: true, customer: f.customers[0], created: false });
      assert.deepEqual(f.calls, { locks: [7], qb: [[7, "301"]], lists: [], creates: [], order: ["lock", "qb"] });
    });
  }
  it("2. locked email comparison trims and ignores case", async () => {
    const f = fixture(true);
    assert.deepEqual(await f.resolve({ name: "x", email: " cedar@X.test " }),
      { ok: true, customer: f.customers[2], created: false });
    assert.deepEqual(f.calls.locks, [7]);
    assert.deepEqual(f.calls.lists, [7]);
    assert.deepEqual(f.calls.creates, []);
  });
  it("3. locked duplicate email returns exact ambiguity without creation", async () => {
    const f = fixture(true);
    assert.deepEqual(await f.resolve({ name: "x", email: "ops@acme.test" }), {
      ok: false, status: 409, body: { error: "CUSTOMER_AMBIGUOUS",
        message: "2 customers share the email ops@acme.test. Send customer.quickbooksId." },
    });
    assert.deepEqual(f.calls.creates, []);
  });
  it("4. locked name alone never matches; exact system-labelled error", async () => {
    const f = fixture(true);
    assert.deepEqual(await f.resolve({ name: "Cedar HOA" }), notFound("High Plains CRM"));
    assert.deepEqual(f.calls.creates, []);
  });
  it("5. locked unknown QB ID and email never create", async () => {
    const f = fixture(true);
    assert.deepEqual(await f.resolve({ name: "x", quickbooksId: "999", email: "nobody@x.test" }), notFound("High Plains CRM"));
    assert.deepEqual(f.calls.qb, [[7, "999"]]);
    assert.deepEqual(f.calls.order, ["lock", "qb", "list"]);
    assert.deepEqual(f.calls.creates, []);
  });
  it("6. unlocked duplicate email keeps first-match behavior", async () => {
    const f = fixture(false);
    assert.deepEqual(await f.resolve({ name: "x", email: "ops@acme.test" }),
      { ok: true, customer: f.customers[0], created: false });
    assert.deepEqual(f.calls.creates, []);
  });
  it("7. unlocked case-insensitive name match", async () => {
    const f = fixture(false);
    assert.deepEqual(await f.resolve({ name: "cedar hoa" }),
      { ok: true, customer: f.customers[2], created: false });
    assert.deepEqual(f.calls.creates, []);
  });
  it("8. unlocked creates once with the exact unchanged payload, never QuickBooks ID", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-04T12:00:00.000Z") });
    const f = fixture(false);
    const result = await f.resolve({ name: "New Place", email: "new@x.test", phone: "123", address: "New Street", quickbooksId: "999" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.customer.id, 99);
    assert.equal(result.created, true);
    assert.deepEqual(f.calls.creates, [{
      companyId: 7, name: "New Place", email: "new@x.test", phone: "123", address: "New Street",
      notes: "Created via API integration on 2026-11-04T12:00:00.000Z",
    }]);
    assert.deepEqual(f.calls.locks, [7]);
    assert.deepEqual(f.calls.lists, [7]);
  });
  it("10. both lock modes pass company 7 and QB ID 301 to scoped lookup", async () => {
    for (const locked of [true, false]) {
      const f = fixture(locked);
      await f.resolve({ name: "x", quickbooksId: "301" });
      assert.deepEqual(f.calls.qb, [[7, "301"]]);
    }
  });
});

describe("external customer resolver edge contracts", () => {
  it("trims stored as well as incoming email in both modes", async () => {
    for (const locked of [true, false]) {
      const f = fixture(locked);
      f.customers[2].email = "  cedar@X.test  ";
      assert.deepEqual(await f.resolve({ name: "x", email: " CEDAR@x.test " }),
        { ok: true, customer: f.customers[2], created: false });
      assert.deepEqual(f.calls.creates, []);
    }
  });
  it("unknown QB ID falls back to email in both modes", async () => {
    for (const locked of [true, false]) {
      const f = fixture(locked);
      assert.deepEqual(await f.resolve({ name: "x", quickbooksId: "999", email: "cedar@x.test" }),
        { ok: true, customer: f.customers[2], created: false });
      assert.deepEqual(f.calls.order, ["lock", "qb", "list"]);
    }
  });
  it("unlocked unknown QB ID falls back to name; name matching remains untrimmed", async () => {
    const f = fixture(false);
    assert.deepEqual(await f.resolve({ name: "cedar hoa", quickbooksId: "999" }),
      { ok: true, customer: f.customers[2], created: false });
    const result = await f.resolve({ name: " Cedar HOA " });
    assert.ok(result.ok && result.created);
    assert.deepEqual(f.calls.creates[0], {
      companyId: 7, name: " Cedar HOA ", email: "", phone: undefined, address: undefined,
      notes: f.calls.creates[0].notes,
    });
    assert.match(f.calls.creates[0].notes!, /^Created via API integration on \d{4}-\d\d-\d\dT/);
  });
  it("missing or blank system name uses the shared label fallback", async () => {
    for (const label of [null, "  "]) {
      const f = fixture(true, label);
      assert.deepEqual(await f.resolve({ name: "unknown" }), notFound("your customer system"));
      assert.deepEqual(f.calls.creates, []);
    }
  });
  it("foreign-company QB IDs, emails, and names cannot match", async () => {
    const f = fixture(true);
    f.customers.push({ id: 4, companyId: 8, name: "Foreign", email: "foreign@x.test", quickbooksId: "foreign" } as Customer);
    assert.deepEqual(await f.resolve({ name: "Foreign", email: "foreign@x.test", quickbooksId: "foreign" }), notFound("High Plains CRM"));
    assert.deepEqual(f.calls.creates, []);
  });
});

const source = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const start = source.indexOf('app.post("/api/external/work-orders",');
const end = source.indexOf('app.get("/api/external/work-orders/:workOrderId"', start);
assert.ok(start >= 0 && end > start, "POST handler boundaries must exist");
const handler = source.slice(start, end);

describe("real external POST handler source guard", () => {
  it("delegates to the real resolver with scoped storage and exits before downstream writes", () => {
    assert.match(handler, /resolveExternalCustomer\(companyId, customer,/);
    assert.doesNotMatch(handler, /storage\.createCustomer\(\s*\{/);
    assert.doesNotMatch(handler, /await storage\.getCustomers\(/);
    assert.match(handler, /getCustomerByQuickBooksId: \(cid, qb\) => storage\.getCustomerByQuickBooksId\(cid, qb\)/);
    assert.match(handler, /if \(!resolved\.ok\) \{\s*res\.status\(resolved\.status\)\.json\(resolved\.body\);\s*return;\s*\}/);
    assert.ok(handler.indexOf("if (!resolved.ok)") < handler.indexOf("storage.createWorkOrder("));
    assert.ok(handler.indexOf("if (!resolved.ok)") < handler.indexOf("storage.createNotification("));
    assert.match(handler, /const existingCustomer = resolved\.created \? null : resolved\.customer/);
    assert.match(handler, /const customerId = resolved\.customer\.id/);
    assert.match(handler, /customerCreated: !existingCustomer/);
    assert.match(handler, /requireApiKey, async/);
  });
  it("actual inline schema accepts optional trimmed ID and rejects blank IDs through existing validation", () => {
    const schemaStart = handler.indexOf("const externalWorkOrderSchema = ");
    const schemaEnd = handler.indexOf("const validationResult", schemaStart);
    assert.ok(schemaStart >= 0 && schemaEnd > schemaStart);
    // Evaluate only the real, JS-compatible Zod declaration, never routes.ts.
    const schema = new Function("z", `${handler.slice(schemaStart, schemaEnd)} return externalWorkOrderSchema;`)(z);
    const body = { customer: { name: "x" }, workOrder: { title: "test" } };
    assert.equal(schema.safeParse(body).success, true);
    assert.equal(schema.parse({ ...body, customer: { name: "x", quickbooksId: " 301 " } }).customer.quickbooksId, "301");
    for (const quickbooksId of ["", "   ", 301, null]) {
      assert.equal(schema.safeParse({ ...body, customer: { name: "x", quickbooksId } }).success, false);
    }
    assert.match(handler, /if \(!validationResult\.success\) \{\s*res\.status\(400\)\.json\(\{\s*error: "VALIDATION_ERROR"/);
  });
});
