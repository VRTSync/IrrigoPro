import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Customer, InsertCustomer, InsertCustomerSyncReview } from "@workspace/db/schema";
import { QB_OWNED_CUSTOMER_FIELDS } from "@workspace/shared";
import { applyQbCustomers, buildSyncPatch, mapQbCustomer, normalizeCustomerName, rankQbCandidates } from "./qb-customer-sync";

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
  const calls = { locks: [] as number[], lookups: [] as Array<[number, string]>, creates: [] as InsertCustomer[], updates: [] as Array<[number, Partial<InsertCustomer>]>,
    reviews: [] as InsertCustomerSyncReview[], unlinkedReads: [] as number[] };
  const deps = {
    async getReviewRow(_cid: number, _qb: string): Promise<{ status: "open" | "dismissed" } | undefined> { return undefined; },
    async getUnlinkedCustomers(cid: number): Promise<Array<{ id: number; name: string }>> { calls.unlinkedReads.push(cid); return []; },
    async insertReviewRow(row: InsertCustomerSyncReview) { calls.reviews.push(row); },
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
      qbId: "101", qbParentId: null, name: "Acme", companyName: "Acme LLC", contactFirstName: "Pat", contactLastName: "Smith",
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
const fetchSource = source.slice(source.indexOf("  async function fetchActiveQbCustomers("), source.indexOf("  async function fetchQbCustomerById("));
describe("manual sync handler delegation (database-free)", () => {
  it("handler-scoped guard retains pagination and delegates without qbFields", () => {
    assert.match(handler, /runCustomerPull\(integration, "manual", pullDeps\)/);
    assert.doesNotMatch(handler, /applyQbCustomers\(/);
    assert.doesNotMatch(handler, /function qbFields/);
    assert.match(fetchSource, /WHERE Active = true STARTPOSITION/);
    assert.match(source, /fetchFull: integration => fetchActiveQbCustomers\(integration, customerPullApiBase\)/);
    assert.equal((source.match(/SELECT \* FROM Term/g) ?? []).length, 1);
    assert.match(source, /"Terms Query", integration\.realmId/);
    assert.match(handler, /payment terms not recognized:/);
  });
  it("non-OK and thrown Terms Query failures remain nonfatal through the shared pull adapter", async () => {
    const { transform } = await import("esbuild");
    const termStart = source.indexOf("  async function fetchQbTermNames(");
    const termEnd = source.indexOf("  async function fetchQbChangedCustomers(", termStart);
    const adapterStart = source.indexOf("    fetchTerms: async integration => {", source.indexOf("  const pullDeps: PullDeps"));
    const adapterEnd = source.indexOf("\n    apply:", adapterStart);
    const compiled = await transform(source.slice(termStart, termEnd) +
      `\nconst adapter = {${source.slice(adapterStart, adapterEnd)}};`, { loader: "ts", target: "es2022" });
    const create = new Function("makeQuickBooksRequest", "customerPullApiBase", `${compiled.code}; return adapter.fetchTerms;`);
    for (const failure of [503, "term transport failed", null]) {
      const requests: Array<{ url: string; operation: string; realm: string }> = [];
      const { deps, calls } = harness();
      const integration = { realmId: "sandbox-test", accessToken: "test-only-not-a-credential" };
      const request = async (url: string, _opts: unknown, operation: string, realm: string) => {
        requests.push({ url, operation, realm });
        if (typeof failure === "string") throw new Error(failure);
        return { ok: failure === null, status: failure, json: async () => ({ QueryResponse: { Term: [{ Id: "3", Name: "Net 45" }] } }) };
      };
      const fetchTerms = create(request, "https://sandbox-quickbooks.api.intuit.com");
      const termsResult = await fetchTerms(integration);
      const response = await applyQbCustomers({ companyId: 7, qbCustomers: [raw], ...termsResult, deps });
      assert.equal(response.customersAdded, 1);
      assert.equal(requests.length, 1);
      assert.ok(requests.every(request => request.realm === integration.realmId && request.url.startsWith("https://sandbox-quickbooks.api.intuit.com/")));
      assert.equal(requests[0].operation, "Terms Query");
      assert.equal(new URL(requests[0].url).searchParams.get("query"), "SELECT * FROM Term");
      assert.equal("paymentTerms" in calls.creates[0], false);
      if (failure !== null) {
        assert.equal(response.termsError, `Could not read QuickBooks terms: ${failure}`);
      } else {
        assert.deepEqual(response.unmappedTerms, ["Net 45"]);
      }
    }
  });
});

describe("create-only review guards and candidate ranking (database-free)", () => {
  it("normalizes in the specified order and removes repeated suffixes", () => {
    for (const [input, expected] of [
      ["The Cedar Ridge HOA, LLC", "cedar ridge"], ["A & B Co.", "a and b"], ["HOA", ""], ["Inc", ""],
      ["the LLC Inc co corp company ltd hoa", ""], [" ThE Cédar-Ridge! LLC ", "cdarridge"],
      ["Theory Incorporated", "theory incorporated"], ["The the Co", "the"], ["A\tB", "ab"],
    ]) assert.equal(normalizeCustomerName(input), expected);
    assert.equal(mapQbCustomer({ ParentRef: { value: " 42 " } }, null).qbParentId, "42");
    assert.equal(mapQbCustomer({ ParentRef: { value: " " } }, null).qbParentId, null);
  });
  it("holds the lowest unlinked name once, snapshots once, and gives parent priority", async () => {
    const { deps, calls } = harness();
    const rows = [{ id: 9, name: "The Cedar Ridge HOA LLC" }, { id: 7, name: "cedar ridge" }];
    deps.getUnlinkedCustomers = async cid => { calls.unlinkedReads.push(cid); return rows; };
    const summary = await applyQbCustomers({ companyId: 7, termNames: null, deps, qbCustomers: [
      { Id: "new", DisplayName: "Cedar Ridge HOA" },
      { Id: "child", DisplayName: "Cedar Ridge", ParentRef: { value: "parent" } },
      { Id: "normal", DisplayName: "Unique" }, { Id: "empty", DisplayName: "HOA" },
    ] });
    assert.deepEqual(summary.results.map(r => r.action), ["held", "held", "created", "created"]);
    assert.equal(summary.heldForReview, 2);
    assert.deepEqual(calls.unlinkedReads, [7]);
    assert.equal(calls.reviews[0].candidateCustomerId, 7);
    assert.equal(calls.reviews[0].kind, "possible_duplicate");
    assert.equal(calls.reviews[1].kind, "sub_customer");
    assert.equal(calls.reviews[1].candidateCustomerId, null);
    assert.equal(calls.reviews[1].qbParentId, "parent");
  });
  it("already-open holds and dismissed ignores precede parent/name guards without inserting", async () => {
    const { deps, calls } = harness();
    deps.getReviewRow = async (_cid, qb) => ({ status: qb === "open" ? "open" : "dismissed" });
    const summary = await applyQbCustomers({ companyId: 7, termNames: null, deps,
      qbCustomers: ["open", "dismissed"].map(Id => ({ Id, DisplayName: "Acme", ParentRef: { value: "p" } })) });
    assert.deepEqual(summary.results.map(r => r.action), ["held", "ignored"]);
    assert.equal(summary.heldForReview, 1);
    assert.equal(summary.ignored, 1);
    assert.equal(calls.reviews.length + calls.creates.length, 0);
  });
  it("linked customers update despite parent, dismissed review, and matching local name", async () => {
    const { deps, calls } = harness({ "101": customer({ phone: "old" }) });
    deps.getReviewRow = async () => { throw new Error("create-only lookup must not run"); };
    deps.getUnlinkedCustomers = async () => [{ id: 7, name: "Acme" }];
    const summary = await applyQbCustomers({ companyId: 7, termNames: terms, deps,
      qbCustomers: [{ ...raw, ParentRef: { value: "parent" } }] });
    assert.equal(summary.customersUpdated, 1);
    assert.equal(summary.heldForReview, 0);
    assert.equal(calls.updates.length, 1);
  });
  it("exclusion storage contract and creations do not alter the unlinked snapshot", async () => {
    const { deps, calls } = harness();
    // Flagged customers are absent from this storage contract.
    deps.getUnlinkedCustomers = async cid => { calls.unlinkedReads.push(cid); return [{ id: 3, name: "HOA" }]; };
    const summary = await applyQbCustomers({ companyId: 7, termNames: null, deps,
      qbCustomers: [{ Id: "1", DisplayName: "Excluded" }, { Id: "2", DisplayName: "Excluded LLC" }, { Id: "3", DisplayName: "Inc" }] });
    assert.equal(summary.customersAdded, 3);
    assert.deepEqual(calls.unlinkedReads, [7]);
  });
  it("review insertion failures are isolated to one raw row", async () => {
    const { deps } = harness();
    deps.insertReviewRow = async () => { throw new Error("insert failed"); };
    const summary = await applyQbCustomers({ companyId: 7, termNames: null, deps, qbCustomers: [
      { Id: "1", DisplayName: "Child", ParentRef: { value: "p" } }, { Id: "2", DisplayName: "Other" }, {},
    ] });
    assert.deepEqual(summary.results.map(r => r.action), ["error", "created"]);
    assert.equal(summary.totalCustomers, 3);
    assert.equal(summary.heldForReview, 0);
  });
  it("ranks best alias Jaccard, address boosts, threshold, tie order and limits without empty-name matches", () => {
    const qb = (qbId: string, name: string, zip = "", street = "") => ({ ...mapped(), qbId, name, zip, street });
    const local = { name: "Cedar Ridge", irrigoName: "Alternate", zip: "80202", street: "12 Main St." };
    const ranked = rankQbCandidates(local, [
      qb("zip", "Zebra", "80202"), qb("exact", "Cedar Ridge"), qb("drop", "Unrelated"),
      qb("street", "Alpha", "", "12 main st"), qb("alias", "Alternate"),
    ]);
    assert.deepEqual(ranked.map(r => [r.qbId, r.score]), [["alias", 1], ["exact", 1], ["street", 0.3], ["zip", 0.3]]);
    assert.equal(rankQbCandidates(local, [qb("1", "Cedar Ridge"), qb("2", "Alternate")], 1).length, 1);
    assert.deepEqual(rankQbCandidates({ name: "HOA", irrigoName: "Inc", zip: "", street: "" }, [qb("1", "LLC")]), []);
    assert.equal(rankQbCandidates({ ...local, zip: "", street: "" }, [qb("1", "Cedar Ridge Estates")])[0].score, 2 / 3);
    assert.equal(rankQbCandidates(local, Array.from({ length: 8 }, (_, n) => qb(String(n), "Cedar Ridge"))).length, 5);
    assert.equal(rankQbCandidates(local, [qb("boost", "Cedar Ridge", "80202", "12 Main St_")])[0].score, 1.6);
  });
});

describe("shared QuickBooks customer reads (injected transport, no database)", () => {
  async function readers(request: (...args: any[]) => Promise<unknown>) {
    const { transform } = await import("esbuild");
    const singleSource = source.slice(source.indexOf("  async function fetchQbCustomerById("), source.indexOf("  async function fetchQbTermNames("));
    const compiled = await transform(fetchSource + singleSource, { loader: "ts", target: "es2022" });
    return new Function("makeQuickBooksRequest", "console", `${compiled.code}; return { fetchActiveQbCustomers, fetchQbCustomerById };`)(
      request, { log() {}, error() {} });
  }
  it("pages active customers with 1000 rows, same realm/auth/base and refresh-aware transport", async () => {
    const calls: any[][] = [];
    const helpers = await readers(async (...args: any[]) => {
      calls.push(args);
      return { ok: true, json: async () => ({ QueryResponse: { Customer: calls.length === 1
        ? Array.from({ length: 1000 }, (_, n) => ({ Id: String(n) })) : [{ Id: "last" }] } }) };
    });
    const result = await helpers.fetchActiveQbCustomers({ realmId: "realm", accessToken: "fixture" }, "https://sandbox-quickbooks.api.intuit.com");
    assert.equal(result.customers.length, 1001);
    assert.equal(calls.length, 2);
    assert.equal(new URL(calls[0][0]).searchParams.get("query"), "SELECT * FROM Customer WHERE Active = true STARTPOSITION 1 MAXRESULTS 1000");
    assert.equal(new URL(calls[1][0]).searchParams.get("query"), "SELECT * FROM Customer WHERE Active = true STARTPOSITION 1001 MAXRESULTS 1000");
    for (const [url, options, operation, realm] of calls) {
      assert.ok(url.startsWith("https://sandbox-quickbooks.api.intuit.com/v3/company/realm/"));
      assert.equal(options.headers.Authorization, "Bearer fixture");
      assert.equal(operation, "Customers Query");
      assert.equal(realm, "realm");
    }
  });
  it("preserves authorization/reconnection and 500/TID results", async () => {
    for (const status of [401, 403, 500]) {
      const helpers = await readers(async () => ({ ok: false, status, text: async () => "failure",
        headers: { get: () => "fixture-tid" } }));
      const result = await helpers.fetchActiveQbCustomers({ realmId: "realm", accessToken: "fixture" }, "https://quickbooks.api.intuit.com");
      assert.deepEqual(result, status === 401 || status === 403 ? {
        ok: false, status: 403, message: "QuickBooks authorization expired or invalid. Please reconnect to QuickBooks.", needsReconnection: true,
      } : { ok: false, status: 500, message: "Failed to fetch customers from QuickBooks: 500 [TID: fixture-tid]" });
    }
  });
  it("uses the encoded single-customer endpoint and the selected realm, not a second query", async () => {
    const calls: any[][] = [];
    const helpers = await readers(async (...args: any[]) => {
      calls.push(args);
      return { ok: true, json: async () => ({ Customer: raw }) };
    });
    const result = await helpers.fetchQbCustomerById({ realmId: "selected", accessToken: "fixture" },
      "https://quickbooks.api.intuit.com", "id/with space");
    assert.deepEqual(result, { ok: true, customer: raw });
    assert.equal(calls[0][0], "https://quickbooks.api.intuit.com/v3/company/selected/customer/id%2Fwith%20space");
    assert.deepEqual(calls[0].slice(2), ["Customer Read", "selected"]);
  });
});
