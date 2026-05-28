/**
 * invoice-monthly-wcb-straggler.test.ts  (Task #987 Slice 3)
 *
 * Static-source tests for the WCB straggler reconciliation branch added to
 * POST /api/invoices/monthly:
 *
 *   1. An orphan WCB invoice item (WCB row has no invoiceId) is stamped by
 *      the safety-net branch.
 *   2. An already-billed WCB is left untouched (idempotency guard present).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routesPath = path.join(__dirname, "routes.ts");
const src = fs.readFileSync(routesPath, "utf8");

// Extract the reconciliation try block so assertions are scoped to the
// safety-net section and don't accidentally match the primary stamping loop.
const reconcileStart = src.indexOf(
  "// Reconciliation: ensure any billing sheet OR wet check billing",
);
assert.ok(reconcileStart !== -1, "reconciliation comment not found in routes.ts");

// The reconciliation block ends at the catch clause that follows it.
const reconcileEnd = src.indexOf(
  "// Task #693",
  reconcileStart,
);
const reconcileSrc =
  reconcileEnd === -1 ? src.slice(reconcileStart) : src.slice(reconcileStart, reconcileEnd);

describe("WCB straggler reconciliation — comment (Task #987)", () => {
  it("comment mentions both billing sheet AND wet check billing", () => {
    assert.match(
      reconcileSrc,
      /billing sheet OR wet check billing/,
    );
  });

  it("comment notes primary loops are the correctness mechanism", () => {
    assert.match(reconcileSrc, /primary/i);
  });

  it("comment notes this block is a defensive safety net", () => {
    assert.match(reconcileSrc, /defensive/i);
  });
});

describe("WCB straggler reconciliation — branch structure (Task #987)", () => {
  it("contains else if branch for sourceType === 'wet_check_billing'", () => {
    assert.match(
      reconcileSrc,
      /else if\s*\(\s*item\.sourceType\s*===\s*['"]wet_check_billing['"]\s*&&\s*item\.sourceId\s*\)/,
    );
  });

  it("calls getWetCheckBillingById with only the sourceId (no companyId)", () => {
    assert.match(reconcileSrc, /getWetCheckBillingById\s*\(\s*item\.sourceId\s*\)/);
  });

  it("lives inside the existing try block (catch mentions both source types)", () => {
    assert.match(
      reconcileSrc,
      /billing sheet \/ wet check billing reconciliation/,
    );
  });
});

describe("WCB straggler reconciliation — orphan stamping (Task #987)", () => {
  it("checks !wcb.invoiceId before stamping (idempotency guard)", () => {
    assert.match(reconcileSrc, /!\s*wcb\.invoiceId/);
  });

  it("calls updateWetCheckBilling with invoiceId", () => {
    assert.match(reconcileSrc, /updateWetCheckBilling\s*\(\s*wcb\.id/);
    assert.match(reconcileSrc, /invoiceId:\s*invoice\.id/);
  });

  it("sets billedAt on the WCB update", () => {
    const wcbBranch = reconcileSrc.slice(
      reconcileSrc.indexOf("wet_check_billing"),
    );
    assert.match(wcbBranch, /billedAt:\s*currentDate/);
  });

  it("sets status='billed' on the WCB update", () => {
    const wcbBranch = reconcileSrc.slice(
      reconcileSrc.indexOf("wet_check_billing"),
    );
    assert.match(wcbBranch, /status:\s*['"]billed['"]/);
  });
});

describe("WCB straggler reconciliation — idempotency (Task #987)", () => {
  it("already-billed WCB left untouched: update gated behind !wcb.invoiceId check", () => {
    // The update call must be nested inside the `if (wcb && !wcb.invoiceId)` guard.
    // We confirm this by checking that updateWetCheckBilling only appears AFTER
    // the !wcb.invoiceId test in the WCB branch.
    const wcbBranchStart = reconcileSrc.indexOf("wet_check_billing' && item.sourceId");
    assert.ok(wcbBranchStart !== -1, "WCB branch not found");
    const wcbBranch = reconcileSrc.slice(wcbBranchStart);
    const guardIdx = wcbBranch.indexOf("!wcb.invoiceId");
    const updateIdx = wcbBranch.indexOf("updateWetCheckBilling");
    assert.ok(guardIdx !== -1, "!wcb.invoiceId guard not found in WCB branch");
    assert.ok(updateIdx !== -1, "updateWetCheckBilling not found in WCB branch");
    assert.ok(
      guardIdx < updateIdx,
      "updateWetCheckBilling must appear after the !wcb.invoiceId guard",
    );
  });
});

describe("WCB straggler reconciliation — log line (Task #987)", () => {
  it("logs a reconciliation message for the WCB case", () => {
    const wcbBranch = reconcileSrc.slice(
      reconcileSrc.indexOf("wet_check_billing"),
    );
    assert.match(wcbBranch, /console\.log\s*\(/);
    assert.match(wcbBranch, /wet check billing/);
  });
});
