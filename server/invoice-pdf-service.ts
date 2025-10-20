import { PDFGenerator } from './pdf-generator';
import { objectStorageClient } from './objectStorage';
import type { IStorage } from './storage';
import type { WorkOrder, WorkOrderItem, BillingSheet, BillingSheetItem } from '@shared/schema';

interface InvoicePdfGenerationResult {
  success: boolean;
  pdfUrl?: string;
  error?: string;
}

export class InvoicePdfService {
  private storage: IStorage;

  constructor(storage: IStorage) {
    this.storage = storage;
  }

  async generateAndSaveInvoicePdf(invoiceId: number): Promise<InvoicePdfGenerationResult> {
    try {
      // 1. Fetch invoice with items
      const invoice = await this.storage.getInvoiceById(invoiceId);
      if (!invoice) {
        return { success: false, error: 'Invoice not found' };
      }

      // 2. Fetch company profile
      const customer = await this.storage.getCustomerById(invoice.customerId);
      if (!customer) {
        return { success: false, error: 'Customer not found' };
      }

      const company = await this.storage.getCompany(customer.companyId);
      if (!company) {
        return { success: false, error: 'Company not found' };
      }

      // 3. Fetch work orders and billing sheets from invoice items
      const workOrders: Array<{ workOrder: WorkOrder; items: WorkOrderItem[] }> = [];
      const billingSheets: Array<{ billingSheet: BillingSheet; items: BillingSheetItem[] }> = [];

      for (const item of invoice.items) {
        if (item.sourceType === 'work_order' && item.workOrderId) {
          // Fetch the work order with items
          const workOrder = await this.storage.getWorkOrder(item.workOrderId);
          if (workOrder) {
            const existingWo = workOrders.find(wo => wo.workOrder.id === workOrder.id);
            if (!existingWo) {
              const items = await this.storage.getWorkOrderItems(workOrder.id);
              workOrders.push({ workOrder, items });
            }
          }
        } else if (item.sourceType === 'billing_sheet' && item.billingSheetId) {
          // Fetch the billing sheet with items
          const billingSheet = await this.storage.getBillingSheetById(item.billingSheetId);
          if (billingSheet) {
            const existingBs = billingSheets.find(bs => bs.billingSheet.id === billingSheet.id);
            if (!existingBs) {
              // BillingSheetWithItems already has the structure we need
              billingSheets.push({
                billingSheet: billingSheet,
                items: billingSheet.items || [],
              });
            }
          }
        }
      }

      // 4. Generate PDF using Puppeteer
      const pdfBuffer = await PDFGenerator.generateInvoiceDetailPDF({
        invoice,
        company: {
          name: company.name,
          logo: company.logo || undefined,
          address: company.address || undefined,
          phone: company.phone || undefined,
          email: company.email || undefined,
        },
        workOrders,
        billingSheets,
      });

      // 5. Upload PDF to Google Cloud Storage
      const pdfUrl = await this.uploadPdfToStorage(pdfBuffer, invoice, customer.companyId);

      // 6. Create filename with YYYY-MM-DD format
      const periodStart = new Date(invoice.periodStart);
      const periodEnd = new Date(invoice.periodEnd);
      const formatDate = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      const filename = `Invoice_${invoice.invoiceNumber}_${formatDate(periodStart)}-${formatDate(periodEnd)}_Detail.pdf`;

      // 7. Save PDF record to database
      await this.storage.createInvoicePdf({
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        companyId: customer.companyId,
        pdfUrl,
        filename,
        status: 'generated',
      });

      return { success: true, pdfUrl };
    } catch (error) {
      console.error('Error generating invoice PDF:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  private async uploadPdfToStorage(pdfBuffer: Buffer, invoice: any, companyId: number): Promise<string> {
    const publicSearchPaths = process.env.PUBLIC_OBJECT_SEARCH_PATHS?.split(',') || [];
    if (publicSearchPaths.length === 0) {
      throw new Error('No public search paths configured');
    }

    // Create a unique filename
    const timestamp = Date.now();
    const filename = `invoice-${invoice.invoiceNumber}-${timestamp}.pdf`;
    const fullPath = `${publicSearchPaths[0]}/invoice-pdfs/${companyId}/${filename}`;

    // Parse bucket and object name
    const pathParts = fullPath.split('/').filter(p => p);
    const bucketName = pathParts[0];
    const objectName = pathParts.slice(1).join('/');

    // Upload to Google Cloud Storage
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);

    await file.save(pdfBuffer, {
      contentType: 'application/pdf',
      metadata: {
        contentType: 'application/pdf',
      },
    });

    // Return the storage path for later retrieval
    return `/${bucketName}/${objectName}`;
  }
}
