// Unit tests for stored-ID-only invoice sync and refuse-only collision guards.
//
// All QB network calls are stubbed via the `makeRequest` / `lookupServiceItem`
// injection points so no real QB credentials or network access is required.
//
// Coverage includes ownership refusals, strict reader failures, scoped queries,
// stale-token retry, creation, and original invoice / due-date preservation.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  readQbCustomTxnNumbers,
  findQbInvoiceIdsByDocNumber,
  qbDocNumberMismatch,
  getQbInvoiceById,
  findQbInvoicesByDocNumberForCustomer,
  syncAppInvoiceToQb,
  fetchQbSyncToken,
  buildAndPostQbInvoice,
  updateQbInvoiceInPlace,
} from "./qb-invoice-ops";
import { checkQbCustomTxnNumbersCached, QB_CUSTOM_TXN_DISABLED, QB_SESSION_EXPIRED } from "./qb-invoice-preflight";
import type { QbMakeRequestFn, QbLookupServiceItemFn } from "./qb-invoice-ops";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const API_BASE = "https://sandbox-quickbooks.api.intuit.com";
const REALM = "9341454288879252";
const INTEGRATION = { realmId: REALM, accessToken: "test-token" };

const MOCK_SERVICE_ITEM: QbLookupServiceItemFn = async () => ({
  id: "1",
  name: "Irrigation Services",
});

const MOCK_CUSTOMER = {
  quickbooksId: "42",
  name: "Acme Corp",
};

const QB_LINES = [{ amount: 150.0, description: "Irrigation service" }];

describe("IR number guard primitives", () => {
  for (const [label, body, expected] of [
    ["true", { Preferences: { SalesFormsPrefs: { CustomTxnNumbers: true } } }, true],
    ["false", { Preferences: { SalesFormsPrefs: { CustomTxnNumbers: false } } }, false],
    ["missing", {}, false],
    ["truthy string", { Preferences: { SalesFormsPrefs: { CustomTxnNumbers: "true" } } }, false],
  ] as const) {
    it(`reads CustomTxnNumbers: ${label}`, async () => {
      const request: QbMakeRequestFn = async (url, opts, _operation, realm) => {
        assert.equal(url, `${API_BASE}/v3/company/${REALM}/preferences?minorversion=73`);
        assert.equal(opts?.method, "GET");
        assert.equal(realm, REALM);
        return makeJsonResponse(body);
      };
      assert.equal(await readQbCustomTxnNumbers(request, API_BASE, INTEGRATION), expected);
    });
  }
  it("propagates settings auth, HTTP, network and malformed JSON failures", async () => {
    assert.equal(await readQbCustomTxnNumbers(async () => makeJsonResponse({}, 401), API_BASE, INTEGRATION), "auth_error");
    for (const status of [404, 429, 500]) {
      await assert.rejects(() => readQbCustomTxnNumbers(async () => makeJsonResponse({}, status), API_BASE, INTEGRATION));
    }
    await assert.rejects(() => readQbCustomTxnNumbers(async () => { throw new Error("timeout"); }, API_BASE, INTEGRATION), /timeout/);
    await assert.rejects(() => readQbCustomTxnNumbers(async () => new Response("{"), API_BASE, INTEGRATION));
  });
  it("searches company-wide with escaped number, requesting only IDs", async () => {
    const request: QbMakeRequestFn = async url => {
      const query = new URL(url).searchParams.get("query");
      assert.equal(query, "SELECT Id FROM Invoice WHERE DocNumber = 'IR-1001\\\\\\''");
      assert.ok(!url.includes("CustomerRef"));
      return makeJsonResponse({ QueryResponse: { Invoice: [{ Id: "900" }, { Id: "901" }] } });
    };
    assert.deepEqual(await findQbInvoiceIdsByDocNumber(request, API_BASE, INTEGRATION, "IR-1001\\'"), ["900", "901"]);
    assert.deepEqual(await findQbInvoiceIdsByDocNumber(async () => makeJsonResponse({}), API_BASE, INTEGRATION, "IR-1001"), []);
    assert.equal(await findQbInvoiceIdsByDocNumber(async () => makeJsonResponse({}, 401), API_BASE, INTEGRATION, "IR-1001"), "auth_error");
    for (const status of [404, 429, 500]) {
      await assert.rejects(() => findQbInvoiceIdsByDocNumber(async () => makeJsonResponse({}, status), API_BASE, INTEGRATION, "IR-1001"));
    }
    await assert.rejects(() => findQbInvoiceIdsByDocNumber(async () => { throw new Error("timeout"); }, API_BASE, INTEGRATION, "IR-1001"), /timeout/);
  });
  it("records only differing, present returned numbers", () => {
    assert.equal(qbDocNumberMismatch("IR-1001", "1034"), "1034");
    for (const returned of ["IR-1001", "", null, undefined]) assert.equal(qbDocNumberMismatch("IR-1001", returned), null);
  });
});

