/**
 * wcb-invoice-gate.test.ts — Task #1090
 *
 * Verifies that the four WCB eligibility filter sites in routes.ts all
 * require `wcb.wetCheckStatus === 'converted'` before including a WCB in
 * invoice eligibility.  These are source-level assertions — no DB or HTTP
 * needed.
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
  const eligibilitySites = [
    // 1. Monthly billing summary unbilledWetCheckBillings filter
    "unbilledWetCheckBillings = wetCheckBillingsForCustomer.filter",
    // 2. Invoice workspace: per-customer unbilled WCBs filter
    "unbilledWetCheckBillings = wetCheckBillings.filter",
    // 3. Invoice preview: eligibleWcbs filter
    "eligibleWcbs = allWcbsForPreview.filter",
    // 4. Monthly invoice: eligibleWcbsMonthly filter
    "eligibleWcbsMonthly = allWcbsForMonthly.filter",
  ];

  for (const anchor of eligibilitySites) {
    it(`filter at "${anchor.slice(0, 50)}…" requires wetCheckStatus === 'converted'`, () => {
      const region = nearby(routesSrc, anchor, 800);
      assert.ok(region, `anchor not found: ${anchor}`);
      assert.ok(
        region.includes("wetCheckStatus") && region.includes("converted"),
        `Expected wetCheckStatus === 'converted' guard near "${anchor.slice(0, 60)}…"\n\nActual region:\n${region}`,
      );
    });
  }

  it("all four filter sites exist in routes.ts", () => {
    let found = 0;
    for (const anchor of eligibilitySites) {
      if (routesSrc.includes(anchor)) found++;
    }
    assert.equal(found, 4, `Expected 4 eligibility filter sites, found ${found}`);
  });

  it("getWetCheckBillingsByCustomer return type is WetCheckBillingListItem[] (includes wetCheckStatus)", () => {
    const storageSrc = readFileSync(
      path.join(__dirname, "..", "storage.ts"),
      "utf8",
    );
    const region = nearby(storageSrc, "getWetCheckBillingsByCustomer", 1200);
    assert.ok(region);
    assert.ok(
      region.includes("WetCheckBillingListItem"),
      "getWetCheckBillingsByCustomer must return WetCheckBillingListItem[] (which carries wetCheckStatus)",
    );
    assert.ok(
      region.includes("wetCheckStatus"),
      "getWetCheckBillingsByCustomer implementation must JOIN wet_checks and expose wetCheckStatus",
    );
  });
});
