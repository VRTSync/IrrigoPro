import puppeteer from 'puppeteer';
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join, basename } from 'path';
import type { PdfViewModel, PdfBrandColors } from './pdf-view-model';
import { DEFAULT_BRAND_COLORS } from './pdf-view-model';
import { ObjectStorageService } from './objectStorage';
import {
  FAILED_PHOTO_SENTINEL,
  fetchLogoAsBase64,
  coverPage,
  ticketPageWO,
  ticketPageBS,
  reconciliationPage,
  pageFooter,
  buildFullCSS,
} from './pdf-helpers';

export { fetchLogoAsBase64 };

const _objectStorageService = new ObjectStorageService();

/**
 * Fetch a photo as a data URI, loading directly from object storage (GCS) or local disk.
 * Avoids going through the authenticated HTTP route for server-side PDF generation.
 */
async function fetchPhotoAsDataUri(photoPath: string, _port: number): Promise<string> {
  const PHOTO_LOAD_TIMEOUT_MS = 8000;
  try {
    // Handle fully-qualified external URLs (e.g. old signed GCS URLs)
    if (photoPath.startsWith('http')) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PHOTO_LOAD_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(photoPath, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) return FAILED_PHOTO_SENTINEL;
      const contentType = response.headers.get('content-type') || '';
      const mimeType = contentType.split(';')[0].trim().toLowerCase();
      if (!mimeType.startsWith('image/')) return FAILED_PHOTO_SENTINEL;
      const arrayBuffer = await response.arrayBuffer();
      return `data:${mimeType};base64,${Buffer.from(arrayBuffer).toString('base64')}`;
    }

    // Normalize path: strip leading /uploads/ for legacy paths
    let gcsKey = photoPath;
    if (photoPath.startsWith('/uploads/')) {
      // Legacy local file — serve from disk
      const safeName = basename(photoPath);
      const localPath = join('./uploads', safeName);
      if (existsSync(localPath)) {
        const data = readFileSync(localPath);
        return `data:image/jpeg;base64,${data.toString('base64')}`;
      }
      return FAILED_PHOTO_SENTINEL;
    }

    // Strip /api/photos/ prefix if present
    if (gcsKey.startsWith('/api/photos/')) {
      gcsKey = gcsKey.replace('/api/photos/', '');
    }

    // Try GCS object storage
    const file = await _objectStorageService.searchPhotoObject(gcsKey);
    if (!file) return FAILED_PHOTO_SENTINEL;

    // Download as buffer
    const [metadata] = await file.getMetadata();
    const mimeType = (metadata.contentType || 'image/jpeg').split(';')[0].trim();
    if (!mimeType.startsWith('image/')) return FAILED_PHOTO_SENTINEL;

    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = file.createReadStream();
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    const buffer = Buffer.concat(chunks);
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  } catch {
    return FAILED_PHOTO_SENTINEL;
  }
}

const PHOTO_BATCH_CONCURRENCY = 5;

async function preloadPhotos(urls: string[], port: number): Promise<string[]> {
  const results: string[] = new Array(urls.length);
  for (let i = 0; i < urls.length; i += PHOTO_BATCH_CONCURRENCY) {
    const batch = urls.slice(i, i + PHOTO_BATCH_CONCURRENCY);
    const batchResults = await Promise.all(batch.map(url => fetchPhotoAsDataUri(url, port)));
    batchResults.forEach((r, j) => { results[i + j] = r; });
  }
  return results;
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
    const invoiceNumber = viewModel.invoice.invoiceNumber;

    const woPhotoMaps: string[][] = [];
    for (const wo of viewModel.workOrders) {
      const result = wo.photos.length > 0 ? await preloadPhotos(wo.photos, port) : [];
      const failCount = result.filter(r => r === FAILED_PHOTO_SENTINEL).length;
      if (failCount > 0) {
        console.warn(`[PDF] Invoice ${invoiceNumber}: Work Order ${wo.workOrderNumber} — ${failCount} photo(s) failed to load`);
      }
      woPhotoMaps.push(result);
    }

    const bsPhotoMaps: string[][] = [];
    for (const bs of viewModel.billingSheets) {
      const result = bs.photos.length > 0 ? await preloadPhotos(bs.photos, port) : [];
      const failCount = result.filter(r => r === FAILED_PHOTO_SENTINEL).length;
      if (failCount > 0) {
        console.warn(`[PDF] Invoice ${invoiceNumber}: Billing Sheet ${bs.billingNumber} — ${failCount} photo(s) failed to load`);
      }
      bsPhotoMaps.push(result);
    }

    const chromiumPath = getChromiumPath();
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: chromiumPath || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();

      const htmlContent = this.generateInvoiceDetailHTML(viewModel, woPhotoMaps, bsPhotoMaps, viewModel.brandColors);

      await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });

      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `
          <div style="width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:10px;color:#6b7280;text-align:center;padding:0 0.5in;">
            Page <span class="pageNumber"></span> of <span class="totalPages"></span>
          </div>
        `,
        margin: {
          top: '0.5in',
          right: '0.5in',
          bottom: '0.75in',
          left: '0.5in'
        }
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
    brandColors: PdfBrandColors = DEFAULT_BRAND_COLORS,
  ): string {
    const { invoice, workOrders, billingSheets } = vm;

    const ticketPages = [
      ...workOrders.map((wo, i) => ticketPageWO(wo, invoice.invoiceNumber, woPhotoMaps[i] ?? [], vm.company.logoDataUri, vm.company.name)),
      ...billingSheets.map((bs, i) => ticketPageBS(bs, invoice.invoiceNumber, bsPhotoMaps[i] ?? [], vm.company.logoDataUri, vm.company.name)),
    ].join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Invoice ${invoice.invoiceNumber} – Billing Document</title>
  <style>${buildFullCSS(brandColors)}</style>
</head>
<body>
  ${pageFooter(invoice.invoiceNumber)}
  <div class="container">
    ${coverPage(vm)}
    ${reconciliationPage(vm)}
    ${ticketPages}
  </div>
</body>
</html>`;
  }
}
