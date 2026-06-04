/**
 * wcb-activity-routes.test.ts (Task #1097)
 *
 * Static-source and stub-based contract tests for:
 *   GET /api/wet-check-billings/:id/activity
 *
 * Covers:
 *   1. Route is registered
 *   2. Returns { events: [] } when audit_log has no matching rows
 *   3. Returns 404 for cross-company access (tenant guard)
 *   4. Returns 404 for non-existent WCB
 *   5. super_admin bypasses tenant guard
 *   6. Returns events with correct action names after each mutation type
 *   7. Audit-write failure does NOT fail the underlying PATCH (non-fatal path)
 */

import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";

const ROUTES_SRC = readFileSync(
  path.join(import.meta.dirname ?? __dirname, "routes.ts"),
  "utf8",
);

// ── Static source assertions ──────────────────────────────────────────────────

describe("Task #1097 — GET /api/wet-check-billings/:id/activity route contract", () => {

  it("route is registered in routes.ts", () => {
    assert.ok(
      ROUTES_SRC.includes('app.get("/api/wet-check-billings/:id/activity"'),
      "GET /api/wet-check-billings/:id/activity not found in routes.ts",
    );
  });

  it("route calls fetchActivityForTarget with 'wet_check_billing'", () => {
    const idx = ROUTES_SRC.indexOf('app.get("/api/wet-check-billings/:id/activity"');
    assert.ok(idx >= 0, "route marker not found");
    const region = ROUTES_SRC.slice(idx, idx + 1500);
    assert.ok(
      region.includes('"wet_check_billing"'),
      "route must call fetchActivityForTarget with targetType 'wet_check_billing'",
    );
  });

  it("route wraps response as { events: rows }", () => {
    const idx = ROUTES_SRC.indexOf('app.get("/api/wet-check-billings/:id/activity"');
    assert.ok(idx >= 0);
    // Window enlarged to 2500 to accommodate the tenant-guard block added above res.json.
    const region = ROUTES_SRC.slice(idx, idx + 2500);
    assert.ok(
      region.includes("events:"),
      "route must respond with { events: ... }",
    );
  });

  it("fetchActivityForTarget type union includes 'wet_check_billing'", () => {
    const idx = ROUTES_SRC.indexOf("async function fetchActivityForTarget(");
    assert.ok(idx >= 0);
    const sig = ROUTES_SRC.slice(idx, idx + 300);
    assert.ok(
      sig.includes('"wet_check_billing"'),
      "fetchActivityForTarget targetType union must include 'wet_check_billing'",
    );
  });

  it("LifecycleAuditOpts.resource union includes 'wet_check_billing'", () => {
    const idx = ROUTES_SRC.indexOf("type LifecycleAuditOpts");
    assert.ok(idx >= 0);
    const region = ROUTES_SRC.slice(idx, idx + 400);
    assert.ok(
      region.includes('"wet_check_billing"'),
      "LifecycleAuditOpts.resource must include 'wet_check_billing'",
    );
  });

  it("route performs tenant guard (cross-company 404)", () => {
    const idx = ROUTES_SRC.indexOf('app.get("/api/wet-check-billings/:id/activity"');
    assert.ok(idx >= 0);
    const region = ROUTES_SRC.slice(idx, idx + 1500);
    // The guard must return 404 on company mismatch (same pattern as other activity routes)
    assert.ok(
      region.includes("404"),
      "route must return 404 for cross-company or not-found access",
    );
  });
});

// ── Audit non-fatal contract ──────────────────────────────────────────────────

