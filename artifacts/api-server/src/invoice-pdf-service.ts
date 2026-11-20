import { createHash } from 'node:crypto';
import { PDFGenerator, fetchLogoAsBase64 } from './pdf-generator';
import { resolveCompanyLogoUrl, pdfLogoBaseUrl } from './logo-url';
import { buildPdfViewModel, resolveTicketPartsSubtotal, ticketItemRowTotal } from './pdf-view-model';
import type { PdfBrandColors, PdfWetCheckBillingRow, PdfWcbZonePhotoGroup } from './pdf-view-model';
import { DEFAULT_BRAND_COLORS } from './pdf-view-model';
import type { IStorage } from './storage';
import type { WorkOrder, WorkOrderItem, BillingSheet, BillingSheetItem, WetCheckBilling } from '@workspace/db';
import type { WetCheckBillingView } from './wet-check-billing-view';
import { buildWcbZonePhotoGroups } from './wcb-zone-photo-groups';
import { ObjectStorageService } from './objectStorage';

const invoiceMonth = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });
const invoiceMonthAndYear = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

export function invoiceBillingPeriod(invoice: { periodStart: Date | string; periodEnd: Date | string }): string {
  const start = new Date(invoice.periodStart);
  const end = new Date(invoice.periodEnd);
  if (start.getUTCFullYear() !== end.getUTCFullYear()) {
    return `${invoiceMonthAndYear.format(start)}–${invoiceMonthAndYear.format(end)}`;
  }
  if (start.getUTCMonth() !== end.getUTCMonth()) {
    return `${invoiceMonth.format(start)}–${invoiceMonthAndYear.format(end)}`;
  }
  return invoiceMonthAndYear.format(start);
}

export function buildInvoicePdfFilename(
  invoice: { periodStart: Date | string; periodEnd: Date | string } | null | undefined,
  customer: { irrigoName?: string | null; name?: string | null } | null | undefined,
  invoiceIdFallback: number,
): string {
  if (!invoice) return `Irrigation Billing Detail - ${invoiceIdFallback}.pdf`;
  const fmtDateShort = (value: Date | string) => {
    const d = new Date(value);
    return `${d.getMonth() + 1}-${d.getDate()}-${String(d.getFullYear()).slice(-2)}`;
  };
  const label = customer?.irrigoName ?? customer?.name ?? 'Unknown';
  return `${label} - Irrigation Billing Detail - (${fmtDateShort(invoice.periodStart)}_${fmtDateShort(invoice.periodEnd)}).pdf`;
}

