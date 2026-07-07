// Tests for financial-pulse-math.ts — superseded-invoice exclusion contract.
//
// The Task #1739 invariant: invoices with status="superseded" must never
// contribute to any financial rollup. This file is the regression guard for
// that contract across all major exported helpers.
//
// Run: node --import tsx --test --test-reporter=spec src/financial-pulse-math.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeBilled,
  computeCollected,
  computeOutstandingAr,
  computeArAging,
  computeTopCustomers,
  getMtdWindow,
  bucketMonthlyRevenue,
  getMonthStarts,
  type InvoiceLike,
} from "./financial-pulse-math";

// ── shared fixture helpers ────────────────────────────────────────────────────

function inv(
  over: Partial<InvoiceLike> & { id: number },
): InvoiceLike {
  return {
    customerId: 1,
    totalAmount: "100.00",
    status: "sent",
    createdAt: new Date("2026-07-01T10:00:00Z"),
    paidAt: null,
    ...over,
  };
}

const NOW = new Date("2026-07-07T12:00:00Z");
const { start: MTD_START, end: MTD_END } = getMtdWindow(NOW);

// ── computeBilled ─────────────────────────────────────────────────────────────

describe("computeBilled — superseded exclusion", () => {
  it("counts active sent invoice", () => {
    const result = computeBilled(
      [inv({ id: 1, status: "sent", createdAt: new Date("2026-07-03T00:00:00Z"), totalAmount: "200.00" })],
      MTD_START,
      MTD_END,
    );
    assert.equal(result, 200);
  });

  it("excludes superseded invoice", () => {
    const result = computeBilled(
      [inv({ id: 1, status: "superseded", createdAt: new Date("2026-07-03T00:00:00Z"), totalAmount: "200.00" })],
      MTD_START,
      MTD_END,
    );
    assert.equal(result, 0);
  });

  it("counts active but not superseded when both present", () => {
    const rows: InvoiceLike[] = [
      inv({ id: 1, status: "sent",       createdAt: new Date("2026-07-03T00:00:00Z"), totalAmount: "200.00" }),
      inv({ id: 2, status: "superseded", createdAt: new Date("2026-07-03T00:00:00Z"), totalAmount: "200.00" }),
    ];
    const result = computeBilled(rows, MTD_START, MTD_END);
    assert.equal(result, 200);
  });
});

// ── computeCollected ─────────────────────────────────────────────────────────

describe("computeCollected — superseded exclusion", () => {
  it("excludes superseded even when paidAt is set", () => {
    const result = computeCollected(
      [inv({ id: 1, status: "superseded", paidAt: new Date("2026-07-02T00:00:00Z"), totalAmount: "500.00" })],
      MTD_START,
      MTD_END,
    );
    assert.equal(result, 0);
  });

  it("counts paid invoice", () => {
    const result = computeCollected(
      [inv({ id: 1, status: "paid", paidAt: new Date("2026-07-02T00:00:00Z"), totalAmount: "500.00" })],
      MTD_START,
      MTD_END,
    );
    assert.equal(result, 500);
  });
});

// ── computeOutstandingAr ─────────────────────────────────────────────────────

describe("computeOutstandingAr — superseded exclusion", () => {
  it("excludes superseded invoice from AR", () => {
    const result = computeOutstandingAr([
      inv({ id: 1, status: "superseded", totalAmount: "300.00" }),
    ]);
    assert.equal(result, 0);
  });

  it("includes unpaid sent invoice in AR", () => {
    const result = computeOutstandingAr([
      inv({ id: 1, status: "sent", totalAmount: "300.00" }),
    ]);
    assert.equal(result, 300);
  });

  it("superseded and active mixed — only active counts", () => {
    const result = computeOutstandingAr([
      inv({ id: 1, status: "sent",       totalAmount: "300.00" }),
      inv({ id: 2, status: "superseded", totalAmount: "300.00" }),
    ]);
    assert.equal(result, 300);
  });
});

// ── computeArAging ───────────────────────────────────────────────────────────

describe("computeArAging — superseded exclusion", () => {
  it("superseded invoice contributes zero to all aging buckets", () => {
    const buckets = computeArAging(
      [inv({ id: 1, status: "superseded", createdAt: new Date("2026-06-01T00:00:00Z"), totalAmount: "400.00" })],
      NOW,
    );
    const total = buckets.reduce((s, b) => s + b.amount, 0);
    assert.equal(total, 0);
  });

  it("active overdue invoice lands in a positive bucket", () => {
    const createdAt = new Date("2026-05-01T00:00:00Z"); // ~67 days before NOW
    const buckets = computeArAging(
      [inv({ id: 1, status: "overdue", createdAt, totalAmount: "400.00" })],
      NOW,
    );
    const total = buckets.reduce((s, b) => s + b.amount, 0);
    assert.equal(total, 400);
  });
});

// ── bucketMonthlyRevenue ─────────────────────────────────────────────────────

describe("bucketMonthlyRevenue — superseded exclusion", () => {
  it("superseded invoice does not contribute to monthly bucket", () => {
    const months = getMonthStarts(NOW, 3);
    const buckets = bucketMonthlyRevenue(
      [inv({ id: 1, status: "superseded", createdAt: new Date("2026-07-01T00:00:00Z"), totalAmount: "999.00" })],
      months,
    );
    const total = buckets.reduce((s, b) => s + b.revenue, 0);
    assert.equal(total, 0);
  });

  it("active invoice contributes to monthly bucket", () => {
    const months = getMonthStarts(NOW, 3);
    const buckets = bucketMonthlyRevenue(
      [inv({ id: 1, status: "sent", createdAt: new Date("2026-07-03T00:00:00Z"), totalAmount: "999.00" })],
      months,
    );
    const total = buckets.reduce((s, b) => s + b.revenue, 0);
    assert.equal(total, 999);
  });
});

// ── computeTopCustomers — superseded exclusion ───────────────────────────────

describe("computeTopCustomers — superseded exclusion", () => {
  it("superseded invoice is not counted in customer revenue", () => {
    const customers = [{ id: 1, companyId: 10, contractType: null, emergencyLaborRate: null }];
    const window = { start: MTD_START, end: MTD_END };
    const result = computeTopCustomers({
      invoices: [inv({ id: 1, status: "superseded", customerId: 1, totalAmount: "1000.00" })],
      customers,
      window,
      now: NOW,
    });
    const row = result.find((r) => r.customerId === 1);
    assert.ok(
      row === undefined || row.revenue === 0,
      "superseded invoice must not count toward customer revenue",
    );
  });
});
