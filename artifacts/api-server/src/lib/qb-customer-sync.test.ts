import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Customer, InsertCustomer } from "@workspace/db/schema";
import { QB_OWNED_CUSTOMER_FIELDS } from "@workspace/shared";
import { applyQbCustomers, buildSyncPatch, mapQbCustomer } from "./qb-customer-sync";

const terms = new Map([["3", "Net 30"], ["9", "Net 45"]]);
const raw = {
  Id: " 101 ", DisplayName: " Acme ", CompanyName: " Acme LLC ", GivenName: " Pat ", FamilyName: " Smith ",
  PrimaryEmailAddr: { Address: " a@example.invalid " }, PrimaryPhone: { FreeFormNumber: " 111 " },
  Mobile: { FreeFormNumber: " 222 " },
  BillAddr: { Line1: " 1 Main St ", Line2: " Ste 2 ", Line3: " ", City: " Denver ", CountrySubDivisionCode: " CO ", PostalCode: " 80202 ", Country: " US " },
  ShipAddr: { Line1: " 2 Service St ", Line2: " Floor 3 ", Line3: " Unit B ", City: " Boulder ", CountrySubDivisionCode: " CO ", PostalCode: " 80301 " },
  SalesTermRef: { value: "3", name: "Do not use" }, MetaData: { LastUpdatedTime: "2026-11-03T12:00:00Z" },
};
const mapped = () => mapQbCustomer(raw, terms);
function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 1, companyId: 7,
    ...Object.fromEntries(QB_OWNED_CUSTOMER_FIELDS.map(field => [field, mapped()[field]])),
    qbLastUpdatedAt: mapped().qbLastUpdatedAt, ...overrides,
  } as Customer;
}
function harness(existing: Record<string, Customer> = {}, locked = true) {
  const calls = { locks: [] as number[], lookups: [] as Array<[number, string]>, creates: [] as InsertCustomer[], updates: [] as Array<[number, Partial<InsertCustomer>]> };
  const deps = {
    async getCustomerRecordsLock(id: number) { calls.locks.push(id); return { locked }; },
    async getCustomerByQuickBooksId(cid: number, id: string) { calls.lookups.push([cid, id]); return existing[id]; },
    async createCustomer(data: InsertCustomer) { calls.creates.push(data); return customer({ ...data, id: 99 }); },
    async updateCustomer(id: number, data: Partial<InsertCustomer>) { calls.updates.push([id, data]); return customer({ ...data, id }); },
  };
  return { calls, deps };
}

