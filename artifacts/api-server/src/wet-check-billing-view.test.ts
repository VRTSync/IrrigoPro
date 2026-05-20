/**
 * Task #752 — Unit tests for buildWetCheckBillingView (pure assembler).
 *
 * Covers:
 *   1. Single zone, single finding
 *   2. Single zone, multiple findings (sums correct)
 *   3. Multi-zone ordering (controllerLetter ASC, zoneNumber ASC)
 *   4. Labor-only finding (noPartNeeded=true, partPrice/qty ignored)
 *   5. $0.00 non-labor-only item included in output (suppression deferred)
 *   6. issueDisplayLabel from config vs. title-cased fallback
 *   7. Labor rate precedence: appliedLaborRate > laborRate > customer.laborRate
 *   8. grandTotal === partsSubtotal + laborSubtotal (invariant)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildWetCheckBillingView } from "./wet-check-billing-view";
import type {
  BuildWetCheckBillingViewInput,
  WetCheckBillingView,
} from "./wet-check-billing-view";

// ─── Fixture helpers ─────────────────────────────────────────────────────────

function makeBS(overrides: Partial<any> = {}): any {
  return {
    id: 1,
    billingNumber: "BS-2026-00001",
    customerId: 10,
    customerName: "Acme Irrigation",
    workDate: new Date("2026-05-01T08:00:00.000Z"),
    status: "approved_passed_to_billing",
    totalHours: "2.00",
    laborRate: "55.00",
    appliedLaborRate: null,
    laborSubtotal: "110.00",
    partsSubtotal: "0.00",
    totalAmount: "110.00",
    laborMode: "flat",
    invoiceId: null,
    photos: [],
    notes: null,
    ...overrides,
  };
}

function makeCustomer(overrides: Partial<any> = {}): any {
  return {
    id: 10,
    name: "Acme Irrigation",
    laborRate: "45.00",
    ...overrides,
  };
}

function makeWetCheck(overrides: Partial<any> = {}): any {
  return {
    id: 100,
    companyId: 2,
    customerId: 10,
    technicianId: 5,
    technicianName: "Jane Tech",
    customerName: "Acme Irrigation",
    propertyAddress: "123 Main St",
    numControllers: 1,
    status: "converted",
    laborMode: "flat",
    totalLaborHours: "2.00",
    startedAt: new Date("2026-05-01T07:00:00.000Z"),
    submittedAt: null,
    approvedAt: null,
    approvedBy: null,
    approvedByName: null,
    fullyConvertedAt: null,
    weather: "Sunny",
    notes: "All zones checked",
    clientId: null,
    createdAt: new Date("2026-05-01T07:00:00.000Z"),
    updatedAt: new Date("2026-05-01T07:00:00.000Z"),
    ...overrides,
  };
}

function makeZoneRecord(id: number, controllerLetter: string, zoneNumber: number, overrides: Partial<any> = {}): any {
  return {
    id,
    wetCheckId: 100,
    controllerLetter,
    zoneNumber,
    status: "checked_with_issues",
    ranSuccessfully: false,
    observedPressure: null,
    observedFlow: null,
    notes: null,
    checkedAt: null,
    checkedBy: null,
    markedCompleteAt: null,
    clientId: null,
    ...overrides,
  };
}

function makeFinding(
  id: number,
  zoneRecordId: number,
  issueType: string,
  overrides: Partial<any> = {},
): any {
  return {
    id,
    zoneRecordId,
    wetCheckId: 100,
    issueType,
    issueGroup: "quick_fix",
    severity: null,
    partId: 50,
    partName: "Rotor Head",
    partPrice: "12.00",
    quantity: 2,
    laborHours: "0.50",
    notes: null,
    resolution: "sent_to_billing_sheet",
    noPartNeeded: false,
    techDisposition: "completed_in_field",
    resolutionDecidedAt: null,
    resolutionDecidedBy: null,
    billingSheetId: 1,
    estimateId: null,
    workOrderId: null,
    convertedAt: null,
    clientId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeConfig(issueType: string, displayLabel: string): any {
  return {
    id: Math.floor(Math.random() * 1000),
    companyId: 2,
    issueType,
    issueGroup: "quick_fix",
    displayLabel,
    defaultLaborHours: "0.50",
    partCategoryFilter: null,
    isActive: true,
    sortOrder: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function baseInput(overrides: Partial<BuildWetCheckBillingViewInput> = {}): BuildWetCheckBillingViewInput {
  const zr1 = makeZoneRecord(1, "A", 1);
  const f1 = makeFinding(1, 1, "head_replacement");
  return {
    billingSheet: makeBS(),
    customer: makeCustomer(),
    wetCheck: makeWetCheck(),
    findings: [f1],
    zoneRecords: [zr1],
    issueTypeConfigs: [makeConfig("head_replacement", "Head Replacement")],
    ...overrides,
  };
}

// Verify grandTotal invariant on any view
function assertGrandTotalInvariant(view: WetCheckBillingView) {
  const parts = parseFloat(view.partsSubtotal);
  const labor = parseFloat(view.laborSubtotal);
  const grand = parseFloat(view.grandTotal);
  assert.ok(
    Math.abs(parts + labor - grand) < 0.001,
    `grandTotal (${grand}) !== partsSubtotal (${parts}) + laborSubtotal (${labor})`,
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("buildWetCheckBillingView", () => {

  it("single zone, single finding — basic shape and math", () => {
    // laborRate from bs.laborRate = 55.00, appliedLaborRate = null
    // finding: partPrice=12, qty=2 → partsTotal=24; laborHours=0.5 → laborTotal=0.5*55=27.5
    const view = buildWetCheckBillingView(baseInput());

    assert.equal(view.billingSheetId, 1);
    assert.equal(view.billingNumber, "BS-2026-00001");
    assert.equal(view.customerId, 10);
    assert.equal(view.customerName, "Acme Irrigation");
    assert.equal(view.laborRate, "55.00");
    assert.equal(view.zones.length, 1);

    const zone = view.zones[0];
    assert.equal(zone.controllerLetter, "A");
    assert.equal(zone.zoneNumber, 1);
    assert.equal(zone.zoneLabel, "A-1");
    assert.equal(zone.lineItems.length, 1);

    const li = zone.lineItems[0];
    assert.equal(li.findingId, 1);
    assert.equal(li.issueDisplayLabel, "Head Replacement");
    assert.equal(li.partName, "Rotor Head");
    assert.equal(li.quantity, 2);
    assert.equal(li.unitPrice, "12.00");
    assert.equal(li.partsTotal, "24.00");
    assert.equal(li.laborHours, "0.50");
    assert.equal(li.laborTotal, "27.50");
    assert.equal(li.lineTotal, "51.50");
    assert.equal(li.noPartNeeded, false);

    assert.equal(zone.zonePartsSubtotal, "24.00");
    assert.equal(zone.zoneLaborSubtotal, "27.50");
    assert.equal(zone.zoneTotal, "51.50");

    assert.equal(view.partsSubtotal, "24.00");
    assert.equal(view.laborSubtotal, "27.50");
    assert.equal(view.grandTotal, "51.50");

    assertGrandTotalInvariant(view);
  });

  it("single zone, multiple findings — sums are correct", () => {
    const zr = makeZoneRecord(1, "A", 1);
    const f1 = makeFinding(1, 1, "head_replacement", { partPrice: "10.00", quantity: 3, laborHours: "0.25" });
    const f2 = makeFinding(2, 1, "valve_repair", { partPrice: "25.00", quantity: 1, laborHours: "1.00" });
    const input = baseInput({
      billingSheet: makeBS({ laborRate: "60.00" }),
      findings: [f1, f2],
      zoneRecords: [zr],
      issueTypeConfigs: [
        makeConfig("head_replacement", "Head Replacement"),
        makeConfig("valve_repair", "Valve Repair"),
      ],
    });

    const view = buildWetCheckBillingView(input);
    assert.equal(view.zones.length, 1);
    const zone = view.zones[0];
    assert.equal(zone.lineItems.length, 2);

    // f1: parts = 10*3 = 30, labor = 0.25*60 = 15; f2: parts = 25*1 = 25, labor = 1.0*60 = 60
    assert.equal(zone.zonePartsSubtotal, "55.00");
    assert.equal(zone.zoneLaborSubtotal, "75.00");
    assert.equal(zone.zoneTotal, "130.00");
    assert.equal(view.partsSubtotal, "55.00");
    assert.equal(view.laborSubtotal, "75.00");
    assert.equal(view.grandTotal, "130.00");

    assertGrandTotalInvariant(view);
  });

  it("multi-zone ordering — controllerLetter ASC then zoneNumber ASC", () => {
    const zrB2 = makeZoneRecord(10, "B", 2);
    const zrA3 = makeZoneRecord(11, "A", 3);
    const zrA1 = makeZoneRecord(12, "A", 1);

    const fB2 = makeFinding(1, 10, "head_replacement");
    const fA3 = makeFinding(2, 11, "head_replacement");
    const fA1 = makeFinding(3, 12, "head_replacement");

    const view = buildWetCheckBillingView(baseInput({
      findings: [fB2, fA3, fA1],
      zoneRecords: [zrB2, zrA3, zrA1],
    }));

    assert.equal(view.zones.length, 3);
    assert.equal(view.zones[0].zoneLabel, "A-1");
    assert.equal(view.zones[1].zoneLabel, "A-3");
    assert.equal(view.zones[2].zoneLabel, "B-2");

    assertGrandTotalInvariant(view);
  });

  it("labor-only finding — noPartNeeded=true means partsTotal=0", () => {
    const zr = makeZoneRecord(1, "A", 1);
    const f = makeFinding(1, 1, "general_labor", {
      noPartNeeded: true,
      partId: null,
      partName: null,
      partPrice: null,
      quantity: 0,
      laborHours: "2.00",
    });

    const view = buildWetCheckBillingView(baseInput({
      billingSheet: makeBS({ laborRate: "50.00" }),
      findings: [f],
      zoneRecords: [zr],
      issueTypeConfigs: [makeConfig("general_labor", "General Labor")],
    }));

    const li = view.zones[0].lineItems[0];
    assert.equal(li.noPartNeeded, true);
    assert.equal(li.partsTotal, "0.00");
    assert.equal(li.laborHours, "2.00");
    assert.equal(li.laborTotal, "100.00");
    assert.equal(li.lineTotal, "100.00");

    assert.equal(view.partsSubtotal, "0.00");
    assert.equal(view.laborSubtotal, "100.00");
    assert.equal(view.grandTotal, "100.00");

    assertGrandTotalInvariant(view);
  });

  it("$0.00 non-labor-only item is included in output — suppression is consumer's job", () => {
    const zr = makeZoneRecord(1, "A", 1);
    const fZeroPrice = makeFinding(1, 1, "head_replacement", {
      partPrice: "0.00",
      quantity: 1,
      laborHours: "0.00",
    });

    const view = buildWetCheckBillingView(baseInput({
      findings: [fZeroPrice],
      zoneRecords: [zr],
    }));

    assert.equal(view.zones[0].lineItems.length, 1);
    const li = view.zones[0].lineItems[0];
    assert.equal(li.partsTotal, "0.00");
    assert.equal(li.laborTotal, "0.00");
    assert.equal(li.lineTotal, "0.00");

    assert.equal(view.grandTotal, "0.00");
    assertGrandTotalInvariant(view);
  });

  it("issueDisplayLabel — uses config label when available, title-cased fallback otherwise", () => {
    const zr = makeZoneRecord(1, "A", 1);
    const fKnown = makeFinding(1, 1, "head_replacement");
    const fUnknown = makeFinding(2, 1, "weird_custom_issue", {
      partPrice: "5.00", quantity: 1, laborHours: "0.00",
    });

    const view = buildWetCheckBillingView(baseInput({
      findings: [fKnown, fUnknown],
      zoneRecords: [zr],
      issueTypeConfigs: [makeConfig("head_replacement", "Replace Sprinkler Head")],
    }));

    const labels = view.zones[0].lineItems.map((li) => li.issueDisplayLabel);
    assert.equal(labels[0], "Replace Sprinkler Head");  // from config
    assert.equal(labels[1], "Weird Custom Issue");      // title-cased fallback
  });

  it("labor rate precedence: appliedLaborRate wins over laborRate and customer.laborRate", () => {
    const view = buildWetCheckBillingView(baseInput({
      billingSheet: makeBS({ appliedLaborRate: "75.00", laborRate: "55.00" }),
      customer: makeCustomer({ laborRate: "45.00" }),
    }));
    assert.equal(view.laborRate, "75.00");
  });

  it("labor rate precedence: laborRate used when appliedLaborRate is null", () => {
    const view = buildWetCheckBillingView(baseInput({
      billingSheet: makeBS({ appliedLaborRate: null, laborRate: "55.00" }),
      customer: makeCustomer({ laborRate: "45.00" }),
    }));
    assert.equal(view.laborRate, "55.00");
  });

  it("labor rate precedence: customer.laborRate used when both bs rates are null", () => {
    const view = buildWetCheckBillingView(baseInput({
      billingSheet: makeBS({ appliedLaborRate: null, laborRate: null as any }),
      customer: makeCustomer({ laborRate: "45.00" }),
    }));
    assert.equal(view.laborRate, "45.00");
  });

  it("labor rate precedence: explicit zero bs.laborRate is preserved, not fallen-through", () => {
    // bs.laborRate = "0.00" (explicitly set) must win over customer.laborRate.
    // This would fail with || coercion; requires nullish ?? semantics.
    const view = buildWetCheckBillingView(baseInput({
      billingSheet: makeBS({ appliedLaborRate: null, laborRate: "0.00" }),
      customer: makeCustomer({ laborRate: "45.00" }),
    }));
    assert.equal(view.laborRate, "0.00");
  });

  it("grandTotal invariant holds across multi-zone multi-finding fixture", () => {
    const zr1 = makeZoneRecord(1, "A", 1);
    const zr2 = makeZoneRecord(2, "A", 2);
    const zr3 = makeZoneRecord(3, "B", 1);

    const findings = [
      makeFinding(1, 1, "head_replacement", { partPrice: "10.00", quantity: 2, laborHours: "0.50" }),
      makeFinding(2, 1, "valve_repair",     { partPrice: "30.00", quantity: 1, laborHours: "1.00" }),
      makeFinding(3, 2, "general_labor",    { noPartNeeded: true, partPrice: null, quantity: 0, laborHours: "1.50" }),
      makeFinding(4, 3, "head_replacement", { partPrice: "10.00", quantity: 1, laborHours: "0.25" }),
    ];

    const view = buildWetCheckBillingView(baseInput({
      billingSheet: makeBS({ laborRate: "60.00" }),
      findings,
      zoneRecords: [zr1, zr2, zr3],
      issueTypeConfigs: [
        makeConfig("head_replacement", "Head Replacement"),
        makeConfig("valve_repair", "Valve Repair"),
        makeConfig("general_labor", "General Labor"),
      ],
    }));

    assertGrandTotalInvariant(view);
    assert.equal(view.zones.length, 3);
    assert.equal(parseFloat(view.grandTotal) > 0, true);
  });

  it("repairsSummary — correct singular/plural forms", () => {
    // 1 repair, 1 zone
    const v1 = buildWetCheckBillingView(baseInput());
    assert.equal(v1.repairsSummary, "1 repair across 1 zone");

    // 3 repairs, 2 zones
    const zr2 = makeZoneRecord(2, "A", 2);
    const v2 = buildWetCheckBillingView(baseInput({
      findings: [
        makeFinding(1, 1, "head_replacement"),
        makeFinding(2, 1, "head_replacement", { partPrice: "5.00" }),
        makeFinding(3, 2, "valve_repair", { partPrice: "20.00" }),
      ],
      zoneRecords: [makeZoneRecord(1, "A", 1), zr2],
    }));
    assert.equal(v2.repairsSummary, "3 repairs across 2 zones");
  });

  it("repairLaborHours per zone is sum of finding.laborHours in that zone", () => {
    const zr = makeZoneRecord(1, "A", 1);
    const f1 = makeFinding(1, 1, "head_replacement", { laborHours: "0.50" });
    const f2 = makeFinding(2, 1, "valve_repair", { laborHours: "1.25" });

    const view = buildWetCheckBillingView(baseInput({
      findings: [f1, f2],
      zoneRecords: [zr],
    }));

    assert.equal(view.zones[0].repairLaborHours, "1.75");
  });

  it("inspection fields are sourced from the wet check row", () => {
    const view = buildWetCheckBillingView(baseInput());
    assert.equal(view.inspection.wetCheckId, 100);
    assert.equal(view.inspection.technicianName, "Jane Tech");
    assert.equal(view.inspection.propertyAddress, "123 Main St");
    assert.equal(view.inspection.weather, "Sunny");
    assert.equal(view.inspection.notes, "All zones checked");
    assert.equal(view.inspection.inspectionDate, "2026-05-01T07:00:00.000Z");
  });
});
