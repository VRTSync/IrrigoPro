/**
 * pdf-view-model-wcb.test.ts  (Task #787 Slice 2)
 *
 * Validates that buildPdfViewModel:
 *   - includes wetCheckBillings in the returned view model
 *   - folds WCB totalAmount values into the grand total
 *   - grand total = sum of WOs + BSes + WCBs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPdfViewModel } from "./pdf-view-model";
import type { InvoiceDetailData, PdfWetCheckBillingRow } from "./pdf-view-model";

// ── fixture helpers ───────────────────────────────────────────────────────────

function makeInvoice(totalAmount: string): any {
  return {
    invoiceNumber: "INV-WCB-TEST",
    periodStart: new Date("2026-05-01"),
    periodEnd: new Date("2026-05-31"),
    customerName: "Test Corp",
    customerEmail: "test@example.com",
    customerPhone: null,
    totalAmount,
    partsSubtotal: "0",
    laborSubtotal: "0",
  };
}

function makeWO(total: number): { workOrder: any; items: any[] } {
  return {
    workOrder: {
      workOrderNumber: `WO-${total}`,
      branchName: null,
      projectName: "Test",
      projectAddress: "1 Main",
      locationNotes: "",
      assignedTechnicianName: "Tech",
      completedByUserName: "Tech",
      completedAt: new Date("2026-05-10"),
      totalHours: "1",
      laborRate: "80",
      appliedLaborRate: "80",
      laborSubtotal: String(total),
      totalPartsCost: "0",
      totalAmount: String(total),
      description: "",
      workSummary: "",
      aiDetailedDescription: "",
      photos: [],
      approvedBy: null,
      approvedAt: null,
    },
    items: [],
  };
}

function makeBS(total: number): { billingSheet: any; items: any[] } {
  return {
    billingSheet: {
      billingNumber: `BS-${total}`,
      branchName: null,
      workDescription: "Extra",
      propertyAddress: "2 Side",
      technicianName: "Tech",
      workDate: new Date("2026-05-10"),
      totalHours: "1",
      laborRate: "80",
      laborSubtotal: String(total),
      partsSubtotal: "0",
      totalAmount: String(total),
      aiDetailedDescription: "",
      notes: "",
      photos: [],
      approvedBy: null,
      approvedAt: null,
    },
    items: [],
  };
}

function makeWCBRow(id: number, total: number): PdfWetCheckBillingRow {
  return {
    wetCheckBillingId: id,
    wetCheckBilling: {
      id,
      billingNumber: `WCB-${id}`,
      totalAmount: String(total),
      laborSubtotal: String(total),
      partsSubtotal: "0",
      totalHours: "1",
      laborRate: "80",
      appliedLaborRate: "80",
      workDate: new Date("2026-05-12").toISOString(),
      technicianName: "Tech",
      photos: [],
      approvedBy: null,
      approvedAt: null,
      branchName: null,
      propertyAddress: null,
    } as any,
    wetCheckView: {
      wetCheckBillingId: id,
      billingNumber: `WCB-${id}`,
      customerId: 1,
      customerName: "Test Corp",
      workDate: new Date("2026-05-12").toISOString(),
      laborRate: "80",
      inspection: {
        wetCheckId: id,
        technicianName: "Tech",
        inspectionDate: new Date("2026-05-12").toISOString(),
        propertyAddress: null,
        weather: null,
        notes: null,
      },
      zones: [],
    } as any,
  };
}

function makeData(overrides: Partial<InvoiceDetailData>): InvoiceDetailData {
  return {
    invoice: makeInvoice("0"),
    company: { name: "ACME" },
    workOrders: [],
    billingSheets: [],
    ...overrides,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("buildPdfViewModel — WCB passthrough (Task #787)", () => {
  it("viewModel.wetCheckBillings is empty when no WCBs supplied", () => {
    const { viewModel } = buildPdfViewModel(
      makeData({ invoice: makeInvoice("100"), workOrders: [makeWO(100)] }),
    );
    assert.equal(viewModel.wetCheckBillings.length, 0);
  });

  it("viewModel.wetCheckBillings contains all supplied rows", () => {
    const { viewModel } = buildPdfViewModel(
      makeData({
        invoice: makeInvoice("300"),
        wetCheckBillings: [makeWCBRow(1, 150), makeWCBRow(2, 150)],
      }),
    );
    assert.equal(viewModel.wetCheckBillings.length, 2);
    assert.equal(viewModel.wetCheckBillings[0].wetCheckBillingId, 1);
    assert.equal(viewModel.wetCheckBillings[1].wetCheckBillingId, 2);
  });
});

describe("buildPdfViewModel — grand total includes WCBs (Task #787)", () => {
  it("grand total = WO + BS + WCB totals", () => {
    const { viewModel } = buildPdfViewModel(
      makeData({
        invoice: makeInvoice("600"),
        workOrders: [makeWO(200)],
        billingSheets: [makeBS(150)],
        wetCheckBillings: [makeWCBRow(1, 250)],
      }),
    );
    assert.equal(viewModel.totals.grandTotal, 600);
  });

  it("grand total = WCB-only when no WOs or BSes", () => {
    const { viewModel } = buildPdfViewModel(
      makeData({
        invoice: makeInvoice("275"),
        wetCheckBillings: [makeWCBRow(42, 275)],
      }),
    );
    assert.equal(viewModel.totals.grandTotal, 275);
  });

  it("multiple WCBs sum correctly into grand total", () => {
    const { viewModel } = buildPdfViewModel(
      makeData({
        invoice: makeInvoice("900"),
        wetCheckBillings: [makeWCBRow(1, 300), makeWCBRow(2, 300), makeWCBRow(3, 300)],
      }),
    );
    assert.equal(viewModel.totals.grandTotal, 900);
  });

  it("WO+BS totals unchanged when WCBs are absent", () => {
    const { viewModel: woOnly } = buildPdfViewModel(
      makeData({
        invoice: makeInvoice("500"),
        workOrders: [makeWO(300)],
        billingSheets: [makeBS(200)],
      }),
    );
    assert.equal(woOnly.totals.grandTotal, 500);
  });
});
