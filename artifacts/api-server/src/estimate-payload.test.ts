// Helper-level unit tests for the labor-rate resolution helpers used by
// POST/PUT /api/estimates. The end-to-end route behavior is covered by
// artifacts/api-server/src/routes/estimate-routes.test.ts — these tests
// pin down the building-block contract those routes depend on.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_LABOR_RATE,
  resolveCreateLaborRate,
  resolvePutLaborRate,
} from "./estimate-payload";

describe("resolveCreateLaborRate", () => {
  it("returns the customer rate when present", () => {
    assert.equal(resolveCreateLaborRate("85.00"), "85.00");
    assert.equal(resolveCreateLaborRate(70), "70");
  });

  it("falls back to DEFAULT_LABOR_RATE (45.00) for null / undefined / empty rate", () => {
    assert.equal(DEFAULT_LABOR_RATE, "45.00");
    assert.equal(resolveCreateLaborRate(null), "45.00");
    assert.equal(resolveCreateLaborRate(undefined), "45.00");
    assert.equal(resolveCreateLaborRate(""), "45.00");
  });
});

describe("resolvePutLaborRate", () => {
  it("uses the new customer's master rate when the customer is swapped", () => {
    assert.equal(
      resolvePutLaborRate({
        customerChanged: true,
        newCustomerLaborRate: "120.00",
        existingAppliedLaborRate: "85.00",
        existingLaborRate: "85.00",
      }),
      "120.00",
    );
  });

  it("falls back to DEFAULT_LABOR_RATE when the swapped-in customer has no rate", () => {
    assert.equal(
      resolvePutLaborRate({
        customerChanged: true,
        newCustomerLaborRate: null,
        existingAppliedLaborRate: "85.00",
        existingLaborRate: "85.00",
      }),
      "45.00",
    );
  });

  it("prefers appliedLaborRate over laborRate when customer is unchanged (legacy snapshot wins)", () => {
    assert.equal(
      resolvePutLaborRate({
        customerChanged: false,
        existingAppliedLaborRate: "85.00",
        existingLaborRate: "60.00",
      }),
      "85.00",
    );
  });

  it("falls back to laborRate when appliedLaborRate snapshot is null", () => {
    assert.equal(
      resolvePutLaborRate({
        customerChanged: false,
        existingAppliedLaborRate: null,
        existingLaborRate: "60.00",
      }),
      "60.00",
    );
  });
});
