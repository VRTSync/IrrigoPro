// Task #688 — Financial Pulse Slice 2 regression tests.
//
// Covers (a) the role guard / scope-resolution logic shared by every
// /api/financial-pulse/* endpoint and (b) the KPI math helpers
// against deterministic fixture data. The math helpers are pure, so
// no Express / Postgres is needed — we exercise them directly.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseAsOfParam,
  parsePeriodParam,
  resolveFinancialPulseScope,
} from "./financial-pulse";
import {
  bucketMonthlyRevenue,
  computeAvgDaysToPay,
  computeBilled,
  computeCollected,
  computeGrossMargin,
  computeOutstandingAr,
  computeProjectedMonthEnd,
  computeRevenueMix,
  getMonthStarts,
  getMtdWindow,
  getPrevMonthWindow,
  getYtdWindow,
  pctDelta,
  type InvoiceLike,
  type UserLike,
} from "../financial-pulse-math";

describe("Task #688 — financial-pulse role guard", () => {
  it("denies field_tech", () => {
    const r = resolveFinancialPulseScope("field_tech", 1, undefined);
    assert.equal(r.status, 403);
  });
  it("denies irrigation_manager (pricing is allowed but financial pulse is not)", () => {
    const r = resolveFinancialPulseScope("irrigation_manager", 1, undefined);
    assert.equal(r.status, 403);
  });
  it("denies unauthenticated / unknown role", () => {
    assert.equal(
      resolveFinancialPulseScope(undefined, 1, undefined).status,
      403,
    );
    assert.equal(
      resolveFinancialPulseScope("guest", 1, undefined).status,
      403,
    );
  });
  it("allows company_admin scoped to caller company", () => {
    const r = resolveFinancialPulseScope("company_admin", 7, undefined);
    assert.equal(r.status, 200);
    assert.equal(r.companyId, 7);
  });
  it("allows billing_manager scoped to caller company", () => {
    const r = resolveFinancialPulseScope("billing_manager", 9, undefined);
    assert.equal(r.status, 200);
    assert.equal(r.companyId, 9);
  });
  it("denies company_admin / billing_manager without a company association", () => {
    assert.equal(
      resolveFinancialPulseScope("company_admin", null, undefined).status,
      403,
    );
    assert.equal(
      resolveFinancialPulseScope("billing_manager", null, undefined).status,
      403,
    );
  });
  it("super_admin defaults to global scope", () => {
    const r = resolveFinancialPulseScope("super_admin", 1, undefined);
    assert.equal(r.status, 200);
    assert.equal(r.companyId, null);
  });
  it("super_admin can scope via ?companyId", () => {
    const r = resolveFinancialPulseScope("super_admin", 1, "42");
    assert.equal(r.status, 200);
    assert.equal(r.companyId, 42);
  });
  it("super_admin rejects malformed companyId", () => {
    assert.equal(
      resolveFinancialPulseScope("super_admin", 1, "abc").status,
      400,
    );
    assert.equal(
      resolveFinancialPulseScope("super_admin", 1, "-3").status,
      400,
    );
  });
  it("non-super-admin cannot pivot to a different company via query param", () => {
    const r = resolveFinancialPulseScope("company_admin", 7, "99");
    assert.equal(r.status, 200);
    assert.equal(r.companyId, 7); // query param ignored
  });
});

const NOW = new Date(2026, 4, 15); // May 15, 2026

function inv(over: Partial<InvoiceLike> & { id: number }): InvoiceLike {
  return {
    id: over.id,
    customerId: over.customerId ?? 1,
    totalAmount: over.totalAmount ?? "100.00",
    partsSubtotal: over.partsSubtotal ?? null,
    laborSubtotal: over.laborSubtotal ?? null,
    status: over.status ?? "sent",
    createdAt: over.createdAt ?? NOW,
    paidAt: over.paidAt ?? null,
  };
}

