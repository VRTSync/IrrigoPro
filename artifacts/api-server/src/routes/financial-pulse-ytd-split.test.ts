// Financial Pulse — two honest YTD tiles, and a Last Cycle that is closed.
//
// The Accounting tab's "Billed YTD" summed invoices for the year, then ALL
// non-cancelled work orders created this year, then ALL non-cancelled billing
// sheets created this year — invoiced or not. Invoiced work was therefore
// counted twice, once through the invoice and once through the work order or
// billing sheet the invoice already contained, and a tile named "Billed"
// reported roughly double what was billed. Its delta compared that inflated
// figure against a prior-year window computed from invoices alone, so it
// reported a large positive "vs last year" every year.
//
// The tile is now two: Invoiced YTD (realised revenue, invoices only) and
// Work Booked YTD (invoiced plus work booked this year that is not invoiced
// yet). The Pulse tab's "Year to Date" reads the same Work Booked YTD from the
// same helper instead of adding the all-time in-flight pipeline to invoices.
//
// Separately, "Billed Last Cycle" selected the highest invoiceYear/invoiceMonth
// with no exclusion of the current month, so one standalone invoice stamped
// with current-month work turned a partial September into "last cycle" and
// compared it against the whole of August. The current calendar month can never
// be a closed cycle now, and a company with no closed cycle is a distinct state
// the tile renders as "—" rather than $0.
//
// Lives in its own file on purpose: several tickets edit financial-pulse.test.ts
// and financial-pulse-math.test.ts, and this ticket's evidence should not
// collide with theirs.