export async function readInvoiceSentCopy(objectKey: string): Promise<Buffer | null> {
  const file = await new ObjectStorageService().searchPublicObject(objectKey);
  if (!file) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of file.createReadStream()) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function extractBrandColorsFromDataUri(dataUri: string): Promise<PdfBrandColors> {
  try {
    const { Vibrant } = await import('node-vibrant/node');
    const base64Data = dataUri.replace(/^data:image\/[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const palette = await Vibrant.from(buffer).getPalette();

    const swatches = [
      palette.Vibrant,
      palette.DarkVibrant,
      palette.LightVibrant,
      palette.Muted,
      palette.DarkMuted,
      palette.LightMuted,
    ].filter(Boolean);

    if (swatches.length === 0) {
      return DEFAULT_BRAND_COLORS;
    }

    const toHex = (s: { r: number; g: number; b: number }) =>
      '#' + [s.r, s.g, s.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

    const getLuminance = (r: number, g: number, b: number): number =>
      0.299 * r + 0.587 * g + 0.114 * b;

    const getSaturation = (r: number, g: number, b: number): number => {
      const max = Math.max(r, g, b) / 255;
      const min = Math.min(r, g, b) / 255;
      return max === 0 ? 0 : (max - min) / max;
    };

    const getWarmth = (r: number, g: number, b: number): number =>
      r - b;

    const swatchData = swatches.map(s => {
      const [r, g, b] = s!.rgb;
      return {
        hex: toHex({ r, g, b }),
        luminance: getLuminance(r, g, b),
        saturation: getSaturation(r, g, b),
        warmth: getWarmth(r, g, b),
        r, g, b,
      };
    });

    swatchData.sort((a, b) => a.luminance - b.luminance);
    const navy = swatchData[0].hex;

    swatchData.sort((a, b) => b.saturation - a.saturation);
    const green = swatchData[0].hex;

    const remaining = swatchData.filter(s => s.hex !== navy && s.hex !== green);
    const warmSorted = remaining.sort((a, b) => b.warmth - a.warmth);
    const brown = warmSorted.length > 0 ? warmSorted[0].hex : DEFAULT_BRAND_COLORS.brown;

    console.log(`[PDF] Extracted brand colors — navy:${navy} brown:${brown} green:${green}`);
    return { navy, brown, green, black: '#000000', gray: '#F5F5F5' };
  } catch (err) {
    console.warn('[PDF] Color extraction failed, using defaults:', err instanceof Error ? err.message : err);
    return DEFAULT_BRAND_COLORS;
  }
}

/**
 * Exported for unit-test verification of the logo path → URL binding.
 * Delegates to the shared resolveCompanyLogoUrl helper (logo-url.ts).
 */
export function resolveLogoToFetchableUrl(storedLogo: string): string {
  return resolveCompanyLogoUrl(storedLogo, pdfLogoBaseUrl()) ?? storedLogo;
}

const TOLERANCE = 0.01;

interface RowValidationError {
  recordType: 'work_order' | 'billing_sheet';
  recordId: number;
  partsSubtotal: number;
  laborSubtotal: number;
  computedTotal: number;
  storedTotal: number;
  delta: number;
  reason: string;
}

interface TotalsValidationError {
  invoiceId: number;
  computedGrandTotal: number;
  storedTotal: number;
  delta: number;
  largestContributors: Array<{ recordType: string; recordId: number; rowTotal: number }>;
}

export interface InvoicePdfValidationFailure {
  validationFailed: true;
  rowErrors: RowValidationError[];
  totalsError?: TotalsValidationError;
}

export interface InvoicePdfGenerationResult {
  success: boolean;
  pdfBuffer?: Buffer;
  documentVersion?: string;
  error?: string;
  validationFailure?: InvoicePdfValidationFailure;
}

function toNum(val: string | number | null | undefined): number {
  if (val === null || val === undefined) return 0;
  const n = typeof val === 'string' ? parseFloat(val) : val;
  return isNaN(n) ? 0 : n;
}

function hasControllerOrZoneMetadata(
  controller: string | null | undefined,
  zone: number | string | null | undefined,
): boolean {
  return Boolean(
    (typeof controller === 'string' ? controller.trim() : controller) ||
    (zone !== null && zone !== undefined && String(zone).trim() !== ''),
  );
}

interface ControllerZoneCarrier {
  controllerLetter?: string | null;
  zoneNumber?: number | string | null;
}

interface InvoiceTicketMetadataRows {
  workOrders: Array<{
    workOrder: ControllerZoneCarrier;
    items: ControllerZoneCarrier[];
  }>;
  billingSheets: Array<{
    billingSheet: ControllerZoneCarrier;
    wetCheckView?: { zones?: ControllerZoneCarrier[] };
  }>;
  wetCheckBillings: Array<{
    wetCheckView: { zones?: ControllerZoneCarrier[] };
  }>;
}

export function countTicketRowsMissingControllerZoneMetadata(
  rows: InvoiceTicketMetadataRows,
): number {
  return [
    ...rows.workOrders.map(({ workOrder, items }) =>
      hasControllerOrZoneMetadata(workOrder.controllerLetter, workOrder.zoneNumber) ||
      items.some(item => hasControllerOrZoneMetadata(item.controllerLetter, item.zoneNumber)),
    ),
    ...rows.billingSheets.map(({ billingSheet, wetCheckView }) =>
      hasControllerOrZoneMetadata(billingSheet.controllerLetter, billingSheet.zoneNumber) ||
      (wetCheckView?.zones ?? []).some(zone =>
        hasControllerOrZoneMetadata(zone.controllerLetter, zone.zoneNumber),
      ),
    ),
    ...rows.wetCheckBillings.map(({ wetCheckView }) =>
      (wetCheckView.zones ?? []).some(zone =>
        hasControllerOrZoneMetadata(zone.controllerLetter, zone.zoneNumber),
      ),
    ),
  ].filter(hasMetadata => !hasMetadata).length;
}

export function logInvoiceTicketMetadataSummary(
  invoiceNumber: string,
  rows: InvoiceTicketMetadataRows,
  log: (message: string) => void = console.info,
): number {
  const missingCount = countTicketRowsMissingControllerZoneMetadata(rows);
  log(`[PDF] Invoice ${invoiceNumber}: ${missingCount} ticket row(s) missing controller/zone metadata`);
  return missingCount;
}

export function validateRows(
  invoiceId: number,
  workOrders: Array<{ workOrder: WorkOrder; items: WorkOrderItem[] }>,
  billingSheets: Array<{ billingSheet: BillingSheet; items: BillingSheetItem[] }>,
  wetCheckBillings: Array<WetCheckBilling>,
  storedInvoiceTotal: number,
): InvoicePdfValidationFailure | null {
  const rowErrors: RowValidationError[] = [];
  const rowTotals: Array<{ recordType: string; recordId: number; rowTotal: number }> = [];

  for (const { workOrder, items } of workOrders) {
    // Resolve parts exactly as the rendered ticket page does — items first when
    // the ticket has any — so a stale header column cannot fail a packet whose
    // line items reconcile to its stored total.
    const parts = resolveTicketPartsSubtotal(
      [workOrder.partsSubtotal, workOrder.totalPartsCost],
      items.map(item => ({ rowTotal: ticketItemRowTotal(item) })),
    ).value;
    const labor = toNum(workOrder.laborSubtotal);
    const stored = toNum(workOrder.totalAmount);
    const computed = parts + labor;
    const delta = Math.abs(computed - stored);

    rowTotals.push({ recordType: 'work_order', recordId: workOrder.id, rowTotal: stored });

    if (delta > TOLERANCE) {
      rowErrors.push({
        recordType: 'work_order',
        recordId: workOrder.id,
        partsSubtotal: parts,
        laborSubtotal: labor,
        computedTotal: computed,
        storedTotal: stored,
        delta,
        reason: `partsSubtotal (${parts}) + laborSubtotal (${labor}) = ${computed} does not match storedTotal (${stored}), delta ${delta.toFixed(4)}`,
      });
      console.error(`[PDF][validation] work_order id=${workOrder.id} invoiceId=${invoiceId} partsSubtotal=${parts} laborSubtotal=${labor} computedTotal=${computed} storedTotal=${stored} delta=${delta.toFixed(4)}`);
    }

    if (parts === 0 && labor === 0 && items.length > 0) {
      console.warn(`[PDF][validation] work_order id=${workOrder.id} invoiceId=${invoiceId} has ${items.length} item(s) but zero parts and zero labor — row total will be $0.00`);
    }
  }

  for (const { billingSheet, items } of billingSheets) {
    const parts = resolveTicketPartsSubtotal(
      [billingSheet.partsSubtotal],
      items.map(item => ({ rowTotal: ticketItemRowTotal(item) })),
    ).value;
    const labor = toNum(billingSheet.laborSubtotal);
    const stored = toNum(billingSheet.totalAmount);
    const computed = parts + labor;
    const delta = Math.abs(computed - stored);

    rowTotals.push({ recordType: 'billing_sheet', recordId: billingSheet.id, rowTotal: stored });

    if (delta > TOLERANCE) {
      rowErrors.push({
        recordType: 'billing_sheet',
        recordId: billingSheet.id,
        partsSubtotal: parts,
        laborSubtotal: labor,
        computedTotal: computed,
        storedTotal: stored,
        delta,
        reason: `partsSubtotal (${parts}) + laborSubtotal (${labor}) = ${computed} does not match storedTotal (${stored}), delta ${delta.toFixed(4)}`,
      });
      console.error(`[PDF][validation] billing_sheet id=${billingSheet.id} invoiceId=${invoiceId} partsSubtotal=${parts} laborSubtotal=${labor} computedTotal=${computed} storedTotal=${stored} delta=${delta.toFixed(4)}`);
    }

    if (parts === 0 && labor === 0 && items.length > 0) {
      console.warn(`[PDF][validation] billing_sheet id=${billingSheet.id} invoiceId=${invoiceId} has ${items.length} item(s) but zero parts and zero labor subtotals`);
    }
  }

  for (const wcb of wetCheckBillings) {
    const total = toNum(wcb.totalAmount);
    rowTotals.push({ recordType: 'wet_check_billing', recordId: wcb.id, rowTotal: total });
  }

  const computedGrandTotal = rowTotals.reduce((sum, r) => sum + r.rowTotal, 0);
  const grandDelta = Math.abs(computedGrandTotal - storedInvoiceTotal);

  let totalsError: TotalsValidationError | undefined;
  if (grandDelta > TOLERANCE) {
    const sortedContributors = [...rowTotals].sort((a, b) => b.rowTotal - a.rowTotal);
    totalsError = {
      invoiceId,
      computedGrandTotal,
      storedTotal: storedInvoiceTotal,
      delta: grandDelta,
      largestContributors: sortedContributors.slice(0, 5),
    };
    console.error(
      `[PDF][validation] invoiceId=${invoiceId} grandTotal mismatch: computed=${computedGrandTotal} stored=${storedInvoiceTotal} delta=${grandDelta.toFixed(4)} topContributors=${JSON.stringify(sortedContributors.slice(0, 5))}`,
    );
  }

  if (rowErrors.length > 0 || totalsError) {
    return { validationFailed: true, rowErrors, totalsError };
  }

  return null;
}

export class InvoicePdfService {
  private storage: IStorage;

  constructor(storage: IStorage) {
    this.storage = storage;
  }

  /** A review binds the same source snapshot that PDF rendering consumes,
   * without fetching image bytes or starting Chromium during preview. */
  async getDocumentVersion(invoiceId: number, companyId: number): Promise<string> {
    return this.documentVersion(await this.loadSource(invoiceId, companyId));
  }

  private documentVersion(source: Awaited<ReturnType<InvoicePdfService['loadSource']>>): string {
    const json = JSON.stringify(source, (_key, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]))
        : value,
    );
    return createHash('sha256').update(json).digest('base64url');
  }

  private async loadSource(invoiceId: number, companyId: number | null) {
    const row = await this.storage.getInvoiceById(invoiceId, companyId);
    if (!row) throw new Error('Invoice not found');
    const invoice = { ...row, items: [...row.items].sort((a, b) => a.id - b.id) };
    const customer = await this.storage.getCustomerById(invoice.customerId);
    if (!customer || customer.companyId !== invoice.companyId) throw new Error('Customer not found');
    const tenant = customer.companyId;
    const company = await this.storage.getCompany(tenant);
    if (!company) throw new Error('Company not found');

    const workOrders: Array<{ workOrder: WorkOrder; items: WorkOrderItem[] }> = [];
    const billingSheets: Array<{ billingSheet: BillingSheet; items: BillingSheetItem[]; wetCheckView?: WetCheckBillingView }> = [];
    const wetCheckBillingRows: PdfWetCheckBillingRow[] = [];
    const seenTickets = new Set<string>();
    for (const item of invoice.items) {
      if (item.sourceType === 'work_order' && item.workOrderId) {
        const key = `wo:${item.workOrderId}`;
        if (seenTickets.has(key)) continue;
        seenTickets.add(key);
        const workOrder = await this.storage.getWorkOrder(item.workOrderId, tenant);
        if (!workOrder) continue;
        const items = await this.storage.getWorkOrderItems(workOrder.id);
        workOrders.push({ workOrder, items: [...items].sort((a, b) => a.id - b.id) });
      } else if (item.sourceType === 'billing_sheet' && item.billingSheetId) {
        const key = `bs:${item.billingSheetId}`;
        if (seenTickets.has(key)) continue;
        seenTickets.add(key);
        const sheet = await this.storage.getBillingSheetById(item.billingSheetId, tenant);
        if (!sheet) continue;
        const { items: sheetItems, ...billingSheet } = sheet;
        const wetCheckView = await this.storage.getBillingSheetWetCheckView(billingSheet.id, tenant).catch(() => null);
        const items = [...sheetItems].sort((a, b) => a.id - b.id);
        billingSheets.push({ billingSheet, items, wetCheckView: wetCheckView ?? undefined });
      } else if (item.sourceType === 'wet_check_billing' && item.wetCheckBillingId) {
        const key = `wcb:${item.wetCheckBillingId}`;
        if (seenTickets.has(key)) continue;
        seenTickets.add(key);
        const wcb = await this.storage.getWetCheckBillingById(item.wetCheckBillingId, tenant);
        if (!wcb) continue;
        const wetCheckView = await this.storage.getWetCheckBillingViewById(wcb.id, tenant).catch(() => null);
        if (!wetCheckView) continue;
        const photosWithMeta = await this.storage.getWetCheckPhotosGrouped(wcb.wetCheckId);
        const photoUrls = photosWithMeta.map(p => p.url);
        // Group photos where possible and retain legacy photos for the flat fallback.
        const zonePhotoGroups = buildWcbZonePhotoGroups(photosWithMeta, wetCheckView);
        const legacyUrls = Array.isArray(wcb.photos) ? (wcb.photos as string[]).filter(Boolean) : [];
        wetCheckBillingRows.push({
          wetCheckBillingId: wcb.id,
          wetCheckBilling: wcb,
          wetCheckView,
          photoUrls,
          zonePhotoGroups: zonePhotoGroups.length > 0 ? zonePhotoGroups : undefined,
          mergedPhotoUrls: [...new Set([...photoUrls, ...legacyUrls])],
        });
      }
    }

    return {
      invoice, workOrders, billingSheets, wetCheckBillingRows,
      company: {
        name: company.name,
        logo: company.logo || undefined,
        address: company.address || undefined,
        phone: company.phone || undefined,
        email: company.email || undefined,
      },
      laborRate: customer.laborRate || '0',
      customerHasBranches: Array.isArray(customer.branches) && customer.branches.length > 0,
    };
  }

  async generatePdfBuffer(invoiceId: number, companyId: number | null = null): Promise<InvoicePdfGenerationResult> {
    try {
      const source = await this.loadSource(invoiceId, companyId);
      const documentVersion = this.documentVersion(source);
      const { invoice, company, workOrders, billingSheets, wetCheckBillingRows, laborRate, customerHasBranches } = source;
      // Keep this as one packet-level informational summary rather than
      // emitting a warning or a PDF placeholder for every incomplete row.
      logInvoiceTicketMetadataSummary(invoice.invoiceNumber, {
        workOrders,
        billingSheets,
        wetCheckBillings: wetCheckBillingRows,
      });

      const storedInvoiceTotal = toNum(invoice.totalAmount);
      const validationFailure = validateRows(
        invoiceId,
        workOrders,
        billingSheets,
        wetCheckBillingRows.map(r => r.wetCheckBilling),
        storedInvoiceTotal,
      );

      if (validationFailure) {
        if (validationFailure.rowErrors.length > 0 || validationFailure.totalsError) {
          return { success: false, error: 'Invoice totals validation failed', validationFailure, documentVersion };
        }
      }

      let logoDataUri: string | null = null;
      if (company.logo) {
        const logoUrl = resolveLogoToFetchableUrl(company.logo);
        logoDataUri = await fetchLogoAsBase64(logoUrl);
      }

      const brandColors = logoDataUri
        ? await extractBrandColorsFromDataUri(logoDataUri)
        : DEFAULT_BRAND_COLORS;

      const { viewModel } = buildPdfViewModel({
        invoice,
        company: { ...company, logoDataUri },
        workOrders,
        billingSheets,
        wetCheckBillings: wetCheckBillingRows,
        laborRate,
        brandColors,
        customerHasBranches,
      });

      const pdfBuffer = await PDFGenerator.generateInvoiceDetailPDF(viewModel);

      return { success: true, pdfBuffer, documentVersion };
    } catch (error) {
      console.error('Error generating invoice PDF:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

}
