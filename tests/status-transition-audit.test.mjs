import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Task #208: regression sweep that ensures every work-order and billing-sheet
// status value defined in the schema has at least one forward transition wired
// up in server/routes.ts. Task #206 was caused by a manager-creation path
// writing a billing-sheet status ('completed') that no downstream filter
// surfaced for billing, so records sat in limbo forever. If a future change
// introduces another orphan status — either by adding a new enum value
// without wiring it into the unbilled filter / a transition endpoint, or by
// removing the only forward path from an existing non-terminal status — this
// test fails loudly.
//
// Strategy: for each enum value we explicitly declare its forward-path
// mechanism (which downstream filter or transition endpoint will move records
// out of that state) and assert that mechanism is actually present in
// server/routes.ts. The explicit declaration doubles as living documentation:
// adding a new enum value forces the contributor to declare and verify the
// forward path here.

const __dirname = dirname(fileURLToPath(import.meta.url));
const routesPath = resolve(__dirname, "../server/routes.ts");
const schemaPath = resolve(__dirname, "../shared/schema.ts");
const routesSrc = readFileSync(routesPath, "utf8");
const schemaSrc = readFileSync(schemaPath, "utf8");

const { workOrderStatusValues } = await import("../shared/schema.ts");

// Billing-sheet statuses live as a comment on the billingSheets.status column
// in shared/schema.ts (no exported const). Mirror that comment here; the
// "comment matches audit list" test below catches divergence in either
// direction.
const billingSheetStatusValues = [
  "draft",
  "submitted",
  "completed",
  "pending_manager_review",
  "approved_passed_to_billing",
  "billed",
];

// Terminal statuses by design.
//  - 'billed' is set automatically when an invoice is created.
//  - 'cancelled' is an absorbing dead-end for work orders.
const TERMINAL_WORK_ORDER_STATUSES = new Set(["billed", "cancelled"]);
const TERMINAL_BILLING_SHEET_STATUSES = new Set(["billed"]);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Probes that detect specific wiring patterns in routes.ts.
const probes = {
  // Status appears as a key with a non-empty next-state list in any
  // allowedTransitions: Record<string, string[]> map.
  allowedTransitionsKey(status) {
    const re = new RegExp(`^\\s*${escapeRegex(status)}\\s*:\\s*\\[([^\\]]*)\\]`, "m");
    const m = re.exec(routesSrc);
    return Boolean(m && m[1].trim().length > 0);
  },
  // Status used as a state guard in a transition endpoint, e.g.
  //   if (workOrder.status !== 'pending_manager_review') return 400;
  endpointGuard(status) {
    const re = new RegExp(`\\.status\\s*(?:!==|===)\\s*['"]${escapeRegex(status)}['"]`);
    return re.test(routesSrc);
  },
  // Status referenced in a filter expression on a wo/bs/sheet variable, e.g.
  //   wo.status === 'approved_passed_to_billing'
  filterReference(status) {
    const re = new RegExp(`\\b(?:wo|bs|sheet|workOrder|billingSheet)\\.status\\s*===\\s*['"]${escapeRegex(status)}['"]`);
    return re.test(routesSrc);
  },
  // Status appears as the value of an `updateData.status === 'X'` /
  // `billingSheetData.status === 'X'` / `workOrderData.status === 'X'` check
  // inside a generic PATCH endpoint — meaning that PATCH path explicitly
  // recognizes and acts on the requested transition.
  patchSubmissionGuard(status) {
    const re = new RegExp(`(?:updateData|billingSheetData|workOrderData)\\.status\\s*===\\s*['"]${escapeRegex(status)}['"]`);
    return re.test(routesSrc);
  },
  // The forward-target status is written somewhere in routes.ts as either
  //   status: 'X'    or    resolvedStatus = 'X'    or    status = 'X'
  // Used for initial-state statuses (draft, pending) whose forward path is
  // "creator writes a more-advanced state directly". Pass the EXPECTED NEXT
  // status — e.g. probes.writesForwardTarget("submitted") to prove draft can
  // advance to submitted.
  writesForwardTarget(targetStatus) {
    const re = new RegExp(
      `(?:status|resolvedStatus)\\s*[:=]\\s*['"]${escapeRegex(targetStatus)}['"]`,
    );
    return re.test(routesSrc);
  },
};

