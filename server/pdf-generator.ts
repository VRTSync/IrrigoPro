import puppeteer from 'puppeteer';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import type { PdfViewModel } from './pdf-view-model';

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

const PHOTO_LOAD_TIMEOUT_MS = 8000;
const FAILED_PHOTO_SENTINEL = '__PHOTO_UNAVAILABLE__';

async function fetchPhotoAsDataUri(photoUrl: string, port: number): Promise<string> {
  try {
    const absoluteUrl = photoUrl.startsWith('/')
      ? `http://localhost:${port}${photoUrl}`
      : photoUrl;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PHOTO_LOAD_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(absoluteUrl, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) return FAILED_PHOTO_SENTINEL;
    const contentType = response.headers.get('content-type') || '';
    const mimeType = contentType.split(';')[0].trim().toLowerCase();
    if (!mimeType.startsWith('image/')) return FAILED_PHOTO_SENTINEL;
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  } catch {
    return FAILED_PHOTO_SENTINEL;
  }
}

async function preloadPhotos(urls: string[], port: number): Promise<string[]> {
  return Promise.all(urls.map(url => fetchPhotoAsDataUri(url, port)));
}

function renderPhotoCell(dataUri: string): string {
  if (dataUri === FAILED_PHOTO_SENTINEL) {
    return `<div style="width:180px;height:140px;background:#f3f4f6;border:2px dashed #d1d5db;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;color:#9ca3af;text-align:center;">Image unavailable</div>`;
  }
  return `<img src="${dataUri}" alt="Work photo" style="width:180px;height:140px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;display:block;">`;
}

function renderPhotoGrid(dataUris: string[]): string {
  if (dataUris.length === 0) return '';
  const COLS = 3;
  const rows: string[][] = [];
  for (let i = 0; i < dataUris.length; i += COLS) {
    rows.push(dataUris.slice(i, i + COLS));
  }
  const tableRows = rows.map(row => {
    const tds = row.map(uri => `<td style="padding:4px;vertical-align:top;">${renderPhotoCell(uri)}</td>`).join('');
    const emptyCols = COLS - row.length;
    const emptyTds = emptyCols > 0
      ? Array(emptyCols).fill(`<td style="padding:4px;width:188px;"></td>`).join('')
      : '';
    return `<tr>${tds}${emptyTds}</tr>`;
  }).join('');
  return `
    <div style="margin-bottom:20px;">
      <div style="font-weight:600;color:#1f2937;margin-bottom:10px;font-size:14px;">Work Photos</div>
      <table style="border-collapse:separate;border-spacing:0;">
        ${tableRows}
      </table>
    </div>
  `;
}
// Get system chromium path for Replit
function getChromiumPath(): string {
  try {
    const chromiumPath = execSync('which chromium').toString().trim();
    return chromiumPath;
  } catch (error) {
    // Fallback to default behavior if chromium not found
    console.warn('System chromium not found, using bundled Chrome');
    return '';
  }
}

