import type {
  PdfViewModel,
  PdfCompanyHeader,
  PdfInvoiceHeader,
  PdfWorkOrderRow,
  PdfBillingSheetRow,
  PdfTotals,
} from './pdf-view-model';

export const FAILED_PHOTO_SENTINEL = '__PHOTO_UNAVAILABLE__';

export function formatWorkSummaryAsBullets(text: string | null | undefined): string {
  if (!text || text.trim().length === 0) return '';
  const trimmed = text.trim();

  const lines = trimmed.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length > 1) {
    const items = lines.map(l => `<li>${l}</li>`).join('');
    return `<ul class="work-bullet-list">${items}</ul>`;
  }

  const paragraphs = trimmed.split(/\n\n+/);
  if (paragraphs.length > 1) {
    const items = paragraphs.map(p => `<li>${p.trim().replace(/\n/g, ' ')}</li>`).join('');
    return `<ul class="work-bullet-list">${items}</ul>`;
  }

  if (trimmed.length > 200) {
    const sentences = trimmed
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
    if (sentences.length > 1) {
      const items = sentences.map(s => `<li>${s}</li>`).join('');
      return `<ul class="work-bullet-list">${items}</ul>`;
    }
  }

  return `<ul class="work-bullet-list"><li>${trimmed}</li></ul>`;
}

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

export function coverPage(
  vm: PdfViewModel
): string {
  const { company, invoice, workOrders, billingSheets, totals } = vm;

  const woCount = workOrders.length;
  const bsCount = billingSheets.length;
  const woLaborSubtotal = workOrders.reduce((s, wo) => s + wo.laborSubtotal, 0);
  const woPartsSubtotal = workOrders.reduce((s, wo) => s + wo.partsSubtotal, 0);
  const woGroupTotal = workOrders.reduce((s, wo) => s + wo.rowTotal, 0);
  const bsLaborSubtotal = billingSheets.reduce((s, bs) => s + bs.laborSubtotal, 0);
  const bsPartsSubtotal = billingSheets.reduce((s, bs) => s + bs.partsSubtotal, 0);
  const bsGroupTotal = billingSheets.reduce((s, bs) => s + bs.rowTotal, 0);

  const logoHtml = company.logoDataUri
    ? `<img src="${company.logoDataUri}" class="cover-logo" alt="${company.name}">`
    : `<div class="cover-company-name-fallback">${company.name}</div>`;

  const woRowHtml = woCount > 0 ? `
    <tr>
      <td class="cover-breakdown-type cover-breakdown-type-wo">Work Orders</td>
      <td class="cover-breakdown-count">${woCount}</td>
      <td class="cover-breakdown-amount">${formatCurrency(woLaborSubtotal)}</td>
      <td class="cover-breakdown-amount">${formatCurrency(woPartsSubtotal)}</td>
      <td class="cover-breakdown-total">${formatCurrency(woGroupTotal)}</td>
    </tr>` : '';

  const bsRowHtml = bsCount > 0 ? `
    <tr>
      <td class="cover-breakdown-type cover-breakdown-type-bs">Billing Sheets</td>
      <td class="cover-breakdown-count">${bsCount}</td>
      <td class="cover-breakdown-amount">${formatCurrency(bsLaborSubtotal)}</td>
      <td class="cover-breakdown-amount">${formatCurrency(bsPartsSubtotal)}</td>
      <td class="cover-breakdown-total">${formatCurrency(bsGroupTotal)}</td>
    </tr>` : '';

  return `
  <div class="cover-page">
    <div class="cover-header">
      <div class="cover-company-block">
        ${logoHtml}
        <div class="cover-company-details">
          <div class="cover-company-name">${company.name}</div>
          ${company.address ? `<div class="cover-company-line">${company.address}</div>` : ''}
          ${company.phone ? `<div class="cover-company-line">${company.phone}</div>` : ''}
          ${company.email ? `<div class="cover-company-line">${company.email}</div>` : ''}
        </div>
      </div>
      <div class="cover-invoice-meta">
        <div class="cover-invoice-label">INVOICE</div>
        <div class="cover-invoice-number">#${invoice.invoiceNumber}</div>
        <div class="cover-meta-item"><span class="cover-meta-label">Billing Period</span><span class="cover-meta-value">${formatDate(invoice.periodStart)} – ${formatDate(invoice.periodEnd)}</span></div>
        <div class="cover-meta-item"><span class="cover-meta-label">Generated</span><span class="cover-meta-value">${formatDate(invoice.generatedAt)}</span></div>
      </div>
    </div>

    <div class="cover-bill-to">
      <div class="cover-bill-to-label">BILL TO</div>
      <div class="cover-bill-to-name">${invoice.customerName}</div>
      ${invoice.customerEmail ? `<div class="cover-bill-to-detail">${invoice.customerEmail}</div>` : ''}
      ${invoice.customerPhone ? `<div class="cover-bill-to-detail">${invoice.customerPhone}</div>` : ''}
    </div>

    <div class="cover-total-block">
      <div class="cover-total-label">TOTAL INVOICE AMOUNT</div>
      <div class="cover-total-amount">${formatCurrency(totals.grandTotal)}</div>
      <div class="cover-total-period">For period ${formatDate(invoice.periodStart)} – ${formatDate(invoice.periodEnd)}</div>
    </div>

    <div class="cover-breakdown">
      <div class="cover-breakdown-heading">Billing Summary</div>
      <table class="cover-breakdown-table">
        <thead>
          <tr>
            <th class="cover-breakdown-type">Category</th>
            <th class="cover-breakdown-count">Count</th>
            <th class="cover-breakdown-amount">Labor</th>
            <th class="cover-breakdown-amount">Parts</th>
            <th class="cover-breakdown-total">Total</th>
          </tr>
        </thead>
        <tbody>
          ${woRowHtml}
          ${bsRowHtml}
        </tbody>
        <tfoot>
          <tr class="cover-breakdown-grand">
            <td colspan="2" class="cover-breakdown-grand-label">Grand Total</td>
            <td class="cover-breakdown-amount">${formatCurrency(totals.laborSubtotal)}</td>
            <td class="cover-breakdown-amount">${formatCurrency(totals.partsSubtotal)}</td>
            <td class="cover-breakdown-total">${formatCurrency(totals.grandTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>`;
}

