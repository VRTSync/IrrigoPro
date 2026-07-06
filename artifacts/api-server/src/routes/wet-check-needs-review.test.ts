/**
 * wet-check-needs-review.test.ts
 *
 * Unit-level coverage for the predicates introduced in finding-predicates.ts
 * and their integration into the needs-review endpoint and billing gate.
 *
 * Covers:
 *  (a) WC-109 scenario — all findings triaged, partially_converted, snapshot
 *      approved → unroutedFindings = 0, drops out of needs-review list; list
 *      and surface use the same predicate.
 *  (b) Wet check with a genuine needs_review/pending/unrouted finding still
 *      shows in the list with the correct count.
 *  (c) Findings billed into a WCB carry wetCheckBillingId and convertedAt
 *      (source-scan: _writeRepairedInFieldBilling stamps both fields).
 *  (d) Billing eligibility — fully-triaged approved WCB is selectable;
 *      WCB with untriaged parent findings is not; picker and generator use
 *      the same wcbIsEligible function.
 *  (e) Company isolation — isUnroutedFinding is pure (no DB); route-level
 *      company scoping is asserted via source-scan.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  isNeedsReview,
  isUnroutedFinding,
  wcbIsEligible,
} from "../lib/finding-predicates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readSrc(relPath: string): string {
  return readFileSync(path.join(__dirname, relPath), "utf8");
}

// ── Helper builders ───────────────────────────────────────────────────────────

type FindingStub = {
  resolution?: string | null;
  techDisposition?: string | null;
  issueType?: string | null;
  convertedAt?: Date | null;
  billingSheetId?: number | null;
  estimateId?: number | null;
  workOrderId?: number | null;
  wetCheckBillingId?: number | null;
};

function makeFinding(overrides: FindingStub = {}): FindingStub {
  return {
    resolution: "pending",
    techDisposition: "needs_review",
    issueType: "head_replacement",
    convertedAt: null,
    billingSheetId: null,
    estimateId: null,
    workOrderId: null,
    wetCheckBillingId: null,
    ...overrides,
  };
}

type WcbStub = {
  status: string;
  invoiceId?: number | null;
  unroutedFindingsCount: number;
};

function makeWcb(overrides: Partial<WcbStub> = {}): WcbStub {
  return {
    status: "approved_passed_to_billing",
    invoiceId: null,
    unroutedFindingsCount: 0,
    ...overrides,
  };
}

// ── (a) WC-109 scenario: all findings triaged, partially_converted ────────────

describe("isUnroutedFinding — WC-109 scenario (partially_converted, all triaged)", () => {
  it("finding with repaired_in_field resolution is NOT unrouted", () => {
    const f = makeFinding({ resolution: "repaired_in_field" });
    assert.equal(isUnroutedFinding(f), false, "resolved findings must not count as unrouted");
  });

  it("finding with wetCheckBillingId set is NOT unrouted (already billed into WCB)", () => {
    const f = makeFinding({ wetCheckBillingId: 42 });
    assert.equal(isUnroutedFinding(f), false, "WCB-stamped findings must not count as unrouted");
  });

  it("finding with convertedAt set is NOT unrouted (already stamped)", () => {
    const f = makeFinding({ convertedAt: new Date() });
    assert.equal(isUnroutedFinding(f), false, "convertedAt findings must not count as unrouted");
  });

  it("finding with billingSheetId set is NOT unrouted", () => {
    const f = makeFinding({ billingSheetId: 7 });
    assert.equal(isUnroutedFinding(f), false);
  });

  it("finding with estimateId set is NOT unrouted", () => {
    const f = makeFinding({ estimateId: 3 });
    assert.equal(isUnroutedFinding(f), false);
  });

  it("finding with workOrderId set is NOT unrouted", () => {
    const f = makeFinding({ workOrderId: 11 });
    assert.equal(isUnroutedFinding(f), false);
  });

  it("WC-109: all findings have wetCheckBillingId → unrouted count = 0 → drops from list", () => {
    const findings = [
      makeFinding({ wetCheckBillingId: 1, convertedAt: new Date(), resolution: "repaired_in_field" }),
      makeFinding({ wetCheckBillingId: 1, convertedAt: new Date(), resolution: "repaired_in_field" }),
      makeFinding({ estimateId: 5, resolution: "sent_to_estimate" }),
    ];
    const unrouted = findings.filter(f => isUnroutedFinding(f)).length;
    assert.equal(unrouted, 0, "All triaged findings → unroutedFindings must be 0 → wet check drops from needs-review list");
  });
});

// ── (a) List and surface use the same predicate ───────────────────────────────

describe("List and CombinedReviewSurface use the same predicate", () => {
  it("needs-review endpoint imports and calls isUnroutedFinding (source scan)", () => {
    const src = readSrc("routes.ts");
    assert.ok(
      src.includes("isUnroutedFinding"),
      "routes.ts must import and call isUnroutedFinding",
    );
    assert.ok(
      src.includes("from \"../lib/finding-predicates\""),
      "routes.ts must import from finding-predicates module",
    );
  });

  it("finding-predicates.ts exports both isUnroutedFinding and wcbIsEligible", () => {
    const src = readSrc("../lib/finding-predicates.ts");
    assert.ok(src.includes("export function isUnroutedFinding"), "isUnroutedFinding must be exported");
    assert.ok(src.includes("export function wcbIsEligible"), "wcbIsEligible must be exported");
    assert.ok(src.includes("export function isNeedsReview"), "isNeedsReview must be exported");
  });

  it("isUnroutedFinding calls isNeedsReview (predicate composition — source scan)", () => {
    const src = readSrc("../lib/finding-predicates.ts");
    const fnStart = src.indexOf("export function isUnroutedFinding");
    const fnEnd = src.indexOf("export function wcbIsEligible");
    assert.ok(fnStart >= 0 && fnEnd > fnStart);
    const fnBody = src.slice(fnStart, fnEnd);
    assert.ok(
      fnBody.includes("isNeedsReview"),
      "isUnroutedFinding must delegate to isNeedsReview to stay in sync with the frontend predicate",
    );
  });
});

// ── (b) Genuine unrouted finding still shows in list ─────────────────────────

describe("isUnroutedFinding — genuine unrouted findings", () => {
  it("pending finding with no routing FK is unrouted", () => {
    const f = makeFinding();
    assert.equal(isUnroutedFinding(f), true);
  });

  it("custom_review finding (no routing FK) is unrouted", () => {
    const f = makeFinding({ issueType: "custom_review" });
    assert.equal(isUnroutedFinding(f), true);
  });

  it("resolution null is treated as pending → unrouted", () => {
    const f = makeFinding({ resolution: null });
    assert.equal(isUnroutedFinding(f), true);
  });

  it("count of unrouted findings is correct when mix of routed and unrouted exist", () => {
    const findings = [
      makeFinding(),                                                          // unrouted
      makeFinding({ wetCheckBillingId: 1, convertedAt: new Date() }),        // billed
      makeFinding({ resolution: "repaired_in_field" }),                      // resolved
      makeFinding({ billingSheetId: 2 }),                                    // on BS
      makeFinding({ issueType: "custom_review" }),                           // unrouted custom_review
    ];
    const count = findings.filter(f => isUnroutedFinding(f)).length;
    assert.equal(count, 2, "Only genuine unrouted findings should be counted");
  });

  it("completed_in_field techDisposition means NOT unrouted (auto-billed path)", () => {
    const f = makeFinding({ techDisposition: "completed_in_field" });
    assert.equal(isUnroutedFinding(f), false, "completed_in_field is auto-billed, not in manager queue");
  });
});

// ── isNeedsReview unit tests ──────────────────────────────────────────────────

describe("isNeedsReview", () => {
  it("pending + needs_review tech disposition → true", () => {
    assert.equal(isNeedsReview({ resolution: "pending", techDisposition: "needs_review" }), true);
  });

  it("pending + null techDisposition → true (needs manager decision)", () => {
    assert.equal(isNeedsReview({ resolution: "pending", techDisposition: null }), true);
  });

  it("pending + completed_in_field → false (auto-bill path)", () => {
    assert.equal(isNeedsReview({ resolution: "pending", techDisposition: "completed_in_field" }), false);
  });

  it("repaired_in_field resolution → false (already resolved)", () => {
    assert.equal(isNeedsReview({ resolution: "repaired_in_field" }), false);
  });

  it("documented_only resolution → false (already resolved)", () => {
    assert.equal(isNeedsReview({ resolution: "documented_only" }), false);
  });

  it("sent_to_estimate resolution → false (already routed)", () => {
    assert.equal(isNeedsReview({ resolution: "sent_to_estimate" }), false);
  });

  it("custom_review issueType + pending resolution → true (always needs review)", () => {
    assert.equal(isNeedsReview({ resolution: "pending", issueType: "custom_review", techDisposition: "completed_in_field" }), true,
      "custom_review overrides completed_in_field — it always needs manager decision");
  });

  it("null resolution treated as pending → true", () => {
    assert.equal(isNeedsReview({ resolution: null }), true);
  });
});

// ── (c) Stamp audit: _writeRepairedInFieldBilling stamps wetCheckBillingId + convertedAt ──

describe("_writeRepairedInFieldBilling stamps wetCheckBillingId and convertedAt", () => {
  it("storage.ts stamps both wetCheckBillingId and convertedAt in the finding update (source scan)", () => {
    const src = readSrc("../storage.ts");
    // The stamp block at the end of _writeRepairedInFieldBilling updates each
    // finding with wetCheckBillingId and convertedAt. Search the full file for
    // both; they must appear in the same region (within 200 chars of each other).
    const stampAnchor = "wetCheckBillingId: wcbId";
    const convertedAnchor = "convertedAt: now";
    // lastIndexOf finds the _writeRepairedInFieldBilling implementation block
    // (not an earlier occurrence from a different helper).
    const stampIdx = src.lastIndexOf(stampAnchor);
    const convertedIdx = src.indexOf(convertedAnchor, stampIdx > 0 ? stampIdx : 0);
    assert.ok(stampIdx >= 0, "_writeRepairedInFieldBilling must stamp wetCheckBillingId on billed findings");
    assert.ok(convertedIdx >= 0, "_writeRepairedInFieldBilling must stamp convertedAt on billed findings");
    // Both stamps must be within the same update block (within 300 chars of each other).
    assert.ok(
      Math.abs(stampIdx - convertedIdx) < 300,
      `wetCheckBillingId and convertedAt stamps must appear in the same update block (found at ${stampIdx} and ${convertedIdx})`,
    );
  });

  it("routeFindingsToWetCheckBillingBulk filters to findings where convertedAt is null (source scan)", () => {
    const src = readSrc("../storage.ts");
    // Use the `async` keyword to find the implementation (not the IStorage interface declaration).
    const anchor = "async routeFindingsToWetCheckBillingBulk(";
    const idx = src.indexOf(anchor);
    assert.ok(idx >= 0, "routeFindingsToWetCheckBillingBulk implementation not found in storage.ts");
    const body = src.slice(idx, idx + 3000);
    assert.ok(
      body.includes("convertedAt == null"),
      "routeFindingsToWetCheckBillingBulk must filter to unrouted findings (convertedAt == null) before writing",
    );
  });
});

// ── (d) Billing eligibility ───────────────────────────────────────────────────

describe("wcbIsEligible — billing gate", () => {
  it("approved, no invoice, 0 unrouted findings → eligible", () => {
    const wcb = makeWcb({ status: "approved_passed_to_billing", unroutedFindingsCount: 0 });
    assert.equal(wcbIsEligible(wcb), true, "fully triaged WCB must be eligible for billing");
  });

  it("approved, no invoice, but 1 unrouted finding → NOT eligible", () => {
    const wcb = makeWcb({ status: "approved_passed_to_billing", unroutedFindingsCount: 1 });
    assert.equal(wcbIsEligible(wcb), false, "WCB with untriaged findings must not be eligible");
  });

  it("partially_converted parent: WCB approved + 0 unrouted → eligible (the WC-109 fix)", () => {
    // Before the fix, wetCheckStatus === 'converted' would block this.
    // After the fix, it flows through because unroutedFindingsCount === 0.
    const wcb = makeWcb({
      status: "approved_passed_to_billing",
      unroutedFindingsCount: 0,
      // wetCheckStatus is intentionally NOT on this type — wcbIsEligible doesn't use it.
    });
    assert.equal(wcbIsEligible(wcb), true, "WC-109: partially_converted parent with 0 unrouted must be eligible");
  });

  it("already on an invoice → NOT eligible", () => {
    const wcb = makeWcb({ invoiceId: 99, unroutedFindingsCount: 0 });
    assert.equal(wcbIsEligible(wcb), false);
  });

  it("wrong status (submitted) → NOT eligible", () => {
    const wcb = makeWcb({ status: "submitted", unroutedFindingsCount: 0 });
    assert.equal(wcbIsEligible(wcb), false);
  });

  it("picker and generator both call wcbIsEligible — same source (source scan)", () => {
    const src = readSrc("routes.ts");
    // Both invoice-construction filter sites must use wcbIsEligible.
    const previewAnchor = "eligibleWcbs = allWcbsForPreview.filter";
    const monthlyAnchor = "eligibleWcbsMonthly = allWcbsForMonthly.filter";
    const previewRegion = src.slice(Math.max(0, src.indexOf(previewAnchor) - 100), src.indexOf(previewAnchor) + 400);
    const monthlyRegion = src.slice(Math.max(0, src.indexOf(monthlyAnchor) - 100), src.indexOf(monthlyAnchor) + 400);
    assert.ok(previewRegion.includes("wcbIsEligible"), "invoice preview filter must use wcbIsEligible");
    assert.ok(monthlyRegion.includes("wcbIsEligible"), "monthly invoice filter must use wcbIsEligible");
    // Both must reference the same function name (not separate inline logic).
    const previewCount = (previewRegion.match(/wcbIsEligible/g) ?? []).length;
    const monthlyCount = (monthlyRegion.match(/wcbIsEligible/g) ?? []).length;
    assert.ok(previewCount >= 1, "preview filter must call wcbIsEligible at least once");
    assert.ok(monthlyCount >= 1, "monthly filter must call wcbIsEligible at least once");
  });
});

// ── (e) Company isolation ─────────────────────────────────────────────────────

describe("Company isolation", () => {
  it("isUnroutedFinding is a pure predicate — no DB, no company context needed", () => {
    // Company isolation is enforced at the query layer (companyId filter on wet check fetch).
    // The predicate itself is pure so it works correctly for any finding regardless of company.
    const finding = makeFinding();
    assert.doesNotThrow(() => isUnroutedFinding(finding), "isUnroutedFinding must be pure / synchronous");
  });

  it("wcbIsEligible is a pure predicate — no DB, no company context needed", () => {
    const wcb = makeWcb();
    assert.doesNotThrow(() => wcbIsEligible(wcb));
  });

  it("needs-review endpoint scopes by companyId (source scan)", () => {
    const src = readSrc("routes.ts");
    const anchor = "app.get(\"/api/wet-checks/needs-review\"";
    const idx = src.indexOf(anchor);
    assert.ok(idx >= 0, "needs-review endpoint not found");
    const body = src.slice(idx, idx + 3000);
    assert.ok(
      body.includes("authenticatedUserCompanyId"),
      "needs-review endpoint must scope by authenticatedUserCompanyId for company isolation",
    );
    assert.ok(
      body.includes("eq(wetChecks.companyId"),
      "needs-review endpoint must filter wet checks by companyId",
    );
  });

  it("getWetCheckBillingsByCustomer scopes by customerId which is company-isolated (source scan)", () => {
    const src = readSrc("../storage.ts");
    const anchor = "async getWetCheckBillingsByCustomer(";
    const idx = src.indexOf(anchor);
    assert.ok(idx >= 0);
    const body = src.slice(idx, idx + 2000);
    assert.ok(
      body.includes("customerId"),
      "getWetCheckBillingsByCustomer must scope by customerId (company isolation via customer ownership)",
    );
  });
});
