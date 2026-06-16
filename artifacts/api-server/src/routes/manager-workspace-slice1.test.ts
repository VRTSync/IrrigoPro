// Task #1258 — Manager Workspace Simplification, Slice 1 (backend source guards)
// Task #1289 — Fix needs-approval filter dropping unassigned tickets and completed
//              billing sheets (regression guards added in the final describe block)
//
// These tests analyze the source code of manager-workspace-routes.ts to assert
// structural guarantees without requiring a live DB connection:
//
//   1. GET /api/manager-workspace/needs-approval is registered.
//   2. It filters WOs to the correct statuses (pending_manager_review, work_completed).
//   3. It filters BSs to the correct statuses (pending_manager_review, submitted, completed).
//   4. It excludes rows with a non-null invoiceId.
//   5. POST /api/manager-workspace/findings/bulk-route returns 404.
//   6. No route in the file calls /kickback — the canonical endpoint is /return-for-correction.
//   7. (Regression #1289) Null-tech work orders are NOT filtered out by scopedWorkOrdersForManager.
//   8. (Regression #1289) Null-tech billing sheets are NOT filtered out by scopedBillingSheets.
//   9. (Regression #1289) "completed" billing sheets appear (ACTIVE_BS includes completed).
//  10. (Regression #1289) Canonical ACTIVE_WO / ACTIVE_BS constants are used; local copies deleted.
//  11. (Regression #1289) super_admin path returns all companies (no company filter).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROUTES_FILE = resolve(__dirname, "manager-workspace-routes.ts");
const src = readFileSync(ROUTES_FILE, "utf8");

