# PDF Generation Pipeline Audit

**Date:** 2026-04-01  
**Scope:** Monthly invoice detail PDF pipeline — data flow, root cause analysis, and remediation recommendations  
**Status:** Audit only — no code was changed

---

## 1. Full Data Flow

### Entry Point — HTTP Endpoint

```
GET /api/invoices/:invoiceId/pdf/download
```

**File:** `server/routes.ts` (line 6341)  
**Auth middleware:** `requireAuthentication` → `requireBillingAccess`  
Only `company_admin` and `billing_manager` roles may access this route.

The handler instantiates `InvoicePdfService` and calls `generatePdfBuffer(invoiceId)`, then streams the resulting buffer directly to the response with `Content-Type: application/pdf`.

A second endpoint, `GET /api/invoices/:invoiceId/pdf` (line 6300), follows the same path but returns PDF metadata (the `invoicePdfs` record) instead of the binary. It also auto-generates the PDF on first access if no `invoicePdfs` record exists.

---

### Stage 1 — `InvoicePdfService.generatePdfBuffer(invoiceId)`

**File:** `server/invoice-pdf-service.ts`

Steps performed in order:

1. `storage.getInvoiceById(invoiceId)` — returns `InvoiceWithItems` (the `invoices` row joined with its `invoiceItems` rows).
2. `storage.getCustomerById(invoice.customerId)` — returns the `customers` row; `customer.laborRate` is used as the billable labor rate (falls back to `'45.00'` if null).
3. `storage.getCompany(customer.companyId)` — returns the `companies` row, including `company.logo`.
4. For each `invoiceItem` in `invoice.items`:
   - If `sourceType === 'work_order'` and `workOrderId` is set:
     - `storage.getWorkOrder(workOrderId)` — fetches the full `workOrders` row.
     - `storage.getWorkOrderItems(workOrder.id)` — issues a dedicated `SELECT` against the `work_order_items` table to fetch line items from the DB.
   - If `sourceType === 'billing_sheet'` and `billingSheetId` is set:
     - `storage.getBillingSheetById(billingSheetId)` — issues two DB queries: one `SELECT` on `billing_sheets` and a second `SELECT` on `billing_sheet_items` where `billing_sheet_id = id` (storage.ts lines 1916–1921). Returns the combined `BillingSheetWithItems` object.
     - Items are taken from `billingSheet.items || []` — the array populated by the second DB query above.
5. Calls `PDFGenerator.generateInvoiceDetailPDF(data)` with the assembled payload.

---

### Stage 2 — `PDFGenerator.generateInvoiceDetailPDF(data)`

**File:** `server/pdf-generator.ts` (line 107)

1. Launches a headless Chromium browser via Puppeteer (path resolved via `which chromium`; fallback to bundled Chrome).
2. Calls `this.generateInvoiceDetailHTML(data)` to produce an HTML string.
3. Calls `page.setContent(htmlContent, { waitUntil: 'networkidle0' })` — **no base URL is set**.
4. Calls `page.pdf({ format: 'A4', printBackground: true, margin: … })`.
5. Returns the resulting buffer.

---

## 2. Total Calculation Issues

### 2.1 Work Order Totals

The PDF reads these DB columns from `workOrders`:

| DB Field | Schema Type | Used In PDF |
|---|---|---|
| `totalPartsCost` | `decimal(10,2)` nullable | Parts Subtotal row |
| `laborSubtotal` | `decimal(10,2)` nullable | Labor Subtotal row (with fallback) |
| `totalAmount` | `decimal(10,2)` default `0.00` | Work Order Total row |
| `totalHours` | `decimal(5,2)` nullable | Displayed in detail row |
| `laborRate` | `decimal(10,2)` nullable | Displayed in detail row |

**Labor subtotal fallback chain (pdf-generator.ts line 611):**

```javascript
wo.workOrder.laborSubtotal || (parseFloat(wo.workOrder.totalHours || '0') * laborRateNum).toFixed(2)
```

`laborRateNum` is `parseFloat(passedLaborRate || '45.00')` where `passedLaborRate` is `customer.laborRate`.

**Root cause of mismatch:**  
When a work order is completed via `POST /api/work-orders/complete` (routes.ts line 5876), the `laborRate` used to compute totals is **hard-coded to `45`** (line 5897), regardless of the customer's contract rate (`customer.laborRate`). The `workOrders.laborRate` column is never written during completion. So:

