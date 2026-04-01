import type {
  PdfViewModel,
  PdfCompanyHeader,
  PdfInvoiceHeader,
  PdfWorkOrderRow,
  PdfBillingSheetRow,
  PdfTotals,
} from './pdf-view-model';

export const FAILED_PHOTO_SENTINEL = '__PHOTO_UNAVAILABLE__';

export function formatWorkSummary(text: string | null | undefined): string {
  if (!text || text.trim().length === 0) return '';
  const trimmed = text.trim();
  const paragraphs = trimmed.split(/\n\n+/);
  if (paragraphs.length > 1) {
    return paragraphs
      .map(p => `<p style="margin: 0 0 8px 0;">${p.trim().replace(/\n/g, '<br>')}</p>`)
      .join('');
  }
  if (trimmed.length > 300 && !trimmed.includes('\n')) {
    const sentences = trimmed
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
    if (sentences.length > 1) {
      const items = sentences.map(s => `<li style="margin-bottom: 4px;">${s}</li>`).join('');
      return `<ul style="margin: 0; padding-left: 18px; list-style-type: disc;">${items}</ul>`;
    }
  }
  return `<p style="margin: 0;">${trimmed.replace(/\n/g, '<br>')}</p>`;
}

export async function fetchLogoAsBase64(logoUrl: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(logoUrl, { signal: controller.signal });
    if (!response.ok) {
      console.warn(`[PDF] Logo fetch returned non-OK status ${response.status} for URL: ${logoUrl}`);
      return null;
    }
    const contentType = response.headers.get('content-type') || 'image/png';
    const mimeType = contentType.split(';')[0].trim();
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.warn(`[PDF] Failed to fetch logo from ${logoUrl}:`, error instanceof Error ? error.message : error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

export function invoiceHeader(invoice: PdfInvoiceHeader, company: PdfCompanyHeader): string {
  return `
  <div class="pdf-header">
    <div class="pdf-company">
      ${company.logoDataUri
        ? `<img src="${company.logoDataUri}" class="company-logo" alt="${company.name}">`
        : ''
      }
      <div class="company-name">${company.name}</div>
      <div class="company-details">
        ${company.address ? `${company.address}<br>` : ''}
        ${company.phone ? `Phone: ${company.phone}<br>` : ''}
        ${company.email ? `Email: ${company.email}` : ''}
      </div>
    </div>
    <div class="pdf-invoice-meta">
      <div class="invoice-title">INVOICE DETAIL REPORT</div>
      <div class="invoice-subtitle">Comprehensive Work Breakdown</div>
      <div class="invoice-meta-rows">
        <div><span class="meta-label">Invoice #:</span> ${invoice.invoiceNumber}</div>
        <div><span class="meta-label">Period:</span> ${formatDate(invoice.periodStart)} – ${formatDate(invoice.periodEnd)}</div>
        <div><span class="meta-label">Generated:</span> ${formatDate(invoice.generatedAt)}</div>
      </div>
    </div>
  </div>`;
}

export function billToBlock(invoice: PdfInvoiceHeader): string {
  return `
  <div class="bill-to-block">
    <div class="bill-to-label">Bill To</div>
    <div class="bill-to-name">${invoice.customerName}</div>
    <div class="bill-to-details">
      ${invoice.customerEmail ? `${invoice.customerEmail}<br>` : ''}
      ${invoice.customerPhone ? invoice.customerPhone : ''}
    </div>
  </div>`;
}

export function summaryTotalsCard(
  totals: PdfTotals,
  workOrderCount: number,
  billingSheetCount: number
): string {
  return `
  <div class="summary-totals-card">
    <div class="summary-totals-grid">
      <div class="summary-totals-item">
        <div class="summary-totals-label">Work Orders</div>
        <div class="summary-totals-value">${workOrderCount}</div>
      </div>
      <div class="summary-totals-item">
        <div class="summary-totals-label">Billing Sheets</div>
        <div class="summary-totals-value">${billingSheetCount}</div>
      </div>
      <div class="summary-totals-item">
        <div class="summary-totals-label">Total Labor</div>
        <div class="summary-totals-value">${formatCurrency(totals.laborSubtotal)}</div>
      </div>
      <div class="summary-totals-item">
        <div class="summary-totals-label">Total Parts</div>
        <div class="summary-totals-value">${formatCurrency(totals.partsSubtotal)}</div>
      </div>
      <div class="summary-totals-item summary-totals-grand">
        <div class="summary-totals-label">Invoice Total</div>
        <div class="summary-totals-value summary-totals-grand-amount">${formatCurrency(totals.grandTotal)}</div>
      </div>
    </div>
  </div>`;
}

export function tableOfContents(
  workOrders: PdfWorkOrderRow[],
  billingSheets: PdfBillingSheetRow[]
): string {
  if (workOrders.length === 0 && billingSheets.length === 0) return '';

  const woRows = workOrders.map((wo, i) => `
    <tr>
      <td class="toc-num">${i + 1}</td>
      <td class="toc-type toc-type-wo">Work Order</td>
      <td>${wo.workOrderNumber}</td>
      <td>${wo.projectName}</td>
      <td class="toc-amount">${formatCurrency(wo.rowTotal)}</td>
    </tr>`).join('');

  const bsRows = billingSheets.map((bs, i) => `
    <tr>
      <td class="toc-num">${workOrders.length + i + 1}</td>
      <td class="toc-type toc-type-bs">Billing Sheet</td>
      <td>${bs.billingNumber}</td>
      <td>${bs.workDescription}</td>
      <td class="toc-amount">${formatCurrency(bs.rowTotal)}</td>
    </tr>`).join('');

  return `
  <div class="toc-block">
    <div class="toc-title">Document Overview</div>
    <table class="toc-table">
      <thead>
        <tr>
          <th class="toc-num">#</th>
          <th>Type</th>
          <th>Number</th>
          <th>Description</th>
          <th class="toc-amount">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${woRows}
        ${bsRows}
      </tbody>
    </table>
  </div>`;
}

export function sectionBanner(type: 'work-orders' | 'billing-sheets'): string {
  const isWO = type === 'work-orders';
  const label = isWO ? 'Work Orders' : 'Billing Sheets';
  const colorClass = isWO ? 'banner-wo' : 'banner-bs';
  const icon = isWO
    ? `<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>`
    : `<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20M8 4v5"/></svg>`;

  return `
  <div class="section-banner ${colorClass}">
    <span class="section-banner-icon">${icon}</span>
    <span class="section-banner-label">${label}</span>
  </div>`;
}

export function partsTableFromWO(items: PdfWorkOrderRow['items']): string {
  if (!items || items.length === 0) {
    return `<p class="no-items-msg">No line items recorded.</p>`;
  }
  const rows = items.map(item => {
    const subLines = [item.partDescription, item.notes].filter(Boolean).map(s => `<small class="item-note">${s}</small>`).join('');
    return `
      <tr>
        <td>${item.partName}${subLines ? `<br>${subLines}` : ''}</td>
        <td class="text-right">${item.quantity}</td>
        <td class="text-right">${formatCurrency(item.unitPrice)}</td>
        <td class="text-right">${item.laborHours}</td>
        <td class="text-right">${formatCurrency(item.rowTotal)}</td>
      </tr>`;
  }).join('');
  return `
  <div class="parts-table-wrap">
    <div class="parts-table-heading">Parts &amp; Labor Details</div>
    <table class="items-table">
      <thead>
        <tr>
          <th>Part Description</th>
          <th class="text-right">Qty</th>
          <th class="text-right">Unit Price</th>
          <th class="text-right">Labor Hrs</th>
          <th class="text-right">Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

export function partsTableFromBS(items: PdfBillingSheetRow['items']): string {
  if (!items || items.length === 0) {
    return `<p class="no-items-msg">No line items recorded.</p>`;
  }
  const rows = items.map(item => {
    const subLines = [item.partDescription, item.notes].filter(Boolean).map(s => `<small class="item-note">${s}</small>`).join('');
    return `
      <tr>
        <td>${item.partName}${subLines ? `<br>${subLines}` : ''}</td>
        <td class="text-right">${item.quantity}</td>
        <td class="text-right">${formatCurrency(item.unitPrice)}</td>
        <td class="text-right">${item.laborHours}</td>
        <td class="text-right">${formatCurrency(item.rowTotal)}</td>
      </tr>`;
  }).join('');
  return `
  <div class="parts-table-wrap">
    <div class="parts-table-heading">Parts &amp; Labor Details</div>
    <table class="items-table">
      <thead>
        <tr>
          <th>Part Description</th>
          <th class="text-right">Qty</th>
          <th class="text-right">Unit Price</th>
          <th class="text-right">Labor Hrs</th>
          <th class="text-right">Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

export function laborAndTotalsBox(args: {
  partsSubtotal: number;
  laborHours: number;
  laborRate: number;
  laborSubtotal: number;
  total: number;
  label: string;
}): string {
  return `
  <div class="totals-box">
    <div class="totals-row">
      <span class="totals-row-label">Parts Subtotal</span>
      <span class="totals-row-value">${formatCurrency(args.partsSubtotal)}</span>
    </div>
    <div class="totals-row">
      <span class="totals-row-label">Labor Subtotal (${args.laborHours} hrs × ${formatCurrency(args.laborRate)})</span>
      <span class="totals-row-value">${formatCurrency(args.laborSubtotal)}</span>
    </div>
    <div class="totals-row totals-row-grand">
      <span class="totals-row-label">${args.label}</span>
      <span class="totals-row-value">${formatCurrency(args.total)}</span>
    </div>
  </div>`;
}

export function photoGrid(dataUris: string[]): string {
  if (!dataUris || dataUris.length === 0) return '';

  const COLS = 3;
  const cells = dataUris.map(uri => {
    if (uri === FAILED_PHOTO_SENTINEL) {
      return `<div class="photo-cell photo-unavailable">Image unavailable</div>`;
    }
    return `<div class="photo-cell"><img src="${uri}" alt="Work photo" class="photo-img"></div>`;
  });

  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += COLS) {
    const slice = cells.slice(i, i + COLS);
    while (slice.length < COLS) slice.push(`<div class="photo-cell photo-empty"></div>`);
    rows.push(`<div class="photo-row">${slice.join('')}</div>`);
  }

  return `
  <div class="photo-grid-wrap">
    <div class="photo-grid-heading">Work Photos</div>
    <div class="photo-grid">${rows.join('')}</div>
  </div>`;
}

export function workRecordCard(wo: PdfWorkOrderRow, photoDataUris: string[]): string {
  const descHtml = (wo.aiDetailedDescription || wo.workSummary || wo.workDescription)
    ? `<div class="record-description" style="border-left: 3px solid #d1d5db;">
         <div class="record-description-label">Work Performed</div>
         <div class="record-description-body" style="line-height: 1.6;">${formatWorkSummary(wo.aiDetailedDescription || wo.workSummary || wo.workDescription)}</div>
       </div>`
    : '';

  const locationHtml = (wo.projectAddress || wo.locationNotes)
    ? `<div class="record-meta-grid">
         ${wo.projectAddress ? `<div class="meta-item"><div class="meta-label">Service Location</div><div class="meta-value">${wo.projectAddress}</div></div>` : ''}
         ${wo.locationNotes ? `<div class="meta-item"><div class="meta-label">Location Notes</div><div class="meta-value">${wo.locationNotes}</div></div>` : ''}
       </div>`
    : '';

  return `
  <div class="record-card">
    <div class="record-card-header">
      <div class="record-card-title">Work Order #${wo.workOrderNumber}</div>
      <div class="record-card-subtitle">${wo.projectName}</div>
    </div>
    ${locationHtml}
    <div class="record-meta-grid">
      <div class="meta-item">
        <div class="meta-label">Technician</div>
        <div class="meta-value">${wo.technicianName}</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">Date Completed</div>
        <div class="meta-value">${wo.completedAt ? formatDate(wo.completedAt) : 'N/A'}</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">Total Hours</div>
        <div class="meta-value">${wo.totalHours} hrs</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">Labor Rate</div>
        <div class="meta-value">${formatCurrency(wo.laborRate)}/hr</div>
      </div>
    </div>
    ${descHtml}
    ${partsTableFromWO(wo.items)}
    ${photoGrid(photoDataUris)}
    ${laborAndTotalsBox({
      partsSubtotal: wo.partsSubtotal,
      laborHours: wo.totalHours,
      laborRate: wo.laborRate,
      laborSubtotal: wo.laborSubtotal,
      total: wo.rowTotal,
      label: 'Work Order Total',
    })}
  </div>`;
}

export function billingSheetCard(bs: PdfBillingSheetRow, photoDataUris: string[]): string {
  const serviceDescHtml = (bs.workDescription && bs.notes && bs.workDescription.trim() !== bs.notes.trim())
    ? `<div style="background: #f9fafb; padding: 10px 15px; border-radius: 6px; margin-bottom: 12px;">
         <span style="font-weight: 600; color: #6b7280; font-size: 12px;">Service Description:</span>
         <span style="color: #1f2937; font-size: 13px; margin-left: 6px;">${bs.workDescription}</span>
       </div>`
    : '';

  const descHtml = bs.aiDetailedDescription
    ? `<div class="record-description" style="border-left: 3px solid #d1d5db;">
         <div class="record-description-label">Work Performed</div>
         <div class="record-description-body" style="line-height: 1.6;">${formatWorkSummary(bs.aiDetailedDescription)}</div>
       </div>`
    : '';

  const notesHtml = bs.notes
    ? `<div class="record-description" style="border-left: 3px solid #d1d5db;">
         <div class="record-description-label">Work Notes</div>
         <div class="record-description-body" style="line-height: 1.6;">${formatWorkSummary(bs.notes)}</div>
       </div>`
    : '';

  const locationHtml = bs.propertyAddress
    ? `<div class="record-meta-grid">
         <div class="meta-item">
           <div class="meta-label">Service Location</div>
           <div class="meta-value">${bs.propertyAddress}</div>
         </div>
       </div>`
    : '';

  return `
  <div class="record-card record-card-bs">
    <div class="record-card-header">
      <div class="record-card-title">Billing Sheet #${bs.billingNumber}</div>
      <div class="record-card-subtitle">${bs.workDescription}</div>
    </div>
    ${locationHtml}
    <div class="record-meta-grid">
      <div class="meta-item">
        <div class="meta-label">Technician</div>
        <div class="meta-value">${bs.technicianName}</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">Work Date</div>
        <div class="meta-value">${formatDate(bs.workDate)}</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">Total Hours</div>
        <div class="meta-value">${bs.totalHours} hrs</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">Labor Rate</div>
        <div class="meta-value">${formatCurrency(bs.laborRate)}/hr</div>
      </div>
    </div>
    ${serviceDescHtml}
    ${descHtml}
    ${notesHtml}
    ${partsTableFromBS(bs.items)}
    ${photoGrid(photoDataUris)}
    ${laborAndTotalsBox({
      partsSubtotal: bs.partsSubtotal,
      laborHours: bs.totalHours,
      laborRate: bs.laborRate,
      laborSubtotal: bs.laborSubtotal,
      total: bs.rowTotal,
      label: 'Billing Sheet Total',
    })}
  </div>`;
}

export function finalSummaryTable(vm: PdfViewModel): string {
  const { workOrders, billingSheets, totals } = vm;

  const woRows = workOrders.map(wo => `
    <tr>
      <td class="fs-type fs-type-wo">Work Order</td>
      <td>${wo.workOrderNumber}</td>
      <td>${wo.projectName}</td>
      <td class="text-right">${formatCurrency(wo.partsSubtotal)}</td>
      <td class="text-right">${formatCurrency(wo.laborSubtotal)}</td>
      <td class="text-right fs-total">${formatCurrency(wo.rowTotal)}</td>
    </tr>`).join('');

  const bsRows = billingSheets.map(bs => `
    <tr>
      <td class="fs-type fs-type-bs">Billing Sheet</td>
      <td>${bs.billingNumber}</td>
      <td>${bs.workDescription}</td>
      <td class="text-right">${formatCurrency(bs.partsSubtotal)}</td>
      <td class="text-right">${formatCurrency(bs.laborSubtotal)}</td>
      <td class="text-right fs-total">${formatCurrency(bs.rowTotal)}</td>
    </tr>`).join('');

  return `
  <div class="final-summary">
    <div class="final-summary-title">Invoice Summary</div>
    <table class="fs-table">
      <thead>
        <tr>
          <th>Type</th>
          <th>Number</th>
          <th>Description</th>
          <th class="text-right">Parts</th>
          <th class="text-right">Labor</th>
          <th class="text-right">Total</th>
        </tr>
      </thead>
      <tbody>
        ${woRows}
        ${bsRows}
      </tbody>
    </table>
    <div class="fs-grand-totals">
      <div class="fs-grand-row">
        <span>Total Parts</span>
        <span>${formatCurrency(totals.partsSubtotal)}</span>
      </div>
      <div class="fs-grand-row">
        <span>Total Labor</span>
        <span>${formatCurrency(totals.laborSubtotal)}</span>
      </div>
      <div class="fs-grand-row fs-grand-invoice-total">
        <span>Invoice Total</span>
        <span>${formatCurrency(totals.grandTotal)}</span>
      </div>
    </div>
  </div>`;
}

export function pageFooter(invoiceNumber: string): string {
  return `
  <div class="pdf-footer">
    <span class="pdf-footer-invoice">Invoice #${invoiceNumber}</span>
    <span class="pdf-footer-page">Page <span class="pdf-page-num"></span></span>
  </div>`;
}

export function buildFullCSS(): string {
  return `
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    color: #1f2937;
    line-height: 1.6;
    background: white;
    font-size: 13px;
  }

  .container {
    max-width: 100%;
    padding: 0 20px 80px 20px;
  }

  /* ───────── HEADER ───────── */
  .pdf-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 3px solid #3B82F6;
    padding: 24px 0 20px;
    margin-bottom: 28px;
  }
  .pdf-company { flex: 1; }
  .company-logo {
    max-width: 180px;
    max-height: 60px;
    width: auto;
    height: auto;
    object-fit: contain;
    display: block;
    margin-bottom: 10px;
  }
  .company-name { font-size: 22px; font-weight: 700; color: #3B82F6; margin-bottom: 4px; }
  .company-details { font-size: 11px; color: #6b7280; line-height: 1.5; }

  .pdf-invoice-meta { text-align: right; }
  .invoice-title { font-size: 26px; font-weight: 700; color: #1f2937; }
  .invoice-subtitle { font-size: 13px; color: #6b7280; margin-bottom: 8px; }
  .invoice-meta-rows { font-size: 12px; line-height: 1.9; }
  .meta-label { font-weight: 600; color: #1f2937; }

  /* ───────── BILL-TO ───────── */
  .bill-to-block {
    background: #f9fafb;
    border-radius: 8px;
    padding: 16px 20px;
    margin-bottom: 24px;
  }
  .bill-to-label { font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 6px; }
  .bill-to-name { font-size: 17px; font-weight: 700; color: #1f2937; margin-bottom: 4px; }
  .bill-to-details { font-size: 12px; color: #4b5563; }

  /* ───────── SUMMARY TOTALS CARD ───────── */
  .summary-totals-card {
    background: linear-gradient(135deg, #1e40af 0%, #3B82F6 100%);
    border-radius: 10px;
    padding: 24px;
    margin-bottom: 24px;
    color: white;
  }
  .summary-totals-grid {
    display: flex;
    gap: 0;
    align-items: stretch;
  }
  .summary-totals-item {
    flex: 1;
    text-align: center;
    padding: 0 12px;
    border-right: 1px solid rgba(255,255,255,0.25);
  }
  .summary-totals-item:last-child { border-right: none; }
  .summary-totals-label { font-size: 11px; opacity: 0.85; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.4px; }
  .summary-totals-value { font-size: 22px; font-weight: 700; }
  .summary-totals-grand { background: rgba(255,255,255,0.12); border-radius: 8px; }
  .summary-totals-grand-amount { font-size: 26px; }

  /* ───────── TABLE OF CONTENTS ───────── */
  .toc-block { margin-bottom: 32px; }
  .toc-title { font-size: 16px; font-weight: 700; color: #1f2937; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 2px solid #e5e7eb; }
  .toc-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .toc-table thead tr { background: #f3f4f6; }
  .toc-table th { padding: 10px 12px; text-align: left; font-weight: 600; color: #374151; border-bottom: 2px solid #d1d5db; }
  .toc-table tbody tr { border-bottom: 1px solid #e5e7eb; }
  .toc-table td { padding: 9px 12px; color: #1f2937; }
  .toc-num { width: 36px; font-weight: 600; color: #6b7280; }
  .toc-type { font-weight: 600; }
  .toc-type-wo { color: #1d4ed8; }
  .toc-type-bs { color: #047857; }
  .toc-amount { text-align: right; font-weight: 600; }

  /* ───────── SECTION BANNER ───────── */
  .section-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 20px;
    border-radius: 6px;
    margin: 36px 0 20px;
    font-size: 17px;
    font-weight: 700;
    color: white;
    page-break-inside: avoid;
  }
  .banner-wo { background: linear-gradient(90deg, #1d4ed8 0%, #3B82F6 100%); }
  .banner-bs { background: linear-gradient(90deg, #065f46 0%, #059669 100%); }
  .section-banner-icon { opacity: 0.9; display: flex; align-items: center; }
  .section-banner-label { letter-spacing: 0.3px; }

  /* ───────── RECORD CARD ───────── */
  .record-card {
    border: 1.5px solid #e5e7eb;
    border-radius: 8px;
    margin-bottom: 28px;
    overflow: hidden;
    page-break-inside: avoid;
  }
  .record-card-bs { border-left: 4px solid #059669; }

  .record-card-header {
    background: #f3f4f6;
    border-bottom: 1px solid #e5e7eb;
    padding: 14px 18px;
  }
  .record-card-title { font-size: 16px; font-weight: 700; color: #1f2937; }
  .record-card-subtitle { font-size: 12px; color: #6b7280; margin-top: 2px; }

  /* ───────── META GRID (inside card) ───────── */
  .record-meta-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    padding: 14px 18px;
    background: #fafafa;
    border-bottom: 1px solid #f0f0f0;
  }
  .meta-label { font-size: 10px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 2px; }
  .meta-value { font-size: 13px; color: #1f2937; font-weight: 500; }

  /* ───────── DESCRIPTION BLOCK ───────── */
  .record-description {
    padding: 14px 18px;
    border-bottom: 1px solid #f0f0f0;
  }
  .record-description-label { font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 6px; }
  .record-description-body { font-size: 13px; color: #1f2937; line-height: 1.7; white-space: pre-wrap; }

  /* ───────── PARTS TABLE ───────── */
  .parts-table-wrap { padding: 14px 18px; border-bottom: 1px solid #f0f0f0; }
  .parts-table-heading { font-size: 13px; font-weight: 600; color: #1f2937; margin-bottom: 10px; }
  .items-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .items-table thead { background: #1f2937; color: white; }
  .items-table th { padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; }
  .items-table th.text-right { text-align: right; }
  .items-table tbody tr { border-bottom: 1px solid #e5e7eb; }
  .items-table tbody tr:nth-child(even) { background: #f9fafb; }
  .items-table td { padding: 10px 12px; color: #1f2937; }
  .items-table td.text-right { text-align: right; }
  .item-note { color: #6b7280; font-size: 11px; }
  .no-items-msg { padding: 12px 18px; color: #9ca3af; font-size: 12px; font-style: italic; }

  /* ───────── PHOTO GRID ───────── */
  .photo-grid-wrap { padding: 14px 18px; border-bottom: 1px solid #f0f0f0; }
  .photo-grid-heading { font-size: 13px; font-weight: 600; color: #1f2937; margin-bottom: 10px; }
  .photo-grid { display: flex; flex-direction: column; gap: 6px; }
  .photo-row { display: flex; gap: 6px; }
  .photo-cell { flex: 1; }
  .photo-img { width: 100%; height: 140px; object-fit: cover; border-radius: 5px; border: 1px solid #e5e7eb; display: block; }
  .photo-unavailable {
    height: 140px; background: #f3f4f6; border: 2px dashed #d1d5db; border-radius: 5px;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; color: #9ca3af; text-align: center;
  }
  .photo-empty { height: 140px; }

  /* ───────── LABOR & TOTALS BOX ───────── */
  .totals-box { padding: 16px 18px; background: #f9fafb; }
  .totals-row {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    font-size: 13px;
    color: #6b7280;
    border-bottom: 1px solid #f0f0f0;
  }
  .totals-row:last-child { border-bottom: none; }
  .totals-row-value { font-weight: 500; }
  .totals-row-grand {
    border-top: 2px solid #3B82F6;
    margin-top: 8px;
    padding-top: 10px;
    font-size: 15px;
    font-weight: 700;
    color: #1f2937;
  }
  .totals-row-grand .totals-row-value { color: #1d4ed8; }

  /* ───────── FINAL SUMMARY ───────── */
  .final-summary {
    margin-top: 40px;
    padding: 24px;
    background: #f9fafb;
    border-radius: 10px;
    border: 2px solid #e5e7eb;
    page-break-inside: avoid;
  }
  .final-summary-title {
    font-size: 20px; font-weight: 700; color: #1f2937;
    margin-bottom: 18px; padding-bottom: 10px; border-bottom: 2px solid #3B82F6;
  }
  .fs-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 20px; }
  .fs-table thead tr { background: #e5e7eb; }
  .fs-table th { padding: 10px 12px; text-align: left; font-weight: 600; color: #374151; border-bottom: 2px solid #d1d5db; }
  .fs-table th.text-right { text-align: right; }
  .fs-table tbody tr { border-bottom: 1px solid #e5e7eb; }
  .fs-table tbody tr:nth-child(even) { background: #ffffff; }
  .fs-table td { padding: 9px 12px; color: #1f2937; }
  .fs-table td.text-right { text-align: right; }
  .fs-type { font-weight: 600; font-size: 11px; }
  .fs-type-wo { color: #1d4ed8; }
  .fs-type-bs { color: #047857; }
  .fs-total { font-weight: 700; }
  .fs-grand-totals {
    margin-top: 8px; padding: 16px 20px;
    background: white; border-radius: 8px; border: 2px solid #3B82F6;
  }
  .fs-grand-row {
    display: flex; justify-content: space-between;
    padding: 7px 0; font-size: 14px; color: #6b7280; border-bottom: 1px solid #f0f0f0;
  }
  .fs-grand-row:last-child { border-bottom: none; }
  .fs-grand-invoice-total {
    border-top: 2px solid #3B82F6; margin-top: 8px; padding-top: 12px;
    font-size: 18px; font-weight: 700; color: #1f2937;
  }
  .fs-grand-invoice-total span:last-child { color: #1d4ed8; }

  /* ───────── PAGE FOOTER ───────── */
  .pdf-footer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 40px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 24px;
    background: white;
    border-top: 1px solid #e5e7eb;
    font-size: 11px;
    color: #9ca3af;
    z-index: 1000;
  }
  .pdf-footer-invoice { font-weight: 600; color: #6b7280; }

  /* counter-based page numbering */
  @page { margin: 0.5in 0.5in 0.75in 0.5in; }
  .pdf-page-num::before { content: counter(page); }

  /* ───────── PRINT ───────── */
  @media print {
    .record-card { page-break-inside: avoid; }
    .section-banner { page-break-before: auto; }
    .final-summary { page-break-inside: avoid; }
  }
  `;
}
