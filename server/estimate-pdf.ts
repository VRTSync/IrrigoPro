import puppeteer from 'puppeteer';
import { execSync } from 'child_process';
import type { EstimateWithItems, EstimateItem } from '@shared/schema';

function getChromiumPath(): string {
  try {
    return execSync('which chromium').toString().trim();
  } catch {
    return '';
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

function renderItemRow(item: EstimateItem, laborRate: number): string {
  const partPrice = parseFloat(item.partPrice) || 0;
  const laborHours = parseFloat(item.laborHours) || 0;
  const totalPrice = parseFloat(item.totalPrice) || 0;
  const lineTotal = totalPrice + laborHours * laborRate;
  return `
      <tr>
        <td>${escapeHtml(item.partName)}${item.description ? `<div class="muted">${escapeHtml(item.description)}</div>` : ''}</td>
        <td class="r">${escapeHtml(item.quantity)}</td>
        <td class="r">${fmtMoney(partPrice)}</td>
        <td class="r">${laborHours.toFixed(2)}h</td>
        <td class="r b">${fmtMoney(lineTotal)}</td>
      </tr>`;
}

export function buildEstimateHtml(estimate: EstimateWithItems): string {
  const items = estimate.items ?? [];
  const laborRate = parseFloat(estimate.laborRate) || 0;
  const itemsRows = items.map((it) => renderItemRow(it, laborRate)).join('');

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
    <section class="card">
      <h2>Pinned Work Location</h2>
      ${workAddr ? `<div><span class="lbl">Address:</span> ${escapeHtml(workAddr)}</div>` : ''}
      <div><span class="lbl">Coordinates:</span> <span class="mono">${escapeHtml(coordsText)}</span></div>
      <div><span class="lbl">Map link:</span> <a href="${escapeHtml(mapLink)}">${escapeHtml(mapLink)}</a></div>
      ${(controllerLetter || zoneNumber != null) ? `<div><span class="lbl">Controller / Zone:</span> ${controllerLetter ? `Controller ${escapeHtml(controllerLetter)}` : ''}${controllerLetter && zoneNumber != null ? ' · ' : ''}${zoneNumber != null ? `Zone ${escapeHtml(zoneNumber)}` : ''}</div>` : ''}
    </section>` : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Estimate ${escapeHtml(estimate.estimateNumber)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color: #1f2937; margin: 0; padding: 24px; font-size: 12px; }
  h1 { font-size: 22px; margin: 0 0 4px 0; }
  h2 { font-size: 14px; margin: 0 0 8px 0; color: #374151; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
  .header .muted { color: #6b7280; font-size: 11px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  .card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; margin-bottom: 12px; }
  .lbl { color: #6b7280; font-weight: 600; }
  .muted { color: #6b7280; font-size: 11px; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; color: #4b5563; }
  td.r, th.r { text-align: right; }
  td.b { font-weight: 600; }
  .total { background: #1f2937; color: white; padding: 12px 16px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; margin-top: 12px; }
  .total .label { font-size: 12px; opacity: .9; }
  .total .amount { font-size: 22px; font-weight: 700; }
  a { color: #2563eb; text-decoration: underline; word-break: break-all; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Estimate ${escapeHtml(estimate.estimateNumber)}</h1>
      <div class="muted">${escapeHtml(estimate.projectName)}</div>
    </div>
    <div class="muted" style="text-align:right;">
      <div>Date: ${escapeHtml(fmtDate(estimate.estimateDate))}</div>
      ${estimate.createdBy ? `<div>Prepared by: ${escapeHtml(estimate.createdBy)}</div>` : ''}
    </div>
  </div>

  <div class="grid">
    <section class="card">
      <h2>Customer</h2>
      <div>${escapeHtml(estimate.customerName)}</div>
      ${estimate.customerEmail ? `<div class="muted">${escapeHtml(estimate.customerEmail)}</div>` : ''}
      ${estimate.customerPhone ? `<div class="muted">${escapeHtml(estimate.customerPhone)}</div>` : ''}
    </section>
    <section class="card">
      <h2>Project</h2>
      ${estimate.projectAddress ? `<div><span class="lbl">Address:</span> ${escapeHtml(estimate.projectAddress)}</div>` : ''}
      ${estimate.locationNotes ? `<div style="margin-top:6px;"><span class="lbl">Location notes:</span> ${escapeHtml(estimate.locationNotes)}</div>` : ''}
      ${estimate.accessInstructions ? `<div style="margin-top:6px;"><span class="lbl">Access:</span> ${escapeHtml(estimate.accessInstructions)}</div>` : ''}
    </section>
  </div>

  ${pinSection}

  <section class="card">
    <h2>Line Items</h2>
    <table>
      <thead>
        <tr>
          <th>Part / Description</th>
          <th class="r">Qty</th>
          <th class="r">Unit</th>
          <th class="r">Labor</th>
          <th class="r">Line Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsRows || `<tr><td colspan="5" class="muted">No line items</td></tr>`}
      </tbody>
    </table>
    <div class="total">
      <span class="label">Total Estimate</span>
      <span class="amount">${fmtMoney(estimate.totalAmount)}</span>
    </div>
  </section>
</body>
</html>`;
}

export async function renderEstimatePdf(estimate: EstimateWithItems): Promise<Buffer> {
  const html = buildEstimateHtml(estimate);
  const chromiumPath = getChromiumPath();
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromiumPath || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
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
