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
// Task #1669 — shared helper module for non-item total recomputes.
const HELPER_SRC = readFileSync(path.join(here, "..", "billing-sheet-total.ts"), "utf8");

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

// ─── Task #1669 — PATCH zeroing fix and guard ────────────────────────────────

describe("Task #1669 — computeBillingSheetTotal helper uses stored fallback", () => {
  // The helper now lives in billing-sheet-total.ts (shared module), not
  // inline in routes.ts. These source-scan assertions verify the shared module
  // enforces the stored-fallback contract.
  function helperWindow(): string {
    const marker = "function computeBillingSheetTotal(";
    const start = HELPER_SRC.indexOf(marker);
    assert.notEqual(start, -1, "computeBillingSheetTotal not found in billing-sheet-total.ts");
    return HELPER_SRC.slice(start, start + 600);
  }

  it("helper falls back to stored.partsSubtotal when patch omits partsSubtotal", () => {
    const w = helperWindow();
    assert.ok(
      w.includes("stored?.partsSubtotal") || w.includes("stored.partsSubtotal"),
      "computeBillingSheetTotal must fall back to stored partsSubtotal — absent patch field must not default to $0",
    );
  });

  it("helper falls back to stored.laborSubtotal when patch omits laborSubtotal", () => {
    const w = helperWindow();
    assert.ok(
      w.includes("stored?.laborSubtotal") || w.includes("stored.laborSubtotal"),
      "computeBillingSheetTotal must fall back to stored laborSubtotal — absent patch field must not default to $0",
    );
  });

  it("helper uses ?? (nullish coalesce) so an explicit '0' patch value is honoured", () => {
    const w = helperWindow();
    // Both subtotals must use ?? not || so that an explicit partsSubtotal='0'
    // on the patch body is accepted as a real zero, not coerced to stored.
    const partsUseNullish = w.includes("patched.partsSubtotal ??");
    const laborUseNullish = w.includes("patched.laborSubtotal ??");
    assert.ok(partsUseNullish, "partsSubtotal fallback must use ?? (nullish coalesce), not ||");
    assert.ok(laborUseNullish, "laborSubtotal fallback must use ?? (nullish coalesce), not ||");
  });
});

describe("Task #1669 — PATCH /api/billing-sheets/:id uses the stored-fallback helper", () => {
  // Locate the totalAmount recompute block in the generic PATCH handler and
  // verify it delegates to computeBillingSheetTotal with the pre-fetched stored
  // record as the second argument.
  function patchTotalWindow(): string {
    const handlerMarker = 'app.patch("/api/billing-sheets/:id",';
    const start = ROUTES_SRC.indexOf(handlerMarker);
    assert.notEqual(start, -1, "PATCH /api/billing-sheets/:id handler not found");
    // The totalAmount recompute block sits ~8 000 bytes into the handler body
    // (after the lock checks and the labor-mode normalization block).
    return ROUTES_SRC.slice(start, start + 9000);
  }

  it("PATCH handler calls computeBillingSheetTotal instead of patching-body-only arithmetic", () => {
    const w = patchTotalWindow();
    assert.ok(
      w.includes("computeBillingSheetTotal("),
      "PATCH handler must call computeBillingSheetTotal — raw partsSubtotal-from-body arithmetic is the bug",
    );
    // Ensure the stored record (fetched earlier for the lock check) is passed as
    // the second argument so missing subtotals fall back to DB values.
    assert.ok(
      w.includes("computeBillingSheetTotal(billingSheetData, existingBsForLockCheck)"),
      "computeBillingSheetTotal must receive existingBsForLockCheck as stored-fallback",
    );
  });

  it("PATCH handler only triggers totalAmount recompute when a subtotal is present in the body", () => {
    const w = patchTotalWindow();
    // The guard condition must stay so a pure notes/status/photos PATCH does not
    // clobber the stored total.
    assert.ok(
      w.includes("laborSubtotal !== undefined || billingSheetData.partsSubtotal !== undefined"),
      "totalAmount recompute must be guarded by a subtotal-present check",
    );
  });
});

