// Task #2014 — real costs in the Profit Margin tile.
//
// The margin used to subtract billed PRICES as if they were costs on two of
// its three legs: `billing_sheets.partsSubtotal` and
// `wet_check_billings.partsSubtotal` stood in for parts cost, and
// `wet_check_billings.laborSubtotal` (hours × the CUSTOMER's labor rate) stood
// in for labor cost. This file pins the one cost rule that replaced them:
//
//   parts cost  = Σ over the invoice's own line items of quantity × parts.cost
//   labor cost  = Σ technician hours × that technician's wage, all three legs
//
// with a documented percentage-of-billed-price estimate whenever a catalog
// cost is missing, reported back in dollars so the tile can flag it.
//
// Everything here is pure math except the last describe, which proves the
// parts join cannot cross tenants and therefore needs the real loader.
//
// ── Size of the correction, measured on real data ─────────────────────────
// Company 99, YTD window 2026-01-01 → 2026-09-15, both bases computed over
// the same 140 non-excluded invoices:
//
//   revenue                 7,000.00   (unchanged — revenue rules did not move)
//   parts cost   before     4,200.00   entirely billing_sheets.parts_subtotal,
//                                      a billed price
//                 after     1,400.00   140 ticket summary lines expanded into
//                                      their tickets' part rows, every one of
//                                      which resolved a catalog cost
//   labor cost   before     1,750.00   work orders 437.50 + billing sheets
//                                      1,312.50 + wet checks 0.00
//                 after     1,750.00   unchanged: no wet-check billing is
//                                      linked to an invoice in this window, so
//                                      the leg that changed contributes nothing
//                                      here
//   margin       before        15.0%
//                 after        55.0%
//
// The whole 40-point move is one leg: billed parts price was 3x the parts'
// actual catalog cost, and the difference was being subtracted from margin as
// if it were money spent. Nothing is estimated on the parts side here (0 lines
// missing a catalog cost), while all 1,750 of labor is the $25 fallback — no
// user in company 99 has an hourly wage — so the tile words this one as an
// estimate end to end.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";

import {
  computeGrossMargin,
  DEFAULT_PARTS_COST_PCT,
  type InvoiceLike,
  type InvoiceLineCostLike,
  type UserLike,
} from "../financial-pulse-math";

// ── Shared fixtures ────────────────────────────────────────────────────────

const WINDOW = { start: new Date(2026, 4, 1), end: new Date(2026, 5, 1) };

function invoice(overrides: Partial<InvoiceLike> = {}): InvoiceLike {
  return {
    id: 1,
    customerId: 1,
    totalAmount: "1000",
    status: "sent",
    createdAt: new Date(2026, 4, 3),
    ...overrides,
  };
}

const TECH_WITH_WAGE = 30;
const TECH_NO_WAGE = 31;
const users = new Map<number, UserLike>([
  [TECH_WITH_WAGE, { id: TECH_WITH_WAGE, hourlyWage: "30.00" }],
  [TECH_NO_WAGE, { id: TECH_NO_WAGE, hourlyWage: null }],
]);

function margin(
  over: Partial<Parameters<typeof computeGrossMargin>[0]> = {},
): ReturnType<typeof computeGrossMargin> {
  return computeGrossMargin({
    invoices: [invoice()],
    workOrders: [],
    billingSheets: [],
    wetCheckBillings: [],
    invoiceLineItems: [],
    usersById: users,
    fallbackHourlyWage: 25,
    window: WINDOW,
    ...over,
  });
}

// ── Parts cost comes from the catalog, never from a billed price ───────────

