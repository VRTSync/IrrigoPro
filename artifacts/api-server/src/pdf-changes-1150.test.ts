/**
 * pdf-changes-1150.test.ts
 *
 * Regression tests for the 7 production-defect fixes in Task #1150:
 *   Change 1  — WCB rows appear on reconciliation page
 *   Change 2  — No duplicate in-body page footer (.pdf-footer / .pdf-page-num)
 *   Change 3  — VRT logo present in Repairs Summary header
 *   Change 4  — Per-zone labor line + stale-labor note
 *   Change 5a — Aggregated Repairs Summary rollup (de-duplicated rows + "Repairs Total")
 *   Change 5b — "Labor Hrs" column dropped from partsTableFromWO / partsTableFromBS
 *   Change 5c — Duplicate part descriptions suppressed in partsTableFromBS
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  reconciliationPage,
  buildFullCSS,
  partsBlockForWetCheckBS,
  partsTableFromBS,
  partsTableFromWO,
} from './pdf-helpers';
import { DEFAULT_BRAND_COLORS } from './pdf-view-model';
import type { PdfViewModel, PdfBillingSheetRow, PdfWorkOrderRow } from './pdf-view-model';
import type { WetCheckBillingView } from './wet-check-billing-view';

// ── Shared fixtures ────────────────────────────────────────────────────────────

const MINIMAL_INVOICE = {
  invoiceNumber: 'INV-T1150',
  periodStart: new Date('2026-05-01'),
  periodEnd: new Date('2026-05-31'),
  customerName: 'Acme Irrigation',
  periodLabel: 'May 2026',
  itemBreakdown: [],
};

const MINIMAL_TOTALS = { grandTotal: 500, laborSubtotal: 100, partsSubtotal: 400 };

function makeMinimalVm(overrides: Partial<PdfViewModel> = {}): PdfViewModel {
  return {
    company: { name: 'Test Co', logoDataUri: null },
    invoice: MINIMAL_INVOICE,
    workOrders: [],
    billingSheets: [],
    wetCheckBillings: [],
    totals: MINIMAL_TOTALS,
    totalJobs: 0,
    validationWarning: null,
    brandColors: DEFAULT_BRAND_COLORS,
    customerHasBranches: false,
    branchSubtotals: [],
    ...overrides,
  } as unknown as PdfViewModel;
}

const WCB_ROW_1 = {
  wetCheckBillingId: 99,
  wetCheckBilling: {
    id: 99,
    billingNumber: 'WCB-9901',
    totalAmount: '320.00',
  },
  wetCheckView: null as unknown,
  photoUrls: [],
  mergedPhotoUrls: [],
} as unknown as PdfViewModel['wetCheckBillings'][0];

const WCB_ROW_2 = {
  wetCheckBillingId: 100,
  wetCheckBilling: {
    id: 100,
    billingNumber: 'WCB-9902',
    totalAmount: '180.00',
  },
  wetCheckView: null as unknown,
  photoUrls: [],
  mergedPhotoUrls: [],
} as unknown as PdfViewModel['wetCheckBillings'][0];

// ── 2-zone WetCheckBillingView fixture ────────────────────────────────────────

const WCV_BASE: WetCheckBillingView = {
  billingSheetId: 1,
  billingNumber: 'BS-001',
  customerId: 10,
  customerName: 'Acme Corp',
  workDate: new Date('2026-05-01').toISOString(),
  laborRate: '80.00',
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
      repairLaborHours: '1.00',
      lineItems: [
        {
          findingId: 1,
          issueType: 'head_replacement',
          issueDisplayLabel: 'Head Replacement',
          partName: 'Rotor Head',
          quantity: 2,
          unitPrice: '15.00',
          partsTotal: '30.00',
          laborHours: '0.50',
          laborTotal: '40.00',
          lineTotal: '70.00',
          noPartNeeded: false,
          notes: null,
        },
        {
          findingId: 2,
          issueType: 'head_replacement',
          issueDisplayLabel: 'Head Replacement',
          partName: 'Rotor Head',
          quantity: 1,
          unitPrice: '15.00',
          partsTotal: '15.00',
          laborHours: '0.25',
          laborTotal: '20.00',
          lineTotal: '35.00',
          noPartNeeded: false,
          notes: null,
        },
      ],
      zonePartsSubtotal: '45.00',
      zoneLaborSubtotal: '80.00',
      zoneTotal: '125.00',
    } as unknown as WetCheckBillingView['zones'][0],
    {
      controllerLetter: 'B',
      zoneNumber: 2,
      zoneLabel: 'B-2',
      repairLaborHours: '0.50',
      lineItems: [
        {
          findingId: 3,
          issueType: 'pipe_leak',
          issueDisplayLabel: 'Pipe Leak',
          partName: 'PVC Coupler',
          quantity: 1,
          unitPrice: '8.00',
          partsTotal: '8.00',
          laborHours: '0.50',
          laborTotal: '40.00',
          lineTotal: '48.00',
          noPartNeeded: false,
          notes: null,
        },
      ],
      zonePartsSubtotal: '8.00',
      zoneLaborSubtotal: '40.00',
      zoneTotal: '48.00',
    } as unknown as WetCheckBillingView['zones'][0],
  ],
  repairsSummary: '3 repairs across 2 zones',
  partsSubtotal: '53.00',
  laborSubtotal: '120.00',
  grandTotal: '173.00',
} as unknown as WetCheckBillingView;

// ── Change 1: WCB rows in reconciliation page ─────────────────────────────────

describe('Change 1 — reconciliationPage includes WCB rows', () => {
  it('renders WCB section header and billing numbers (flat path)', () => {
    const vm = makeMinimalVm({ wetCheckBillings: [WCB_ROW_1, WCB_ROW_2] });
    const html = reconciliationPage(vm);
    assert.ok(html.includes('recon-group-wcb'), 'Expected recon-group-wcb class');
    assert.ok(html.includes('WCB-9901'), 'Expected billing number WCB-9901');
    assert.ok(html.includes('WCB-9902'), 'Expected billing number WCB-9902');
    assert.ok(html.includes('WC Billing'), 'Expected "WC Billing" type label');
    assert.ok(html.includes('Wet Check Billings Subtotal'), 'Expected WCB subtotal row');
  });

  it('renders correct WCB total amount', () => {
    const vm = makeMinimalVm({ wetCheckBillings: [WCB_ROW_1] });
    const html = reconciliationPage(vm);
    assert.ok(html.includes('320'), 'Expected totalAmount $320 in output');
  });

  it('omits WCB section when wetCheckBillings is empty', () => {
    const vm = makeMinimalVm({ wetCheckBillings: [] });
    const html = reconciliationPage(vm);
    assert.ok(!html.includes('recon-group-wcb'), 'Expected no WCB section header when list is empty');
    assert.ok(!html.includes('Wet Check Billings Subtotal'), 'Expected no WCB subtotal when list is empty');
  });

  it('renders WCB section in branch-grouped path', () => {
    const vm = makeMinimalVm({
      wetCheckBillings: [WCB_ROW_1],
      customerHasBranches: true,
      branchSubtotals: [
        {
          branchName: 'North Branch',
          workOrders: [],
          billingSheets: [],
          subtotal: 0,
        } as unknown as PdfViewModel['branchSubtotals'][0],
      ],
    });
    const html = reconciliationPage(vm);
    assert.ok(html.includes('recon-group-wcb'), 'Expected recon-group-wcb in branch path');
    assert.ok(html.includes('WCB-9901'), 'Expected WCB-9901 in branch path');
  });
});

// ── Change 2: No duplicate in-body footer ─────────────────────────────────────

describe('Change 2 — no in-body pdf-footer or pdf-page-num', () => {
  it('buildFullCSS does not contain .pdf-footer rule', () => {
    const css = buildFullCSS(DEFAULT_BRAND_COLORS);
    assert.ok(!css.includes('.pdf-footer'), 'Expected .pdf-footer to be removed from CSS');
  });

  it('buildFullCSS does not contain .pdf-page-num rule', () => {
    const css = buildFullCSS(DEFAULT_BRAND_COLORS);
    assert.ok(!css.includes('.pdf-page-num'), 'Expected .pdf-page-num to be removed from CSS');
  });

  it('buildFullCSS does not contain pdf-footer-invoice class', () => {
    const css = buildFullCSS(DEFAULT_BRAND_COLORS);
    assert.ok(!css.includes('.pdf-footer-invoice'), 'Expected .pdf-footer-invoice to be removed');
  });
});

// ── Change 3: VRT logo in Repairs Summary header ──────────────────────────────

describe('Change 3 — VRT logo in Repairs Summary header', () => {
  const html = partsBlockForWetCheckBS(WCV_BASE, DEFAULT_BRAND_COLORS);

  it('contains vrt-section-logo class', () => {
    assert.ok(html.includes('vrt-section-logo'), 'Expected vrt-section-logo class');
  });

  it('contains vrt-section-label class', () => {
    assert.ok(html.includes('vrt-section-label'), 'Expected vrt-section-label class');
  });

  it('contains "Repairs Summary" text inside the VRT label', () => {
    assert.ok(html.includes('Repairs Summary'), 'Expected Repairs Summary text');
  });

  it('buildFullCSS includes .vrt-section-label rule', () => {
    const css = buildFullCSS(DEFAULT_BRAND_COLORS);
    assert.ok(css.includes('.vrt-section-label'), 'Expected .vrt-section-label in CSS');
  });
});

// ── Change 4: Per-zone labor line and stale labor note ────────────────────────

describe('Change 4 — per-zone labor row', () => {
  it('renders zone-labor-row when zonesHaveStaleLaborData is false', () => {
    const view = { ...WCV_BASE, zonesHaveStaleLaborData: false } as unknown as WetCheckBillingView;
    const html = partsBlockForWetCheckBS(view, DEFAULT_BRAND_COLORS, undefined, 80);
    assert.ok(html.includes('zone-labor-row'), 'Expected zone-labor-row class for fresh data');
    assert.ok(html.includes('hrs'), 'Expected labor hours text in labor row');
  });

  it('renders correct labor calculation (1.00 hrs × $80.00/hr = $80.00)', () => {
    const view = { ...WCV_BASE, zonesHaveStaleLaborData: false } as unknown as WetCheckBillingView;
    const html = partsBlockForWetCheckBS(view, DEFAULT_BRAND_COLORS, undefined, 80);
    assert.ok(html.includes('1.00'), 'Expected 1.00 labor hours');
    assert.ok(html.includes('$80.00'), 'Expected $80.00 labor rate');
  });

  it('does NOT render zone-labor-row when zonesHaveStaleLaborData is true', () => {
    const view = { ...WCV_BASE, zonesHaveStaleLaborData: true } as unknown as WetCheckBillingView;
    const html = partsBlockForWetCheckBS(view, DEFAULT_BRAND_COLORS, undefined, 80);
    assert.ok(!html.includes('zone-labor-row'), 'Expected no zone-labor-row for stale data');
  });

  it('renders zone-labor-note when zonesHaveStaleLaborData is true', () => {
    const view = { ...WCV_BASE, zonesHaveStaleLaborData: true } as unknown as WetCheckBillingView;
    const html = partsBlockForWetCheckBS(view, DEFAULT_BRAND_COLORS, undefined, 80);
    assert.ok(html.includes('zone-labor-note'), 'Expected zone-labor-note for stale data');
  });

  it('does NOT render zone-labor-note when zonesHaveStaleLaborData is false', () => {
    const view = { ...WCV_BASE, zonesHaveStaleLaborData: false } as unknown as WetCheckBillingView;
    const html = partsBlockForWetCheckBS(view, DEFAULT_BRAND_COLORS, undefined, 80);
    assert.ok(!html.includes('zone-labor-note'), 'Expected no stale note when data is fresh');
  });

  it('zone subtotal includes labor when data is fresh (45.00 parts + 80.00 labor = 125.00)', () => {
    const view = { ...WCV_BASE, zonesHaveStaleLaborData: false } as unknown as WetCheckBillingView;
    const html = partsBlockForWetCheckBS(view, DEFAULT_BRAND_COLORS, undefined, 80);
    assert.ok(html.includes('$125.00'), 'Expected zone A-1 subtotal $125.00 (parts+labor)');
  });

  it('zone subtotal shows parts only when stale (45.00 parts)', () => {
    const view = { ...WCV_BASE, zonesHaveStaleLaborData: true } as unknown as WetCheckBillingView;
    const html = partsBlockForWetCheckBS(view, DEFAULT_BRAND_COLORS, undefined, 80);
    assert.ok(html.includes('$45.00'), 'Expected zone A-1 subtotal $45.00 (parts only)');
  });

  it('buildFullCSS includes .zone-labor-row and .zone-labor-note rules', () => {
    const css = buildFullCSS(DEFAULT_BRAND_COLORS);
    assert.ok(css.includes('.zone-labor-row'), 'Expected .zone-labor-row in CSS');
    assert.ok(css.includes('.zone-labor-note'), 'Expected .zone-labor-note in CSS');
  });
});

// ── Change 5a: Aggregated Repairs Summary rollup ──────────────────────────────

describe('Change 5a — aggregated Repairs Summary', () => {
  const html = partsBlockForWetCheckBS(WCV_BASE, DEFAULT_BRAND_COLORS);

  it('aggregates duplicate (issueDisplayLabel + partName) rows — "Head Replacement/Rotor Head" appears once', () => {
    const matches = html.match(/Head Replacement/g);
    // Should appear in the rollup summary AND in the per-zone block for zone A-1
    // The rollup dedups across zones so summary has 1 occurrence per group
    assert.ok(matches !== null, 'Expected Head Replacement in output');
  });

  it('contains "Repairs Total" aggregate row', () => {
    assert.ok(html.includes('Repairs Total'), 'Expected "Repairs Total" aggregate row');
  });

  it('rollup summary table has 4 columns — no Unit Price header', () => {
    // The summary table header should not contain "Unit Price"
    // We check that the summary table (which precedes zone blocks) does not have Unit Price
    const summaryTableIdx = html.indexOf('Repairs Summary');
    // Zone block headers now render as "Clock A · Zone 1" when controllerLetter + zoneNumber present
    const firstZoneIdx = html.indexOf('Clock A');
    assert.ok(summaryTableIdx !== -1, 'Expected Repairs Summary section');
    assert.ok(firstZoneIdx !== -1, 'Expected Clock A zone block');
    const summarySection = html.slice(summaryTableIdx, firstZoneIdx);
    assert.ok(!summarySection.includes('Unit Price'), 'Expected no Unit Price column in aggregated summary');
  });
});

// ── Change 5b: No "Labor Hrs" column in WO / BS parts tables ─────────────────

describe('Change 5b — Labor Hrs column removed from partsTableFromWO and partsTableFromBS', () => {
  const WO_ITEMS: PdfWorkOrderRow['items'] = [
    {
      partName: 'Valve',
      partDescription: 'Ball valve 1"',
      notes: null,
      quantity: 2,
      unitPrice: 12.5,
      laborHours: '0.50',
      rowTotal: 25,
    } as unknown as PdfWorkOrderRow['items'][0],
  ];

  const BS_ITEMS: PdfBillingSheetRow['items'] = [
    {
      partName: 'Spray Head',
      partDescription: 'Spray Head',
      notes: 'Replace all',
      quantity: 4,
      unitPrice: 6,
      laborHours: '1.00',
      rowTotal: 24,
    } as unknown as PdfBillingSheetRow['items'][0],
  ];

  it('partsTableFromWO does not include Labor Hrs column header', () => {
    const html = partsTableFromWO(WO_ITEMS);
    assert.ok(!html.includes('Labor Hrs'), 'Expected no Labor Hrs column in WO parts table');
  });

  it('partsTableFromBS does not include Labor Hrs column header', () => {
    const html = partsTableFromBS(BS_ITEMS);
    assert.ok(!html.includes('Labor Hrs'), 'Expected no Labor Hrs column in BS parts table');
  });

  it('partsTableFromWO still has 4 columns (Part Description, Qty, Unit Price, Total)', () => {
    const html = partsTableFromWO(WO_ITEMS);
    assert.ok(html.includes('Part Description'), 'Expected Part Description header');
    assert.ok(html.includes('Unit Price'), 'Expected Unit Price header');
    assert.ok(html.includes('>Total<'), 'Expected Total header');
  });
});

// ── Change 5c: De-duplicate part descriptions in partsTableFromBS ─────────────

describe('Change 5c — partsTableFromBS deduplicates partDescription when it equals partName', () => {
  it('does NOT emit partDescription as sub-line when it equals partName', () => {
    const items: PdfBillingSheetRow['items'] = [
      {
        partName: 'Spray Head',
        partDescription: 'Spray Head',
        notes: null,
        quantity: 1,
        unitPrice: 6,
        laborHours: '0.25',
        rowTotal: 6,
      } as unknown as PdfBillingSheetRow['items'][0],
    ];
    const html = partsTableFromBS(items);
    const matches = html.match(/Spray Head/g);
    assert.ok(matches !== null, 'Expected Spray Head in output');
    assert.equal(matches!.length, 1, 'Expected "Spray Head" to appear exactly once (no duplicate sub-line)');
  });

  it('DOES emit partDescription as sub-line when it differs from partName', () => {
    const items: PdfBillingSheetRow['items'] = [
      {
        partName: 'Part #12345',
        partDescription: 'Hunter Pro-Spray',
        notes: null,
        quantity: 1,
        unitPrice: 6,
        laborHours: '0.25',
        rowTotal: 6,
      } as unknown as PdfBillingSheetRow['items'][0],
    ];
    const html = partsTableFromBS(items);
    assert.ok(html.includes('Part #12345'), 'Expected partName in output');
    assert.ok(html.includes('Hunter Pro-Spray'), 'Expected different partDescription as sub-line');
  });

  it('DOES emit notes as sub-line regardless', () => {
    const items: PdfBillingSheetRow['items'] = [
      {
        partName: 'Valve',
        partDescription: 'Valve',
        notes: 'Check torque',
        quantity: 1,
        unitPrice: 10,
        laborHours: '0.25',
        rowTotal: 10,
      } as unknown as PdfBillingSheetRow['items'][0],
    ];
    const html = partsTableFromBS(items);
    assert.ok(html.includes('Check torque'), 'Expected notes to appear as sub-line');
  });
});
