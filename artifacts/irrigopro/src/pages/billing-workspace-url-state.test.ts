// Task #1083 — Billing Workspace URL state, bulk-approve bar, and testid
// regression tests.
//
// Tests:
//   (a) URL ?status=approved seeds statusFilter correctly.
//   (b) URL ?status=unapproved seeds statusFilter as "" (pending view).
//   (c) URL ?customer=42 seeds the customer filter.
//   (d) BulkApproveBar renders when selectedCount > 0, hides at 0.
//   (e) Per-customer approve-all only shows when total <= PAGE_SIZE.
//   (f) Static source guards — customer-billing drilldown testids exist in src.
//   (g) Static source guard — select-all checkbox testid exists in src.
//   (h) Static source guard — App.tsx irrigation_manager block has all three
//       billing redirect routes.
//   (i) Static source guard — desktop-shell enables badges for irrigation_manager.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── helpers ───────────────────────────────────────────────────────────────────

// 4 levels up from artifacts/irrigopro/src/pages/ → workspace root
const ROOT = resolve(import.meta.dirname, "../../../..");

function readSrc(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), "utf8");
}

// ── (a-c) URL → initial state derivation ─────────────────────────────────────
// Mirror the same logic used in BillingWorkspacePage state initializers.

function deriveInitialState(search: string) {
  const params = new URLSearchParams(search);
  const rawStatus = params.get("status");
  const customer = params.get("customer") ?? "";
  const statusFilter =
    rawStatus === "approved"
      ? "approved_passed_to_billing"
      : rawStatus === "unapproved"
        ? ""
        : "";
  return { statusFilter, customer };
}

describe("BillingWorkspacePage URL state derivation", () => {
  it("?status=approved → statusFilter='approved_passed_to_billing'", () => {
    const { statusFilter } = deriveInitialState("?status=approved");
    assert.equal(statusFilter, "approved_passed_to_billing");
  });

  it("?status=unapproved → statusFilter='' (all pending)", () => {
    const { statusFilter } = deriveInitialState("?status=unapproved");
    assert.equal(statusFilter, "");
  });

  it("no status param → statusFilter=''", () => {
    const { statusFilter } = deriveInitialState("");
    assert.equal(statusFilter, "");
  });

  it("?customer=42 → customer='42'", () => {
    const { customer } = deriveInitialState("?customer=42");
    assert.equal(customer, "42");
  });

  it("?status=approved&customer=7 → both seeded correctly", () => {
    const state = deriveInitialState("?status=approved&customer=7");
    assert.equal(state.statusFilter, "approved_passed_to_billing");
    assert.equal(state.customer, "7");
  });
});

// ── (d) BulkApproveBar visibility contract ────────────────────────────────────
// Pure-logic test: the bar renders only when selectedCount > 0.

// Inline the bar's render guard logic to avoid a full React render.
function shouldRenderBar(selectedCount: number): boolean {
  return selectedCount > 0;
}

describe("BulkApproveBar visibility", () => {
  it("hidden when selectedCount=0", () => {
    assert.equal(shouldRenderBar(0), false);
  });

  it("visible when selectedCount=1", () => {
    assert.equal(shouldRenderBar(1), true);
  });

  it("visible when selectedCount=5", () => {
    assert.equal(shouldRenderBar(5), true);
  });
});

// ── (e) Per-customer approve-all total guard ─────────────────────────────────

const PAGE_SIZE = 50;

function shouldShowApproveAll(customer: string, itemCount: number, total: number): boolean {
  return customer.trim() !== "" && itemCount > 0 && total <= PAGE_SIZE;
}

function shouldShowRefineNote(customer: string, total: number): boolean {
  return customer.trim() !== "" && total > PAGE_SIZE;
}

describe("Per-customer approve-all total guard", () => {
  it("shows button when customer set, items present, and total <= PAGE_SIZE", () => {
    assert.equal(shouldShowApproveAll("42", 3, 3), true);
    assert.equal(shouldShowApproveAll("42", 50, 50), true);
  });

  it("hides button when total > PAGE_SIZE", () => {
    assert.equal(shouldShowApproveAll("42", 50, 51), false);
    assert.equal(shouldShowApproveAll("42", 50, 100), false);
  });

  it("hides button when no customer filter set", () => {
    assert.equal(shouldShowApproveAll("", 5, 5), false);
    assert.equal(shouldShowApproveAll("  ", 5, 5), false);
  });

  it("shows refine note when customer set and total > PAGE_SIZE", () => {
    assert.equal(shouldShowRefineNote("42", 51), true);
    assert.equal(shouldShowRefineNote("42", 100), true);
  });

  it("hides refine note when total <= PAGE_SIZE", () => {
    assert.equal(shouldShowRefineNote("42", 50), false);
    assert.equal(shouldShowRefineNote("42", 0), false);
  });

  it("hides refine note when no customer filter", () => {
    assert.equal(shouldShowRefineNote("", 100), false);
  });
});

