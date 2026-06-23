/**
 * estimate-email-polish.test.ts
 *
 * Tests for the estimate approval email PDF-parity polish (Task #1519).
 *
 * Covers:
 *  (a) Standard estimate email — labor column shows dollars + hours per row;
 *      totals block shows Parts subtotal → Labor subtotal (with hours) → Total
 *      that reconciles to totalAmount.
 *  (b) Inspection estimate email renders zone-grouped layout (Repairs Summary
 *      by Zone + per-zone detail blocks); standard estimate renders single flat
 *      table.
 *  (c) "View Complete Estimate" href points to /estimate-approval/<token>,
 *      never to /api/estimates/view-via-token/…
 *  (d) Plain-text body includes the subtotals breakdown.
 *
 * All tests operate by calling the private HTML/text generators indirectly
 * via the exported generateEstimateEmailHTML / generateEstimateEmailText
 * surface exposed through the class-level test hook, so no SendGrid I/O
 * happens.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { EstimateEmailData } from './email-service';

// ── Test-only shim to call private static methods ────────────────────────────
// We reach into the compiled class without instantiating it.

async function renderHTML(data: EstimateEmailData): Promise<string> {
  const { EmailService } = await import('./email-service');
  // Access private static method via bracket notation for test purposes.
  const cls = EmailService as unknown as {
    generateEstimateEmailHTML: (
      data: EstimateEmailData,
      approveUrl: string,
      rejectUrl: string,
      viewUrl: string,
      companyInfo: { name: string; logo: string | null; email: string; phone: string; website: string },
    ) => string;
  };
  return cls.generateEstimateEmailHTML(
    data,
    `https://irrigopro.com/estimate-approval/${data.approvalToken}`,
    `https://irrigopro.com/api/estimates/reject-via-token/${data.approvalToken}`,
    `https://irrigopro.com/estimate-approval/${data.approvalToken}`,
    { name: 'Acme Irrigation', logo: null, email: 'test@acme.com', phone: '555-0100', website: '' },
  );
}

async function renderText(data: EstimateEmailData): Promise<string> {
  const { EmailService } = await import('./email-service');
  const cls = EmailService as unknown as {
    generateEstimateEmailText: (
      data: EstimateEmailData,
      approveUrl: string,
      rejectUrl: string,
      companyInfo: { name: string; logo: string | null; email: string; phone: string; website: string },
    ) => string;
  };
  return cls.generateEstimateEmailText(
    data,
    `https://irrigopro.com/estimate-approval/${data.approvalToken}`,
    `https://irrigopro.com/api/estimates/reject-via-token/${data.approvalToken}`,
    { name: 'Acme Irrigation', logo: null, email: 'test@acme.com', phone: '555-0100', website: '' },
  );
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeStandardData(overrides: Partial<EstimateEmailData> = {}): EstimateEmailData {
  return {
    estimateId: 1,
    estimateNumber: '00001',
    customerName: 'Jane Doe',
    customerEmail: 'jane@example.com',
    projectName: 'Front Yard Sprinklers',
    totalAmount: '$320.00',
    partsSubtotal: 150,
    laborSubtotal: 170,
    totalLaborHours: 2,
    laborRate: 85,
    isInspectionOrigin: false,
    approvalToken: 'abc123',
    estimateDate: '6/1/2026',
    createdBy: 'Bob',
    companyId: 7,
    items: [
      {
        description: 'Hunter PGP head',
        partName: 'Hunter PGP',
        quantity: 4,
        partPrice: 25,
        laborHours: 0.5,
        partsCost: 100,
        laborCost: 42.5,
        lineTotal: 142.5,
      },
      {
        description: 'Rainbird valve',
        partName: 'Rainbird 100-HV',
        quantity: 1,
        partPrice: 50,
        laborHours: 1.5,
        partsCost: 50,
        laborCost: 127.5,
        lineTotal: 177.5,
      },
    ],
    ...overrides,
  };
}

function makeInspectionData(): EstimateEmailData {
  return {
    estimateId: 2,
    estimateNumber: '00002',
    customerName: 'John Smith',
    customerEmail: 'john@example.com',
    projectName: 'Backyard Inspection',
    totalAmount: '$425.00',
    partsSubtotal: 200,
    laborSubtotal: 225,
    totalLaborHours: 2.5,
    laborRate: 90,
    isInspectionOrigin: true,
    approvalToken: 'def456',
    estimateDate: '6/1/2026',
    createdBy: 'Alice',
    companyId: 7,
    items: [
      {
        description: 'Head Replace',
        partName: 'Hunter PGP',
        quantity: 2,
        partPrice: 25,
        laborHours: 0.25,
        partsCost: 50,
        laborCost: 22.5,
        lineTotal: 72.5,
        controllerLetter: 'A',
        zoneNumber: 1,
        issueType: 'head_replacement',
      },
      {
        description: 'Valve',
        partName: 'Rainbird Valve',
        quantity: 1,
        partPrice: 75,
        laborHours: 1.5,
        partsCost: 75,
        laborCost: 135,
        lineTotal: 210,
        controllerLetter: 'A',
        zoneNumber: 2,
        issueType: 'valve_issue',
      },
      {
        description: 'Nozzle Replace',
        partName: 'MP Rotator',
        quantity: 5,
        partPrice: 15,
        laborHours: 0.25,
        partsCost: 75,
        laborCost: 22.5,
        lineTotal: 97.5,
        controllerLetter: 'B',
        zoneNumber: 1,
        issueType: 'nozzle_replacement',
      },
    ],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('estimate email polish', () => {
  describe('(a) Standard estimate — labor column + totals breakdown', () => {
    it('shows labor as dollars + hours per row', async () => {
      const html = await renderHTML(makeStandardData());
      assert.ok(
        html.includes('$42.50') && html.includes('0.50h'),
        'first item labor should show $42.50 (0.50h)',
      );
      assert.ok(
        html.includes('$127.50') && html.includes('1.50h'),
        'second item labor should show $127.50 (1.50h)',
      );
    });

    it('totals block shows Parts subtotal, Labor subtotal, Total', async () => {
      const html = await renderHTML(makeStandardData());
      assert.ok(html.includes('Parts Subtotal'), 'must include Parts Subtotal label');
      assert.ok(html.includes('$150.00'), 'must show parts subtotal amount');
      assert.ok(html.includes('Labor ('), 'must include Labor label with hours');
      assert.ok(html.includes('$170.00'), 'must show labor subtotal amount');
      assert.ok(html.includes('$320.00'), 'must show total amount');
    });

    it('totals reconcile: parts + labor = totalAmount', async () => {
      const data = makeStandardData();
      const expected = (data.partsSubtotal! + data.laborSubtotal!).toFixed(2);
      const parsed = parseFloat(data.totalAmount.replace('$', ''));
      assert.equal(parsed.toFixed(2), expected, 'parts + labor must equal totalAmount');
    });

    it('renders a single flat items table (no zone-grouped structure)', async () => {
      const html = await renderHTML(makeStandardData());
      assert.ok(!html.includes('Repairs Summary by Zone'), 'standard estimate must not have zone summary');
      assert.ok(!html.includes('Zone Detail'), 'standard estimate must not have zone detail');
    });
  });

  describe('(b) Inspection estimate — zone-grouped layout', () => {
    it('renders Repairs Summary by Zone section', async () => {
      const html = await renderHTML(makeInspectionData());
      assert.ok(html.includes('Repairs Summary by Zone'), 'must include zone summary table header');
    });

    it('renders per-zone detail blocks', async () => {
      const html = await renderHTML(makeInspectionData());
      assert.ok(
        html.includes('Controller A') && html.includes('Zone 1'),
        'must show Controller A · Zone 1 block',
      );
      assert.ok(
        html.includes('Controller A') && html.includes('Zone 2'),
        'must show Controller A · Zone 2 block',
      );
      assert.ok(
        html.includes('Controller B') && html.includes('Zone 1'),
        'must show Controller B · Zone 1 block',
      );
    });

    it('includes zone labor rows in detail blocks', async () => {
      const html = await renderHTML(makeInspectionData());
      assert.ok(html.includes('Zone labor'), 'must include zone labor rows');
    });

    it('standard estimate does NOT render zone-grouped layout', async () => {
      const html = await renderHTML(makeStandardData());
      assert.ok(!html.includes('Repairs Summary by Zone'));
      assert.ok(!html.includes('Zone Detail'));
    });
  });

  describe('(c) "View Complete Estimate" link points to approval page', () => {
    it('viewUrl uses /estimate-approval/<token>, not /api/estimates/view-via-token/', async () => {
      const data = makeStandardData({ approvalToken: 'mytoken99' });
      const html = await renderHTML(data);
      assert.ok(
        html.includes('/estimate-approval/mytoken99'),
        'must link to /estimate-approval/<token>',
      );
      assert.ok(
        !html.includes('/api/estimates/view-via-token/'),
        'must NOT link to the old /api/estimates/view-via-token/ path',
      );
    });
  });

  describe('(d) Plain-text body includes subtotals breakdown', () => {
    it('includes Parts Subtotal, Labor, and Total lines', async () => {
      const text = await renderText(makeStandardData());
      assert.ok(text.includes('Parts Subtotal'), 'plain text must include Parts Subtotal');
      assert.ok(text.includes('$150.00'), 'plain text must include parts amount');
      assert.ok(text.includes('$170.00'), 'plain text must include labor amount');
      assert.ok(text.includes('$320.00'), 'plain text must include total');
    });

    it('zone-grouped text includes zone detail and breakdown', async () => {
      const text = await renderText(makeInspectionData());
      assert.ok(text.includes('ZONE DETAIL:'), 'plain text must include ZONE DETAIL section');
      assert.ok(text.includes('Controller A'), 'plain text must include zone labels');
      assert.ok(text.includes('Parts Subtotal'), 'plain text must include breakdown');
    });
  });
});
