/**
 * invoice-monthly-wcb.test.ts  (Task #787 Slice 2)
 *
 * Static-source tests for the POST /api/invoices/monthly route changes:
 *   - selectedWetCheckBillingIds destructured from req.body
 *   - eligibility filter mirrors the preview route
 *   - "no valid items" guard includes WCBs
 *   - totalAmount accumulates WCB totals
 *   - invoice items created with sourceType='wet_check_billing' + wetCheckBillingId
 *   - WCB QB line items built with WCB-prefixed description
 *   - status update calls updateWetCheckBilling with status='billed'
 *   - itemCount in response includes selectedWcbs.length
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routesPath = path.join(__dirname, "routes.ts");
const src = fs.readFileSync(routesPath, "utf8");

// Extract the monthly route body
const monthlyStart = src.indexOf('app.post("/api/invoices/monthly"');
// next major route block ends at the first `app.` call after the monthly route
const nextRoute = src.indexOf("\n  app.", monthlyStart + 1);
const monthlySrc = nextRoute === -1 ? src.slice(monthlyStart) : src.slice(monthlyStart, nextRoute);

describe("POST /api/invoices/monthly — WCB destructuring (Task #787)", () => {
  it("destructures selectedWetCheckBillingIds from req.body", () => {
    assert.match(monthlySrc, /selectedWetCheckBillingIds\s*=\s*\[\]/);
  });
});

describe("POST /api/invoices/monthly — eligibility filter (Task #787)", () => {
  it("queries wet check billings by customer", () => {
    assert.match(monthlySrc, /getWetCheckBillingsByCustomer/);
  });

  it("filters by approved_passed_to_billing", () => {
    assert.match(monthlySrc, /approved_passed_to_billing/);
  });

  it("filters out billings that already have an invoiceId", () => {
    assert.match(monthlySrc, /invoiceId\s*==\s*null/);
  });

  it("filters eligible WCBs by selectedWetCheckBillingIds when non-empty", () => {
    assert.match(monthlySrc, /selectedWetCheckBillingIds\.includes/);
  });
});

describe("POST /api/invoices/monthly — zero-item guard includes WCBs (Task #787)", () => {
  it("no-valid-items check includes selectedWcbs", () => {
    assert.match(monthlySrc, /selectedWcbs\.length\s*===\s*0/);
  });
});

describe("POST /api/invoices/monthly — totals include WCBs (Task #787)", () => {
  it("laborSubtotal reduce includes selectedWcbs", () => {
    const laborBlock = monthlySrc.slice(
      monthlySrc.indexOf("const laborSubtotal"),
      monthlySrc.indexOf("const partsSubtotal"),
    );
    assert.match(laborBlock, /selectedWcbs\.reduce/);
  });

  it("partsSubtotal reduce includes selectedWcbs", () => {
    const partsBlock = monthlySrc.slice(
      monthlySrc.indexOf("const partsSubtotal"),
      monthlySrc.indexOf("const totalAmount"),
    );
    assert.match(partsBlock, /selectedWcbs\.reduce/);
  });

  it("totalAmount reduce includes selectedWcbs", () => {
    const totalBlock = monthlySrc.slice(
      monthlySrc.indexOf("const totalAmount"),
      monthlySrc.indexOf("// Create the invoice record"),
    );
    assert.match(totalBlock, /selectedWcbs\.reduce/);
  });
});

describe("POST /api/invoices/monthly — invoice items creation (Task #787)", () => {
  it("creates invoice items with sourceType='wet_check_billing'", () => {
    assert.match(monthlySrc, /sourceType:\s*['"]wet_check_billing['"]/);
  });

  it("invoice item includes wetCheckBillingId field", () => {
    assert.match(monthlySrc, /wetCheckBillingId:\s*wcb\.id/);
  });
});

describe("POST /api/invoices/monthly — QuickBooks line items (Task #787)", () => {
  it("builds QB line items for WCBs with WCB-prefixed description", () => {
    assert.match(monthlySrc, /WCB-\$\{wcb\.billingNumber\}/);
  });

  it("QB line amount uses WCB totalAmount", () => {
    assert.match(monthlySrc, /parseFloat\(wcb\.totalAmount/);
  });
});

describe("POST /api/invoices/monthly — status update (Task #787)", () => {
  it("calls updateWetCheckBilling with status='billed'", () => {
    assert.match(monthlySrc, /updateWetCheckBilling/);
    assert.match(monthlySrc, /status:\s*['"]billed['"]/);
  });

  it("sets invoiceId on WCB update", () => {
    assert.match(monthlySrc, /invoiceId:\s*invoice\.id/);
  });

  it("sets billedAt on WCB update", () => {
    assert.match(monthlySrc, /billedAt:\s*currentDate/);
  });
});

describe("POST /api/invoices/monthly — response itemCount (Task #787)", () => {
  it("itemCount in response includes selectedWcbs.length", () => {
    assert.match(monthlySrc, /selectedWcbs\.length/);
  });
});

describe("POST /api/invoices/monthly — fallback guard includes WCB selector (Task #787)", () => {
  // Regression guard: submitting only selectedWetCheckBillingIds (no WO/BS ids) must
  // NOT trigger the fallback that auto-selects all eligible WOs and BSs.
  it("fallback condition checks selectedWetCheckBillingIds.length === 0", () => {
    const fallbackIdx = monthlySrc.indexOf("// If no specific items selected");
    assert.ok(fallbackIdx !== -1, "fallback comment not found");
    const fallbackBlock = monthlySrc.slice(fallbackIdx, fallbackIdx + 600);
    assert.match(fallbackBlock, /workOrderIds\.length\s*===\s*0/);
    assert.match(fallbackBlock, /billingSheetIds\.length\s*===\s*0/);
    assert.match(fallbackBlock, /selectedWetCheckBillingIds\.length\s*===\s*0/);
  });

  it("WCB-only selection does not expand into the fallback (selectedWcbs not assigned in fallback body)", () => {
    const fallbackIdx = monthlySrc.indexOf("// If no specific items selected");
    assert.ok(fallbackIdx !== -1);
    const noItemsIdx = monthlySrc.indexOf("No valid items selected", fallbackIdx);
    const fallbackBody = monthlySrc.slice(fallbackIdx, noItemsIdx);
    // selectedWcbs must NOT be assigned inside the fallback body
    assert.doesNotMatch(fallbackBody, /selectedWcbs\s*=/);
  });
});
