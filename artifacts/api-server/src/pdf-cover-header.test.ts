/**
 * pdf-cover-header.test.ts
 *
 * Tests for Invoice PDF Slice 1152:
 *   Part A — colored cover brand band + below-band invoice block
 *   Part B — fixed job-type colors on reconciliation summary
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { coverPage, buildFullCSS, JOB_TYPE_COLORS } from './pdf-helpers';
import { DEFAULT_BRAND_COLORS } from './pdf-view-model';
import type { PdfViewModel } from './pdf-view-model';

// ── Minimal PdfViewModel fixture ──────────────────────────────────────────────

function makeVm(overrides: {
  logoDataUri?: string | null;
  companyName?: string;
  navy?: string;
  invoiceNumber?: string;
} = {}): PdfViewModel {
  const navy = overrides.navy ?? '#1E5A99';
  return {
    company: {
      name: overrides.companyName ?? 'Test Company',
      logo: '',
      logoDataUri: overrides.logoDataUri ?? null,
      address: '123 Main St',
      phone: '555-1234',
      email: 'info@test.com',
    },
    invoice: {
      invoiceNumber: overrides.invoiceNumber ?? 'INV-00001',
      periodStart: new Date('2026-05-01'),
      periodEnd: new Date('2026-05-31'),
      generatedAt: new Date('2026-06-01'),
      customerName: 'Acme Corp',
      customerEmail: 'acme@example.com',
      customerPhone: '555-9999',
    },
    workOrders: [],
    billingSheets: [],
    wetCheckBillings: [],
    totals: { grandTotal: 0, laborSubtotal: 0, partsSubtotal: 0, storedTotalAmount: 0 },
    totalJobs: 0,
    validationWarning: null,
    brandColors: {
      ...DEFAULT_BRAND_COLORS,
      navy,
    },
    customerHasBranches: false,
    branchSubtotals: [],
  } as unknown as PdfViewModel;
}

// ── Part A: Cover brand band ──────────────────────────────────────────────────

describe('coverPage — brand band (Part A)', () => {
  it('renders cover-brand-band with inline background matching navy brand color', () => {
    const html = coverPage(makeVm({ navy: '#123456' }));
    assert.ok(
      html.includes('cover-brand-band'),
      'Expected cover-brand-band class in output',
    );
    assert.ok(
      html.includes('background:#123456'),
      'Expected inline background style to match navy color #123456',
    );
  });

  it('renders logo tile with src when logoDataUri is present', () => {
    const html = coverPage(makeVm({ logoDataUri: 'data:image/png;base64,AAA' }));
    assert.ok(
      html.includes('cover-logo-tile'),
      'Expected cover-logo-tile class when logo is present',
    );
    assert.ok(
      html.includes('src="data:image/png;base64,AAA"'),
      'Expected img src to contain the logo data URI',
    );
    assert.ok(
      !html.includes('cover-logo-tile-empty'),
      'Expected cover-logo-tile-empty to be absent when logo is present',
    );
  });

  it('renders no-logo fallback tile with company initial when logoDataUri is null', () => {
    const html = coverPage(makeVm({ logoDataUri: null, companyName: 'Greenfield' }));
    assert.ok(
      html.includes('cover-logo-tile-empty'),
      'Expected cover-logo-tile-empty class for no-logo fallback',
    );
    assert.ok(
      html.includes('>G<'),
      'Expected company initial "G" inside the fallback tile',
    );
  });

  it('renders invoice number and billing period below the band', () => {
    const html = coverPage(makeVm({ invoiceNumber: 'INV-20418' }));
    assert.ok(
      html.includes('INVOICE #INV-20418'),
      'Expected "INVOICE #INV-20418" in the invoice block',
    );
    assert.ok(
      html.includes('Billing Period:'),
      'Expected "Billing Period:" label in the invoice block',
    );
  });
});

// ── Part B: Job-type colors ───────────────────────────────────────────────────

describe('JOB_TYPE_COLORS — fixed constants (Part B)', () => {
  it('exports exact job-type color values', () => {
    assert.equal(JOB_TYPE_COLORS.workOrder, '#1E5A99', 'Work Order color must be #1E5A99');
    assert.equal(JOB_TYPE_COLORS.billingSheet, '#B06820', 'Billing Sheet color must be #B06820');
    assert.equal(JOB_TYPE_COLORS.wetCheck, '#5E8C2A', 'Wet Check color must be #5E8C2A');
  });
});

describe('buildFullCSS — job-type colors in recon rules (Part B)', () => {
  it('contains .recon-type-wcb with color #5E8C2A and #B06820 for billing-sheet rules', () => {
    const css = buildFullCSS(DEFAULT_BRAND_COLORS);
    assert.ok(
      css.includes('.recon-type-wcb') && css.includes('#5E8C2A'),
      'Expected .recon-type-wcb rule with color #5E8C2A in CSS',
    );
    assert.ok(
      css.includes('#B06820'),
      'Expected #B06820 (Billing Sheet amber) to appear in CSS',
    );
  });

  it('job-type colors are unchanged when navy and green brand colors are overridden to #000000', () => {
    const css = buildFullCSS({
      ...DEFAULT_BRAND_COLORS,
      navy: '#000000',
      green: '#000000',
    });
    assert.ok(
      css.includes('#1E5A99'),
      'Expected Work Order color #1E5A99 to remain when navy is overridden',
    );
    assert.ok(
      css.includes('#B06820'),
      'Expected Billing Sheet color #B06820 to remain when navy is overridden',
    );
    assert.ok(
      css.includes('#5E8C2A'),
      'Expected Wet Check color #5E8C2A to remain when green is overridden',
    );
  });
});

describe('buildFullCSS — ticket header color classes (Task #1164)', () => {
  it('.ticket-header-wo uses JOB_TYPE_COLORS.workOrder (#1E5A99)', () => {
    const css = buildFullCSS(DEFAULT_BRAND_COLORS);
    const woRuleMatch = css.match(/\.ticket-header-wo\s*\{[^}]+\}/);
    assert.ok(woRuleMatch, 'Expected .ticket-header-wo rule in CSS');
    assert.ok(
      woRuleMatch[0].includes('#1E5A99'),
      'Expected .ticket-header-wo background to be #1E5A99',
    );
  });

  it('.ticket-header-bs uses JOB_TYPE_COLORS.billingSheet (#B06820)', () => {
    const css = buildFullCSS(DEFAULT_BRAND_COLORS);
    const bsRuleMatch = css.match(/\.ticket-header-bs\s*\{[^}]+\}/);
    assert.ok(bsRuleMatch, 'Expected .ticket-header-bs rule in CSS');
    assert.ok(
      bsRuleMatch[0].includes('#B06820'),
      'Expected .ticket-header-bs background to be #B06820',
    );
  });

  it('.ticket-header-wcb uses JOB_TYPE_COLORS.wetCheck (#5E8C2A)', () => {
    const css = buildFullCSS(DEFAULT_BRAND_COLORS);
    const wcbRuleMatch = css.match(/\.ticket-header-wcb\s*\{[^}]+\}/);
    assert.ok(wcbRuleMatch, 'Expected .ticket-header-wcb rule in CSS');
    assert.ok(
      wcbRuleMatch[0].includes('#5E8C2A'),
      'Expected .ticket-header-wcb background to be #5E8C2A',
    );
  });

  it('ticket header colors are fixed regardless of brand navy/green overrides', () => {
    const css = buildFullCSS({ ...DEFAULT_BRAND_COLORS, navy: '#000000', green: '#000000' });
    const woMatch = css.match(/\.ticket-header-wo\s*\{[^}]+\}/);
    const bsMatch = css.match(/\.ticket-header-bs\s*\{[^}]+\}/);
    const wcbMatch = css.match(/\.ticket-header-wcb\s*\{[^}]+\}/);
    assert.ok(woMatch?.[0].includes('#1E5A99'), '.ticket-header-wo must stay #1E5A99 when navy is overridden');
    assert.ok(bsMatch?.[0].includes('#B06820'), '.ticket-header-bs must stay #B06820 when navy is overridden');
    assert.ok(wcbMatch?.[0].includes('#5E8C2A'), '.ticket-header-wcb must stay #5E8C2A when green is overridden');
  });
});