import { describe, it, before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import express, { type Express } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { db } from "../db";
import {
  billingSheets,
  customers,
  invoices,
  wetCheckBillings,
  workOrders,
} from "@workspace/db/schema";
import {
  computeInvoicedYtd,
  computeWorkBookedYtd,
  countInvoicesForCycle,
  getDistinctBillingCycles,
  type BillingSheetBillableLike,
  type InvoiceLike,
  type WetCheckBillingBillableLike,
  type WorkOrderBillableLike,
} from "../financial-pulse-math";

// September 2026, frozen on the 10th. The current cycle (September) is in
// progress; August 2026 is the most recent closed one.
const FROZEN_NOW = new Date(2026, 8, 10, 12, 0, 0);
const YEAR = 2026;

// ─── Pure math ──────────────────────────────────────────────────────────────

type Wo = WorkOrderBillableLike & { customerId?: number | null };
type Bs = BillingSheetBillableLike & { customerId?: number | null };
type Wcb = WetCheckBillingBillableLike & { customerId?: number | null };

function inv(
  over: Partial<InvoiceLike> & { totalAmount: string },
): InvoiceLike {
  return {
    id: 1,
    customerId: 1,
    status: "sent",
    createdAt: new Date(YEAR, 3, 1),
    invoiceMonth: 4,
    invoiceYear: YEAR,
    ...over,
  } as InvoiceLike;
}

function wo(over: Partial<Wo> & { totalAmount: string }): Wo {
  return {
    customerId: 1,
    invoiceId: null,
    status: "work_completed",
    createdAt: new Date(YEAR, 2, 10),
    ...over,
  } as Wo;
}

function booked(over: Partial<{
  invoices: InvoiceLike[];
  workOrders: Wo[];
  billingSheets: Bs[];
  wetCheckBillings: Wcb[];
  hiddenCustomerIds: ReadonlySet<number>;
}>): number {
  return computeWorkBookedYtd({
    invoices: over.invoices ?? [],
    workOrders: over.workOrders ?? [],
    billingSheets: over.billingSheets ?? [],
    wetCheckBillings: over.wetCheckBillings ?? [],
    currentYear: YEAR,
    hiddenCustomerIds: over.hiddenCustomerIds,
  });
}

describe("Work Booked YTD — invoiced work is counted once, not twice", () => {
  it("a work order invoiced this year contributes nothing beyond its invoice", () => {
    // The $237,000 gap between the two tabs, in miniature: a $3,000 invoice
    // covering a $2,800 work order used to report $5,800.
    const theInvoice = inv({ id: 101, totalAmount: "3000" });
    const invoicedWo = wo({
      invoiceId: 101,
      totalAmount: "2800",
      status: "approved_passed_to_billing",
      createdAt: new Date(YEAR, 3, 1),
    });

    assert.equal(computeInvoicedYtd([theInvoice], YEAR), 3000);
    assert.equal(
      booked({ invoices: [theInvoice], workOrders: [invoicedWo] }),
      3000,
      "the invoiced work order must not be added on top of its own invoice",
    );
  });

  it("an uninvoiced work order booked this year counts in Work Booked YTD only", () => {
    const theInvoice = inv({ id: 101, totalAmount: "3000" });
    const pipeline = wo({ totalAmount: "800", createdAt: new Date(YEAR, 0, 15) });

    assert.equal(computeInvoicedYtd([theInvoice], YEAR), 3000);
    assert.equal(booked({ invoices: [theInvoice], workOrders: [pipeline] }), 3800);
  });

  it("an uninvoiced work order booked LAST year counts in neither figure", () => {
    const theInvoice = inv({ id: 101, totalAmount: "3000" });
    const lastYear = wo({
      totalAmount: "500",
      createdAt: new Date(YEAR - 1, 11, 15),
    });

    assert.equal(computeInvoicedYtd([theInvoice], YEAR), 3000);
    assert.equal(
      booked({ invoices: [theInvoice], workOrders: [lastYear] }),
      3000,
      "Work Booked YTD is year-bounded; In-Flight is the all-time view",
    );
  });

  it("every non-cancelled uninvoiced status counts; cancelled never does", () => {
    const rows: Wo[] = [
      wo({ totalAmount: "400", status: "draft", createdAt: new Date(YEAR, 2, 10) }),
      wo({ totalAmount: "600", status: "in_progress", createdAt: new Date(YEAR, 3, 5) }),
      wo({ totalAmount: "999", status: "cancelled", createdAt: new Date(YEAR, 3, 6) }),
      wo({ invoiceId: 5, totalAmount: "500", status: "cancelled", createdAt: new Date(YEAR, 3, 7) }),
    ];
    assert.equal(booked({ workOrders: rows }), 1000);
  });

  it("a merged invoice is excluded from both figures", () => {
    const rows = [
      inv({ id: 101, totalAmount: "3000" }),
      inv({ id: 102, totalAmount: "7000", status: "merged" }),
    ];
    assert.equal(computeInvoicedYtd(rows, YEAR), 3000);
    assert.equal(booked({ invoices: rows }), 3000);
  });

  it("invoices are bucketed by invoiceYear, so a December cycle invoiced in January stays in December's year", () => {
    const decCycle = inv({
      id: 101,
      totalAmount: "4000",
      invoiceMonth: 12,
      invoiceYear: YEAR - 1,
      createdAt: new Date(YEAR, 0, 5),
    });
    assert.equal(computeInvoicedYtd([decCycle], YEAR), 0);
    assert.equal(computeInvoicedYtd([decCycle], YEAR - 1), 4000);
  });

  it("the year-over-year comparator is invoices against invoices, aligned to the same day", () => {
    const thisYear = inv({ id: 101, totalAmount: "3000" });
    const lastYearEarly = inv({
      id: 102,
      totalAmount: "2000",
      invoiceYear: YEAR - 1,
      invoiceMonth: 3,
      createdAt: new Date(YEAR - 1, 2, 1),
    });
    const lastYearLate = inv({
      id: 103,
      totalAmount: "9000",
      invoiceYear: YEAR - 1,
      invoiceMonth: 11,
      createdAt: new Date(YEAR - 1, 10, 1),
    });
    const sameDayLastYear = new Date(YEAR - 1, 8, 10, 12, 0, 0);

    assert.equal(computeInvoicedYtd([thisYear], YEAR), 3000);
    assert.equal(
      computeInvoicedYtd(
        [thisYear, lastYearEarly, lastYearLate],
        YEAR - 1,
        sameDayLastYear,
      ),
      2000,
      "November of last year has not happened yet in this year's window",
    );
  });

  it("wet check billings count only when uninvoiced and worked this year", () => {
    const rows: Wcb[] = [
      { customerId: 1, invoiceId: null, totalAmount: "250", status: "", workDate: new Date(YEAR, 5, 2) },
      { customerId: 1, invoiceId: 77, totalAmount: "900", status: "", workDate: new Date(YEAR, 5, 3) },
      { customerId: 1, invoiceId: null, totalAmount: "400", status: "", workDate: new Date(YEAR - 1, 5, 4) },
    ];
    assert.equal(booked({ wetCheckBillings: rows }), 250);
  });

  it("billing sheets follow the same uninvoiced, booked-this-year rule", () => {
    const rows: Bs[] = [
      { customerId: 1, invoiceId: null, totalAmount: "120", status: "submitted", createdAt: new Date(YEAR, 4, 1) },
      { customerId: 1, invoiceId: 9, totalAmount: "300", status: "submitted", createdAt: new Date(YEAR, 4, 2) },
      { customerId: 1, invoiceId: null, totalAmount: "700", status: "cancelled", createdAt: new Date(YEAR, 4, 3) },
    ];
    assert.equal(booked({ billingSheets: rows }), 120);
  });
});

describe("Work Booked YTD — hidden-from-billing customers", () => {
  const hidden = new Set([2]);

  it("excludes their uninvoiced work but keeps their invoices", () => {
    // The invoiced leg filters nobody, matching every other invoiced figure on
    // the page; the uninvoiced legs exclude hidden customers, matching
    // In-Flight and Work Not Yet Billed. Both tabs pass the same set, which is
    // what lets the two tiles agree on a company that uses the flag.
    const rows = [
      inv({ id: 101, customerId: 1, totalAmount: "3000" }),
      inv({ id: 102, customerId: 2, totalAmount: "1000" }),
    ];
    const pipeline = [
      wo({ customerId: 1, totalAmount: "800" }),
      wo({ customerId: 2, totalAmount: "5000" }),
    ];

    assert.equal(computeInvoicedYtd(rows, YEAR), 4000);
    assert.equal(
      booked({ invoices: rows, workOrders: pipeline, hiddenCustomerIds: hidden }),
      4800,
      "the hidden customer's invoices count; their uninvoiced work does not",
    );
  });

  it("skips rows with no customer, which the Pulse tab's loaders drop outright", () => {
    const orphan = wo({ customerId: null, totalAmount: "600" });
    assert.equal(booked({ workOrders: [orphan], hiddenCustomerIds: hidden }), 0);
  });
});

describe("Billed Last Cycle — the current month is never a closed cycle", () => {
  const augustAndSeptember: InvoiceLike[] = [
    inv({ id: 201, totalAmount: "20000", invoiceMonth: 7, invoiceYear: YEAR }),
    inv({ id: 202, totalAmount: "30000", invoiceMonth: 8, invoiceYear: YEAR }),
    inv({ id: 203, totalAmount: "17000", invoiceMonth: 8, invoiceYear: YEAR }),
    // One standalone invoice stamped with current-month work. This used to
    // become "the most recent cycle" and got compared against all of August.
    inv({ id: 204, totalAmount: "4000", invoiceMonth: 9, invoiceYear: YEAR }),
  ];

  it("selects August when a September-stamped invoice exists", () => {
    const cycles = getDistinctBillingCycles(augustAndSeptember, {
      closedAsOf: FROZEN_NOW,
    });
    assert.deepEqual(cycles[0], { year: YEAR, month: 8 });
    assert.deepEqual(cycles[1], { year: YEAR, month: 7 });
    assert.ok(
      !cycles.some((c) => c.year === YEAR && c.month === 9),
      "the in-progress month must not appear as a cycle at all",
    );
  });

  it("counts only the invoices of the cycle it selected", () => {
    const cycles = getDistinctBillingCycles(augustAndSeptember, {
      closedAsOf: FROZEN_NOW,
    });
    assert.equal(countInvoicesForCycle(augustAndSeptember, cycles[0]), 2);
  });

  it("without the bound, the partial current month wins — the defect", () => {
    assert.deepEqual(getDistinctBillingCycles(augustAndSeptember)[0], {
      year: YEAR,
      month: 9,
    });
  });

  it("a company whose only invoices are current-month has NO closed cycle", () => {
    const currentOnly = [inv({ id: 301, totalAmount: "47782", invoiceMonth: 9, invoiceYear: YEAR })];
    assert.deepEqual(
      getDistinctBillingCycles(currentOnly, { closedAsOf: FROZEN_NOW }),
      [],
      "an empty selection is the empty state; it is not a $0 cycle",
    );
  });

  it("future-stamped invoices are excluded too", () => {
    const future = [
      inv({ id: 401, totalAmount: "1000", invoiceMonth: 11, invoiceYear: YEAR }),
      inv({ id: 402, totalAmount: "2000", invoiceMonth: 6, invoiceYear: YEAR }),
    ];
    assert.deepEqual(getDistinctBillingCycles(future, { closedAsOf: FROZEN_NOW }), [
      { year: YEAR, month: 6 },
    ]);
  });
});

// ─── Route level: both tabs, one fixture, one instant ───────────────────────
//
// Both handlers are mounted for real against a stubbed `db.select()` that
// serves fixture rows per table, so scope resolution, the loaders and the
// aggregation all run — without the shared dev database.

interface CustomerRow {
  id: number;
  companyId: number;
  hiddenFromBilling: boolean;
  name: string;
}
interface InvoiceRow {
  id: number;
  customerId: number;
  totalAmount: string;
  status: string;
  createdAt: Date;
  invoiceMonth: number | null;
  invoiceYear: number | null;
}
interface WorkOrderRow {
  customerId: number;
  invoiceId: number | null;
  totalAmount: string;
  status: string;
  createdAt: Date;
  assignedTechnicianId: number | null;
}
interface WcbRow {
  customerId: number;
  invoiceId: number | null;
  totalAmount: string;
  status: string;
  workDate: Date;
  technicianId: number | null;
}
interface Fixture {
  customers: CustomerRow[];
  invoices: InvoiceRow[];
  workOrders: WorkOrderRow[];
  wetCheckBillings: WcbRow[];
}

const EMPTY: Fixture = {
  customers: [],
  invoices: [],
  workOrders: [],
  wetCheckBillings: [],
};
let FIXTURE: Fixture = EMPTY;

// Drizzle conditions are SQL objects whose queryChunks carry the referenced
// columns and the bound Params. Walking them lets the stub honour the tenancy
// filters the loaders actually build, rather than ignoring them.
function walkChunks(node: unknown, visit: (n: any) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) walkChunks(n, visit);
    return;
  }
  visit(node);
  const chunks = (node as any).queryChunks;
  if (Array.isArray(chunks)) walkChunks(chunks, visit);
}

