/**
 * invoice-preview-wcb.test.ts  (Task #787 Slice 2)
 *
 * Static-source tests for the POST /api/invoices/preview route changes:
 *   - wetCheckBillingIds from req.body is parsed (destructuring guard)
 *   - eligibility filter: only approved_passed_to_billing + invoiceId==null
 *   - selectedWcbsPreview filtered by wetCheckBillingIds
 *   - "no valid items" guard now includes WCBs in the check
 *   - WCB preview items use sourceType='wet_check_billing'
 *   - totalAmount accumulates WCB totals
 *   - response includes wetCheckBillings eligibility list
 *
 * These are source-pattern guards (AST-style string assertions) so they do NOT
 * require a live DB connection.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routesPath = path.join(__dirname, "routes.ts");
const src = fs.readFileSync(routesPath, "utf8");

// Locate the preview route body — extract the substring between the two route
// handler definitions so we don't accidentally match monthly route patterns.
const previewStart = src.indexOf('app.post("/api/invoices/preview"');
const monthlyStart = src.indexOf('app.post("/api/invoices/monthly"');
assert.ok(previewStart !== -1, "preview route not found");
assert.ok(monthlyStart !== -1, "monthly route not found");
const previewSrc = src.slice(previewStart, monthlyStart);

describe("POST /api/invoices/preview — WCB destructuring (Task #787)", () => {
  it("destructures wetCheckBillingIds from req.body", () => {
    assert.match(previewSrc, /wetCheckBillingIds\s*=\s*\[\]/);
  });
});

describe("POST /api/invoices/preview — eligibility filter (Task #787)", () => {
  it("queries wet check billings by customer", () => {
    assert.match(previewSrc, /getWetCheckBillingsByCustomer/);
  });

  it("filters by approved_passed_to_billing status", () => {
    assert.match(previewSrc, /approved_passed_to_billing/);
  });

  it("filters out billings that already have an invoiceId", () => {
    assert.match(previewSrc, /invoiceId\s*==\s*null/);
  });
});

describe("POST /api/invoices/preview — selected WCBs filter (Task #787)", () => {
  it("filters eligible WCBs by wetCheckBillingIds when non-empty", () => {
    assert.match(previewSrc, /selectedWcbsPreview/);
    assert.match(previewSrc, /wetCheckBillingIds\.includes/);
  });
});

describe("POST /api/invoices/preview — zero-item guard includes WCBs (Task #787)", () => {
  it("no-valid-items check includes selectedWcbsPreview", () => {
    assert.match(
      previewSrc,
      /selectedWcbsPreview\.length\s*===\s*0/,
    );
  });
});

describe("POST /api/invoices/preview — WCB preview items (Task #787)", () => {
  it("creates preview items with sourceType='wet_check_billing'", () => {
    assert.match(previewSrc, /sourceType:\s*['"]wet_check_billing['"]/);
  });
});

describe("POST /api/invoices/preview — totals include WCBs (Task #787)", () => {
  it("laborSubtotal reduce includes selectedWcbsPreview", () => {
    const laborBlock = previewSrc.slice(
      previewSrc.indexOf("const laborSubtotal"),
      previewSrc.indexOf("const partsSubtotal"),
    );
    assert.match(laborBlock, /selectedWcbsPreview\.reduce/);
  });

  it("partsSubtotal reduce includes selectedWcbsPreview", () => {
    const partsBlock = previewSrc.slice(
      previewSrc.indexOf("const partsSubtotal"),
      previewSrc.indexOf("const totalAmount"),
    );
    assert.match(partsBlock, /selectedWcbsPreview\.reduce/);
  });

  it("totalAmount reduce includes selectedWcbsPreview", () => {
    const totalBlock = previewSrc.slice(
      previewSrc.indexOf("const totalAmount"),
      previewSrc.indexOf("// Create preview items"),
    );
    assert.match(totalBlock, /selectedWcbsPreview\.reduce/);
  });
});

describe("POST /api/invoices/preview — response includes wetCheckBillings (Task #787)", () => {
  it("response object includes wetCheckBillings key", () => {
    assert.match(previewSrc, /wetCheckBillings:\s*eligibleWcbs/);
  });

  it("itemCount includes selectedWcbsPreview.length", () => {
    assert.match(previewSrc, /selectedWcbsPreview\.length/);
  });
});

describe("POST /api/invoices/preview — fallback guard includes WCB selector (Task #787)", () => {
  // Regression guard: submitting only wetCheckBillingIds (no WO/BS ids) must
  // NOT trigger the fallback that auto-selects all eligible WOs and BSs.
  // The fix is to AND wetCheckBillingIds.length===0 into the fallback condition.
  it("fallback condition checks wetCheckBillingIds.length === 0", () => {
    // Extract the fallback block (between "no specific items" comment and end of if block)
    const fallbackIdx = previewSrc.indexOf("// If no specific items selected");
    assert.ok(fallbackIdx !== -1, "fallback comment not found");
    const fallbackBlock = previewSrc.slice(fallbackIdx, fallbackIdx + 600);
    // Must check all three: workOrderIds, billingSheetIds, AND wetCheckBillingIds
    assert.match(fallbackBlock, /workOrderIds\.length\s*===\s*0/);
    assert.match(fallbackBlock, /billingSheetIds\.length\s*===\s*0/);
    assert.match(fallbackBlock, /wetCheckBillingIds\.length\s*===\s*0/);
  });

  it("WCB-only selection does not expand into the fallback (no wetCheckBillingIds in fallback body)", () => {
    // The body of the if-fallback must not touch selectedWcbsPreview —
    // WCBs are only populated by the explicit wetCheckBillingIds filter above.
    const fallbackIdx = previewSrc.indexOf("// If no specific items selected");
    assert.ok(fallbackIdx !== -1);
    // Find the closing brace of the if block by looking for the next empty-guard check
    const noItemsIdx = previewSrc.indexOf("No valid items selected", fallbackIdx);
    const fallbackBody = previewSrc.slice(fallbackIdx, noItemsIdx);
    // selectedWcbsPreview must NOT be assigned inside the fallback body
    assert.doesNotMatch(fallbackBody, /selectedWcbsPreview\s*=/);
  });
});