// Run a declared probe entry. Entries are either a probe name (called with the
// status itself) or a [probeName, ...args] tuple (called with explicit args).
function runProbe(entry, status) {
  if (typeof entry === "string") return probes[entry](status);
  const [name, ...args] = entry;
  return probes[name](...args);
}

// Per-status forward-path declarations. The value is an array of probe names;
// the test passes when ANY of the listed probes matches.
//
// Adding a new status?  Add an entry here describing how it moves forward.
// Removing a status's only forward path?  This test will fail.
const WORK_ORDER_FORWARD_PATHS = {
  pending: ["allowedTransitionsKey", "filterReference"],
  assigned: ["allowedTransitionsKey", "filterReference"],
  in_progress: ["allowedTransitionsKey", "filterReference"],
  // 'work_completed' is a legacy state. PATCH explicitly forbids transitioning
  // out of it, but the dashboard "unapproved totals" filter still surfaces it
  // so admins can see and clear it. That filter reference is the forward
  // pressure that keeps records visible until they are manually moved.
  work_completed: ["filterReference"],
  // Manager review is exited by POST /api/work-orders/:id/approve and
  // POST /api/work-orders/:id/return-for-correction, both of which guard on
  // `workOrder.status !== 'pending_manager_review'`.
  pending_manager_review: ["endpointGuard", "allowedTransitionsKey"],
  // Approved tickets surface in unbilled filters and are flipped to 'billed'
  // when an invoice is created.
  approved_passed_to_billing: ["filterReference"],
};

const BILLING_SHEET_FORWARD_PATHS = {
  // Drafts are the initial state; field-tech submission writes
  // `resolvedStatus = 'submitted'` in the BS POST endpoint, advancing draft
  // → submitted. Verifying the target value is written somewhere in routes.ts
  // is enough to prove the forward path exists. The submission guard at
  // `billingSheetData.status === 'submitted'` in the BS PATCH endpoint then
  // runs pricing/audit checks on the way through.
  draft: [["writesForwardTarget", "submitted"]],
  // Submitted sheets are surfaced by the dashboard unapproved-totals filter
  // and progress to pending_manager_review (or are PATCHed forward).
  submitted: ["filterReference"],
  // The Task #206 canary. 'completed' MUST stay referenced in a downstream
  // filter — that is the regression this whole test exists to prevent.
  completed: ["filterReference"],
  pending_manager_review: ["endpointGuard"],
  approved_passed_to_billing: ["filterReference"],
};

function reportMissingForwardPath(kind, status, declaredProbes) {
  return (
    `${kind} status '${status}' is non-terminal but its declared forward-path probes ` +
    `[${declaredProbes.join(", ")}] no longer match anything in server/routes.ts. ` +
    `This is exactly the Task #206-style bug — records written with this status would sit in limbo forever. ` +
    `Either restore the forward transition in server/routes.ts, or update the declaration in tests/status-transition-audit.test.mjs ` +
    `to point at the new mechanism (and confirm the new mechanism actually moves records forward).`
  );
}

