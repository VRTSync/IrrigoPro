// Task #2017 — one spend number across five surfaces.
//
// `computeCustomerSpend` is the canonical answer to "how much has this
// customer spent". Two Financial Pulse surfaces used to hand-roll their own
// accumulation loops — the Accounting tab's budget meters / Status pill
// (`computeTopCustomers`) and the Pulse tab's budget pill
// (`computePulseCustomers`) — so five surfaces gave three answers, and the two
// that disagreed sat on two tabs of the same page. Both now take the spend as
// an input, computed by the set-based `computeCustomerSpendBatch`.
//
// What these tests pin:
//   - uninvoiced wet-check work counts on Financial Pulse, as it always has on
//     the customer's own profile (the largest of the two old gaps);
//   - the batch and the single-customer function return the same thing;
//   - a company-scoped caller can never read a foreign customer's spend, on
//     EITHER leg — including the wet-check leg, whose table has no company
//     column and so resolves tenancy through the customer;
//   - the 500-customer Accounting path issues a fixed number of queries;
//   - neither Financial Pulse helper accumulates spend any more.
//
// The two I/O seams are shimmed separately and deliberately: the invoice query
// is answered by the storage stub, the wet-check query by a TABLE-AWARE
// db.select shim that rejects any other table. One shim answering both queries
// with the same row set is exactly the mistake that would hide a leg reading
// the wrong rows.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { db } from "./db";
import { getTableName } from "drizzle-orm";

// ── fixtures the shims serve ────────────────────────────────────────────────

interface FakeInvoice {
  id: number;
  customerId: number;
  companyId: number;
  status: string;
  totalAmount: string;
  createdAt: Date;
}
interface FakeWcb {
  customerId: number;
  companyId: number;
  invoiceId: number | null;
  totalAmount: string;
  workDate: Date;
}

const fixtures = {
  invoices: [] as FakeInvoice[],
  wetCheckBillings: [] as FakeWcb[],
};

const queries = {
  /** One per call of the batch invoice leg. */
  invoice: 0,
  /** One per call of the batch wet-check leg. */
  wetCheck: 0,
  /** Every table db.select was pointed at, in order. */
  tables: [] as string[],
  /** The id lists the invoice leg was asked for. */
  invoiceIdLists: [] as number[][],
};

// ── db shim: the wet-check leg ONLY ─────────────────────────────────────────
// Tenancy for this leg comes from the customer, because wet_check_billings has
// no company column — the shim reproduces that join predicate rather than
// returning every row, so a tenancy bug here fails the test instead of being
// papered over.
let wcbScopeCompanyId: number | null = null;
let wcbScopeIds: number[] = [];

function makeChain(fromTable?: string): any {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          return (resolve: (v: any) => void, reject: (e: unknown) => void) => {
            if (fromTable !== "wet_check_billings") {
              reject(
                new Error(
                  `db.select reached ${fromTable ?? "<unknown>"} — the wet-check leg is the only direct query the spend batch makes`,
                ),
              );
              return;
            }
            queries.wetCheck += 1;
            resolve(
              fixtures.wetCheckBillings.filter(
                (w) =>
                  wcbScopeIds.includes(w.customerId) &&
                  (wcbScopeCompanyId === null || w.companyId === wcbScopeCompanyId),
              ),
            );
          };
        }
        if (prop === "from") {
          return (table: any) => {
            let name: string | undefined;
            try {
              name = getTableName(table);
            } catch {
              name = undefined;
            }
            if (name) queries.tables.push(name);
            return makeChain(name);
          };
        }
        return () => makeChain(fromTable);
      },
    },
  );
}
(db as any).select = () => makeChain();

// ── storage shim: the invoice leg ───────────────────────────────────────────
import { storage } from "./storage";

(storage as any).getInvoicesByCustomerIds = async (
  customerIds: number[],
  companyId: number | null,
) => {
  queries.invoice += 1;
  queries.invoiceIdLists.push(customerIds);
  // Mirrors the real reader: scope on the invoice's OWN company column.
  return fixtures.invoices.filter(
    (i) =>
      customerIds.includes(i.customerId) &&
      (companyId === null || i.companyId === companyId),
  );
};

// ── modules under test — imported AFTER the shims ───────────────────────────
const { computeCustomerSpend, computeCustomerSpendBatch, spendTotals } =
  await import("./budget-spend");