describe("Task #688 — KPI math", () => {
  it("computeBilled excludes draft + cancelled and respects window", () => {
    const invoices = [
      inv({ id: 1, totalAmount: "1000", status: "sent", createdAt: new Date(2026, 4, 2) }),
      inv({ id: 2, totalAmount: "500", status: "paid", createdAt: new Date(2026, 4, 10) }),
      inv({ id: 3, totalAmount: "999", status: "draft", createdAt: new Date(2026, 4, 11) }),
      inv({ id: 4, totalAmount: "777", status: "cancelled", createdAt: new Date(2026, 4, 12) }),
      inv({ id: 5, totalAmount: "9999", status: "sent", createdAt: new Date(2026, 3, 28) }),
    ];
    const win = getMtdWindow(NOW);
    assert.equal(computeBilled(invoices, win.start, win.end), 1500);
  });

  it("computeCollected sums by paidAt window", () => {
    const invoices = [
      inv({ id: 1, totalAmount: "200", paidAt: new Date(2026, 4, 3) }),
      inv({ id: 2, totalAmount: "300", paidAt: new Date(2026, 4, 4) }),
      inv({ id: 3, totalAmount: "999", paidAt: new Date(2026, 3, 25) }),
      inv({ id: 4, totalAmount: "100" }), // unpaid
    ];
    const win = getMtdWindow(NOW);
    assert.equal(computeCollected(invoices, win.start, win.end), 500);
  });

  // Task #720 — reconciliation contract: Collected MTD must exclude
  // draft and cancelled even when paidAt is inside the window, so the
  // tile cannot be inflated by a stale-status data bug. Matches the
  // canonical rule in docs/financial-metrics.md.
  it("computeCollected excludes draft and cancelled even with paidAt in window", () => {
    const invoices = [
      inv({ id: 1, totalAmount: "200", status: "paid", paidAt: new Date(2026, 4, 3) }),
      inv({ id: 2, totalAmount: "999", status: "draft", paidAt: new Date(2026, 4, 4) }),
      inv({ id: 3, totalAmount: "777", status: "cancelled", paidAt: new Date(2026, 4, 5) }),
      inv({ id: 4, totalAmount: "300", status: "partial", paidAt: new Date(2026, 4, 6) }),
    ];
    const win = getMtdWindow(NOW);
    assert.equal(computeCollected(invoices, win.start, win.end), 500);
  });

  // Task #720 — Billed MTD, Collected MTD, and Outstanding A/R on
  // Financial Pulse and on the Billing Workspace billing-header
  // widget MUST come from the same helpers + the same endpoint.
  // This test pins that contract on the math side: given a single
  // fixture, the three numbers agree with the per-doc formulas.
  it("Financial Pulse and Billing Workspace agree on shared KPIs (reconciliation)", () => {
    const invoices = [
      inv({ id: 1, totalAmount: "1000", status: "sent", createdAt: new Date(2026, 4, 2) }),
      inv({ id: 2, totalAmount: "500", status: "paid", createdAt: new Date(2026, 4, 5), paidAt: new Date(2026, 4, 10) }),
      inv({ id: 3, totalAmount: "300", status: "overdue", createdAt: new Date(2026, 4, 6) }),
      inv({ id: 4, totalAmount: "999", status: "draft", createdAt: new Date(2026, 4, 8) }),
      inv({ id: 5, totalAmount: "777", status: "cancelled", createdAt: new Date(2026, 4, 9) }),
    ];
    const win = getMtdWindow(NOW);
    const billed = computeBilled(invoices, win.start, win.end);
    const collected = computeCollected(invoices, win.start, win.end);
    const ar = computeOutstandingAr(invoices);
    // Billed = 1000 + 500 + 300 = 1800 (draft + cancelled excluded).
    assert.equal(billed, 1800);
    // Collected = 500 (only the paid row with paidAt in window).
    assert.equal(collected, 500);
    // A/R = 1000 (sent) + 300 (overdue) = 1300 (paid excluded by paidAt
    // null check, draft and cancelled excluded by status).
    assert.equal(ar, 1300);
    // The widget's fallback derivation (billed − A/R) only matches when
    // every billed row that wasn't collected is still in A/R AND no
    // collected dollars come from prior-period invoices. That's why
    // the widget now prefers the server's authoritative collectedMtd
    // value: in this fixture, billed − A/R = 500 by coincidence, but
    // the contract is "use the server number when present".
    assert.equal(billed - ar, 500);
  });

  it("computeOutstandingAr sums unpaid non-draft/non-cancelled invoices", () => {
    const invoices = [
      inv({ id: 1, totalAmount: "1000", status: "sent" }),
      inv({ id: 2, totalAmount: "500", status: "overdue" }),
      inv({ id: 3, totalAmount: "300", status: "paid", paidAt: NOW }),
      inv({ id: 4, totalAmount: "999", status: "draft" }),
      inv({ id: 5, totalAmount: "777", status: "cancelled" }),
    ];
    assert.equal(computeOutstandingAr(invoices), 1500);
  });

  it("computeAvgDaysToPay averages paidAt - createdAt over last 90 days", () => {
    const invoices = [
      inv({
        id: 1,
        totalAmount: "100",
        createdAt: new Date(2026, 3, 1),
        paidAt: new Date(2026, 3, 11),
      }), // 10 days
      inv({
        id: 2,
        totalAmount: "100",
        createdAt: new Date(2026, 3, 5),
        paidAt: new Date(2026, 3, 25),
      }), // 20 days
      inv({
        id: 3,
        totalAmount: "100",
        createdAt: new Date(2025, 0, 1),
        paidAt: new Date(2025, 0, 30),
      }), // outside 90d
    ];
    const avg = computeAvgDaysToPay(invoices, NOW);
    assert.ok(avg != null);
    assert.equal(Math.round((avg as number) * 10) / 10, 15);
  });

  it("computeProjectedMonthEnd extrapolates by days elapsed", () => {
    // May has 31 days; day 15 -> projection = billed/15*31.
    const proj = computeProjectedMonthEnd(1500, NOW);
    assert.equal(Math.round(proj), Math.round((1500 / 15) * 31));
  });

  it("pctDelta returns null when prev is zero", () => {
    assert.equal(pctDelta(100, 0), null);
    assert.equal(pctDelta(120, 100), 20);
  });

  it("getMonthStarts returns N ascending first-of-month dates ending current", () => {
    const starts = getMonthStarts(NOW, 13);
    assert.equal(starts.length, 13);
    assert.equal(starts[12].getFullYear(), 2026);
    assert.equal(starts[12].getMonth(), 4);
    assert.equal(starts[0].getFullYear(), 2025);
    assert.equal(starts[0].getMonth(), 4);
  });

  it("bucketMonthlyRevenue assigns to correct month and splits parts/labor", () => {
    const invoices = [
      inv({
        id: 1,
        totalAmount: "100",
        partsSubtotal: "30",
        laborSubtotal: "70",
        createdAt: new Date(2026, 4, 5),
      }),
      inv({
        id: 2,
        totalAmount: "200",
        partsSubtotal: "100",
        laborSubtotal: "100",
        createdAt: new Date(2026, 3, 5),
      }),
      inv({
        id: 3,
        totalAmount: "999",
        status: "draft",
        createdAt: new Date(2026, 4, 9),
      }),
    ];
    const starts = getMonthStarts(NOW, 13);
    const buckets = bucketMonthlyRevenue(invoices, starts);
    const may = buckets.find((b) => b.month === "2026-05");
    const apr = buckets.find((b) => b.month === "2026-04");
    assert.equal(may?.revenue, 100);
    assert.equal(may?.partsRevenue, 30);
    assert.equal(may?.laborRevenue, 70);
    assert.equal(apr?.revenue, 200);
  });
});

