// Task #1425 — unit tests for the pure merge validation + totals helpers.
// No DB required: these cover every rejection rule and the summing logic.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  validateMerge,
  computeMergedTotals,
  InvoiceMergeError,
  type MergeCandidate,
} from "./invoice-merge";

function inv(overrides: Partial<MergeCandidate> = {}): MergeCandidate {
  return {
    id: 1,
    invoiceNumber: "INV-1",
    customerId: 100,
    companyId: 1,
    invoiceMonth: 6,
    invoiceYear: 2026,
    status: "draft",
    partsSubtotal: "0.00",
    laborSubtotal: "0.00",
    totalAmount: "0.00",
    ...overrides,
  };
}

describe("computeMergedTotals", () => {
  it("sums parts, labor, and total across all participants", () => {
    const totals = computeMergedTotals([
      inv({ partsSubtotal: "100.50", laborSubtotal: "200.00", totalAmount: "300.50" }),
      inv({ partsSubtotal: "10.25", laborSubtotal: "5.75", totalAmount: "16.00" }),
      inv({ partsSubtotal: "0.00", laborSubtotal: "0.00", totalAmount: "0.00" }),
    ]);
    assert.equal(totals.partsSubtotal, "110.75");
    assert.equal(totals.laborSubtotal, "205.75");
    assert.equal(totals.totalAmount, "316.50");
  });

  it("treats null subtotals as zero", () => {
    const totals = computeMergedTotals([
      inv({ partsSubtotal: null, laborSubtotal: null, totalAmount: "50.00" }),
      inv({ partsSubtotal: "25.00", laborSubtotal: null, totalAmount: "25.00" }),
    ]);
    assert.equal(totals.partsSubtotal, "25.00");
    assert.equal(totals.laborSubtotal, "0.00");
    assert.equal(totals.totalAmount, "75.00");
  });
});

describe("validateMerge", () => {
  it("accepts a valid same-customer same-period set", () => {
    const a = inv({ id: 1, invoiceNumber: "INV-1" });
    const b = inv({ id: 2, invoiceNumber: "INV-2" });
    const result = validateMerge([a, b], 1, [2], 1);
    assert.equal(result.surviving.id, 1);
    assert.deepEqual(result.mergedIds, [2]);
    assert.deepEqual(result.allIds.sort(), [1, 2]);
  });

  it("rejects fewer than two distinct invoices", () => {
    const a = inv({ id: 1 });
    assert.throws(
      () => validateMerge([a], 1, [1], 1),
      (e: unknown) => e instanceof InvoiceMergeError && e.code === "too_few",
    );
  });

  it("rejects when a requested id is missing", () => {
    const a = inv({ id: 1 });
    assert.throws(
      () => validateMerge([a], 1, [2], 1),
      (e: unknown) =>
        e instanceof InvoiceMergeError &&
        e.code === "not_found" &&
        e.httpStatus === 404,
    );
  });

  it("rejects mixed customers", () => {
    const a = inv({ id: 1, customerId: 100 });
    const b = inv({ id: 2, customerId: 200 });
    assert.throws(
      () => validateMerge([a, b], 1, [2], 1),
      (e: unknown) => e instanceof InvoiceMergeError && e.code === "mixed_customer",
    );
  });

  it("rejects mixed billing periods (month)", () => {
    const a = inv({ id: 1, invoiceMonth: 6 });
    const b = inv({ id: 2, invoiceMonth: 7 });
    assert.throws(
      () => validateMerge([a, b], 1, [2], 1),
      (e: unknown) => e instanceof InvoiceMergeError && e.code === "mixed_period",
    );
  });

  it("rejects mixed billing periods (year)", () => {
    const a = inv({ id: 1, invoiceYear: 2026 });
    const b = inv({ id: 2, invoiceYear: 2025 });
    assert.throws(
      () => validateMerge([a, b], 1, [2], 1),
      (e: unknown) => e instanceof InvoiceMergeError && e.code === "mixed_period",
    );
  });

  it("rejects when any invoice is already cancelled", () => {
    const a = inv({ id: 1, status: "draft" });
    const b = inv({ id: 2, status: "cancelled" });
    assert.throws(
      () => validateMerge([a, b], 1, [2], 1),
      (e: unknown) =>
        e instanceof InvoiceMergeError && e.code === "contains_cancelled",
    );
  });

  it("rejects cross-company invoices for a company-bound caller", () => {
    const a = inv({ id: 1, companyId: 1 });
    const b = inv({ id: 2, companyId: 2 });
    assert.throws(
      () => validateMerge([a, b], 1, [2], 1),
      (e: unknown) =>
        e instanceof InvoiceMergeError &&
        e.code === "cross_company" &&
        e.httpStatus === 403,
    );
  });

  it("allows paid invoices to be merged", () => {
    const a = inv({ id: 1, status: "paid" });
    const b = inv({ id: 2, status: "paid" });
    const result = validateMerge([a, b], 1, [2], 1);
    assert.equal(result.merged.length, 1);
  });

  it("deduplicates repeated ids", () => {
    const a = inv({ id: 1 });
    const b = inv({ id: 2 });
    const result = validateMerge([a, b], 1, [2, 2, 1], 1);
    assert.deepEqual(result.mergedIds, [2]);
  });
});
