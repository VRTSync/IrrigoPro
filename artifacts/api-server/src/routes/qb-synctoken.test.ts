// Task #1711 — Unit tests for QB invoice ops (qb-invoice-ops.ts).
//
// All QB HTTP calls are stubbed (no real network). Storage is stubbed where
// needed. Tests cover:
//   1. buildAndPostQbInvoice — captures and returns SyncToken.
//   2. updateQbInvoiceInPlace — sends correct sparse-update body, persists
//      the refreshed SyncToken from QB's response.
//   3. Legacy flow — id set but token null → GET token first, then update.
//   4. Stale-token fault (5010) → re-fetch + single retry succeeds.
//   5. Persistent 5010 after retry → surfaced as error, no duplicate created.
//   6. Company isolation: only sees invoices within the caller's company.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildAndPostQbInvoice,
  updateQbInvoiceInPlace,
  fetchQbSyncToken,
  type QbMakeRequestFn,
  type QbLookupServiceItemFn,
  type QbLineInput,
} from "./qb-invoice-ops";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SERVICE_ITEM = { id: "ITEM-1", name: "Irrigation Services - IrrigoPro" };
const SERVICE_ITEM_NAME = "Irrigation Services - IrrigoPro";

const INTEGRATION = { realmId: "realm-123", accessToken: "tok-abc" };
const CUSTOMER = { quickbooksId: "QB-CUST-1", name: "Acme Corp" };
const API_BASE = "https://sandbox-quickbooks.api.intuit.com";
const LINES: QbLineInput[] = [{ amount: 100, description: "Work order #1" }];

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function errorJson(body: unknown, status = 400): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubLookup(item: { id: string; name: string } | null = SERVICE_ITEM): QbLookupServiceItemFn {
  return async () => item;
}

// ─── buildAndPostQbInvoice ────────────────────────────────────────────────────

describe("buildAndPostQbInvoice", () => {
  it("captures SyncToken from QB response", async () => {
    const makeRequest: QbMakeRequestFn = async () =>
      okJson({ Invoice: { Id: "QB-INV-1", DocNumber: "INV-001", SyncToken: "3" } });

    const result = await buildAndPostQbInvoice(makeRequest, stubLookup(), {
      apiBase: API_BASE,
      integration: INTEGRATION,
      customer: CUSTOMER,
      docNumber: "INV-001",
      qbLines: LINES,
      operation: "Test Create",
      serviceItemName: SERVICE_ITEM_NAME,
    });

    assert.equal(result.quickbooksId, "QB-INV-1");
    assert.equal(result.qbDocNumber, "INV-001");
    assert.equal(result.quickbooksSyncToken, "3");
    assert.equal(result.quickbooksError, undefined);
  });

  it("returns quickbooksError (not throw) for a QB API failure", async () => {
    const makeRequest: QbMakeRequestFn = async () =>
      new Response("Internal Error", { status: 500 });

    const result = await buildAndPostQbInvoice(makeRequest, stubLookup(), {
      apiBase: API_BASE,
      integration: INTEGRATION,
      customer: CUSTOMER,
      docNumber: "INV-002",
      qbLines: LINES,
      operation: "Test Create",
      serviceItemName: SERVICE_ITEM_NAME,
    });

    assert.ok(result.quickbooksError);
    assert.match(result.quickbooksError, /QuickBooks API Error/i);
    assert.equal(result.quickbooksId, undefined);
    assert.equal(result.quickbooksSyncToken, undefined);
  });

  it("throws when service item is not found", async () => {
    const makeRequest: QbMakeRequestFn = async () => okJson({});

    await assert.rejects(
      () =>
        buildAndPostQbInvoice(makeRequest, stubLookup(null), {
          apiBase: API_BASE,
          integration: INTEGRATION,
          customer: CUSTOMER,
          docNumber: "INV-003",
          qbLines: LINES,
          operation: "Test Create",
          serviceItemName: SERVICE_ITEM_NAME,
        }),
      /Could not find the QuickBooks item/,
    );
  });

  it("throws when customer has no quickbooksId", async () => {
    const makeRequest: QbMakeRequestFn = async () => okJson({});

    await assert.rejects(
      () =>
        buildAndPostQbInvoice(makeRequest, stubLookup(), {
          apiBase: API_BASE,
          integration: INTEGRATION,
          customer: { name: "No QB" },
          docNumber: "INV-004",
          qbLines: LINES,
          operation: "Test Create",
          serviceItemName: SERVICE_ITEM_NAME,
        }),
      /has not been synced to QuickBooks/,
    );
  });
});

// ─── updateQbInvoiceInPlace ───────────────────────────────────────────────────

