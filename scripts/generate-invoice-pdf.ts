import { InvoicePdfService } from '../server/invoice-pdf-service';
import { DatabaseStorage } from '../server/storage';

async function generatePDF() {
  const storage = new DatabaseStorage();
  const pdfService = new InvoicePdfService(storage);

  const invoiceId = 17;
  console.log(`Generating PDF for invoice ID ${invoiceId}...`);
  
  const result = await pdfService.generateAndSaveInvoicePdf(invoiceId);

  if (result.success) {
    console.log('✓ PDF generated successfully!');
    console.log('  PDF URL:', result.pdfUrl);
    console.log('  Filename:', result.filename);
  } else {
    console.error('✗ PDF generation failed:', result.error);
  }

  process.exit(result.success ? 0 : 1);
}

generatePDF().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
