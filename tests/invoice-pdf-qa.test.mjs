/**
 * PDF QA Harness — Slice 10
 *
 * Covers:
 *  1. Shared fixture builder (no DB required)
 *  2. Totals unit tests (labor/parts subtotal, grand total, tax)
 *  3. Section grouping unit tests (wo/bs counts, empty records, large parts list)
 *  4. Image / logo fallback unit tests
 *  5. PDF generation smoke tests (Puppeteer, non-empty %PDF buffer)
 *  6. Multi-page overflow smoke test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic imports for TypeScript modules via tsx/esm loader
// All imports must be top-level awaits — cannot be inside test callbacks
// ─────────────────────────────────────────────────────────────────────────────

const pdfViewModelModule = await import('../server/pdf-view-model.ts');
const { buildPdfViewModel } = pdfViewModelModule;

const pdfGeneratorModule = await import('../server/pdf-generator.ts');
const { PDFGenerator, fetchLogoAsBase64 } = pdfGeneratorModule;

const pdfHelpersModule = await import('../server/pdf-helpers.ts');
const { FAILED_PHOTO_SENTINEL, invoiceHeader, photoGrid } = pdfHelpersModule;

// ─────────────────────────────────────────────────────────────────────────────
// ── Fixture Builders ──────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

let _idSeq = 1000;
function nextId() { return ++_idSeq; }

function makeInvoice(overrides) {
  return Object.assign({
    id: nextId(),
    invoiceNumber: `INV-TEST-${nextId()}`,
    customerId: 1,
    customerName: 'Test Customer',
    customerEmail: 'test@example.com',
    customerPhone: '555-1234',
    invoiceMonth: 4,
    invoiceYear: 2026,
    periodStart: new Date('2026-04-01'),
    periodEnd: new Date('2026-04-30'),
    status: 'draft',
    partsSubtotal: '0.00',
    laborSubtotal: '0.00',
    markupAmount: '0.00',
    taxAmount: '0.00',
    totalAmount: '0.00',
    dueDate: null,
    sentAt: null,
    paidAt: null,
    quickbooksInvoiceId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [],
  }, overrides || {});
}

function makeCompany(overrides) {
  return Object.assign({
    name: 'Acme Irrigation Co.',
    logo: undefined,
    logoDataUri: null,
    address: '123 Main St, Springfield',
    phone: '555-0100',
    email: 'info@acme.com',
  }, overrides || {});
}

function makeWorkOrder(overrides) {
  return Object.assign({
    id: nextId(),
    workOrderNumber: `WO-TEST-${nextId()}`,
    estimateId: null,
    customerId: 1,
    customerName: 'Test Customer',
    customerEmail: 'test@example.com',
    customerPhone: '555-1234',
    projectName: 'Test Project',
    projectAddress: '456 Elm St',
    locationNotes: null,
    accessInstructions: null,
    workType: 'direct_billing',
    status: 'completed',
    priority: 'medium',
    scheduledDate: null,
    startedAt: null,
    completedAt: new Date('2026-04-15'),
    assignedTechnicianId: null,
    assignedTechnicianName: 'Tech A',
    description: 'Routine maintenance',
    specialInstructions: null,
    notes: null,
    completedByUserId: null,
    completedByUserName: 'Tech A',
    workSummary: 'Replaced valves',
    customerNotes: null,
    totalHours: '2.00',
    totalPartsCost: '0.00',
    laborRate: '50.00',
    laborSubtotal: '100.00',
    partsSubtotal: '0.00',
    estimatedTotal: null,
    totalAmount: '100.00',
    totalItems: 0,
    invoiceId: null,
    billedAt: null,
    photos: [],
    attachments: [],
    branchName: null,
    aiInputs: null,
    aiShortDescription: null,
    aiDetailedDescription: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }, overrides || {});
}

function makeWorkOrderItem(workOrderId, overrides) {
  return Object.assign({
    id: nextId(),
    workOrderId,
    zoneId: null,
    partId: null,
    partName: 'Hunter PGP Head',
    partPrice: '12.50',
    quantity: 2,
    laborHours: '0.50',
    totalPrice: '25.00',
    actualQuantityUsed: null,
    actualLaborHours: null,
    notes: null,
  }, overrides || {});
}

function makeBillingSheet(overrides) {
  const id = nextId();
  return Object.assign({
    id,
    billingNumber: `BS-TEST-${id}`,
    customerId: 1,
    customerName: 'Test Customer',
    propertyAddress: '789 Oak Ave',
    workDate: new Date('2026-04-20'),
    technicianName: 'Tech B',
    technicianId: null,
    workDescription: 'Drip system repair',
    status: 'submitted',
    totalHours: '3.00',
    laborRate: '50.00',
    laborSubtotal: '150.00',
    partsSubtotal: '0.00',
    markupAmount: '0.00',
    taxAmount: '0.00',
    totalAmount: '150.00',
    invoiceId: null,
    billedAt: null,
    photos: [],
    notes: null,
    branchName: null,
    aiInputs: null,
    aiShortDescription: null,
    aiDetailedDescription: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [],
  }, overrides || {});
}

function makeBillingSheetItem(billingSheetId, overrides) {
  return Object.assign({
    id: nextId(),
    billingSheetId,
    partId: null,
    partName: 'Rainbird Valve',
    partDescription: '',
    quantity: '1.00',
    unitPrice: '45.00',
    totalPrice: '45.00',
    laborHours: '1.00',
    notes: null,
  }, overrides || {});
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Section 2: Totals Unit Tests ─────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

describe('Totals arithmetic — buildPdfViewModel', () => {

  test('work-order-only: labor subtotal matches totalHours * laborRate', () => {
    const wo = makeWorkOrder({
      totalHours: '4.00',
      laborRate: '50.00',
      laborSubtotal: '200.00',
      partsSubtotal: '0.00',
      totalAmount: '200.00',
      totalPartsCost: '0.00',
    });
    const invoice = makeInvoice({ laborSubtotal: '200.00', partsSubtotal: '0.00', totalAmount: '200.00' });
    const data = { invoice, company: makeCompany(), workOrders: [{ workOrder: wo, items: [] }], billingSheets: [] };
    const { viewModel } = buildPdfViewModel(data);

    assert.equal(viewModel.workOrders.length, 1);
    const woRow = viewModel.workOrders[0];
    assert.equal(woRow.laborSubtotal, 200);
    assert.equal(woRow.partsSubtotal, 0);
    assert.equal(woRow.rowTotal, 200);
    assert.equal(viewModel.totals.grandTotal, 200);
  });

  test('billing-sheet-only: parts subtotal sums correctly', () => {
    const bs = makeBillingSheet({
      totalHours: '2.00',
      laborRate: '60.00',
      laborSubtotal: '120.00',
      partsSubtotal: '80.00',
      totalAmount: '200.00',
    });
    const bsItem = makeBillingSheetItem(bs.id, { quantity: '4.00', unitPrice: '20.00', totalPrice: '80.00' });

    const invoice = makeInvoice({ laborSubtotal: '120.00', partsSubtotal: '80.00', totalAmount: '200.00' });
    const data = { invoice, company: makeCompany(), workOrders: [], billingSheets: [{ billingSheet: bs, items: [bsItem] }] };
    const { viewModel } = buildPdfViewModel(data);

    assert.equal(viewModel.billingSheets.length, 1);
    const bsRow = viewModel.billingSheets[0];
    assert.equal(bsRow.laborSubtotal, 120);
    assert.equal(bsRow.partsSubtotal, 80);
    assert.equal(bsRow.rowTotal, 200);
    assert.equal(viewModel.totals.grandTotal, 200);
  });

  test('mixed invoice: grand total = sum of WO rowTotals + BS rowTotals', () => {
    const wo = makeWorkOrder({
      totalHours: '3.00',
      laborRate: '50.00',
      laborSubtotal: '150.00',
      partsSubtotal: '75.00',
      totalPartsCost: '75.00',
      totalAmount: '225.00',
    });
    const bs = makeBillingSheet({
      totalHours: '1.00',
      laborRate: '50.00',
      laborSubtotal: '50.00',
      partsSubtotal: '25.00',
      totalAmount: '75.00',
    });

    const expectedTotal = 225 + 75;
    const invoice = makeInvoice({
      laborSubtotal: '200.00',
      partsSubtotal: '100.00',
      totalAmount: String(expectedTotal),
    });
    const data = {
      invoice,
      company: makeCompany(),
      workOrders: [{ workOrder: wo, items: [] }],
      billingSheets: [{ billingSheet: bs, items: [] }],
    };
    const { viewModel } = buildPdfViewModel(data);

    assert.equal(viewModel.workOrders[0].rowTotal, 225);
    assert.equal(viewModel.billingSheets[0].rowTotal, 75);
    assert.equal(viewModel.totals.grandTotal, expectedTotal);
    assert.equal(viewModel.totalJobs, 2);
  });

  test('parts subtotal: item rowTotal = quantity * unitPrice (integer-safe cents)', () => {
    // Expected values in cents to avoid floating-point drift
    // 3 × $12.50 = $37.50 → 3750 cents
    // 1 × $45.00 = $45.00 → 4500 cents
    // 5 × $6.00  = $30.00 → 3000 cents
    // Total = $112.50 → 11250 cents
    const bs = makeBillingSheet({ partsSubtotal: '112.50', laborSubtotal: '0.00', totalAmount: '112.50' });
    const items = [
      makeBillingSheetItem(bs.id, { quantity: '3.00', unitPrice: '12.50', totalPrice: '37.50', partName: 'Hunter Head' }),
      makeBillingSheetItem(bs.id, { quantity: '1.00', unitPrice: '45.00', totalPrice: '45.00', partName: 'Valve' }),
      makeBillingSheetItem(bs.id, { quantity: '5.00', unitPrice: '6.00', totalPrice: '30.00', partName: 'PVC 1in' }),
    ];
    const invoice = makeInvoice({ partsSubtotal: '112.50', laborSubtotal: '0.00', totalAmount: '112.50' });
    const data = { invoice, company: makeCompany(), workOrders: [], billingSheets: [{ billingSheet: bs, items }] };
    const { viewModel } = buildPdfViewModel(data);

    const bsRow = viewModel.billingSheets[0];
    assert.equal(bsRow.items.length, 3);

    // Use cents (integer arithmetic) to avoid floating-point drift
    const expectedCents = [3750, 4500, 3000];
    for (let i = 0; i < bsRow.items.length; i++) {
      const actualCents = Math.round(bsRow.items[i].rowTotal * 100);
      assert.equal(actualCents, expectedCents[i], `Item ${i}: expected ${expectedCents[i]} cents, got ${actualCents}`);
    }
    const totalCents = Math.round(bsRow.items.reduce((s, r) => s + r.rowTotal, 0) * 100);
    assert.equal(totalCents, 11250, `Parts total: expected 11250 cents, got ${totalCents}`);
  });

  test('zero amounts: empty invoice has all totals = 0', () => {
    const data = {
      invoice: makeInvoice({ totalAmount: '0.00', laborSubtotal: '0.00', partsSubtotal: '0.00' }),
      company: makeCompany(),
      workOrders: [],
      billingSheets: [],
    };
    const { viewModel } = buildPdfViewModel(data);

    assert.equal(viewModel.totals.grandTotal, 0);
    assert.equal(viewModel.totals.laborSubtotal, 0);
    assert.equal(viewModel.totals.partsSubtotal, 0);
    assert.equal(viewModel.totalJobs, 0);
  });

  test('labor subtotal uses stored laborSubtotal from work order', () => {
    const wo = makeWorkOrder({
      totalHours: '5.00',
      laborRate: '60.00',
      laborSubtotal: '300.00',
      partsSubtotal: '50.00',
      totalPartsCost: '50.00',
      totalAmount: '350.00',
    });
    const invoice = makeInvoice({ laborSubtotal: '300.00', partsSubtotal: '50.00', totalAmount: '350.00' });
    const data = { invoice, company: makeCompany(), workOrders: [{ workOrder: wo, items: [] }], billingSheets: [] };
    const { viewModel } = buildPdfViewModel(data);

    assert.equal(viewModel.workOrders[0].laborSubtotal, 300);
    assert.equal(viewModel.workOrders[0].partsSubtotal, 50);
    assert.equal(viewModel.workOrders[0].rowTotal, 350);
  });

  // ── Tax Tests ──────────────────────────────────────────────────────────────
  // Tax is stored in the invoice totalAmount. The view model grandTotal equals
  // storedTotalAmount (which includes tax). These tests verify that the
  // grandTotal correctly reflects tax being incorporated into the invoice total.

  test('tax: WO-only invoice with 10% tax — grandTotal includes tax (integer-safe cents)', () => {
    // labor=200, parts=0, tax=20 (10%), totalAmount=220
    const wo = makeWorkOrder({
      totalHours: '4.00',
      laborRate: '50.00',
      laborSubtotal: '200.00',
      partsSubtotal: '0.00',
      totalPartsCost: '0.00',
      totalAmount: '200.00',
    });
    // Invoice total = 220 (includes $20 tax)
    const invoice = makeInvoice({
      laborSubtotal: '200.00',
      partsSubtotal: '0.00',
      taxAmount: '20.00',
      totalAmount: '220.00',
    });
    const data = { invoice, company: makeCompany(), workOrders: [{ workOrder: wo, items: [] }], billingSheets: [] };
    const { viewModel } = buildPdfViewModel(data);

    // grandTotal = storedTotalAmount = 220 (tax included)
    const grandTotalCents = Math.round(viewModel.totals.grandTotal * 100);
    assert.equal(grandTotalCents, 22000, `Expected 22000 cents (includes tax), got ${grandTotalCents}`);
    assert.equal(viewModel.totals.storedTotalAmount, 220);
  });

  test('tax: BS-only invoice with flat $15 tax — grandTotal includes tax (integer-safe cents)', () => {
    // parts=75, labor=50, tax=15, totalAmount=140
    const bs = makeBillingSheet({
      totalHours: '1.00',
      laborRate: '50.00',
      laborSubtotal: '50.00',
      partsSubtotal: '75.00',
      taxAmount: '15.00',
      totalAmount: '125.00', // bs row total (pre-tax)
    });
    // Invoice level adds the tax on top
    const invoice = makeInvoice({
      laborSubtotal: '50.00',
      partsSubtotal: '75.00',
      taxAmount: '15.00',
      totalAmount: '140.00',
    });
    const data = { invoice, company: makeCompany(), workOrders: [], billingSheets: [{ billingSheet: bs, items: [] }] };
    const { viewModel } = buildPdfViewModel(data);

    const grandTotalCents = Math.round(viewModel.totals.grandTotal * 100);
    assert.equal(grandTotalCents, 14000, `Expected 14000 cents (includes $15 tax), got ${grandTotalCents}`);
  });

  test('tax: mixed invoice with tax — grandTotal = all WO + BS totals + tax (integer-safe cents)', () => {
    // WO: labor=100, parts=50, rowTotal=150
    // BS: labor=60, parts=0, rowTotal=60
    // tax at invoice level: 21.00
    // invoiceTotalAmount = 231.00
    const wo = makeWorkOrder({
      totalHours: '2.00',
      laborRate: '50.00',
      laborSubtotal: '100.00',
      partsSubtotal: '50.00',
      totalPartsCost: '50.00',
      totalAmount: '150.00',
    });
    const bs = makeBillingSheet({
      totalHours: '1.00',
      laborRate: '60.00',
      laborSubtotal: '60.00',
      partsSubtotal: '0.00',
      totalAmount: '60.00',
    });
    const invoice = makeInvoice({
      laborSubtotal: '160.00',
      partsSubtotal: '50.00',
      taxAmount: '21.00',
      totalAmount: '231.00',
    });
    const data = {
      invoice,
      company: makeCompany(),
      workOrders: [{ workOrder: wo, items: [] }],
      billingSheets: [{ billingSheet: bs, items: [] }],
    };
    const { viewModel } = buildPdfViewModel(data);

    const grandTotalCents = Math.round(viewModel.totals.grandTotal * 100);
    assert.equal(grandTotalCents, 23100, `Expected 23100 cents (includes $21 tax), got ${grandTotalCents}`);
    assert.equal(viewModel.workOrders[0].rowTotal, 150);
    assert.equal(viewModel.billingSheets[0].rowTotal, 60);
  });

  test('tax: zero tax — grandTotal equals sum of subtotals (integer-safe cents)', () => {
    // partsSubtotal=80, laborSubtotal=120, tax=0, totalAmount=200
    const bs = makeBillingSheet({
      totalHours: '2.00',
      laborRate: '60.00',
      laborSubtotal: '120.00',
      partsSubtotal: '80.00',
      taxAmount: '0.00',
      totalAmount: '200.00',
    });
    const invoice = makeInvoice({
      laborSubtotal: '120.00',
      partsSubtotal: '80.00',
      taxAmount: '0.00',
      totalAmount: '200.00',
    });
    const data = { invoice, company: makeCompany(), workOrders: [], billingSheets: [{ billingSheet: bs, items: [] }] };
    const { viewModel } = buildPdfViewModel(data);

    const grandTotalCents = Math.round(viewModel.totals.grandTotal * 100);
    assert.equal(grandTotalCents, 20000, `Expected 20000 cents (no tax), got ${grandTotalCents}`);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// ── Section 3: Section Grouping Unit Tests ───────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

describe('Section grouping — buildPdfViewModel', () => {

  test('work-order-only invoice produces correct WO count and zero BS count', () => {
    const wo1 = makeWorkOrder({ totalAmount: '100.00', laborSubtotal: '100.00', partsSubtotal: '0.00', totalPartsCost: '0.00' });
    const wo2 = makeWorkOrder({ totalAmount: '200.00', laborSubtotal: '200.00', partsSubtotal: '0.00', totalPartsCost: '0.00' });
    const invoice = makeInvoice({ totalAmount: '300.00', laborSubtotal: '300.00', partsSubtotal: '0.00' });
    const data = {
      invoice,
      company: makeCompany(),
      workOrders: [{ workOrder: wo1, items: [] }, { workOrder: wo2, items: [] }],
      billingSheets: [],
    };
    const { viewModel } = buildPdfViewModel(data);

    assert.equal(viewModel.workOrders.length, 2);
    assert.equal(viewModel.billingSheets.length, 0);
    assert.equal(viewModel.totalJobs, 2);
  });

  test('billing-sheet-only invoice produces correct BS count and zero WO count', () => {
    const bs1 = makeBillingSheet({ totalAmount: '100.00' });
    const bs2 = makeBillingSheet({ totalAmount: '150.00' });
    const bs3 = makeBillingSheet({ totalAmount: '50.00' });
    const invoice = makeInvoice({ totalAmount: '300.00', laborSubtotal: '300.00', partsSubtotal: '0.00' });
    const data = {
      invoice,
      company: makeCompany(),
      workOrders: [],
      billingSheets: [
        { billingSheet: bs1, items: [] },
        { billingSheet: bs2, items: [] },
        { billingSheet: bs3, items: [] },
      ],
    };
    const { viewModel } = buildPdfViewModel(data);

    assert.equal(viewModel.billingSheets.length, 3);
    assert.equal(viewModel.workOrders.length, 0);
    assert.equal(viewModel.totalJobs, 3);
  });

  test('mixed invoice counts WOs and BSs independently', () => {
    const wos = [1, 2, 3].map(() => makeWorkOrder({ totalAmount: '100.00', laborSubtotal: '100.00', partsSubtotal: '0.00', totalPartsCost: '0.00' }));
    const bss = [1, 2].map(() => makeBillingSheet({ totalAmount: '75.00' }));
    const invoice = makeInvoice({ totalAmount: '450.00', laborSubtotal: '450.00', partsSubtotal: '0.00' });
    const data = {
      invoice,
      company: makeCompany(),
      workOrders: wos.map(wo => ({ workOrder: wo, items: [] })),
      billingSheets: bss.map(bs => ({ billingSheet: bs, items: [] })),
    };
    const { viewModel } = buildPdfViewModel(data);

    assert.equal(viewModel.workOrders.length, 3);
    assert.equal(viewModel.billingSheets.length, 2);
    assert.equal(viewModel.totalJobs, 5);
  });

  test('record with no items is still included in output', () => {
    const wo = makeWorkOrder({ totalAmount: '100.00', laborSubtotal: '100.00', partsSubtotal: '0.00', totalPartsCost: '0.00' });
    const bs = makeBillingSheet({ totalAmount: '50.00', partsSubtotal: '0.00', laborSubtotal: '50.00' });
    const invoice = makeInvoice({ totalAmount: '150.00', laborSubtotal: '150.00', partsSubtotal: '0.00' });
    const data = {
      invoice,
      company: makeCompany(),
      workOrders: [{ workOrder: wo, items: [] }],
      billingSheets: [{ billingSheet: bs, items: [] }],
    };
    const { viewModel } = buildPdfViewModel(data);

    assert.equal(viewModel.workOrders[0].items.length, 0);
    assert.equal(viewModel.billingSheets[0].items.length, 0);
  });

  test('record with 10+ parts (BS) appears fully in output without truncation', () => {
    const bs = makeBillingSheet({
      partsSubtotal: '120.00',
      laborSubtotal: '100.00',
      totalAmount: '220.00',
    });
    const items = Array.from({ length: 12 }, (_, i) =>
      makeBillingSheetItem(bs.id, {
        partName: `Part ${i + 1}`,
        quantity: '1.00',
        unitPrice: '10.00',
        totalPrice: '10.00',
      })
    );
    const invoice = makeInvoice({ partsSubtotal: '120.00', laborSubtotal: '100.00', totalAmount: '220.00' });
    const data = {
      invoice,
      company: makeCompany(),
      workOrders: [],
      billingSheets: [{ billingSheet: bs, items }],
    };
    const { viewModel } = buildPdfViewModel(data);

    assert.equal(viewModel.billingSheets[0].items.length, 12, 'All 12 items should appear');
  });

  test('record with 10+ parts (WO) appears fully in output without truncation', () => {
    const wo = makeWorkOrder({
      partsSubtotal: '110.00',
      totalPartsCost: '110.00',
      laborSubtotal: '100.00',
      totalAmount: '210.00',
    });
    const items = Array.from({ length: 11 }, (_, i) =>
      makeWorkOrderItem(wo.id, {
        partName: `WO Part ${i + 1}`,
        quantity: 1,
        partPrice: '10.00',
        totalPrice: '10.00',
      })
    );
    const invoice = makeInvoice({ partsSubtotal: '110.00', laborSubtotal: '100.00', totalAmount: '210.00' });
    const data = {
      invoice,
      company: makeCompany(),
      workOrders: [{ workOrder: wo, items }],
      billingSheets: [],
    };
    const { viewModel } = buildPdfViewModel(data);

    assert.equal(viewModel.workOrders[0].items.length, 11, 'All 11 items should appear');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// ── Section 4: Image and Logo Fallback Unit Tests ────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

describe('Image and logo fallback — buildPdfViewModel and pdf-helpers', () => {

  test('logo URL present: logoDataUri is passed through to view model', () => {
    const company = makeCompany({ logo: 'https://example.com/logo.png', logoDataUri: 'data:image/png;base64,abc123' });
    const data = { invoice: makeInvoice(), company, workOrders: [], billingSheets: [] };
    const { viewModel } = buildPdfViewModel(data);

    assert.equal(viewModel.company.logo, 'https://example.com/logo.png');
    assert.equal(viewModel.company.logoDataUri, 'data:image/png;base64,abc123');
  });

  test('logo URL missing/null: logoDataUri falls back to null, name still present', () => {
    const company = makeCompany({ logo: undefined, logoDataUri: null });
    const data = { invoice: makeInvoice(), company, workOrders: [], billingSheets: [] };
    const { viewModel } = buildPdfViewModel(data);

    assert.equal(viewModel.company.logoDataUri, null);
    assert.ok(viewModel.company.name.length > 0, 'Company name should still be present');
  });

  test('record with no photos: section has empty photos array', () => {
    const wo = makeWorkOrder({ photos: [], totalAmount: '100.00', laborSubtotal: '100.00', partsSubtotal: '0.00', totalPartsCost: '0.00' });
    const invoice = makeInvoice({ totalAmount: '100.00' });
    const data = { invoice, company: makeCompany(), workOrders: [{ workOrder: wo, items: [] }], billingSheets: [] };
    const { viewModel } = buildPdfViewModel(data);

    assert.deepEqual(viewModel.workOrders[0].photos, []);
  });

  test('record with multiple photos: all included in view model', () => {
    const photos = ['/uploads/photo1.jpg', '/uploads/photo2.jpg', '/uploads/photo3.jpg'];
    const wo = makeWorkOrder({ photos, totalAmount: '100.00', laborSubtotal: '100.00', partsSubtotal: '0.00', totalPartsCost: '0.00' });
    const invoice = makeInvoice({ totalAmount: '100.00' });
    const data = { invoice, company: makeCompany(), workOrders: [{ workOrder: wo, items: [] }], billingSheets: [] };
    const { viewModel } = buildPdfViewModel(data);

    assert.deepEqual(viewModel.workOrders[0].photos, photos);
  });

  test('FAILED_PHOTO_SENTINEL is a non-empty string', () => {
    assert.equal(typeof FAILED_PHOTO_SENTINEL, 'string');
    assert.ok(FAILED_PHOTO_SENTINEL.length > 0);
  });

  test('photos with empty string values are filtered out by safePhotos', () => {
    const wo = makeWorkOrder({
      photos: ['/valid/photo.jpg', '', '/another/photo.jpg'],
      totalAmount: '100.00',
      laborSubtotal: '100.00',
      partsSubtotal: '0.00',
      totalPartsCost: '0.00',
    });
    const invoice = makeInvoice({ totalAmount: '100.00' });
    const data = { invoice, company: makeCompany(), workOrders: [{ workOrder: wo, items: [] }], billingSheets: [] };
    const { viewModel } = buildPdfViewModel(data);

    const photos = viewModel.workOrders[0].photos;
    assert.ok(photos.every(p => p.length > 0), 'Empty strings should be filtered out');
    assert.equal(photos.length, 2);
  });

  test('invoiceHeader HTML: no img tag when logoDataUri is null', () => {
    const company = { name: 'Test Co', logo: '', logoDataUri: null, address: '', phone: '', email: '' };
    const inv = {
      invoiceNumber: 'INV-001',
      periodStart: new Date('2026-04-01'),
      periodEnd: new Date('2026-04-30'),
      generatedAt: new Date(),
      customerName: 'Customer',
      customerEmail: 'c@e.com',
      customerPhone: '',
    };
    const html = invoiceHeader(inv, company);
    assert.ok(!html.includes('<img'), 'No <img> tag should appear when logoDataUri is null');
    assert.ok(html.includes('Test Co'), 'Company name should still appear');
  });

  test('invoiceHeader HTML: img tag present when logoDataUri is provided', () => {
    const company = { name: 'Test Co', logo: 'logo.png', logoDataUri: 'data:image/png;base64,abc', address: '', phone: '', email: '' };
    const inv = {
      invoiceNumber: 'INV-001',
      periodStart: new Date('2026-04-01'),
      periodEnd: new Date('2026-04-30'),
      generatedAt: new Date(),
      customerName: 'Customer',
      customerEmail: 'c@e.com',
      customerPhone: '',
    };
    const html = invoiceHeader(inv, company);
    assert.ok(html.includes('<img'), 'An <img> tag should appear when logoDataUri is provided');
    assert.ok(html.includes('data:image/png;base64,abc'), 'The data URI should be embedded in the img src');
  });

  // ── Invalid photo src fallback ────────────────────────────────────────────
  // When a photo URL fails to load (e.g., broken link, 404, timeout),
  // fetchPhotoAsDataUri() returns FAILED_PHOTO_SENTINEL. The photoGrid()
  // helper detects this sentinel and renders a fallback "Image unavailable"
  // cell instead of a broken <img> tag.

  test('invalid photo src: photoGrid renders fallback cell for FAILED_PHOTO_SENTINEL', () => {
    const html = photoGrid([FAILED_PHOTO_SENTINEL]);
    assert.ok(html.includes('photo-unavailable'), 'Should include the photo-unavailable CSS class');
    assert.ok(html.includes('Image unavailable'), 'Should render "Image unavailable" fallback text');
    assert.ok(!html.includes('<img'), 'Should NOT render a broken <img> tag for failed photos');
  });

  test('invalid photo src: mixed valid/invalid photos — valid photos get img tag, invalid get fallback', () => {
    const validUri = 'data:image/jpeg;base64,/9j/valid';
    const html = photoGrid([validUri, FAILED_PHOTO_SENTINEL, validUri]);
    // Valid photos should have <img> tags
    assert.ok(html.includes('<img'), 'Valid photos should render as <img> elements');
    // Failed photo should have fallback
    assert.ok(html.includes('photo-unavailable'), 'Failed photo should render fallback cell');
    assert.ok(html.includes('Image unavailable'), 'Fallback text should appear for sentinel');
  });

  test('invalid photo src: all-failed photos produce only fallback cells, no img tags', () => {
    const html = photoGrid([FAILED_PHOTO_SENTINEL, FAILED_PHOTO_SENTINEL]);
    const imgCount = (html.match(/<img/g) || []).length;
    assert.equal(imgCount, 0, 'No <img> tags should appear when all photos failed');
    const unavailableCount = (html.match(/photo-unavailable/g) || []).length;
    assert.equal(unavailableCount, 2, 'Both cells should show as unavailable');
  });

  test('invalid photo src: PDF generation with failing photo URL does not throw', { timeout: 60000 }, async () => {
    // Photos that cannot be fetched become FAILED_PHOTO_SENTINEL in the generator,
    // but in the unit-test path we pass them as already-failed (sentinel) dataUris.
    // This test exercises the HTML generation path directly (no network fetch).
    const wo = makeWorkOrder({
      photos: ['/nonexistent/photo.jpg'],
      totalAmount: '100.00',
      laborSubtotal: '100.00',
      partsSubtotal: '0.00',
      totalPartsCost: '0.00',
    });
    const vm = makeViewModelForPdf(
      { totalAmount: '100.00', laborSubtotal: '100.00', partsSubtotal: '0.00' },
      [{ workOrder: wo, items: [] }],
      [],
    );
    // generateInvoiceDetailPDF pre-loads photos; a 404 from the dev server
    // returns FAILED_PHOTO_SENTINEL and the fallback is rendered. Assert it
    // does not throw and produces a valid PDF.
    const buf = await PDFGenerator.generateInvoiceDetailPDF(vm);
    assert.ok(buf instanceof Buffer && buf.length > 0, 'Should return a non-empty Buffer even with invalid photo URL');
    assert.equal(buf.slice(0, 4).toString('ascii'), '%PDF', 'Result must be a valid PDF');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// ── Helpers for PDF smoke tests ───────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

function makeViewModelForPdf(invoiceOverrides, woList, bsList) {
  const inv = makeInvoice(invoiceOverrides || {});
  const data = {
    invoice: inv,
    company: makeCompany(),
    workOrders: woList || [],
    billingSheets: bsList || [],
    laborRate: '50.00',
  };
  const { viewModel } = buildPdfViewModel(data);
  return viewModel;
}

function assertValidPdfBuffer(buf, label) {
  assert.ok(buf instanceof Buffer, `${label}: result must be a Buffer`);
  assert.ok(buf.length > 0, `${label}: Buffer must be non-empty`);
  const header = buf.slice(0, 4).toString('ascii');
  assert.equal(header, '%PDF', `${label}: Buffer must start with %PDF`);
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Section 5: PDF Generation Smoke Tests (Puppeteer) ───────────────────────
// ─────────────────────────────────────────────────────────────────────────────

describe('PDF generation smoke tests — Puppeteer', () => {

  test('work-order-only invoice generates valid PDF buffer', { timeout: 60000 }, async () => {
    const wo = makeWorkOrder({ totalAmount: '100.00', laborSubtotal: '100.00', partsSubtotal: '0.00', totalPartsCost: '0.00' });
    const vm = makeViewModelForPdf(
      { totalAmount: '100.00', laborSubtotal: '100.00', partsSubtotal: '0.00' },
      [{ workOrder: wo, items: [] }],
      [],
    );
    const buf = await PDFGenerator.generateInvoiceDetailPDF(vm);
    assertValidPdfBuffer(buf, 'work-order-only');
  });

  test('billing-sheet-only invoice generates valid PDF buffer', { timeout: 60000 }, async () => {
    const bs = makeBillingSheet({ totalAmount: '150.00', laborSubtotal: '150.00', partsSubtotal: '0.00' });
    const vm = makeViewModelForPdf(
      { totalAmount: '150.00', laborSubtotal: '150.00', partsSubtotal: '0.00' },
      [],
      [{ billingSheet: bs, items: [] }],
    );
    const buf = await PDFGenerator.generateInvoiceDetailPDF(vm);
    assertValidPdfBuffer(buf, 'billing-sheet-only');
  });

  test('mixed invoice generates valid PDF buffer', { timeout: 60000 }, async () => {
    const wo = makeWorkOrder({ totalAmount: '100.00', laborSubtotal: '100.00', partsSubtotal: '0.00', totalPartsCost: '0.00' });
    const bs = makeBillingSheet({ totalAmount: '75.00', laborSubtotal: '75.00', partsSubtotal: '0.00' });
    const vm = makeViewModelForPdf(
      { totalAmount: '175.00', laborSubtotal: '175.00', partsSubtotal: '0.00' },
      [{ workOrder: wo, items: [] }],
      [{ billingSheet: bs, items: [] }],
    );
    const buf = await PDFGenerator.generateInvoiceDetailPDF(vm);
    assertValidPdfBuffer(buf, 'mixed invoice');
  });

  test('invoice with long description (500+ chars) generates valid PDF buffer', { timeout: 60000 }, async () => {
    const longDesc = 'A'.repeat(520) + ' technician performed extensive work on the irrigation system.';
    const wo = makeWorkOrder({
      description: longDesc,
      workSummary: longDesc,
      totalAmount: '200.00',
      laborSubtotal: '200.00',
      partsSubtotal: '0.00',
      totalPartsCost: '0.00',
    });
    const vm = makeViewModelForPdf(
      { totalAmount: '200.00', laborSubtotal: '200.00', partsSubtotal: '0.00' },
      [{ workOrder: wo, items: [] }],
      [],
    );
    const buf = await PDFGenerator.generateInvoiceDetailPDF(vm);
    assertValidPdfBuffer(buf, 'long description');
  });

  test('empty invoice (no WOs, no BSs) generates valid PDF buffer', { timeout: 60000 }, async () => {
    const vm = makeViewModelForPdf(
      { totalAmount: '0.00', laborSubtotal: '0.00', partsSubtotal: '0.00' },
      [],
      [],
    );
    const buf = await PDFGenerator.generateInvoiceDetailPDF(vm);
    assertValidPdfBuffer(buf, 'empty invoice');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// ── Section 6: Multi-page Overflow Test ──────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

describe('Multi-page overflow — PDF smoke test', () => {

  test('8 work orders with 12 parts each + long descriptions generates valid PDF buffer', { timeout: 120000 }, async () => {
    const longDesc = 'Technician performed detailed maintenance and repair work on the drip irrigation system, replacing worn emitters, adjusting zone pressures, clearing blockages, and testing all zones for proper coverage. Additional work included adjusting timer schedules and documenting system layout for future reference.';

    const wos = Array.from({ length: 8 }, (_, wi) => {
      const wo = makeWorkOrder({
        description: longDesc,
        workSummary: longDesc,
        partsSubtotal: '120.00',
        totalPartsCost: '120.00',
        laborSubtotal: '100.00',
        totalAmount: '220.00',
      });
      const items = Array.from({ length: 12 }, (_, pi) =>
        makeWorkOrderItem(wo.id, {
          partName: `Part ${wi + 1}-${pi + 1}: Hunter PGP Rotor Head Full Circle`,
          quantity: 1,
          partPrice: '10.00',
          totalPrice: '10.00',
          laborHours: '0.25',
        })
      );
      return { workOrder: wo, items };
    });

    const totalAmount = 8 * 220;
    const invoice = makeInvoice({
      partsSubtotal: String(8 * 120),
      laborSubtotal: String(8 * 100),
      totalAmount: String(totalAmount),
    });

    const data = {
      invoice,
      company: makeCompany(),
      workOrders: wos,
      billingSheets: [],
      laborRate: '50.00',
    };
    const { viewModel } = buildPdfViewModel(data);

    assert.equal(viewModel.workOrders.length, 8, 'All 8 work orders should be in view model');
    assert.ok(viewModel.workOrders.every(wo => wo.items.length === 12), 'Each WO should have 12 items');

    const buf = await PDFGenerator.generateInvoiceDetailPDF(viewModel);
    assertValidPdfBuffer(buf, 'multi-page overflow');

    // A large PDF with 8 WOs * 12 items each should be at least 10KB
    assert.ok(buf.length > 10000, `Expected large PDF buffer, got ${buf.length} bytes`);
  });

});
