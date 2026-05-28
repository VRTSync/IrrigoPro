/**
 * qb-line-description.test.ts
 *
 * Unit tests for the QB line-description helpers.  Verifies that billing
 * numbers are never double-prefixed in the QuickBooks Description field.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildWoLineDescription,
  buildBsLineDescription,
  buildWcbLineDescription,
} from "../lib/qb-line-description.js";

describe("buildWoLineDescription", () => {
  it("starts with the bare work-order number — no WO- outer prefix", () => {
    const desc = buildWoLineDescription({
      workOrderNumber: "WO-2026-0042",
      projectName: "Spring Startup",
      totalHours: "3",
      appliedLaborRate: 80,
      partsAmount: 120.5,
    });
    assert.ok(
      desc.startsWith("WO-2026-0042"),
      `Expected description to start with "WO-2026-0042" but got: ${desc}`,
    );
    assert.doesNotMatch(
      desc,
      /^WO-WO-/,
      `Expected no double WO- prefix but got: ${desc}`,
    );
  });
});

describe("buildBsLineDescription", () => {
  it("starts with the bare billing-sheet number — no BS- outer prefix", () => {
    const desc = buildBsLineDescription({
      billingNumber: "BS-2026-0020",
      totalHours: "2.5",
      laborRate: "75",
      partsSubtotal: "60.00",
    });
    assert.ok(
      desc.startsWith("BS-2026-0020"),
      `Expected description to start with "BS-2026-0020" but got: ${desc}`,
    );
    assert.doesNotMatch(
      desc,
      /^BS-BS-/,
      `Expected no double BS- prefix but got: ${desc}`,
    );
  });
});

describe("buildWcbLineDescription", () => {
  it("starts with the bare WCB billing number — no WCB- outer prefix", () => {
    const desc = buildWcbLineDescription({
      billingNumber: "WC-2026-1042",
      totalHours: "4",
      appliedLaborRate: "85",
      laborRate: "80",
      partsSubtotal: "200.00",
    });
    assert.ok(
      desc.startsWith("WC-2026-1042"),
      `Expected description to start with "WC-2026-1042" but got: ${desc}`,
    );
    assert.doesNotMatch(
      desc,
      /^WCB-WC-/,
      `Expected no double WCB- prefix but got: ${desc}`,
    );
  });
});
