import { PDFGenerator, fetchLogoAsBase64 } from './pdf-generator';
import { buildPdfViewModel } from './pdf-view-model';
import type { PdfBrandColors, PdfWetCheckBillingRow, PdfWcbZonePhotoGroup } from './pdf-view-model';
import { DEFAULT_BRAND_COLORS } from './pdf-view-model';
import type { IStorage } from './storage';
import type { WorkOrder, WorkOrderItem, BillingSheet, BillingSheetItem, WetCheckBilling } from '@workspace/db';
import type { WetCheckBillingView } from './wet-check-billing-view';

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

/**
 * Task #843 — Group wet check photos by zone and finding.
 * Cross-references wetCheckView.zones to attach zone labels and finding
 * display labels so the PDF can render photos under the correct zone block.
 */
function buildWcbZonePhotoGroups(
  photos: Array<{url: string; zoneRecordId: number | null; findingId: number | null}>,
  view: WetCheckBillingView,
): PdfWcbZonePhotoGroup[] {
  if (photos.length === 0 || view.zones.length === 0) return [];

  // Build lookup: zoneRecordId → zone (for label)
  // We derive zoneRecordId from the view's lineItems (each lineItem has findingId)
  // The WcvZone doesn't carry zoneRecordId directly, but zoneLabel is the key.
  // To map zoneRecordId → zoneLabel, we need findingId → zoneRecordId linkage.
  // However WcvZone's lineItems carry findingId but not zoneRecordId.
  // We use a two-pass approach:
  //   1. Build findingId → zone map from view.zones[].lineItems
  //   2. For zone-level photos (findingId null), match via photo.zoneRecordId —
  //      but the view doesn't expose zoneRecordId directly.
  //
  // Workaround: build a map of zoneRecordId → zone by scanning photo records
  // that have findingId set and using those findingId → zone associations to
  // infer which zoneRecordId belongs to which zone.

  // findingId → WcvZone
  const findingToZone = new Map<number, (typeof view.zones)[0]>();
  for (const zone of view.zones) {
    for (const li of zone.lineItems) {
      findingToZone.set(li.findingId, zone);
    }
  }

  // zoneRecordId → WcvZone (inferred from photos that have both fields set)
  const zoneRecordToZone = new Map<number, (typeof view.zones)[0]>();
  for (const photo of photos) {
    if (photo.zoneRecordId !== null && photo.findingId !== null) {
      const zone = findingToZone.get(photo.findingId);
      if (zone) zoneRecordToZone.set(photo.zoneRecordId, zone);
    }
  }
  // Also populate from photos that only have zoneRecordId (zone-level photos)
  // by iterating view zones in label order — if there's still no mapping,
  // we just skip unresolvable zone-level photos (they'll appear in flat fallback).

  // findingId → issueDisplayLabel
  const findingToLabel = new Map<number, string>();
  for (const zone of view.zones) {
    for (const li of zone.lineItems) {
      findingToLabel.set(li.findingId, li.issueDisplayLabel);
    }
  }

  // Group photos
  // Key: zoneLabel; value: accumulated group
  const groups = new Map<string, PdfWcbZonePhotoGroup>();

  function getOrCreateGroup(zone: (typeof view.zones)[0]): PdfWcbZonePhotoGroup {
    let g = groups.get(zone.zoneLabel);
    if (!g) {
      g = {
        zoneLabel: zone.zoneLabel,
        zoneRecordId: 0, // will be set below
        zonePhotoUrls: [],
        findingGroups: [],
      };
      groups.set(zone.zoneLabel, g);
    }
    return g;
  }

  for (const photo of photos) {
    if (!photo.url) continue;

    let zone: (typeof view.zones)[0] | undefined;

    if (photo.findingId !== null) {
      zone = findingToZone.get(photo.findingId);
    } else if (photo.zoneRecordId !== null) {
      zone = zoneRecordToZone.get(photo.zoneRecordId);
    }

    if (!zone) continue; // unlinked — excluded from per-zone rendering

    const group = getOrCreateGroup(zone);
    if (photo.zoneRecordId !== null && group.zoneRecordId === 0) {
      group.zoneRecordId = photo.zoneRecordId;
    }

    if (photo.findingId !== null) {
      // finding-level photo
      let fg = group.findingGroups.find(f => f.findingId === photo.findingId);
      if (!fg) {
        fg = {
          findingId: photo.findingId,
          issueDisplayLabel: findingToLabel.get(photo.findingId) ?? `Finding ${photo.findingId}`,
          photoUrls: [],
        };
        group.findingGroups.push(fg);
      }
      fg.photoUrls.push(photo.url);
    } else {
      // zone-level photo (no finding link)
      group.zonePhotoUrls.push(photo.url);
    }
  }

  // Return in zone display order
  return view.zones
    .map(z => groups.get(z.zoneLabel))
    .filter((g): g is PdfWcbZonePhotoGroup => g !== undefined);
}