describe("Custom transaction numbers true-only realm cache", () => {
  it("isolates realms and expires true at exactly ten minutes", async () => {
    let now = 10;
    let reads = 0;
    const cache = new Map<string, number>();
    const request: QbMakeRequestFn = async () => {
      reads++;
      return makeJsonResponse({ Preferences: { SalesFormsPrefs: { CustomTxnNumbers: true } } });
    };
    const check = (realmId = REALM) => checkQbCustomTxnNumbersCached(request, API_BASE, { ...INTEGRATION, realmId }, cache, () => now);
    assert.deepEqual(await check(), { ok: true });
    now += 599999;
    await check();
    assert.equal(reads, 1);
    await check("other-realm");
    assert.equal(reads, 2);
    now++;
    await check();
    assert.equal(reads, 3);
  });
  it("does not cache false, auth, thrown or malformed responses; immediate retry can succeed", async () => {
    const cache = new Map<string, number>([[REALM, 5]]);
    let response: boolean | number | Error | "malformed" = false;
    let reads = 0;
    const request: QbMakeRequestFn = async () => {
      reads++;
      if (response instanceof Error) throw response;
      if (response === "malformed") return new Response("{");
      if (typeof response === "number") return makeJsonResponse({}, response);
      return makeJsonResponse({ Preferences: { SalesFormsPrefs: { CustomTxnNumbers: response } } });
    };
    const check = () => checkQbCustomTxnNumbersCached(request, API_BASE, INTEGRATION, cache, () => 10);
    for (let i = 0; i < 2; i++) assert.deepEqual(await check(), { ok: false, status: 409, message: QB_CUSTOM_TXN_DISABLED });
    response = 401;
    assert.deepEqual(await check(), { ok: false, status: 401, message: QB_SESSION_EXPIRED });
    for (const failure of [500, new Error("timeout"), "malformed"] as const) {
      response = failure;
      await assert.rejects(check);
      assert.equal(cache.size, 0);
    }
    response = true;
    assert.deepEqual(await check(), { ok: true });
    assert.equal(reads, 7);
    assert.equal(cache.get(REALM), 600010);
  });
});

describe("unlinked IR sync uses company-wide refuse-only guard", () => {
  const params = {
    apiBase: API_BASE, integration: INTEGRATION, customer: MOCK_CUSTOMER,
    docNumber: "IR-1001", qbLines: QB_LINES, serviceItemName: "Irrigation Services",
    storedQbInvoiceId: null, txnDate: "2026-05-01", dueDate: null,
  };
  it("refuses CRM's same number under another customer, with no POST or customer filter", async () => {
    const calls: string[] = [];
    const result = await syncAppInvoiceToQb(async (url, opts) => {
      assert.equal(opts?.method, "GET");
      calls.push(url);
      assert.equal(new URL(url).searchParams.get("query"), "SELECT Id FROM Invoice WHERE DocNumber = 'IR-1001'");
      return makeJsonResponse({ QueryResponse: { Invoice: [{ Id: "900", CustomerRef: { value: "77" } }] } });
    }, MOCK_SERVICE_ITEM, params);
    assert.deepEqual(result, {
      outcome: "refused", httpStatus: 409,
      message: "QuickBooks already has an invoice numbered IR-1001 (QuickBooks id 900) that IrrigoPro is not linked to. IrrigoPro will not take it over or create a duplicate.",
    });
    assert.equal(calls.length, 1);
    assert.ok(calls.every(url => !url.includes("CustomerRef")));
  });
  it("creates on empty search without changing the returned-number contract", async () => {
    let posts = 0;
    const result = await syncAppInvoiceToQb(async (url, opts) => {
      if (url.includes("/query")) return makeJsonResponse({ QueryResponse: {} });
      posts++;
      assert.equal(JSON.parse(opts?.body as string).DocNumber, "IR-1001");
      return makeJsonResponse({ Invoice: { Id: "901", DocNumber: "1034", SyncToken: "0" } });
    }, MOCK_SERVICE_ITEM, params);
    assert.equal(result.outcome, "created");
    assert.equal(posts, 1);
  });
  it("refuses auth, throws on query failures, and never POSTs", async () => {
    assert.equal((await syncAppInvoiceToQb(async () => makeJsonResponse({}, 401), MOCK_SERVICE_ITEM, params)).outcome, "refused");
    await assert.rejects(() => syncAppInvoiceToQb(async () => makeJsonResponse({}, 500), MOCK_SERVICE_ITEM, params));
  });
  it("verified stored IR ID updates in place without a number search or transaction-date change", async () => {
    let posts = 0;
    const result = await syncAppInvoiceToQb(async (url, opts) => {
      assert.ok(!url.includes("/query"));
      if (opts?.method === "GET") return makeJsonResponse({ Invoice: {
        Id: "500", DocNumber: "IR-1001", CustomerRef: { value: "42" }, SyncToken: "3",
      } });
      posts++;
      const body = JSON.parse(opts?.body as string);
      assert.equal(body.Id, "500");
      assert.equal(body.DocNumber, "IR-1001");
      assert.ok(!("TxnDate" in body));
      return makeJsonResponse({ Invoice: { Id: "500", SyncToken: "4" } });
    }, MOCK_SERVICE_ITEM, { ...params, storedQbInvoiceId: "500" });
    assert.equal(result.outcome, "updated");
    assert.equal(posts, 1);
  });
});