describe("Task #208: status transition audit", () => {
  test("every work-order status value is declared in the audit table or marked terminal", () => {
    for (const status of workOrderStatusValues) {
      const isTerminal = TERMINAL_WORK_ORDER_STATUSES.has(status);
      const hasDeclaration = Object.prototype.hasOwnProperty.call(WORK_ORDER_FORWARD_PATHS, status);
      assert.ok(
        isTerminal || hasDeclaration,
        `Work-order status '${status}' was added to workOrderStatusValues in shared/schema.ts but has no entry in ` +
          `WORK_ORDER_FORWARD_PATHS in tests/status-transition-audit.test.mjs. ` +
          `Add it to TERMINAL_WORK_ORDER_STATUSES (if it is a final state) or declare its forward path here so the audit can verify it.`,
      );
    }
  });

  test("every work-order status value is referenced somewhere in server/routes.ts", () => {
    for (const status of workOrderStatusValues) {
      const re = new RegExp(`['"]${escapeRegex(status)}['"]`);
      assert.ok(
        re.test(routesSrc),
        `Work-order status '${status}' is defined in shared/schema.ts but is not referenced anywhere in server/routes.ts.`,
      );
    }
  });

  test("every non-terminal work-order status has its declared forward-path mechanism present in routes.ts", () => {
    for (const [status, declaredProbes] of Object.entries(WORK_ORDER_FORWARD_PATHS)) {
      assert.ok(
        workOrderStatusValues.includes(status),
        `Work-order status '${status}' is declared in WORK_ORDER_FORWARD_PATHS but no longer exists in workOrderStatusValues. Remove the stale declaration.`,
      );
      const matched = declaredProbes.some((entry) => runProbe(entry, status));
      assert.ok(matched, reportMissingForwardPath("Work-order", status, declaredProbes));
    }
  });

  test("billing-sheet status comment in shared/schema.ts matches the audited list", () => {
    const bsTableMatch = schemaSrc.match(/billingSheets\s*=\s*pgTable\([\s\S]*?\}\);/);
    assert.ok(bsTableMatch, "Could not locate billingSheets table definition");
    const statusLine = bsTableMatch[0]
      .split("\n")
      .find((l) => /status:\s*text\("status"\)/.test(l));
    assert.ok(statusLine, "Could not locate billing_sheets.status column");
    for (const status of billingSheetStatusValues) {
      assert.ok(
        statusLine.includes(status),
        `Billing-sheet status '${status}' is in the audit list but missing from the schema comment in shared/schema.ts.`,
      );
    }
    const commentMatch = statusLine.match(/\/\/\s*(.+)$/);
    assert.ok(commentMatch, "billing_sheets.status column has no documenting comment");
    const commentValues = commentMatch[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const v of commentValues) {
      assert.ok(
        billingSheetStatusValues.includes(v),
        `Billing-sheet status '${v}' was added to the schema comment but not to the audit list in tests/status-transition-audit.test.mjs. ` +
          `Add it (and verify it has a forward transition) so it can never become an orphan like Task #206.`,
      );
    }
  });

  test("every billing-sheet status value is declared in the audit table or marked terminal", () => {
    for (const status of billingSheetStatusValues) {
      const isTerminal = TERMINAL_BILLING_SHEET_STATUSES.has(status);
      const hasDeclaration = Object.prototype.hasOwnProperty.call(BILLING_SHEET_FORWARD_PATHS, status);
      assert.ok(
        isTerminal || hasDeclaration,
        `Billing-sheet status '${status}' has no entry in BILLING_SHEET_FORWARD_PATHS in tests/status-transition-audit.test.mjs. ` +
          `Add it to TERMINAL_BILLING_SHEET_STATUSES (if it is a final state) or declare its forward path here.`,
      );
    }
  });

  test("every billing-sheet status value is referenced in server/routes.ts", () => {
    for (const status of billingSheetStatusValues) {
      const re = new RegExp(`['"]${escapeRegex(status)}['"]`);
      assert.ok(
        re.test(routesSrc),
        `Billing-sheet status '${status}' is defined but is not referenced anywhere in server/routes.ts.`,
      );
    }
  });

  test("every non-terminal billing-sheet status has its declared forward-path mechanism present in routes.ts", () => {
    for (const [status, declaredProbes] of Object.entries(BILLING_SHEET_FORWARD_PATHS)) {
      assert.ok(
        billingSheetStatusValues.includes(status),
        `Billing-sheet status '${status}' is declared in BILLING_SHEET_FORWARD_PATHS but no longer exists in the audited list. Remove the stale declaration.`,
      );
      const matched = declaredProbes.some((entry) => runProbe(entry, status));
      assert.ok(matched, reportMissingForwardPath("Billing-sheet", status, declaredProbes));
    }
  });
});
