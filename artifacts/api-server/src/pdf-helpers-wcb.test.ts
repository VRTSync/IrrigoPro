/**
 * pdf-helpers-wcb.test.ts  (Task #787 Slice 2)
 *
 * Validates ticketPageWCB HTML output:
 *   - billing number and invoice number in header
 *   - technician name, date, hours
 *   - financial breakdown section (labor, parts, total)
 *   - branch name rendered when present, omitted when absent
 *   - approval block rendered when approvedBy is set
 *   - photo-fail warning rendered when sentinel is present
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ticketPageWCB, FAILED_PHOTO_SENTINEL } from "./pdf-helpers";
import type { PdfWetCheckBillingRow } from "./pdf-view-model";

// ── minimal fixture ───────────────────────────────────────────────────────────

function makeRow(overrides: Partial<PdfWetCheckBillingRow> = {}): PdfWetCheckBillingRow {
  const base: PdfWetCheckBillingRow = {
    wetCheckBillingId: 42,
    wetCheckBilling: {
      id: 42,
      billingNumber: "WCB-2026-001",
      wetCheckId: 5,
      customerId: 10,
      technicianName: "Jane Smith",
      workDate: new Date("2026-05-15").toISOString(),
      totalHours: "2.5",
      laborRate: "80.00",
      appliedLaborRate: "80.00",
      laborSubtotal: "200.00",
      partsSubtotal: "75.00",
      totalAmount: "275.00",
      photos: [],
      approvedBy: null,
      approvedAt: null,
      propertyAddress: "99 Drip Lane",
      branchName: null,
      billedAt: null,
      invoiceId: null,
      status: "approved_passed_to_billing",
      createdAt: new Date("2026-05-15"),
      updatedAt: new Date("2026-05-15"),
    } as any,
    wetCheckView: {
      wetCheckBillingId: 42,
      billingNumber: "WCB-2026-001",
      customerId: 10,
      customerName: "Drip Corp",
      workDate: new Date("2026-05-15").toISOString(),
      laborRate: "80.00",
      inspection: {
        wetCheckId: 5,
        technicianName: "Jane Smith",
        inspectionDate: new Date("2026-05-15").toISOString(),
        propertyAddress: "99 Drip Lane",
        weather: "Sunny",
        notes: null,
      },
      zones: [],
    } as any,
  };
  return { ...base, ...overrides } as PdfWetCheckBillingRow;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("ticketPageWCB — header fields (Task #787)", () => {
  it("includes billing number and invoice number in header", () => {
    const html = ticketPageWCB(makeRow(), "INV-0042", []);
    assert.match(html, /WCB-2026-001/);
    assert.match(html, /INV-0042/);
  });

  it("includes technician name", () => {
    const html = ticketPageWCB(makeRow(), "INV-1", []);
    assert.match(html, /Jane Smith/);
  });

  it("includes total hours", () => {
    const html = ticketPageWCB(makeRow(), "INV-1", []);
    assert.match(html, /2\.5/);
  });

  it("includes property address", () => {
    const html = ticketPageWCB(makeRow(), "INV-1", []);
    assert.match(html, /99 Drip Lane/);
  });
});

describe("ticketPageWCB — financial section (Task #787)", () => {
  it("renders Irrigation Labor line with hours × rate", () => {
    const html = ticketPageWCB(makeRow(), "INV-1", []);
    assert.match(html, /Irrigation Labor/);
    assert.match(html, /\$200\.00/);
  });

  it("renders Parts Subtotal", () => {
    const html = ticketPageWCB(makeRow(), "INV-1", []);
    assert.match(html, /Parts Subtotal/);
    assert.match(html, /\$75\.00/);
  });

  it("renders TOTAL", () => {
    const html = ticketPageWCB(makeRow(), "INV-1", []);
    assert.match(html, /TOTAL/);
    assert.match(html, /\$275\.00/);
  });
});

describe("ticketPageWCB — branch header (Task #787)", () => {
  it("renders branch line when branchName is set on wetCheckBilling", () => {
    const row = makeRow();
    (row.wetCheckBilling as any).branchName = "North Campus";
    const html = ticketPageWCB(row, "INV-1", []);
    assert.match(html, /ticket-header-branch/);
    assert.match(html, /Branch: North Campus/);
  });

  it("omits branch line when branchName is null", () => {
    const html = ticketPageWCB(makeRow(), "INV-1", []);
    assert.doesNotMatch(html, /ticket-header-branch/);
  });
});

describe("ticketPageWCB — approval block (Task #787)", () => {
  it("renders approval block when approvedBy is set", () => {
    const row = makeRow();
    (row.wetCheckBilling as any).approvedBy = "Manager Bob";
    const html = ticketPageWCB(row, "INV-1", []);
    assert.match(html, /ticket-approval/);
    assert.match(html, /Manager Bob/);
  });

  it("omits approval block when approvedBy is null and approvedAt is null", () => {
    const html = ticketPageWCB(makeRow(), "INV-1", []);
    assert.doesNotMatch(html, /ticket-approval/);
  });
});

describe("ticketPageWCB — photo fail warning (Task #787)", () => {
  it("renders photo-fail warning when sentinel is in photoDataUris", () => {
    const html = ticketPageWCB(makeRow(), "INV-1", [
      FAILED_PHOTO_SENTINEL,
      FAILED_PHOTO_SENTINEL,
    ]);
    assert.match(html, /ticket-photo-fail-warning/);
    assert.match(html, /2 photos/);
  });

  it("omits photo-fail warning when no sentinels are present", () => {
    const html = ticketPageWCB(makeRow(), "INV-1", []);
    assert.doesNotMatch(html, /ticket-photo-fail-warning/);
  });
});
