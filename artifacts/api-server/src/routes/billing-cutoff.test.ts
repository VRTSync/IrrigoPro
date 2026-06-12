/**
 * Billing cutoff selector tests (Task #1221)
 *
 * Verifies that computeUnbilledPartition, resolveAsOfCutoff, and
 * previousCalendarMonth behave correctly for the key scenarios that
 * drove the billing-agreement bug fix.
 *
 * These tests are pure-function: no DB, no Express, no side effects.
 * Uses node:test / node:assert — no vitest dependency required.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeUnbilledPartition,
  resolveAsOfCutoff,
  previousCalendarMonth,
} from '../billing-unbilled-selectors.js';
import type { WorkOrderLike, BillingSheetLike, WetCheckBillingLike } from '../billing-unbilled-selectors.js';

// ---------------------------------------------------------------------------
// Helpers — field names must match WorkOrderLike / BillingSheetLike / WetCheckBillingLike
// WOs use `completedAt`; BSs and WCBs use `workDate`.
// ---------------------------------------------------------------------------

let nextId = 1;

function wo(completedAt: string | null, amount: string): WorkOrderLike {
  return {
    id: nextId++,
    status: 'approved_passed_to_billing',
    completedAt,
    totalAmount: amount,
    invoiceId: null,
  };
}

function bs(workDate: string | null, amount: string): BillingSheetLike {
  return {
    id: nextId++,
    status: 'approved_passed_to_billing',
    workDate,
    totalAmount: amount,
    invoiceId: null,
  };
}

function wcb(workDate: string | null, amount: string): WetCheckBillingLike {
  return {
    id: nextId++,
    status: 'approved_passed_to_billing',
    workDate,
    totalAmount: amount,
    invoiceId: null,
  };
}

// ---------------------------------------------------------------------------
// Scenario 1 — basic cutoff inclusion / exclusion
// ---------------------------------------------------------------------------

describe('computeUnbilledPartition — cutoff boundary', () => {
  // Billing month = May 2025 → cutoff = 2025-05-31T23:59:59.999 local
  const cutoff = new Date(2025, 4, 31, 23, 59, 59, 999); // month 4 = May (0-based)

  it('includes a work order whose completedAt is before the cutoff', () => {
    const result = computeUnbilledPartition([wo('2025-05-15', '100.00')], [], [], cutoff);
    assert.equal(result.approvedWorkOrders.length, 1);
    assert.equal(result.approvedWorkOrders[0].undated, false);
  });

  it('includes a work order whose completedAt equals the cutoff day', () => {
    const result = computeUnbilledPartition([wo('2025-05-31', '200.00')], [], [], cutoff);
    assert.equal(result.approvedWorkOrders.length, 1);
  });

  it('excludes a work order whose completedAt is after the cutoff', () => {
    const result = computeUnbilledPartition([wo('2025-06-01', '300.00')], [], [], cutoff);
    assert.equal(result.approvedWorkOrders.length, 0);
  });

  it('always includes a work order with null completedAt and marks it undated', () => {
    const result = computeUnbilledPartition([wo(null, '50.00')], [], [], cutoff);
    assert.equal(result.approvedWorkOrders.length, 1);
    assert.equal(result.approvedWorkOrders[0].undated, true);
  });

  it('computes approvedTotal as sum of in-window approved records', () => {
    const wos: WorkOrderLike[] = [
      wo('2025-04-01', '100.00'),
      wo('2025-05-31', '200.00'),
      wo('2025-06-01', '999.00'), // excluded — after cutoff
    ];
    const result = computeUnbilledPartition(wos, [], [], cutoff);
    assert.equal(result.approvedWorkOrders.length, 2);
    assert(Math.abs(result.approvedTotal - 300) < 0.01, `expected ~300, got ${result.approvedTotal}`);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2 — null cutoff (all-open view)
// ---------------------------------------------------------------------------

describe('computeUnbilledPartition — null cutoff (all-open)', () => {
  it('includes every record regardless of date when cutoff is null', () => {
    const wos: WorkOrderLike[] = [
      wo('2020-01-01', '100.00'),
      wo('2030-12-31', '200.00'),
      wo(null, '50.00'),
    ];
    const result = computeUnbilledPartition(wos, [], [], null);
    assert.equal(result.approvedWorkOrders.length, 3);
    assert(Math.abs(result.approvedTotal - 350) < 0.01, `expected ~350, got ${result.approvedTotal}`);
  });

  it('sets allOpenTotal equal to total when cutoff is null', () => {
    const wos = [wo('2025-01-01', '42.00')];
    const result = computeUnbilledPartition(wos, [], [], null);
    assert.equal(result.allOpenTotal, result.total);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — mixed record types in the same partition call
// ---------------------------------------------------------------------------

describe('computeUnbilledPartition — mixed types', () => {
  const cutoff = new Date(2025, 2, 31, 23, 59, 59, 999); // end of March 2025

  it('partitions billing sheets and wet-check billings alongside work orders', () => {
    const result = computeUnbilledPartition(
      [wo('2025-03-15', '100.00'), wo('2025-04-01', '999.00')],
      [bs('2025-03-20', '200.00'), bs('2025-04-05', '888.00')],
      [wcb('2025-03-28', '50.00'), wcb(null, '25.00')],
      cutoff,
    );
    // WOs: 1 in-window, 1 excluded
    assert.equal(result.approvedWorkOrders.length, 1);
    // BSs: 1 in-window, 1 excluded
    assert.equal(result.approvedBillingSheets.length, 1);
    // WCBs: 1 dated-in + 1 undated = 2 included
    assert.equal(result.approvedWetCheckBillings.length, 2);
    // allOpenTotal covers all 6 records (no cutoff)
    assert(result.allOpenTotal > 0);
    assert(result.allOpenTotal > result.total, 'allOpenTotal should exceed cutoff-scoped total when records are excluded');
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — resolveAsOfCutoff
// ---------------------------------------------------------------------------

describe('resolveAsOfCutoff', () => {
  it('returns null for "all"', () => {
    assert.equal(resolveAsOfCutoff('all'), null);
  });

  it('returns null for empty string', () => {
    assert.equal(resolveAsOfCutoff(''), null);
  });

  it('returns null for invalid input', () => {
    assert.equal(resolveAsOfCutoff('not-a-month'), null);
  });

  it('returns end-of-month for a valid YYYY-MM string', () => {
    const cutoff = resolveAsOfCutoff('2025-05');
    assert.notEqual(cutoff, null);
    // Should be the last day of May 2025 at 23:59:59
    const c = cutoff!;
    assert.equal(c.getMonth(), 4); // 0-indexed: May = 4
    assert.equal(c.getDate(), 31);
    assert.equal(c.getHours(), 23);
    assert.equal(c.getMinutes(), 59);
  });

  it('handles month-end for February correctly', () => {
    const cutoff2024 = resolveAsOfCutoff('2024-02');
    assert.notEqual(cutoff2024, null);
    assert.equal(cutoff2024!.getDate(), 29); // 2024 is a leap year

    const cutoff2023 = resolveAsOfCutoff('2023-02');
    assert.notEqual(cutoff2023, null);
    assert.equal(cutoff2023!.getDate(), 28); // 2023 is not a leap year
  });
});

// ---------------------------------------------------------------------------
// Scenario 5 — previousCalendarMonth
// ---------------------------------------------------------------------------

describe('previousCalendarMonth', () => {
  it('returns a YYYY-MM string', () => {
    const result = previousCalendarMonth();
    assert.match(result, /^\d{4}-\d{2}$/);
  });

  it('is exactly one calendar month before the current month', () => {
    const result = previousCalendarMonth();
    const [y, m] = result.split('-').map(Number);
    const asDate = new Date(y, m - 1, 1);
    const oneMonthLater = new Date(asDate.getFullYear(), asDate.getMonth() + 1, 1);
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    assert.equal(oneMonthLater.getTime(), thisMonthStart.getTime());
  });
});

// ---------------------------------------------------------------------------
// Scenario 6 — preview/detail parity: approved total matches across both call sites
// ---------------------------------------------------------------------------

describe('preview/detail parity — approved total', () => {
  it('same inputs produce identical approvedTotal regardless of call order', () => {
    const cutoff = resolveAsOfCutoff('2025-05');
    const wos: WorkOrderLike[] = [
      { id: 200, status: 'approved_passed_to_billing', completedAt: '2025-05-10', totalAmount: '150.00', invoiceId: null },
      { id: 201, status: 'approved_passed_to_billing', completedAt: null, totalAmount: '75.50', invoiceId: null }, // undated — included
      { id: 202, status: 'approved_passed_to_billing', completedAt: '2025-06-01', totalAmount: '300.00', invoiceId: null }, // after cutoff — excluded
    ];
    const result1 = computeUnbilledPartition(wos, [], [], cutoff);
    const result2 = computeUnbilledPartition(wos, [], [], cutoff);
    assert.equal(result1.approvedTotal, result2.approvedTotal);
    assert.equal(result1.approvedTotal.toFixed(2), '225.50'); // 150 + 75.50; 300 excluded
    assert.equal(result1.approvedWorkOrders.length, 2);
    assert.equal(result1.pendingWorkOrders.length, 0);
  });

  it('pending-only customer has zero approved total but non-zero allOpenTotal', () => {
    const cutoff = resolveAsOfCutoff('2025-05');
    const wos: WorkOrderLike[] = [
      { id: 210, status: 'work_completed', completedAt: '2025-05-15', totalAmount: '200.00', invoiceId: null },
    ];
    const result = computeUnbilledPartition(wos, [], [], cutoff);
    assert.equal(result.approvedTotal, 0);
    assert.equal(result.allOpenTotal, 200);
    assert.equal(result.pendingWorkOrders.length, 1);
    assert.equal(result.approvedWorkOrders.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 7 — timezone edge case: record dated at end of month (local time)
// ---------------------------------------------------------------------------

describe('cutoff boundary — end-of-month records', () => {
  it('record dated exactly at end of month day is included', () => {
    // A record with completedAt = "2025-05-31" should be included under May cutoff.
    const cutoff = resolveAsOfCutoff('2025-05');
    const wos: WorkOrderLike[] = [
      { id: 300, status: 'approved_passed_to_billing', completedAt: '2025-05-31', totalAmount: '100.00', invoiceId: null },
    ];
    const result = computeUnbilledPartition(wos, [], [], cutoff);
    assert.equal(result.approvedWorkOrders.length, 1, 'last day of month should be included');
  });

  it('record dated the first day of the following month is excluded', () => {
    const cutoff = resolveAsOfCutoff('2025-05');
    const wos: WorkOrderLike[] = [
      { id: 301, status: 'approved_passed_to_billing', completedAt: '2025-06-01', totalAmount: '100.00', invoiceId: null },
    ];
    const result = computeUnbilledPartition(wos, [], [], cutoff);
    assert.equal(result.approvedWorkOrders.length, 0, 'first day of next month should be excluded');
  });

  it('null completedAt (undated) is always included and flagged', () => {
    const cutoff = resolveAsOfCutoff('2025-05');
    const wos: WorkOrderLike[] = [
      { id: 302, status: 'approved_passed_to_billing', completedAt: null, totalAmount: '50.00', invoiceId: null },
    ];
    const result = computeUnbilledPartition(wos, [], [], cutoff);
    assert.equal(result.approvedWorkOrders.length, 1);
    assert.equal(result.approvedWorkOrders[0].undated, true, 'null date should set undated flag');
  });

  it('default month (previousCalendarMonth) resolves to a valid cutoff', () => {
    const month = previousCalendarMonth();
    const cutoff = resolveAsOfCutoff(month);
    assert.notEqual(cutoff, null, 'previousCalendarMonth should always produce a valid cutoff');
    const now = new Date();
    assert.ok(cutoff! < now, 'cutoff for previous month must be in the past');
  });
});

// ---------------------------------------------------------------------------
// Scenario 8 — selector determinism and realistic Drizzle date shapes
//
// Drizzle returns different types depending on column kind:
//   - timestamp columns (e.g. completedAt)  → JS Date objects
//   - date columns      (e.g. workDate)      → "YYYY-MM-DD" strings
//
// These tests verify that computeUnbilledPartition is a pure, deterministic
// function — the same inputs always produce identical outputs regardless of
// call order.  They do NOT prove that the two HTTP endpoints agree; that is
// covered by customer-billing-parity.test.ts (HTTP-level integration test).
//   (a) Selector purity: same inputs → identical approvedTotal on repeated calls
//   (b) Date-object inputs work correctly alongside string-date inputs
//   (c) "YYYY-MM-DD" strings are parsed as local midnight (not UTC midnight)
//       so a May 31 date-string is not accidentally shifted to April 30
//       in UTC-offset-negative timezones.
// ---------------------------------------------------------------------------

describe('computeUnbilledPartition — selector determinism / purity with Drizzle date shapes', () => {
  it('Date-object completedAt (Drizzle timestamp) passes cutoff correctly', () => {
    // Drizzle returns Date objects for timestamp columns.
    // A Date at local noon on 2025-05-20 must be ≤ May cutoff.
    const cutoff = resolveAsOfCutoff('2025-05');
    const completedMid = new Date(2025, 4, 20, 12, 0, 0, 0); // local noon May 20
    const wos: WorkOrderLike[] = [
      { id: 400, status: 'approved_passed_to_billing', completedAt: completedMid, totalAmount: '500.00', invoiceId: null },
    ];
    const result = computeUnbilledPartition(wos, [], [], cutoff);
    assert.equal(result.approvedWorkOrders.length, 1, 'Date-object within month should be included');
    assert.equal(result.approvedTotal, 500);
  });

  it('Date-object completedAt one millisecond into June is excluded from May', () => {
    const cutoff = resolveAsOfCutoff('2025-05');
    // June 1 local midnight — must be outside May cutoff
    const june1 = new Date(2025, 5, 1, 0, 0, 0, 0);
    const wos: WorkOrderLike[] = [
      { id: 401, status: 'approved_passed_to_billing', completedAt: june1, totalAmount: '200.00', invoiceId: null },
    ];
    const result = computeUnbilledPartition(wos, [], [], cutoff);
    assert.equal(result.approvedWorkOrders.length, 0, 'June Date object must be excluded from May cutoff');
  });

  it('string workDate "YYYY-MM-DD" for last day of month is included (local-midnight fix)', () => {
    // Regression guard for the UTC-shift bug:
    // new Date("2025-05-31") in UTC = May 31 00:00 UTC.
    // In UTC-6 that is May 30 18:00 local — which would correctly pass a May
    // cutoff, BUT new Date("2025-06-01") in UTC = June 1 00:00 UTC = May 31 18:00
    // local, which would incorrectly PASS a May cutoff.
    // After the fix parseDate("2025-06-01") = local midnight June 1, excluded.
    const cutoff = resolveAsOfCutoff('2025-05');

    const bsMay31: BillingSheetLike[] = [
      { id: 402, status: 'approved_passed_to_billing', workDate: '2025-05-31', totalAmount: '111.00', invoiceId: null },
    ];
    const bsJune1: BillingSheetLike[] = [
      { id: 403, status: 'approved_passed_to_billing', workDate: '2025-06-01', totalAmount: '222.00', invoiceId: null },
    ];

    const resMay31 = computeUnbilledPartition([], bsMay31, [], cutoff);
    assert.equal(resMay31.approvedBillingSheets.length, 1, '"2025-05-31" must be included in May');

    const resJune1 = computeUnbilledPartition([], bsJune1, [], cutoff);
    assert.equal(resJune1.approvedBillingSheets.length, 0, '"2025-06-01" must be excluded from May');
  });

  it('mixed Date-object and string-date inputs produce consistent totals', () => {
    // Simulates a realistic payload where completedAt (timestamp) comes as a
    // Date object and workDate (date column) comes as a "YYYY-MM-DD" string.
    const cutoff = resolveAsOfCutoff('2025-05');
    const wos: WorkOrderLike[] = [
      // Date object (Drizzle timestamp) — within May
      { id: 410, status: 'approved_passed_to_billing', completedAt: new Date(2025, 4, 15), totalAmount: '300.00', invoiceId: null },
      // Date object — outside May (June)
      { id: 411, status: 'approved_passed_to_billing', completedAt: new Date(2025, 5, 2), totalAmount: '999.00', invoiceId: null },
    ];
    const bss: BillingSheetLike[] = [
      // String date (Drizzle date column) — within May
      { id: 412, status: 'approved_passed_to_billing', workDate: '2025-05-10', totalAmount: '200.00', invoiceId: null },
      // String date — outside May
      { id: 413, status: 'approved_passed_to_billing', workDate: '2025-06-05', totalAmount: '888.00', invoiceId: null },
    ];

    const result = computeUnbilledPartition(wos, bss, [], cutoff);
    // 300 (WO in May) + 200 (BS in May) = 500
    assert.equal(result.approvedTotal, 500, 'only records within billing month should sum');
    assert.equal(result.approvedWorkOrders.length, 1);
    assert.equal(result.approvedBillingSheets.length, 1);
  });

  it('calling computeUnbilledPartition twice with identical inputs returns equal approvedTotal (parity)', () => {
    // Simulates preview and detail routes calling the same selector with the
    // same DB rows — results must be deterministic / identical.
    const cutoff = resolveAsOfCutoff('2025-05');
    const wos: WorkOrderLike[] = [
      { id: 420, status: 'approved_passed_to_billing', completedAt: '2025-05-20', totalAmount: '150.00', invoiceId: null },
      { id: 421, status: 'work_completed',            completedAt: '2025-05-22', totalAmount: '75.00',  invoiceId: null },
    ];
    const bss: BillingSheetLike[] = [
      { id: 422, status: 'approved_passed_to_billing', workDate: '2025-05-01', totalAmount: '250.00', invoiceId: null },
    ];
    const preview = computeUnbilledPartition(wos, bss, [], cutoff);
    const detail  = computeUnbilledPartition(wos, bss, [], cutoff);

    assert.equal(preview.approvedTotal, detail.approvedTotal, 'preview/detail approvedTotal must match');
    assert.equal(preview.unapprovedTotal, detail.unapprovedTotal);
    assert.equal(preview.total, detail.total);
    assert.equal(preview.allOpenTotal, detail.allOpenTotal);
    assert.equal(preview.approvedWorkOrders.length, detail.approvedWorkOrders.length);
    assert.equal(preview.approvedBillingSheets.length, detail.approvedBillingSheets.length);
    assert.equal(preview.pendingWorkOrders.length, detail.pendingWorkOrders.length);
  });

  it('previousCalendarMonth default applied at route entry gives a cutoff in the past', () => {
    // Simulates both routes defaulting selectedMonth to previousCalendarMonth()
    // and each independently resolving the cutoff — must agree.
    const previewMonth = previousCalendarMonth();
    const detailMonth  = previousCalendarMonth();
    assert.equal(previewMonth, detailMonth, 'both routes must derive the same default month');
    const previewCutoff = resolveAsOfCutoff(previewMonth);
    const detailCutoff  = resolveAsOfCutoff(detailMonth);
    assert.notEqual(previewCutoff, null);
    assert.notEqual(detailCutoff,  null);
    assert.equal(
      previewCutoff!.getTime(),
      detailCutoff!.getTime(),
      'independently-resolved cutoffs for the same month must be identical',
    );
    assert.ok(previewCutoff! < new Date(), 'default cutoff must be in the past');
  });
});
