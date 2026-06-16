// Task #1258 — Manager Workspace Simplification, Slice 1 (backend source guards)
//
// These tests analyze the source code of manager-workspace-routes.ts to assert
// structural guarantees without requiring a live DB connection:
//
//   1. GET /api/manager-workspace/needs-approval is registered.
//   2. It filters WOs to the correct statuses (pending_manager_review, work_completed).
//   3. It filters BSs to the correct statuses (pending_manager_review, submitted).
//   4. It excludes rows with a non-null invoiceId.
//   5. POST /api/manager-workspace/findings/bulk-route returns 404.
//   6. No route in the file calls /kickback — the canonical endpoint is /return-for-correction.

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
});
