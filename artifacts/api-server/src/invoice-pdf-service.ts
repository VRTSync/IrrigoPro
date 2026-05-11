import { PDFGenerator, fetchLogoAsBase64 } from './pdf-generator';
import { buildPdfViewModel } from './pdf-view-model';
import type { PdfBrandColors } from './pdf-view-model';
import { DEFAULT_BRAND_COLORS } from './pdf-view-model';
import type { IStorage } from './storage';
import type { WorkOrder, WorkOrderItem, BillingSheet, BillingSheetItem } from '@workspace/db';

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

const LOGO_PATH_PATTERNS = [
  /\/api\/public-objects\/company-logos\/(.+)/,
  /\/api\/company-logo\/(.+)/,
];

function resolveLogoToFetchableUrl(storedLogo: string): string {
  const port = process.env.PORT || 5000;
  const localBase = `http://localhost:${port}`;

  if (storedLogo.startsWith('http://') || storedLogo.startsWith('https://')) {
    let pathname: string;
    try {
      pathname = new URL(storedLogo).pathname;
    } catch {
      console.warn(`[PDF] Invalid logo URL: ${storedLogo}`);
      return storedLogo;
    }
    for (const pattern of LOGO_PATH_PATTERNS) {
      const match = pathname.match(pattern);
      if (match) {
        return `${localBase}/api/company-logo/${match[1]}`;
      }
    }
    console.warn(`[PDF] Logo URL does not match known app paths, skipping: ${storedLogo}`);
    return storedLogo;
  }

  if (storedLogo.startsWith('/api/')) {
    return `${localBase}${storedLogo}`;
  }
  if (storedLogo.startsWith('/')) {
    return `${localBase}/api/company-logo${storedLogo}`;
  }
  if (storedLogo.startsWith('company-logos/')) {
    const logoId = storedLogo.replace('company-logos/', '');
    return `${localBase}/api/company-logo/${logoId}`;
  }
  return `${localBase}/api/company-logo/${storedLogo}`;
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
  error?: string;
  validationFailure?: InvoicePdfValidationFailure;
}

function toNum(val: string | number | null | undefined): number {
  if (val === null || val === undefined) return 0;
  const n = typeof val === 'string' ? parseFloat(val) : val;
  return isNaN(n) ? 0 : n;
}

function validateRows(
  invoiceId: number,
  workOrders: Array<{ workOrder: WorkOrder; items: WorkOrderItem[] }>,
  billingSheets: Array<{ billingSheet: BillingSheet; items: BillingSheetItem[] }>,
  storedInvoiceTotal: number,
): InvoicePdfValidationFailure | null {
  const rowErrors: RowValidationError[] = [];
  const rowTotals: Array<{ recordType: string; recordId: number; rowTotal: number }> = [];

  for (const { workOrder, items } of workOrders) {
    const parts = toNum(workOrder.partsSubtotal);
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
    const parts = toNum(billingSheet.partsSubtotal);
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

  async generatePdfBuffer(invoiceId: number): Promise<InvoicePdfGenerationResult> {
    try {
      const invoice = await this.storage.getInvoiceById(invoiceId);
      if (!invoice) {
        return { success: false, error: 'Invoice not found' };
      }

      const customer = await this.storage.getCustomerById(invoice.customerId);
      if (!customer) {
        return { success: false, error: 'Customer not found' };
      }

      const company = await this.storage.getCompany(customer.companyId);
      if (!company) {
        return { success: false, error: 'Company not found' };
      }

      const workOrders: Array<{ workOrder: WorkOrder; items: WorkOrderItem[] }> = [];
      const billingSheets: Array<{ billingSheet: BillingSheet; items: BillingSheetItem[] }> = [];

      for (const item of invoice.items) {
        if (item.sourceType === 'work_order' && item.workOrderId) {
          const workOrder = await this.storage.getWorkOrder(item.workOrderId);
          if (workOrder) {
            const existingWo = workOrders.find(wo => wo.workOrder.id === workOrder.id);
            if (!existingWo) {
              const items = await this.storage.getWorkOrderItems(workOrder.id);
              workOrders.push({ workOrder, items });
            }
          }
        } else if (item.sourceType === 'billing_sheet' && item.billingSheetId) {
          const billingSheet = await this.storage.getBillingSheetById(item.billingSheetId);
          if (billingSheet) {
            const existingBs = billingSheets.find(bs => bs.billingSheet.id === billingSheet.id);
            if (!existingBs) {
              billingSheets.push({
                billingSheet: billingSheet,
                items: billingSheet.items || [],
              });
            }
          }
        }
      }

      const storedInvoiceTotal = toNum(invoice.totalAmount);
      const validationFailure = validateRows(invoiceId, workOrders, billingSheets, storedInvoiceTotal);

      if (validationFailure) {
        if (validationFailure.rowErrors.length > 0 || validationFailure.totalsError) {
          return { success: false, error: 'Invoice totals validation failed', validationFailure };
        }
      }

      const laborRate = customer.laborRate || '0';

      let logoDataUri: string | null = null;
      if (company.logo) {
        const logoUrl = resolveLogoToFetchableUrl(company.logo);
        logoDataUri = await fetchLogoAsBase64(logoUrl);
      }

      const brandColors = logoDataUri
        ? await extractBrandColorsFromDataUri(logoDataUri)
        : DEFAULT_BRAND_COLORS;

      const customerHasBranches = Array.isArray(customer.branches) && customer.branches.length > 0;

      const { viewModel } = buildPdfViewModel({
        invoice,
        company: {
          name: company.name,
          logo: company.logo || undefined,
          logoDataUri,
          address: company.address || undefined,
          phone: company.phone || undefined,
          email: company.email || undefined,
        },
        workOrders,
        billingSheets,
        laborRate,
        brandColors,
        customerHasBranches,
      });

      const pdfBuffer = await PDFGenerator.generateInvoiceDetailPDF(viewModel);

      return { success: true, pdfBuffer };
    } catch (error) {
      console.error('Error generating invoice PDF:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  async generateAndSaveInvoicePdf(invoiceId: number): Promise<InvoicePdfGenerationResult> {
    const result = await this.generatePdfBuffer(invoiceId);
    if (!result.success) {
      return result;
    }

    try {
      const invoice = await this.storage.getInvoiceById(invoiceId);
      if (!invoice) {
        return { success: false, error: 'Invoice not found' };
      }

      const customer = await this.storage.getCustomerById(invoice.customerId);
      if (!customer) {
        return { success: false, error: 'Customer not found' };
      }

      const periodStart = new Date(invoice.periodStart);
      const periodEnd = new Date(invoice.periodEnd);
      const formatDate = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      const filename = `Invoice_${invoice.invoiceNumber}_${formatDate(periodStart)}-${formatDate(periodEnd)}_Detail.pdf`;

      await this.storage.createInvoicePdf({
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        companyId: customer.companyId,
        pdfUrl: 'generated-on-demand',
        filename,
        status: 'generated',
      });

      return { success: true, pdfBuffer: result.pdfBuffer };
    } catch (error) {
      console.error('Error saving invoice PDF record:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }
}
