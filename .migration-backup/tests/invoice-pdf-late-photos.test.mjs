/**
 * Tests for Task #196 — Make sure invoice PDFs reflect photos that were
 * added to a billing sheet AFTER the invoice was generated.
 *
 * Task #191 lets field techs PATCH photos onto already-billed/invoiced
 * billing sheets. This test guarantees that:
 *   1. The real production regeneration path
 *      (`InvoicePdfService.generateAndSaveInvoicePdf` — the same code the
 *      `POST /api/invoices/:invoiceId/pdf/regenerate` route runs) builds the
 *      PDF view-model with the latest photos, including ones backfilled
 *      AFTER the invoice already existed.
 *   2. Any cached `invoice_pdfs` byproduct row is invalidated and replaced
 *      with a fresh one by that real regeneration path — so customers never
 *      get a stale PDF.
 *
 * To avoid spinning up Chromium in CI, we monkey-patch
 * `PDFGenerator.generateInvoiceDetailPDF` to capture the actual view-model
 * the service builds and return a stub PDF buffer. Everything upstream of
 * that — storage reads, view-model construction, byproduct invalidation /
 * persistence — runs as it does in production. The service is invoked
 * in-process (rather than via HTTP) so the monkey-patch is in scope; the
 * route itself is a thin wrapper around the same `InvoicePdfService` call.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

const BASE_URL = "http://localhost:5000";

const ADMIN_HEADERS = {
  "Content-Type": "application/json",
  "x-user-id": "2",
  "x-user-role": "company_admin",
  "x-user-company-id": "99",
};

const { storage } = await import("../server/storage.ts");
const { db } = await import("../server/db.ts");
const { invoicePdfs } = await import("../shared/schema.ts");
const { eq } = await import("drizzle-orm");
const pdfGeneratorModule = await import("../server/pdf-generator.ts");
const { InvoicePdfService } = await import("../server/invoice-pdf-service.ts");

let FIELD_TECH_USER_ID;
let FIELD_TECH_HEADERS;

// ── PDFGenerator monkey-patch to capture the view-model ─────────────────────
const originalGenerateInvoiceDetailPDF = pdfGeneratorModule.PDFGenerator.generateInvoiceDetailPDF;
let lastCapturedViewModel = null;
let captureCount = 0;
function installPdfCapture() {
  pdfGeneratorModule.PDFGenerator.generateInvoiceDetailPDF = async (viewModel) => {
    lastCapturedViewModel = viewModel;
    captureCount += 1;
    // Minimal valid PDF buffer so generatePdfBuffer treats it as a success.
    return Buffer.from("%PDF-1.4\n%late-photo-test-stub\n%%EOF\n");
  };
}
function uninstallPdfCapture() {
  pdfGeneratorModule.PDFGenerator.generateInvoiceDetailPDF = originalGenerateInvoiceDetailPDF;
}

async function api(method, path, body, headers = ADMIN_HEADERS) {
  const opts = { method, headers: { ...headers } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function ensureCustomer() {
  const res = await api("POST", "/api/customers", {
    companyId: 99,
    name: "Late Photo PDF Customer",
    email: `latephoto_${Date.now()}@example.com`,
    laborRate: "50.00",
  });
  assert.equal(res.status, 201, `Customer creation failed: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

async function createSheet(customerId, photos) {
  const res = await api("POST", "/api/billing-sheets", {
    customerId,
    customerName: "Late Photo PDF Customer",
    propertyAddress: "1 PDF Way",
    workDate: new Date().toISOString().slice(0, 10),
    technicianName: "PDF Photo Tech",
    technicianId: FIELD_TECH_USER_ID,
    workDescription: "Late photo PDF coverage",
    status: "draft",
    totalHours: "1",
    laborRate: "50.00",
    laborSubtotal: "50.00",
    partsSubtotal: "0",
    totalAmount: "50.00",
    photos,
  });
  assert.equal(res.status, 200, `Create billing sheet failed: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

// Mirrors the invalidation step performed by `POST /api/invoices/:id/pdf/regenerate`
// (drop existing byproduct row → call generateAndSaveInvoicePdf). Done in-process
// so our monkey-patched PDFGenerator captures the real view-model.
async function regenerateInvoicePdf(invoiceId) {
  const existing = await storage.getInvoicePdfByInvoiceId(invoiceId);
  if (existing) {
    await db.delete(invoicePdfs).where(eq(invoicePdfs.id, existing.id));
  }
  const service = new InvoicePdfService(storage);
  const result = await service.generateAndSaveInvoicePdf(invoiceId);
  return { result, previousId: existing?.id ?? null };
}

describe("Invoice PDF reflects photos added after invoicing (Task #196)", () => {
  let customerId;
  let sheetId;
  let invoiceId;
  const initialPhotos = ["https://example.com/before-invoice.jpg"];

  before(async () => {
    installPdfCapture();

    customerId = await ensureCustomer();

    const tag = Date.now();
    const techRes = await api("POST", "/api/users", {
      username: `pdfphoto_${tag}`,
      password: "test-password-123",
      name: "PDF Photo Tech",
      email: `pdfphoto_${tag}@example.com`,
      role: "field_tech",
      companyId: 99,
    });
    assert.equal(techRes.status, 201, `Field tech user creation failed: ${JSON.stringify(techRes.body)}`);
    FIELD_TECH_USER_ID = techRes.body.id;
    FIELD_TECH_HEADERS = {
      "Content-Type": "application/json",
      "x-user-id": String(FIELD_TECH_USER_ID),
      "x-user-role": "field_tech",
      "x-user-company-id": "99",
    };

    sheetId = await createSheet(customerId, initialPhotos);

    // Plant an invoice + invoice_item so the billing sheet is genuinely
    // attached to an invoice via the same FK shape /api/invoices/monthly
    // produces. This avoids a hard dependency on a live QuickBooks
    // integration in the test environment.
    const periodStart = new Date();
    const periodEnd = new Date();
    const invoice = await storage.createInvoice({
      invoiceNumber: `INV-LATE-PHOTO-${tag}`,
      customerId,
      customerName: "Late Photo PDF Customer",
      customerEmail: `latephoto_${tag}@example.com`,
      customerPhone: null,
      invoiceMonth: periodStart.getMonth() + 1,
      invoiceYear: periodStart.getFullYear(),
      periodStart,
      periodEnd,
      laborSubtotal: "50.00",
      partsSubtotal: "0.00",
      totalAmount: "50.00",
      status: "generated",
    });
    invoiceId = invoice.id;

    await storage.createInvoiceItem({
      invoiceId,
      sourceType: "billing_sheet",
      sourceId: sheetId,
      billingSheetId: sheetId,
      description: "Billing Sheet for late-photo coverage",
      workDate: periodStart,
      laborHours: "1",
      laborRate: "50.00",
      laborTotal: "50.00",
      quantity: "1",
      unitPrice: "50.00",
      totalPrice: "50.00",
    });

    // Mark the sheet as billed and link it to the invoice — mirrors the
    // post-invoicing state in production.
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    const ws = (await import("ws")).default;
    neonConfig.webSocketConstructor = ws;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(
      `UPDATE billing_sheets SET status = 'billed', invoice_id = $1 WHERE id = $2`,
      [invoiceId, sheetId],
    );
    await pool.end();
  });

  after(() => {
    uninstallPdfCapture();
  });

  test("Real regeneration includes photos backfilled after invoicing", async () => {
    // Field tech backfills photos AFTER the invoice already exists (Task #191).
    const newPhotos = [
      ...initialPhotos,
      "https://example.com/added-after-invoice-1.jpg",
      "https://example.com/added-after-invoice-2.jpg",
    ];
    const patch = await api(
      "PATCH",
      `/api/billing-sheets/${sheetId}`,
      { photos: newPhotos },
      FIELD_TECH_HEADERS,
    );
    assert.equal(
      patch.status,
      200,
      `Photos-only PATCH on invoiced sheet failed: ${JSON.stringify(patch.body)}`,
    );

    // Drive the REAL regeneration path (same call the production route makes).
    lastCapturedViewModel = null;
    const before = captureCount;
    const { result } = await regenerateInvoicePdf(invoiceId);
    assert.equal(
      result.success,
      true,
      `generateAndSaveInvoicePdf failed: ${JSON.stringify(result)}`,
    );
    assert.equal(
      captureCount,
      before + 1,
      "PDFGenerator.generateInvoiceDetailPDF was not invoked by regeneration",
    );
    assert.ok(lastCapturedViewModel, "Captured view-model must be present after regeneration");

    assert.equal(
      lastCapturedViewModel.billingSheets.length,
      1,
      "Regenerated view-model should include the linked billing sheet",
    );
    const renderedPhotos = lastCapturedViewModel.billingSheets[0].photos;
    assert.deepEqual(
      renderedPhotos,
      newPhotos,
      `Regenerated PDF view-model did not include late-added photos: ${JSON.stringify(renderedPhotos)}`,
    );
    for (const url of newPhotos.slice(initialPhotos.length)) {
      assert.ok(
        renderedPhotos.includes(url),
        `Missing late-added photo URL ${url} in regenerated view-model`,
      );
    }

    // The byproduct row must have been persisted by the real save path.
    const persisted = await storage.getInvoicePdfByInvoiceId(invoiceId);
    assert.ok(persisted, "Regeneration should leave a persisted invoice_pdfs row");
  });

  test("Cached PDF byproduct is replaced by regeneration after another late photo", async () => {
    const cached = await storage.getInvoicePdfByInvoiceId(invoiceId);
    assert.ok(cached, "First regeneration should have left a cached byproduct row in place");
    const cachedId = cached.id;
    const cachedCreatedAt = new Date(cached.createdAt).getTime();

    // Tech adds yet another photo after the cached PDF was created.
    const sheetNow = await storage.getBillingSheetById(sheetId);
    const newerPhotos = [
      ...(sheetNow.photos || []),
      "https://example.com/added-after-cache-1.jpg",
    ];
    const patch = await api(
      "PATCH",
      `/api/billing-sheets/${sheetId}`,
      { photos: newerPhotos },
      FIELD_TECH_HEADERS,
    );
    assert.equal(
      patch.status,
      200,
      `Photos-only PATCH on cached-PDF sheet failed: ${JSON.stringify(patch.body)}`,
    );

    // Task #224: the photos PATCH itself now auto-invalidates the cached
    // byproduct row, so by the time we get here the cached row is already
    // gone — confirm that, then regenerate to produce a fresh one.
    const postPatchCached = await storage.getInvoicePdfByInvoiceId(invoiceId);
    assert.equal(
      postPatchCached,
      undefined,
      `Cached PDF byproduct row should have been auto-invalidated by the photos PATCH (still found id=${postPatchCached?.id ?? 'n/a'}, was id=${cachedId})`,
    );

    // Real regeneration call — exercises the production save path.
    lastCapturedViewModel = null;
    const before = captureCount;
    const { result } = await regenerateInvoicePdf(invoiceId);
    assert.equal(
      result.success,
      true,
      `generateAndSaveInvoicePdf failed during cache test: ${JSON.stringify(result)}`,
    );
    assert.equal(
      captureCount,
      before + 1,
      "PDFGenerator.generateInvoiceDetailPDF was not invoked on second regeneration",
    );

    // The persisted byproduct row must be a fresh one — proves the cache
    // really was invalidated and replaced rather than served stale.
    const fresh = await storage.getInvoicePdfByInvoiceId(invoiceId);
    assert.ok(fresh, "Regeneration should leave a fresh byproduct row behind");
    assert.notEqual(
      fresh.id,
      cachedId,
      "Cached PDF byproduct row should have been replaced with a new id",
    );
    assert.ok(
      new Date(fresh.createdAt).getTime() >= cachedCreatedAt,
      "Fresh byproduct row should not predate the cached one",
    );

    // And the captured view-model must include the very latest photo set.
    const renderedPhotos = lastCapturedViewModel.billingSheets[0].photos;
    assert.deepEqual(
      renderedPhotos,
      newerPhotos,
      `Regenerated PDF view-model missing the latest photo set: ${JSON.stringify(renderedPhotos)}`,
    );
    assert.ok(
      renderedPhotos.includes("https://example.com/added-after-cache-1.jpg"),
      "Newly added photo (after the cached PDF was created) must be in the regenerated view-model",
    );
  });

  test("PATCHing photos onto an invoiced billing sheet auto-invalidates the cached invoice_pdfs row (Task #224)", async () => {
    // Make sure a cached byproduct row exists going in. Earlier tests already
    // produced one, but be defensive in case ordering ever changes.
    let cached = await storage.getInvoicePdfByInvoiceId(invoiceId);
    if (!cached) {
      const { result } = await regenerateInvoicePdf(invoiceId);
      assert.equal(result.success, true, `Setup regeneration failed: ${JSON.stringify(result)}`);
      cached = await storage.getInvoicePdfByInvoiceId(invoiceId);
    }
    assert.ok(cached, "A cached invoice_pdfs row must exist before the auto-invalidation test");
    const cachedId = cached.id;

    // Field tech backfills another photo — this is the trigger that should
    // automatically clear the cached PDF (no manual regenerate call).
    const sheetNow = await storage.getBillingSheetById(sheetId);
    const photosAfter = [
      ...(sheetNow.photos || []),
      `https://example.com/auto-invalidate-${Date.now()}.jpg`,
    ];
    const patch = await api(
      "PATCH",
      `/api/billing-sheets/${sheetId}`,
      { photos: photosAfter },
      FIELD_TECH_HEADERS,
    );
    assert.equal(
      patch.status,
      200,
      `Photos-only PATCH on invoiced sheet failed: ${JSON.stringify(patch.body)}`,
    );

    // The cached byproduct row must have been deleted as part of the same
    // request — without anyone hitting the regenerate endpoint.
    const afterPatch = await storage.getInvoicePdfByInvoiceId(invoiceId);
    assert.equal(
      afterPatch,
      undefined,
      `Cached invoice_pdfs row should have been auto-invalidated by the photos PATCH (still found id=${afterPatch?.id ?? 'n/a'}, was id=${cachedId})`,
    );

    // And confirming the underlying photo write actually landed.
    const refreshed = await storage.getBillingSheetById(sheetId);
    assert.deepEqual(
      refreshed.photos,
      photosAfter,
      "Photos PATCH should have persisted the new photo set",
    );
  });

  test("Route-level POST /api/invoices/:invoiceId/pdf/regenerate stays wired up", async () => {
    // Lightweight route guard so future divergence between the HTTP wrapper
    // and the service path the previous tests exercise still gets caught.
    // (PDFGenerator monkey-patch only applies in-process, so this call hits
    //  the real production renderer in the running server.)
    const before = await storage.getInvoicePdfByInvoiceId(invoiceId);
    const beforeId = before?.id ?? null;

    const regen = await api("POST", `/api/invoices/${invoiceId}/pdf/regenerate`);
    assert.equal(
      regen.status,
      200,
      `Route /pdf/regenerate failed: ${JSON.stringify(regen.body)}`,
    );

    const after = await storage.getInvoicePdfByInvoiceId(invoiceId);
    assert.ok(after, "Route regeneration should leave a persisted byproduct row");
    if (beforeId !== null) {
      assert.notEqual(
        after.id,
        beforeId,
        "Route regeneration must invalidate and replace the cached byproduct row",
      );
    }
  });
});