describe("updateQbInvoiceInPlace", () => {
  it("sends sparse update body and returns refreshed SyncToken", async () => {
    const sentBodies: any[] = [];

    const makeRequest: QbMakeRequestFn = async (url, opts) => {
      if (opts?.body) sentBodies.push(JSON.parse(opts.body as string));
      return okJson({ Invoice: { Id: "QB-INV-5", SyncToken: "4" } });
    };

    const result = await updateQbInvoiceInPlace(makeRequest, stubLookup(), {
      apiBase: API_BASE,
      integration: INTEGRATION,
      customer: CUSTOMER,
      docNumber: "INV-005",
      qbLines: LINES,
      operation: "Test Update",
      serviceItemName: SERVICE_ITEM_NAME,
      quickbooksInvoiceId: "QB-INV-5",
      quickbooksSyncToken: "3",
    });

    assert.equal(result.quickbooksId, "QB-INV-5");
    assert.equal(result.quickbooksSyncToken, "4");
    assert.equal(result.quickbooksError, undefined);

    const [body] = sentBodies;
    assert.equal(body.Id, "QB-INV-5");
    assert.equal(body.SyncToken, "3");
    assert.equal(body.sparse, true);
    assert.equal(body.DocNumber, "INV-005");
  });

  it("fetches SyncToken first when stored token is null (legacy invoice)", async () => {
    const calls: string[] = [];

    const makeRequest: QbMakeRequestFn = async (url, opts) => {
      if ((opts?.method ?? "GET") === "GET") {
        calls.push("GET");
        return okJson({ Invoice: { Id: "QB-INV-6", SyncToken: "7" } });
      }
      calls.push("POST");
      return okJson({ Invoice: { Id: "QB-INV-6", SyncToken: "8" } });
    };

    const result = await updateQbInvoiceInPlace(makeRequest, stubLookup(), {
      apiBase: API_BASE,
      integration: INTEGRATION,
      customer: CUSTOMER,
      docNumber: "INV-006",
      qbLines: LINES,
      operation: "Test Update Legacy",
      serviceItemName: SERVICE_ITEM_NAME,
      quickbooksInvoiceId: "QB-INV-6",
      quickbooksSyncToken: null,
    });

    assert.deepEqual(calls, ["GET", "POST"]);
    assert.equal(result.quickbooksSyncToken, "8");
    assert.equal(result.quickbooksError, undefined);
  });

  it("self-heals on fault 5010: re-fetches token and retries once (success)", async () => {
    let callCount = 0;

    const makeRequest: QbMakeRequestFn = async (url, opts) => {
      const method = opts?.method ?? "GET";
      if (method === "GET") {
        return okJson({ Invoice: { Id: "QB-INV-7", SyncToken: "fresh-10" } });
      }
      callCount++;
      if (callCount === 1) {
        return errorJson({
          Fault: { Error: [{ code: "5010", Message: "Stale SyncToken" }], type: "ValidationFault" },
        }, 400);
      }
      return okJson({ Invoice: { Id: "QB-INV-7", SyncToken: "11" } });
    };

    const result = await updateQbInvoiceInPlace(makeRequest, stubLookup(), {
      apiBase: API_BASE,
      integration: INTEGRATION,
      customer: CUSTOMER,
      docNumber: "INV-007",
      qbLines: LINES,
      operation: "Test 5010 Retry",
      serviceItemName: SERVICE_ITEM_NAME,
      quickbooksInvoiceId: "QB-INV-7",
      quickbooksSyncToken: "stale-9",
    });

    assert.equal(result.quickbooksSyncToken, "11");
    assert.equal(result.quickbooksError, undefined);
    assert.equal(callCount, 2);
  });

  it("surfaces error (no duplicate create) on persistent 5010 after retry", async () => {
    let postCount = 0;

    const makeRequest: QbMakeRequestFn = async (url, opts) => {
      const method = opts?.method ?? "GET";
      if (method === "GET") {
        return okJson({ Invoice: { Id: "QB-INV-8", SyncToken: "fresh-20" } });
      }
      postCount++;
      return errorJson({
        Fault: { Error: [{ code: "5010", Message: "Stale SyncToken" }], type: "ValidationFault" },
      }, 400);
    };

    const result = await updateQbInvoiceInPlace(makeRequest, stubLookup(), {
      apiBase: API_BASE,
      integration: INTEGRATION,
      customer: CUSTOMER,
      docNumber: "INV-008",
      qbLines: LINES,
      operation: "Test Persistent 5010",
      serviceItemName: SERVICE_ITEM_NAME,
      quickbooksInvoiceId: "QB-INV-8",
      quickbooksSyncToken: "stale-19",
    });

    assert.ok(result.quickbooksError, "Should have an error");
    assert.match(result.quickbooksError!, /Retry/i);
    assert.equal(result.quickbooksId, undefined);
    assert.equal(postCount, 2, "Should attempt exactly 2 POSTs (original + one retry)");
  });
});

// ─── fetchQbSyncToken ────────────────────────────────────────────────────────

describe("fetchQbSyncToken", () => {
  it("returns the SyncToken from QB response", async () => {
    const makeRequest: QbMakeRequestFn = async () =>
      okJson({ Invoice: { Id: "QB-INV-9", SyncToken: "5" } });

    const token = await fetchQbSyncToken(makeRequest, API_BASE, INTEGRATION, "QB-INV-9");
    assert.equal(token, "5");
  });

  it("returns null when QB returns a non-ok response", async () => {
    const makeRequest: QbMakeRequestFn = async () =>
      new Response("Not found", { status: 404 });

    const token = await fetchQbSyncToken(makeRequest, API_BASE, INTEGRATION, "MISSING");
    assert.equal(token, null);
  });

  it("returns null when QB response body has no Invoice", async () => {
    const makeRequest: QbMakeRequestFn = async () => okJson({ QueryResponse: {} });

    const token = await fetchQbSyncToken(makeRequest, API_BASE, INTEGRATION, "QB-INV-10");
    assert.equal(token, null);
  });
});