describe("getQbInvoiceById", () => {
  it("maps invoice fields and URL-encodes the stored id", async () => {
    const result = await getQbInvoiceById(async (url) => {
      assert.equal(url, `${API_BASE}/v3/company/${REALM}/invoice/500%2F%3F?minorversion=73`);
      return makeJsonResponse({ Invoice: { Id: "500/?", SyncToken: "7", DocNumber: "60897", CustomerRef: { value: "42" } } });
    }, API_BASE, INTEGRATION, "500/?");
    assert.deepEqual(result, { kind: "found", id: "500/?", syncToken: "7", docNumber: "60897", customerRef: "42" });
  });

  it("defaults absent token, customer and number without treating the invoice as missing", async () => {
    assert.deepEqual(await getQbInvoiceById(async () => makeJsonResponse({ Invoice: { Id: "500" } }), API_BASE, INTEGRATION, "500"),
      { kind: "found", id: "500", syncToken: "0", docNumber: null, customerRef: null });
  });

  for (const [status, code] of [[404, ""], [400, "610"]] as const) {
    it(`${status}/${code} means not_found`, async () => {
      assert.deepEqual(await getQbInvoiceById(async () => makeJsonResponse({ Fault: { Error: [{ code }] } }, status), API_BASE, INTEGRATION, "500"), { kind: "not_found" });
    });
  }
  for (const status of [400, 429, 500]) {
    it(`${status} with another fault throws`, async () => {
      await assert.rejects(() => getQbInvoiceById(async () => makeJsonResponse({ Fault: { Error: [{ code: "6100" }] } }, status), API_BASE, INTEGRATION, "500"), new RegExp(`${status}.*Retry`));
    });
  }
  it("401 means auth_error", async () => {
    assert.deepEqual(await getQbInvoiceById(async () => makeJsonResponse({}, 401), API_BASE, INTEGRATION, "500"), { kind: "auth_error" });
  });
  it("propagates network failures", async () => {
    await assert.rejects(() => getQbInvoiceById(async () => { throw new Error("Network timeout"); }, API_BASE, INTEGRATION, "500"), /Network timeout/);
  });
  it("rejects malformed or wrong-id successful responses", async () => {
    for (const body of [{}, { Invoice: { Id: "900" } }]) {
      await assert.rejects(() => getQbInvoiceById(async () => makeJsonResponse(body), API_BASE, INTEGRATION, "500"), /invalid invoice/);
    }
  });
});

describe("findQbInvoicesByDocNumberForCustomer", () => {
  it("queries both number and customer, dropping foreign customers", async () => {
    const result = await findQbInvoicesByDocNumberForCustomer(async (url) => {
      const query = new URL(url).searchParams.get("query")!;
      assert.ok(query.includes("DocNumber = '60897'"));
      assert.ok(query.includes("CustomerRef = '42'"));
      return makeJsonResponse({ QueryResponse: { Invoice: [
        { Id: "501", DocNumber: "60897", CustomerRef: { value: "42" } },
        { Id: "900", DocNumber: "60897", CustomerRef: { value: "77" } },
        { Id: "901", DocNumber: "60897" },
      ] } });
    }, API_BASE, INTEGRATION, "60897", "42");
    assert.deepEqual(result, [{ id: "501", docNumber: "60897", customerRef: "42" }]);
  });
  it("escapes backslashes and quotes in both query values", async () => {
    await findQbInvoicesByDocNumberForCustomer(async (url) => {
      const query = new URL(url).searchParams.get("query")!;
      assert.ok(query.includes("DocNumber = '60\\\\8\\'97'"));
      assert.ok(query.includes("CustomerRef = '4\\\\2\\''"));
      return makeJsonResponse({ QueryResponse: {} });
    }, API_BASE, INTEGRATION, "60\\8'97", "4\\2'");
  });
  it("preserves auth refusal", async () => {
    assert.equal(await findQbInvoicesByDocNumberForCustomer(async () => makeJsonResponse({}, 401), API_BASE, INTEGRATION, "60897", "42"), "auth_error");
  });
  for (const status of [400, 404, 429, 500]) {
    it(`query ${status} throws, even with fault 610`, async () => {
      await assert.rejects(() => findQbInvoicesByDocNumberForCustomer(async () => makeJsonResponse({ Fault: { Error: [{ code: "610" }] } }, status), API_BASE, INTEGRATION, "60897", "42"), new RegExp(`${status}.*Retry`));
    });
  }
  it("propagates network failures", async () => {
    await assert.rejects(() => findQbInvoicesByDocNumberForCustomer(async () => { throw new Error("Network timeout"); }, API_BASE, INTEGRATION, "60897", "42"), /Network timeout/);
  });
});

