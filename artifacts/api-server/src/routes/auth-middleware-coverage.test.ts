// Task #922 — Regression tests to prevent auth middleware being skipped
// on protected routes.
//
// Background: Task #921 fixed 10 routes that were missing
// `requireAuthentication` as their first middleware. Without it, field
// techs were getting spurious 403s in production because bearer tokens
// were never validated — the role guard fired first with an undefined
// `req.authenticatedUserRole`, and guards like `requireWorkOrderBillingAccess`
// return 403 for any role that isn't in the allowed list (including
// undefined), not 401.
//
// The correct contract:
//   • No credentials  →  401  (requireAuthentication fires first)
//   • Wrong role       →  403  (role guard fires after authentication)
//
// This file has three sections:
//
//   1.  "Ten guarded routes" — a static-source check for each of the
//       10 specific routes that Task #921 patched.  For every route we
//       assert:
//         (a)  `requireAuthentication` is present in the middleware list.
//         (b)  Its position comes before the first role guard — the
//              ordering guarantee that makes (a) a 401 guarantee.
//
//   2.  "Broad coverage" — scans every app.patch / app.post / app.delete
//       call in routes.ts.  For each that contains any auth-dependent role
//       guard it asserts `requireAuthentication` appears and precedes it.
//       This catches the bug class prospectively whenever a new route is
//       added.
//
//   3.  "GET route coverage" — same broad scan for app.get calls.  GET
//       routes were excluded from Part 2 because they are more varied
//       (public catalogue endpoints, OAuth callbacks, health checks, etc.)
//       but GET routes that carry sensitive data behind a role guard need
//       the same 401-before-403 guarantee.
//
// Why static analysis?  `registerRoutes` is a 16 000-line monolith with
// startup-time setInterval timers, IIFE side-effects, and a PostgreSQL
// session store — none of which are friendly to in-process test mounting.
// Separate extracted-module tests (estimate-inline-lifecycle.test.ts,
// estimate-role-matrix.test.ts) cover the behavioral path for the modules
// that have been split out.  For the monolith we follow the same approach
// as audit-coverage.test.ts: fast source-text assertions that are
// deterministic, require no DB, and run in < 50 ms.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const src = readFileSync(join(__dirname, "routes.ts"), "utf8");

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Given a route registration marker (e.g. `app.patch("/api/work-orders/:id"`),
 * returns the substring from the start of that call up to (but not including)
 * the `async ` keyword that begins the request handler.  Everything in between
 * is the route path string + middleware argument list.
 *
 * Returns null if the marker is not found, or the empty string if there is no
 * gap between the marker and the handler (i.e. the handler is the second arg).
 */
function extractMiddlewareSlice(marker: string): string | null {
  const pos = src.indexOf(marker);
  if (pos < 0) return null;
  // Scan forward up to 800 chars — enough to cover any realistic arg list.
  const window = src.slice(pos, pos + 800);
  const asyncIdx = window.indexOf(" async ");
  if (asyncIdx < 0) return window; // shouldn't happen for well-formed handlers
  return window.slice(0, asyncIdx);
}

// Auth-dependent role guards: these middlewares read `req.authenticatedUserRole`
// which is only set by `requireAuthentication`.  Without prior authentication,
// they produce inconsistent status codes (some 401, some 403) rather than the
// canonical 401.  `requireQuickBooksAccess` is intentionally excluded — it
// falls back to `headerUserRole(req)` and is deliberately usable without a
// preceding auth step (QuickBooks OAuth flows can be unauthenticated).
const ROLE_GUARDS = [
  "requireCompanyAdminAccess",
  "requireCustomerEditAccess",
  "requireBoundaryEditAccess",
  "requireWorkOrderBillingAccess",
  "requireBillingAccess",
  "requireWorkOrderUpdateAccess",
  "requireBillingSheetUpdateAccess",
  "requireNotificationAccess",
  "requireSiteMapViewAccess",
] as const;

function firstIndexOf(text: string, ...needles: string[]): number {
  return Math.min(
    ...needles
      .map((n) => text.indexOf(n))
      .filter((i) => i >= 0),
    Infinity,
  );
}

// ─── Part 1: Ten specific routes from Task #921 ───────────────────────────────