function validateRows(
  invoiceId: number,
  workOrders: Array<{ workOrder: WorkOrder; items: WorkOrderItem[] }>,
  billingSheets: Array<{ billingSheet: BillingSheet; items: BillingSheetItem[] }>,
  wetCheckBillings: Array<WetCheckBilling>,
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
      const billingSheets: Array<{ billingSheet: BillingSheet; items: BillingSheetItem[]; wetCheckView?: WetCheckBillingView }> = [];
      const wetCheckBillingRows: PdfWetCheckBillingRow[] = [];

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
              const wetCheckView = await this.storage.getBillingSheetWetCheckView(
                billingSheet.id,
                customer.companyId,
              ).catch(() => null);
              billingSheets.push({
                billingSheet: billingSheet,
                items: billingSheet.items || [],
                wetCheckView: wetCheckView ?? undefined,
              });
            }
          }
        } else if (item.sourceType === 'wet_check_billing' && item.wetCheckBillingId) {
          const existing = wetCheckBillingRows.find(r => r.wetCheckBillingId === item.wetCheckBillingId);
          if (!existing) {
            const wcb = await this.storage.getWetCheckBillingById(item.wetCheckBillingId);
            if (wcb) {
              const wetCheckView = await this.storage.getWetCheckBillingViewById(
                wcb.id,
                customer.companyId,
              ).catch(() => null);
              if (wetCheckView) {
                const photosWithMeta = await this.storage.getWetCheckPhotosGrouped(wcb.wetCheckId);
                const photoUrls = photosWithMeta.map(p => p.url);

                // Task #843 — build per-zone photo grouping so ticketPageWCB can
                // render photos under the zone/finding they belong to.
                const zonePhotoGroups = buildWcbZonePhotoGroups(photosWithMeta, wetCheckView);

                wetCheckBillingRows.push({
                  wetCheckBillingId: wcb.id,
                  wetCheckBilling: wcb,
                  wetCheckView,
                  photoUrls,
                  zonePhotoGroups: zonePhotoGroups.length > 0 ? zonePhotoGroups : undefined,
                });
              }
            }
          }
        }
      }

      // ── Merge wet_check_photos (new system) with legacy wcb.photos ─────────
      // photoUrls was fetched per-row above via getWetCheckPhotosGrouped.
      // Merge with the legacy snapshot (wcb.photos) for the flat fallback.
      for (const r of wetCheckBillingRows) {
        const newSystemUrls = r.photoUrls ?? [];
        const legacyUrls = Array.isArray(r.wetCheckBilling.photos)
          ? (r.wetCheckBilling.photos as string[]).filter(Boolean)
          : [];
        const seen = new Set<string>();
        const merged: string[] = [];
        for (const url of [...newSystemUrls, ...legacyUrls]) {
          if (!seen.has(url)) { seen.add(url); merged.push(url); }
        }
        r.mergedPhotoUrls = merged;
      }

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
        wetCheckBillings: wetCheckBillingRows,
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
