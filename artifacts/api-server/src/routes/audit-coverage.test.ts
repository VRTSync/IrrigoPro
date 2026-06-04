// Task #641 — Static-source coverage check for lifecycle audit
// emissions in routes.ts.
//
// The full routes.ts has a 10k-line top-level registerRoutes() with
// startup side effects (DB pool, timers, IIFE) that are not friendly
// to in-process integration tests. The handler-level integration
// tests live alongside the focused unit tests
// (estimate-submit-audit.test.ts). This file complements them with
// a fast static-source assertion that every lifecycle endpoint we
// claim to audit actually contains a recordLifecycleAudit() call
// near it — catching the most common regression where a refactor
// drops the audit emission without anyone noticing.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const routesSrc = readFileSync(join(__dirname, "routes.ts"), "utf8");

function nearby(haystack: string, marker: string, window = 40000): string | null {
  const idx = haystack.indexOf(marker);
  if (idx < 0) return null;
  return haystack.slice(idx, idx + window);
}

describe("Task #641 — every lifecycle transition emits a recordLifecycleAudit call", () => {
  const cases: Array<{ name: string; marker: string; action: string }> = [
    // Estimates — POST/PATCH approve/reject
    { name: "estimate POST /approve", marker: '"/api/estimates/:id/approve"', action: "estimate.approved" },
    { name: "estimate PATCH /approve", marker: 'app.patch("/api/estimates/:id/approve"', action: "estimate.approved" },
    { name: "estimate POST /reject", marker: '"/api/estimates/:id/reject"', action: "estimate.rejected" },
    { name: "estimate PATCH /reject", marker: 'app.patch("/api/estimates/:id/reject"', action: "estimate.rejected" },
    { name: "estimate /internal-approve", marker: "/internal-approve", action: "estimate.internal_approved" },
    { name: "estimate /transition", marker: '"/api/estimates/:id/transition"', action: "recordLifecycleAudit" },
    { name: "estimate /convert-to-work-order", marker: "/convert-to-work-order", action: "estimate.converted_to_work_order" },
    // Estimate customer-token paths attribute to synthetic customer actor.
    { name: "estimate token approve", marker: '"/api/estimates/approve-via-token/:token"', action: "estimate.customer_approved" },
    { name: "estimate token reject", marker: '"/api/estimates/reject-via-token/:token"', action: "estimate.customer_rejected" },
    // Work orders
    { name: "work-order /complete", marker: '"/api/work-orders/:id/complete"', action: "work_order.completed" },
    { name: "work-order /approve", marker: '"/api/work-orders/:id/approve"', action: "work_order.approved" },
    { name: "work-order /return-for-correction", marker: "/return-for-correction", action: "work_order.returned_for_correction" },
    { name: "work-order /assign", marker: '"/api/work-orders/:id/assign"', action: "work_order.assigned" },
    { name: "work-order /billing-sheet", marker: '"/api/work-orders/:id/billing-sheet"', action: "work_order.billing_sheet_created" },
    { name: "work-order PATCH status_changed", marker: 'app.patch("/api/work-orders/:id"', action: "work_order.status_changed" },
    { name: "work-order DELETE", marker: 'app.delete("/api/work-orders/:id"', action: "work_order.deleted" },
    { name: "work-order bulk DELETE", marker: '/api/work-orders/bulk', action: "work_order.deleted" },
    // Wet checks
    { name: "wet-check /submit", marker: '"/api/wet-checks/:id/submit"', action: "wet_check.submitted" },
    { name: "wet-check finding /route", marker: "/findings/:id/route", action: "wet_check.finding_routed" },
    { name: "wet-check /convert", marker: '"/api/wet-checks/:id/convert"', action: "wet_check.converted" },
    { name: "wet-check DELETE", marker: 'app.delete("/api/wet-checks/:id"', action: "wet_check.deleted" },
    { name: "wet-check bulk-delete", marker: "/bulk-delete", action: "wet_check.deleted" },
  ];

  for (const { name, marker, action } of cases) {
    it(`${name} contains \`${action}\` audit emission`, () => {
      const region = nearby(routesSrc, marker);
      assert.ok(region, `marker not found: ${marker}`);
      assert.ok(
        region.includes("recordLifecycleAudit("),
        `expected recordLifecycleAudit() near ${marker}`,
      );
      assert.ok(
        region.includes(action),
        `expected action "${action}" near ${marker}`,
      );
    });
  }

  it("customer-token endpoints pass a synthetic customer actor", () => {
    // Both /approve-via-token and /reject-via-token resolve the
    // estimate via its customer token (no req.authenticatedUser*),
    // so the audit row's actor MUST be the synthetic "customer".
    // The shape is `customer: { email, name, token }` so the helper
    // attributes the row to actorRole="customer" + token in details.
    for (const marker of [
      '"/api/estimates/approve-via-token/:token"',
      '"/api/estimates/reject-via-token/:token"',
    ]) {
      const region = nearby(routesSrc, marker, 8000);
      assert.ok(region, `marker not found: ${marker}`);
      assert.ok(
        region.includes("customer:"),
        `expected synthetic customer actor in ${marker} handler`,
      );
      assert.ok(
        /token:\s*token|\btoken\s*[,}]/.test(region),
        `expected token forwarded to audit row in ${marker}`,
      );
    }
  });

  it("WC /convert co-transacts the state mutation and the audit row", () => {
    // Task #641 — for at least one representative lifecycle path,
    // the state mutation and the audit insert must run inside the
    // same `db.transaction(...)` block with `strict: true` so a
    // failed audit insert rolls back the state change.
    const region = nearby(routesSrc, '"/api/wet-checks/:id/convert"', 4000);
    assert.ok(region);
    const txIdx = region.indexOf("db.transaction(");
    const auditIdx = region.indexOf("recordLifecycleAudit(");
    assert.ok(txIdx >= 0, "expected db.transaction wrap");
    assert.ok(auditIdx > txIdx, "audit call must be INSIDE the tx");
  });

  it("recordAuditEvent supports strict mode that propagates errors", () => {
    const idx = routesSrc.indexOf("async function recordAuditEvent(");
    assert.ok(idx >= 0);
    const body = routesSrc.slice(idx, idx + 2500);
    assert.ok(
      body.includes("opts.strict"),
      "recordAuditEvent must honor a strict flag",
    );
    assert.ok(
      /if\s*\(opts\.strict\)\s*throw/.test(body),
      "strict mode must propagate audit-insert errors",
    );
    assert.ok(
      body.includes("opts.tx ?? db"),
      "recordAuditEvent must accept an optional tx executor",
    );
  });

  // ── Task #1097 — WCB mutation audit coverage ───────────────────────────────
  it("PATCH wet-check-billings/:id/labor-rate emits wet_check_billing.labor_rate_overridden", () => {
    const region = nearby(routesSrc, 'app.patch("/api/wet-check-billings/:id/labor-rate"');
    assert.ok(region, "PATCH /api/wet-check-billings/:id/labor-rate not found");
    assert.ok(
      region.includes("recordLifecycleAudit("),
      "expected recordLifecycleAudit() in labor-rate PATCH handler",
    );
    assert.ok(
      region.includes("wet_check_billing.labor_rate_overridden"),
      'expected action "wet_check_billing.labor_rate_overridden"',
    );
  });

  it("PATCH wet-check-billings/:id/rate-mode emits wet_check_billing.rate_mode_changed", () => {
    const region = nearby(routesSrc, 'app.patch("/api/wet-check-billings/:id/rate-mode"');
    assert.ok(region, "PATCH /api/wet-check-billings/:id/rate-mode not found");
    assert.ok(
      region.includes("recordLifecycleAudit("),
      "expected recordLifecycleAudit() in rate-mode PATCH handler",
    );
    assert.ok(
      region.includes("wet_check_billing.rate_mode_changed"),
      'expected action "wet_check_billing.rate_mode_changed"',
    );
  });

  it("PATCH wet-check-billings/:id/zone-labor emits wet_check_billing.zone_labor_edited", () => {
    const region = nearby(routesSrc, 'app.patch("/api/wet-check-billings/:id/zone-labor"');
    assert.ok(region, "PATCH /api/wet-check-billings/:id/zone-labor not found");
    assert.ok(
      region.includes("recordLifecycleAudit("),
      "expected recordLifecycleAudit() in zone-labor PATCH handler",
    );
    assert.ok(
      region.includes("wet_check_billing.zone_labor_edited"),
      'expected action "wet_check_billing.zone_labor_edited"',
    );
  });

  it("GET wet-check-billings/:id/activity is registered", () => {
    assert.ok(
      routesSrc.includes('app.get("/api/wet-check-billings/:id/activity"'),
      "GET /api/wet-check-billings/:id/activity not found in routes.ts",
    );
  });

  it("recordLifecycleAudit helper resolves an actor name from the user record", () => {
    // Activity tab must show "Jane Smith" not "User #42". The
    // helper looks up storage.getUser(actorUserId) and falls back
    // to user.email / user:<id> only when name is missing.
    const helperIdx = routesSrc.indexOf("async function recordLifecycleAudit(");
    assert.ok(helperIdx >= 0);
    const helperBody = routesSrc.slice(helperIdx, helperIdx + 2500);
    assert.ok(
      helperBody.includes("storage.getUser(actorUserId)"),
      "helper must resolve the actor name via storage.getUser",
    );
    assert.ok(
      /u\?\.name/.test(helperBody),
      "helper must prefer the user's display name for actorLabel",
    );
  });
});