function boundNumbers(cond: unknown): number[] {
  const out: number[] = [];
  walkChunks(cond, (n) => {
    // A bound Param carries both `value` and `encoder`; a StringChunk has only
    // `value`.
    if ("encoder" in n && "value" in n && typeof n.value === "number") {
      out.push(n.value);
    }
  });
  return out;
}

function referencedColumns(cond: unknown): string[] {
  const out: string[] = [];
  walkChunks(cond, (n) => {
    if (typeof n.name === "string" && n.table) out.push(n.name);
  });
  return out;
}

function rowsFor(table: unknown, cond: unknown): unknown[] {
  const cols = referencedColumns(cond);
  const nums = boundNumbers(cond);
  if (table === customers) {
    // No condition = super_admin global scope.
    if (!cols.includes("company_id")) return FIXTURE.customers;
    return FIXTURE.customers.filter((c) => nums.includes(c.companyId));
  }
  // Every other loader in these handlers keys off customer_id; the margin
  // loaders key off invoice_id and must get nothing.
  if (!cols.includes("customer_id")) return [];
  if (table === invoices) {
    return FIXTURE.invoices.filter((i) => nums.includes(i.customerId));
  }
  if (table === workOrders) {
    return FIXTURE.workOrders.filter((w) => nums.includes(w.customerId));
  }
  if (table === wetCheckBillings) {
    return FIXTURE.wetCheckBillings.filter((w) => nums.includes(w.customerId));
  }
  if (table === billingSheets) return [];
  return [];
}

