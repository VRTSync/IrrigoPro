/**
 * pdf-helpers-wet-check.test.ts
 * Acceptance tests for partsBlockForWetCheckBS (Slice 7).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { partsBlockForWetCheckBS, buildFullCSS, ticketPageBS } from './pdf-helpers';
import { DEFAULT_BRAND_COLORS } from './pdf-view-model';
import type { WetCheckBillingView, } from './wet-check-billing-view';

// ── 2-zone fixture ────────────────────────────────────────────────────────────

const FIXTURE: WetCheckBillingView = {
  billingSheetId: 1,
  billingNumber: 'BS-001',
  customerId: 10,
  customerName: 'Acme Corp',
  workDate: new Date('2026-05-01').toISOString(),
  laborRate: '75.00',
  inspection: {
    wetCheckId: 5,
    technicianName: 'Jane Smith',
    inspectionDate: new Date('2026-05-01').toISOString(),
    propertyAddress: '123 Main St',
    weather: 'Clear',
    notes: null,
  },
  zones: [
    {
      controllerLetter: 'A',
      zoneNumber: 1,
      zoneLabel: 'A-1',
      zoneRecordId: 101,
      repairLaborHours: '1.50',
      repairLaborManuallySet: false,
      zonePhotoUrls: [],
      lineItems: [
        {
          findingId: 1,
          issueType: 'head_replacement',
          issueDisplayLabel: 'Head Replacement',
          partName: 'Rotor Head',
          quantity: 2,
          unitPrice: '15.00',
          partsTotal: '30.00',
          laborHours: '0.75',
          laborTotal: '56.25',
          lineTotal: '86.25',
          noPartNeeded: false,
          notes: null,
          findingPhotoUrls: [],
        },
        {
          // labor-only: noPartNeeded=true, partsTotal=$0 — must appear
          findingId: 2,
          issueType: 'adjustment',
          issueDisplayLabel: 'Adjustment',
          partName: null,
          quantity: 1,
          unitPrice: '0.00',
          partsTotal: '0.00',
          laborHours: '0.25',
          laborTotal: '18.75',
          lineTotal: '18.75',
          noPartNeeded: true,
          notes: 'Adjusted spray arc',
          findingPhotoUrls: [],
        },
        {
          // $0.00 non-labor-only: must be ABSENT
          findingId: 3,
          issueType: 'valve_repair',
          issueDisplayLabel: 'Valve Repair',
          partName: 'Solenoid',
          quantity: 1,
          unitPrice: '0.00',
          partsTotal: '0.00',
          laborHours: '0.50',
          laborTotal: '37.50',
          lineTotal: '37.50',
          noPartNeeded: false,
          notes: null,
          findingPhotoUrls: [],
        },
      ],
      zonePartsSubtotal: '30.00',
      zoneLaborSubtotal: '112.50',
      zoneTotal: '142.50',
    },
    {
      controllerLetter: 'B',
      zoneNumber: 2,
      zoneLabel: 'B-2',
      zoneRecordId: 102,
      repairLaborHours: '0.50',
      repairLaborManuallySet: false,
      zonePhotoUrls: [],
      lineItems: [
        {
          findingId: 4,
          issueType: 'pipe_leak',
          issueDisplayLabel: 'Pipe Leak',
          partName: 'PVC Pipe',
          quantity: 3,
          unitPrice: '5.00',
          partsTotal: '15.00',
          laborHours: '0.50',
          laborTotal: '37.50',
          lineTotal: '52.50',
          noPartNeeded: false,
          notes: null,
          findingPhotoUrls: [],
        },
      ],
      zonePartsSubtotal: '15.00',
      zoneLaborSubtotal: '37.50',
      zoneTotal: '52.50',
    },
  ],
  repairsSummary: '4 repairs across 2 zones',
  partsSubtotal: '45.00',
  laborSubtotal: '150.00',
  grandTotal: '195.00',
  totalsSource: 'live_derive',
  zonesHaveStaleLaborData: false,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('partsBlockForWetCheckBS', () => {
  const html = partsBlockForWetCheckBS(FIXTURE, DEFAULT_BRAND_COLORS);

  it('contains "Repairs Summary" exactly once', () => {
    const matches = html.match(/Repairs Summary/g);
    assert.ok(matches !== null, 'Expected "Repairs Summary" to appear');
    assert.equal(matches!.length, 1, 'Expected exactly one "Repairs Summary"');
  });

  it('contains zone A-1 display label', () => {
    assert.ok(html.includes('Zone A-1'), 'Expected Zone A-1 label');
  });

  it('contains zone B-2 display label', () => {
    assert.ok(html.includes('Zone B-2'), 'Expected Zone B-2 label');
  });

  it('suppresses $0.00 non-labor-only item (Valve Repair / Solenoid)', () => {
    assert.ok(!html.includes('Solenoid'), 'Solenoid should be suppressed ($0 non-labor-only)');
    assert.ok(!html.includes('Valve Repair'), 'Valve Repair should be suppressed ($0 non-labor-only)');
  });

  it('includes labor-only item (Adjustment, noPartNeeded=true) even though partsTotal=$0', () => {
    assert.ok(html.includes('Adjustment'), 'Expected labor-only Adjustment to appear');
  });

  it('includes non-zero parts item (Head Replacement with $30 parts)', () => {
    assert.ok(html.includes('Head Replacement'), 'Expected Head Replacement to appear');
    assert.ok(html.includes('Rotor Head'), 'Expected Rotor Head part to appear');
  });

  it('each zone block has zone-block class for page-break-inside: avoid', () => {
    const blockMatches = html.match(/class="zone-block"/g);
    assert.ok(blockMatches !== null, 'Expected zone-block elements');
    assert.equal(blockMatches!.length, 2, 'Expected 2 zone-block elements for 2 zones');
  });

  it('includes zone subtotals in the HTML', () => {
    assert.ok(html.includes('Zone A-1 Subtotal'), 'Expected Zone A-1 Subtotal');
    assert.ok(html.includes('Zone B-2 Subtotal'), 'Expected Zone B-2 Subtotal');
  });

  it('partsSubtotal + laborSubtotal grand total matches view grandTotal', () => {
    const parts = parseFloat(FIXTURE.partsSubtotal);
    const labor = parseFloat(FIXTURE.laborSubtotal);
    const grand = parseFloat(FIXTURE.grandTotal);
    assert.ok(
      Math.abs(parts + labor - grand) < 0.01,
      `Expected partsSubtotal(${parts}) + laborSubtotal(${labor}) = grandTotal(${grand})`,
    );
  });
});

describe('ticketPageBS — wet check financial breakdown', () => {
  it('shows single Labor row when wetCheckView is absent', () => {
    const bsRow = {
      billingNumber: 'BS-002',
      workDescription: 'Regular service',
      propertyAddress: '456 Elm St',
      branchName: null,
      controllerLetter: null,
      zoneNumber: null,
      technicianName: 'Joe Tech',
      workDate: new Date('2026-05-01'),
      totalHours: 3,
      laborRate: 75,
      aiDetailedDescription: '',
      notes: '',
      photos: [],
      items: [],
      partsSubtotal: 0,
      laborSubtotal: 225,
      rowTotal: 225,
      approvedBy: null,
      approvedAt: null,
      // no wetCheckView
    };

    const html: string = ticketPageBS(bsRow, 'INV-002', [], null, undefined, DEFAULT_BRAND_COLORS);
    assert.ok(!html.includes('Inspection Labor'), 'Should not have Inspection Labor for non-WC sheet');
    assert.ok(!html.includes('Repair Labor'), 'Should not have Repair Labor for non-WC sheet');
    assert.ok(html.includes('Labor ('), 'Expected single legacy Labor row');
  });
});

describe('buildFullCSS zone-block rule', () => {
  it('includes page-break-inside: avoid for .zone-block', () => {
    const css = buildFullCSS(DEFAULT_BRAND_COLORS);
    assert.ok(css.includes('.zone-block'), 'Expected .zone-block class in CSS');
    const zoneBlockIdx = css.indexOf('.zone-block');
    const afterZoneBlock = css.slice(zoneBlockIdx, zoneBlockIdx + 200);
    assert.ok(
      afterZoneBlock.includes('page-break-inside: avoid'),
      'Expected page-break-inside: avoid in .zone-block rule',
    );
  });
});
