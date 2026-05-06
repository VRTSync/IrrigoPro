/**
 * Tests for Task #374 — Slice 10c list view UI behavior.
 *
 * Pins down the pure helpers behind the new Estimates list:
 *   - sort order per column (asc/desc; toggling re-clicks the same field)
 *   - clicking a different field resets the direction (date defaults to
 *     descending so newest sorts first; everything else defaults to asc)
 *   - the row actions menu only enables "Resend" for expired estimates.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  sortEstimates,
  nextSort,
  isResendEnabled,
} from "../client/src/components/estimates/list/estimate-list.helpers.ts";

const BASE = {
  id: 0,
  customerId: 1,
  customerName: "",
  customerEmail: "",
  customerPhone: "",
  projectName: "",
  projectAddress: "",
  locationNotes: "",
  accessInstructions: "",
  estimateNumber: "",
  status: "pending",
  internalStatus: "pending_approval",
  totalAmount: "0.00",
  partsSubtotal: "0.00",
  laborSubtotal: "0.00",
  laborRate: "75.00",
  estimateDate: new Date("2026-01-01").toISOString(),
  createdAt: new Date("2026-01-01").toISOString(),
  updatedAt: new Date("2026-01-01").toISOString(),
  photos: [],
  attachments: [],
  workLocationLat: null,
  workLocationLng: null,
  workLocationAddress: null,
  controllerLetter: null,
  zoneNumber: null,
  approvalToken: null,
  approvalSentAt: null,
  tokenExpiresAt: null,
  approvedAt: null,
  rejectedAt: null,
  createdBy: "",
  companyId: 99,
  customerSignature: null,
  rejectionReason: null,
  notes: null,
};

function mk(overrides) {
  return { ...BASE, ...overrides };
}

const ESTIMATES = [
  mk({ id: 1, customerName: "Charlie", totalAmount: "300.00",
       estimateDate: "2026-03-01T00:00:00.000Z", lifecycleStatus: "draft" }),
  mk({ id: 2, customerName: "Alpha", totalAmount: "100.00",
       estimateDate: "2026-01-15T00:00:00.000Z", lifecycleStatus: "sent" }),
  mk({ id: 3, customerName: "Bravo", totalAmount: "200.00",
       estimateDate: "2026-02-10T00:00:00.000Z", lifecycleStatus: "approved" }),
  mk({ id: 4, customerName: "Delta", totalAmount: "50.00",
       estimateDate: "2026-04-20T00:00:00.000Z", lifecycleStatus: "expired" }),
];

describe("EstimateList sorting (Slice 10c)", () => {
  test("sort by customer ascending → alphabetical by name", () => {
    const ids = sortEstimates(ESTIMATES, "customer", "asc").map((e) => e.id);
    assert.deepEqual(ids, [2, 3, 1, 4]); // Alpha, Bravo, Charlie, Delta
  });

  test("sort by customer descending → reverse alphabetical", () => {
    const ids = sortEstimates(ESTIMATES, "customer", "desc").map((e) => e.id);
    assert.deepEqual(ids, [4, 1, 3, 2]);
  });

  test("sort by amount ascending → smallest first", () => {
    const ids = sortEstimates(ESTIMATES, "amount", "asc").map((e) => e.id);
    assert.deepEqual(ids, [4, 2, 3, 1]); // 50, 100, 200, 300
  });

  test("sort by amount descending → largest first", () => {
    const ids = sortEstimates(ESTIMATES, "amount", "desc").map((e) => e.id);
    assert.deepEqual(ids, [1, 3, 2, 4]);
  });

  test("sort by date descending → newest first (default for date column)", () => {
    const ids = sortEstimates(ESTIMATES, "date", "desc").map((e) => e.id);
    assert.deepEqual(ids, [4, 1, 3, 2]);
  });

  test("sort by status uses lifecycle order, not alpha", () => {
    // LIFECYCLE_ORDER: draft(0) < pending_review(1) < sent(2) < approved(3)
    //                < rejected(4) < expired(5)
    const ids = sortEstimates(ESTIMATES, "status", "asc").map((e) => e.id);
    assert.deepEqual(ids, [1, 2, 3, 4]); // draft, sent, approved, expired
  });

  test("sort is pure: input array is not mutated", () => {
    const originalIds = ESTIMATES.map((e) => e.id);
    sortEstimates(ESTIMATES, "amount", "asc");
    assert.deepEqual(ESTIMATES.map((e) => e.id), originalIds);
  });
});

describe("EstimateList header click behavior", () => {
  test("clicking the same field flips direction asc → desc", () => {
    assert.deepEqual(
      nextSort({ field: "customer", dir: "asc" }, "customer"),
      { field: "customer", dir: "desc" },
    );
  });

  test("clicking the same field flips desc → asc", () => {
    assert.deepEqual(
      nextSort({ field: "amount", dir: "desc" }, "amount"),
      { field: "amount", dir: "asc" },
    );
  });

  test("clicking a different non-date field defaults to ascending", () => {
    assert.deepEqual(
      nextSort({ field: "date", dir: "desc" }, "customer"),
      { field: "customer", dir: "asc" },
    );
    assert.deepEqual(
      nextSort({ field: "customer", dir: "asc" }, "amount"),
      { field: "amount", dir: "asc" },
    );
  });

  test("clicking date from a different field defaults to descending", () => {
    assert.deepEqual(
      nextSort({ field: "customer", dir: "asc" }, "date"),
      { field: "date", dir: "desc" },
    );
  });
});

describe("EstimateList row actions — Resend gating", () => {
  test("Resend is enabled only when the estimate is expired", () => {
    assert.equal(isResendEnabled("expired"), true);
  });

  test("Resend stays disabled for every non-expired lifecycle bucket", () => {
    for (const lc of ["draft", "pending_review", "sent", "approved", "rejected"]) {
      assert.equal(
        isResendEnabled(lc),
        false,
        `Resend should be disabled for ${lc}`,
      );
    }
  });
});