describe("QuickBooks customer mapping and application (database-free)", () => {
  it("1. maps every field with trimmed address lines and country-free legacy address", () => {
    assert.deepEqual(mapped(), {
      qbId: "101", name: "Acme", companyName: "Acme LLC", contactFirstName: "Pat", contactLastName: "Smith",
      email: "a@example.invalid", phone: "111", mobilePhone: "222",
      street: "1 Main St, Ste 2", city: "Denver", state: "CO", zip: "80202", country: "US",
      address: "1 Main St, Ste 2 Denver CO 80202", serviceStreet: "2 Service St, Floor 3, Unit B",
      serviceCity: "Boulder", serviceState: "CO", serviceZip: "80301", paymentTerms: "net_30",
      termName: "Net 30", qbLastUpdatedAt: new Date("2026-11-03T12:00:00Z"),
    });
  });
  it("2. never guesses unknown, absent, unresolved or unavailable terms from display name", () => {
    const unknown = mapQbCustomer({ ...raw, SalesTermRef: { value: "9" } }, terms);
    assert.equal(unknown.paymentTerms, null);
    assert.equal(unknown.termName, "Net 45");
    assert.equal(mapQbCustomer({ ...raw, SalesTermRef: undefined }, terms).paymentTerms, undefined);
    assert.equal(mapQbCustomer(raw, null).paymentTerms, undefined);
    assert.equal(mapQbCustomer({ ...raw, SalesTermRef: { value: "missing", name: "Net 15" } }, terms).paymentTerms, undefined);
    for (const [name, value] of [[" nEt 30 ", "net_30"], [" NET 15 ", "net_15"], [" due ON receipt ", "due_on_receipt"]]) {
      assert.equal(mapQbCustomer(raw, new Map([["3", name]])).paymentTerms, value);
    }
  });
  it("3. falls back to CompanyName then FullyQualifiedName, never Name", () => {
    assert.equal(mapQbCustomer({ DisplayName: " ", CompanyName: " Acme " }, null).name, "Acme");
    assert.equal(mapQbCustomer({ FullyQualifiedName: " Parent:Child ", Name: "wrong" }, null).name, "Parent:Child");
    assert.equal(mapQbCustomer({ Name: "wrong" }, null).name, "");
    assert.equal(mapQbCustomer({}, null).phone, "");
    assert.equal(mapQbCustomer({ MetaData: { LastUpdatedTime: "invalid" } }, null).qbLastUpdatedAt, null);
  });
  it("4. locked clears an emptied mobile to SQL null", () => {
    const result = buildSyncPatch(customer({ mobilePhone: "555" }), { ...mapped(), mobilePhone: "" }, true);
    assert.deepEqual(result, { patch: { mobilePhone: null }, ownedChanged: true });
  });
  it("5. locked clears required email to an empty string", () => {
    assert.deepEqual(buildSyncPatch(customer(), { ...mapped(), email: "" }, true).patch, { email: "" });
  });
  it("6. unlocked preserves local phone and fills an empty company name only", () => {
    assert.deepEqual(buildSyncPatch(customer({ phone: "111", companyName: null }), { ...mapped(), phone: "222" }, false),
      { patch: { companyName: "Acme LLC" }, ownedChanged: true });
  });
  it("7. both modes preserve terms for null and undefined mappings", () => {
    for (const locked of [true, false]) for (const paymentTerms of [null, undefined]) {
      assert.equal("paymentTerms" in buildSyncPatch(customer(), { ...mapped(), paymentTerms }, locked).patch, false);
    }
  });
  it("8. timestamp-only changes persist without owned changes in both modes", () => {
    for (const locked of [true, false]) {
      assert.deepEqual(buildSyncPatch(customer({ qbLastUpdatedAt: null }), mapped(), locked),
        { patch: { qbLastUpdatedAt: mapped().qbLastUpdatedAt }, ownedChanged: false });
    }
  });
  it("9. whitespace and nullish values normalize to an empty patch", () => {
    const current = customer();
    for (const field of QB_OWNED_CUSTOMER_FIELDS) Object.assign(current, { [field]: ` ${mapped()[field]} ` });
    assert.deepEqual(buildSyncPatch(current, mapped(), true), { patch: {}, ownedChanged: false });
    assert.deepEqual(buildSyncPatch(customer({ mobilePhone: null }), { ...mapped(), mobilePhone: "" }, true).patch, {});
  });
  it("10. creates, updates, skips unchanged writes and nameless rows with one scoped lock read", async () => {
    const { deps, calls } = harness({ changed: customer({ phone: "old" }), same: customer() });
    const summary = await applyQbCustomers({ companyId: 7, termNames: terms,
      qbCustomers: [{ ...raw, Id: "new" }, { ...raw, Id: "changed" }, { ...raw, Id: "same" }, { Id: "blank" }], deps });
    assert.deepEqual([summary.customersAdded, summary.customersUpdated, summary.customersUnchanged, summary.totalCustomers], [1, 1, 1, 4]);
    assert.deepEqual(summary.results.map(r => r.action), ["created", "updated", "unchanged"]);
    assert.deepEqual(calls.locks, [7]);
    assert.deepEqual(calls.lookups, [[7, "new"], [7, "changed"], [7, "same"]]);
    assert.equal(calls.creates[0].companyId, 7);
    assert.equal(calls.creates[0].quickbooksId, "new");
    for (const field of QB_OWNED_CUSTOMER_FIELDS) assert.equal(calls.creates[0][field], mapped()[field]);
    assert.deepEqual(calls.creates[0].qbLastUpdatedAt, mapped().qbLastUpdatedAt);
    assert.equal(calls.updates.length, 1);
  });
  it("11. row failures do not stop subsequent rows", async () => {
    const { deps } = harness({ bad: customer({ phone: "old" }) });
    deps.updateCustomer = async () => { throw new Error("row failed"); };
    const summary = await applyQbCustomers({ companyId: 7, termNames: terms, deps,
      qbCustomers: [{ ...raw, Id: "bad" }, { ...raw, Id: "good" }] });
    assert.deepEqual(summary.results.map(r => r.action), ["error", "created"]);
    assert.equal(summary.results[0].error, "row failed");
    assert.equal(summary.customersUpdated, 0);
  });
  it("12. deduplicates unsupported names and preserves creation defaults", async () => {
    const { deps, calls } = harness();
    const summary = await applyQbCustomers({ companyId: 7, termNames: terms, deps,
      qbCustomers: [{ ...raw, SalesTermRef: { value: "9" } }, { ...raw, Id: "102", SalesTermRef: { value: "9" } }] });
    assert.deepEqual(summary.unmappedTerms, ["Net 45"]);
    assert.ok(calls.creates.every(data => !("paymentTerms" in data)));
    const empty = harness();
    await applyQbCustomers({ companyId: 7, termNames: null, deps: empty.deps, qbCustomers: [{ Id: "103", DisplayName: "Minimal" }] });
    assert.deepEqual(empty.calls.creates[0], { companyId: 7, quickbooksId: "103", name: "Minimal", email: "", qbLastUpdatedAt: null });
  });
  it("persists timestamp-only updates as unchanged and propagates nonfatal termsError", async () => {
    for (const locked of [true, false]) {
      const { deps, calls } = harness({ "101": customer({ qbLastUpdatedAt: null }) }, locked);
      const summary = await applyQbCustomers({ companyId: 7, termNames: null, deps, qbCustomers: [raw], termsError: "Could not read QuickBooks terms: 503" });
      assert.equal(summary.customersUpdated, 0);
      assert.equal(summary.customersUnchanged, 1);
      assert.equal(summary.results[0].action, "unchanged");
      assert.deepEqual(calls.updates[0][1], { qbLastUpdatedAt: mapped().qbLastUpdatedAt });
      assert.equal(summary.termsError, "Could not read QuickBooks terms: 503");
    }
  });
});