describe("syncAppInvoiceToQb — another app's invoice shares the number", () => {
  function fixture(opts: { storedId?: string | null; number?: string; readStatus?: number; collision?: boolean; postStatus?: number } = {}) {
    const requests: Array<{ url: string; body: Record<string, unknown> | null; operation?: string }> = [];
    const foreign = { Id: "900", DocNumber: "60897", CustomerRef: { value: "77" }, SyncToken: "9", Line: [{ Amount: 999 }] };
    const before = JSON.stringify(foreign);
    const makeRequest: QbMakeRequestFn = async (url, options, operation) => {
      const body = options?.body ? JSON.parse(String(options.body)) : null;
      requests.push({ url, body, operation });
      assert.notEqual(body?.Id, "900", "foreign invoice must never receive a write");
      if (url.includes("/query")) {
        const scoped = new URL(url).searchParams.get("query")!.includes("CustomerRef = '42'");
        return makeJsonResponse({ QueryResponse: { Invoice: !scoped ? [foreign] : opts.collision ? [{ Id: "501", DocNumber: "60897", CustomerRef: { value: "42" } }] : [] } });
      }
      if (!body) {
        if (opts.readStatus) return makeJsonResponse({ Fault: { Error: [{ code: "610" }] } }, opts.readStatus);
        return makeJsonResponse({ Invoice: opts.storedId === "900" ? foreign : { Id: "500", DocNumber: opts.number ?? "60897", CustomerRef: { value: "42" }, SyncToken: "7" } });
      }
      if (opts.postStatus) return makeJsonResponse({}, opts.postStatus);
      return makeJsonResponse({ Invoice: { Id: body.Id ?? "502", SyncToken: "8", DocNumber: "60897" } });
    };
    return {
      requests,
      run: () => syncAppInvoiceToQb(makeRequest, MOCK_SERVICE_ITEM, {
        apiBase: API_BASE, integration: INTEGRATION, customer: MOCK_CUSTOMER,
        docNumber: "60897", qbLines: QB_LINES, serviceItemName: "Irrigation Services",
        storedQbInvoiceId: opts.storedId ?? null, txnDate: "2026-05-01", dueDate: "2026-05-31",
      }),
      assertNoWrites: () => {
        assert.equal(requests.filter((r) => r.body).length, 0);
        assert.equal(JSON.stringify(foreign), before);
      },
    };
  }
  it("1. stored 500 updates only 500, with no number query", async () => {
    const f = fixture({ storedId: "500" });
    assert.deepEqual(await f.run(), { outcome: "updated", quickbooksId: "500", quickbooksSyncToken: "8" });
    assert.equal(f.requests.length, 2);
    assert.ok(f.requests.every((r) => !r.url.includes("/query")));
    assert.equal(f.requests[1].body?.Id, "500");
    assert.equal(f.requests[1].body?.SyncToken, "7");
    assert.equal(f.requests[1].operation, "Invoice In-Place Update (stored id)");
  });
  it("2. unlinked creates despite the foreign customer's matching number", async () => {
    const f = fixture();
    assert.deepEqual(await f.run(), { outcome: "created", quickbooksId: "502", quickbooksSyncToken: "8", qbDocNumber: "60897" });
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[1].body?.Id, undefined);
    assert.equal(f.requests[1].body?.TxnDate, "2026-05-01");
    assert.equal(f.requests[1].body?.DueDate, "2026-05-31");
    assert.equal(f.requests[1].operation, "Invoice Sync Creation");
  });
  it("3. corrupt stored 900 refuses the foreign customer with zero POSTs", async () => {
    const f = fixture({ storedId: "900" });
    assert.deepEqual(await f.run(), { outcome: "refused", httpStatus: 409, message: "QuickBooks invoice 900 belongs to a different QuickBooks customer (77), not Acme Corp (42). IrrigoPro did not change it." });
    f.assertNoWrites();
    assert.equal(f.requests.length, 1);
  });
  it("4. stored 500 with different number refuses with zero POSTs", async () => {
    const f = fixture({ storedId: "500", number: "60898" });
    assert.deepEqual(await f.run(), { outcome: "refused", httpStatus: 409, message: "QuickBooks invoice 500 is numbered 60898 in QuickBooks but #60897 in IrrigoPro. IrrigoPro did not change it." });
    f.assertNoWrites();
  });
  it("5. unlinked same-customer 501 refuses without adoption or POSTs", async () => {
    const f = fixture({ collision: true });
    assert.deepEqual(await f.run(), { outcome: "refused", httpStatus: 409, message: "QuickBooks already has invoice #60897 for this customer (QuickBooks id 501) that IrrigoPro is not linked to. IrrigoPro will not take it over or create a duplicate. Delete or renumber that QuickBooks invoice, then sync again." });
    f.assertNoWrites();
  });
  it("6. deleted stored ID (400/610) checks the customer guard then creates", async () => {
    const f = fixture({ storedId: "500", readStatus: 400 });
    assert.equal((await f.run()).outcome, "created");
    assert.equal(f.requests.length, 3);
    assert.ok(f.requests[1].url.includes("/query"));
    assert.equal(f.requests[2].body?.Id, undefined);
  });
  it("7. GET 401 refuses reconnect with zero POSTs", async () => {
    const f = fixture({ storedId: "500", readStatus: 401 });
    assert.deepEqual(await f.run(), { outcome: "refused", httpStatus: 401, message: "QuickBooks session expired. Please reconnect QuickBooks and retry the sync." });
    f.assertNoWrites();
  });
  it("unexpected GET failure stops before query or POST", async () => {
    const f = fixture({ storedId: "500", readStatus: 500 });
    await assert.rejects(f.run, /500.*Retry/);
    f.assertNoWrites();
    assert.equal(f.requests.length, 1);
  });
  for (const storedId of [null, "500"]) {
    it(`primitive error becomes 502 (${storedId ? "update" : "create"})`, async () => {
      const f = fixture({ storedId, postStatus: 503 });
      const result = await f.run();
      assert.equal(result.outcome, "refused");
      if (result.outcome === "refused") assert.equal(result.httpStatus, 502);
    });
  }
  it("unsynced customer fails before any request or service lookup", async () => {
    const unexpected = async (): Promise<never> => { throw new Error("must not call dependencies"); };
    await assert.rejects(() => syncAppInvoiceToQb(unexpected, unexpected, {
      apiBase: API_BASE, integration: INTEGRATION, customer: { name: "Unsynced" },
      docNumber: "60897", qbLines: QB_LINES, serviceItemName: "Irrigation Services",
      storedQbInvoiceId: "900", txnDate: "2026-05-01", dueDate: null,
    }), /Customer "Unsynced" has not been synced to QuickBooks/);
  });
});

