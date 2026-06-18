// Task #1422 — Contract guards for invoice PDF total-drift hardening.
//
// (a) The raw billing-sheet item mutators and the AndResync variant route
//     through the single resync/propagation seams so an edit can't desync the
//     sheet or its parent invoice. (storage.ts)
// (b) GET /api/invoices/:invoiceId/pdf returns 422 (not 500) with
//     validationFailure on a reconciliation failure, mirroring the download
//     handler. (routes.ts)
//
// Both are verified by source-code scanning — the same approach as
// rate-mode-routes.test.ts / auth-middleware-coverage.test.ts — because the
// logic lives in the legacy monolith and there is no DB in the test harness.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const here = import.meta.dirname ?? __dirname;
const STORAGE_SRC = readFileSync(path.join(here, "..", "storage.ts"), "utf8");
const ROUTES_SRC = readFileSync(path.join(here, "routes.ts"), "utf8");

// Returns the body of a top-level `async <name>(` storage method up to the
// start of the next method definition (best-effort, brace-free heuristic).
function methodBody(name: string): string {
  const start = STORAGE_SRC.indexOf(`async ${name}(`);
  assert.notEqual(start, -1, `method ${name} not found in storage.ts`);
  // Find the next `\n  async ` (two-space indented) after start.
  const next = STORAGE_SRC.indexOf("\n  async ", start + 1);
  return STORAGE_SRC.slice(start, next === -1 ? STORAGE_SRC.length : next);
}

describe("Task #1422 — billing-sheet item mutators stay reconciled", () => {
  const rawMutators = [
    "addBillingSheetItem",
    "updateBillingSheetItem",
    "deleteBillingSheetItem",
    "deleteBillingSheetItems",
    "replaceBillingSheetItemsInTransaction",
  ];

  for (const name of rawMutators) {
    it(`${name} runs in a transaction and resyncs sheet totals`, () => {
      const body = methodBody(name);
      assert.ok(
        body.includes("db.transaction("),
        `${name} must wrap its mutation in db.transaction`,
      );
      assert.ok(
        body.includes("_resyncBillingSheetTotalsTx("),
        `${name} must call _resyncBillingSheetTotalsTx so totals never drift`,
      );
    });
  }

  it("_resyncBillingSheetTotalsTx propagates to the parent invoice when invoiced", () => {
    // Declared `private async`, so window from the declaration directly.
    const idx = STORAGE_SRC.indexOf("private async _resyncBillingSheetTotalsTx(");
    assert.notEqual(idx, -1, "_resyncBillingSheetTotalsTx not found");
    const window = STORAGE_SRC.slice(idx, idx + 2400);
    assert.ok(
      window.includes("bs.invoiceId != null"),
      "_resyncBillingSheetTotalsTx must guard on bs.invoiceId before propagating",
    );
    assert.ok(
      window.includes("_propagateBillingSheetDeltaToInvoiceTx("),
      "_resyncBillingSheetTotalsTx must propagate the delta to the invoice",
    );
  });

  it("_propagateBillingSheetDeltaToInvoiceTx updates invoice partsSubtotal and totalAmount", () => {
    const idx = STORAGE_SRC.indexOf("private async _propagateBillingSheetDeltaToInvoiceTx(");
    assert.notEqual(idx, -1, "_propagateBillingSheetDeltaToInvoiceTx not found");
    const window = STORAGE_SRC.slice(idx, idx + 1200);
    assert.ok(window.includes("tx.update(invoices)"), "must update the invoices table");
    assert.ok(window.includes("partsSubtotal:"), "must set invoice partsSubtotal");
    assert.ok(window.includes("totalAmount:"), "must set invoice totalAmount");
  });

  it("replaceBillingSheetItemsAndResync propagates to the parent invoice", () => {
    const body = methodBody("replaceBillingSheetItemsAndResync");
    assert.ok(
      body.includes("invoiceId: billingSheets.invoiceId"),
      "replaceBillingSheetItemsAndResync must read the sheet invoiceId",
    );
    assert.ok(
      body.includes("_propagateBillingSheetDeltaToInvoiceTx("),
      "replaceBillingSheetItemsAndResync must propagate the delta to the invoice",
    );
  });
});

describe("Task #1422 — PDF fetch route surfaces 422 on drift", () => {
  // Window the GET /api/invoices/:invoiceId/pdf handler (the fetch route that
  // lazily generates + caches the PDF) — distinct from the /pdf/download route.
  function fetchHandlerWindow(): string {
    const marker = 'app.get("/api/invoices/:invoiceId/pdf"';
    const start = ROUTES_SRC.indexOf(marker);
    assert.notEqual(start, -1, "GET /api/invoices/:invoiceId/pdf not found");
    return ROUTES_SRC.slice(start, start + 2500);
  }

  it("returns 422 with validationFailure instead of a bare 500", () => {
    const w = fetchHandlerWindow();
    assert.ok(w.includes("result.validationFailure"), "must branch on result.validationFailure");
    assert.ok(w.includes("res.status(422)"), "must return 422 on validation failure");
    assert.ok(w.includes("validationFailure: result.validationFailure"), "must include the validationFailure payload");
  });
});
