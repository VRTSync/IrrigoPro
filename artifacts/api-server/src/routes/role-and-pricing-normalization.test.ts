// Task #643 — regression coverage for the two normalizations:
//
// 1. The retired `manager` role alias must not appear as a role string
//    literal in any production source file. The canonical name is
//    `irrigation_manager` (see `lib/db/src/schema/schema.ts` and
//    `docs/estimate-system.md`). Only the data-migration script and
//    audit docs are allowed to mention the retired alias.
// 2. The field_tech response sanitizer must strip every pricing field
//    listed in the shared `PRICING_FIELDS_BY_TABLE` inventory. The test
//    builds its fixture payload from that inventory rather than a
//    hand-maintained allowlist, so adding a new pricing column to the
//    inventory automatically extends this regression too.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRICING_FIELDS_BY_TABLE,
  PRICING_FIELDS_TO_STRIP,
} from "@workspace/db";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

// Files (relative to repo root) that are allowed to mention the retired
// alias — these are the migration script, the docs that record the
// rename decision, and this test file itself.
const RETIRED_ROLE_ALLOWLIST = new Set<string>([
  "artifacts/api-server/src/scripts/rename-manager-role.ts",
  "artifacts/api-server/src/routes/role-and-pricing-normalization.test.ts",
  "docs/estimate-system.md",
  "docs/audits/estimate-handoffs-2026-05.md",
  "replit.md",
]);

// Directories under repo root that we scan for the guard. Limited to
// the live source trees that the deployed app actually ships from.
const SCAN_DIRS = [
  "artifacts/api-server/src",
  "artifacts/irrigopro/src",
  "artifacts/irrigopro-mobile/app",
  "lib",
] as const;

const SOURCE_EXT = new Set([".ts", ".tsx"]);

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const full = join(dir, name);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      walk(full, out);
    } else {
      const ext = full.slice(full.lastIndexOf("."));
      if (SOURCE_EXT.has(ext)) out.push(full);
    }
  }
}