export function ticketPageWO(wo: PdfWorkOrderRow, invoiceNumber: string, photoDataUris: string[]): string {
  const workText = wo.aiDetailedDescription || wo.workSummary || wo.workDescription;
  const workBullets = workText
    ? `<div class="ticket-section">
         <div class="ticket-section-label">WORK PERFORMED</div>
         <div class="ticket-work-list">${formatWorkSummaryAsBullets(workText)}</div>
       </div>`
    : '';

  const locationLine = [wo.projectAddress, wo.locationNotes].filter(Boolean).join(' — ');

  const markupRow = wo.markupAmount > 0
    ? `<div class="ticket-fin-row">
         <span class="ticket-fin-label">Markup</span>
         <span class="ticket-fin-value">${formatCurrency(wo.markupAmount)}</span>
       </div>`
    : '';

  const taxRow = wo.taxAmount > 0
    ? `<div class="ticket-fin-row">
         <span class="ticket-fin-label">Tax</span>
         <span class="ticket-fin-value">${formatCurrency(wo.taxAmount)}</span>
       </div>`
    : '';

  const approvalHtml = (wo.approvedBy || wo.approvedAt)
    ? `<div class="ticket-approval">
         <span class="ticket-approval-icon">&#10003;</span>
         <div class="ticket-approval-details">
           ${wo.approvedBy ? `<span class="ticket-approval-by">Approved By: <strong>${wo.approvedBy}</strong></span>` : ''}
           ${wo.approvedAt ? `<span class="ticket-approval-at">Approved At: ${formatDate(wo.approvedAt)}</span>` : ''}
         </div>
       </div>`
    : '';

  return `
  <div class="ticket-page">
    <div class="ticket-header ticket-header-wo">
      <div class="ticket-header-left">
        <div class="ticket-type-badge ticket-type-wo">Work Order</div>
        <div class="ticket-number">WO #${wo.workOrderNumber}</div>
        <div class="ticket-subtitle">${wo.projectName}</div>
        ${locationLine ? `<div class="ticket-location">&#128205; ${locationLine}</div>` : ''}
      </div>
      <div class="ticket-header-right">
        <div class="ticket-meta-item"><span class="ticket-meta-label">Invoice #</span><span class="ticket-meta-value">${invoiceNumber}</span></div>
        <div class="ticket-meta-item"><span class="ticket-meta-label">Date</span><span class="ticket-meta-value">${wo.completedAt ? formatDate(wo.completedAt) : 'N/A'}</span></div>
        <div class="ticket-meta-item"><span class="ticket-meta-label">Technician</span><span class="ticket-meta-value">${wo.technicianName}</span></div>
        <div class="ticket-meta-item"><span class="ticket-meta-label">Hours</span><span class="ticket-meta-value">${wo.totalHours} hrs</span></div>
        ${approvalHtml}
      </div>
    </div>

    ${workBullets}

    <div class="ticket-section ticket-financial">
      <div class="ticket-section-label">FINANCIAL BREAKDOWN</div>
      <div class="ticket-fin-rows">
        <div class="ticket-fin-row">
          <span class="ticket-fin-label">Labor (${wo.totalHours} hrs × ${formatCurrency(wo.laborRate)}/hr)</span>
          <span class="ticket-fin-value">${formatCurrency(wo.laborSubtotal)}</span>
        </div>
        <div class="ticket-fin-row">
          <span class="ticket-fin-label">Parts Subtotal</span>
          <span class="ticket-fin-value">${formatCurrency(wo.partsSubtotal)}</span>
        </div>
        ${markupRow}
        ${taxRow}
        <div class="ticket-fin-row ticket-fin-total">
          <span class="ticket-fin-label">TOTAL</span>
          <span class="ticket-fin-value">${formatCurrency(wo.rowTotal)}</span>
        </div>
      </div>
    </div>

    ${partsTableFromWO(wo.items)}

    ${photoGridSection(photoDataUris)}
  </div>`;
}

export function ticketPageBS(bs: PdfBillingSheetRow, invoiceNumber: string, photoDataUris: string[]): string {
  const workText = bs.aiDetailedDescription || bs.notes || bs.workDescription;
  const workBullets = workText
    ? `<div class="ticket-section">
         <div class="ticket-section-label">WORK PERFORMED</div>
         <div class="ticket-work-list">${formatWorkSummaryAsBullets(workText)}</div>
       </div>`
    : '';

  const markupRow = bs.markupAmount > 0
    ? `<div class="ticket-fin-row">
         <span class="ticket-fin-label">Markup</span>
         <span class="ticket-fin-value">${formatCurrency(bs.markupAmount)}</span>
       </div>`
    : '';

  const taxRow = bs.taxAmount > 0
    ? `<div class="ticket-fin-row">
         <span class="ticket-fin-label">Tax</span>
         <span class="ticket-fin-value">${formatCurrency(bs.taxAmount)}</span>
       </div>`
    : '';

  const approvalHtml = (bs.approvedBy || bs.approvedAt)
    ? `<div class="ticket-approval">
         <span class="ticket-approval-icon">&#10003;</span>
         <div class="ticket-approval-details">
           ${bs.approvedBy ? `<span class="ticket-approval-by">Approved By: <strong>${bs.approvedBy}</strong></span>` : ''}
           ${bs.approvedAt ? `<span class="ticket-approval-at">Approved At: ${formatDate(bs.approvedAt)}</span>` : ''}
         </div>
       </div>`
    : '';

  return `
  <div class="ticket-page">
    <div class="ticket-header ticket-header-bs">
      <div class="ticket-header-left">
        <div class="ticket-type-badge ticket-type-bs">Billing Sheet</div>
        <div class="ticket-number">BS #${bs.billingNumber}</div>
        <div class="ticket-subtitle">${bs.workDescription}</div>
        ${bs.propertyAddress ? `<div class="ticket-location">&#128205; ${bs.propertyAddress}</div>` : ''}
      </div>
      <div class="ticket-header-right">
        <div class="ticket-meta-item"><span class="ticket-meta-label">Invoice #</span><span class="ticket-meta-value">${invoiceNumber}</span></div>
        <div class="ticket-meta-item"><span class="ticket-meta-label">Date</span><span class="ticket-meta-value">${formatDate(bs.workDate)}</span></div>
        <div class="ticket-meta-item"><span class="ticket-meta-label">Technician</span><span class="ticket-meta-value">${bs.technicianName}</span></div>
        <div class="ticket-meta-item"><span class="ticket-meta-label">Hours</span><span class="ticket-meta-value">${bs.totalHours} hrs</span></div>
        ${approvalHtml}
      </div>
    </div>

    ${workBullets}

    <div class="ticket-section ticket-financial">
      <div class="ticket-section-label">FINANCIAL BREAKDOWN</div>
      <div class="ticket-fin-rows">
        <div class="ticket-fin-row">
          <span class="ticket-fin-label">Labor (${bs.totalHours} hrs × ${formatCurrency(bs.laborRate)}/hr)</span>
          <span class="ticket-fin-value">${formatCurrency(bs.laborSubtotal)}</span>
        </div>
        <div class="ticket-fin-row">
          <span class="ticket-fin-label">Parts Subtotal</span>
          <span class="ticket-fin-value">${formatCurrency(bs.partsSubtotal)}</span>
        </div>
        ${markupRow}
        ${taxRow}
        <div class="ticket-fin-row ticket-fin-total">
          <span class="ticket-fin-label">TOTAL</span>
          <span class="ticket-fin-value">${formatCurrency(bs.rowTotal)}</span>
        </div>
      </div>
    </div>

    ${partsTableFromBS(bs.items)}

    ${photoGridSection(photoDataUris)}
  </div>`;
}

export function partsTableFromWO(items: PdfWorkOrderRow['items']): string {
  if (!items || items.length === 0) {
    return `<div class="ticket-section"><p class="no-items-msg">No parts recorded for this work order.</p></div>`;
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
  <div class="ticket-section ticket-parts-section">
    <div class="ticket-section-label">PARTS &amp; LABOR DETAILS</div>
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
    return `<div class="ticket-section"><p class="no-items-msg">No parts recorded for this billing sheet.</p></div>`;
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
  <div class="ticket-section ticket-parts-section">
    <div class="ticket-section-label">PARTS &amp; LABOR DETAILS</div>
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

export function photoGridSection(dataUris: string[]): string {
  const validUris = dataUris.filter(uri => uri !== FAILED_PHOTO_SENTINEL);

  if (!dataUris || dataUris.length === 0 || validUris.length === 0) {
    return `
    <div class="ticket-section ticket-photos-section">
      <div class="ticket-section-label">WORK PHOTOS</div>
      <div class="photo-no-photos">No photos captured for this service</div>
    </div>`;
  }

  const COLS = 3;
  const cells = validUris.map(uri =>
    `<div class="photo-cell"><img src="${uri}" alt="Work photo" class="photo-img"></div>`
  );

  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += COLS) {
    const slice = cells.slice(i, i + COLS);
    while (slice.length < COLS) slice.push(`<div class="photo-cell photo-empty"></div>`);
    rows.push(`<div class="photo-row">${slice.join('')}</div>`);
  }

  return `
  <div class="ticket-section ticket-photos-section">
    <div class="ticket-section-label">WORK PHOTOS</div>
    <div class="photo-grid">${rows.join('')}</div>
  </div>`;
}

export function reconciliationPage(vm: PdfViewModel): string {
  const { workOrders, billingSheets, totals, validationWarning } = vm;

  const woGroupTotal = workOrders.reduce((s, wo) => s + wo.rowTotal, 0);
  const bsGroupTotal = billingSheets.reduce((s, bs) => s + bs.rowTotal, 0);

  const woSectionHeader = workOrders.length > 0 ? `
    <tr class="recon-group-header recon-group-wo">
      <td colspan="3">Work Orders</td>
    </tr>` : '';

  const woRows = workOrders.map(wo => `
    <tr>
      <td class="recon-ref recon-ref-wo">${wo.workOrderNumber}</td>
      <td class="recon-type recon-type-wo">Work Order</td>
      <td class="recon-total">${formatCurrency(wo.rowTotal)}</td>
    </tr>`).join('');

  const woSubtotal = workOrders.length > 0 ? `
    <tr class="recon-subtotal">
      <td colspan="2" class="recon-subtotal-label">Work Orders Subtotal</td>
      <td class="recon-total">${formatCurrency(woGroupTotal)}</td>
    </tr>` : '';

  const bsSectionHeader = billingSheets.length > 0 ? `
    <tr class="recon-group-header recon-group-bs">
      <td colspan="3">Billing Sheets</td>
    </tr>` : '';

  const bsRows = billingSheets.map(bs => `
    <tr>
      <td class="recon-ref recon-ref-bs">${bs.billingNumber}</td>
      <td class="recon-type recon-type-bs">Billing Sheet</td>
      <td class="recon-total">${formatCurrency(bs.rowTotal)}</td>
    </tr>`).join('');

  const bsSubtotal = billingSheets.length > 0 ? `
    <tr class="recon-subtotal">
      <td colspan="2" class="recon-subtotal-label">Billing Sheets Subtotal</td>
      <td class="recon-total">${formatCurrency(bsGroupTotal)}</td>
    </tr>` : '';

  const warningRow = validationWarning ? `
    <tr class="recon-warning">
      <td colspan="3">
        <span class="recon-warning-icon">&#9888;</span>
        ${validationWarning}
      </td>
    </tr>` : '';

  return `
  <div class="recon-page">
    <div class="recon-title">Invoice Reconciliation Summary</div>
    <div class="recon-subtitle">Invoice #${vm.invoice.invoiceNumber} &nbsp;·&nbsp; ${formatDate(vm.invoice.periodStart)} – ${formatDate(vm.invoice.periodEnd)}</div>

    <table class="recon-table">
      <thead>
        <tr>
          <th class="recon-ref">Reference #</th>
          <th class="recon-type">Type</th>
          <th class="recon-total">Total</th>
        </tr>
      </thead>
      <tbody>
        ${woSectionHeader}
        ${woRows}
        ${woSubtotal}
        ${bsSectionHeader}
        ${bsRows}
        ${bsSubtotal}
        ${warningRow}
        <tr class="recon-grand-total">
          <td colspan="2" class="recon-grand-label">GRAND TOTAL</td>
          <td class="recon-total recon-grand-amount">${formatCurrency(totals.grandTotal)}</td>
        </tr>
      </tbody>
    </table>

    <div class="recon-totals-box">
      <div class="recon-totals-row">
        <span>Total Labor</span>
        <span>${formatCurrency(totals.laborSubtotal)}</span>
      </div>
      <div class="recon-totals-row">
        <span>Total Parts</span>
        <span>${formatCurrency(totals.partsSubtotal)}</span>
      </div>
      <div class="recon-totals-row recon-totals-grand">
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
    line-height: 1.5;
    background: white;
    font-size: 13px;
  }

  .container {
    max-width: 100%;
    padding: 0 20px 80px 20px;
  }

  /* ═══════════════════════════════════
     COVER PAGE
  ═══════════════════════════════════ */
  .cover-page {
    min-height: 95vh;
    display: flex;
    flex-direction: column;
    gap: 28px;
    padding: 32px 0 40px;
    page-break-after: always;
    break-after: page;
    page-break-inside: avoid;
    break-inside: avoid;
  }

  .cover-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 3px solid #3B82F6;
    padding-bottom: 24px;
  }

  .cover-company-block {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .cover-logo {
    max-width: 200px;
    max-height: 70px;
    width: auto;
    height: auto;
    object-fit: contain;
    display: block;
  }

  .cover-company-name-fallback {
    font-size: 24px;
    font-weight: 800;
    color: #3B82F6;
  }

  .cover-company-name {
    font-size: 18px;
    font-weight: 700;
    color: #1f2937;
  }

  .cover-company-details {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 4px;
  }

  .cover-company-line {
    font-size: 12px;
    color: #6b7280;
  }

  .cover-invoice-meta {
    text-align: right;
  }

  .cover-invoice-label {
    font-size: 11px;
    font-weight: 700;
    color: #9ca3af;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    margin-bottom: 4px;
  }

  .cover-invoice-number {
    font-size: 30px;
    font-weight: 800;
    color: #1f2937;
    margin-bottom: 12px;
  }

  .cover-meta-item {
    display: flex;
    justify-content: flex-end;
    align-items: baseline;
    gap: 8px;
    font-size: 12px;
    margin-bottom: 4px;
  }

  .cover-meta-label {
    color: #9ca3af;
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
  }

  .cover-meta-value {
    color: #1f2937;
    font-weight: 500;
  }

  .cover-bill-to {
    background: #f9fafb;
    border-radius: 8px;
    padding: 18px 22px;
    border-left: 4px solid #3B82F6;
  }

  .cover-bill-to-label {
    font-size: 10px;
    font-weight: 700;
    color: #9ca3af;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 6px;
  }

  .cover-bill-to-name {
    font-size: 20px;
    font-weight: 700;
    color: #1f2937;
    margin-bottom: 4px;
  }

  .cover-bill-to-detail {
    font-size: 13px;
    color: #4b5563;
  }

  .cover-total-block {
    background: linear-gradient(135deg, #1e40af 0%, #3B82F6 100%);
    border-radius: 12px;
    padding: 32px 36px;
    text-align: center;
    color: white;
  }

  .cover-total-label {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 2px;
    opacity: 0.85;
    margin-bottom: 10px;
  }

  .cover-total-amount {
    font-size: 52px;
    font-weight: 900;
    letter-spacing: -1px;
    line-height: 1;
    margin-bottom: 10px;
  }

  .cover-total-period {
    font-size: 13px;
    opacity: 0.75;
  }

  .cover-breakdown {
    border: 1.5px solid #e5e7eb;
    border-radius: 8px;
    overflow: hidden;
  }

  .cover-breakdown-heading {
    font-size: 13px;
    font-weight: 700;
    color: #374151;
    padding: 12px 18px;
    background: #f3f4f6;
    border-bottom: 1px solid #e5e7eb;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .cover-breakdown-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  .cover-breakdown-table thead tr {
    background: #1f2937;
    color: white;
  }

  .cover-breakdown-table th {
    padding: 10px 16px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    text-align: left;
  }

  .cover-breakdown-table th.cover-breakdown-count,
  .cover-breakdown-table th.cover-breakdown-amount,
  .cover-breakdown-table th.cover-breakdown-total {
    text-align: right;
  }

  .cover-breakdown-table tbody tr {
    border-bottom: 1px solid #e5e7eb;
  }

  .cover-breakdown-table td {
    padding: 12px 16px;
    color: #1f2937;
  }

  .cover-breakdown-type {
    font-weight: 600;
  }

  .cover-breakdown-type-wo { color: #1d4ed8; }
  .cover-breakdown-type-bs { color: #047857; }

  .cover-breakdown-count,
  .cover-breakdown-amount,
  .cover-breakdown-total {
    text-align: right;
    font-weight: 500;
  }

  .cover-breakdown-total {
    font-weight: 700;
  }

  .cover-breakdown-grand td {
    background: #1e3a8a;
    color: white;
    font-weight: 700;
    font-size: 14px;
    padding: 14px 16px;
    border-top: 2px solid #3B82F6;
    text-align: right;
  }

  .cover-breakdown-grand-label {
    text-align: left !important;
    font-size: 13px;
    letter-spacing: 0.5px;
  }

  .cover-breakdown-table tfoot td.cover-breakdown-type,
  .cover-breakdown-table tfoot td.cover-breakdown-count {
    text-align: left;
  }

  /* ═══════════════════════════════════
     TICKET PAGES
  ═══════════════════════════════════ */
  .ticket-page {
    page-break-before: always;
    break-before: page;
    padding: 28px 0 32px;
  }

  .ticket-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 20px 22px;
    border-radius: 8px 8px 0 0;
    border-bottom: 1px solid rgba(0,0,0,0.1);
    page-break-inside: avoid;
    break-inside: avoid;
    break-after: avoid;
    page-break-after: avoid;
  }

  .ticket-header-wo {
    background: linear-gradient(135deg, #1d4ed8 0%, #3B82F6 100%);
    color: white;
  }

  .ticket-header-bs {
    background: linear-gradient(135deg, #065f46 0%, #059669 100%);
    color: white;
  }

  .ticket-header-left {
    flex: 1;
  }

  .ticket-header-right {
    min-width: 200px;
    text-align: right;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }

  .ticket-type-badge {
    display: inline-block;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    opacity: 0.85;
    margin-bottom: 4px;
  }

  .ticket-number {
    font-size: 26px;
    font-weight: 800;
    line-height: 1;
    margin-bottom: 4px;
  }

  .ticket-subtitle {
    font-size: 14px;
    opacity: 0.9;
    margin-bottom: 4px;
    font-weight: 500;
  }

  .ticket-location {
    font-size: 12px;
    opacity: 0.8;
    margin-top: 4px;
  }

  .ticket-meta-item {
    font-size: 12px;
    display: flex;
    gap: 6px;
    align-items: center;
    justify-content: flex-end;
  }

  .ticket-meta-label {
    opacity: 0.75;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  .ticket-meta-value {
    font-weight: 600;
  }

  .ticket-approval {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    background: rgba(255,255,255,0.15);
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 11px;
  }

  .ticket-approval-icon {
    font-size: 14px;
    font-weight: 700;
  }

  .ticket-approval-details {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .ticket-approval-by,
  .ticket-approval-at {
    display: block;
    font-size: 11px;
  }

  /* ── Ticket Sections ── */
  .ticket-section {
    border: 1px solid #e5e7eb;
    border-top: none;
    padding: 16px 20px;
  }

  .ticket-section:first-of-type {
    border-top: 1px solid #e5e7eb;
  }

  .ticket-section-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #9ca3af;
    margin-bottom: 10px;
  }

  /* Work bullet list */
  .ticket-work-list {
    font-size: 13px;
    color: #1f2937;
  }

  .work-bullet-list {
    margin: 0;
    padding-left: 20px;
    list-style-type: disc;
  }

  .work-bullet-list li {
    margin-bottom: 5px;
    line-height: 1.6;
    color: #1f2937;
  }

  /* Financial breakdown */
  .ticket-financial {
    page-break-inside: avoid;
    break-inside: avoid;
  }

  .ticket-fin-rows {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .ticket-fin-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid #f3f4f6;
    font-size: 13px;
    color: #4b5563;
  }

  .ticket-fin-row:last-child {
    border-bottom: none;
  }

  .ticket-fin-label {
    font-weight: 500;
  }

  .ticket-fin-value {
    font-weight: 600;
    min-width: 100px;
    text-align: right;
  }

  .ticket-fin-total {
    margin-top: 8px;
    padding-top: 12px;
    border-top: 2px solid #3B82F6 !important;
    font-size: 16px;
    font-weight: 800;
    color: #1f2937;
  }

  .ticket-fin-total .ticket-fin-value {
    color: #1d4ed8;
    font-size: 18px;
  }

  /* Parts table */
  .ticket-parts-section {
    page-break-inside: avoid;
    break-inside: avoid;
  }

  .items-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .items-table thead { background: #1f2937; color: white; }
  .items-table th { padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; }
  .items-table th.text-right { text-align: right; }
  .items-table tbody tr { border-bottom: 1px solid #e5e7eb; }
  .items-table tbody tr:nth-child(even) { background: #f9fafb; }
  .items-table td { padding: 10px 12px; color: #1f2937; }
  .items-table td.text-right { text-align: right; }
  .item-note { color: #6b7280; font-size: 11px; }
  .no-items-msg { color: #9ca3af; font-size: 12px; font-style: italic; }

  /* Photos */
  .ticket-photos-section {
    page-break-inside: avoid;
    break-inside: avoid;
  }

  .photo-no-photos {
    background: #f9fafb;
    border: 2px dashed #d1d5db;
    border-radius: 8px;
    padding: 28px;
    text-align: center;
    color: #9ca3af;
    font-size: 13px;
    font-style: italic;
  }

  .photo-grid { display: flex; flex-direction: column; gap: 6px; }
  .photo-row { display: flex; gap: 6px; }
  .photo-cell { flex: 1; }
  .photo-img { width: 100%; height: 160px; object-fit: cover; border-radius: 5px; border: 1px solid #e5e7eb; display: block; }
  .photo-empty { height: 160px; }

  /* ═══════════════════════════════════
     RECONCILIATION PAGE
  ═══════════════════════════════════ */
  .recon-page {
    page-break-before: always;
    break-before: page;
    padding: 32px 0 40px;
  }

  .recon-title {
    font-size: 24px;
    font-weight: 800;
    color: #1f2937;
    margin-bottom: 4px;
  }

  .recon-subtitle {
    font-size: 13px;
    color: #6b7280;
    margin-bottom: 28px;
  }

  .recon-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    margin-bottom: 24px;
  }

  .recon-table thead tr {
    background: #1f2937;
    color: white;
  }

  .recon-table th {
    padding: 10px 14px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    text-align: left;
  }

  .recon-table th.recon-total {
    text-align: right;
  }

  .recon-table tbody tr {
    border-bottom: 1px solid #e5e7eb;
  }

  .recon-table td {
    padding: 10px 14px;
    color: #1f2937;
  }

  .recon-ref { font-weight: 600; }
  .recon-ref-wo { color: #1d4ed8; }
  .recon-ref-bs { color: #047857; }

  .recon-type { font-weight: 500; font-size: 12px; }
  .recon-type-wo { color: #1d4ed8; }
  .recon-type-bs { color: #047857; }

  .recon-total {
    text-align: right;
    font-weight: 600;
  }

  .recon-group-header td {
    font-weight: 700;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 8px 14px;
  }

  .recon-group-wo td {
    background: #dbeafe;
    color: #1e40af;
    border-top: 1px solid #93c5fd;
  }

  .recon-group-bs td {
    background: #d1fae5;
    color: #065f46;
    border-top: 1px solid #6ee7b7;
  }

  .recon-subtotal td {
    background: #f3f4f6;
    font-weight: 700;
    font-size: 12px;
    padding: 9px 14px;
    border-top: 1px solid #d1d5db;
    border-bottom: 2px solid #d1d5db;
    color: #374151;
  }

  .recon-subtotal-label {
    font-style: italic;
  }

  .recon-warning td {
    background: #fef3c7;
    color: #92400e;
    font-size: 12px;
    font-weight: 600;
    padding: 10px 14px;
    border-top: 2px solid #fbbf24;
    border-bottom: 2px solid #fbbf24;
  }

  .recon-warning-icon {
    margin-right: 6px;
    font-size: 14px;
  }

  .recon-grand-total td {
    background: #1e3a8a;
    color: white;
    font-weight: 800;
    font-size: 15px;
    padding: 14px 14px;
    border-top: 3px solid #3B82F6;
  }

  .recon-grand-label {
    letter-spacing: 0.5px;
  }

  .recon-grand-amount {
    text-align: right;
    font-size: 18px;
  }

  .recon-totals-box {
    border: 2px solid #3B82F6;
    border-radius: 8px;
    padding: 18px 22px;
    background: #f0f7ff;
    max-width: 360px;
    margin-left: auto;
  }

  .recon-totals-row {
    display: flex;
    justify-content: space-between;
    padding: 7px 0;
    font-size: 14px;
    color: #4b5563;
    border-bottom: 1px solid #dbeafe;
  }

  .recon-totals-row:last-child {
    border-bottom: none;
  }

  .recon-totals-grand {
    border-top: 2px solid #3B82F6 !important;
    margin-top: 8px;
    padding-top: 12px;
    font-size: 18px;
    font-weight: 800;
    color: #1f2937;
  }

  .recon-totals-grand span:last-child {
    color: #1d4ed8;
  }

  /* ═══════════════════════════════════
     PAGE NUMBERING & FOOTER
  ═══════════════════════════════════ */
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

  @page { margin: 0.5in 0.5in 0.75in 0.5in; }
  .pdf-page-num::before { content: counter(page); }

  .text-right { text-align: right; }
  `;
}