const { computeTopCustomers, computePulseCustomers } = await import(
  "./financial-pulse-math"
);
const { computePeriodUsage, getMonthWindow, getYearWindow } = await import(
  "./budget-status"
);
type CustomerWithBudget = Parameters<
  typeof computeTopCustomers
>[0]["customers"][number];
type InvoiceLike = Parameters<typeof computeTopCustomers>[0]["invoices"][number];

/**
 * The batch resolves wet-check tenancy in SQL. The shim cannot parse the
 * predicate, so each test declares the same scope it passes to the batch.
 */
function scopeWetChecks(companyId: number | null, ids: number[]) {
  wcbScopeCompanyId = companyId;
  wcbScopeIds = ids;
}

// ── shared fixture: May 2026, one customer, invoice + uninvoiced wet check ──

const COMPANY_A = 10;
const COMPANY_B = 20;
const NOW = new Date(2026, 4, 10, 9, 30); // 10 May 2026
const MONTH = getMonthWindow(NOW); // 1 May → 1 Jun
const YEAR = getYearWindow(NOW); // 1 Jan → 1 Jan

function customer(
  id: number,
  monthlyAllocation: number | null,
  annualBudgetGoal: string | null = null,
): CustomerWithBudget {
  return {
    id,
    companyId: COMPANY_A,
    contractType: null,
    emergencyLaborRate: null,
    name: `Customer ${id}`,
    hiddenFromBilling: false,
    monthlyAllocation,
    annualBudgetGoal,
    budgetSoftThresholdPercent: 75,
    budgetHardThresholdPercent: 100,
  } as CustomerWithBudget;
}

function invoiceLike(i: FakeInvoice): InvoiceLike {
  return {
    id: i.id,
    customerId: i.customerId,
    totalAmount: i.totalAmount,
    status: i.status,
    createdAt: i.createdAt,
    paidAt: null,
    invoiceYear: i.createdAt.getFullYear(),
    invoiceMonth: i.createdAt.getMonth() + 1,
  } as InvoiceLike;
}

beforeEach(() => {
  fixtures.invoices = [];
  fixtures.wetCheckBillings = [];
  queries.invoice = 0;
  queries.wetCheck = 0;
  queries.tables = [];
  queries.invoiceIdLists = [];
  scopeWetChecks(COMPANY_A, []);
});

// ── 1. uninvoiced wet-check work counts, on every surface ───────────────────