describe("Task #2014 — parts cost is quantity × catalog cost", () => {
  it("a billing-sheet part line priced 100 at cost 60, qty 2, costs 120 — not the 200 it was billed at", () => {
    const r = margin({
      // The billing sheet is still here for its labor; its partsSubtotal is a
      // price and must contribute nothing to cost.
      billingSheets: [
        {
          invoiceId: 1,
          totalHours: "0",
          partsSubtotal: "200",
          technicianId: TECH_WITH_WAGE,
        },
      ],
      invoiceLineItems: [
        {
          invoiceId: 1,
          partId: 500,
          quantity: "2",
          totalPrice: "200",
          laborTotal: "0",
          partCost: "60",
        },
      ],
    });

    assert.equal(r.partsCost, 120);
    assert.notEqual(r.partsCost, 200);
    assert.equal(r.estimatedPartsCostShortfall, 0);
    assert.equal(r.missingCostPartLineCount, 0);
  });

  it("a work order's totalPartsCost snapshot no longer feeds the cost base", () => {
    const r = margin({
      workOrders: [
        {
          invoiceId: 1,
          totalHours: "0",
          totalPartsCost: "777",
          assignedTechnicianId: TECH_WITH_WAGE,
        },
      ],
      invoiceLineItems: [
        {
          invoiceId: 1,
          partId: 500,
          quantity: "1",
          totalPrice: "100",
          laborTotal: "0",
          partCost: "40",
        },
      ],
    });

    assert.equal(r.partsCost, 40);
  });

  it("line items on invoices outside the window are ignored", () => {
    const r = margin({
      invoices: [invoice({ id: 1 }), invoice({ id: 2, createdAt: new Date(2026, 2, 3) })],
      invoiceLineItems: [
        { invoiceId: 1, partId: 1, quantity: "1", totalPrice: "10", laborTotal: "0", partCost: "5" },
        { invoiceId: 2, partId: 1, quantity: "1", totalPrice: "10", laborTotal: "0", partCost: "5" },
      ],
    });

    assert.equal(r.partsCost, 5);
  });
});

// ── Unknown catalog cost is estimated, quantified and counted ──────────────

describe("Task #2014 — estimated parts cost when the catalog has none", () => {
  it("a null catalog cost charges the configured percentage and reports both the dollars and the line", () => {
    const r = margin({
      invoiceLineItems: [
        {
          invoiceId: 1,
          partId: 500,
          quantity: "3",
          totalPrice: "100",
          laborTotal: "0",
          partCost: null,
        },
      ],
      partsCostPct: 65,
    });

    assert.equal(r.partsCost, 65);
    assert.equal(r.estimatedPartsCostShortfall, 65);
    assert.equal(r.missingCostPartLineCount, 1);
  });

  it("a manually entered line with no part reference takes the same fallback", () => {
    const r = margin({
      invoiceLineItems: [
        {
          invoiceId: 1,
          partId: null,
          quantity: null,
          totalPrice: "80",
          laborTotal: "0",
          partCost: null,
        },
      ],
      partsCostPct: 65,
    });

    assert.equal(r.partsCost, 52);
    assert.equal(r.estimatedPartsCostShortfall, 52);
    assert.equal(r.missingCostPartLineCount, 1);
  });

  it("the percentage defaults to DEFAULT_PARTS_COST_PCT when none is supplied", () => {
    const r = margin({
      invoiceLineItems: [
        { invoiceId: 1, partId: null, totalPrice: "100", laborTotal: "0" },
      ],
    });

    assert.equal(r.partsCost, DEFAULT_PARTS_COST_PCT);
    assert.equal(r.estimatedPartsCostShortfall, DEFAULT_PARTS_COST_PCT);
  });

  it("a known catalog cost of zero is a real cost, not a missing one", () => {
    const r = margin({
      invoiceLineItems: [
        { invoiceId: 1, partId: 500, quantity: "4", totalPrice: "200", laborTotal: "0", partCost: "0" },
      ],
    });

    assert.equal(r.partsCost, 0);
    assert.equal(r.estimatedPartsCostShortfall, 0);
    assert.equal(r.missingCostPartLineCount, 0);
  });

  it("a labor-only line has no parts dollars to estimate, so labor is never charged twice", () => {
    // Ticket-level summary rows carry the whole ticket in `totalPrice` with the
    // labor portion in `laborTotal`. That labor is already priced through the
    // wage path; only the remainder is parts.
    const r = margin({
      workOrders: [
        { invoiceId: 1, totalHours: "10", assignedTechnicianId: TECH_WITH_WAGE },
      ],
      invoiceLineItems: [
        { invoiceId: 1, partId: null, quantity: "1", totalPrice: "300", laborTotal: "300" },
      ],
      partsCostPct: 65,
    });

    assert.equal(r.partsCost, 0);
    assert.equal(r.missingCostPartLineCount, 0);
    assert.equal(r.laborCost, 300);
  });
});