describe("Task #688 — gross margin fallback when techs lack hourlyWage", () => {
  const win = getMtdWindow(NOW);

  const invoices: InvoiceLike[] = [
    inv({
      id: 100,
      customerId: 1,
      totalAmount: "1000",
      partsSubtotal: "200",
      laborSubtotal: "800",
      status: "paid",
      createdAt: new Date(2026, 4, 3),
    }),
  ];

  const usersById = new Map<number, UserLike>([
    [10, { id: 10, hourlyWage: "50.00" }],
    [11, { id: 11, hourlyWage: null }],
  ]);

  it("uses tech.hourlyWage when present", () => {
    const r = computeGrossMargin({
      invoices,
      workOrders: [
        {
          invoiceId: 100,
          totalHours: "10",
          totalPartsCost: "100",
          assignedTechnicianId: 10,
        },
      ],
      billingSheets: [],
      usersById,
      fallbackHourlyWage: 25,
      window: win,
    });
    // revenue 1000, partsCost 100, laborCost 10*50 = 500 -> margin 40%
    assert.equal(r.revenue, 1000);
    assert.equal(r.partsCost, 100);
    assert.equal(r.laborCost, 500);
    assert.equal(Math.round(r.pct ?? 0), 40);
    assert.equal(r.missingWageTechCount, 0);
  });

  it("falls back when a tech has no hourlyWage and reports missingWageTechCount", () => {
    const r = computeGrossMargin({
      invoices,
      workOrders: [
        {
          invoiceId: 100,
          totalHours: "10",
          totalPartsCost: "100",
          assignedTechnicianId: 11, // no wage
        },
      ],
      billingSheets: [],
      usersById,
      fallbackHourlyWage: 25,
      window: win,
    });
    // labor: 10 * 25 = 250 (fallback). margin = (1000-100-250)/1000 = 65%
    assert.equal(r.laborCost, 250);
    assert.equal(Math.round(r.pct ?? 0), 65);
    assert.equal(r.missingWageTechCount, 1);
  });

  it("blended margin pulls from both work orders and billing sheets", () => {
    const r = computeGrossMargin({
      invoices,
      workOrders: [
        {
          invoiceId: 100,
          totalHours: "4",
          totalPartsCost: "60",
          assignedTechnicianId: 10,
        },
      ],
      billingSheets: [
        { invoiceId: 100, totalHours: "6", partsSubtotal: "40", technicianId: 11 },
      ],
      usersById,
      fallbackHourlyWage: 25,
      window: win,
    });
    // partsCost = 60 + 40 = 100; laborCost = 4*50 + 6*25 = 200 + 150 = 350
    // margin = (1000 - 100 - 350)/1000 = 55%
    assert.equal(r.partsCost, 100);
    assert.equal(r.laborCost, 350);
    assert.equal(Math.round(r.pct ?? 0), 55);
    assert.equal(r.missingWageTechCount, 1);
  });

  it("returns null margin when there is no revenue in the window", () => {
    const r = computeGrossMargin({
      invoices: [],
      workOrders: [],
      billingSheets: [],
      usersById,
      fallbackHourlyWage: 25,
      window: win,
    });
    assert.equal(r.pct, null);
  });
});

