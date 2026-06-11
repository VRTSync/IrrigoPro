/**
 * wcb-invoice-gate.test.ts
 *
 * Invariant: the `wcb.wetCheckStatus === 'converted'` guard must be PRESENT on
 * invoice-construction filter sites (eligibleWcbs / eligibleWcbsMonthly) and
 * must be ABSENT from visibility filter sites (unbilledWetCheckBillings in both
 * the billing-preview and the single-customer billing endpoints).
 *
 * Visibility sites must NOT gate on wetCheckStatus so that partially-converted-
 * parent WCBs are still reachable by billing managers. The converted gate on
 * invoice-construction paths remains intentional: a WCB whose parent wet check
 * is still partial should not yet be included in an invoice.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routesSrc = readFileSync(
  path.join(__dirname, "routes.ts"),
  "utf8",
);

/**
 * Return the N characters around the first occurrence of `anchor` in `src`.
 */
function nearby(src: string, anchor: string, window = 800): string | null {
  const idx = src.indexOf(anchor);
  if (idx < 0) return null;
  return src.slice(Math.max(0, idx - window / 2), idx + window / 2);
}

describe("WCB invoice-gate: converted-status guard", () => {
  // Invoice-construction paths — converted gate MUST be present.
  const invoiceConstructionSites = [
    // 3. Invoice preview: eligibleWcbs filter
    "eligibleWcbs = allWcbsForPreview.filter",
    // 4. Monthly invoice: eligibleWcbsMonthly filter
    "eligibleWcbsMonthly = allWcbsForMonthly.filter",
  ];

  // Visibility paths — converted gate must be ABSENT (partial-parent WCBs must
  // still surface so billing managers can act on them).
  const visibilitySites = [
    // 1. Billing-preview customer list: unbilledWetCheckBillings filter
    "unbilledWetCheckBillings = wetCheckBillingsForCustomer.filter",
    // 2. Single-customer billing page: unbilledWetCheckBillings filter
    "unbilledWetCheckBillings = wetCheckBillings.filter",
  ];

  for (const anchor of invoiceConstructionSites) {
    it(`invoice-construction filter at "${anchor.slice(0, 50)}…" requires wetCheckStatus === 'converted'`, () => {
      const region = nearby(routesSrc, anchor, 800);
      assert.ok(region, `anchor not found: ${anchor}`);
      assert.ok(
        region.includes("wetCheckStatus") && region.includes("converted"),
        `Expected wetCheckStatus === 'converted' guard near "${anchor.slice(0, 60)}…"\n\nActual region:\n${region}`,
      );
    });
  }

  it("both invoice-construction filter sites exist in routes.ts", () => {
    let found = 0;
    for (const anchor of invoiceConstructionSites) {
      if (routesSrc.includes(anchor)) found++;
    }
    assert.equal(found, 2, `Expected 2 invoice-construction filter sites, found ${found}`);
  });

  for (const anchor of visibilitySites) {
    it(`visibility filter at "${anchor.slice(0, 50)}…" must NOT gate on wetCheckStatus`, () => {
      const region = nearby(routesSrc, anchor, 800);
      assert.ok(region, `anchor not found: ${anchor}`);
      // The gate must be absent from the filter expression itself.
      // We look for the closing ')' of the filter callback to bound the search.
      // Use a tighter 400-char window so we don't accidentally catch a nearby comment.
      const tightRegion = nearby(routesSrc, anchor, 400) ?? "";
      assert.ok(
        !tightRegion.includes("wetCheckStatus === 'converted'"),
        `wetCheckStatus === 'converted' must NOT appear in the visibility filter near "${anchor.slice(0, 60)}…"\n\nActual region:\n${tightRegion}`,
      );
    });
  }

  it("both visibility filter sites exist in routes.ts", () => {
    let found = 0;
    for (const anchor of visibilitySites) {
      if (routesSrc.includes(anchor)) found++;
    }
    assert.equal(found, 2, `Expected 2 visibility filter sites, found ${found}`);
  });

  it("getWetCheckBillingsByCustomer implementation JOINs wet_checks and exposes wetCheckStatus", () => {
    const storageSrc = readFileSync(
      path.join(__dirname, "..", "storage.ts"),
      "utf8",
    );
    // Use the async implementation line as anchor (not the interface declaration which
    // appears first in the file but only carries the return-type signature).
    const implAnchor = "async getWetCheckBillingsByCustomer(";
    const region = nearby(storageSrc, implAnchor, 2000);
    assert.ok(region, `implementation anchor not found: ${implAnchor}`);
    assert.ok(
      region.includes("WetCheckBillingListItem"),
      "getWetCheckBillingsByCustomer must return WetCheckBillingListItem[] (which carries wetCheckStatus)",
    );
    assert.ok(
      region.includes("wetCheckStatus"),
      "getWetCheckBillingsByCustomer implementation must JOIN wet_checks and expose wetCheckStatus",
    );
  });

  it("partially_converted WCB at approved_passed_to_billing appears in billing-preview visibility filter", () => {
    // Regression case: the visibility filter must not contain the 'converted' gate,
    // so a WCB whose parent wet check is partially_converted is included in approvedTotal.
    const anchor = "unbilledWetCheckBillings = wetCheckBillingsForCustomer.filter";
    const region = nearby(routesSrc, anchor, 400) ?? "";
    assert.ok(region, `anchor not found: ${anchor}`);
    // Must include approved_passed_to_billing check
    assert.ok(
      region.includes("approved_passed_to_billing"),
      "visibility filter must include approved_passed_to_billing status check",
    );
    // Must NOT gate on wetCheckStatus === 'converted'
    assert.ok(
      !region.includes("wetCheckStatus === 'converted'"),
      "visibility filter must not gate on wetCheckStatus === 'converted'",
    );
  });
});