describe("Task #1669 — non-item billing-sheet mutation paths route through the shared helper", () => {
  // The /labor-hours and /rate-mode dedicated endpoints delegate entirely to
  // storage methods (updateBillingSheetLaborHours,
  // recomputeBillingSheetTotalsForRateMode). These source-scan assertions lock
  // in that both methods:
  //   (a) call computeBillingSheetTotal (the shared invariant helper), and
  //   (b) do NOT call _resyncBillingSheetTotalsTx (which re-derives
  //       partsSubtotal from item rows, zeroing parts on no-item sheets).

  function storageLaborHoursWindow(): string {
    const start = STORAGE_SRC.indexOf("async updateBillingSheetLaborHours(");
    assert.notEqual(start, -1, "updateBillingSheetLaborHours not found in storage.ts");
    const next = STORAGE_SRC.indexOf("\n  async ", start + 1);
    return STORAGE_SRC.slice(start, next === -1 ? STORAGE_SRC.length : next);
  }

  function storageRateModeWindow(): string {
    const start = STORAGE_SRC.indexOf("async recomputeBillingSheetTotalsForRateMode(");
    assert.notEqual(start, -1, "recomputeBillingSheetTotalsForRateMode not found in storage.ts");
    const next = STORAGE_SRC.indexOf("\n  async ", start + 1);
    return STORAGE_SRC.slice(start, next === -1 ? STORAGE_SRC.length : next);
  }

  it("updateBillingSheetLaborHours routes through computeBillingSheetTotal", () => {
    const w = storageLaborHoursWindow();
    assert.ok(
      w.includes("computeBillingSheetTotal("),
      "updateBillingSheetLaborHours must call computeBillingSheetTotal — same helper as the PATCH route",
    );
  });

  it("updateBillingSheetLaborHours passes stored partsSubtotal as the fallback to the helper", () => {
    const w = storageLaborHoursWindow();
    assert.ok(
      w.includes("bs.partsSubtotal"),
      "updateBillingSheetLaborHours must supply bs.partsSubtotal as stored fallback so labor-hours edits never zero parts",
    );
  });

  it("recomputeBillingSheetTotalsForRateMode routes through computeBillingSheetTotal", () => {
    const w = storageRateModeWindow();
    assert.ok(
      w.includes("computeBillingSheetTotal("),
      "recomputeBillingSheetTotalsForRateMode must call computeBillingSheetTotal — same helper as the PATCH route",
    );
  });

  it("recomputeBillingSheetTotalsForRateMode passes stored partsSubtotal as the fallback to the helper", () => {
    const w = storageRateModeWindow();
    assert.ok(
      w.includes("bs.partsSubtotal"),
      "recomputeBillingSheetTotalsForRateMode must supply bs.partsSubtotal so a rate-mode flip never zeros parts",
    );
  });

  it("neither labor-hours nor rate-mode path routes through _resyncBillingSheetTotalsTx", () => {
    // _resyncBillingSheetTotalsTx re-derives partsSubtotal from item rows,
    // which zeroes parts on sheets that carry a partsSubtotal without item rows.
    // These paths must NOT call it.
    const lh = storageLaborHoursWindow();
    const rm = storageRateModeWindow();
    assert.ok(
      !lh.includes("_resyncBillingSheetTotalsTx("),
      "updateBillingSheetLaborHours must not call _resyncBillingSheetTotalsTx",
    );
    assert.ok(
      !rm.includes("_resyncBillingSheetTotalsTx("),
      "recomputeBillingSheetTotalsForRateMode must not call _resyncBillingSheetTotalsTx",
    );
  });
});