// ── Wet-check labor runs through the wage path like everything else ────────

describe("Task #2014 — wet-check labor cost is hours × wage", () => {
  it("$400 of billed labor on 4 hours at $30/hr costs 120, not 400", () => {
    const r = margin({
      wetCheckBillings: [
        {
          invoiceId: 1,
          partsSubtotal: "150",
          laborSubtotal: "400",
          technicianId: TECH_WITH_WAGE,
          totalHours: "4",
        },
      ],
    });

    assert.equal(r.laborCost, 120);
    assert.notEqual(r.laborCost, 400);
    // The wet check's partsSubtotal is a price; it contributes no cost either.
    assert.equal(r.partsCost, 0);
  });

  it("a wet check on a wage-less technician joins the missing-wage count and the labor shortfall", () => {
    const r = margin({
      wetCheckBillings: [
        {
          invoiceId: 1,
          laborSubtotal: "400",
          technicianId: TECH_NO_WAGE,
          totalHours: "4",
        },
      ],
      fallbackHourlyWage: 25,
    });

    assert.equal(r.laborCost, 100);
    assert.equal(r.missingWageTechCount, 1);
    assert.equal(r.estimatedLaborCostShortfall, 100);
  });
});

// ── Whole-result invariants ────────────────────────────────────────────────

describe("Task #2014 — margin result invariants", () => {
  it("zero revenue returns a null percentage rather than dividing by zero", () => {
    const r = margin({
      invoices: [],
      invoiceLineItems: [
        { invoiceId: 1, partId: 500, quantity: "1", totalPrice: "10", laborTotal: "0", partCost: "5" },
      ],
    });

    assert.equal(r.pct, null);
    assert.equal(r.revenue, 0);
  });

  it("a company with no wages anywhere still computes a margin, with the shortfall equal to the whole labor cost", () => {
    const r = margin({
      workOrders: [
        { invoiceId: 1, totalHours: "10", assignedTechnicianId: TECH_NO_WAGE },
      ],
      billingSheets: [
        { invoiceId: 1, totalHours: "6", technicianId: TECH_NO_WAGE },
      ],
      wetCheckBillings: [
        { invoiceId: 1, technicianId: null, totalHours: "4" },
      ],
      fallbackHourlyWage: 25,
    });

    assert.ok(r.pct != null);
    assert.equal(r.laborCost, 500); // (10 + 6 + 4) hours × $25
    // Every dollar of labor is a fallback — this is what the tile words as an
    // estimate end to end.
    assert.equal(r.estimatedLaborCostShortfall, r.laborCost);
  });

  it("the percentage is revenue minus the two cost legs over revenue", () => {
    const r = margin({
      workOrders: [
        { invoiceId: 1, totalHours: "10", assignedTechnicianId: TECH_WITH_WAGE },
      ],
      invoiceLineItems: [
        { invoiceId: 1, partId: 500, quantity: "2", totalPrice: "200", laborTotal: "0", partCost: "60" },
      ],
    });

    assert.equal(
      r.pct,
      ((r.revenue - r.partsCost - r.laborCost) / r.revenue) * 100,
    );
  });
});

// ── Invoices as the app actually generates them ────────────────────────────
//
// Monthly generation and reissue both write ONE summary line per ticket:
// `part_id` null, `total_price` the whole ticket total. Reissue additionally
// drops `labor_total`. Neither path itemises the parts. So the loader resolves
// a summary line back to its source ticket's own part rows — that is what puts
// generated invoices on real catalog cost, and it is why a dropped
// `labor_total` cannot make the estimate swallow billed labor.

