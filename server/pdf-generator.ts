import puppeteer from 'puppeteer';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import type { Invoice, InvoiceItem, WorkOrder, WorkOrderItem, BillingSheet, BillingSheetItem } from '@shared/schema';

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

interface InvoiceDetailData {
  invoice: Invoice;
  company: {
    name: string;
    logo?: string;
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

  static async generateInvoiceDetailPDF(data: InvoiceDetailData): Promise<Buffer> {
    const chromiumPath = getChromiumPath();
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: chromiumPath || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
      const page = await browser.newPage();
      
      // Generate HTML content
      const htmlContent = this.generateInvoiceDetailHTML(data);
      
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

  private static generateInvoiceDetailHTML(data: InvoiceDetailData): string {
    const { invoice, company, workOrders, billingSheets } = data;
    
    const formatDate = (date: Date | string) => {
      const d = new Date(date);
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    };

    const formatCurrency = (amount: string | number) => {
      const num = typeof amount === 'string' ? parseFloat(amount) : amount;
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num || 0);
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
          }
          
          .company-logo {
            width: 120px;
            height: auto;
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
              ${company.logo ? `<img src="${company.logo}" class="company-logo" alt="${company.name}">` : ''}
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
                <div><strong>Generated:</strong> ${formatDate(new Date())}</div>
              </div>
            </div>
          </div>
          
          <!-- Customer Info -->
          <div class="customer-section">
            <div class="customer-title">Bill To</div>
            <div class="customer-name">${invoice.customerName}</div>
            <div class="customer-details">
              ${invoice.customerEmail}<br>
              ${invoice.customerPhone ? invoice.customerPhone : ''}
            </div>
          </div>
          
          <!-- Summary -->
          <div class="summary-section">
            <div class="summary-grid">
              <div class="summary-item">
                <div class="summary-label">Total Jobs</div>
                <div class="summary-value">${workOrders.length + billingSheets.length}</div>
              </div>
              <div class="summary-item">
                <div class="summary-label">Labor</div>
                <div class="summary-value">${formatCurrency(invoice.laborSubtotal)}</div>
              </div>
              <div class="summary-item">
                <div class="summary-label">Parts</div>
                <div class="summary-value">${formatCurrency(invoice.partsSubtotal)}</div>
              </div>
            </div>
          </div>
          
          <!-- Work Orders -->
          ${workOrders.map((wo, index) => `
            <div class="work-order-section">
              <div class="section-header">
                <div class="section-title">Work Order #${wo.workOrder.workOrderNumber}</div>
                <div class="section-subtitle">${wo.workOrder.projectName || 'Service Work'}</div>
              </div>
              
              <!-- Location Information -->
              ${wo.workOrder.projectAddress || wo.workOrder.locationNotes ? `
                <div class="work-order-details">
                  ${wo.workOrder.projectAddress ? `
                    <div class="detail-item">
                      <div class="detail-label">Service Location</div>
                      <div class="detail-value">${wo.workOrder.projectAddress}</div>
                    </div>
                  ` : ''}
                  ${wo.workOrder.locationNotes ? `
                    <div class="detail-item">
                      <div class="detail-label">Location Notes</div>
                      <div class="detail-value">${wo.workOrder.locationNotes}</div>
                    </div>
                  ` : ''}
                </div>
              ` : ''}
              
              <!-- Work Order Details -->
              <div class="work-order-details">
                <div class="detail-item">
                  <div class="detail-label">Technician</div>
                  <div class="detail-value">${wo.workOrder.completedByUserName || wo.workOrder.assignedTechnicianName || 'N/A'}</div>
                </div>
                <div class="detail-item">
                  <div class="detail-label">Date Completed</div>
                  <div class="detail-value">${wo.workOrder.completedAt ? formatDate(wo.workOrder.completedAt) : 'N/A'}</div>
                </div>
                <div class="detail-item">
                  <div class="detail-label">Total Hours</div>
                  <div class="detail-value">${wo.workOrder.totalHours || '0'} hours</div>
                </div>
                <div class="detail-item">
                  <div class="detail-label">Labor Rate</div>
                  <div class="detail-value">$45.00/hr</div>
                </div>
              </div>
              
              <!-- Work Summary if available -->
              ${wo.workOrder.workSummary ? `
                <div style="background: #f9fafb; padding: 15px; border-radius: 6px; margin-bottom: 20px;">
                  <div style="font-weight: 600; color: #6b7280; margin-bottom: 5px;">Work Summary</div>
                  <div style="color: #1f2937; font-size: 13px;">${wo.workOrder.workSummary}</div>
                </div>
              ` : ''}
              
              <!-- Parts and Labor Breakdown -->
              ${wo.items && wo.items.length > 0 ? `
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
                          <td class="text-right">${formatCurrency(item.partPrice)}</td>
                          <td class="text-right">${item.laborHours}</td>
                          <td class="text-right">${formatCurrency(item.totalPrice)}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              ` : '<p style="color: #6b7280; padding: 10px;">No line items</p>'}
              
              <!-- Photos if available -->
              ${wo.workOrder.photos && wo.workOrder.photos.length > 0 ? `
                <div style="margin-bottom: 20px;">
                  <div style="font-weight: 600; color: #1f2937; margin-bottom: 10px; font-size: 14px;">Work Photos</div>
                  <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
                    ${wo.workOrder.photos.map(photo => `
                      <img src="${photo}" alt="Work photo" style="width: 100%; height: 150px; object-fit: cover; border-radius: 6px; border: 1px solid #e5e7eb;">
                    `).join('')}
                  </div>
                </div>
              ` : ''}
              
              <!-- Work Order Totals -->
              <div class="work-order-totals">
                <div class="totals-row subtotal">
                  <span>Parts Subtotal:</span>
                  <span>${formatCurrency(wo.workOrder.totalPartsCost || '0')}</span>
                </div>
                <div class="totals-row subtotal">
                  <span>Labor Subtotal (${wo.workOrder.totalHours || '0'} hrs × $45.00):</span>
                  <span>${formatCurrency((parseFloat(wo.workOrder.totalHours || '0') * 45).toFixed(2))}</span>
                </div>
                <div class="totals-row total">
                  <span>Work Order Total:</span>
                  <span>${formatCurrency(wo.workOrder.totalAmount || '0')}</span>
                </div>
              </div>
            </div>
          `).join('')}
          
          <!-- Billing Sheets -->
          ${billingSheets.map((bs, index) => `
            <div class="work-order-section">
              <div class="section-header">
                <div class="section-title">Billing Sheet #${bs.billingSheet.billingNumber}</div>
                <div class="section-subtitle">${bs.billingSheet.workDescription || 'Additional Work'}</div>
              </div>
              
              <!-- Location Information -->
              ${bs.billingSheet.propertyAddress ? `
                <div class="work-order-details">
                  <div class="detail-item">
                    <div class="detail-label">Service Location</div>
                    <div class="detail-value">${bs.billingSheet.propertyAddress}</div>
                  </div>
                </div>
              ` : ''}
              
              <!-- Billing Sheet Details -->
              <div class="work-order-details">
                <div class="detail-item">
                  <div class="detail-label">Technician</div>
                  <div class="detail-value">${bs.billingSheet.technicianName || 'N/A'}</div>
                </div>
                <div class="detail-item">
                  <div class="detail-label">Work Date</div>
                  <div class="detail-value">${formatDate(bs.billingSheet.workDate)}</div>
                </div>
                <div class="detail-item">
                  <div class="detail-label">Total Hours</div>
                  <div class="detail-value">${bs.billingSheet.totalHours || '0'} hours</div>
                </div>
                <div class="detail-item">
                  <div class="detail-label">Labor Rate</div>
                  <div class="detail-value">${formatCurrency(bs.billingSheet.laborRate || '45')}/hr</div>
                </div>
              </div>
              
              <!-- Work Description if available -->
              ${bs.billingSheet.notes ? `
                <div style="background: #f9fafb; padding: 15px; border-radius: 6px; margin-bottom: 20px;">
                  <div style="font-weight: 600; color: #6b7280; margin-bottom: 5px;">Additional Notes</div>
                  <div style="color: #1f2937; font-size: 13px;">${bs.billingSheet.notes}</div>
                </div>
              ` : ''}
              
              <!-- Parts and Labor Breakdown -->
              ${bs.items && bs.items.length > 0 ? `
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
                          <td class="text-right">${formatCurrency(item.totalPrice)}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              ` : '<p style="color: #6b7280; padding: 10px;">No line items</p>'}
              
              <!-- Photos if available -->
              ${bs.billingSheet.photos && bs.billingSheet.photos.length > 0 ? `
                <div style="margin-bottom: 20px;">
                  <div style="font-weight: 600; color: #1f2937; margin-bottom: 10px; font-size: 14px;">Work Photos</div>
                  <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
                    ${bs.billingSheet.photos.map(photo => `
                      <img src="${photo}" alt="Work photo" style="width: 100%; height: 150px; object-fit: cover; border-radius: 6px; border: 1px solid #e5e7eb;">
                    `).join('')}
                  </div>
                </div>
              ` : ''}
              
              <!-- Billing Sheet Totals -->
              <div class="work-order-totals">
                <div class="totals-row subtotal">
                  <span>Parts Subtotal:</span>
                  <span>${formatCurrency(bs.billingSheet.partsSubtotal || '0')}</span>
                </div>
                <div class="totals-row subtotal">
                  <span>Labor Subtotal (${bs.billingSheet.totalHours || '0'} hrs × ${formatCurrency(bs.billingSheet.laborRate || '45')}):</span>
                  <span>${formatCurrency(bs.billingSheet.laborSubtotal || '0')}</span>
                </div>
                <div class="totals-row total">
                  <span>Billing Sheet Total:</span>
                  <span>${formatCurrency(bs.billingSheet.totalAmount || parseFloat(bs.billingSheet.partsSubtotal || '0') + parseFloat(bs.billingSheet.laborSubtotal || '0'))}</span>
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
                        <td style="padding: 10px;">${wo.workOrder.workOrderNumber}</td>
                        <td style="padding: 10px;">${wo.workOrder.projectName || 'Service Work'}</td>
                        <td style="padding: 10px; text-align: right;">${formatCurrency(wo.workOrder.totalPartsCost || '0')}</td>
                        <td style="padding: 10px; text-align: right;">${formatCurrency((parseFloat(wo.workOrder.totalHours || '0') * 45).toFixed(2))}</td>
                        <td style="padding: 10px; text-align: right; font-weight: 600;">${formatCurrency(wo.workOrder.totalAmount || '0')}</td>
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
                        <td style="padding: 10px;">${bs.billingSheet.billingNumber}</td>
                        <td style="padding: 10px;">${bs.billingSheet.workDescription || 'Additional Work'}</td>
                        <td style="padding: 10px; text-align: right;">${formatCurrency(bs.billingSheet.partsSubtotal || '0')}</td>
                        <td style="padding: 10px; text-align: right;">${formatCurrency(bs.billingSheet.laborSubtotal || '0')}</td>
                        <td style="padding: 10px; text-align: right; font-weight: 600;">${formatCurrency(bs.billingSheet.totalAmount || parseFloat(bs.billingSheet.partsSubtotal || '0') + parseFloat(bs.billingSheet.laborSubtotal || '0'))}</td>
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
                <span>${formatCurrency(invoice.partsSubtotal)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; color: #6b7280;">
                <span>Total Labor:</span>
                <span>${formatCurrency(invoice.laborSubtotal)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; padding: 12px 0; margin-top: 10px; border-top: 2px solid #3B82F6; font-size: 18px; font-weight: bold; color: #1f2937;">
                <span>Invoice Total:</span>
                <span style="color: #3B82F6;">${formatCurrency(invoice.totalAmount)}</span>
              </div>
            </div>
          </div>
          
          <!-- Grand Total -->
          <div class="grand-total-section">
            <div class="grand-total-label">Invoice Total Amount</div>
            <div class="grand-total-amount">${formatCurrency(invoice.totalAmount)}</div>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}