describe("Task #1669 — Slice 5: lock and live-total contract", () => {
  // Verify the PATCH lock only blocks billed/invoiced records; billing managers
  // can still edit approved-but-not-yet-invoiced sheets. Also confirm the
  // monthly invoice route reads live stored totals from the fetched records —
  // not approval-time snapshots.

  function patchLockWindow(): string {
    const handlerMarker = 'app.patch("/api/billing-sheets/:id",';
    const start = ROUTES_SRC.indexOf(handlerMarker);
    assert.notEqual(start, -1, "PATCH /api/billing-sheets/:id handler not found");
    // 2000 chars covers the lock block (~1715 bytes from the handler marker)
    return ROUTES_SRC.slice(start, start + 2000);
  }

  // The monthly invoice billing-sheet aggregation sits ~12 000 bytes inside the
  // handler body — too far for a simple route-marker window. Search for
  // `selectedBillingSheets.reduce` directly and verify surrounding context.
  function monthlyBsAggregationWindow(): string {
    const marker = 'selectedBillingSheets.reduce';
    // There are multiple occurrences; find the one that mentions bs.totalAmount
    // (the totalAmount aggregation, which is the key live-total assertion).
    let pos = 0;
    while (true) {
      pos = ROUTES_SRC.indexOf(marker, pos);
      assert.notEqual(pos, -1, "selectedBillingSheets.reduce not found in routes.ts");
      const w = ROUTES_SRC.slice(pos, pos + 300);
      if (w.includes("bs.totalAmount")) return w;
      pos++;
    }
  }

  function monthlyBsSubtotalWindow(): string {
    // Find the reduce that handles partsSubtotal aggregation.
    const marker = 'selectedBillingSheets.reduce';
    let pos = 0;
    while (true) {
      pos = ROUTES_SRC.indexOf(marker, pos);
      assert.notEqual(pos, -1, "selectedBillingSheets.reduce not found in routes.ts");
      const w = ROUTES_SRC.slice(pos, pos + 300);
      if (w.includes("bs.partsSubtotal")) return w;
      pos++;
    }
  }

  it("PATCH lock blocks billed status and invoiced records but NOT approved-only records", () => {
    const w = patchLockWindow();
    // Primary lock: invoiceId set or status === 'billed'
    assert.ok(
      w.includes("existingBsForLockCheck.invoiceId") && w.includes("status === 'billed'"),
      "Primary lock must check invoiceId and status=billed",
    );
    // Secondary lock for approved_passed_to_billing only restricts non-managers
    assert.ok(
      w.includes("approved_passed_to_billing") && w.includes("billing_manager"),
      "Approved-for-billing sheets must remain editable by billing managers",
    );
  });

  it("monthly invoice reads live stored totalAmount from billing sheets (not approval-time snapshots)", () => {
    const w = monthlyBsAggregationWindow();
    assert.ok(
      w.includes("bs.totalAmount"),
      "Monthly invoice must aggregate live bs.totalAmount — not a snapshot",
    );
  });

  it("monthly invoice reads live partsSubtotal and laborSubtotal from billing sheets", () => {
    const wp = monthlyBsSubtotalWindow();
    assert.ok(
      wp.includes("bs.partsSubtotal"),
      "Monthly invoice must read live partsSubtotal from billing sheets",
    );
    // Find the laborSubtotal reduce
    const marker = 'selectedBillingSheets.reduce';
    let pos = 0;
    let foundLabor = false;
    while ((pos = ROUTES_SRC.indexOf(marker, pos)) !== -1) {
      const w = ROUTES_SRC.slice(pos, pos + 300);
      if (w.includes("bs.laborSubtotal")) { foundLabor = true; break; }
      pos++;
    }
    assert.ok(foundLabor, "Monthly invoice must read live laborSubtotal from billing sheets");
  });

  it("totalAmount === partsSubtotal + laborSubtotal invariant after a generic PATCH (property assertion)", () => {
    // computeBillingSheetTotal lives in billing-sheet-total.ts and always
    // returns (parts + labor).toFixed(2) — verify the return expression.
    const helperStart = HELPER_SRC.indexOf("function computeBillingSheetTotal(");
    assert.notEqual(helperStart, -1, "computeBillingSheetTotal not found in billing-sheet-total.ts");
    const helperSrc = HELPER_SRC.slice(helperStart, helperStart + 600);
    assert.ok(
      helperSrc.includes("parts + labor"),
      "computeBillingSheetTotal return value must be parts + labor so totalAmount === partsSubtotal + laborSubtotal",
    );
    assert.ok(
      helperSrc.includes(".toFixed(2)"),
      "computeBillingSheetTotal must toFixed(2) to stay in sync with DB decimal columns",
    );
  });
});