describe("Task #2014 — summary lines resolve their ticket's real part lines", () => {
  const COMPANY_A = 2;
  const COMPANY_B = 100;
  const CUSTOMER_ID = 902020;
  const INVOICE_ID = 902020;
  const WORK_ORDER_ID = 902020;
  const BILLING_SHEET_ID = 902020;
  const PART_COSTED = 902020;
  const PART_NO_COST = 902021;
  const PART_FOREIGN = 902022;
  const SEED_DATE = new Date(Date.UTC(2026, 4, 3, 12, 0, 0)).toISOString();

  let load: (ids: number[]) => Promise<InvoiceLineCostLike[]>;
  let db: typeof import("../db").db;

  before(async () => {
    ({ db } = await import("../db"));
    ({ loadInvoiceLineCostsForInvoices: load } = await import(
      "./financial-pulse"
    ));

    await db.execute(
      sql`INSERT INTO customers (id, company_id, name, email)
          VALUES (${CUSTOMER_ID}, ${COMPANY_A}, ${"Task 2014 Ticket Customer"},
                  ${"task-2014-ticket@example.test"})
          ON CONFLICT (id) DO NOTHING`,
    );
    await db.execute(
      sql`INSERT INTO parts (id, company_id, name, price, cost, sku, category)
          VALUES
            (${PART_COSTED}, ${COMPANY_A}, ${"Task 2014 Costed"}, ${"100.00"},
             ${"60.00"}, ${"TASK-2014-COSTED"}, ${"Testing"}),
            (${PART_NO_COST}, ${COMPANY_A}, ${"Task 2014 No Cost"}, ${"50.00"},
             ${null}, ${"TASK-2014-NOCOST"}, ${"Testing"}),
            (${PART_FOREIGN}, ${COMPANY_B}, ${"Task 2014 Other Tenant"},
             ${"80.00"}, ${"10.00"}, ${"TASK-2014-OTHER"}, ${"Testing"})
          ON CONFLICT (id) DO NOTHING`,
    );
    await db.execute(
      sql`INSERT INTO invoices
            (id, invoice_number, customer_id, company_id, customer_name,
             customer_email, invoice_month, invoice_year, period_start,
             period_end, status, parts_subtotal, labor_subtotal, total_amount,
             created_at)
          VALUES
            (${INVOICE_ID}, ${"TASK-2014-TICKETS"}, ${CUSTOMER_ID}, ${COMPANY_A},
             ${"Task 2014 Ticket Customer"}, ${"task-2014-ticket@example.test"},
             5, 2026, ${SEED_DATE}, ${SEED_DATE}, ${"generated"},
             ${"0.00"}, ${"0.00"}, ${"1000.00"}, ${SEED_DATE})
          ON CONFLICT (id) DO NOTHING`,
    );
    await db.execute(
      sql`INSERT INTO work_orders
            (id, work_order_number, customer_id, company_id, customer_name,
             customer_email, project_name, invoice_id, status, created_at)
          VALUES
            (${WORK_ORDER_ID}, ${"TASK-2014-WO"}, ${CUSTOMER_ID}, ${COMPANY_A},
             ${"Task 2014 Ticket Customer"}, ${"task-2014-ticket@example.test"},
             ${"Task 2014 WO"}, ${INVOICE_ID}, ${"completed"}, ${SEED_DATE})
          ON CONFLICT (id) DO NOTHING`,
    );
    await db.execute(
      sql`INSERT INTO billing_sheets
            (id, billing_number, customer_id, company_id, customer_name,
             property_address, work_date, technician_name, work_description,
             total_hours, labor_rate, labor_subtotal, parts_subtotal,
             total_amount, invoice_id, created_at)
          VALUES
            (${BILLING_SHEET_ID}, ${"TASK-2014-BS"}, ${CUSTOMER_ID}, ${COMPANY_A},
             ${"Task 2014 Ticket Customer"}, ${"1 Test Way"}, ${SEED_DATE},
             ${"Task 2014 Tech"}, ${"Task 2014 work"}, ${"0.00"}, ${"0.00"},
             ${"0.00"}, ${"300.00"}, ${"300.00"}, ${INVOICE_ID}, ${SEED_DATE})
          ON CONFLICT (id) DO NOTHING`,
    );
    // Work order: one catalog-costed part line (qty 2 at 100) and one manual
    // line with no part reference (80).
    await db.execute(
      sql`INSERT INTO work_order_items
            (id, work_order_id, part_id, part_name, part_price, quantity,
             total_price)
          VALUES
            (${WORK_ORDER_ID}, ${WORK_ORDER_ID}, ${PART_COSTED},
             ${"Task 2014 Costed"}, ${"100.00"}, 2, ${"200.00"}),
            (${WORK_ORDER_ID + 1}, ${WORK_ORDER_ID}, ${null},
             ${"Task 2014 Manual"}, ${"80.00"}, 1, ${"80.00"})
          ON CONFLICT (id) DO NOTHING`,
    );
    // Billing sheet: one part whose catalog row has no cost, and one part
    // belonging to another company entirely.
    await db.execute(
      sql`INSERT INTO billing_sheet_items
            (id, billing_sheet_id, part_id, part_name, quantity, unit_price,
             total_price)
          VALUES
            (${BILLING_SHEET_ID}, ${BILLING_SHEET_ID}, ${PART_NO_COST},
             ${"Task 2014 No Cost"}, ${"2.00"}, ${"50.00"}, ${"100.00"}),
            (${BILLING_SHEET_ID + 1}, ${BILLING_SHEET_ID}, ${PART_FOREIGN},
             ${"Task 2014 Other Tenant"}, ${"1.00"}, ${"80.00"}, ${"80.00"})
          ON CONFLICT (id) DO NOTHING`,
    );
    // Two summary lines exactly as the app writes them: the work-order one as
    // monthly generation writes it (labor_total stated), the billing-sheet one
    // as REISSUE writes it (labor_total dropped, only the ticket total kept).
    await db.execute(
      sql`INSERT INTO invoice_items
            (id, invoice_id, source_type, source_id, work_order_id,
             billing_sheet_id, work_date, description, part_id, quantity,
             unit_price, total_price, labor_total)
          VALUES
            (${INVOICE_ID}, ${INVOICE_ID}, ${"work_order"}, ${WORK_ORDER_ID},
             ${WORK_ORDER_ID}, ${null}, ${SEED_DATE}, ${"Task 2014 WO summary"},
             ${null}, ${"1.00"}, ${"700.00"}, ${"700.00"}, ${"420.00"}),
            (${INVOICE_ID + 1}, ${INVOICE_ID}, ${"billing_sheet"},
             ${BILLING_SHEET_ID}, ${null}, ${BILLING_SHEET_ID}, ${SEED_DATE},
             ${"Task 2014 BS summary (reissued)"}, ${null}, ${"1.00"},
             ${"300.00"}, ${"300.00"}, ${null})
          ON CONFLICT (id) DO NOTHING`,
    );
  });

  after(async () => {
    await db.execute(
      sql`DELETE FROM invoice_items WHERE id IN (${INVOICE_ID}, ${INVOICE_ID + 1})`,
    );
    await db.execute(
      sql`DELETE FROM work_order_items WHERE id IN (${WORK_ORDER_ID}, ${WORK_ORDER_ID + 1})`,
    );
    await db.execute(
      sql`DELETE FROM billing_sheet_items WHERE id IN (${BILLING_SHEET_ID}, ${BILLING_SHEET_ID + 1})`,
    );
    await db.execute(sql`DELETE FROM work_orders WHERE id = ${WORK_ORDER_ID}`);
    await db.execute(
      sql`DELETE FROM billing_sheets WHERE id = ${BILLING_SHEET_ID}`,
    );
    await db.execute(sql`DELETE FROM invoices WHERE id = ${INVOICE_ID}`);
    await db.execute(
      sql`DELETE FROM parts WHERE id IN (${PART_COSTED}, ${PART_NO_COST}, ${PART_FOREIGN})`,
    );
    await db.execute(sql`DELETE FROM customers WHERE id = ${CUSTOMER_ID}`);
  });

  it("expands a ticket summary line into the ticket's own part lines", async () => {
    const lines = await load([INVOICE_ID]);
    // Two work-order part lines + two billing-sheet part lines; the two
    // summary rows themselves are replaced, not kept alongside.
    assert.equal(lines.length, 4);
    assert.equal(
      lines.filter((l) => Number(l.totalPrice) === 700).length,
      0,
      "the un-itemised ticket total must not survive as a cost line",
    );
    const costed = lines.find((l) => l.partId === PART_COSTED);
    assert.ok(costed);
    assert.equal(Number(costed!.quantity), 2);
    assert.equal(Number(costed!.partCost), 60);
  });

  it("a generated invoice costs its parts from the catalog, not from a percentage of price", async () => {
    const lines = await load([INVOICE_ID]);
    const r = computeGrossMargin({
      invoices: [
        invoice({ id: INVOICE_ID, totalAmount: "1000", createdAt: new Date(2026, 4, 3) }),
      ],
      workOrders: [],
      billingSheets: [],
      invoiceLineItems: lines,
      usersById: users,
      fallbackHourlyWage: 25,
      partsCostPct: 65,
      window: WINDOW,
    });

    // Known: 2 × 60 = 120 from the catalog-costed work-order part.
    // Estimated at 65%: the manual work-order line (80 → 52), the no-cost
    // billing-sheet part (2 × 50 = 100 → 65) and the other tenant's part
    // (80 → 52). 52 + 65 + 52 = 169.
    assert.equal(r.partsCost, 120 + 169);
    assert.equal(r.estimatedPartsCostShortfall, 169);
    assert.equal(r.missingCostPartLineCount, 3);
  });

  it("a reissued summary line with no labor_total never has its labor charged as parts", async () => {
    const lines = await load([INVOICE_ID]);
    const fromBillingSheet = lines.filter(
      (l) => l.partId === PART_NO_COST || l.partId === PART_FOREIGN,
    );

    // The reissued line carried the whole 300 ticket total and no labor_total.
    // Had it been estimated as written, 65% of 300 = 195 would have been
    // charged as parts cost — most of it labor. Expanded, only the 180 the
    // ticket actually billed in parts is in play.
    assert.equal(fromBillingSheet.length, 2);
    const billedParts = fromBillingSheet.reduce(
      (s, l) => s + Number(l.totalPrice),
      0,
    );
    assert.equal(billedParts, 180);
    for (const l of fromBillingSheet) {
      assert.equal(Number(l.laborTotal), 0);
    }
  });

  it("a ticket's part cannot resolve another company's catalog cost", async () => {
    const lines = await load([INVOICE_ID]);
    const foreign = lines.find((l) => l.partId === PART_FOREIGN);
    assert.ok(foreign);
    assert.equal(
      foreign!.partCost,
      null,
      "company B's part must not lend its cost to company A's invoice",
    );
  });
});

