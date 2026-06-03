/**
 * wet-check-approve-removed.test.ts — Task #1090
 *
 * Source-level assertions verifying that the /api/wet-checks/:id/approve
 * endpoint no longer performs any storage writes and that the approveWetCheck
 * storage method has been removed entirely.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const routesSrc = readFileSync(path.join(__dirname, "routes.ts"), "utf8");
const storageSrc = readFileSync(path.join(__dirname, "..", "storage.ts"), "utf8");

function nearby(src: string, anchor: string, window = 1500): string | null {
  const idx = src.indexOf(anchor);
  if (idx < 0) return null;
  return src.slice(Math.max(0, idx - 200), idx + window);
}

describe("WC /approve endpoint — removed (Task #1090)", () => {
  it("/api/wet-checks/:id/approve returns 404 and has no storage call", () => {
    const region = nearby(routesSrc, '"/api/wet-checks/:id/approve"', 1500);
    assert.ok(region, "approve route must still be declared (tombstone returning 404)");

    // The tombstone must return 404
    assert.ok(
      region.includes("404"),
      "approve route must return status 404",
    );

    // No storage calls allowed in the tombstone handler
    assert.ok(
      !region.includes("storage.approveWetCheck"),
      "approve route must not call storage.approveWetCheck",
    );
    assert.ok(
      !region.includes("db.transaction"),
      "approve route tombstone must not open a db.transaction",
    );
  });

  it("storage.approveWetCheck is not defined in storage.ts interface", () => {
    // The method should be fully gone — not just from the implementation,
    // but from the IStorage interface too.
    assert.ok(
      !storageSrc.includes("approveWetCheck("),
      "approveWetCheck must be removed from the IStorage interface and implementation",
    );
  });

  it("wet_checks status='approved' is not written by routeWetCheckFinding", () => {
    const region = nearby(storageSrc, "routeWetCheckFinding(", 3000);
    assert.ok(region);
    // After the gate change, routing is only permitted for submitted and
    // partially_converted — never for approved.
    assert.ok(
      !region.includes('"approved"'),
      "routeWetCheckFinding must not reference 'approved' status after Task #1090",
    );
  });

  it("convertWetCheckToWetCheckBilling does not write approvedBy/approvedByName/approvedAt", () => {
    const region = nearby(storageSrc, "convertWetCheckToWetCheckBilling(", 4000);
    assert.ok(region);
    // The convert path no longer stamps the now-retired approved-by fields.
    const writeBlock = nearby(region, "tx.update(wetChecks).set(", 600);
    if (writeBlock) {
      assert.ok(
        !writeBlock.includes("approvedBy:"),
        "convert must not write approvedBy",
      );
      assert.ok(
        !writeBlock.includes("approvedByName:"),
        "convert must not write approvedByName",
      );
    }
  });

  it("pending-review query does not include approved in status filter", () => {
    // The pending-review queue should only include submitted and
    // partially_converted — not approved (which no longer exists as a
    // reachable status).
    const region = nearby(storageSrc, "getPendingReviewWetChecks", 1500);
    if (!region) return; // method name may differ — skip gracefully
    assert.ok(
      !region.includes('"approved"'),
      "getPendingReviewWetChecks must not include 'approved' in the status filter",
    );
  });
});