// ─── updateQbInvoiceInPlace (stale-token self-heal) ──────────────────────────

describe("updateQbInvoiceInPlace — stale-token 5010 retry", () => {

  it("(c) re-fetches SyncToken and retries once on fault code 5010", async () => {
    let callCount = 0;
    const makeRequest: QbMakeRequestFn = async (url, options) => {
      const body = (options?.body as string | undefined) ?? "";

      // First update call → returns 5010 stale token
      if (callCount === 0 && body.includes('"sparse"')) {
        callCount++;
        return makeJsonResponse(
          { Fault: { Error: [{ code: "5010", Message: "Stale SyncToken" }] } },
          400,
        );
      }
      // Token re-fetch call (GET to /invoice/:id)
      if (url.includes("/invoice/48408") && !body) {
        return makeJsonResponse({ Invoice: { Id: "48408", SyncToken: "6" } });
      }
      // Retry update call → succeeds
      callCount++;
      return makeJsonResponse({
        Invoice: { Id: "48408", SyncToken: "7", DocNumber: "04723" },
      });
    };

    const result = await updateQbInvoiceInPlace(makeRequest, MOCK_SERVICE_ITEM, {
      apiBase: API_BASE,
      integration: INTEGRATION,
      customer: MOCK_CUSTOMER,
      docNumber: "04723",
      qbLines: QB_LINES,
      operation: "Test Update",
      serviceItemName: "Irrigation Services",
      quickbooksInvoiceId: "48408",
      quickbooksSyncToken: "5",
    });

    assert.ok(!result.quickbooksError, `should not have error: ${result.quickbooksError}`);
    assert.equal(result.quickbooksId, "48408");
    assert.equal(result.quickbooksSyncToken, "7");
  });

  it("update targets exactly the id it is given", async () => {
    // Simulate scenario: stored id is "48408" but QB invoice is actually at "48999"
    // (DocNumber found → updateQbInvoiceInPlace called with the live id "48999")
    let updatedWithId: string | undefined;
    const makeRequest: QbMakeRequestFn = async (_url, options) => {
      const body = options?.body ? JSON.parse(options.body as string) : null;
      if (body?.Id) updatedWithId = body.Id;
      return makeJsonResponse({
        Invoice: { Id: "48999", SyncToken: "3", DocNumber: "04723" },
      });
    };

    const result = await updateQbInvoiceInPlace(makeRequest, MOCK_SERVICE_ITEM, {
      apiBase: API_BASE,
      integration: INTEGRATION,
      customer: MOCK_CUSTOMER,
      docNumber: "04723",
      qbLines: QB_LINES,
      operation: "Test In-Place",
      serviceItemName: "Irrigation Services",
      quickbooksInvoiceId: "48999",
      quickbooksSyncToken: "2",
    });

    assert.ok(!result.quickbooksError, `unexpected error: ${result.quickbooksError}`);
    assert.equal(updatedWithId, "48999", "update must use the live id from DocNumber lookup");
    assert.equal(result.quickbooksId, "48999");
    assert.equal(result.quickbooksSyncToken, "3");
  });

});