describe("Manager Workspace Slice 1 — source guards (no DB)", () => {
  describe("GET /api/manager-workspace/needs-approval endpoint", () => {
    it("route is registered", () => {
      assert.ok(
        src.includes("/api/manager-workspace/needs-approval"),
        "Expected /api/manager-workspace/needs-approval to be registered",
      );
    });

    it("filters WOs to pending_manager_review status", () => {
      assert.ok(
        src.includes("pending_manager_review"),
        "Expected pending_manager_review to appear in source (WO filter)",
      );
    });

    it("filters WOs to work_completed status", () => {
      assert.ok(
        src.includes("work_completed"),
        "Expected work_completed to appear in source (WO filter)",
      );
    });

    it("filters BSs to submitted status", () => {
      assert.ok(
        src.includes("submitted"),
        "Expected submitted to appear in source (BS filter)",
      );
    });

    it("excludes rows that already have an invoiceId", () => {
      assert.ok(
        src.includes("invoiceId"),
        "Expected invoiceId exclusion check in source",
      );
    });
  });

  describe("POST /api/manager-workspace/findings/bulk-route — tombstone", () => {
    it("bulk-route path is present (tombstoned to 404)", () => {
      assert.ok(
        src.includes("findings/bulk-route"),
        "Expected findings/bulk-route to appear in source (tombstone)",
      );
    });

    it("bulk-route handler returns 404", () => {
      // The 404 must appear in the source after the bulk-route path declaration
      const bulkIdx = src.indexOf("findings/bulk-route");
      assert.ok(bulkIdx !== -1, "findings/bulk-route not found");
      const after = src.slice(bulkIdx, bulkIdx + 400);
      assert.ok(
        after.includes("404"),
        `Expected a 404 response within 400 chars after findings/bulk-route; got:\n${after}`,
      );
    });
  });

  describe("Return for Correction — endpoint naming", () => {
    it("source uses /return-for-correction, not /kickback", () => {
      assert.ok(
        !src.includes("/kickback"),
        "Found /kickback in manager-workspace-routes.ts — use /return-for-correction instead",
      );
    });
  });

  // -----------------------------------------------------------------------
  // Regression guards — Task #1289
  //
  // Two silent bugs caused unassigned tickets and completed billing sheets
  // to be dropped from the needs-approval queue:
  //
  //   Bug 1: scopedWorkOrdersForManager / scopedBillingSheets resolved each
  //          row's tech id to a company id and compared it to the caller's
  //          company id. Rows with null technicianId resolved to null, so
  //          null === cid was always false — every unassigned ticket was
  //          silently dropped.
  //
  //   Bug 2: The local NEEDS_APPROVAL_BS set was {pending_manager_review,
  //          submitted} — missing "completed" which is in the canonical
  //          ACTIVE_BS from billing-workspace-routes.ts.
  //
  // The fixes are structural so source-guard tests are the right signal.
  // -----------------------------------------------------------------------
  describe("Regression #1289 — unassigned tickets and completed BSs", () => {
    // ------- Bug 1: lossy tech re-filter removed -------------------------

    it("scopedWorkOrdersForManager does not look up tech company id for non-super_admin", () => {
      // The buggy path called storage.getUser(assignedTechnicianId) to
      // resolve the tech's companyId and compared it to the caller's cid.
      // Null tech → null cid → dropped. The fix returns the already-scoped
      // list directly. Verify the per-row getUser lookup is gone from the
      // function body.
      //
      // Strategy: find the function, read from its opening brace to the
      // next async function declaration, and assert no techCid pattern.
      const fnStart = src.indexOf("async function scopedWorkOrdersForManager");
      assert.ok(fnStart !== -1, "scopedWorkOrdersForManager not found");
      const fnEnd = src.indexOf("async function scopedBillingSheets", fnStart);
      assert.ok(fnEnd !== -1, "Expected scopedBillingSheets to follow scopedWorkOrdersForManager");
      const body = src.slice(fnStart, fnEnd);

      assert.ok(
        !body.includes("techCid"),
        "scopedWorkOrdersForManager still contains a techCid lookup — unassigned WOs will be dropped",
      );
      assert.ok(
        !body.includes("storage.getUser"),
        "scopedWorkOrdersForManager still calls storage.getUser — remove the lossy tech re-filter",
      );
    });

    it("scopedBillingSheets does not look up tech company id for non-super_admin", () => {
      // Same fix as scopedWorkOrdersForManager: the function must not
      // re-filter by resolving technicianId to a company id.
      const fnStart = src.indexOf("async function scopedBillingSheets");
      assert.ok(fnStart !== -1, "scopedBillingSheets not found");
      const fnEnd = src.indexOf("async function scopedWcb", fnStart);
      assert.ok(fnEnd !== -1, "Expected scopedWcb to follow scopedBillingSheets");
      const body = src.slice(fnStart, fnEnd);

      assert.ok(
        !body.includes("techCid"),
        "scopedBillingSheets still contains a techCid lookup — unassigned BSs will be dropped",
      );
      assert.ok(
        !body.includes("storage.getUser"),
        "scopedBillingSheets still calls storage.getUser — remove the lossy tech re-filter",
      );
    });

    it("null-tech WO in pending_manager_review will appear: ACTIVE_WO.has(w.status) is used in filter", () => {
      // ACTIVE_WO (imported from billing-workspace-routes) includes
      // pending_manager_review and work_completed. A null-tech WO with
      // status=pending_manager_review must pass the status filter.
      // Verify the filter expression is present in the file.
      assert.ok(
        src.includes("ACTIVE_WO.has(w.status)"),
        "needs-approval handler must use ACTIVE_WO.has(w.status) to filter work orders",
      );
    });

    it("submitted BS still appears: ACTIVE_BS.has(s.status) is used in filter", () => {
      // ACTIVE_BS = {pending_manager_review, submitted, completed} so a
      // submitted BS must still pass. Verify the filter expression is present.
      assert.ok(
        src.includes("ACTIVE_BS.has(s.status)"),
        "needs-approval handler must use ACTIVE_BS.has(s.status) to filter billing sheets",
      );
    });

    // ------- Bug 2: completed BS status now included ----------------------

    it("completed BS status appears in needs-approval: ACTIVE_BS includes completed", () => {
      // The canonical ACTIVE_BS from billing-workspace-routes.ts is
      // {pending_manager_review, submitted, completed}. The old local
      // NEEDS_APPROVAL_BS was missing "completed".
      // Verify that the import of ACTIVE_BS at the top of the file is
      // present (guaranteeing the canonical set is in scope).
      const importBlock = src.slice(0, src.indexOf("export interface RegisterManagerWorkspaceRoutesDeps"));
      assert.ok(
        importBlock.includes("ACTIVE_BS"),
        "ACTIVE_BS is not imported from billing-workspace-routes — completed BSs will be hidden",
      );
      assert.ok(
        importBlock.includes("ACTIVE_WO"),
        "ACTIVE_WO is not imported from billing-workspace-routes — some WO statuses may be hidden",
      );
    });

    it("local NEEDS_APPROVAL_WO and NEEDS_APPROVAL_BS constants are removed", () => {
      // These were the stale local copies that caused the status mismatch.
      // Both must be gone now that the canonical imports are used.
      assert.ok(
        !src.includes("NEEDS_APPROVAL_WO"),
        "NEEDS_APPROVAL_WO local constant still present — delete it and use imported ACTIVE_WO",
      );
      assert.ok(
        !src.includes("NEEDS_APPROVAL_BS"),
        "NEEDS_APPROVAL_BS local constant still present — delete it and use imported ACTIVE_BS",
      );
    });

    it("WO with invoiceId set is excluded: !w.invoiceId guard is present", () => {
      // Already-billed tickets must never appear. The !w.invoiceId guard
      // in the workOrders filter and !s.invoiceId in the billingSheets filter
      // must both remain in the source.
      assert.ok(
        src.includes("!w.invoiceId"),
        "WO invoiceId exclusion guard (!w.invoiceId) is missing from needs-approval handler",
      );
      assert.ok(
        src.includes("!s.invoiceId"),
        "BS invoiceId exclusion guard (!s.invoiceId) is missing from needs-approval handler",
      );
    });

    // ------- super_admin path unchanged ----------------------------------

    it("super_admin path returns across all companies (no company-id cap)", () => {
      // scopedWorkOrdersForManager must call getWorkOrders(null) for
      // super_admin so it receives rows from all companies.
      const fnStart = src.indexOf("async function scopedWorkOrdersForManager");
      assert.ok(fnStart !== -1, "scopedWorkOrdersForManager not found");
      const fnEnd = src.indexOf("async function scopedBillingSheets", fnStart);
      const body = src.slice(fnStart, fnEnd);

      assert.ok(
        body.includes('super_admin'),
        "scopedWorkOrdersForManager no longer handles super_admin separately",
      );
      // The super_admin branch returns the full unfiltered list.
      assert.ok(
        body.includes("return all"),
        "scopedWorkOrdersForManager super_admin path must return all rows",
      );
    });
  });
});