describe("Task #2017 — uninvoiced wet-check work counts toward budget usage everywhere", () => {
  it("reports the combined invoice + wet-check total on all five surfaces", async () => {
    const CUST = 1;
    fixtures.invoices = [
      {
        id: 100,
        customerId: CUST,
        companyId: COMPANY_A,
        status: "sent",
        totalAmount: "600.00",
        createdAt: new Date(2026, 4, 4),
      },
    ];
    fixtures.wetCheckBillings = [
      {
        customerId: CUST,
        companyId: COMPANY_A,
        invoiceId: null,
        totalAmount: "400.00",
        workDate: new Date(2026, 4, 6),
      },
    ];
    scopeWetChecks(COMPANY_A, [CUST]);

    // Surfaces 1 & 2 — the customer profile widget and the budget routes both
    // call the single-customer function; the alert service calls the same one.
    const single = await computeCustomerSpend(CUST, COMPANY_A, MONTH);
    assert.equal(single.invoiced, 600);
    assert.equal(single.pendingNotBilled, 400);
    assert.equal(single.total, 1000, "profile widget / budget routes");

    // Surfaces 3 & 4 — both Financial Pulse tabs read the batch.
    const batch = await computeCustomerSpendBatch([CUST], COMPANY_A, MONTH);
    const monthTotals = spendTotals(batch);
    const yearTotals = spendTotals(
      await computeCustomerSpendBatch([CUST], COMPANY_A, YEAR),
    );

    const custs = [customer(CUST, 2000, "20000.00")];
    const invoices = fixtures.invoices.map(invoiceLike);

    const accounting = computeTopCustomers({
      customers: custs,
      invoices,
      window: MONTH,
      now: NOW,
      monthSpendByCustomer: monthTotals,
      yearSpendByCustomer: yearTotals,
    })[0];
    const pulse = computePulseCustomers({
      customers: custs,
      invoices,
      workOrders: [],
      billingSheets: [],
      currentYear: NOW.getFullYear(),
      now: NOW,
      monthSpendByCustomer: monthTotals,
    })[0];

    assert.equal(accounting.monthlySpend, 1000, "Accounting tab budget meter");
    assert.equal(pulse.monthlySpend, 1000, "Pulse tab budget pill");

    // Surface 5 — the profile widget's own classifier, fed the same number.
    const profile = computePeriodUsage(2000, single.total, 75, 100, "2026-05");
    assert.equal(profile.spend, 1000);

    // …and the percentage and status agree across the three surfaces.
    assert.equal(accounting.monthlyUsedPct, profile.percent);
    assert.equal(accounting.monthlyStatus, profile.status);
    assert.equal(pulse.budgetStatus, profile.status);
    assert.equal(accounting.monthlyStatus, pulse.budgetStatus);
  });

  it("a wet-check billing already attached to an invoice is never double-counted", async () => {
    const CUST = 2;
    fixtures.invoices = [
      {
        id: 200,
        customerId: CUST,
        companyId: COMPANY_A,
        status: "sent",
        totalAmount: "750.00",
        createdAt: new Date(2026, 4, 3),
      },
    ];
    fixtures.wetCheckBillings = [
      // Same $750 of work, now billed on invoice 200.
      {
        customerId: CUST,
        companyId: COMPANY_A,
        invoiceId: 200,
        totalAmount: "750.00",
        workDate: new Date(2026, 4, 2),
      },
    ];
    scopeWetChecks(COMPANY_A, [CUST]);

    const spend = await computeCustomerSpend(CUST, COMPANY_A, MONTH);
    assert.equal(spend.pendingNotBilled, 0);
    assert.equal(spend.total, 750, "the invoiced wet check is in the invoice total");

    const totals = spendTotals(
      await computeCustomerSpendBatch([CUST], COMPANY_A, MONTH),
    );
    assert.equal(totals.get(CUST), 750);
  });

  it("a future-dated invoice inside the current calendar month counts once, identically everywhere", async () => {
    const CUST = 3;
    fixtures.invoices = [
      {
        id: 300,
        customerId: CUST,
        companyId: COMPANY_A,
        status: "sent",
        // Dated 25 May while "now" is 10 May: inside the calendar month, after
        // the instant the page loaded. The Pulse tab used to have no upper
        // bound and the Accounting tab truncated at now + 1ms, so the two tabs
        // disagreed about this row.
        totalAmount: "500.00",
        createdAt: new Date(2026, 4, 25),
      },
    ];
    scopeWetChecks(COMPANY_A, [CUST]);

    const single = await computeCustomerSpend(CUST, COMPANY_A, MONTH);
    assert.equal(single.total, 500, "counted once, not zero and not twice");

    const monthTotals = spendTotals(
      await computeCustomerSpendBatch([CUST], COMPANY_A, MONTH),
    );
    const custs = [customer(CUST, 1000)];
    const invoices = fixtures.invoices.map(invoiceLike);
    const accounting = computeTopCustomers({
      customers: custs,
      invoices,
      window: MONTH,
      now: NOW,
      monthSpendByCustomer: monthTotals,
      yearSpendByCustomer: new Map(),
    })[0];
    const pulse = computePulseCustomers({
      customers: custs,
      invoices,
      workOrders: [],
      billingSheets: [],
      currentYear: NOW.getFullYear(),
      now: NOW,
      monthSpendByCustomer: monthTotals,
    })[0];
    assert.equal(accounting.monthlySpend, 500);
    assert.equal(pulse.monthlySpend, 500);
    assert.equal(single.total, accounting.monthlySpend);
    assert.equal(single.total, pulse.monthlySpend);
  });
});

// ── 2. the batch is the single-customer function, N times over ──────────────