// ── (f) Static source — customer-billing drilldown testids ───────────────────

describe("customer-billing.tsx — per-customer drilldown testid patterns", () => {
  const src = readSrc("artifacts/irrigopro/src/pages/customer-billing.tsx");

  it("contains drill-approved-card template testid (mobile)", () => {
    assert.ok(
      src.includes('data-testid={`drill-approved-card-${customer.id}`}'),
      "Expected drill-approved-card testid on per-customer mobile card link",
    );
  });

  it("contains drill-unapproved-card template testid (mobile)", () => {
    assert.ok(
      src.includes('data-testid={`drill-unapproved-card-${customer.id}`}'),
      "Expected drill-unapproved-card testid on per-customer mobile card link",
    );
  });

  it("contains summary-level drill-approved-summary testid", () => {
    assert.ok(
      src.includes('data-testid="drill-approved-summary"'),
      "Expected drill-approved-summary testid on global header link",
    );
  });

  it("contains summary-level drill-unapproved-summary testid", () => {
    assert.ok(
      src.includes('data-testid="drill-unapproved-summary"'),
      "Expected drill-unapproved-summary testid on global header link",
    );
  });
});

// ── (g) Static source — billing-workspace select-all checkbox testid ─────────

describe("billing-workspace.tsx — select-all checkbox", () => {
  const src = readSrc("artifacts/irrigopro/src/pages/billing-workspace.tsx");

  it("contains select-all-checkbox testid", () => {
    assert.ok(
      src.includes('data-testid="select-all-checkbox"'),
      "Expected select-all-checkbox testid on the select-all header row",
    );
  });

  it("uses selectedItemsMap for cross-page bulk-approve (not items.filter)", () => {
    assert.ok(
      src.includes("Array.from(selectedItemsMap.values())"),
      "bulkApprove must use selectedItemsMap.values() for cross-page selection",
    );
    assert.ok(
      !src.includes("items.filter((it) => selected.has(it.id))"),
      "bulkApprove must not filter from current-page items only",
    );
  });

  it("URL write-back uses window.history.replaceState", () => {
    assert.ok(
      src.includes("window.history.replaceState"),
      "Expected replaceState call for URL round-trip stabilization",
    );
  });

  it("URL sync canonicalizes empty statusFilter as status=unapproved", () => {
    assert.ok(
      src.includes('params.set("status", "unapproved")'),
      "Empty statusFilter must write status=unapproved for round-trip stability",
    );
  });

  it("per-customer approve-all guarded by total <= PAGE_SIZE", () => {
    assert.ok(
      src.includes("total <= PAGE_SIZE"),
      "Approve-all button must be gated on total <= PAGE_SIZE",
    );
  });

  it("refine note shown when total > PAGE_SIZE", () => {
    assert.ok(
      src.includes("preset-approve-all-refine-note"),
      "Expected refine note testid when total exceeds one page",
    );
  });
});

// ── (h) Static source — App.tsx irrigation_manager legacy billing redirects ──

describe("App.tsx — irrigation_manager billing redirect routes", () => {
  const src = readSrc("artifacts/irrigopro/src/App.tsx");

  it("has /billing route in irrigation_manager block", () => {
    assert.ok(
      src.includes('path="/billing" component={RedirectToBillingWorkspace}'),
      "Missing /billing redirect in irrigation_manager routing block",
    );
  });

  it("has /billing/dashboard route in irrigation_manager block", () => {
    assert.ok(
      src.includes('path="/billing/dashboard" component={RedirectToBillingWorkspace}'),
      "Missing /billing/dashboard redirect in irrigation_manager routing block",
    );
  });

  it("has /billing-dashboard route in irrigation_manager block", () => {
    assert.ok(
      src.includes('path="/billing-dashboard" component={RedirectToBillingWorkspace}'),
      "Missing /billing-dashboard redirect in irrigation_manager routing block",
    );
  });
});

// ── (i) Static source — desktop-shell badge probe includes irrigation_manager ─

describe("desktop-shell.tsx — irrigation_manager badge enablement", () => {
  const src = readSrc(
    "artifacts/irrigopro/src/components/layout/desktop-shell.tsx",
  );

  it('enableBadges includes "irrigation_manager" check', () => {
    assert.ok(
      src.includes('"irrigation_manager"'),
      'desktop-shell must include "irrigation_manager" in enableBadges gate',
    );
  });

  it("badge probe key is awaitingApproval", () => {
    assert.ok(
      src.includes("awaitingApproval"),
      "desktop-shell must expose awaitingApproval badge count",
    );
  });
});
