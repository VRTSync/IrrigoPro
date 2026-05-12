// Audit script for React "Rules of Hooks" — flags any hook call that sits
// below an early `return` (or `if (...) return ...`) at the top level of a
// component function. This is the same anti-pattern that produced the
// production React error #310 fixed in Tasks #561 and #562.
//
// Run from repo root:
//   pnpm --filter @workspace/scripts run audit:hooks
//
// Exits non-zero if any violations are found, so it can be wired into CI.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOOK_RE = /^use[A-Z]/;

// Pages we explicitly audit. Add new long page components here as the app
// grows. Each is a top-level page in artifacts/irrigopro/src/pages/.
const TARGET_GLOBS = [
  // The five files called out in Task #562:
  "artifacts/irrigopro/src/pages/wet-checks.tsx",
  "artifacts/irrigopro/src/pages/work-orders.tsx",
  "artifacts/irrigopro/src/pages/estimates.tsx",
  "artifacts/irrigopro/src/pages/billing-sheets.tsx",
  "artifacts/irrigopro/src/pages/customer-billing.tsx",
  // Other large page components also covered by the audit:
  "artifacts/irrigopro/src/pages/parts-catalog.tsx",
  "artifacts/irrigopro/src/pages/company-user-management.tsx",
  "artifacts/irrigopro/src/pages/super-admin-app-health.tsx",
  "artifacts/irrigopro/src/pages/invoices.tsx",
  "artifacts/irrigopro/src/pages/login.tsx",
  "artifacts/irrigopro/src/pages/admin-wet-checks.tsx",
  "artifacts/irrigopro/src/pages/missing-photos-report.tsx",
  "artifacts/irrigopro/src/pages/company-profile.tsx",
  "artifacts/irrigopro/src/pages/admin-issue-types.tsx",
  "artifacts/irrigopro/src/pages/manager-dashboard.tsx",
  "artifacts/irrigopro/src/pages/admin-controllers.tsx",
  "artifacts/irrigopro/src/pages/admin-dashboard.tsx",
  "artifacts/irrigopro/src/pages/labor-rate-audit.tsx",
  "artifacts/irrigopro/src/pages/parts-list.tsx",
  "artifacts/irrigopro/src/pages/billing-dashboard.tsx",
  "artifacts/irrigopro/src/pages/operations.tsx",
  "artifacts/irrigopro/src/pages/customers.tsx",
  "artifacts/irrigopro/src/pages/field-tech.tsx",
  "artifacts/irrigopro/src/pages/super-admin-dashboard.tsx",
  "artifacts/irrigopro/src/pages/billing-zero-price-audit.tsx",
];

interface Finding {
  file: string;
  component: string;
  returnLine: number;
  hook: string;
  hookLine: number;
}

function hookName(node: ts.Node): string | null {
  if (!ts.isCallExpression(node)) return null;
  const expr = node.expression;
  let name: string | null = null;
  if (ts.isIdentifier(expr)) name = expr.text;
  else if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) {
    name = expr.name.text;
  }
  return name && HOOK_RE.test(name) ? name : null;
}

function statementHasReturn(s: ts.Statement): boolean {
  if (ts.isReturnStatement(s)) return true;
  if (ts.isIfStatement(s)) {
    const t = s.thenStatement;
    if (ts.isReturnStatement(t)) return true;
    if (ts.isBlock(t) && t.statements.some((x) => ts.isReturnStatement(x))) {
      return true;
    }
  }
  return false;
}

function analyzeFunction(
  fnNode: ts.FunctionLikeDeclaration,
  sf: ts.SourceFile,
  componentName: string,
  out: Finding[],
): void {
  const body = fnNode.body;
  if (!body || !ts.isBlock(body)) return;

  let firstReturnIdx = -1;
  let firstReturnLine = -1;
  for (let i = 0; i < body.statements.length; i++) {
    const s = body.statements[i];
    if (statementHasReturn(s)) {
      firstReturnIdx = i;
      firstReturnLine = sf.getLineAndCharacterOfPosition(s.getStart(sf)).line + 1;
      break;
    }
  }
  if (firstReturnIdx === -1) return;

  for (let i = firstReturnIdx + 1; i < body.statements.length; i++) {
    const s = body.statements[i];
    const visit = (node: ts.Node): void => {
      // Don't dive into nested function/component definitions — their
      // hooks belong to those components, not this one.
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node)
      ) {
        return;
      }
      const hook = hookName(node);
      if (hook) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        out.push({
          file: sf.fileName,
          component: componentName,
          returnLine: firstReturnLine,
          hook,
          hookLine: line,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(s);
  }
}

function walk(node: ts.Node, sf: ts.SourceFile, out: Finding[]): void {
  if (ts.isFunctionDeclaration(node) && node.name) {
    analyzeFunction(node, sf, node.name.text, out);
  } else if (ts.isVariableStatement(node)) {
    for (const decl of node.declarationList.declarations) {
      if (
        decl.initializer &&
        (ts.isArrowFunction(decl.initializer) ||
          ts.isFunctionExpression(decl.initializer))
      ) {
        const n =
          decl.name && ts.isIdentifier(decl.name) ? decl.name.text : "<anon>";
        analyzeFunction(decl.initializer, sf, n, out);
      }
    }
  }
  ts.forEachChild(node, (c) => walk(c, sf, out));
}

function main(): void {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const findings: Finding[] = [];
  let scanned = 0;

  for (const rel of TARGET_GLOBS) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) {
      console.warn(`skip (not found): ${rel}`);
      continue;
    }
    const src = fs.readFileSync(abs, "utf8");
    const sf = ts.createSourceFile(
      rel,
      src,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    walk(sf, sf, findings);
    scanned++;
  }

  console.log(`Audited ${scanned} page component file(s).`);
  if (findings.length === 0) {
    console.log("OK — no hooks found below an early return.");
    process.exit(0);
  }

  console.error(`\nFOUND ${findings.length} Rules-of-Hooks violation(s):\n`);
  for (const f of findings) {
    console.error(
      `  ${f.file}: ${f.component} — early return @ L${f.returnLine}, ` +
        `${f.hook}() @ L${f.hookLine}`,
    );
  }
  console.error(
    "\nHoist these hook calls above the early-return guard, or move the " +
      "condition inside the hook's options/callback.",
  );
  process.exit(1);
}

main();
