import { PDFGenerator } from './pdf-generator';
import type { IStorage } from './storage';
import type { WorkOrder, WorkOrderItem, BillingSheet, BillingSheetItem } from '@shared/schema';

interface InvoicePdfGenerationResult {
  success: boolean;
  pdfBuffer?: Buffer;
  error?: string;
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

      const laborRate = customer.laborRate || '45.00';

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
        laborRate,
      });

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
