/**
 * Task #753 (Slice 4) — Unit tests for repairLaborHoursSchema validation.
 *
 * Covers:
 *   1. Rejects values that are not multiples of 0.25
 *   2. Rejects negative values
 *   3. Accepts valid boundary values (0, 0.25, 0.50, 2.00)
 *   4. Rejects non-numeric strings
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

// Mirror the schema defined in routes.ts (kept here as a pure unit so tests
// don't need to import the full Express app).
const repairLaborHoursSchema = z
  .string()
  .refine((s) => {
    const n = parseFloat(s);
    return Number.isFinite(n) && n >= 0;
  }, { message: "repairLaborHours must be a non-negative number" })
  .refine((s) => {
    const n = parseFloat(s);
    return Math.abs(Math.round(n * 4) - n * 4) < 0.0001;
  }, { message: "repairLaborHours must be a multiple of 0.25" });

function accepts(value: string): boolean {
  return repairLaborHoursSchema.safeParse(value).success;
}

function rejects(value: string): boolean {
  return !accepts(value);
}

describe("repairLaborHoursSchema", () => {
  // ── Valid values ───────────────────────────────────────────────────────────

  it('accepts "0"', () => {
    assert.ok(accepts("0"));
  });

  it('accepts "0.00"', () => {
    assert.ok(accepts("0.00"));
  });

  it('accepts "0.25"', () => {
    assert.ok(accepts("0.25"));
  });

  it('accepts "0.50"', () => {
    assert.ok(accepts("0.50"));
  });

  it('accepts "0.75"', () => {
    assert.ok(accepts("0.75"));
  });

  it('accepts "1.00"', () => {
    assert.ok(accepts("1.00"));
  });

  it('accepts "2.00"', () => {
    assert.ok(accepts("2.00"));
  });

  it('accepts "99.75"', () => {
    assert.ok(accepts("99.75"));
  });

  // ── Invalid: not a multiple of 0.25 ───────────────────────────────────────

  it('rejects "0.1"  (not a multiple of 0.25)', () => {
    assert.ok(rejects("0.1"));
  });

  it('rejects "0.33" (not a multiple of 0.25)', () => {
    assert.ok(rejects("0.33"));
  });

  it('rejects "0.5001" (not a multiple of 0.25)', () => {
    assert.ok(rejects("0.5001"));
  });

  it('rejects "1.1"  (not a multiple of 0.25)', () => {
    assert.ok(rejects("1.1"));
  });

  // ── Invalid: negative ─────────────────────────────────────────────────────

  it('rejects "-1"  (negative)', () => {
    assert.ok(rejects("-1"));
  });

  it('rejects "-0.25" (negative multiple)', () => {
    assert.ok(rejects("-0.25"));
  });

  // ── Invalid: non-numeric ──────────────────────────────────────────────────

  it('rejects ""  (empty string)', () => {
    assert.ok(rejects(""));
  });

  it('rejects "abc"', () => {
    assert.ok(rejects("abc"));
  });

  it('rejects "NaN"', () => {
    assert.ok(rejects("NaN"));
  });
});
