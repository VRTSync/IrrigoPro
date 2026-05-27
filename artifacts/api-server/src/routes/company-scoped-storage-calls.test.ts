// Static-source guard: every call to the company-scoped storage read methods
// must pass the correct number of arguments (always including the trailing
// companyId: number | null scope parameter).
//
// Methods covered (Task #934 — Auth & Tenancy Hardening Slice 3):
//
//   1-arg list methods (only companyId, no entity id prefix):
//     getWorkOrders(companyId)
//     getAllBillingSheets(companyId)
//
//   2-arg methods (entityId + companyId):
//     getWorkOrder(id, companyId)
//     getWorkOrdersByTechnician(techId, companyId)
//     getWorkOrdersByCustomer(customerId, companyId)
//     getWorkOrdersByStatus(status, companyId)
//     getBillingSheetById(id, companyId)
//     getBillingSheetsByCustomer(customerId, companyId)
//     getInvoiceById(id, companyId)
//     getInvoicesByCustomer(customerId, companyId)
//
// The test reads the TypeScript source text and asserts that:
//   1. No call site invokes any of these methods with fewer than the required
//      number of arguments (i.e. no bare `storage.getWorkOrder(id)` without the
//      companyId param).
//   2. The IStorage interface declares each in-interface method with at least the
//      required param count.
//
// Source scan strategy: glob ALL non-test, non-storage `.ts` files under `src/`
// so newly-added production files are automatically covered without any manual
// list update.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

// ── helpers ───────────────────────────────────────────────────────────────────

const ROOT = path.resolve(import.meta.dirname, "../..");
const SRC_DIR = path.join(ROOT, "src");

/** Recursively collect all `.ts` production source files under `dir`. */
function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectSourceFiles(fullPath));
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      entry.name !== "storage.ts"
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

// All production source files relative to ROOT (e.g. "src/routes/routes.ts").
const SCAN_SOURCES: string[] = collectSourceFiles(SRC_DIR).map(
  (f) => path.relative(ROOT, f),
);

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** Return every call-expression for `.<method>(…)` found in `src`. */
function findCallSites(
  src: string,
  method: string,
): { line: number; call: string }[] {
  const pattern = new RegExp(`\\.${method}\\(`, "g");
  const results: { line: number; call: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(src)) !== null) {
    // Extract from the opening paren to the matching close paren.
    const start = m.index + m[0].length - 1; // position of '('
    let depth = 0;
    let end = start;
    for (let i = start; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    const argText = src.slice(start + 1, end).trim();
    const lineNo = src.slice(0, m.index).split("\n").length;
    results.push({ line: lineNo, call: `${method}(${argText})` });
  }
  return results;
}

/** Count top-level comma-separated arguments (ignoring commas inside nested delimiters). */
function countArgs(argText: string): number {
  if (!argText.trim()) return 0;
  let depth = 0;
  let count = 1;
  for (const ch of argText) {
    if (ch === "(" || ch === "[" || ch === "{" || ch === "<") depth++;
    else if (ch === ")" || ch === "]" || ch === "}" || ch === ">") depth--;
    else if (ch === "," && depth === 0) count++;
  }
  return count;
}

// ── Method categories ─────────────────────────────────────────────────────────

// List methods — take only (companyId: number | null), no entity-id prefix.
const ONE_ARG_METHODS = [
  "getWorkOrders",
  "getAllBillingSheets",
] as const;

// Entity-scoped methods — take (entityId, companyId: number | null).
const TWO_ARG_METHODS = [
  "getWorkOrder",
  "getWorkOrdersByTechnician",
  "getWorkOrdersByCustomer",
  "getWorkOrdersByStatus",
  "getBillingSheetById",
  "getBillingSheetsByCustomer",
  "getInvoiceById",
  "getInvoicesByCustomer",
] as const;

// Methods declared in the IStorage interface with their required param count.
// getInvoicesByCustomer lives only on DatabaseStorage (not in IStorage), so it
// is excluded from the interface signature check.
const INTERFACE_METHODS: { method: string; minParams: number }[] = [
  { method: "getWorkOrders",              minParams: 1 },
  { method: "getAllBillingSheets",        minParams: 1 },
  { method: "getWorkOrder",              minParams: 2 },
  { method: "getWorkOrdersByTechnician", minParams: 2 },
  { method: "getWorkOrdersByCustomer",   minParams: 2 },
  { method: "getWorkOrdersByStatus",     minParams: 2 },
  { method: "getBillingSheetById",       minParams: 2 },
  { method: "getBillingSheetsByCustomer",minParams: 2 },
  { method: "getInvoiceById",            minParams: 2 },
];

// ── tests ─────────────────────────────────────────────────────────────────────

describe("company-scoped storage calls — static source guard", () => {
  it("every 1-arg list method call passes at least 1 arg (companyId)", () => {
    const violations: string[] = [];

    for (const method of ONE_ARG_METHODS) {
      for (const rel of SCAN_SOURCES) {
        const src = readSrc(rel);
        const sites = findCallSites(src, method);
        for (const site of sites) {
          const n = countArgs(site.call.slice(method.length + 1, -1));
          if (n < 1) {
            violations.push(`${rel}:${site.line} — ${site.call} (${n} arg(s))`);
          }
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Found call(s) to 1-arg list methods with 0 arguments:\n${violations.join("\n")}`,
    );
  });

  it("every 2-arg entity method call passes at least 2 args (entityId, companyId)", () => {
    const violations: string[] = [];

    for (const method of TWO_ARG_METHODS) {
      for (const rel of SCAN_SOURCES) {
        const src = readSrc(rel);
        const sites = findCallSites(src, method);
        for (const site of sites) {
          const n = countArgs(site.call.slice(method.length + 1, -1));
          if (n < 2) {
            violations.push(`${rel}:${site.line} — ${site.call} (${n} arg(s))`);
          }
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Found call(s) to 2-arg entity methods with fewer than 2 arguments:\n${violations.join("\n")}`,
    );
  });

  it("IStorage interface declares all scoped methods with correct param count", () => {
    const src = readSrc("src/storage.ts");
    const violations: string[] = [];

    for (const { method, minParams } of INTERFACE_METHODS) {
      // Match the interface declaration line: leading whitespace + methodName(...)
      // The async keyword in implementations starts differently, so this pattern
      // reliably finds interface signatures (no `async` prefix).
      const sigPattern = new RegExp(
        `(?:^|\\n)[ \\t]+${method}\\(([^)]+)\\)`,
        "m",
      );
      const match = sigPattern.exec(src);
      if (!match) {
        violations.push(`${method}: no matching interface signature found in storage.ts`);
        continue;
      }
      const params = match[1].split(",").map((s) => s.trim()).filter(Boolean);
      if (params.length < minParams) {
        violations.push(
          `${method}: interface declares only ${params.length} param(s) — expected at least ${minParams}`,
        );
      }
    }

    assert.deepEqual(
      violations,
      [],
      `IStorage method signature violations:\n${violations.join("\n")}`,
    );
  });
});