const originalSelect = (db as any).select;
(db as any).select = () => {
  let table: unknown = null;
  let cond: unknown = null;
  const chain: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          const rows = rowsFor(table, cond);
          return (resolve: (v: unknown) => void) => resolve(rows);
        }
        if (prop === "from") {
          return (t: unknown) => {
            table = t;
            return chain;
          };
        }
        if (prop === "where") {
          return (c: unknown) => {
            cond = c;
            return chain;
          };
        }
        return () => chain;
      },
    },
  );
  return chain;
};

// Import AFTER patching so the route module closes over the stub.
const { registerFinancialPulseRoutes } = await import("./financial-pulse");

interface ServerCtx {
  server: Server;
  base: string;
}
const SERVERS: ServerCtx[] = [];

async function spin(role: string, companyId: number | null): Promise<ServerCtx> {
  const app: Express = express();
  app.use(express.json());
  const requireAuthentication: express.RequestHandler = (req: any, _res, next) => {
    req.authenticatedUserRole = role;
    req.authenticatedUserCompanyId = companyId;
    next();
  };
  registerFinancialPulseRoutes(app, { requireAuthentication });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  const ctx = { server, base: `http://127.0.0.1:${port}` };
  SERVERS.push(ctx);
  return ctx;
}

async function getJson(url: string): Promise<any> {
  const r = await fetch(url);
  assert.equal(r.status, 200, `${url} should be 200`);
  return (await r.json()) as any;
}