describe("Task #688 — revenue mix", () => {
  it("splits emergency vs standard by per-item laborRate vs customer emergencyLaborRate", () => {
    const win = getMtdWindow(NOW);
    const invoices: InvoiceLike[] = [
      inv({
        id: 1,
        customerId: 1,
        totalAmount: "300",
        partsSubtotal: "100",
        laborSubtotal: "200",
        status: "sent",
        createdAt: new Date(2026, 4, 3),
      }),
    ];
    const customersById = new Map([
      [
        1,
        {
          id: 1,
          companyId: 1,
          contractType: "premium",
          emergencyLaborRate: "125.00",
        },
      ],
    ]);
    const items = [
      // Emergency labor line: laborRate matches customer.emergencyLaborRate
      { invoiceId: 1, laborRate: "125.00", laborTotal: "150", totalPrice: "0" },
      // Standard labor line
      { invoiceId: 1, laborRate: "45.00", laborTotal: "50", totalPrice: "0" },
      // Standard parts line
      { invoiceId: 1, laborRate: "0", laborTotal: "0", totalPrice: "100" },
    ];
    const mix = computeRevenueMix({
      invoices,
      items,
      customersById,
      window: win,
    });
    assert.deepEqual(mix.partsVsLabor, { parts: 100, labor: 200 });
    assert.deepEqual(mix.emergencyVsStandard, {
      emergency: 150,
      standard: 150,
    });
    // contractType "premium" -> contract bucket
    assert.deepEqual(mix.contractVsAdhoc, { contract: 300, adhoc: 0 });
  });
});

