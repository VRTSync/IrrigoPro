// Task #638 — Static guard: no direct reads of `estimate.status` /
// `estimate.internalStatus` (or the `est.` shorthand) outside the
// canonical lifecycle module.
//
// The whole point of #638 is that `lifecycleOf` + the predicates in
// `@/lib/lifecycle` are the ONLY way the UI reasons about estimate
// state. Direct enum reads silently desync the board, list,
// dashboard tile, and detail banners — exactly the drift this test
// is here to prevent.
//
// If you're hitting this and the addition is genuinely intentional
// (e.g. you're extending `lifecycle.ts` itself, or adding a new
// label helper that maps raw enums to UI strings), add the file to
// `ALLOWLIST` below with a one-line justification.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, ".."); // artifacts/irrigopro/src

// Files that are allowed to read the raw enum fields. Keep this
// list short and justified — each entry weakens the guarantee.
const ALLOWLIST = new Set<string>([
  // The canonical lifecycle module now lives in @workspace/shared
  // (lib/shared/src/lifecycle.ts), outside this src tree — the walker
  // never visits it, so no entry is needed for it here.
  //
  // Re-exports `lifecycleOf` from the canonical helper but still
  // takes an `Estimate` parameter shape (no raw reads of its own;
  // present here defensively in case future helpers do).
  "components/estimates/list/estimate-list.helpers.ts",
  // Reads `.internalStatus` from an opaque audit-log `before`/`after`
  // JSON delta payload (the activity history API), not from a live
  // estimate object. The field is accessed on `Record<string, unknown>`
  // for display in the audit trail — lifecycle helpers don't apply here.
  "components/activity/ActivityTab.tsx",
]);

// Matches `estimate.status`, `estimate.internalStatus`, `est.status`,
// `est.internalStatus`, plus destructuring like
// `const { status, internalStatus } = estimate` (any whitespace,
// optional other fields, optional `as Type`). We deliberately don't
// match `.lifecycleStatus` because that's the canonical field the
// helper itself prefers, and we don't try to enumerate every
// possible alias variable name — those bypasses are documented in
// the test comment and the AST-rewrite follow-up.
const FORBIDDEN_PATTERNS: RegExp[] = [
  // ANY `.internalStatus` read — this field exists only on the
  // estimates table in `lib/db/src/schema/schema.ts`, so reads via
  // alias names (`existing?.internalStatus`, `e.internalStatus`,
  // `row.internalStatus`, …) are unambiguously estimate reads and
  // must go through lifecycle.ts. Optional-chaining and bracket
  // access both match.
  /[\w$\])]\??\.\binternalStatus\b/,
  // Estimate-named member access for the more generic `.status`
  // field (other entities like work orders also have `.status`, so
  // we can't be type-blind here).
  /\b(?:estimate|est)\??\.(?:status|internalStatus)\b/,
  // Destructuring `internalStatus` from anything is forbidden;
  // destructuring `status` only when the source is an estimate.
  /\{[^{}\n]*\binternalStatus\b[^{}\n]*\}\s*=/,
  /\{[^{}\n]*\bstatus\b[^{}\n]*\}\s*=\s*(?:estimate|est)\b/,
];

function isForbidden(text: string): boolean {
  return FORBIDDEN_PATTERNS.some((p) => p.test(text));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip generated / vendored dirs if any ever appear here.
      if (name === "node_modules" || name === "dist" || name === "build") continue;
      walk(full, out);
    } else if (
      name.endsWith(".ts") ||
      name.endsWith(".tsx")
    ) {
      out.push(full);
    }
  }
  return out;
}

function stripCommentsAndStrings(src: string): string {
  // Remove /* … */ block comments.
  let out = src.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove // … line comments.
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  // Collapse single- and double-quoted strings to empty literals.
  // Template literals are intentionally NOT stripped — `${…}`
  // interpolations contain real code we must scan (e.g.
  // `` `EST #${estimate.status}` `` would otherwise bypass the
  // guard).
  out = out.replace(/'(?:\\.|[^'\\])*'/g, '""');
  out = out.replace(/"(?:\\.|[^"\\])*"/g, '""');
  return out;
}

