// Regression guard for the QB self-service connection repair endpoints.
//
// GET  /api/quickbooks/connection/stale
// POST /api/quickbooks/connection/repair
//
// Two test sections:
//
//   1. "Auth & role guards" — static source assertions that both routes have
//      requireAuthentication before any role check, and that only the three
//      allowed roles pass (field_tech / irrigation_manager must get 403).
//
//   2. "Scoped path ignores body" — static source assertion that the non-
//      super_admin branch of the repair handler does NOT reference req.body at
//      all, proving a forged realmId / targetCompanyId in the request body
//      cannot influence which row is patched or to which company it is set.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const src = readFileSync(join(__dirname, "routes.ts"), "utf8");

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Extracts the full handler block for a route registration, from the
 * registration marker up to (and including) the closing `});` that terminates
 * the outer `app.get/post(...)` call.  Returns null when the marker is not
 * found.  We scan forward looking for balanced brace depth so nested blocks
 * are handled correctly.
 */
function extractHandlerBlock(marker: string): string | null {
  const pos = src.indexOf(marker);
  if (pos < 0) return null;
  let depth = 0;
  let started = false;
  for (let i = pos; i < src.length; i++) {
    if (src[i] === "{") { depth++; started = true; }
    if (src[i] === "}") { depth--; }
    if (started && depth === 0) {
      return src.slice(pos, i + 1);
    }
  }
  return src.slice(pos);
}

/**
 * Returns the middleware slice — everything between the route path string and
 * the `async ` keyword that begins the request handler.
 */
function middlewareSlice(marker: string): string | null {
  const pos = src.indexOf(marker);
  if (pos < 0) return null;
  const window = src.slice(pos, pos + 800);
  const asyncIdx = window.indexOf(" async ");
  if (asyncIdx < 0) return window;
  return window.slice(0, asyncIdx);
}

// ─── Section 1: Auth & role guards ───────────────────────────────────────────

describe("QB stale-detection route (GET /api/quickbooks/connection/stale)", () => {
  const staleMarker = 'app.get("/api/quickbooks/connection/stale"';
  const block = extractHandlerBlock(staleMarker);

  it("route is registered", () => {
    assert.ok(block !== null, "GET /api/quickbooks/connection/stale not found in routes.ts");
  });

  it("requireAuthentication appears before the handler", () => {
    const mw = middlewareSlice(staleMarker);
    assert.ok(mw?.includes("requireAuthentication"), "requireAuthentication missing from stale-detection route");
  });

  it("role guard allows only super_admin / company_admin / billing_manager", () => {
    assert.ok(
      block?.includes('"super_admin", "company_admin", "billing_manager"'),
      'Expected role allowlist ["super_admin", "company_admin", "billing_manager"] in stale-detection handler'
    );
  });

  it("role guard returns 403 for disallowed roles", () => {
    assert.ok(
      block?.includes("403"),
      "Expected 403 response in stale-detection handler for disallowed roles"
    );
  });
});

describe("QB repair route (POST /api/quickbooks/connection/repair)", () => {
  const repairMarker = 'app.post("/api/quickbooks/connection/repair"';
  const block = extractHandlerBlock(repairMarker);

  it("route is registered", () => {
    assert.ok(block !== null, "POST /api/quickbooks/connection/repair not found in routes.ts");
  });

  it("requireAuthentication appears before the handler", () => {
    const mw = middlewareSlice(repairMarker);
    assert.ok(mw?.includes("requireAuthentication"), "requireAuthentication missing from repair route");
  });

  it("role guard allows only super_admin / company_admin / billing_manager", () => {
    assert.ok(
      block?.includes('"super_admin", "company_admin", "billing_manager"'),
      'Expected role allowlist ["super_admin", "company_admin", "billing_manager"] in repair handler'
    );
  });

  it("role guard returns 403 for disallowed roles", () => {
    assert.ok(
      block?.includes("403"),
      "Expected 403 response in repair handler for disallowed roles"
    );
  });
});

// ─── Section 2: Scoped path body-isolation guarantee ─────────────────────────

describe("QB repair scoped path (company_admin / billing_manager) — body isolation", () => {
  const repairMarker = 'app.post("/api/quickbooks/connection/repair"';
  const block = extractHandlerBlock(repairMarker);

  it("route block found", () => {
    assert.ok(block !== null, "repair handler block not extractable");
  });

  it("scoped path branches on role !== super_admin before touching req.body", () => {
    // The scoped branch must be entered before any body reads.
    // Verify that `role !== "super_admin"` appears in the handler.
    assert.ok(
      block?.includes('role !== "super_admin"'),
      'Expected early role !== "super_admin" branch in repair handler'
    );
  });

  it("scoped path does NOT reference req.body for the UPDATE target", () => {
    // Extract only the scoped (non-super_admin) branch — everything from the
    // `if (role !== "super_admin") {` up to the matching closing brace.
    // We look for the early-return block that ends with `return;` inside the
    // non-super_admin branch before the super_admin section begins.
    const scopedStart = block?.indexOf('if (role !== "super_admin")');
    assert.ok(scopedStart !== undefined && scopedStart >= 0, "scoped branch not found");

    // Find the closing `}` of the scoped block.  The scoped block always ends
    // with a `return;` after the single-row patch.  Extract up to the
    // super_admin section header comment to limit the scope.
    const superAdminComment = block?.indexOf("// ── super_admin path");
    assert.ok(superAdminComment !== undefined && superAdminComment >= 0, "super_admin section comment not found");

    const scopedBlock = block!.slice(scopedStart, superAdminComment);

    // The scoped block must NOT reference req.body (no client-supplied selectors).
    assert.ok(
      !scopedBlock.includes("req.body"),
      "scoped repair path must not reference req.body — the UPDATE target must be derived entirely server-side"
    );
  });

  it("scoped path derives targetCompanyId from req.authenticatedUserCompanyId", () => {
    const scopedStart = block?.indexOf('if (role !== "super_admin")');
    const superAdminComment = block?.indexOf("// ── super_admin path");
    const scopedBlock = block!.slice(scopedStart!, superAdminComment!);

    assert.ok(
      scopedBlock.includes("req.authenticatedUserCompanyId"),
      "scoped path must use req.authenticatedUserCompanyId (session company) as targetCompanyId"
    );
  });

  it("scoped UPDATE uses server-looked-up row id, not a client-supplied selector", () => {
    const scopedStart = block?.indexOf('if (role !== "super_admin")');
    const superAdminComment = block?.indexOf("// ── super_admin path");
    const scopedBlock = block!.slice(scopedStart!, superAdminComment!);

    // The UPDATE must reference `staleRow.id` (looked up by the server) in the WHERE clause.
    assert.ok(
      scopedBlock.includes("staleRow.id"),
      "scoped UPDATE must use server-looked-up staleRow.id, not a client-supplied selector"
    );
  });
});