describe("Task #922 — ten guarded routes have requireAuthentication before any role guard", () => {
  // Each tuple: [humanLabel, verb, routePath]
  const GUARDED_ROUTES: Array<[string, string, string]> = [
    ["PATCH /api/work-orders/:id", "patch", '"/api/work-orders/:id"'],
    ["DELETE /api/work-orders/bulk", "delete", '"/api/work-orders/bulk"'],
    ["DELETE /api/work-orders/:id", "delete", '"/api/work-orders/:id"'],
    ["PATCH /api/billing-sheets/:id", "patch", '"/api/billing-sheets/:id"'],
    ["DELETE /api/billing-sheets/bulk", "delete", '"/api/billing-sheets/bulk"'],
    ["DELETE /api/billing-sheets/:id", "delete", '"/api/billing-sheets/:id"'],
    ["POST /api/customers/import-csv", "post", '"/api/customers/import-csv"'],
    [
      "POST /api/company/:companyId/api-keys",
      "post",
      '"/api/company/:companyId/api-keys"',
    ],
    [
      "DELETE /api/company/:companyId/api-keys/:keyId",
      "delete",
      '"/api/company/:companyId/api-keys/:keyId"',
    ],
    [
      "POST /api/company/:companyId/users/:userId/resend-verification",
      "post",
      '"/api/company/:companyId/users/:userId/resend-verification"',
    ],
  ];

  for (const [label, verb, path] of GUARDED_ROUTES) {
    it(`${label} — requireAuthentication present and before every role guard`, () => {
      const marker = `app.${verb}(${path}`;
      const slice = extractMiddlewareSlice(marker);

      assert.ok(
        slice !== null,
        `Route registration not found: app.${verb}(${path} — was it removed or renamed?`,
      );

      // (a) requireAuthentication must be present.
      assert.ok(
        slice.includes("requireAuthentication"),
        `app.${verb}(${path}) is missing requireAuthentication middleware.\n` +
          `Without it unauthenticated requests receive 403 (from the role guard) ` +
          `instead of the correct 401.`,
      );

      const authIdx = slice.indexOf("requireAuthentication");

      // (b) requireAuthentication must appear before every role guard in the list.
      for (const guard of ROLE_GUARDS) {
        const guardIdx = slice.indexOf(guard);
        if (guardIdx < 0) continue; // this route doesn't use this guard

        assert.ok(
          authIdx < guardIdx,
          `app.${verb}(${path}): '${guard}' appears at position ${guardIdx} ` +
            `but requireAuthentication is at ${authIdx} — role guard must come AFTER authentication.\n` +
            `Relevant source slice:\n${slice}`,
        );
      }
    });
  }
});

// ─── Part 2: Broad coverage over all app.patch / app.post / app.delete ────────