// ─── buildAndPostQbInvoice — create path ─────────────────────────────────────

describe("buildAndPostQbInvoice — create path", () => {

  it("(b) creates a fresh QB invoice and returns the new id + SyncToken", async () => {
    const makeRequest: QbMakeRequestFn = async () =>
      makeJsonResponse({
        Invoice: { Id: "55000", SyncToken: "0", DocNumber: "04723" },
      });

    const result = await buildAndPostQbInvoice(makeRequest, MOCK_SERVICE_ITEM, {
      apiBase: API_BASE,
      integration: INTEGRATION,
      customer: MOCK_CUSTOMER,
      docNumber: "04723",
      qbLines: QB_LINES,
      operation: "Invoice Sync Creation",
      serviceItemName: "Irrigation Services",
    });

    assert.ok(!result.quickbooksError, `unexpected error: ${result.quickbooksError}`);
    assert.equal(result.quickbooksId, "55000");
    assert.equal(result.quickbooksSyncToken, "0");
  });

  it("(f) returns quickbooksError when customer has no QB id", async () => {
    const makeRequest: QbMakeRequestFn = async () =>
      makeJsonResponse({}, 200);

    const result = await buildAndPostQbInvoice(makeRequest, MOCK_SERVICE_ITEM, {
      apiBase: API_BASE,
      integration: INTEGRATION,
      customer: { quickbooksId: undefined, name: "No-Sync Customer" },
      docNumber: "04723",
      qbLines: QB_LINES,
      operation: "Test",
      serviceItemName: "Irrigation Services",
    }).catch((err: Error) => ({ quickbooksError: err.message }));

    assert.ok((result as any).quickbooksError, "must error when customer has no QB id");
    assert.ok(
      (result as any).quickbooksError.includes("sync"),
      "error message should mention syncing the customer",
    );
  });

  it("(e) two creates with same DocNumber do not interfere — each returns new id", async () => {
    let createCount = 0;
    const makeRequest: QbMakeRequestFn = async () => {
      createCount++;
      return makeJsonResponse({
        Invoice: { Id: `5500${createCount}`, SyncToken: "0", DocNumber: "04723" },
      });
    };

    const r1 = await buildAndPostQbInvoice(makeRequest, MOCK_SERVICE_ITEM, {
      apiBase: API_BASE,
      integration: INTEGRATION,
      customer: MOCK_CUSTOMER,
      docNumber: "04723",
      qbLines: QB_LINES,
      operation: "Create 1",
      serviceItemName: "Irrigation Services",
    });
    const r2 = await buildAndPostQbInvoice(makeRequest, MOCK_SERVICE_ITEM, {
      apiBase: API_BASE,
      integration: INTEGRATION,
      customer: MOCK_CUSTOMER,
      docNumber: "04723",
      qbLines: QB_LINES,
      operation: "Create 2",
      serviceItemName: "Irrigation Services",
    });

    assert.equal(r1.quickbooksId, "55001");
    assert.equal(r2.quickbooksId, "55002");
    assert.equal(createCount, 2, "two creates must both call QB");
  });

});

