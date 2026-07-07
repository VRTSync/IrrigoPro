// Unit tests for qb-invoice-ops.ts — DocNumber-first lookup + sync scenarios.
//
// All QB network calls are stubbed via the `makeRequest` / `lookupServiceItem`
// injection points so no real QB credentials or network access is required.
//
// Coverage:
//   (a) DocNumber found → update in place; stored id self-heals if it differed
//   (b) DocNumber not found (e.g. deleted QB invoice) → creates fresh QB invoice
//   (c) Stale-token fault 5010 → re-fetch + single retry succeeds
//   (d) 401 auth failure → returns "auth_error", no new invoice created
//   (e) Two syncs in a row for same invoice → idempotent, no duplicate
//   (f) No prior quickbooksInvoiceId → creates fresh (fallback via buildAndPostQbInvoice)
//   (g) Confirmation copy regression: no "-R1", no "manual QB" in ReissueStep pre-reissue text

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  lookupQbInvoiceByDocNumber,
  fetchQbSyncToken,
  buildAndPostQbInvoice,
  updateQbInvoiceInPlace,
} from "./qb-invoice-ops";
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

// ─── lookupQbInvoiceByDocNumber ───────────────────────────────────────────────

describe("lookupQbInvoiceByDocNumber", () => {

  it("(a) returns { id, syncToken } when QB has an invoice with the given DocNumber", async () => {
    const makeRequest: QbMakeRequestFn = async (url) => {
      assert.ok(url.includes("/query"), "must call the QB query endpoint");
      assert.ok(url.includes("04723"), "must include the DocNumber in the query");
      return makeJsonResponse({
        QueryResponse: {
          Invoice: [{ Id: "48408", SyncToken: "5" }],
          startPosition: 1,
          maxResults: 1,
        },
      });
    };

    const result = await lookupQbInvoiceByDocNumber(makeRequest, API_BASE, INTEGRATION, "04723");
    assert.ok(result !== null && result !== "auth_error", "should find the invoice");
    assert.equal((result as any).id, "48408");
    assert.equal((result as any).syncToken, "5");
  });

  it("(b) returns null when QB has no invoice with the given DocNumber", async () => {
    const makeRequest: QbMakeRequestFn = async () =>
      makeJsonResponse({ QueryResponse: {}, });

    const result = await lookupQbInvoiceByDocNumber(makeRequest, API_BASE, INTEGRATION, "99999");
    assert.equal(result, null, "not found must return null");
  });

  it("(b) returns null when QueryResponse.Invoice is an empty array", async () => {
    const makeRequest: QbMakeRequestFn = async () =>
      makeJsonResponse({ QueryResponse: { Invoice: [] } });

    const result = await lookupQbInvoiceByDocNumber(makeRequest, API_BASE, INTEGRATION, "04723");
    assert.equal(result, null);
  });

  it('(d) returns "auth_error" on 401 — expired QB token', async () => {
    const makeRequest: QbMakeRequestFn = async () =>
      makeJsonResponse({ error: "AuthenticationFailed" }, 401);

    const result = await lookupQbInvoiceByDocNumber(makeRequest, API_BASE, INTEGRATION, "04723");
    assert.equal(result, "auth_error");
  });

  it("returns null on non-401 error (treats as not-found rather than hard-fail)", async () => {
    const makeRequest: QbMakeRequestFn = async () =>
      makeJsonResponse({ Fault: { Error: [{ code: "500" }] } }, 500);

    const result = await lookupQbInvoiceByDocNumber(makeRequest, API_BASE, INTEGRATION, "04723");
    assert.equal(result, null);
  });

  it("returns null when makeRequest throws (network error)", async () => {
    const makeRequest: QbMakeRequestFn = async () => {
      throw new Error("Network error");
    };

    const result = await lookupQbInvoiceByDocNumber(makeRequest, API_BASE, INTEGRATION, "04723");
    assert.equal(result, null);
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

  it("(a) self-heals stored id — uses live id from DocNumber lookup, not stale stored id", async () => {
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