- `workOrders.laborSubtotal` is never updated during completion — for direct (non-estimate-based) work orders it remains `null`; for estimate-based work orders it retains the estimate-time snapshot value (which reflects estimated hours, not actual hours worked).
- The PDF falls back to `totalHours * laborRateNum` (using the customer's labor rate retrieved in `InvoicePdfService`) when `laborSubtotal` is falsy — a different value than the rate used in the actual completion calculation.
- `workOrders.totalAmount` is computed during completion using a hard-coded `laborRate = 45`, but the PDF fallback may display `totalHours × customer.laborRate` which can differ if the customer's rate ≠ 45.

Additionally, `workOrders.partsSubtotal` is not written during completion. It may be pre-populated at creation time for estimate-based work orders (copied from the estimate snapshot), but it is never updated during completion to reflect the actual parts consumed. The PDF reads `totalPartsCost` for the parts subtotal (which is written during completion), while `partsSubtotal` may hold a stale estimate-time value.

**Summary table for work orders:**

| Issue | Source column | Notes |
|---|---|---|
| `laborRate` on WO | `work_orders.labor_rate` | Pre-populated from estimate snapshot for estimate-based WOs via `createWorkOrderFromEstimate`; **not written during completion** — remains at estimate value (or `null` for direct WOs) |
| `laborSubtotal` on WO | `work_orders.labor_subtotal` | Pre-populated from estimate snapshot for estimate-based WOs; **not written during completion** — never updated to reflect actual hours |
| `partsSubtotal` on WO | `work_orders.parts_subtotal` | Pre-populated from estimate snapshot for estimate-based WOs; **not written during completion** — never updated to reflect actual parts used |
| `totalPartsCost` on WO | `work_orders.total_parts_cost` | Written during completion |
| `totalAmount` on WO | `work_orders.total_amount` | Written during completion, but calculated with hard-coded `laborRate = 45` |

### 2.2 Billing Sheet Totals

The PDF reads these DB columns from `billingSheets`:

| DB Field | Schema Type | Populated? |
|---|---|---|
| `partsSubtotal` | `decimal(10,2)` | Yes — written at creation/update |
| `laborSubtotal` | `decimal(10,2)` | Yes — written at creation/update |
| `totalAmount` | `decimal(10,2)` | Yes — written at creation/update |
| `laborRate` | `decimal(10,2)` | Yes — written at creation |
| `totalHours` | `decimal(5,2)` | Yes — written at creation |

The PDF total for billing sheets falls back at line 720:

```javascript
bs.billingSheet.totalAmount || parseFloat(bs.billingSheet.partsSubtotal || '0') + parseFloat(bs.billingSheet.laborSubtotal || '0')
```

Billing sheet totals are generally reliable because they are pre-computed and stored at creation time. However, the `laborRate` stored on the billing sheet is captured at creation and may differ from `customer.laborRate` if the rate was changed afterward. The PDF displays `bs.billingSheet.laborRate` directly (line 655), so the displayed rate is at least internally consistent with the stored totals for billing sheets.

### 2.3 Invoice-Level Grand Totals

The PDF's grand total section always reads from:

```javascript
invoice.partsSubtotal
invoice.laborSubtotal
invoice.totalAmount
```

These are pre-stored on the `invoices` row when the invoice is created and are **not recalculated from work order or billing sheet data at PDF generation time**. If individual work order or billing sheet amounts have been edited after the invoice was generated, these invoice-level totals can be stale.

---

## 3. Logo Loading Root Cause

### 3.1 How `company.logo` is Stored

When a company admin uploads a logo:

1. `POST /api/company/logo/upload` → `ObjectStorageService.getCompanyLogoUploadURL()` returns a signed PUT URL pointing at Google Cloud Storage.
2. The client uploads the file directly to GCS.
3. `PUT /api/company/:companyId/logo` is called with the GCS URL. The handler calls `objectStorageService.normalizeLogoPath(logoUrl)`, which strips the `https://storage.googleapis.com/...` prefix and returns only the UUID filename (e.g., `"abc123-uuid"`). It then calls `getCompanyLogoPublicURL(logoPath)` which constructs a URL like `https://irrigopro.com/api/public-objects/company-logos/abc123-uuid`.
4. This **absolute** URL is stored in `companies.logo`.

**`normalizeLogoPath` is conditional on input format.** It only strips GCS URLs (those starting with `https://storage.googleapis.com/`). If a non-GCS absolute URL (e.g., an existing `https://` URL) is submitted, `normalizeLogoPath` returns it unchanged, and then `getCompanyLogoPublicURL` passes it through unchanged (line 146: `if (logoPath.startsWith('http')) return logoPath`). So `companies.logo` may hold either a full GCS-derived app URL, a full non-GCS absolute URL, or (if a bare path was submitted) the bare path itself.

When updated via `PUT /api/company/:companyId/profile` (line 716), `normalizeLogoPath(updates.logo)` is called but the result is stored **directly** without calling `getCompanyLogoPublicURL`. If the submitted value was a GCS URL, only the UUID filename is stored. If a non-GCS URL or bare value was submitted, that value is stored as-is.

In short: **the value stored in `companies.logo` depends on which update path was used and what was submitted**.

### 3.2 Logo-Serving Route vs. URL Builders

There is a meaningful inconsistency in how different parts of the codebase construct logo URLs:

| Code location | URL pattern generated |
|---|---|
| Actual serving route (`routes.ts` line 558) | `GET /api/company-logo/:logoId` |
| `ObjectStorageService.getCompanyLogoPublicURL` (`objectStorage.ts` line 155) | `/api/public-objects/company-logos/<uuid>` |
| `EmailService.getCompanyLogoUrl` (`email-service.ts` line 104) | `/public-objects/company-logos/<logoPath>` (no `/api/` prefix) |

The route that actually exists and serves logo images is `/api/company-logo/:logoId`. Neither `getCompanyLogoPublicURL` nor `EmailService.getCompanyLogoUrl` generates URLs that match this route. URLs constructed by these helpers (`/api/public-objects/...` or `/public-objects/...`) would 404 unless there is a separate static-file handler or proxy not visible in `routes.ts` that maps those paths.

### 3.3 How `InvoicePdfService` Passes the Logo

`InvoicePdfService` reads `company.logo` and passes it directly, without any normalization:

```typescript
company: {
  logo: company.logo || undefined,
  ...
}
```

`PDFGenerator` then emits:

```html
<img src="${company.logo}" class="company-logo" ...>
```

**Root cause analysis:**

| Scenario | Value in `company.logo` | What Puppeteer sees | Result |
|---|---|---|---|
| Uploaded via `/api/company/logo/upload` + `/api/company/:companyId/logo` | Full URL: `https://irrigopro.com/api/public-objects/company-logos/<uuid>` | Absolute URL — Puppeteer makes HTTP request | Would 404 unless a route serves this path |
| Updated via `/api/company/:companyId/profile` with a GCS URL submitted | Bare UUID (`abc123-uuid`) | Relative path — no base URL in `setContent` | Broken image |
| Updated via `/api/company/:companyId/profile` with a non-GCS absolute URL | The submitted URL unchanged | Absolute URL | May work if URL is accessible without auth |
| Logo stored via `/api/company/:companyId/logo` with a path that begins with `http` | The submitted URL unchanged | Absolute URL | May work if URL is accessible without auth |

Additionally, since Puppeteer launches with `--no-sandbox` and no cookies/session headers, any URL requiring session authentication will return a 401 and the image will be broken.

**The `EmailService.getCompanyLogoUrl` normalization pattern is entirely absent from `InvoicePdfService` and `PDFGenerator`.** Even if applied, the URL it produces (`/public-objects/...`) does not match the actual serving route (`/api/company-logo/:id`).

---

## 4. Photo Rendering Root Cause

### 4.1 How Photos are Stored

**Work order photos** (`workOrders.photos: text[].default([])`) are populated in two ways:

1. Uploaded via `POST /api/upload/photo` (routes.ts line 6927) — saves to `./uploads/` directory, returns `url: /uploads/<filename>`. This is a **server-local relative path**.
2. The completion route (`POST /api/work-orders/complete`) merges creation-time and completion-time photo arrays as-is from the request body — whatever URL strings were submitted are stored directly.

**Billing sheet photos** (`billingSheets.photos: text[].default([])`) follow the same pattern — stored as whatever URL strings are passed during creation/update, typically `/uploads/<filename>` relative paths from the photo upload route.

### 4.2 Why Photos Break in the PDF

Puppeteer is invoked via `page.setContent(htmlContent, { waitUntil: 'networkidle0' })`. When `setContent` is used (as opposed to `page.goto`), Puppeteer has **no base URL context**. Relative paths like `/uploads/photo_123.jpg` cannot be resolved because:

- There is no `<base href="...">` tag in the generated HTML.
- `page.setContent` is not passed a `baseURL` option in this code.
- Puppeteer therefore cannot make an HTTP request for the image.

Even if a base URL were provided, Puppeteer would need to make a network request back to the application server to load `/uploads/<filename>`. The `/uploads` path is served via `express.static('./uploads')` (routes.ts line 6970), so it would work if Puppeteer can reach the local server. However, files stored in `./uploads/` on the local filesystem are not persisted to cloud storage and are inaccessible if the process restarts or if production runs in a different container.

**Summary of photo root causes:**

| Root cause | Description |
|---|---|
| Relative paths + `setContent` | `/uploads/photo.jpg` paths have no base URL; Puppeteer cannot resolve them |
| No `<base>` tag | HTML does not include `<base href="...">` to anchor relative references |
| Local `./uploads/` storage | Photos are stored on the Node.js process filesystem; inaccessible if the process restarts or runs in a different environment |
| No base64 embed | Photos are referenced by path only, not fetched and embedded as data URIs |

---

## 5. Page Break Failure Root Cause

### 5.1 Current Strategy

The CSS applied to `.work-order-section` (which wraps both work order and billing sheet blocks) is:

```css
/* In <style> block, always applied: */
.work-order-section {
  margin-bottom: 40px;
  page-break-inside: avoid;
}

/* In @media print block (redundant): */
@media print {
  .work-order-section {
    page-break-inside: avoid;
  }
}
```

A `.page-break` class is defined with `page-break-after: always` but **it is never instantiated in the generated HTML**.

### 5.2 Why `page-break-inside: avoid` Fails for Long Sections

`page-break-inside: avoid` (and its modern equivalent `break-inside: avoid`) is a hint to the browser/rendering engine to **not break the element across pages if possible**. Chromium (Puppeteer) respects this hint only when the element fits on a single remaining page. When a `.work-order-section` element is taller than one A4 page (e.g., a work order with many line items or multiple photos), the rendering engine has no choice but to break inside the element — it cannot shrink content to fit.

**Specific failure modes:**

1. **Long item tables** — a work order with 20+ line items will be taller than an A4 page. `page-break-inside: avoid` is ignored and the table breaks at an arbitrary row.
2. **Photo grids** — a 3-column photo grid for a section with 12+ photos expands the section beyond one page. Same result.
3. **No explicit breaks between sections** — there is no `page-break-before: always` or `page-break-after: always` between work order and billing sheet sections. Sections flow continuously and may break mid-header or mid-table.
4. **Duplicate declaration** — `page-break-inside: avoid` is declared both in the global style block and the `@media print` block. Puppeteer uses the print media type, so the `@media print` block applies, but this is redundant rather than harmful.

---

## 6. Recommended Implementation Path

The following changes are listed in priority order, from highest impact to lowest. Each addresses a specific root cause identified above.

---

### Priority 1 — Fix Photo Rendering (Blocker)

**Problem:** Relative `/uploads/` paths break completely under `setContent` with no base URL.

**Recommended fix:**  
At PDF generation time, convert each photo URL to a base64-encoded data URI before embedding it in the HTML. For local `/uploads/` paths, read the file from disk with `fs.readFileSync` and encode as `data:image/jpeg;base64,...`. For absolute URLs, fetch the bytes and encode them similarly.

This makes the HTML fully self-contained; Puppeteer makes no external network requests for images.

As a parallel improvement, migrate photo storage from `./uploads/` local disk to the cloud object storage service (the `ObjectStorageService` pattern already in use for logos), so photos are durably stored and accessible by URL across deployments.

---

### Priority 2 — Fix Logo Loading (High Impact)

**Problem:** `company.logo` may contain a bare UUID, a non-GCS absolute URL, a GCS-derived app URL, or something else depending on the update path and submitted value. The URL stored or constructed does not consistently match the actual logo-serving route (`GET /api/company-logo/:logoId`). No normalization is applied in the PDF path.

**Recommended fixes:**

1. **Standardize storage.** Always store only the UUID filename in `companies.logo` regardless of which update path is used. Both `PUT /api/company/:companyId/logo` and `PUT /api/company/:companyId/profile` should store the UUID, not a constructed URL.

2. **Fix the URL builder discrepancy.** `ObjectStorageService.getCompanyLogoPublicURL` emits `/api/public-objects/company-logos/<uuid>` and `EmailService.getCompanyLogoUrl` emits `/public-objects/company-logos/<path>`, but neither matches the actual route at `/api/company-logo/:logoId`. Update one of the helpers (or add a route alias) to ensure URL construction and URL serving are in sync.

3. **Add normalization in `InvoicePdfService`.** Before passing `company.logo` to `PDFGenerator`, resolve the stored value to a fetchable absolute URL using the correct pattern (matching the actual serving route):

   ```typescript
   function resolveLogoUrl(logoPath: string | null | undefined): string | undefined {
     if (!logoPath) return undefined;
     if (logoPath.startsWith('http')) return logoPath;
     // Bare UUID — construct URL using the actual serving route
     const baseUrl = process.env.APP_BASE_URL || 'https://irrigopro.com';
     return `${baseUrl}/api/company-logo/${logoPath}`;
   }
   ```

4. **For maximum reliability**, embed the logo as a base64 data URI (fetch it server-side before HTML generation) so Puppeteer needs no network requests.

---

### Priority 3 — Fix Work Order Total Calculation (High Impact)

**Problem:** `workOrders.laborSubtotal` and `workOrders.laborRate` are `null` for work orders completed via the current completion route, because a hard-coded `laborRate = 45` is used without writing it back to the record. The PDF fallback uses `customer.laborRate`, which may differ.

**Recommended fix:**  
In `POST /api/work-orders/complete`, replace the hard-coded `const laborRate = 45` with the customer's actual contract rate:

```typescript
const workOrder = await storage.getWorkOrder(workOrderId);
const customer = await storage.getCustomerById(workOrder.customerId);
const laborRate = parseFloat(customer?.laborRate || '45.00');
```

Store the computed values back to the work order record:

```typescript
await storage.updateWorkOrder(workOrderId, {
  laborRate: laborRate.toString(),
  laborSubtotal: laborSubtotal.toFixed(2),
  partsSubtotal: partsCost.toFixed(2),
  ...
});
```

The PDF generator's fallback chain can remain for backwards compatibility with pre-existing records, but going forward there will be correct stored values to display.

---

### Priority 4 — Fix Page Breaks (Medium Impact)

**Problem:** `page-break-inside: avoid` is ignored when sections exceed one page height; no explicit breaks between sections.

**Recommended approach:**

1. **Add explicit breaks between sections.** Insert `page-break-before: always` on each work order and billing sheet section after the first (i.e., skip the break before the very first section).

2. **Split long tables across pages gracefully.** Apply `page-break-inside: avoid` to `<tr>` elements rather than the entire table wrapper, allowing the table to break between rows instead of mid-row:
   ```css
   .items-table tr {
     page-break-inside: avoid;
   }
   ```

3. **Handle photo grids.** Apply `page-break-inside: avoid` to each individual photo wrapper, or reduce the photo grid to 2 columns so each row is less likely to exceed a page.

4. **Remove redundant `@media print` block.** The block duplicates the global declaration. Consolidate into one location.

---

### Priority 5 — Audit Invoice-Level Grand Totals (Low Impact)

**Problem:** `invoice.partsSubtotal`, `invoice.laborSubtotal`, and `invoice.totalAmount` are pre-stored snapshots and are not recomputed from source data at PDF generation time.

**Recommended fix:**  
When regenerating a PDF (`POST /api/invoices/:invoiceId/pdf/regenerate`), re-sum the work order and billing sheet totals and update the invoice record before generating the PDF. Alternatively, compute the live sum of individual section totals directly in the PDF generator and display that alongside or instead of the stored invoice total.

---

## Summary Reference Table

| Issue | Root Cause File(s) | Root Cause Description | Recommended Fix |
|---|---|---|---|
| Broken photo links | `routes.ts`, `pdf-generator.ts` | Relative `/uploads/` paths + `setContent` without base URL; no `<base>` tag; local file storage | Embed photos as base64 data URIs; migrate uploads to cloud storage |
| Logo loading failures | `invoice-pdf-service.ts`, `objectStorage.ts`, `email-service.ts`, `routes.ts` | `company.logo` stored inconsistently; URL builders generate paths that don't match the actual serving route (`/api/company-logo/:id`); no normalization in PDF path | Standardize storage to UUID; fix URL builder/route mismatch; add normalization in `InvoicePdfService`; embed as base64 |
| Incorrect WO labor totals | `routes.ts` (completion route) | Hard-coded `laborRate=45`; `laborRate`, `laborSubtotal`, `partsSubtotal` columns never written on WO completion | Write correct values using `customer.laborRate` during completion |
| Page breaks inside sections | `pdf-generator.ts` | `page-break-inside: avoid` ignored when content exceeds one page; no explicit breaks between sections | Add `page-break-before: always` between sections; apply row-level avoid on `<tr>`; remove duplicate `@media print` declaration |
| Stale invoice grand totals | `invoice-pdf-service.ts`, `pdf-generator.ts` | Grand totals read from pre-stored `invoices` columns, not recomputed from line items | Re-sum from source data at PDF regeneration time |
