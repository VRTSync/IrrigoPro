import puppeteer from 'puppeteer-core';
import type { EstimateWithItems } from '@workspace/db';
import { resolveChromiumExecutable } from './chromium-resolver';
import { fetchLogoAsBase64, preloadPhotos } from './pdf-generator';
import {
  buildEstimateHtml,
  footerTemplate,
  DEFAULT_BRAND_COLOR,
  DEFAULT_BRAND_DARK,
  type RenderEstimatePdfOptions,
} from './estimate-pdf-html';

export { buildEstimateHtml, type RenderEstimatePdfOptions } from './estimate-pdf-html';

const LOGO_PATH_PATTERNS = [
  /\/api\/public-objects\/company-logos\/(.+)/,
  /\/api\/company-logo\/(.+)/,
];

function resolveLogoToFetchableUrl(storedLogo: string): string {
  const port = process.env.PORT || 5000;
  const localBase = `http://localhost:${port}`;

  if (storedLogo.startsWith('http://') || storedLogo.startsWith('https://')) {
    let pathname: string;
    try {
      pathname = new URL(storedLogo).pathname;
    } catch {
      return storedLogo;
    }
    for (const pattern of LOGO_PATH_PATTERNS) {
      const match = pathname.match(pattern);
      if (match) {
        return `${localBase}/api/company-logo/${match[1]}`;
      }
    }
    return storedLogo;
  }

  if (storedLogo.startsWith('/api/')) return `${localBase}${storedLogo}`;
  if (storedLogo.startsWith('/')) return `${localBase}/api/company-logo${storedLogo}`;
  if (storedLogo.startsWith('company-logos/')) {
    return `${localBase}/api/company-logo/${storedLogo.replace('company-logos/', '')}`;
  }
  return `${localBase}/api/company-logo/${storedLogo}`;
}

async function extractAccentFromLogo(dataUri: string): Promise<{ accent: string; accentDark: string }> {
  try {
    const { Vibrant } = await import('node-vibrant/node');
    const base64Data = dataUri.replace(/^data:image\/[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const palette = await Vibrant.from(buffer).getPalette();
    const swatch = palette.Vibrant || palette.DarkVibrant || palette.Muted;
    const darkSwatch = palette.DarkVibrant || palette.DarkMuted || swatch;
    if (!swatch) return { accent: DEFAULT_BRAND_COLOR, accentDark: DEFAULT_BRAND_DARK };
    const toHex = (s: { rgb: number[] }) =>
      '#' + s.rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    return {
      accent: toHex(swatch),
      accentDark: darkSwatch ? toHex(darkSwatch) : DEFAULT_BRAND_DARK,
    };
  } catch {
    return { accent: DEFAULT_BRAND_COLOR, accentDark: DEFAULT_BRAND_DARK };
  }
}

export async function renderEstimatePdf(
  estimate: EstimateWithItems,
  opts: RenderEstimatePdfOptions = {},
): Promise<Buffer> {
  let logoDataUri = opts.logoDataUri ?? null;
  let accentColor = opts.accentColor;
  let accentDark = opts.accentDark;

  if (!logoDataUri && opts.company?.logo) {
    try {
      const logoUrl = resolveLogoToFetchableUrl(opts.company.logo);
      logoDataUri = await fetchLogoAsBase64(logoUrl);
    } catch {
      logoDataUri = null;
    }
  }

  if (logoDataUri && (!accentColor || !accentDark)) {
    const extracted = await extractAccentFromLogo(logoDataUri);
    accentColor = accentColor || extracted.accent;
    accentDark = accentDark || extracted.accentDark;
  }

  // Task #666 — preload site photos into the PDF as base64 data URIs so
  // the embedded image grid renders without making outbound requests
  // from headless chromium. Mirrors the work-order / billing-sheet PDF
  // pipeline.
  let photoDataUris = opts.photoDataUris;
  if (!photoDataUris) {
    const photoSrc = (estimate.photos ?? []).filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    );
    if (photoSrc.length > 0) {
      const port = parseInt(process.env.PORT || '5000', 10);
      try {
        photoDataUris = await preloadPhotos(photoSrc, port);
      } catch {
        photoDataUris = [];
      }
    } else {
      photoDataUris = [];
    }
  }

  const html = buildEstimateHtml(estimate, {
    ...opts,
    logoDataUri,
    accentColor: accentColor || DEFAULT_BRAND_COLOR,
    accentDark: accentDark || DEFAULT_BRAND_DARK,
    photoDataUris,
  });

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: resolveChromiumExecutable(),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const companyName = opts.company?.name ?? 'IrrigoPro';
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: footerTemplate(companyName, estimate.estimateNumber),
      margin: { top: '0.6in', right: '0.5in', bottom: '0.85in', left: '0.5in' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
