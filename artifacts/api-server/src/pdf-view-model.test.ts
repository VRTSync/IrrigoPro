// Locks in the per-branch invoice PDF layout introduced by Task #479.
//
// Covers:
//   * buildPdfViewModel — branch grouping, sort order, per-branch sums
//   * reconciliationPage — grouped vs flat HTML based on customerHasBranches
//   * ticketPageWO / ticketPageBS — "Branch:" header line presence

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildPdfViewModel,
  type InvoiceDetailData,
  type PdfWorkOrderRow,
  type PdfBillingSheetRow,
  type PdfViewModel,
} from "./pdf-view-model";
import {
  reconciliationPage,
  ticketPageWO,
  ticketPageBS,
} from "./pdf-helpers";

// ── Fixture builders ────────────────────────────────────────────────────────

function makeInvoice(overrides: Record<string, unknown> = {}): any {
  return {
    invoiceNumber: "INV-001",
    periodStart: new Date("2026-01-01"),
    periodEnd: new Date("2026-01-31"),
    customerName: "Test Customer",
    customerEmail: "test@example.com",
    customerPhone: "555-0100",
    totalAmount: "0",
    partsSubtotal: "0",
    laborSubtotal: "0",
    ...overrides,
  };
}

function makeWO(
  workOrderNumber: string,
  branchName: string | null,
  totalAmount: number,
): { workOrder: any; items: any[] } {
  return {
    workOrder: {
      workOrderNumber,
      branchName,
      projectName: "Service",
      projectAddress: "123 Main St",
      locationNotes: "",
      assignedTechnicianName: "Tech",
      completedByUserName: "Tech",
      completedAt: new Date("2026-01-15"),
      totalHours: "1",
      laborRate: "100",
      appliedLaborRate: "100",
      laborSubtotal: String(totalAmount),
      totalPartsCost: "0",
      totalAmount: String(totalAmount),
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

function makeBS(
  billingNumber: string,
  branchName: string | null,
  totalAmount: number,
): { billingSheet: any; items: any[] } {
  return {
    billingSheet: {
      billingNumber,
      branchName,
      workDescription: "Extra",
      propertyAddress: "456 Side Rd",
      technicianName: "Tech",
      workDate: new Date("2026-01-20"),
      totalHours: "1",
      laborRate: "100",
      laborSubtotal: String(totalAmount),
      partsSubtotal: "0",
      totalAmount: String(totalAmount),
      aiDetailedDescription: "",
      notes: "",
      photos: [],
      approvedBy: null,
      approvedAt: null,
    },
    items: [],
  };
}

function makeData(overrides: Partial<InvoiceDetailData>): InvoiceDetailData {
  return {
    invoice: makeInvoice(),
    company: { name: "ACME" },
    workOrders: [],
    billingSheets: [],
    ...overrides,
  };
}

// ── buildPdfViewModel ───────────────────────────────────────────────────────

describe("buildPdfViewModel — branch grouping (Task #479)", () => {
  it("produces empty branchSubtotals when customerHasBranches is false", () => {
    const { viewModel } = buildPdfViewModel(
      makeData({
        invoice: makeInvoice({ totalAmount: "300" }),
        workOrders: [makeWO("WO-1", "First Bank", 100), makeWO("WO-2", "PNC", 200)],
        customerHasBranches: false,
      }),
    );
    assert.equal(viewModel.customerHasBranches, false);
    assert.deepEqual(viewModel.branchSubtotals, []);
  });

  it("groups WOs and BSes by branchName, sorts alphabetically, and pushes (No branch) last", () => {
    const data = makeData({
      invoice: makeInvoice({ totalAmount: "650" }),
      workOrders: [
        makeWO("WO-1", "PNC", 100),
        makeWO("WO-2", "First Bank", 200),
        makeWO("WO-3", null, 50),
      ],
      billingSheets: [
        makeBS("BS-1", "PNC", 50),
        makeBS("BS-2", "First Bank", 250),
      ],
      customerHasBranches: true,
    });
    const { viewModel } = buildPdfViewModel(data);

    assert.equal(viewModel.customerHasBranches, true);
    const names = viewModel.branchSubtotals.map((g) => g.branchName);
    assert.deepEqual(names, ["First Bank", "PNC", "(No branch)"]);

    const firstBank = viewModel.branchSubtotals[0];
    assert.equal(firstBank.workOrders.length, 1);
    assert.equal(firstBank.workOrders[0].workOrderNumber, "WO-2");
    assert.equal(firstBank.billingSheets.length, 1);
    assert.equal(firstBank.billingSheets[0].billingNumber, "BS-2");
    assert.equal(firstBank.subtotal, 450);

    const pnc = viewModel.branchSubtotals[1];
    assert.equal(pnc.subtotal, 150);

    const unassigned = viewModel.branchSubtotals[2];
    assert.equal(unassigned.workOrders.length, 1);
    assert.equal(unassigned.billingSheets.length, 0);
    assert.equal(unassigned.subtotal, 50);
  });

  it("per-branch subtotals sum to the grand total", () => {
    const { viewModel } = buildPdfViewModel(
      makeData({
        invoice: makeInvoice({ totalAmount: "650" }),
        workOrders: [
          makeWO("WO-1", "PNC", 100),
          makeWO("WO-2", "First Bank", 200),
          makeWO("WO-3", null, 50),
        ],
        billingSheets: [
          makeBS("BS-1", "PNC", 50),
          makeBS("BS-2", "First Bank", 250),
        ],
        customerHasBranches: true,
      }),
    );
    const sum = viewModel.branchSubtotals.reduce((s, g) => s + g.subtotal, 0);
    assert.equal(sum, viewModel.totals.grandTotal);
    assert.equal(sum, 650);
  });

  it("normalizes whitespace-only branchName to null", () => {
    const { viewModel } = buildPdfViewModel(
      makeData({
        invoice: makeInvoice({ totalAmount: "10" }),
        workOrders: [makeWO("WO-1", "   ", 10)],
        customerHasBranches: true,
      }),
    );
    assert.equal(viewModel.workOrders[0].branchName, null);
    assert.equal(viewModel.branchSubtotals[0].branchName, "(No branch)");
  });
});

// ── reconciliationPage ──────────────────────────────────────────────────────

function makeViewModel(
  customerHasBranches: boolean,
  workOrders: Array<{ workOrder: any; items: any[] }>,
  billingSheets: Array<{ billingSheet: any; items: any[] }>,
): PdfViewModel {
  const total = [
    ...workOrders.map((w) => Number(w.workOrder.totalAmount)),
    ...billingSheets.map((b) => Number(b.billingSheet.totalAmount)),
  ].reduce((s, n) => s + n, 0);
  return buildPdfViewModel(
    makeData({
      invoice: makeInvoice({ totalAmount: String(total) }),
      workOrders,
      billingSheets,
      customerHasBranches,
    }),
  ).viewModel;
}

describe("reconciliationPage — branch-aware HTML (Task #479)", () => {
  it("emits branch-grouped layout when customerHasBranches is true", () => {
    const vm = makeViewModel(
      true,
      [makeWO("WO-1", "First Bank", 100), makeWO("WO-2", "PNC", 200)],
      [makeBS("BS-1", "PNC", 50)],
    );
    const html = reconciliationPage(vm);

    assert.match(html, /recon-group-branch/);
    assert.match(html, /Branch: First Bank/);
    assert.match(html, /Branch: PNC/);
    assert.match(html, /First Bank Subtotal/);
    assert.match(html, /PNC Subtotal/);
    // Flat-layout group headers must NOT appear
    assert.doesNotMatch(html, /recon-group-wo/);
    assert.doesNotMatch(html, /recon-group-bs/);
    assert.doesNotMatch(html, /Work Orders Subtotal/);
    assert.doesNotMatch(html, /Billing Sheets Subtotal/);
  });

  it("emits flat layout when customerHasBranches is false", () => {
    const vm = makeViewModel(
      false,
      [makeWO("WO-1", "First Bank", 100)],
      [makeBS("BS-1", "PNC", 50)],
    );
    const html = reconciliationPage(vm);

    assert.match(html, /recon-group-wo/);
    assert.match(html, /recon-group-bs/);
    assert.match(html, /Work Orders Subtotal/);
    assert.match(html, /Billing Sheets Subtotal/);
    assert.doesNotMatch(html, /recon-group-branch/);
    assert.doesNotMatch(html, /Branch: /);
  });
});

// ── ticketPageWO / ticketPageBS ─────────────────────────────────────────────

function woRow(branchName: string | null): PdfWorkOrderRow {
  return {
    workOrderNumber: "WO-1",
    projectName: "Job",
    projectAddress: "123 Main",
    branchName,
    locationNotes: "",
    technicianName: "Tech",
    completedAt: new Date("2026-01-15"),
    totalHours: 1,
    laborRate: 100,
    workDescription: "",
    workSummary: "",
    aiDetailedDescription: "",
    photos: [],
    items: [],
    partsSubtotal: 0,
    laborSubtotal: 100,
    rowTotal: 100,
    approvedBy: null,
    approvedAt: null,
  };
}

function bsRow(branchName: string | null): PdfBillingSheetRow {
  return {
    billingNumber: "BS-1",
    workDescription: "Extra",
    propertyAddress: "456 Side",
    branchName,
    technicianName: "Tech",
    workDate: new Date("2026-01-20"),
    totalHours: 1,
    laborRate: 100,
    aiDetailedDescription: "",
    notes: "",
    photos: [],
    items: [],
    partsSubtotal: 0,
    laborSubtotal: 100,
    rowTotal: 100,
    approvedBy: null,
    approvedAt: null,
  };
}

describe("ticketPageWO — Branch header line (Task #479)", () => {
  it("renders the Branch line when branchName is set", () => {
    const html = ticketPageWO(woRow("First Bank"), "INV-1", []);
    assert.match(html, /ticket-header-branch/);
    assert.match(html, /Branch: First Bank/);
  });

  it("omits the Branch line when branchName is null", () => {
    const html = ticketPageWO(woRow(null), "INV-1", []);
    assert.doesNotMatch(html, /ticket-header-branch/);
    assert.doesNotMatch(html, /Branch: /);
  });

  it("omits the Branch line when branchName is an empty string", () => {
    const html = ticketPageWO(woRow(""), "INV-1", []);
    assert.doesNotMatch(html, /ticket-header-branch/);
    assert.doesNotMatch(html, /Branch: /);
  });
});

describe("ticketPageBS — Branch header line (Task #479)", () => {
  it("renders the Branch line when branchName is set", () => {
    const html = ticketPageBS(bsRow("PNC"), "INV-1", []);
    assert.match(html, /ticket-header-branch/);
    assert.match(html, /Branch: PNC/);
  });

  it("omits the Branch line when branchName is null", () => {
    const html = ticketPageBS(bsRow(null), "INV-1", []);
    assert.doesNotMatch(html, /ticket-header-branch/);
    assert.doesNotMatch(html, /Branch: /);
  });

  it("omits the Branch line when branchName is an empty string", () => {
    const html = ticketPageBS(bsRow(""), "INV-1", []);
    assert.doesNotMatch(html, /ticket-header-branch/);
    assert.doesNotMatch(html, /Branch: /);
  });
});
