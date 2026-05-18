// Task #683 — windows + attention math tests for the Estimate Command
// Center summary. Exercises the pure computeEstimateSummary helper
// with hand-crafted estimate rows so the date math, lifecycle
// branches, and attention priority/cap are pinned.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { computeEstimateSummary } from "../../artifacts/api-server/src/estimate-summary";

const NOW = new Date("2026-05-18T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

function row(over: Partial<Parameters<typeof computeEstimateSummary>[0][number]> & { id: number }) {
  return {
    id: over.id,
    estimateNumber: `EST-${over.id}`,
    customerName: `Cust ${over.id}`,
    totalAmount: "1000",
    lifecycle: "pending_review",
    status: "pending_review",
    internalStatus: "submitted_for_review",
    createdAt: daysAgo(1),
    estimateDate: daysAgo(1),
    ...over,
  };
}

describe("computeEstimateSummary windows + attention", () => {
  it("counts sent estimates in (23d, 30d] as expiringNext7Days", () => {
    const rows = [
      row({ id: 1, lifecycle: "sent", estimateDate: daysAgo(20) }), // not yet
      row({ id: 2, lifecycle: "sent", estimateDate: daysAgo(25) }), // in window
      row({ id: 3, lifecycle: "sent", estimateDate: daysAgo(30) }), // boundary in
      row({ id: 4, lifecycle: "sent", estimateDate: daysAgo(31) }), // expired view
    ];
    const s = computeEstimateSummary(rows as any, NOW);
    assert.equal(s.windows.expiringNext7Days.count, 2);
    // Row 4 reclassified as expired by the read-time view.
    assert.equal(s.byLifecycle.expired.count, 1);
  });

  it("counts pending_review older than 3 days as stuckInReview", () => {
    const rows = [
      row({ id: 1, lifecycle: "pending_review", createdAt: daysAgo(2) }),
      row({ id: 2, lifecycle: "pending_review", createdAt: daysAgo(4) }),
      row({ id: 3, lifecycle: "pending_review", createdAt: daysAgo(10) }),
    ];
    const s = computeEstimateSummary(rows as any, NOW);
    assert.equal(s.windows.stuckInReviewOver3Days.count, 2);
    // Attention strip surfaces both stuck rows, prioritized by sinceDays desc.
    const stuck = s.attention.filter((a) => a.reason === "stuck_in_review");
    assert.equal(stuck.length, 2);
    assert.equal(stuck[0].estimateId, 3);
    assert.equal(stuck[1].estimateId, 2);
  });

  it("flags sent rows ≥ $5000 and ≥ 7 days old as high_value_silent", () => {
    const rows = [
      row({ id: 1, lifecycle: "sent", totalAmount: "6000", estimateDate: daysAgo(8) }),
      row({ id: 2, lifecycle: "sent", totalAmount: "6000", estimateDate: daysAgo(3) }), // too new
      row({ id: 3, lifecycle: "sent", totalAmount: "100", estimateDate: daysAgo(10) }), // too cheap
    ];
    const s = computeEstimateSummary(rows as any, NOW);
    const hv = s.attention.filter((a) => a.reason === "high_value_silent");
    assert.equal(hv.length, 1);
    assert.equal(hv[0].estimateId, 1);
  });

  it("computes winRate90d over approved/(approved+rejected+expired) within 90 days", () => {
    const rows = [
      row({ id: 1, lifecycle: "approved", estimateDate: daysAgo(10) }),
      row({ id: 2, lifecycle: "approved", estimateDate: daysAgo(50) }),
      row({ id: 3, lifecycle: "rejected", estimateDate: daysAgo(20) }),
      row({ id: 4, lifecycle: "sent", estimateDate: daysAgo(20) }), // ignored (still open, not expired)
      row({ id: 5, lifecycle: "approved", estimateDate: daysAgo(120) }), // outside 90d
    ];
    const s = computeEstimateSummary(rows as any, NOW);
    // 2 approved / 3 decided = 0.6666…
    assert.ok(Math.abs(s.winRate90d - 2 / 3) < 1e-9);
  });

  it("returns 0 win rate when nothing decided in 90 days", () => {
    const rows = [
      row({ id: 1, lifecycle: "sent", estimateDate: daysAgo(10) }),
      row({ id: 2, lifecycle: "pending_review", createdAt: daysAgo(1), estimateDate: daysAgo(1) }),
    ];
    const s = computeEstimateSummary(rows as any, NOW);
    assert.equal(s.winRate90d, 0);
  });

  it("sorts attention by priority (expiring_soon, stuck_in_review, high_value_silent) and caps at 8", () => {
    const rows = [
      // 3 stuck
      row({ id: 1, lifecycle: "pending_review", createdAt: daysAgo(10) }),
      row({ id: 2, lifecycle: "pending_review", createdAt: daysAgo(5) }),
      row({ id: 3, lifecycle: "pending_review", createdAt: daysAgo(20) }),
      // 2 expiring
      row({ id: 4, lifecycle: "sent", estimateDate: daysAgo(28) }),
      row({ id: 5, lifecycle: "sent", estimateDate: daysAgo(24) }),
      // 5 high-value-silent (only 3 should fit after the priority pair)
      row({ id: 6, lifecycle: "sent", totalAmount: "9000", estimateDate: daysAgo(15) }),
      row({ id: 7, lifecycle: "sent", totalAmount: "9000", estimateDate: daysAgo(14) }),
      row({ id: 8, lifecycle: "sent", totalAmount: "9000", estimateDate: daysAgo(13) }),
      row({ id: 9, lifecycle: "sent", totalAmount: "9000", estimateDate: daysAgo(12) }),
      row({ id: 10, lifecycle: "sent", totalAmount: "9000", estimateDate: daysAgo(11) }),
    ];
    const s = computeEstimateSummary(rows as any, NOW);
    assert.equal(s.attention.length, 8);
    // Priority ordering: expiring_soon entries first.
    assert.equal(s.attention[0].reason, "expiring_soon");
    assert.equal(s.attention[1].reason, "expiring_soon");
    assert.equal(s.attention[2].reason, "stuck_in_review");
    // Last bucket — high_value_silent fills the rest until the cap.
    const lastReason = s.attention[s.attention.length - 1].reason;
    assert.ok(lastReason === "high_value_silent" || lastReason === "stuck_in_review");
  });
});