describe("Task #922 — all app.patch/post/delete calls with role guards have requireAuthentication first (broad scan)", () => {
  it("every auth-dependent role guard is preceded by requireAuthentication", () => {
    // Find every `app.patch(`, `app.post(`, `app.delete(` position in the source.
    const METHOD_RE = /\bapp\.(patch|post|delete)\(/g;
    const violations: string[] = [];

    let match: RegExpExecArray | null;
    while ((match = METHOD_RE.exec(src)) !== null) {
      const pos = match.index;
      const verb = match[1];

      // Extract from the call start up to the async handler (max 800 chars).
      const window = src.slice(pos, pos + 800);
      const asyncIdx = window.indexOf(" async ");
      const slice = asyncIdx >= 0 ? window.slice(0, asyncIdx) : window;

      // Find the first role guard present in this call's arg list.
      const firstGuardIdx = firstIndexOf(slice, ...ROLE_GUARDS);
      if (firstGuardIdx === Infinity) continue; // no role guard → nothing to check

      // Identify which guard(s) appear so we can produce a useful message.
      const presentGuards = ROLE_GUARDS.filter((g) => slice.indexOf(g) >= 0);

      // requireAuthentication must also be present and precede the first guard.
      const authIdx = slice.indexOf("requireAuthentication");

      if (authIdx < 0) {
        // Extract the route path for the error message.
        const pathMatch = slice.match(/"\/api\/[^"]+"/);
        const routePath = pathMatch ? pathMatch[0] : "(unknown path)";
        violations.push(
          `app.${verb}(${routePath}): has role guard(s) [${presentGuards.join(", ")}] ` +
            `but requireAuthentication is ABSENT — unauthenticated requests will get 403 not 401.`,
        );
      } else if (authIdx > firstGuardIdx) {
        const pathMatch = slice.match(/"\/api\/[^"]+"/);
        const routePath = pathMatch ? pathMatch[0] : "(unknown path)";
        violations.push(
          `app.${verb}(${routePath}): requireAuthentication (pos ${authIdx}) comes AFTER ` +
            `role guard(s) [${presentGuards.join(", ")}] (first guard at pos ${firstGuardIdx}) — ` +
            `must be reordered so authentication runs first.`,
        );
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Found ${violations.length} route(s) where a role guard precedes or replaces requireAuthentication:\n\n` +
        violations.map((v) => `  • ${v}`).join("\n") +
        "\n\nFix: add requireAuthentication as the first middleware argument (before the role guard).",
    );
  });
});

// ─── Part 3: Broad coverage over all app.get ──────────────────────────────────

describe("Task #927 — all app.get calls with role guards have requireAuthentication first (broad scan)", () => {
  it("every auth-dependent role guard on a GET route is preceded by requireAuthentication", () => {
    // Find every `app.get(` position in the source.
    const METHOD_RE = /\bapp\.get\(/g;
    const violations: string[] = [];

    let match: RegExpExecArray | null;
    while ((match = METHOD_RE.exec(src)) !== null) {
      const pos = match.index;

      // Extract from the call start up to the async handler (max 800 chars).
      const window = src.slice(pos, pos + 800);
      const asyncIdx = window.indexOf(" async ");
      const slice = asyncIdx >= 0 ? window.slice(0, asyncIdx) : window;

      // Find the first role guard present in this call's arg list.
      const firstGuardIdx = firstIndexOf(slice, ...ROLE_GUARDS);
      if (firstGuardIdx === Infinity) continue; // no role guard → nothing to check

      // Identify which guard(s) appear so we can produce a useful message.
      const presentGuards = ROLE_GUARDS.filter((g) => slice.indexOf(g) >= 0);

      // requireAuthentication must also be present and precede the first guard.
      const authIdx = slice.indexOf("requireAuthentication");

      if (authIdx < 0) {
        const pathMatch = slice.match(/"\/api\/[^"]+"/);
        const routePath = pathMatch ? pathMatch[0] : "(unknown path)";
        violations.push(
          `app.get(${routePath}): has role guard(s) [${presentGuards.join(", ")}] ` +
            `but requireAuthentication is ABSENT — unauthenticated requests will get 403 not 401.`,
        );
      } else if (authIdx > firstGuardIdx) {
        const pathMatch = slice.match(/"\/api\/[^"]+"/);
        const routePath = pathMatch ? pathMatch[0] : "(unknown path)";
        violations.push(
          `app.get(${routePath}): requireAuthentication (pos ${authIdx}) comes AFTER ` +
            `role guard(s) [${presentGuards.join(", ")}] (first guard at pos ${firstGuardIdx}) — ` +
            `must be reordered so authentication runs first.`,
        );
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Found ${violations.length} GET route(s) where a role guard precedes or replaces requireAuthentication:\n\n` +
        violations.map((v) => `  • ${v}`).join("\n") +
        "\n\nFix: add requireAuthentication as the first middleware argument (before the role guard).",
    );
  });
});

// ─── Part 4: Specific GET routes from Task #927 ───────────────────────────────

describe("Task #927 — three GET routes that were missing requireAuthentication now have it before their role guard", () => {
  const NEWLY_GUARDED: Array<[string, string]> = [
    ["GET /api/notifications/:userId", '"/api/notifications/:userId"'],
    [
      "GET /api/notifications/:userId/count",
      '"/api/notifications/:userId/count"',
    ],
    [
      "GET /api/company/:companyId/api-keys",
      '"/api/company/:companyId/api-keys"',
    ],
  ];

  for (const [label, path] of NEWLY_GUARDED) {
    it(`${label} — requireAuthentication present and before every role guard`, () => {
      const marker = `app.get(${path}`;
      const slice = extractMiddlewareSlice(marker);

      assert.ok(
        slice !== null,
        `Route registration not found: app.get(${path} — was it removed or renamed?`,
      );

      assert.ok(
        slice.includes("requireAuthentication"),
        `app.get(${path}) is missing requireAuthentication middleware.\n` +
          `Without it unauthenticated requests receive 403 (from the role guard) ` +
          `instead of the correct 401.`,
      );

      const authIdx = slice.indexOf("requireAuthentication");

      for (const guard of ROLE_GUARDS) {
        const guardIdx = slice.indexOf(guard);
        if (guardIdx < 0) continue;

        assert.ok(
          authIdx < guardIdx,
          `app.get(${path}): '${guard}' appears at position ${guardIdx} ` +
            `but requireAuthentication is at ${authIdx} — role guard must come AFTER authentication.\n` +
            `Relevant source slice:\n${slice}`,
        );
      }
    });
  }
});

// ─── Part 5: Task #931 — pin-patch precise message appears exactly once ───────

describe("Task #931 — pin-patch precise 403 message appears exactly once in routes.ts", () => {
  it('exact string "You can only update the pin on a work order assigned to you." appears exactly once', () => {
    const needle = "You can only update the pin on a work order assigned to you.";
    let count = 0;
    let pos = 0;
    while ((pos = src.indexOf(needle, pos)) !== -1) {
      count++;
      pos += needle.length;
    }
    assert.equal(
      count,
      1,
      `Expected the precise pin-patch 403 message to appear exactly once in routes.ts ` +
        `(found ${count} occurrences). ` +
        `If count is 0, the message was removed or renamed — update the field-tech pin branch. ` +
        `If count is >1, it has leaked into the catch-all or a duplicate branch — consolidate.`,
    );
  });
});