describe("estimate direct-read guard (Task #638)", () => {
  it("no file outside the allowlist reads `estimate.status` / `.internalStatus` (or `est.…`)", () => {
    const offenders: { file: string; line: number; text: string }[] = [];
    for (const abs of walk(ROOT)) {
      const rel = relative(ROOT, abs).split(sep).join("/");
      // Skip test files — they're allowed to exercise the raw shape.
      if (
        rel.endsWith(".test.ts") ||
        rel.endsWith(".test.tsx") ||
        rel.endsWith(".spec.ts") ||
        rel.endsWith(".spec.tsx")
      ) {
        continue;
      }
      if (ALLOWLIST.has(rel)) continue;
      const src = readFileSync(abs, "utf8");
      const stripped = stripCommentsAndStrings(src);
      if (!isForbidden(stripped)) continue;
      const lines = stripped.split("\n");
      lines.forEach((line, i) => {
        if (isForbidden(line)) {
          offenders.push({ file: rel, line: i + 1, text: line.trim() });
        }
      });
    }

    if (offenders.length > 0) {
      // Build a readable failure message so CI tells the developer
      // exactly where to switch to `lifecycleOf` / a predicate.
      const detail = offenders
        .map((o) => `  ${o.file}:${o.line}  ${o.text}`)
        .join("\n");
      throw new Error(
        `Found direct reads of estimate.status / estimate.internalStatus outside the allowlist.\n` +
          `Use lifecycleOf(estimate) or one of the predicates in @workspace/shared instead.\n` +
          `If the read is genuinely necessary, add the file to ALLOWLIST in this test with a one-line justification.\n\n` +
          detail,
      );
    }
    expect(offenders).toEqual([]);
  });

  it("allowlist entries actually exist (catches stale exemptions)", () => {
    for (const rel of ALLOWLIST) {
      const abs = join(ROOT, rel);
      expect(() => statSync(abs)).not.toThrow();
    }
  });

  // Self-regression tests — pin the loopholes the architect review
  // surfaced (template-literal interpolation, destructuring) so a
  // future refactor of the scanner can't silently weaken the guard.
  it("scanner catches `estimate.status` inside a template literal interpolation", () => {
    const sample = "const s = `EST #${estimate.status}`;";
    expect(isForbidden(stripCommentsAndStrings(sample))).toBe(true);
  });

  it("scanner catches destructuring from an estimate variable", () => {
    const sample = "const { status, internalStatus } = estimate;";
    expect(isForbidden(stripCommentsAndStrings(sample))).toBe(true);
    const sampleEst = "const { status } = est;";
    expect(isForbidden(stripCommentsAndStrings(sampleEst))).toBe(true);
  });

  it("scanner catches alias reads via `.internalStatus` (estimate-exclusive field)", () => {
    expect(
      isForbidden(stripCommentsAndStrings("const x = existing?.internalStatus;")),
    ).toBe(true);
    expect(
      isForbidden(stripCommentsAndStrings("if (row.internalStatus === 'draft') {}")),
    ).toBe(true);
    expect(
      isForbidden(stripCommentsAndStrings("const { internalStatus } = something;")),
    ).toBe(true);
  });

  it("scanner ignores comments, single-quoted, and double-quoted strings", () => {
    const sample = [
      "// estimate.status is allowed in comments",
      "/* estimate.internalStatus */",
      'const a = "estimate.status";',
      "const b = 'est.internalStatus';",
    ].join("\n");
    expect(isForbidden(stripCommentsAndStrings(sample))).toBe(false);
  });

  it("scanner does NOT flag `.lifecycleStatus` (the canonical field)", () => {
    const sample = "const lc = estimate.lifecycleStatus;";
    expect(isForbidden(stripCommentsAndStrings(sample))).toBe(false);
  });
});