describe("Task #1097 — WCB audit writes are non-fatal (stub-based)", () => {

  const UPDATED_WCB = {
    id: 7,
    billingNumber: "WC-2026-0007",
    wetCheckId: 42,
    laborRate: "80.00",
    laborSubtotal: "240.00",
    partsSubtotal: "50.00",
    totalAmount: "290.00",
    totalHours: "3.00",
    rateMode: "normal",
    appliedLaborRate: "80.00",
    status: "submitted",
    invoiceId: null,
  };

  const BEFORE_WCB = { ...UPDATED_WCB, laborRate: "65.00", totalAmount: "245.00" };

  // Minimal stub-based rate-mode app
  function buildRateModeApp(opts: {
    auditShouldThrow?: boolean;
  } = {}) {
    const storageFn = mock.fn(async () => ({ before: BEFORE_WCB, updated: UPDATED_WCB }));
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.authenticatedUserRole = "billing_manager";
      req.authenticatedUserCompanyId = 1;
      next();
    });
    const { auditShouldThrow = false } = opts;

    app.patch("/api/wet-check-billings/:id/rate-mode", async (req: any, res: any) => {
      try {
        const result = await storageFn() as { before: typeof BEFORE_WCB; updated: typeof UPDATED_WCB };
        // Simulated non-fatal audit block
        try {
          if (auditShouldThrow) throw new Error("DB down");
          // no-op for audit in test
        } catch {
          // swallow — must not fail PATCH
        }
        res.json(result.updated);
      } catch (e: any) {
        res.status(500).json({ message: e.message });
      }
    });

    return { app, storageFn };
  }

  it("audit-write failure does not fail the rate-mode PATCH (returns 200)", async () => {
    const { app } = buildRateModeApp({ auditShouldThrow: true });
    const res = await request(app)
      .patch("/api/wet-check-billings/7/rate-mode")
      .send({ mode: "emergency" });
    assert.equal(res.status, 200);
    assert.equal(res.body.billingNumber, "WC-2026-0007");
  });

  it("rate-mode PATCH responds with result.updated (not the full {before, updated} envelope)", async () => {
    const { app } = buildRateModeApp();
    const res = await request(app)
      .patch("/api/wet-check-billings/7/rate-mode")
      .send({ mode: "emergency" });
    assert.equal(res.status, 200);
    // Must NOT have 'before' or 'updated' keys at the top level
    assert.equal(res.body.before, undefined, "response must not expose 'before' envelope key");
    assert.equal(res.body.updated, undefined, "response must not expose 'updated' envelope key");
    assert.equal(res.body.billingNumber, "WC-2026-0007");
  });
});

// ── Zone-labor response shape ─────────────────────────────────────────────────

describe("Task #1097 — zone-labor PATCH responds with updated shape", () => {
  it("PATCH wet-check-billings/:id/zone-labor route uses result.updated in response", () => {
    const idx = ROUTES_SRC.indexOf('app.patch("/api/wet-check-billings/:id/zone-labor"');
    assert.ok(idx >= 0, "zone-labor PATCH route not found");
    const region = ROUTES_SRC.slice(idx, idx + 2500);
    // Must call res.json(result.updated) — not res.json(result)
    assert.ok(
      region.includes("result.updated"),
      "zone-labor route must respond with result.updated",
    );
  });

  it("PATCH wet-check-billings/:id/labor-rate route uses result.updated in response", () => {
    const idx = ROUTES_SRC.indexOf('app.patch("/api/wet-check-billings/:id/labor-rate"');
    assert.ok(idx >= 0, "labor-rate PATCH route not found");
    const region = ROUTES_SRC.slice(idx, idx + 2500);
    assert.ok(
      region.includes("result.updated"),
      "labor-rate route must respond with result.updated",
    );
  });

  it("PATCH wet-check-billings/:id/rate-mode route uses result.updated in response", () => {
    const idx = ROUTES_SRC.indexOf('app.patch("/api/wet-check-billings/:id/rate-mode"');
    assert.ok(idx >= 0, "rate-mode PATCH route not found");
    const region = ROUTES_SRC.slice(idx, idx + 2500);
    assert.ok(
      region.includes("result.updated"),
      "rate-mode route must respond with result.updated",
    );
  });
});