function customerRow(id: number, companyId: number, hidden = false): CustomerRow {
  return { id, companyId, hiddenFromBilling: hidden, name: `Customer ${id}` };
}

function invoiceRow(
  id: number,
  customerId: number,
  amount: number,
  opts: { month?: number; year?: number; status?: string; createdAt?: Date } = {},
): InvoiceRow {
  const month = opts.month ?? 8;
  const year = opts.year ?? YEAR;
  return {
    id,
    customerId,
    totalAmount: String(amount),
    status: opts.status ?? "sent",
    createdAt: opts.createdAt ?? new Date(year, month - 1, 28),
    invoiceMonth: month,
    invoiceYear: year,
  };
}

function workOrderRow(
  customerId: number,
  amount: number,
  opts: { invoiceId?: number | null; status?: string; createdAt?: Date } = {},
): WorkOrderRow {
  return {
    customerId,
    invoiceId: opts.invoiceId ?? null,
    totalAmount: String(amount),
    status: opts.status ?? "work_completed",
    createdAt: opts.createdAt ?? new Date(YEAR, 5, 1),
    assignedTechnicianId: null,
  };
}

describe("Financial Pulse — the Accounting tab and the Pulse tab report one YTD", () => {
  before(() => {
    mock.timers.enable({ apis: ["Date"], now: FROZEN_NOW.getTime() });
  });

  after(async () => {
    mock.timers.reset();
    (db as any).select = originalSelect;
    await Promise.all(
      SERVERS.map((s) => new Promise<void>((r) => s.server.close(() => r()))),
    );
  });

  beforeEach(() => {
    FIXTURE = { customers: [], invoices: [], workOrders: [], wetCheckBillings: [] };
  });

  it("both tabs return the identical Work Booked YTD, hidden-from-billing customers included in the fixture", async () => {
    FIXTURE = {
      customers: [
        customerRow(1, 10),
        // Hidden from billing: their invoices still count, their uninvoiced
        // work does not. A helper that ignored the flag would make the two
        // tabs disagree here, because the Pulse tab's In-Flight already
        // excludes them.
        customerRow(2, 10, true),
      ],
      invoices: [
        invoiceRow(101, 1, 30_000, { month: 8 }),
        invoiceRow(102, 2, 10_000, { month: 8 }),
      ],
      workOrders: [
        // Invoiced: already inside invoice 101, must not be added again.
        workOrderRow(1, 28_000, { invoiceId: 101, status: "approved_passed_to_billing" }),
        // Uninvoiced, booked this year: the only addend.
        workOrderRow(1, 5_000),
        // Uninvoiced but hidden from billing: excluded.
        workOrderRow(2, 9_000),
        // Uninvoiced but booked last year: excluded (In-Flight keeps it).
        workOrderRow(1, 7_000, { createdAt: new Date(YEAR - 1, 10, 1) }),
      ],
      wetCheckBillings: [],
    };
    const { base } = await spin("company_admin", 10);

    const kpis = await getJson(`${base}/api/financial-pulse/kpis`);
    const pulse = await getJson(`${base}/api/financial-pulse/pulse-summary`);

    assert.equal(
      pulse.yearToDate.value,
      kpis.workBookedYtd.value,
      "the two tabs must show one Work Booked YTD, from one helper",
    );
    assert.equal(kpis.invoicedYtd.value, 40_000);
    assert.equal(kpis.workBookedYtd.value, 45_000);
    assert.equal(
      kpis.workBookedYtd.value - kpis.invoicedYtd.value,
      5_000,
      "only uninvoiced work booked this year for a visible customer is added",
    );
    // In-Flight is all-time by design and keeps the prior-year row, which is
    // exactly why the Pulse tab could not previously agree with Accounting.
    assert.equal(pulse.inFlight.value, 12_000);
    assert.equal(kpis.workBookedYtd.deltaPct, null);
  });

  it("neither figure counts a merged invoice, on either tab", async () => {
    FIXTURE = {
      customers: [customerRow(1, 10)],
      invoices: [
        invoiceRow(101, 1, 30_000, { month: 8 }),
        invoiceRow(102, 1, 12_000, { month: 8, status: "merged" }),
      ],
      workOrders: [],
      wetCheckBillings: [],
    };
    const { base } = await spin("company_admin", 10);

    const kpis = await getJson(`${base}/api/financial-pulse/kpis`);
    const pulse = await getJson(`${base}/api/financial-pulse/pulse-summary`);

    assert.equal(kpis.invoicedYtd.value, 30_000);
    assert.equal(kpis.workBookedYtd.value, 30_000);
    assert.equal(pulse.yearToDate.value, 30_000);
  });

  it("both tabs skip the in-progress month when they pick the last cycle", async () => {
    FIXTURE = {
      customers: [customerRow(1, 10)],
      invoices: [
        invoiceRow(201, 1, 20_000, { month: 7 }),
        invoiceRow(202, 1, 30_000, { month: 8 }),
        invoiceRow(203, 1, 17_000, { month: 8 }),
        // Stamped with current-month work — never a closed cycle.
        invoiceRow(204, 1, 4_000, { month: 9 }),
      ],
      workOrders: [],
      wetCheckBillings: [],
    };
    const { base } = await spin("company_admin", 10);

    const kpis = await getJson(`${base}/api/financial-pulse/kpis`);
    const pulse = await getJson(`${base}/api/financial-pulse/pulse-summary`);

    assert.equal(kpis.billedLastCycle.monthIso, `${YEAR}-08`);
    assert.equal(kpis.billedLastCycle.value, 47_000);
    assert.equal(kpis.billedLastCycle.hasClosedCycle, true);
    assert.equal(pulse.lastCycle.monthIso, `${YEAR}-08`);
    assert.equal(pulse.lastCycle.value, kpis.billedLastCycle.value);
    assert.equal(
      pulse.lastCycle.invoiceCount,
      2,
      "the count describes the same rows as the dollars — September is not one of them",
    );
  });

  it("a company whose only invoices are current-month has no closed cycle, not a $0 one", async () => {
    FIXTURE = {
      customers: [customerRow(1, 10)],
      invoices: [invoiceRow(301, 1, 47_782, { month: 9 })],
      workOrders: [],
      wetCheckBillings: [],
    };
    const { base } = await spin("company_admin", 10);

    const kpis = await getJson(`${base}/api/financial-pulse/kpis`);
    const pulse = await getJson(`${base}/api/financial-pulse/pulse-summary`);

    assert.equal(kpis.billedLastCycle.hasClosedCycle, false);
    assert.equal(kpis.billedLastCycle.value, null);
    assert.equal(kpis.billedLastCycle.deltaPct, null);
    assert.equal(pulse.lastCycle.hasClosedCycle, false);
    assert.equal(pulse.lastCycle.value, null);
    // The invoice itself is still realised revenue — only the cycle is absent.
    assert.equal(kpis.invoicedYtd.value, 47_782);
  });

  it("tenancy: both figures cover only the caller's company, on both tabs", async () => {
    FIXTURE = {
      customers: [customerRow(1, 10), customerRow(9, 20)],
      invoices: [
        invoiceRow(101, 1, 30_000, { month: 8 }),
        invoiceRow(901, 9, 500_000, { month: 8 }),
      ],
      workOrders: [workOrderRow(1, 5_000), workOrderRow(9, 400_000)],
      wetCheckBillings: [],
    };
    const mine = await spin("company_admin", 10);
    const theirs = await spin("company_admin", 20);

    const myKpis = await getJson(`${mine.base}/api/financial-pulse/kpis`);
    const myPulse = await getJson(`${mine.base}/api/financial-pulse/pulse-summary`);
    const theirKpis = await getJson(`${theirs.base}/api/financial-pulse/kpis`);

    assert.equal(myKpis.invoicedYtd.value, 30_000);
    assert.equal(myKpis.workBookedYtd.value, 35_000);
    assert.equal(myPulse.yearToDate.value, 35_000);
    assert.equal(theirKpis.invoicedYtd.value, 500_000);
    assert.equal(theirKpis.workBookedYtd.value, 900_000);
  });
});