// Sanity: yet-to-be-used helper exports stay importable.
void getPrevMonthWindow;
void getYtdWindow;

describe("Task #688 — parsePeriodParam", () => {
  it("defaults to 'mtd' when absent or empty", () => {
    const a = parsePeriodParam(undefined);
    const b = parsePeriodParam("");
    assert.equal(a.ok && a.value, "mtd");
    assert.equal(b.ok && b.value, "mtd");
  });
  it("accepts 'mtd' and 'ytd'", () => {
    const a = parsePeriodParam("mtd");
    const b = parsePeriodParam("ytd");
    assert.equal(a.ok && a.value, "mtd");
    assert.equal(b.ok && b.value, "ytd");
  });
  it("rejects anything else with ok:false", () => {
    for (const bad of ["MTD", "qtd", "yesterday", "1", " mtd"]) {
      const r = parsePeriodParam(bad);
      assert.equal(r.ok, false, `expected ${bad} to be rejected`);
    }
  });
});

describe("Task #688 — parseAsOfParam", () => {
  it("accepts absent and well-formed YYYY-MM-DD", () => {
    assert.equal(parseAsOfParam(undefined).ok, true);
    assert.equal(parseAsOfParam("").ok, true);
    assert.equal(parseAsOfParam("2026-05-19").ok, true);
  });
  it("rejects malformed values", () => {
    for (const bad of ["not-a-date", "2026/05/19", "2026-13-01", "05-19-2026"]) {
      assert.equal(parseAsOfParam(bad).ok, false, `expected ${bad} rejected`);
    }
  });
});

describe("Task #688 — MTD/YTD windows are to-date, not full period", () => {
  it("getMtdWindow ends just after `now`, not at next month", () => {
    const now = new Date(2026, 4, 19, 10, 30, 0); // May 19 2026, 10:30
    const w = getMtdWindow(now);
    assert.deepEqual(
      [w.start.getFullYear(), w.start.getMonth(), w.start.getDate()],
      [2026, 4, 1],
    );
    // end - 1ms === now
    assert.equal(w.end.getTime() - 1, now.getTime());
    // A future-dated invoice (later today, even same calendar day) IS
    // covered; one tomorrow is NOT.
    const tomorrow = new Date(2026, 4, 20, 0, 0, 0);
    assert.ok(tomorrow >= w.end);
  });

  it("getYtdWindow ends just after `now`, not at next year", () => {
    const now = new Date(2026, 4, 19, 10, 30, 0);
    const w = getYtdWindow(now);
    assert.deepEqual(
      [w.start.getFullYear(), w.start.getMonth(), w.start.getDate()],
      [2026, 0, 1],
    );
    assert.equal(w.end.getTime() - 1, now.getTime());
    const nextYear = new Date(2027, 0, 1);
    assert.ok(nextYear >= w.end);
  });

  it("future-dated invoices do not bleed into MTD/YTD", () => {
    const now = new Date(2026, 4, 19, 10, 0, 0);
    const future = new Date(2026, 4, 25); // later in May, still future
    const invoices: InvoiceLike[] = [
      {
        id: 1,
        customerId: 1,
        totalAmount: "100",
        status: "sent",
        createdAt: future,
        paidAt: null,
      },
    ];
    const w = getMtdWindow(now);
    assert.equal(computeBilled(invoices, w.start, w.end), 0);
  });
});