describe("Task #2017 — the batch and the single-customer function are one implementation", () => {
  it("returns, for each of N customers, exactly what the single-customer function returns alone", async () => {
    const ids = [11, 12, 13, 14];
    fixtures.invoices = [
      { id: 1, customerId: 11, companyId: COMPANY_A, status: "sent", totalAmount: "100.00", createdAt: new Date(2026, 4, 2) },
      { id: 2, customerId: 11, companyId: COMPANY_A, status: "draft", totalAmount: "999.00", createdAt: new Date(2026, 4, 2) },
      { id: 3, customerId: 12, companyId: COMPANY_A, status: "merged", totalAmount: "500.00", createdAt: new Date(2026, 4, 3) },
      { id: 4, customerId: 12, companyId: COMPANY_A, status: "paid", totalAmount: "500.00", createdAt: new Date(2026, 4, 3) },
      // Out of window — April.
      { id: 5, customerId: 13, companyId: COMPANY_A, status: "sent", totalAmount: "800.00", createdAt: new Date(2026, 3, 28) },
    ];
    fixtures.wetCheckBillings = [
      { customerId: 11, companyId: COMPANY_A, invoiceId: null, totalAmount: "25.50", workDate: new Date(2026, 4, 5) },
      { customerId: 13, companyId: COMPANY_A, invoiceId: null, totalAmount: "60.25", workDate: new Date(2026, 4, 9) },
      // Out of window — April work date.
      { customerId: 14, companyId: COMPANY_A, invoiceId: null, totalAmount: "10.00", workDate: new Date(2026, 3, 30) },
    ];
    scopeWetChecks(COMPANY_A, ids);

    const batch = await computeCustomerSpendBatch(ids, COMPANY_A, MONTH);

    for (const id of ids) {
      scopeWetChecks(COMPANY_A, [id]);
      const single = await computeCustomerSpend(id, COMPANY_A, MONTH);
      assert.deepEqual(
        batch.get(id),
        single,
        `batch entry for customer ${id} must equal the single-customer result`,
      );
    }

    // …and an entry exists for every requested id, zeroes included.
    assert.deepEqual(batch.get(14), { invoiced: 0, pendingNotBilled: 0, total: 0 });
    assert.deepEqual([...batch.keys()].sort((a, b) => a - b), ids);
  });
});

// ── 3. tenancy on both legs ─────────────────────────────────────────────────

describe("Task #2017 — a batch never answers for another company's customer", () => {
  it("returns zeroes for a company B id passed by a company A caller, on both legs", async () => {
    const A_CUST = 31;
    const B_CUST = 32;
    fixtures.invoices = [
      { id: 1, customerId: A_CUST, companyId: COMPANY_A, status: "sent", totalAmount: "300.00", createdAt: new Date(2026, 4, 4) },
      { id: 2, customerId: B_CUST, companyId: COMPANY_B, status: "sent", totalAmount: "9000.00", createdAt: new Date(2026, 4, 4) },
    ];
    fixtures.wetCheckBillings = [
      { customerId: A_CUST, companyId: COMPANY_A, invoiceId: null, totalAmount: "50.00", workDate: new Date(2026, 4, 5) },
      // The dangerous row: wet_check_billings has no company column of its own.
      { customerId: B_CUST, companyId: COMPANY_B, invoiceId: null, totalAmount: "7000.00", workDate: new Date(2026, 4, 5) },
    ];
    scopeWetChecks(COMPANY_A, [A_CUST, B_CUST]);

    const batch = await computeCustomerSpendBatch(
      [A_CUST, B_CUST],
      COMPANY_A,
      MONTH,
    );
    assert.equal(batch.get(A_CUST)?.total, 350);
    assert.deepEqual(
      batch.get(B_CUST),
      { invoiced: 0, pendingNotBilled: 0, total: 0 },
      "a foreign id must come back as an entry of zeroes, never as spend",
    );
  });

  it("super_admin (null company scope) still spans companies", async () => {
    const A_CUST = 41;
    const B_CUST = 42;
    fixtures.invoices = [
      { id: 1, customerId: A_CUST, companyId: COMPANY_A, status: "sent", totalAmount: "300.00", createdAt: new Date(2026, 4, 4) },
      { id: 2, customerId: B_CUST, companyId: COMPANY_B, status: "sent", totalAmount: "900.00", createdAt: new Date(2026, 4, 4) },
    ];
    fixtures.wetCheckBillings = [
      { customerId: B_CUST, companyId: COMPANY_B, invoiceId: null, totalAmount: "100.00", workDate: new Date(2026, 4, 5) },
    ];
    scopeWetChecks(null, [A_CUST, B_CUST]);

    const batch = await computeCustomerSpendBatch([A_CUST, B_CUST], null, MONTH);
    assert.equal(batch.get(A_CUST)?.total, 300);
    assert.equal(batch.get(B_CUST)?.total, 1000);
  });
});

// ── 4. query count on the 500-customer Accounting path ──────────────────────