// ── Tenancy: a line can never resolve another company's cost ───────────────
//
// The estimate path is what makes this safe to assert: a foreign part resolves
// no cost at all, so the line falls to the flagged estimate rather than
// quietly borrowing the other tenant's number.

describe("Task #2014 — the parts join cannot cross companies", () => {
  const COMPANY_A = 2;
  const COMPANY_B = 100;
  const CUSTOMER_ID = 902014;
  const INVOICE_ID = 902014;
  const PART_OWN = 902014; // belongs to company A
  const PART_FOREIGN = 902015; // belongs to company B
  const ITEM_OWN = 902014;
  const ITEM_FOREIGN = 902015;
  const SEED_DATE = new Date(Date.UTC(2026, 4, 3, 12, 0, 0)).toISOString();

  let loadInvoiceLineCostsForInvoices: (
    ids: number[],
  ) => Promise<InvoiceLineCostLike[]>;
  let db: typeof import("../db").db;

  before(async () => {
    ({ db } = await import("../db"));
    ({ loadInvoiceLineCostsForInvoices } = await import("./financial-pulse"));

    await db.execute(
      sql`INSERT INTO customers (id, company_id, name, email)
          VALUES (${CUSTOMER_ID}, ${COMPANY_A}, ${"Task 2014 Tenancy Customer"},
                  ${"task-2014-tenancy@example.test"})
          ON CONFLICT (id) DO NOTHING`,
    );
    await db.execute(
      sql`INSERT INTO invoices
            (id, invoice_number, customer_id, company_id, customer_name,
             customer_email, invoice_month, invoice_year, period_start,
             period_end, status, parts_subtotal, labor_subtotal, total_amount,
             created_at)
          VALUES
            (${INVOICE_ID}, ${"TASK-2014-TENANCY"}, ${CUSTOMER_ID}, ${COMPANY_A},
             ${"Task 2014 Tenancy Customer"}, ${"task-2014-tenancy@example.test"},
             5, 2026, ${SEED_DATE}, ${SEED_DATE}, ${"sent"},
             ${"300.00"}, ${"0.00"}, ${"300.00"}, ${SEED_DATE})
          ON CONFLICT (id) DO NOTHING`,
    );
    await db.execute(
      sql`INSERT INTO parts (id, company_id, name, price, cost, sku, category)
          VALUES
            (${PART_OWN}, ${COMPANY_A}, ${"Task 2014 Own Part"}, ${"100.00"},
             ${"40.00"}, ${"TASK-2014-OWN"}, ${"Testing"}),
            (${PART_FOREIGN}, ${COMPANY_B}, ${"Task 2014 Foreign Part"},
             ${"100.00"}, ${"40.00"}, ${"TASK-2014-FOREIGN"}, ${"Testing"})
          ON CONFLICT (id) DO NOTHING`,
    );
    await db.execute(
      sql`INSERT INTO invoice_items
            (id, invoice_id, source_type, source_id, work_date, description,
             part_id, quantity, unit_price, total_price, labor_total)
          VALUES
            (${ITEM_OWN}, ${INVOICE_ID}, ${"billing_sheet"}, ${1}, ${SEED_DATE},
             ${"Task 2014 own-company part line"}, ${PART_OWN},
             ${"1.00"}, ${"100.00"}, ${"100.00"}, ${"0.00"}),
            (${ITEM_FOREIGN}, ${INVOICE_ID}, ${"billing_sheet"}, ${1}, ${SEED_DATE},
             ${"Task 2014 foreign-company part line"}, ${PART_FOREIGN},
             ${"1.00"}, ${"200.00"}, ${"200.00"}, ${"0.00"})
          ON CONFLICT (id) DO NOTHING`,
    );
  });

  after(async () => {
    await db.execute(
      sql`DELETE FROM invoice_items WHERE id IN (${ITEM_OWN}, ${ITEM_FOREIGN})`,
    );
    await db.execute(sql`DELETE FROM invoices WHERE id = ${INVOICE_ID}`);
    await db.execute(
      sql`DELETE FROM parts WHERE id IN (${PART_OWN}, ${PART_FOREIGN})`,
    );
    await db.execute(sql`DELETE FROM customers WHERE id = ${CUSTOMER_ID}`);
  });

  it("resolves the cost of the invoice's own company's part and nothing for another company's", async () => {
    const rows = await loadInvoiceLineCostsForInvoices([INVOICE_ID]);
    const own = rows.find((r) => r.partId === PART_OWN);
    const foreign = rows.find((r) => r.partId === PART_FOREIGN);

    assert.ok(own, "own-company line should load");
    assert.ok(foreign, "foreign-company line should load");
    assert.equal(Number(own!.partCost), 40);
    assert.equal(
      foreign!.partCost,
      null,
      "a part owned by another company must not resolve a cost",
    );
  });

  it("the foreign line is estimated and flagged instead of borrowing the other company's cost", async () => {
    const rows = await loadInvoiceLineCostsForInvoices([INVOICE_ID]);
    const r = computeGrossMargin({
      invoices: [
        invoice({ id: INVOICE_ID, totalAmount: "300", createdAt: new Date(2026, 4, 3) }),
      ],
      workOrders: [],
      billingSheets: [],
      invoiceLineItems: rows,
      usersById: users,
      fallbackHourlyWage: 25,
      partsCostPct: 65,
      window: WINDOW,
    });

    // own line: 1 × 40 known. foreign line: 200 billed × 65% estimated = 130.
    assert.equal(r.partsCost, 170);
    assert.equal(r.estimatedPartsCostShortfall, 130);
    assert.equal(r.missingCostPartLineCount, 1);
  });
});
