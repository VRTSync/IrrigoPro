import type { Invoice, WorkOrder, WorkOrderItem, BillingSheet, BillingSheetItem } from '@shared/schema';

// ── Sub-interfaces ──────────────────────────────────────────────────────────

export interface PdfCompanyHeader {
  name: string;
  logo: string;
  logoDataUri: string | null;
  address: string;
  phone: string;
  email: string;
}

export interface PdfInvoiceHeader {
  invoiceNumber: string;
  periodStart: Date;
  periodEnd: Date;
  generatedAt: Date;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
}

export interface PdfWorkOrderItemRow {
  partName: string;
  partDescription: string;
  quantity: string;
  unitPrice: number;
  laborHours: number;
  rowTotal: number;
  notes: string;
}

export interface PdfWorkOrderRow {
  workOrderNumber: string;
  projectName: string;
  projectAddress: string;
  locationNotes: string;
  technicianName: string;
  completedAt: Date | null;
  totalHours: number;
  laborRate: number;
  markupAmount: number;
  taxAmount: number;
  workDescription: string;
  workSummary: string;
  aiDetailedDescription: string;
  photos: string[];
  items: PdfWorkOrderItemRow[];
  partsSubtotal: number;
  laborSubtotal: number;
  rowTotal: number;
  approvedBy: string | null;
  approvedAt: Date | null;
}

export interface PdfBillingSheetItemRow {
  partName: string;
  partDescription: string;
  quantity: string;
  unitPrice: number;
  laborHours: number;
  rowTotal: number;
  notes: string;
}

export interface PdfBillingSheetRow {
  billingNumber: string;
  workDescription: string;
  propertyAddress: string;
  technicianName: string;
  workDate: Date;
  totalHours: number;
  laborRate: number;
  markupAmount: number;
  taxAmount: number;
  aiDetailedDescription: string;
  notes: string;
  photos: string[];
  items: PdfBillingSheetItemRow[];
  partsSubtotal: number;
  laborSubtotal: number;
  rowTotal: number;
  approvedBy: string | null;
  approvedAt: Date | null;
}

export interface PdfTotals {
  partsSubtotal: number;
  laborSubtotal: number;
  grandTotal: number;
  storedTotalAmount: number;
}

export interface PdfBrandColors {
  navy: string;
  brown: string;
  green: string;
  black: string;
  gray: string;
}

export const DEFAULT_BRAND_COLORS: PdfBrandColors = {
  navy: '#2F4A7A',
  brown: '#8B4F2B',
  green: '#7FB539',
  black: '#000000',
  gray: '#F5F5F5',
};

export interface PdfViewModel {
  company: PdfCompanyHeader;
  invoice: PdfInvoiceHeader;
  workOrders: PdfWorkOrderRow[];
  billingSheets: PdfBillingSheetRow[];
  totals: PdfTotals;
  totalJobs: number;
  validationWarning: string | null;
  brandColors: PdfBrandColors;
}

// ── Raw input type ──────────────────────────────────────────────────────────

export interface InvoiceDetailData {
  invoice: Invoice;
  company: {
    name: string;
    logo?: string;
    logoDataUri?: string | null;
    address?: string;
    phone?: string;
    email?: string;
  };
  workOrders: Array<{
    workOrder: WorkOrder;
    items: WorkOrderItem[];
  }>;
  billingSheets: Array<{
    billingSheet: BillingSheet;
    items: BillingSheetItem[];
  }>;
  laborRate?: string;
  brandColors?: PdfBrandColors;
}

// ── Build result ────────────────────────────────────────────────────────────