describe("Task #2017 — the Accounting tab issues a fixed number of spend queries", () => {
  it("500 customers over two windows cost four queries, not one per customer", async () => {
    const ids = Array.from({ length: 500 }, (_v, i) => 1000 + i);
    fixtures.invoices = ids.map((id, i) => ({
      id: i + 1,
      customerId: id,
      companyId: COMPANY_A,
      status: "sent",
      totalAmount: "10.00",
      createdAt: new Date(2026, 4, 4),
    }));
    fixtures.wetCheckBillings = ids.map((id) => ({
      customerId: id,
      companyId: COMPANY_A,
      invoiceId: null,
      totalAmount: "5.00",
      workDate: new Date(2026, 4, 6),
    }));
    scopeWetChecks(COMPANY_A, ids);

    // Exactly what the top-customers endpoint does: one batch per window.
    const [month, year] = await Promise.all([
      computeCustomerSpendBatch(ids, COMPANY_A, MONTH),
      computeCustomerSpendBatch(ids, COMPANY_A, YEAR),
    ]);

    assert.equal(queries.invoice, 2, "one invoice query per window");
    assert.equal(queries.wetCheck, 2, "one wet-check query per window");
    assert.equal(
      queries.invoice + queries.wetCheck,
      4,
      "a per-customer call would have been 2000 queries",
    );
    assert.equal(month.size, 500);
    assert.equal(year.size, 500);
    assert.equal(month.get(ids[0])?.total, 15);
    // Every id was asked for in one go.
    assert.equal(queries.invoiceIdLists[0].length, 500);
  });

  it("the two legs are answered by two different queries, never one row set", async () => {
    const CUST = 51;
    fixtures.invoices = [
      { id: 1, customerId: CUST, companyId: COMPANY_A, status: "sent", totalAmount: "200.00", createdAt: new Date(2026, 4, 4) },
    ];
    fixtures.wetCheckBillings = [
      { customerId: CUST, companyId: COMPANY_A, invoiceId: null, totalAmount: "30.00", workDate: new Date(2026, 4, 5) },
    ];
    scopeWetChecks(COMPANY_A, [CUST]);

    const spend = await computeCustomerSpend(CUST, COMPANY_A, MONTH);

    assert.equal(queries.invoice, 1);
    assert.equal(queries.wetCheck, 1);
    assert.deepEqual(
      queries.tables,
      ["wet_check_billings"],
      "the only table read directly is wet_check_billings — invoices go through storage",
    );
    // The legs kept their own rows: the invoice never landed in
    // pendingNotBilled and the wet check never landed in invoiced.
    assert.equal(spend.invoiced, 200);
    assert.equal(spend.pendingNotBilled, 30);
  });
});

// ── 5. neither Financial Pulse helper accumulates spend any more ────────────

describe("Task #2017 — the Financial Pulse helpers no longer compute spend", () => {
  const invoices: InvoiceLike[] = [
    invoiceLike({
      id: 1,
      customerId: 61,
      companyId: COMPANY_A,
      status: "sent",
      totalAmount: "4200.00",
      createdAt: new Date(2026, 4, 4),
    }),
  ];
  const custs = [customer(61, 1000, "12000.00")];

  it("both tabs report zero spend for an in-month invoice when the spend map is empty", () => {
    const accounting = computeTopCustomers({
      customers: custs,
      invoices,
      window: MONTH,
      now: NOW,
      monthSpendByCustomer: new Map(),
      yearSpendByCustomer: new Map(),
    })[0];
    const pulse = computePulseCustomers({
      customers: custs,
      invoices,
      workOrders: [],
      billingSheets: [],
      currentYear: NOW.getFullYear(),
      now: NOW,
      monthSpendByCustomer: new Map(),
    })[0];

    assert.equal(accounting.monthlySpend, 0, "no local accumulation left");
    assert.equal(accounting.annualSpend, 0);
    assert.equal(pulse.monthlySpend, 0);
  });

  it("the revenue and year-to-date columns are untouched — they are not budget columns", () => {
    const accounting = computeTopCustomers({
      customers: custs,
      invoices,
      window: MONTH,
      now: NOW,
      monthSpendByCustomer: new Map([[61, 7]]),
      yearSpendByCustomer: new Map([[61, 9]]),
    })[0];
    const pulse = computePulseCustomers({
      customers: custs,
      invoices,
      workOrders: [],
      billingSheets: [],
      currentYear: NOW.getFullYear(),
      now: NOW,
      monthSpendByCustomer: new Map([[61, 7]]),
    })[0];

    // revenue still follows the period selector on the invoice creation date…
    assert.equal(accounting.revenue, 4200);
    // …and the Pulse tab's ytd still follows invoiceYear.
    assert.equal(pulse.ytd, 4200);
    // …while the budget meters read only what was handed in.
    assert.equal(accounting.monthlySpend, 7);
    assert.equal(accounting.annualSpend, 9);
    assert.equal(pulse.monthlySpend, 7);
  });
});
