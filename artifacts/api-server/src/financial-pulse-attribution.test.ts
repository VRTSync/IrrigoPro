import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  allocateInvoiceRevenueByTechnician,
  computeByServiceType,
  computeByTechnician,
  computePulseTechnicians,
  computeRevenueMix,
  type InvoiceLike,
} from "./financial-pulse-math";

const createdAt = new Date("2026-09-10T12:00:00Z");
const window = {
  start: new Date("2026-09-01T00:00:00Z"),
  end: new Date("2026-10-01T00:00:00Z"),
};
const invoice = (over: Partial<InvoiceLike> = {}): InvoiceLike => ({
  id: 1,
  customerId: 10,
  totalAmount: "1000.00",
  partsSubtotal: "200.00",
  laborSubtotal: "800.00",
  status: "sent",
  createdAt,
  invoiceYear: 2026,
  ...over,
});
const techs = [
  { id: 1, name: "Six Hours", hourlyWage: "20" },
  { id: 2, name: "Two Hours", hourlyWage: "20" },
];

describe("invoice technician attribution", () => {
  it("splits $1,000 as $750/$250 for 6h and 2h and preserves the sum", () => {
    const shares = allocateInvoiceRevenueByTechnician([invoice()], [
      { invoiceId: 1, technicianId: 1, hours: 6 },
      { invoiceId: 1, technicianId: 2, hours: 2 },
    ]);
    assert.deepEqual(shares.map((share) => share.revenue), [750, 250]);
    assert.equal(shares.reduce((sum, share) => sum + share.revenue, 0), 1000);
  });

  it("splits equally with no usable hours and leaves one-technician invoices unchanged", () => {
    const equal = allocateInvoiceRevenueByTechnician([invoice()], [
      { invoiceId: 1, technicianId: 1, hours: null },
      { invoiceId: 1, technicianId: 2, hours: 0 },
    ]);
    assert.deepEqual(equal.map((share) => share.revenue), [500, 500]);
    const single = allocateInvoiceRevenueByTechnician([invoice()], [
      { invoiceId: 1, technicianId: 1, hours: 6 },
    ]);
    assert.equal(single[0].revenue, 1000);
  });

  it("reconciles Accounting revenue and Pulse YTD to the invoice total", () => {
    const workOrders = [
      { invoiceId: 1, assignedTechnicianId: 1, totalHours: 6 },
      { invoiceId: 1, assignedTechnicianId: 2, totalHours: 2 },
    ];
    const accounting = computeByTechnician({
      techs,
      invoices: [invoice()],
      workOrders,
      billingSheets: [],
      window,
    });
    assert.equal(accounting.reduce((sum, row) => sum + row.revenue, 0), 1000);
    const pulse = computePulseTechnicians({
      techs,
      invoices: [invoice()],
      workOrders: workOrders.map((row) => ({
        ...row,
        customerId: 10,
        totalAmount: 0,
        status: "billed",
        createdAt,
      })),
      billingSheets: [],
      currentYear: 2026,
    });
    assert.equal(pulse.reduce((sum, row) => sum + row.ytd, 0), 1000);
  });

  it("does not attribute an invoice outside the tenant-scoped invoice set", () => {
    const rows = computeByTechnician({
      techs,
      invoices: [invoice()],
      workOrders: [{ invoiceId: 99, assignedTechnicianId: 1, totalHours: 8 }],
      billingSheets: [],
      window,
    });
    assert.equal(rows.reduce((sum, row) => sum + row.revenue, 0), 0);
  });
});

describe("revenue mix and service groups", () => {
  it("counts invoiced subtotals once and uninvoiced wet-check subtotals once", () => {
    const mix = computeRevenueMix({
      invoices: [invoice()],
      items: [],
      customersById: new Map([[10, { id: 10, companyId: 1 }]]),
      window,
      uninvoicedWetCheckBillings: [{ partsSubtotal: 50, laborSubtotal: 75 }],
    });
    assert.deepEqual(mix.partsVsLabor, { parts: 250, labor: 875 });
  });

  it("makes each service group sum to 100% and classifies from rateMode", () => {
    const invoices = [
      invoice(),
      invoice({ id: 2, totalAmount: 500 }),
    ];
    const rows = computeByServiceType({
      invoices,
      items: [],
      customersById: new Map([
        [10, {
          id: 10,
          companyId: 1,
          contractType: "contract",
          laborRate: 100,
          emergencyLaborRate: 100,
        }],
      ]),
      workOrders: [
        { invoiceId: 1, rateMode: "emergency" },
        { invoiceId: 2, rateMode: "normal" },
      ],
      window,
    });
    for (const group of ["urgency", "agreement"] as const) {
      const pctTotal = rows.filter((row) => row.group === group)
        .reduce((sum, row) => sum + (row.pctOfTotal ?? 0), 0);
      assert.ok(
        Math.abs(pctTotal - 100) < 0.000001,
        `${group} percentages must sum to 100%, got ${pctTotal}`,
      );
      assert.equal(
        rows.filter((row) => row.group === group)
          .reduce((sum, row) => sum + row.invoiceCount, 0),
        2,
      );
    }
    assert.equal(rows.find((row) => row.key === "emergency")?.invoiceCount, 1);
  });

  it("treats equal standard/emergency rates as standard in legacy fallback", () => {
    const rows = computeByServiceType({
      invoices: [invoice()],
      items: [{ invoiceId: 1, laborRate: 100 }],
      customersById: new Map([
        [10, { id: 10, companyId: 1, laborRate: 100, emergencyLaborRate: 100 }],
      ]),
      window,
    });
    assert.equal(rows.find((row) => row.key === "emergency")?.invoiceCount, 0);
    assert.equal(rows.find((row) => row.key === "standard")?.invoiceCount, 1);
  });
});