// ─── fetchQbSyncToken ─────────────────────────────────────────────────────────

describe("fetchQbSyncToken", () => {

  it("returns null when QB returns non-OK response", async () => {
    const makeRequest: QbMakeRequestFn = async () => makeJsonResponse({}, 404);
    const token = await fetchQbSyncToken(makeRequest, API_BASE, INTEGRATION, "48408");
    assert.equal(token, null);
  });

  it("returns the SyncToken from a successful GET", async () => {
    const makeRequest: QbMakeRequestFn = async () =>
      makeJsonResponse({ Invoice: { Id: "48408", SyncToken: "9" } });
    const token = await fetchQbSyncToken(makeRequest, API_BASE, INTEGRATION, "48408");
    assert.equal(token, "9");
  });

});

// ─── Confirmation copy regression ────────────────────────────────────────────
// Guard that the ReissueStep pre-reissue text no longer mentions -R1 or
// "manual QB". This is a static source-code check (grep over the file contents)
// so it runs without spinning up a browser or DOM.

describe("ReissueStep copy regression — no stale UI text", () => {

  it('pre-reissue bullets must not mention "-R1"', async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../../../../artifacts/irrigopro/src/pages/invoices/InvoiceCorrectionFlow.tsx", import.meta.url),
      "utf8",
    );
    // The -R1 suffix text should not appear anywhere in the ReissueStep function body.
    // We look for the literal string in the source.
    assert.ok(!src.includes("-R1"), 'Source must not contain "-R1" (stale copy removed)');
  });

  it('pre-reissue bullets must not mention "coming soon" for QB', async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../../../../artifacts/irrigopro/src/pages/invoices/InvoiceCorrectionFlow.tsx", import.meta.url),
      "utf8",
    );
    assert.ok(
      !src.includes("coming soon"),
      'Source must not contain "coming soon" (stale QB copy removed)',
    );
  });

  it('pre-reissue bullets must not mention "manually update or void"', async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../../../../artifacts/irrigopro/src/pages/invoices/InvoiceCorrectionFlow.tsx", import.meta.url),
      "utf8",
    );
    assert.ok(
      !src.includes("manually update or void"),
      'Source must not say "manually update or void" (stale QB instructions removed)',
    );
  });

  it('resync modal in invoices.tsx must not say "delete the old invoice first"', async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../../../../artifacts/irrigopro/src/pages/invoices.tsx", import.meta.url),
      "utf8",
    );
    assert.ok(
      !src.includes("Delete the old invoice"),
      'invoices.tsx must not instruct users to delete the old QB invoice',
    );
  });

  it('resync modal button must say "Update QuickBooks invoice", not "Create new QuickBooks invoice"', async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../../../../artifacts/irrigopro/src/pages/invoices.tsx", import.meta.url),
      "utf8",
    );
    assert.ok(
      !src.includes("Create new QuickBooks invoice"),
      'invoices.tsx must not use the old "Create new QuickBooks invoice" button label',
    );
    assert.ok(
      src.includes("Update QuickBooks invoice"),
      'invoices.tsx must use the new "Update QuickBooks invoice" button label',
    );
  });

});

// ─── Invoice date preservation on the create path ────────────────────────────
//
// Covers Task #1774: re-syncing a corrected invoice (Rev 2) must use the
// earliest-revision createdAt as TxnDate, not today.