export interface BuildPdfViewModelResult {
  viewModel: PdfViewModel;
  validationWarning: string | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function safeNum(value: string | number | null | undefined, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return isNaN(n) ? fallback : n;
}

function safeStr(value: string | null | undefined, fallback = ''): string {
  return value ?? fallback;
}

function safePhotos(value: string[] | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(p => typeof p === 'string' && p.length > 0);
}

// ── Builder ─────────────────────────────────────────────────────────────────

export function buildPdfViewModel(data: InvoiceDetailData): BuildPdfViewModelResult {
  const { invoice, company, workOrders: rawWorkOrders, billingSheets: rawBillingSheets, laborRate: passedLaborRate } = data;

  const defaultLaborRate = safeNum(passedLaborRate, 0);

  const companyHeader: PdfCompanyHeader = {
    name: safeStr(company.name, 'Company'),
    logo: safeStr(company.logo),
    logoDataUri: company.logoDataUri ?? null,
    address: safeStr(company.address),
    phone: safeStr(company.phone),
    email: safeStr(company.email),
  };

  const invoiceHeader: PdfInvoiceHeader = {
    invoiceNumber: safeStr(invoice.invoiceNumber),
    periodStart: new Date(invoice.periodStart),
    periodEnd: new Date(invoice.periodEnd),
    generatedAt: new Date(),
    customerName: safeStr(invoice.customerName),
    customerEmail: safeStr(invoice.customerEmail),
    customerPhone: safeStr(invoice.customerPhone),
  };

  const workOrderRows: PdfWorkOrderRow[] = (rawWorkOrders ?? []).map(({ workOrder, items }) => {
    const totalHours = safeNum(workOrder.totalHours);
    const storedLaborSubtotal = safeNum(workOrder.laborSubtotal);
    const storedAppliedRate = safeNum(workOrder.appliedLaborRate);
    const storedLaborRate = safeNum(workOrder.laborRate);
    // Rate priority: appliedLaborRate snapshot → legacy laborRate field → customer's current rate.
    // Math-derivation (laborSubtotal / totalHours) is intentionally excluded: it would lock in
    // stale/incorrect rates from before applied_labor_rate was consistently stored.
    const woLaborRate =
      storedAppliedRate > 0 ? storedAppliedRate :
      storedLaborRate > 0 ? storedLaborRate :
      defaultLaborRate;

    const itemRows: PdfWorkOrderItemRow[] = (items ?? []).map(item => {
      const unitPrice = safeNum(item.partPrice);
      const qty = safeNum(item.quantity);
      const laborHours = safeNum(item.laborHours);
      const rowTotal = safeNum(item.totalPrice, unitPrice * qty);
      return {
        partName: safeStr(item.partName, 'Unknown Part'),
        partDescription: '',
        quantity: safeStr(String(item.quantity), '0'),
        unitPrice,
        laborHours,
        rowTotal,
        notes: safeStr(item.notes),
      };
    });

    const partsSubtotal = safeNum(workOrder.totalPartsCost, itemRows.reduce((s, r) => s + r.rowTotal, 0));
    const laborSubtotal = safeNum(workOrder.laborSubtotal, totalHours * woLaborRate);
    const rowTotal = safeNum(workOrder.totalAmount, partsSubtotal + laborSubtotal);
    const markupAmount = safeNum(workOrder.markupAmount);
    const taxAmount = safeNum(workOrder.taxAmount);

    return {
      workOrderNumber: safeStr(workOrder.workOrderNumber),
      projectName: safeStr(workOrder.projectName, 'Service Work'),
      projectAddress: safeStr(workOrder.projectAddress),
      locationNotes: safeStr(workOrder.locationNotes),
      technicianName: safeStr(workOrder.completedByUserName || workOrder.assignedTechnicianName, 'N/A'),
      completedAt: workOrder.completedAt ? new Date(workOrder.completedAt) : null,
      totalHours,
      laborRate: woLaborRate,
      markupAmount,
      taxAmount,
      workDescription: safeStr(workOrder.description),
      workSummary: safeStr(workOrder.workSummary),
      aiDetailedDescription: safeStr(workOrder.aiDetailedDescription),
      photos: safePhotos(workOrder.photos),
      items: itemRows,
      partsSubtotal,
      laborSubtotal,
      rowTotal,
      approvedBy: safeStr(workOrder.approvedBy) || null,
      approvedAt: workOrder.approvedAt ? new Date(workOrder.approvedAt) : null,
    };
  });

  const billingSheetRows: PdfBillingSheetRow[] = (rawBillingSheets ?? []).map(({ billingSheet, items }) => {
    const totalHours = safeNum(billingSheet.totalHours);
    const bsStoredLaborSubtotal = safeNum(billingSheet.laborSubtotal);
    const bsStoredLaborRate = safeNum(billingSheet.laborRate);
    // Rate priority: stored laborRate field → customer's current rate.
    // Math-derivation is excluded for the same reason as work orders.
    const bsLaborRate =
      bsStoredLaborRate > 0 ? bsStoredLaborRate :
      defaultLaborRate;

    const itemRows: PdfBillingSheetItemRow[] = (items ?? []).map(item => {
      const unitPrice = safeNum(item.unitPrice);
      const qty = safeNum(item.quantity);
      const laborHours = safeNum(item.laborHours);
      const rowTotal = safeNum(item.totalPrice, unitPrice * qty);
      return {
        partName: safeStr(item.partName, 'Unknown Part'),
        partDescription: safeStr(item.partDescription),
        quantity: safeStr(String(item.quantity), '0'),
        unitPrice,
        laborHours,
        rowTotal,
        notes: safeStr(item.notes),
      };
    });

    const partsSubtotal = safeNum(billingSheet.partsSubtotal, itemRows.reduce((s, r) => s + r.rowTotal, 0));
    const laborSubtotal = safeNum(billingSheet.laborSubtotal, totalHours * bsLaborRate);
    const rowTotal = safeNum(billingSheet.totalAmount, partsSubtotal + laborSubtotal);
    const markupAmount = safeNum(billingSheet.markupAmount);
    const taxAmount = safeNum(billingSheet.taxAmount);

    return {
      billingNumber: safeStr(billingSheet.billingNumber),
      workDescription: safeStr(billingSheet.workDescription, 'Additional Work'),
      propertyAddress: safeStr(billingSheet.propertyAddress),
      technicianName: safeStr(billingSheet.technicianName, 'N/A'),
      workDate: new Date(billingSheet.workDate),
      totalHours,
      laborRate: bsLaborRate,
      markupAmount,
      taxAmount,
      aiDetailedDescription: safeStr(billingSheet.aiDetailedDescription),
      notes: safeStr(billingSheet.notes),
      photos: safePhotos(billingSheet.photos),
      items: itemRows,
      partsSubtotal,
      laborSubtotal,
      rowTotal,
      approvedBy: safeStr(billingSheet.approvedBy) || null,
      approvedAt: billingSheet.approvedAt ? new Date(billingSheet.approvedAt) : null,
    };
  });

  const computedPartsSubtotal =
    workOrderRows.reduce((s, r) => s + r.partsSubtotal, 0) +
    billingSheetRows.reduce((s, r) => s + r.partsSubtotal, 0);

  const computedLaborSubtotal =
    workOrderRows.reduce((s, r) => s + r.laborSubtotal, 0) +
    billingSheetRows.reduce((s, r) => s + r.laborSubtotal, 0);

  const computedGrandTotal =
    workOrderRows.reduce((s, r) => s + r.rowTotal, 0) +
    billingSheetRows.reduce((s, r) => s + r.rowTotal, 0);

  const storedTotalAmount = safeNum(invoice.totalAmount);

  const totals: PdfTotals = {
    partsSubtotal: safeNum(invoice.partsSubtotal, computedPartsSubtotal),
    laborSubtotal: safeNum(invoice.laborSubtotal, computedLaborSubtotal),
    grandTotal: storedTotalAmount,
    storedTotalAmount,
  };

  let validationWarning: string | null = null;
  const TOLERANCE = 0.01;
  const delta = Math.abs(computedGrandTotal - storedTotalAmount);
  if (delta > TOLERANCE) {
    validationWarning =
      `Invoice total mismatch: computed $${computedGrandTotal.toFixed(2)} vs stored $${storedTotalAmount.toFixed(2)} (delta $${delta.toFixed(2)}) for invoice ${invoice.invoiceNumber}`;
    console.warn('[PDF View Model]', validationWarning);
  }

  const viewModel: PdfViewModel = {
    company: companyHeader,
    invoice: invoiceHeader,
    workOrders: workOrderRows,
    billingSheets: billingSheetRows,
    totals,
    totalJobs: workOrderRows.length + billingSheetRows.length,
    validationWarning,
    brandColors: data.brandColors ?? DEFAULT_BRAND_COLORS,
  };

  return { viewModel, validationWarning };
}