// Matches `'manager'` or `"manager"` as a standalone token (i.e. with
// no word-character on either side of `manager`). This avoids
// false-positives on `billing_manager`, `irrigation_manager`, etc.
const RETIRED_ROLE_REGEX = /(['"])manager\1/;

describe("Task #643 — retired `manager` role alias guard", () => {
  it("does not appear as a string literal in any production source file", () => {
    const offenders: Array<{ file: string; line: number; text: string }> = [];
    for (const sub of SCAN_DIRS) {
      const files: string[] = [];
      walk(join(REPO_ROOT, sub), files);
      for (const f of files) {
        const rel = relative(REPO_ROOT, f).split("\\").join("/");
        if (RETIRED_ROLE_ALLOWLIST.has(rel)) continue;
        const text = readFileSync(f, "utf8");
        if (!RETIRED_ROLE_REGEX.test(text)) continue;
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (RETIRED_ROLE_REGEX.test(lines[i])) {
            offenders.push({ file: rel, line: i + 1, text: lines[i].trim() });
          }
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `Retired role 'manager' must not appear as a string literal outside the migration ` +
        `and docs. Offenders:\n${offenders
          .map((o) => `  ${o.file}:${o.line}  ${o.text}`)
          .join("\n")}`,
    );
  });
});

// Mirrors `sanitizePricingFieldsInPlace` in routes.ts. We re-implement
// it here (a few lines) so the test doesn't have to import the 16k-line
// routes module — the contract under test is "every key in
// PRICING_FIELDS_TO_STRIP is dropped, recursively".
function stripPricingFields<T>(data: T): T {
  if (data === null || data === undefined) return data;
  if (typeof data !== "object") return data;
  if (Array.isArray(data)) {
    for (const item of data) stripPricingFields(item);
    return data;
  }
  const obj = data as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (PRICING_FIELDS_TO_STRIP.has(key)) {
      delete obj[key];
      continue;
    }
    const v = obj[key];
    if (v !== null && typeof v === "object") stripPricingFields(v);
  }
  return data;
}

describe("Task #643 — pricing-strip set is derived from PRICING_FIELDS_BY_TABLE", () => {
  it("strips every pricing field across every table in the inventory", () => {
    // Build a synthetic field_tech response that includes one row per
    // table, each row populated with all of that table's pricing
    // columns set to non-zero numbers.
    const payload: Record<string, Record<string, unknown>> = {};
    const entries = Object.entries(PRICING_FIELDS_BY_TABLE) as Array<
      [string, readonly string[]]
    >;
    for (const [tableKey, fields] of entries) {
      const row: Record<string, unknown> = { id: 1, sentinel: "keep-me" };
      for (const f of fields) row[f] = 123.45;
      payload[tableKey] = row;
    }

    stripPricingFields(payload);

    for (const [tableKey, fields] of entries) {
      const row = payload[tableKey];
      assert.equal(
        row.sentinel,
        "keep-me",
        `${tableKey}: non-pricing fields must survive`,
      );
      for (const f of fields) {
        assert.ok(
          !(f in row),
          `${tableKey}.${f} must be stripped from field_tech responses`,
        );
      }
    }
  });

  it("PRICING_FIELDS_TO_STRIP equals the union of every per-table list", () => {
    const expected = new Set<string>(
      Object.values(PRICING_FIELDS_BY_TABLE).flatMap((arr) => [...arr]),
    );
    assert.deepEqual(new Set(PRICING_FIELDS_TO_STRIP), expected);
  });

  it("every pricing-bearing list / detail endpoint wraps its response with applyPricingVisibility", () => {
    // Static-source guard: the handler block for each of these
    // pricing-bearing endpoints in routes.ts must call
    // `applyPricingVisibility(req, ...)` before sending the JSON
    // payload. This is what guarantees a field_tech never sees
    // labor rates, totals, unit prices, etc. on the wire. The list
    // is the union of money-bearing list/detail endpoints across
    // estimates, work orders, billing sheets, and invoices.
    const ENDPOINTS: Array<{ method: string; path: string }> = [
      // Estimates
      { method: "get", path: "/api/estimates" },
      { method: "get", path: "/api/estimates/pending-approval" },
      { method: "get", path: "/api/estimates/:id" },
      { method: "get", path: "/api/customers/:id/estimates" },
      // Invoices
      { method: "get", path: "/api/invoices" },
      // Billing sheets
      { method: "get", path: "/api/billing-sheets" },
      { method: "get", path: "/api/billing-sheets/:id" },
      // Work orders
      { method: "get", path: "/api/work-orders" },
      { method: "get", path: "/api/work-orders/:id" },
    ];

    const routesPath = join(
      REPO_ROOT,
      "artifacts",
      "api-server",
      "src",
      "routes",
      "routes.ts",
    );
    const src = readFileSync(routesPath, "utf8");

    function findHandlerBody(
      method: string,
      path: string,
    ): string | null {
      // Match `app.<method>("<path>"` allowing single or double
      // quotes, then find the balanced parentheses that close the
      // `app.<method>(...)` call. Inside is the route handler we
      // need to scan for applyPricingVisibility.
      const escaped = path.replace(/[/.:]/g, (c) => "\\" + c);
      const re = new RegExp(
        `app\\.${method}\\(\\s*['\"]${escaped}['\"]`,
        "g",
      );
      const m = re.exec(src);
      if (!m) return null;
      // Walk forward from the opening `(` of `app.<method>(` to find
      // the matching `)`.
      let i = src.indexOf("(", m.index);
      let depth = 0;
      let inString: string | null = null;
      let escape = false;
      for (; i < src.length; i++) {
        const ch = src[i]!;
        if (inString) {
          if (escape) {
            escape = false;
          } else if (ch === "\\") {
            escape = true;
          } else if (ch === inString) {
            inString = null;
          }
          continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") {
          inString = ch;
          continue;
        }
        if (ch === "(") depth++;
        else if (ch === ")") {
          depth--;
          if (depth === 0) return src.slice(m.index, i + 1);
        }
      }
      return null;
    }

    const missing: string[] = [];
    for (const ep of ENDPOINTS) {
      const body = findHandlerBody(ep.method, ep.path);
      if (!body) {
        missing.push(`${ep.method.toUpperCase()} ${ep.path} — handler not found in routes.ts`);
        continue;
      }
      if (!/applyPricingVisibility\s*\(/.test(body)) {
        missing.push(
          `${ep.method.toUpperCase()} ${ep.path} — handler does not call applyPricingVisibility`,
        );
      }
    }
    assert.deepEqual(
      missing,
      [],
      `Pricing-bearing endpoints missing applyPricingVisibility wrapping:\n  ${missing.join("\n  ")}`,
    );
  });

  it("retains the historical strip surface (no behavior regression)", () => {
    // The legacy hand-maintained set from routes.ts before Task #643.
    // The shared constant must still cover every name that used to be
    // stripped, otherwise a field_tech could start seeing prices.
    const historical = [
      "laborRate",
      "laborSubtotal",
      "partsSubtotal",
      "totalAmount",
      "estimatedTotal",
      "partPrice",
      "totalPrice",
      "unitPrice",
      "price",
      "cost",
      "laborAmount",
      "laborTotal",
      "partsAmount",
      "totalCost",
      "laborCost",
      "partsCost",
      "totalUnbilledAmount",
      "totalPartsCost",
    ];
    for (const f of historical) {
      assert.ok(
        PRICING_FIELDS_TO_STRIP.has(f),
        `pricing field "${f}" must still be in the strip set`,
      );
    }
  });
});