describe("buildAndPostQbInvoice — TxnDate / DueDate preservation", () => {

  it("recreate path (Rev 2): TxnDate uses supplied txnDate, not today", async () => {
    let capturedBody: Record<string, unknown> = {};
    const makeRequest: QbMakeRequestFn = async (_url, options) => {
      capturedBody = JSON.parse(options?.body as string);
      return makeJsonResponse({
        Invoice: { Id: "55100", SyncToken: "0", DocNumber: "04723" },
      });
    };

    // Rev 1 createdAt = 2026-05-01 (the original QB date for #04723)
    const originalDate = new Date("2026-05-01T00:00:00.000Z");

    const result = await buildAndPostQbInvoice(makeRequest, MOCK_SERVICE_ITEM, {
      apiBase: API_BASE,
      integration: INTEGRATION,
      customer: MOCK_CUSTOMER,
      docNumber: "04723",
      qbLines: QB_LINES,
      operation: "Invoice Sync Creation",
      serviceItemName: "Irrigation Services",
      txnDate: originalDate,
    });

    assert.ok(!result.quickbooksError, `unexpected error: ${result.quickbooksError}`);
    assert.equal(capturedBody.TxnDate, "2026-05-01", "TxnDate must be the original invoice date, not today");
  });

  it("first-ever sync: TxnDate uses the invoice's own createdAt", async () => {
    let capturedBody: Record<string, unknown> = {};
    const makeRequest: QbMakeRequestFn = async (_url, options) => {
      capturedBody = JSON.parse(options?.body as string);
      return makeJsonResponse({
        Invoice: { Id: "55200", SyncToken: "0", DocNumber: "09999" },
      });
    };

    const invoiceCreatedAt = new Date("2026-06-15T00:00:00.000Z");

    const result = await buildAndPostQbInvoice(makeRequest, MOCK_SERVICE_ITEM, {
      apiBase: API_BASE,
      integration: INTEGRATION,
      customer: MOCK_CUSTOMER,
      docNumber: "09999",
      qbLines: QB_LINES,
      operation: "Invoice Sync Creation",
      serviceItemName: "Irrigation Services",
      txnDate: invoiceCreatedAt,
    });

    assert.ok(!result.quickbooksError, `unexpected error: ${result.quickbooksError}`);
    assert.equal(capturedBody.TxnDate, "2026-06-15", "TxnDate must equal invoice createdAt for first-ever sync");
  });

  it("DueDate: uses stored dueDate when provided", async () => {
    let capturedBody: Record<string, unknown> = {};
    const makeRequest: QbMakeRequestFn = async (_url, options) => {
      capturedBody = JSON.parse(options?.body as string);
      return makeJsonResponse({
        Invoice: { Id: "55300", SyncToken: "0", DocNumber: "04723" },
      });
    };

    const result = await buildAndPostQbInvoice(makeRequest, MOCK_SERVICE_ITEM, {
      apiBase: API_BASE,
      integration: INTEGRATION,
      customer: MOCK_CUSTOMER,
      docNumber: "04723",
      qbLines: QB_LINES,
      operation: "Invoice Sync Creation",
      serviceItemName: "Irrigation Services",
      txnDate: new Date("2026-05-01T00:00:00.000Z"),
      dueDate: new Date("2026-05-31T00:00:00.000Z"),
    });

    assert.ok(!result.quickbooksError, `unexpected error: ${result.quickbooksError}`);
    assert.equal(capturedBody.DueDate, "2026-05-31", "DueDate must be the stored dueDate when provided");
  });

  it("DueDate: defaults to txnDate + 30 days (net-30) when no dueDate provided", async () => {
    let capturedBody: Record<string, unknown> = {};
    const makeRequest: QbMakeRequestFn = async (_url, options) => {
      capturedBody = JSON.parse(options?.body as string);
      return makeJsonResponse({
        Invoice: { Id: "55400", SyncToken: "0", DocNumber: "04723" },
      });
    };

    const txnDate = new Date("2026-05-01T00:00:00.000Z");

    const result = await buildAndPostQbInvoice(makeRequest, MOCK_SERVICE_ITEM, {
      apiBase: API_BASE,
      integration: INTEGRATION,
      customer: MOCK_CUSTOMER,
      docNumber: "04723",
      qbLines: QB_LINES,
      operation: "Invoice Sync Creation",
      serviceItemName: "Irrigation Services",
      txnDate,
    });

    assert.ok(!result.quickbooksError, `unexpected error: ${result.quickbooksError}`);
    // net-30 off 2026-05-01 = 2026-05-31
    assert.equal(capturedBody.DueDate, "2026-05-31", "DueDate must be txnDate + 30 days when no dueDate stored");
  });

  it("in-place update: sparse update body omits TxnDate (regression guard)", async () => {
    let capturedBodies: Array<Record<string, unknown>> = [];
    const makeRequest: QbMakeRequestFn = async (_url, options) => {
      if (options?.body) {
        capturedBodies.push(JSON.parse(options.body as string));
      }
      return makeJsonResponse({
        Invoice: { Id: "48408", SyncToken: "3", DocNumber: "04723" },
      });
    };

    await updateQbInvoiceInPlace(makeRequest, MOCK_SERVICE_ITEM, {
      apiBase: API_BASE,
      integration: INTEGRATION,
      customer: MOCK_CUSTOMER,
      docNumber: "04723",
      qbLines: QB_LINES,
      operation: "In-Place Update",
      serviceItemName: "Irrigation Services",
      quickbooksInvoiceId: "48408",
      quickbooksSyncToken: "2",
    });

    // Every body sent to QB on the update path must omit TxnDate.
    for (const body of capturedBodies) {
      assert.ok(
        !("TxnDate" in body),
        `Sparse update must not send TxnDate — found it in: ${JSON.stringify(body)}`,
      );
    }
  });

});
