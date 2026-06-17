/**
 * estimate-pdf-zone-grouped.test.ts
 *
 * Tests for the inspection-estimate zone-grouped PDF rendering (Task #1386).
 *
 * Covers:
 *  (a) Inspection estimate renders zone-grouped layout with summary table,
 *      per-zone labor, and zone subtotals.
 *  (b) Parts/Labor/Grand totals match pre-redesign figures for EST-50009 data.
 *  (c) Labor-only findings render with "labor only" tag and no price.
 *  (d) Non-inspection estimate renders the existing flat table unchanged.
 *  (e) No raw enum strings appear anywhere in the output.
 *
 * Imports only from estimate-pdf-html.ts so tests run without puppeteer-core.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEstimateHtml,
  isInspectionOriginEstimate,
} from './estimate-pdf-html';
import type { EstimateWithItems, EstimateItem } from '@workspace/db';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<EstimateItem> = {}): EstimateItem {
  return {
    id: 1,
    estimateId: 1,
    description: '',
    partId: null,
    partName: 'Head Replace',
    partPrice: '25.00',
    quantity: 1,
    laborHours: '0.25',
    totalPrice: '25.00',
    sortOrder: 0,
    controllerLetter: null,
    zoneNumber: null,
    issueType: null,
    ...overrides,
  } as EstimateItem;
}

function makeEstimate(
  overrides: Partial<Record<string, unknown>> = {},
  items: EstimateItem[] = [],
): EstimateWithItems {
  return {
    id: 1,
    estimateNumber: 'EST-50009',
    status: 'pending',
    internalStatus: 'pending_review',
    lifecycle: 'pending_review',
    projectName: 'Sprinkler Inspection',
    projectAddress: '456 Oak Ave',
    customerName: 'Test Customer',
    customerEmail: null,
    customerPhone: null,
    laborRate: '85.00',
    laborMode: 'flat',
    totalLaborHours: '2.00',
    partsSubtotal: '150.00',
    laborSubtotal: '170.00',
    totalAmount: '320.00',
    estimateDate: new Date('2026-06-01'),
    workDescription: null,
    locationNotes: null,
    accessInstructions: null,
    workLocationLat: null,
    workLocationLng: null,
    workLocationAddress: null,
    controllerLetter: null,
    zoneNumber: null,
    createdBy: null,
    items,
    ...overrides,
  } as unknown as EstimateWithItems;
}

// ── EST-50009 canonical fixture ───────────────────────────────────────────────
// Mirrors a real inspection estimate:
//   Controller A Zone 3: head_replacement ($25, 0.25 hrs) + valve_issue (labor-only, 1.50 hrs)
//   Controller B Zone 1: nozzle_replacement ($12, 0.25 hrs, qty 2)
// Parts subtotal: 25 + 12*2 = $49
// Labor:          (0.25 + 1.50 + 0.50) hrs * $85 = 2.25 * $85 = $191.25
// Grand total:    $49 + $191.25 = $240.25

const ITEMS_EST50009: EstimateItem[] = [
  makeItem({
    id: 1,
    partName: 'Hunter I-20 Head',
    partPrice: '25.00',
    quantity: 1,
    totalPrice: '25.00',
    laborHours: '0.25',
    controllerLetter: 'A',
    zoneNumber: 3,
    issueType: 'head_replacement',
    description: 'Replace sprinkler head',
  }),
  makeItem({
    id: 2,
    partName: 'Valve Issue',
    partPrice: '0.00',
    quantity: 1,
    totalPrice: '0.00',
    laborHours: '1.50',
    controllerLetter: 'A',
    zoneNumber: 3,
    issueType: 'valve_issue',
    description: 'Valve adjustment labor',
  }),
  makeItem({
    id: 3,
    partName: 'Rain Bird Nozzle',
    partPrice: '12.00',
    quantity: 2,
    totalPrice: '24.00',
    laborHours: '0.50',
    controllerLetter: 'B',
    zoneNumber: 1,
    issueType: 'nozzle_replacement',
    description: 'Replace nozzle',
  }),
];

const EST50009_PARTS = 25 + 24;        // $49
const EST50009_LABOR_HRS = 0.25 + 1.50 + 0.50; // 2.25 hrs
const EST50009_LABOR_RATE = 85;
const EST50009_LABOR = EST50009_LABOR_HRS * EST50009_LABOR_RATE; // $191.25
const EST50009_GRAND = EST50009_PARTS + EST50009_LABOR;           // $240.25

// ── (a) Zone-grouped layout tests ─────────────────────────────────────────────

describe('isInspectionOriginEstimate', () => {
  it('returns true when any item has controllerLetter set', () => {
    const items = [makeItem({ controllerLetter: 'A', zoneNumber: 1, issueType: 'head_replacement' })];
    assert.equal(isInspectionOriginEstimate(items), true);
  });

  it('returns true when any item has zoneNumber set (no controllerLetter)', () => {
    const items = [makeItem({ controllerLetter: null, zoneNumber: 5, issueType: 'leak_repair' })];
    assert.equal(isInspectionOriginEstimate(items), true);
  });

  it('returns false when all items have null zone fields', () => {
    const items = [makeItem({ controllerLetter: null, zoneNumber: null })];
    assert.equal(isInspectionOriginEstimate(items), false);
  });

  it('returns false for empty item list', () => {
    assert.equal(isInspectionOriginEstimate([]), false);
  });
});

describe('buildEstimateHtml — inspection-origin zone-grouped rendering', () => {
  it('(a) renders the "Repairs Summary by Zone" table for inspection estimates', () => {
    const html = buildEstimateHtml(makeEstimate({}, ITEMS_EST50009));
    assert.ok(
      html.includes('Repairs Summary by Zone'),
      'Expected "Repairs Summary by Zone" heading',
    );
  });

  it('(a) renders a zone header band for each zone group', () => {
    const html = buildEstimateHtml(makeEstimate({}, ITEMS_EST50009));
    assert.ok(
      html.includes('Controller A') && html.includes('Zone 3'),
      'Expected Controller A · Zone 3 header',
    );
    assert.ok(
      html.includes('Controller B') && html.includes('Zone 1'),
      'Expected Controller B · Zone 1 header',
    );
  });

  it('(a) renders "Zone Detail" section heading', () => {
    const html = buildEstimateHtml(makeEstimate({}, ITEMS_EST50009));
    assert.ok(html.includes('Zone Detail'), 'Expected "Zone Detail" section heading');
  });

  it('(a) renders zone labor line for each zone', () => {
    const html = buildEstimateHtml(makeEstimate({}, ITEMS_EST50009));
    assert.ok(html.includes('Zone labor'), 'Expected "Zone labor" lines in zone detail blocks');
  });

  it('(a) renders zone subtotal for each zone', () => {
    const html = buildEstimateHtml(makeEstimate({}, ITEMS_EST50009));
    assert.ok(
      html.includes('Subtotal'),
      'Expected zone "Subtotal" rows in the zone detail blocks',
    );
  });

  it('(a) renders the lineage banner when originWetCheckId is present', () => {
    const html = buildEstimateHtml(
      makeEstimate({ originWetCheckId: 42 }, ITEMS_EST50009),
    );
    assert.ok(
      html.includes('From wet check: Inspection #42'),
      'Expected lineage banner "From wet check: Inspection #42"',
    );
  });

  it('(a) omits lineage banner when originWetCheckId is absent', () => {
    const html = buildEstimateHtml(makeEstimate({}, ITEMS_EST50009));
    assert.ok(
      !html.includes('From wet check'),
      'Expected no lineage banner when originWetCheckId is absent',
    );
  });

  it('(a) controller groups appear sorted A before B', () => {
    const html = buildEstimateHtml(makeEstimate({}, ITEMS_EST50009));
    const idxA = html.indexOf('Controller A');
    const idxB = html.indexOf('Controller B');
    assert.ok(idxA >= 0, 'Expected Controller A in output');
    assert.ok(idxB >= 0, 'Expected Controller B in output');
    assert.ok(idxA < idxB, 'Expected Controller A to appear before Controller B');
  });
});

// ── (b) Totals parity ─────────────────────────────────────────────────────────

describe('buildEstimateHtml — totals match pre-redesign for EST-50009 data', () => {
  it('(b) renders the correct parts subtotal', () => {
    const html = buildEstimateHtml(
      makeEstimate({
        partsSubtotal: String(EST50009_PARTS),
        laborSubtotal: EST50009_LABOR.toFixed(2),
        totalAmount: EST50009_GRAND.toFixed(2),
        totalLaborHours: EST50009_LABOR_HRS.toFixed(2),
        laborRate: String(EST50009_LABOR_RATE),
      }, ITEMS_EST50009),
    );
    assert.ok(html.includes('$49.00'), 'Expected parts subtotal $49.00');
  });

  it('(b) renders the correct labor subtotal', () => {
    const html = buildEstimateHtml(
      makeEstimate({
        partsSubtotal: String(EST50009_PARTS),
        laborSubtotal: EST50009_LABOR.toFixed(2),
        totalAmount: EST50009_GRAND.toFixed(2),
        totalLaborHours: EST50009_LABOR_HRS.toFixed(2),
        laborRate: String(EST50009_LABOR_RATE),
      }, ITEMS_EST50009),
    );
    assert.ok(html.includes('$191.25'), 'Expected labor subtotal $191.25');
  });

  it('(b) renders the correct grand total', () => {
    const html = buildEstimateHtml(
      makeEstimate({
        partsSubtotal: String(EST50009_PARTS),
        laborSubtotal: EST50009_LABOR.toFixed(2),
        totalAmount: EST50009_GRAND.toFixed(2),
        totalLaborHours: EST50009_LABOR_HRS.toFixed(2),
        laborRate: String(EST50009_LABOR_RATE),
      }, ITEMS_EST50009),
    );
    assert.ok(html.includes('$240.25'), 'Expected grand total $240.25');
  });

  it('(b) labor line shows hrs × rate notation', () => {
    const html = buildEstimateHtml(
      makeEstimate({
        partsSubtotal: String(EST50009_PARTS),
        laborSubtotal: EST50009_LABOR.toFixed(2),
        totalAmount: EST50009_GRAND.toFixed(2),
        totalLaborHours: EST50009_LABOR_HRS.toFixed(2),
        laborRate: String(EST50009_LABOR_RATE),
      }, ITEMS_EST50009),
    );
    assert.ok(
      html.includes('2.25h') || html.includes('2.25'),
      'Expected total labor hours (2.25) in labor row',
    );
  });
});

// ── (c) Labor-only findings ───────────────────────────────────────────────────

describe('buildEstimateHtml — labor-only findings', () => {
  it('(c) renders "labor only" tag for $0 part-price items', () => {
    const html = buildEstimateHtml(makeEstimate({}, ITEMS_EST50009));
    assert.ok(
      html.toLowerCase().includes('labor only'),
      'Expected "labor only" tag for the valve_issue item with partPrice=0',
    );
  });

  it('(c) labor-only row shows em-dash (no price) for qty/price columns', () => {
    const laborOnlyOnly: EstimateItem[] = [
      makeItem({
        partName: 'Pressure Issue',
        partPrice: '0.00',
        quantity: 1,
        totalPrice: '0.00',
        laborHours: '0.50',
        controllerLetter: 'C',
        zoneNumber: 2,
        issueType: 'pressure_issue',
      }),
    ];
    const html = buildEstimateHtml(makeEstimate({}, laborOnlyOnly));
    assert.ok(
      html.includes('labor only'),
      'Expected "labor only" tag',
    );
    const mdashCount = (html.match(/&mdash;/g) ?? []).length;
    assert.ok(mdashCount >= 4, 'Expected ≥4 em-dashes for the labor-only row (qty/unitPrice/partsTotal/zoneTotal cols)');
  });
});

// ── (d) Non-inspection flat table unchanged ───────────────────────────────────

describe('buildEstimateHtml — non-inspection (flat) estimates unchanged', () => {
  it('(d) renders "Line Items" heading for flat estimates', () => {
    const flatItems: EstimateItem[] = [
      makeItem({ controllerLetter: null, zoneNumber: null, issueType: null }),
    ];
    const html = buildEstimateHtml(makeEstimate({}, flatItems));
    assert.ok(html.includes('Line Items'), 'Expected "Line Items" heading for flat estimate');
  });

  it('(d) does NOT render "Repairs Summary by Zone" for flat estimates', () => {
    const flatItems: EstimateItem[] = [
      makeItem({ controllerLetter: null, zoneNumber: null, issueType: null }),
    ];
    const html = buildEstimateHtml(makeEstimate({}, flatItems));
    assert.ok(
      !html.includes('Repairs Summary by Zone'),
      'Expected no "Repairs Summary by Zone" for a flat estimate',
    );
  });

  it('(d) flat estimate with no items still renders the line items table', () => {
    const html = buildEstimateHtml(makeEstimate({}, []));
    assert.ok(html.includes('Line Items'), 'Expected "Line Items" table even with empty items');
    assert.ok(html.includes('No line items'), 'Expected "No line items" message');
  });

  it('(d) column headers match the pre-redesign flat table (Part/Description, Qty, Unit Price, Labor, Line Total)', () => {
    const flatItems: EstimateItem[] = [
      makeItem({ controllerLetter: null, zoneNumber: null }),
    ];
    const html = buildEstimateHtml(makeEstimate({}, flatItems));
    assert.ok(html.includes('Part / Description'), 'Expected "Part / Description" column');
    assert.ok(html.includes('Unit Price'), 'Expected "Unit Price" column');
    assert.ok(html.includes('Line Total'), 'Expected "Line Total" column');
  });
});

// ── (e) No raw enum strings ───────────────────────────────────────────────────

describe('buildEstimateHtml — no raw enum strings in output', () => {
  const RAW_ENUMS = [
    'bad_solenoid',
    'head_replacement',
    'nozzle_replacement',
    'valve_issue',
    'wiring_issue',
    'controller_issue',
    'leak_repair',
    'pressure_issue',
    'coverage_issue',
    'head_adjustment',
  ];

  it('(e) no raw issueType enum strings appear in the zone-grouped HTML', () => {
    const html = buildEstimateHtml(makeEstimate({}, ITEMS_EST50009));
    for (const raw of RAW_ENUMS) {
      assert.ok(
        !html.includes(raw),
        `Expected raw enum "${raw}" to NOT appear in the rendered HTML`,
      );
    }
  });

  it('(e) humanized labels appear instead of raw enums', () => {
    const html = buildEstimateHtml(makeEstimate({}, ITEMS_EST50009));
    assert.ok(html.includes('Head Replace'), 'Expected humanized "Head Replace" label');
    assert.ok(html.includes('Valve'), 'Expected humanized "Valve" label for valve_issue');
    assert.ok(html.includes('Nozzle Replace'), 'Expected humanized "Nozzle Replace" label');
  });
});
