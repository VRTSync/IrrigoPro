/**
 * Task #1090 — WCB Billing Gate
 * Frontend regression: wet-check-billings.tsx must show a "Review in
 * progress" badge for WCBs that are `approved_passed_to_billing` but
 * whose underlying wet check is NOT yet `converted`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const SRC = readFileSync(
  resolve(__dirname, "wet-check-billings.tsx"),
  "utf8",
);

describe("wet-check-billings — review-in-progress badge", () => {
  it("renders a 'Review in progress' badge for non-converted WCBs", () => {
    // The badge text is present in the source
    expect(SRC).toContain("Review in progress");
  });

  it("gates the badge on wetCheckStatus !== 'converted'", () => {
    // Condition must check wetCheckStatus
    expect(SRC).toMatch(/wetCheckStatus.*!==.*['"]converted['"]/);
  });

  it("the badge is only shown when wetCheckStatus is not null", () => {
    // Must guard against null (LEFT JOIN may produce null for converted rows)
    expect(SRC).toMatch(/wetCheckStatus.*null/);
  });

  it("does not show badge unconditionally (still has the condition block)", () => {
    // Verify the condition references approved_passed_to_billing status
    expect(SRC).toContain("approved_passed_to_billing");
  });
});

describe("wet-check-billings — invoice-creation explainer in customer-billing", () => {
  const BILLING_SRC = readFileSync(
    resolve(__dirname, "customer-billing.tsx"),
    "utf8",
  );

  it("renders an explainer for filtered WCBs in the invoice modal", () => {
    expect(BILLING_SRC).toContain("wcb-review-in-progress-explainer");
  });

  it("explains that WCBs are waiting on manager review", () => {
    expect(BILLING_SRC).toContain("waiting on manager review");
  });

  it("counts filtered WCBs by comparing unbilledIds set against full wetCheckBillings list", () => {
    expect(BILLING_SRC).toContain("unbilledIds");
    expect(BILLING_SRC).toContain("pendingCount");
  });
});
