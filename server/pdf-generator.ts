import puppeteer from 'puppeteer';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import type { PdfViewModel } from './pdf-view-model';
import {
  FAILED_PHOTO_SENTINEL,
  fetchLogoAsBase64,
  invoiceHeader,
  billToBlock,
  summaryTotalsCard,
  tableOfContents,
  sectionBanner,
  workRecordCard,
  billingSheetCard,
  finalSummaryTable,
  pageFooter,
  buildFullCSS,
} from './pdf-helpers';

export { fetchLogoAsBase64 };

async function fetchPhotoAsDataUri(photoUrl: string, port: number): Promise<string> {
  const PHOTO_LOAD_TIMEOUT_MS = 8000;
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

function getChromiumPath(): string {
  try {
    const chromiumPath = execSync('which chromium').toString().trim();
    return chromiumPath;
  } catch {
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
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      const htmlContent = readFileSync(invoiceHtmlPath, 'utf-8');
      await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' },
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
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' },
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  static async generateInvoiceDetailPDF(viewModel: PdfViewModel): Promise<Buffer> {
    const port = parseInt(process.env.PORT || '5000', 10);

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
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();

      // Generate HTML content from the pre-computed view model with pre-loaded photo data URIs
      const htmlContent = this.generateInvoiceDetailHTML(viewModel, woPhotoMaps, bsPhotoMaps);

      // Set the HTML content — no external fetches needed since images are embedded
      await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });

      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0.5in', right: '0.5in', bottom: '0.75in', left: '0.5in' },
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  private static generateInvoiceDetailHTML(
    vm: PdfViewModel,
    woPhotoMaps: string[][] = [],
    bsPhotoMaps: string[][] = [],
  ): string {
    const { company, invoice, workOrders, billingSheets } = vm;

    const workOrdersSection = workOrders.length > 0
      ? `${sectionBanner('work-orders')}
         ${workOrders.map((wo, i) => workRecordCard(wo, woPhotoMaps[i] ?? [])).join('')}`
      : '';

    const billingSheetsSection = billingSheets.length > 0
      ? `${sectionBanner('billing-sheets')}
         ${billingSheets.map((bs, i) => billingSheetCard(bs, bsPhotoMaps[i] ?? [])).join('')}`
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Invoice ${invoice.invoiceNumber} – Detail Report</title>
  <style>${buildFullCSS()}</style>
</head>
<body>
  ${pageFooter(invoice.invoiceNumber)}
  <div class="container">
    ${invoiceHeader(invoice, company)}
    ${billToBlock(invoice)}
    ${summaryTotalsCard(vm.totals, workOrders.length, billingSheets.length)}
    ${tableOfContents(workOrders, billingSheets)}
    ${workOrdersSection}
    ${billingSheetsSection}
    ${finalSummaryTable(vm)}
  </div>
</body>
</html>`;
  }
}