// Execute only the real registered handler body with injected dependencies.
// No routes import, database, credentials, or network is needed.
const source = readFileSync(new URL("../routes/routes.ts", import.meta.url), "utf8");
const handler = source.slice(source.indexOf('app.post("/api/quickbooks/sync-customers"'), source.indexOf('\n  });', source.indexOf('app.post("/api/quickbooks/sync-customers"')));
describe("manual sync handler delegation (database-free)", () => {
  it("handler-scoped guard retains pagination and delegates without qbFields", () => {
    assert.match(handler, /applyQbCustomers\(/);
    assert.doesNotMatch(handler, /function qbFields/);
    assert.match(handler, /WHERE Active = true STARTPOSITION/);
    assert.equal((handler.match(/SELECT \* FROM Term/g) ?? []).length, 1);
    assert.match(handler, /"Terms Query", integration\.realmId/);
    assert.match(handler, /payment terms not recognized:/);
  });
  it("non-OK and thrown Terms Query failures still sync customers through the same module", async () => {
    const { transform } = await import("esbuild");
    const body = handler.slice(handler.indexOf("async (req, res) => {") + "async (req, res) => {".length);
    const compiled = await transform(`async function run(req, res) {${body}\n}`, { loader: "ts", target: "es2022" });
    const create = new Function("resolveCompanyId", "storage", "makeQuickBooksRequest", "applyQbCustomers", "getCustomerRecordsLock", "process", "console", `${compiled.code}; return run;`);
    for (const failure of [503, "term transport failed", null]) {
      const requests: Array<{ url: string; operation: string; realm: string }> = [];
      const { deps, calls } = harness();
      const integration = { realmId: "sandbox-test", accessToken: "test-only-not-a-credential" };
      const run = create(() => 7, {
        getQuickBooksIntegrationByCompanyId: async () => integration,
        getQuickBooksIntegration: async () => integration,
        ...deps,
      }, async (url: string, _opts: unknown, operation: string, realm: string) => {
        requests.push({ url, operation, realm });
        if (operation === "Customers Query") return { ok: true, json: async () => ({ QueryResponse: { Customer: [raw] } }) };
        if (typeof failure === "string") throw new Error(failure);
        return { ok: failure === null, status: failure, json: async () => ({ QueryResponse: { Term: [{ Id: "3", Name: "Net 45" }] } }) };
      }, applyQbCustomers, deps.getCustomerRecordsLock, { env: { NODE_ENV: "development" } }, { log() {}, error() {} });
      let response: Record<string, unknown> = {};
      await run({}, { json(value: Record<string, unknown>) { response = value; }, status() { throw new Error("Unexpected HTTP error"); } });
      assert.equal(response.success, true);
      assert.equal(response.customersAdded, 1);
      assert.equal(requests.length, 2);
      assert.ok(requests.every(request => request.realm === integration.realmId && request.url.startsWith("https://sandbox-quickbooks.api.intuit.com/")));
      assert.equal(requests[1].operation, "Terms Query");
      assert.equal(new URL(requests[1].url).searchParams.get("query"), "SELECT * FROM Term");
      assert.equal("paymentTerms" in calls.creates[0], false);
      if (failure !== null) {
        assert.equal(response.termsError, `Could not read QuickBooks terms: ${failure}`);
        assert.equal(response.message, "1 added, 0 updated, 0 unchanged");
      } else {
        assert.equal(response.message, "1 added, 0 updated, 0 unchanged; payment terms not recognized: Net 45");
      }
    }
  });
});
