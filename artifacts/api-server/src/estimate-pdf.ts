import puppeteer from 'puppeteer-core';
import type { EstimateWithItems, EstimateItem, Company } from '@workspace/db';
import { resolveChromiumExecutable } from './chromium-resolver';
import { fetchLogoAsBase64 } from './pdf-generator';

const DEFAULT_BRAND_COLOR = '#1E5A99';
const DEFAULT_BRAND_DARK = '#143F6B';

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

function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtMoney(value: string | number | null | undefined): string {
  const n = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
  if (!Number.isFinite(n)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function fmtDate(value: Date | string | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function addDays(value: Date | string | null | undefined, days: number): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return d;
}

function statusLabel(status: string): string {
  switch (status) {
    case 'pending': return 'Pending';
    case 'approved': return 'Approved';
    case 'rejected': return 'Rejected';
    case 'expired': return 'Expired';
    case 'converted_to_work_order': return 'Converted';
    default: return status || '—';
  }
}

function renderItemRow(item: EstimateItem, laborRate: number, idx: number): string {
  const partPrice = parseFloat(item.partPrice) || 0;
  const quantity = item.quantity || 0;
  const laborHours = parseFloat(item.laborHours) || 0;
  const totalPrice = parseFloat(item.totalPrice) || 0;
  const lineTotal = totalPrice + laborHours * laborRate;
  return `
      <tr class="${idx % 2 === 1 ? 'zebra' : ''}">
        <td>
          <div class="part-name">${escapeHtml(item.partName)}</div>
          ${item.description ? `<div class="muted">${escapeHtml(item.description)}</div>` : ''}
        </td>
        <td class="r">${escapeHtml(quantity)}</td>
        <td class="r">${fmtMoney(partPrice)}</td>
        <td class="r">${laborHours.toFixed(2)}h</td>
        <td class="r b">${fmtMoney(lineTotal)}</td>
      </tr>`;
}

export interface RenderEstimatePdfOptions {
  company?: Company | null;
  logoDataUri?: string | null;
  accentColor?: string;
  accentDark?: string;
}

export function buildEstimateHtml(
  estimate: EstimateWithItems,
  opts: RenderEstimatePdfOptions = {},
): string {
  const items = estimate.items ?? [];
  const laborRate = parseFloat(estimate.laborRate) || 0;
  const accent = opts.accentColor || DEFAULT_BRAND_COLOR;
  const accentDark = opts.accentDark || DEFAULT_BRAND_DARK;
  const itemsRows = items
    .map((it, idx) => renderItemRow(it, laborRate, idx))
    .join('');

  const partsSubtotal = parseFloat(estimate.partsSubtotal) || 0;
  const laborSubtotal = parseFloat(estimate.laborSubtotal) || 0;
  const grandTotal = parseFloat(estimate.totalAmount) || (partsSubtotal + laborSubtotal);

  const lat = estimate.workLocationLat;
  const lng = estimate.workLocationLng;
  const workAddr = estimate.workLocationAddress;
  const controllerLetter = estimate.controllerLetter;
  const zoneNumber = estimate.zoneNumber;
  const hasPin = lat != null && lng != null;
  const mapLink = hasPin
    ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
    : '';
  const latNum = hasPin ? parseFloat(String(lat)) : 0;
  const lngNum = hasPin ? parseFloat(String(lng)) : 0;
  const coordsText = hasPin ? `${latNum.toFixed(6)}, ${lngNum.toFixed(6)}` : '';

  const pinSection = hasPin ? `
    <section class="card pin-card">
      <h2>Pinned Work Location</h2>
      ${workAddr ? `<div><span class="lbl">Address:</span> ${escapeHtml(workAddr)}</div>` : ''}
      <div><span class="lbl">Coordinates:</span> <span class="mono">${escapeHtml(coordsText)}</span></div>
      <div><span class="lbl">Map link:</span> <a href="${escapeHtml(mapLink)}">${escapeHtml(mapLink)}</a></div>
      ${(controllerLetter || zoneNumber != null) ? `<div><span class="lbl">Controller / Zone:</span> ${controllerLetter ? `Controller ${escapeHtml(controllerLetter)}` : ''}${controllerLetter && zoneNumber != null ? ' · ' : ''}${zoneNumber != null ? `Zone ${escapeHtml(zoneNumber)}` : ''}</div>` : ''}
    </section>` : '';

  const company = opts.company;
  const logoBlock = opts.logoDataUri
    ? `<img src="${opts.logoDataUri}" alt="${escapeHtml(company?.name ?? 'Logo')}" class="logo" />`
    : '';
  const companyName = company?.name ?? 'IrrigoPro';
  const companyLines = [
    company?.address,
    company?.phone,
    company?.email,
  ].filter(Boolean) as string[];

  const expirationDate = addDays(estimate.estimateDate, 30);

  const termsBlock = (estimate.locationNotes || estimate.accessInstructions) ? `
    <section class="card">
      <h2>Terms &amp; Notes</h2>
      ${estimate.locationNotes ? `<div><span class="lbl">Location notes:</span> ${escapeHtml(estimate.locationNotes)}</div>` : ''}
      ${estimate.accessInstructions ? `<div style="margin-top:6px;"><span class="lbl">Access:</span> ${escapeHtml(estimate.accessInstructions)}</div>` : ''}
      <div class="muted" style="margin-top:10px;">
        This estimate is valid for 30 days from the date issued. Pricing is
        based on the scope of work above; additional findings discovered on
        site may adjust the final invoice.
      </div>
    </section>` : `
    <section class="card">
      <h2>Terms &amp; Notes</h2>
      <div class="muted">
        This estimate is valid for 30 days from the date issued. Pricing is
        based on the scope of work above; additional findings discovered on
        site may adjust the final invoice.
      </div>
    </section>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Estimate ${escapeHtml(estimate.estimateNumber)}</title>
<style>
  @page { margin: 0.6in 0.5in 0.85in 0.5in; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color: #1f2937; margin: 0; padding: 0; font-size: 11.5px; line-height: 1.45; }
  h1, h2, h3 { margin: 0; }
  a { color: ${accent}; text-decoration: underline; word-break: break-all; }
  .muted { color: #6b7280; font-size: 10.5px; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

  /* Branded header bar */
  .brand-bar { background: ${accent}; color: white; padding: 14px 18px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 16px; }
  .brand-bar .co { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .brand-bar .logo { max-height: 44px; max-width: 140px; background: white; padding: 4px 6px; border-radius: 4px; object-fit: contain; }
  .brand-bar .co-name { font-size: 16px; font-weight: 700; line-height: 1.2; }
  .brand-bar .co-meta { font-size: 10.5px; opacity: 0.92; line-height: 1.35; }
  .brand-bar .doc-meta { text-align: right; }
  .brand-bar .doc-label { font-size: 11px; letter-spacing: 0.18em; opacity: 0.85; }
  .brand-bar .doc-number { font-size: 20px; font-weight: 700; }
  .brand-bar .doc-status { display: inline-block; margin-top: 4px; font-size: 10.5px; padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,0.18); }

  /* Section titles */
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: ${accentDark}; border-bottom: 2px solid ${accent}; padding-bottom: 4px; margin-bottom: 8px; }

  .meta-row { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 14px; font-size: 11px; }
  .meta-row .item .k { color: #6b7280; text-transform: uppercase; font-size: 9.5px; letter-spacing: 0.06em; }
  .meta-row .item .v { color: #111827; font-weight: 600; }

  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
  .card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 14px; }
  .pin-card { margin-bottom: 14px; }
  .lbl { color: #6b7280; font-weight: 600; }

  .scope { white-space: pre-wrap; }

  /* Items table */
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 7px 9px; text-align: left; vertical-align: top; }
  thead th { background: ${accent}; color: white; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
  tbody td { border-bottom: 1px solid #eef0f3; }
  tbody tr.zebra td { background: #f8fafc; }
  td.r, th.r { text-align: right; }
  td.b { font-weight: 600; }
  .part-name { font-weight: 600; color: #111827; }

  /* Totals */
  .totals-wrap { display: flex; justify-content: flex-end; margin-top: 12px; }
  .totals { width: 280px; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
  .totals .row { display: flex; justify-content: space-between; padding: 6px 12px; font-size: 11.5px; }
  .totals .row + .row { border-top: 1px solid #eef0f3; }
  .totals .grand { background: ${accentDark}; color: white; padding: 10px 12px; font-size: 13.5px; font-weight: 700; }
  .totals .grand .label { letter-spacing: 0.03em; }

  /* Signature */
  .sig { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-top: 22px; }
  .sig .block { border-top: 1px solid #9ca3af; padding-top: 4px; }
  .sig .lbl-sm { font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.06em; }
  .sig .name { font-size: 11.5px; color: #111827; margin-top: 2px; }
</style>
</head>
<body>
  <div class="brand-bar">
    <div class="co">
      ${logoBlock}
      <div>
        <div class="co-name">${escapeHtml(companyName)}</div>
        ${companyLines.length ? `<div class="co-meta">${companyLines.map(escapeHtml).join(' · ')}</div>` : ''}
      </div>
    </div>
    <div class="doc-meta">
      <div class="doc-label">ESTIMATE</div>
      <div class="doc-number">#${escapeHtml(estimate.estimateNumber)}</div>
      <div class="doc-status">${escapeHtml(statusLabel(estimate.status))}</div>
    </div>
  </div>

  <div class="meta-row">
    <div class="item"><div class="k">Estimate Date</div><div class="v">${escapeHtml(fmtDate(estimate.estimateDate))}</div></div>
    <div class="item"><div class="k">Valid Until</div><div class="v">${escapeHtml(fmtDate(expirationDate))}</div></div>
    <div class="item"><div class="k">Project</div><div class="v">${escapeHtml(estimate.projectName)}</div></div>
    ${estimate.createdBy ? `<div class="item"><div class="k">Prepared By</div><div class="v">${escapeHtml(estimate.createdBy)}</div></div>` : ''}
  </div>

  <div class="grid">
    <section class="card">
      <h2>Bill To</h2>
      <div class="part-name">${escapeHtml(estimate.customerName)}</div>
      ${estimate.customerEmail ? `<div class="muted">${escapeHtml(estimate.customerEmail)}</div>` : ''}
      ${estimate.customerPhone ? `<div class="muted">${escapeHtml(estimate.customerPhone)}</div>` : ''}
    </section>
    <section class="card">
      <h2>Project / Work Site</h2>
      <div class="part-name">${escapeHtml(estimate.projectName)}</div>
      ${estimate.projectAddress ? `<div class="muted">${escapeHtml(estimate.projectAddress)}</div>` : ''}
    </section>
  </div>

  ${estimate.workDescription ? `
  <section class="card" style="margin-bottom: 14px;">
    <h2>Scope of Work</h2>
    <div class="scope">${escapeHtml(estimate.workDescription)}</div>
  </section>` : ''}

  ${pinSection}

  <section>
    <h2>Line Items</h2>
    <table>
      <thead>
        <tr>
          <th>Part / Description</th>
          <th class="r">Qty</th>
          <th class="r">Unit Price</th>
          <th class="r">Labor</th>
          <th class="r">Line Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsRows || `<tr><td colspan="5" class="muted">No line items</td></tr>`}
      </tbody>
    </table>
    <div class="totals-wrap">
      <div class="totals">
        <div class="row"><span>Parts Subtotal</span><span>${fmtMoney(partsSubtotal)}</span></div>
        <div class="row"><span>Labor Subtotal</span><span>${fmtMoney(laborSubtotal)}</span></div>
        <div class="grand row"><span class="label">Grand Total</span><span>${fmtMoney(grandTotal)}</span></div>
      </div>
    </div>
  </section>

  ${termsBlock}

  <div class="sig">
    <div class="block">
      <div class="lbl-sm">Customer Approval</div>
      <div class="name">Signature &amp; Date</div>
    </div>
    <div class="block">
      <div class="lbl-sm">Prepared By</div>
      <div class="name">${escapeHtml(estimate.createdBy || companyName)}</div>
    </div>
  </div>
</body>
</html>`;
}

function footerTemplate(companyName: string, estimateNumber: string): string {
  return `
<div style="width:100%; font-size:8.5px; color:#6b7280; padding:0 0.5in; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif; display:flex; justify-content:space-between;">
  <span>${escapeHtml(companyName)}</span>
  <span>Estimate #${escapeHtml(estimateNumber)}</span>
  <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
</div>`;
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

  const html = buildEstimateHtml(estimate, {
    ...opts,
    logoDataUri,
    accentColor: accentColor || DEFAULT_BRAND_COLOR,
    accentDark: accentDark || DEFAULT_BRAND_DARK,
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