export class PDFGenerator {
  static async generateInvoicePDF(invoiceHtmlPath: string): Promise<Buffer> {
    const chromiumPath = getChromiumPath();
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: chromiumPath || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
      const page = await browser.newPage();
      
      // Read the HTML content
      const htmlContent = readFileSync(invoiceHtmlPath, 'utf-8');
      
      // Set the HTML content
      await page.setContent(htmlContent, { 
        waitUntil: 'networkidle0' 
      });
      
      // Generate PDF with professional settings
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '0.5in',
          right: '0.5in',
          bottom: '0.5in',
          left: '0.5in'
        }
      });
      
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }
  
  static async generateInvoicePDFFromUrl(url: string): Promise<Buffer> {
    const chromiumPath = getChromiumPath();
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: chromiumPath || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle0' });
      
      // Generate PDF with professional settings
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '0.5in',
          right: '0.5in',
          bottom: '0.5in',
          left: '0.5in'
        }
      });
      
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  static async generateInvoiceDetailPDF(viewModel: PdfViewModel): Promise<Buffer> {
    const port = parseInt(process.env.PORT || '5000', 10);

    // Pre-load all photos as base64 data URIs before generating HTML
    const woPhotoMaps: string[][] = await Promise.all(
      viewModel.workOrders.map(wo =>
        wo.photos.length > 0 ? preloadPhotos(wo.photos, port) : Promise.resolve([])
      )
    );
    const bsPhotoMaps: string[][] = await Promise.all(
      viewModel.billingSheets.map(bs =>
        bs.photos.length > 0 ? preloadPhotos(bs.photos, port) : Promise.resolve([])
      )
    );

    const chromiumPath = getChromiumPath();
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: chromiumPath || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
      const page = await browser.newPage();
      
      // Generate HTML content from the pre-computed view model with pre-loaded photo data URIs
      const htmlContent = this.generateInvoiceDetailHTML(viewModel, woPhotoMaps, bsPhotoMaps);
      
      // Set the HTML content — no external fetches needed since images are embedded
      await page.setContent(htmlContent, { 
        waitUntil: 'domcontentloaded' 
      });
      
      // Generate PDF with professional settings
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '0.5in',
          right: '0.5in',
          bottom: '0.5in',
          left: '0.5in'
        }
      });
      
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  private static generateInvoiceDetailHTML(vm: PdfViewModel, woPhotoMaps: string[][] = [], bsPhotoMaps: string[][] = []): string {
    const { company, invoice, workOrders, billingSheets, totals, totalJobs } = vm;

    const formatDate = (date: Date) => {
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    };

    const formatCurrency = (amount: number) => {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
    };

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Invoice ${invoice.invoiceNumber} - Detail Report</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            color: #1f2937;
            line-height: 1.6;
            background: white;
          }
          
          .container {
            max-width: 100%;
            margin: 0 auto;
            padding: 20px;
          }
          
          /* Header Section */
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 3px solid #3B82F6;
            padding-bottom: 20px;
            margin-bottom: 30px;
          }
          
          .company-info {
            flex: 1;
            min-height: 70px;
          }
          
          .company-logo {
            max-width: 180px;
            max-height: 60px;
            width: auto;
            height: auto;
            object-fit: contain;
            display: block;
            margin-bottom: 10px;
          }
          
          .company-name {
            font-size: 24px;
            font-weight: bold;
            color: #3B82F6;
            margin-bottom: 5px;
          }
          
          .company-details {
            font-size: 12px;
            color: #6b7280;
            line-height: 1.4;
          }
          
          .invoice-info {
            text-align: right;
          }
          
          .invoice-title {
            font-size: 28px;
            font-weight: bold;
            color: #1f2937;
            margin-bottom: 5px;
          }
          
          .invoice-subtitle {
            font-size: 14px;
            color: #6b7280;
            margin-bottom: 10px;
          }
          
          .invoice-meta {
            font-size: 13px;
            line-height: 1.8;
          }
          
          .invoice-meta strong {
            color: #1f2937;
          }
          
          /* Customer Section */
          .customer-section {
            background: #f9fafb;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 30px;
          }
          
          .customer-title {
            font-size: 14px;
            font-weight: 600;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 10px;
          }
          
          .customer-name {
            font-size: 18px;
            font-weight: bold;
            color: #1f2937;
            margin-bottom: 5px;
          }
          
          .customer-details {
            font-size: 13px;
            color: #4b5563;
          }
          
          /* Summary Section */
          .summary-section {
            background: linear-gradient(135deg, #3B82F6 0%, #2563eb 100%);
            color: white;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 30px;
          }
          
          .summary-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
          }
          
          .summary-item {
            text-align: center;
          }
          
          .summary-label {
            font-size: 12px;
            opacity: 0.9;
            margin-bottom: 5px;
          }
          
          .summary-value {
            font-size: 24px;
            font-weight: bold;
          }
          
          /* Work Order Section */
          .work-order-section {
            margin-bottom: 40px;
            page-break-inside: avoid;
          }
          
          .section-header {
            background: #f3f4f6;
            border-left: 4px solid #3B82F6;
            padding: 15px 20px;
            margin-bottom: 20px;
            border-radius: 4px;
          }
          
          .section-title {
            font-size: 18px;
            font-weight: bold;
            color: #1f2937;
            margin-bottom: 5px;
          }
          
          .section-subtitle {
            font-size: 13px;
            color: #6b7280;
          }
          
          .work-order-details {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 15px;
            margin-bottom: 20px;
            padding: 15px;
            background: #f9fafb;
            border-radius: 6px;
          }
          
          .detail-item {
            font-size: 13px;
          }
          
          .detail-label {
            color: #6b7280;
            font-weight: 600;
            margin-bottom: 3px;
          }
          
          .detail-value {
            color: #1f2937;
          }
          
          /* Table Styles */
          .items-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
            font-size: 13px;
          }
          
          .items-table thead {
            background: #1f2937;
            color: white;
          }
          
          .items-table th {
            padding: 12px;
            text-align: left;
            font-weight: 600;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          
          .items-table th.text-right {
            text-align: right;
          }
          
          .items-table tbody tr {
            border-bottom: 1px solid #e5e7eb;
          }
          
          .items-table tbody tr:hover {
            background: #f9fafb;
          }
          
          .items-table td {
            padding: 12px;
            color: #1f2937;
          }
          
          .items-table td.text-right {
            text-align: right;
          }
          
          .work-order-totals {
            background: #f9fafb;
            border-radius: 6px;
            padding: 15px 20px;
            margin-top: 15px;
          }
          
          .totals-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            font-size: 14px;
          }
          
          .totals-row.subtotal {
            color: #6b7280;
          }
          
          .totals-row.total {
            border-top: 2px solid #3B82F6;
            padding-top: 12px;
            margin-top: 8px;
            font-size: 16px;
            font-weight: bold;
            color: #1f2937;
          }
          
          /* Invoice Grand Total */
          .grand-total-section {
            background: #1f2937;
            color: white;
            border-radius: 8px;
            padding: 25px;
            margin-top: 40px;
            text-align: right;
          }
          
          .grand-total-label {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 10px;
          }
          
          .grand-total-amount {
            font-size: 36px;
            font-weight: bold;
            color: #3B82F6;
          }
          
          /* Page Break Handling */
          .page-break {
            page-break-after: always;
          }
          
          @media print {
            .work-order-section {
              page-break-inside: avoid;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <!-- Header -->
          <div class="header">
            <div class="company-info">
              ${company.logoDataUri ? `<img src="${company.logoDataUri}" class="company-logo" alt="${company.name}">` : ''}
              <div class="company-name">${company.name}</div>
              <div class="company-details">
                ${company.address ? `${company.address}<br>` : ''}
                ${company.phone ? `Phone: ${company.phone}<br>` : ''}
                ${company.email ? `Email: ${company.email}` : ''}
              </div>
            </div>
            <div class="invoice-info">
              <div class="invoice-title">INVOICE DETAIL REPORT</div>
              <div class="invoice-subtitle">Comprehensive Work Breakdown</div>
              <div class="invoice-meta">
                <div><strong>Invoice #:</strong> ${invoice.invoiceNumber}</div>
                <div><strong>Period:</strong> ${formatDate(invoice.periodStart)} - ${formatDate(invoice.periodEnd)}</div>
                <div><strong>Generated:</strong> ${formatDate(invoice.generatedAt)}</div>
              </div>
            </div>
          </div>
          
          <!-- Customer Info -->
          <div class="customer-section">
            <div class="customer-title">Bill To</div>
            <div class="customer-name">${invoice.customerName}</div>
            <div class="customer-details">
              ${invoice.customerEmail}<br>
              ${invoice.customerPhone}
            </div>
          </div>
          
          <!-- Summary -->
          <div class="summary-section">
            <div class="summary-grid">
              <div class="summary-item">
                <div class="summary-label">Total Jobs</div>
                <div class="summary-value">${totalJobs}</div>
              </div>
              <div class="summary-item">
                <div class="summary-label">Labor</div>
                <div class="summary-value">${formatCurrency(totals.laborSubtotal)}</div>
              </div>
              <div class="summary-item">
                <div class="summary-label">Parts</div>
                <div class="summary-value">${formatCurrency(totals.partsSubtotal)}</div>
              </div>
            </div>
          </div>
          
          <!-- Work Orders -->
          ${workOrders.map((wo, index) => `
            <div class="work-order-section">
              <div class="section-header">
                <div class="section-title">Work Order #${wo.workOrderNumber}</div>
                <div class="section-subtitle">${wo.projectName}</div>
              </div>
              
              <!-- Location Information -->
              ${wo.projectAddress || wo.locationNotes ? `
                <div class="work-order-details">
                  ${wo.projectAddress ? `
                    <div class="detail-item">
                      <div class="detail-label">Service Location</div>
                      <div class="detail-value">${wo.projectAddress}</div>
                    </div>
                  ` : ''}
                  ${wo.locationNotes ? `
                    <div class="detail-item">
                      <div class="detail-label">Location Notes</div>
                      <div class="detail-value">${wo.locationNotes}</div>
                    </div>
                  ` : ''}
                </div>
              ` : ''}
              
              <!-- Work Order Details -->
              <div class="work-order-details">
                <div class="detail-item">
                  <div class="detail-label">Technician</div>
                  <div class="detail-value">${wo.technicianName}</div>
                </div>
                <div class="detail-item">
                  <div class="detail-label">Date Completed</div>
                  <div class="detail-value">${wo.completedAt ? formatDate(wo.completedAt) : 'N/A'}</div>
                </div>
                <div class="detail-item">
                  <div class="detail-label">Total Hours</div>
                  <div class="detail-value">${wo.totalHours} hours</div>
                </div>
                <div class="detail-item">
                  <div class="detail-label">Labor Rate</div>
                  <div class="detail-value">${formatCurrency(wo.laborRate)}/hr</div>
                </div>
              </div>
              
              <!-- Work Description if available -->
              ${(wo.aiDetailedDescription || wo.workSummary || wo.workDescription) ? `
                <div style="background: #f9fafb; padding: 15px; border-radius: 6px; margin-bottom: 20px;">
                  <div style="font-weight: 600; color: #6b7280; margin-bottom: 5px;">Work Description</div>
                  <div style="color: #1f2937; font-size: 13px;">${wo.aiDetailedDescription || wo.workSummary || wo.workDescription}</div>
                </div>
              ` : ''}
              
              <!-- Parts and Labor Breakdown -->
              ${wo.items.length > 0 ? `
                <div style="margin-bottom: 15px;">
                  <div style="font-weight: 600; color: #1f2937; margin-bottom: 10px; font-size: 14px;">Parts & Labor Details</div>
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
                    <tbody>
                      ${wo.items.map(item => `
                        <tr>
                          <td>${item.partName}${item.notes ? `<br><small style="color: #6b7280;">${item.notes}</small>` : ''}</td>
                          <td class="text-right">${item.quantity}</td>
                          <td class="text-right">${formatCurrency(item.unitPrice)}</td>
                          <td class="text-right">${item.laborHours}</td>
                          <td class="text-right">${formatCurrency(item.rowTotal)}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              ` : '<p style="color: #6b7280; padding: 10px;">No line items</p>'}
              
              <!-- Photos if available -->
              ${(woPhotoMaps[index] && woPhotoMaps[index].length > 0) ? renderPhotoGrid(woPhotoMaps[index]) : ''}
              
              <!-- Work Order Totals -->
              <div class="work-order-totals">
                <div class="totals-row subtotal">
                  <span>Parts Subtotal:</span>
                  <span>${formatCurrency(wo.partsSubtotal)}</span>
                </div>
                <div class="totals-row subtotal">
                  <span>Labor Subtotal (${wo.totalHours} hrs × ${formatCurrency(wo.laborRate)}):</span>
                  <span>${formatCurrency(wo.laborSubtotal)}</span>
                </div>
                <div class="totals-row total">
                  <span>Work Order Total:</span>
                  <span>${formatCurrency(wo.rowTotal)}</span>
                </div>
              </div>
            </div>
          `).join('')}
          
          <!-- Billing Sheets -->
          ${billingSheets.map((bs, index) => `
            <div class="work-order-section">
              <div class="section-header">
                <div class="section-title">Billing Sheet #${bs.billingNumber}</div>
                <div class="section-subtitle">${bs.workDescription}</div>
              </div>
              
              <!-- Location Information -->
              ${bs.propertyAddress ? `
                <div class="work-order-details">
                  <div class="detail-item">
                    <div class="detail-label">Service Location</div>
                    <div class="detail-value">${bs.propertyAddress}</div>
                  </div>
                </div>
              ` : ''}
              
              <!-- Billing Sheet Details -->
              <div class="work-order-details">
                <div class="detail-item">
                  <div class="detail-label">Technician</div>
                  <div class="detail-value">${bs.technicianName}</div>
                </div>
                <div class="detail-item">
                  <div class="detail-label">Work Date</div>
                  <div class="detail-value">${formatDate(bs.workDate)}</div>
                </div>
                <div class="detail-item">
                  <div class="detail-label">Total Hours</div>
                  <div class="detail-value">${bs.totalHours} hours</div>
                </div>
                <div class="detail-item">
                  <div class="detail-label">Labor Rate</div>
                  <div class="detail-value">${formatCurrency(bs.laborRate)}/hr</div>
                </div>
              </div>
              
              <!-- Work Description if available -->
              ${(bs.aiDetailedDescription || bs.workDescription) ? `
                <div style="background: #f9fafb; padding: 15px; border-radius: 6px; margin-bottom: 20px;">
                  <div style="font-weight: 600; color: #6b7280; margin-bottom: 5px;">Work Description</div>
                  <div style="color: #1f2937; font-size: 13px;">${bs.aiDetailedDescription || bs.workDescription}</div>
                </div>
              ` : ''}
              
              <!-- Additional Notes if available -->
              ${bs.notes ? `
                <div style="background: #f9fafb; padding: 15px; border-radius: 6px; margin-bottom: 20px;">
                  <div style="font-weight: 600; color: #6b7280; margin-bottom: 5px;">Additional Notes</div>
                  <div style="color: #1f2937; font-size: 13px;">${bs.notes}</div>
                </div>
              ` : ''}
              
              <!-- Parts and Labor Breakdown -->
              ${bs.items.length > 0 ? `
                <div style="margin-bottom: 15px;">
                  <div style="font-weight: 600; color: #1f2937; margin-bottom: 10px; font-size: 14px;">Parts & Labor Details</div>
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
                    <tbody>
                      ${bs.items.map(item => `
                        <tr>
                          <td>${item.partName}${item.partDescription ? `<br><small style="color: #6b7280;">${item.partDescription}</small>` : ''}${item.notes ? `<br><small style="color: #6b7280;">${item.notes}</small>` : ''}</td>
                          <td class="text-right">${item.quantity}</td>
                          <td class="text-right">${formatCurrency(item.unitPrice)}</td>
                          <td class="text-right">${item.laborHours}</td>
                          <td class="text-right">${formatCurrency(item.rowTotal)}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              ` : '<p style="color: #6b7280; padding: 10px;">No line items</p>'}
              
              <!-- Photos if available -->
              ${(bsPhotoMaps[index] && bsPhotoMaps[index].length > 0) ? renderPhotoGrid(bsPhotoMaps[index]) : ''}
              
              <!-- Billing Sheet Totals -->
              <div class="work-order-totals">
                <div class="totals-row subtotal">
                  <span>Parts Subtotal:</span>
                  <span>${formatCurrency(bs.partsSubtotal)}</span>
                </div>
                <div class="totals-row subtotal">
                  <span>Labor Subtotal (${bs.totalHours} hrs × ${formatCurrency(bs.laborRate)}):</span>
                  <span>${formatCurrency(bs.laborSubtotal)}</span>
                </div>
                <div class="totals-row total">
                  <span>Billing Sheet Total:</span>
                  <span>${formatCurrency(bs.rowTotal)}</span>
                </div>
              </div>
            </div>
          `).join('')}
          
          <!-- Summary Breakdown -->
          <div style="margin-top: 40px; padding: 25px; background: #f9fafb; border-radius: 8px; border: 2px solid #e5e7eb;">
            <div style="font-size: 20px; font-weight: bold; color: #1f2937; margin-bottom: 20px; border-bottom: 2px solid #3B82F6; padding-bottom: 10px;">
              Invoice Summary
            </div>
            
            <!-- Work Orders Summary -->
            ${workOrders.length > 0 ? `
              <div style="margin-bottom: 20px;">
                <div style="font-size: 16px; font-weight: 600; color: #1f2937; margin-bottom: 10px;">
                  Work Orders (${workOrders.length})
                </div>
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                  <thead>
                    <tr style="background: #e5e7eb;">
                      <th style="padding: 10px; text-align: left; border-bottom: 2px solid #d1d5db;">Work Order #</th>
                      <th style="padding: 10px; text-align: left; border-bottom: 2px solid #d1d5db;">Description</th>
                      <th style="padding: 10px; text-align: right; border-bottom: 2px solid #d1d5db;">Parts</th>
                      <th style="padding: 10px; text-align: right; border-bottom: 2px solid #d1d5db;">Labor</th>
                      <th style="padding: 10px; text-align: right; border-bottom: 2px solid #d1d5db;">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${workOrders.map(wo => `
                      <tr style="border-bottom: 1px solid #e5e7eb;">
                        <td style="padding: 10px;">${wo.workOrderNumber}</td>
                        <td style="padding: 10px;">${wo.projectName}</td>
                        <td style="padding: 10px; text-align: right;">${formatCurrency(wo.partsSubtotal)}</td>
                        <td style="padding: 10px; text-align: right;">${formatCurrency(wo.laborSubtotal)}</td>
                        <td style="padding: 10px; text-align: right; font-weight: 600;">${formatCurrency(wo.rowTotal)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            ` : ''}
            
            <!-- Billing Sheets Summary -->
            ${billingSheets.length > 0 ? `
              <div style="margin-bottom: 20px;">
                <div style="font-size: 16px; font-weight: 600; color: #1f2937; margin-bottom: 10px;">
                  Billing Sheets (${billingSheets.length})
                </div>
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                  <thead>
                    <tr style="background: #e5e7eb;">
                      <th style="padding: 10px; text-align: left; border-bottom: 2px solid #d1d5db;">Billing Sheet #</th>
                      <th style="padding: 10px; text-align: left; border-bottom: 2px solid #d1d5db;">Description</th>
                      <th style="padding: 10px; text-align: right; border-bottom: 2px solid #d1d5db;">Parts</th>
                      <th style="padding: 10px; text-align: right; border-bottom: 2px solid #d1d5db;">Labor</th>
                      <th style="padding: 10px; text-align: right; border-bottom: 2px solid #d1d5db;">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${billingSheets.map(bs => `
                      <tr style="border-bottom: 1px solid #e5e7eb;">
                        <td style="padding: 10px;">${bs.billingNumber}</td>
                        <td style="padding: 10px;">${bs.workDescription}</td>
                        <td style="padding: 10px; text-align: right;">${formatCurrency(bs.partsSubtotal)}</td>
                        <td style="padding: 10px; text-align: right;">${formatCurrency(bs.laborSubtotal)}</td>
                        <td style="padding: 10px; text-align: right; font-weight: 600;">${formatCurrency(bs.rowTotal)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            ` : ''}
            
            <!-- Grand Totals -->
            <div style="margin-top: 25px; padding: 20px; background: white; border-radius: 6px; border: 2px solid #3B82F6;">
              <div style="display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; color: #6b7280;">
                <span>Total Parts:</span>
                <span>${formatCurrency(totals.partsSubtotal)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; color: #6b7280;">
                <span>Total Labor:</span>
                <span>${formatCurrency(totals.laborSubtotal)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; padding: 12px 0; margin-top: 10px; border-top: 2px solid #3B82F6; font-size: 18px; font-weight: bold; color: #1f2937;">
                <span>Invoice Total:</span>
                <span style="color: #3B82F6;">${formatCurrency(totals.grandTotal)}</span>
              </div>
            </div>
          </div>
          
          <!-- Grand Total -->
          <div class="grand-total-section">
            <div class="grand-total-label">Invoice Total Amount</div>
            <div class="grand-total-amount">${formatCurrency(totals.grandTotal)}</div>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}
