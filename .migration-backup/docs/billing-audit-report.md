# Billing Integrity Audit Report

**Date:** April 3, 2026  
**Scope:** End-to-end forensic audit of the billing data path following Tasks #88–#91  
**Auditor:** Engineering (automated code-path analysis + scenario walkthrough)

---

## Executive Summary

The prior failure mode — stored work-order totals were discarded and rebuilt downstream from hardcoded rates (labor × hours, zero markup, zero tax) — has been substantially eliminated from the primary billing path. The financial snapshot infrastructure introduced in Tasks #88–#91 is correctly placed and enforced for all new work orders completed via the standard `/api/work-orders/complete` endpoint.

However, **three significant defects were found** that prevent full production clearance, and one legacy code path contains the original stripped-formula pattern that has not been removed. Details follow in each phase below.

**Final verdict: SAFE WITH EXCEPTIONS** — production use is acceptable for the primary work-order path, but the three defects below must be remediated before the system can be trusted without manual reconciliation.

---

## Phase 1 — Code-Path Audit

### 1.1 Financial Write Paths

| Field | Written by | Endpoint / Handler |
|---|---|---|
| `totalHours` | Field tech at completion | `POST /api/work-orders/complete` (routes.ts:6171) |
| `totalPartsCost` | Field tech at completion | `POST /api/work-orders/complete` (routes.ts:6173) |
| `laborSubtotal` | Completion handler, then PATCH recompute | `POST /api/work-orders/complete` (routes.ts:6174); `PATCH /api/work-orders/:id` recompute block (routes.ts:7066–7078) |
| `partsSubtotal` | Same as laborSubtotal | Same |
| `markupAmount` | Same as laborSubtotal | Same |
| `taxAmount` | Same as laborSubtotal | Same |
| `totalAmount` | Same as laborSubtotal | Same; also set in `POST /api/work-orders/:id/complete` (routes.ts:6289) |
| `appliedLaborRate` | Completion only (snapshotted) | `POST /api/work-orders/complete` (routes.ts:6180); `POST /api/work-orders/:id/complete` (routes.ts:6290) |
| `appliedMarkupRate` | Completion only (snapshotted) | Same as appliedLaborRate |
| `appliedTaxRate` | Completion only (snapshotted) | Same as appliedLaborRate |
| `laborRate` (legacy alias) | Completion only | `POST /api/work-orders/complete` (routes.ts:6179) |
| `invoiceId` | Invoice creation | `POST /api/invoices/monthly` (routes.ts:2714); reconciliation loop (routes.ts:2738) |
| `billedAt` | Invoice creation | Same |
| `status → billed` | Invoice creation (after QB success) | `POST /api/invoices/monthly` (routes.ts:2717, 2724) |
| `billingSheet.totalHours` | Sheet creation; PATCH edit | `POST /api/billing-sheets` (routes.ts:6401–6424); `PATCH /api/billing-sheets/:id` (routes.ts:6547) |
| `billingSheet.laborSubtotal` | Same | Same — computed as `totalHours × laborRate` at write time |
| `billingSheet.partsSubtotal` | Same | Same |
| `billingSheet.markupAmount` | Sheet creation only (legacy path) | `POST /api/work-orders/:id/billing-sheet` hardcodes `"0"` (routes.ts:7411) |
| `billingSheet.taxAmount` | Sheet creation only (legacy path) | `POST /api/work-orders/:id/billing-sheet` hardcodes `(labor+parts) × 0.0825` (routes.ts:7330) |
| `billingSheet.totalAmount` | Same | Same |
| `billingSheet.invoiceId` | Invoice creation | `POST /api/invoices/monthly` (routes.ts:2723) |
| `billingSheet.billedAt` | Invoice creation | Same (routes.ts:2724) |
| `billingSheet.status → billed` | Invoice creation | Same (routes.ts:2725) |

**Approval stamp fields (`approvedBy`, `approvedAt`, `approvedTotal`, `approvedPartsSnapshot`, `approvedLaborSnapshot`):**  
These fields exist on Estimates (routes.ts:5556 `approvedAt`; 5608 `approvedAt`) but **do not exist on the workOrders or billingSheets tables** in `shared/schema.ts`. The irrigation manager approval gate referenced in Task #91 is implemented as a status transition to `approved` via `PATCH /api/billing-sheets/:id` with `{ status: 'approved' }`, not as a dedicated stamp block. There are no `approvedBy`, `approvedTotal`, `approvedPartsSnapshot`, or `approvedLaborSnapshot` columns on work orders or billing sheets.

### 1.2 Financial Read Paths

| Frontend Screen | Fields Read | Source |
|---|---|---|
| Work Order Details (`work-order-details.tsx`) | `status`, `totalHours`, `totalPartsCost`, `photos`, `assignedTechnicianName` | `GET /api/work-orders` → `workOrders` table |
| Work Order Completion (`work-order-completion.tsx`) | Customer rates fetched live for display only; actual snapshot computed server-side at submit | `GET /api/customers/:id` (display); snapshot computed in `POST /api/work-orders/complete` |
| Billing Sheet List (`billing-sheets.tsx`) | `totalAmount`, `totalHours`, `status`, `billingNumber` | `GET /api/billing-sheets` → `billingSheets` table |
| Customer Billing (`customer-billing.tsx`) | `laborCost`, `partsCost`, `totalAmount`, `hasFinancialBreakdown` | `GET /api/customers/:id/billing` — uses stored `laborSubtotal`, `partsSubtotal`, `totalAmount` |
| Billing Preview | `laborSubtotal`, `partsSubtotal`, `markupAmount`, `taxAmount`, `totalAmount` per WO/BS | `POST /api/invoices/preview` — reads stored fields directly |
| Invoice Preview Modal | Same as billing preview | Preview payload from `/api/invoices/preview` |
| Invoice Record | `partsSubtotal`, `laborSubtotal`, `markupAmount`, `taxAmount`, `totalAmount` | `invoices` table — aggregated from stored per-WO/BS values |
| Invoice PDF | `partsSubtotal`, `laborSubtotal`, `totalAmount` from each WO/BS; `totalAmount` from invoice | `server/invoice-pdf-service.ts` → `pdf-view-model.ts` reads stored fields |
| QuickBooks Payload | `totalAmount` (per WO), `laborSubtotal + partsSubtotal` (per BS) | `POST /api/invoices/monthly` (routes.ts:2592–2627) |

All read paths use stored values as the source of truth. **The old discarding pattern (reading live customer rates to rebuild totals) is absent from all read paths.**

### 1.3 Legacy Stripped-Formula Code

**DEFECT D-1 (HIGH): `POST /api/work-orders/:id/billing-sheet` uses hardcoded/stripped formula**

File: `server/routes.ts`, lines 7326–7331, 7410–7411

```
const laborRateVal = formLaborRate || "45.00";         // ← falls back to hardcoded 45
const taxAmount = ((labor + parts) * 0.0825).toFixed(2); // ← hardcoded 8.25% tax
markupAmount: "0",                                      // ← always zero markup
```

This endpoint (`POST /api/work-orders/:id/billing-sheet`) is the conversion path that takes a completed work order and creates a billing sheet from it. It does **not** read `appliedLaborRate`, `appliedMarkupRate`, or `appliedTaxRate` from the work order. Instead it:
- Uses a caller-supplied `laborRate` or falls back to `"45.00"`
- Hardcodes markup to `"0"`
- Hardcodes tax at 8.25% regardless of the customer's actual `taxPercent`

This is the original failure pattern and it survives in this secondary endpoint. Any work order converted to a billing sheet through this path will have incorrect financials for customers whose rates differ from these defaults.

**Severity: HIGH** — Any workflow that routes through this endpoint produces incorrect billing data.

**No other instances of the stripped formula were found in the primary billing paths.** The main completion endpoint (`POST /api/work-orders/complete`) and the PATCH recompute path both correctly read from `appliedLaborRate`, `appliedMarkupRate`, and `appliedTaxRate`.

### 1.4 Phase 1 Summary

- **Write paths:** Correctly implemented for work order completion. Billing sheet edits do not have a snapshot mechanism (labor rate is editable at any time before billing lock).
- **Read paths:** All read stored values. No live-rate recalculation on reads.
- **Approval/lock paths:** Lock enforced at API level (`invoiceId != null || status === 'billed'`) on both `PATCH /api/work-orders/:id` and `PATCH /api/billing-sheets/:id`.
- **Legacy formula code:** Present in `POST /api/work-orders/:id/billing-sheet` (Defect D-1).
- **Verdict:** One significant legacy code path survives.

---

## Phase 2 — Canonical End-to-End Scenarios

### Scenario A — Standard Work Order Happy Path

**Trace (code-path):**

1. **Field completion:** `POST /api/work-orders/complete` reads customer's `laborRate`, `markupPercent`, `taxPercent` and stores them as `appliedLaborRate`, `appliedMarkupRate`, `appliedTaxRate`. Calculates and stores all financial breakdown fields.  
   → **PASS** (rates correctly snapshotted at completion)

2. **Manager review:** `PATCH /api/work-orders/:id` with `status: 'completed'` or edits to `totalHours`/items. The PATCH handler strips `appliedLaborRate`, `appliedMarkupRate`, `appliedTaxRate` from the body, reads the stored snapshot, and recomputes totals using snapshot rates.  
   → **PASS** (snapshot preserved through manager edits)

3. **Irrigation manager approval:** `PATCH /api/work-orders/:id` with `status: 'approved'`. No dedicated approval endpoint for work orders — approval is a status change. No `approvedBy`/`approvedAt`/`approvedTotal` stamp is written to work orders because those columns do not exist.  
   → **FAIL (Defect D-2):** Approval stamps do not exist on work orders. There is no forensic record of who approved, when, and at what total. This is a known gap from the schema.

4. **Billing manager intake:** `GET /api/customers/:id/billing` returns work orders with `status === 'completed'` and `!invoiceId`. Items with `status: 'approved'` on work orders are not filtered separately — billing manager sees all completed, unbilled work orders.  
   → **CONDITIONAL PASS** — approved work orders are visible in the billing queue. However, since `approved` is not a valid status in the work order lifecycle (schema shows: `pending, assigned, in_progress, completed, cancelled, billed`), approval in practice means the irrigation manager set status to `completed`. The concept of an intermediate `approved` state for work orders is not implemented.

5. **Invoice preview:** `POST /api/invoices/preview` reads `laborSubtotal`, `partsSubtotal`, `markupAmount`, `taxAmount`, `totalAmount` from stored work order.  
   → **PASS** (reads stored values)

6. **Final invoice:** `POST /api/invoices/monthly` aggregates stored values per WO, writes invoice record, creates invoice items with stored rates.  
   → **PASS** (reads stored values; QB payload uses `totalAmount` as authoritative)

7. **QuickBooks payload:** `Amount: totalLineAmount` (stored `totalAmount`); description includes `appliedLaborRate`.  
   → **PASS** (stored values used)

8. **Billed state and lock:** After QB success, `status: 'billed'`, `invoiceId`, `billedAt` written. Lock enforced on all subsequent PATCH attempts.  
   → **PASS**

**Scenario A overall: PASS with noted gap on approval stamp fields.**

### Scenario B — Billing Sheet Happy Path

**Trace (code-path):**

1. **Creation:** `POST /api/billing-sheets` — billing sheet created with `laborRate`, `laborSubtotal`, `partsSubtotal`, `markupAmount`, `taxAmount`, `totalAmount` supplied by caller. No automatic snapshot from customer record.  
   → **CONDITIONAL PASS** — totals are stored as supplied. Caller is responsible for computing them correctly at creation time. The standalone billing sheet creation form (StandaloneBillingSheet) calculates based on the selected customer's rates; however this is UI-computed, not server-validated against the customer record.

2. **Manager review and approval:** `PATCH /api/billing-sheets/:id` with `status: 'approved'`. Billed lock checked. Financial fields are accepted from the PATCH body (including `totalAmount`, `laborSubtotal`, etc.) — they are not stripped like work order financial fields are.  
   → **DEFECT D-3 (MEDIUM):** The billing sheet PATCH handler does NOT strip financial snapshot fields the way the work order PATCH handler does. A manager can directly overwrite `totalAmount`, `laborSubtotal`, `partsSubtotal`, `markupAmount`, `taxAmount` via PATCH before invoicing. The work order path strips these (routes.ts:7001–7012); the billing sheet path does not (routes.ts:6557 takes `...billingSheetData` directly).

3. **Invoice preview and creation:** Same as Scenario A — reads stored values.  
   → **PASS**

4. **Billed state and lock:** Same as Scenario A.  
   → **PASS**

**Scenario B overall: CONDITIONAL PASS — billing sheet PATCH has no financial field protection (D-3).**

---

## Phase 3 — Financial Correctness Variations

### Scenario C — Different Customer Contract Rates

- At completion time, `customerForRates?.laborRate`, `markupPercent`, `taxPercent` are fetched from the customer record and stored as `appliedLaborRate`, `appliedMarkupRate`, `appliedTaxRate`.
- Each work order stores its own snapshot independently.
- No mechanism exists to cross-contaminate one customer's rates with another's, since rates are read per-`customerId` from the work order.
- **PASS** — customer-specific rates correctly isolated per work order.

### Scenario D — Rate Change After Field Completion (Critical)

- At `POST /api/work-orders/complete`: rates are read from the customer record and stored in `appliedLaborRate/Rate/Rate`.
- All subsequent PATCH recomputes use the stored `appliedLaborRate` (routes.ts:7056–7080): `"Use the work order's own snapshotted rates — never the live customer record."` Comment confirms this is intentional.
- Invoice preview and monthly invoice creation read `appliedLaborRate` from the work order, not from the customer.
- **PASS** — rate change after completion does not affect the work order's financials. Snapshot is preserved end-to-end.

### Scenario E — Manager Edits Before Approval

- Manager sends `PATCH /api/work-orders/:id` with new `totalHours` or modified items.
- Handler strips `appliedLaborRate`, `appliedMarkupRate`, `appliedTaxRate` from the body (routes.ts:7003–7006).
- If `totalHours` or items are touched, recompute occurs using stored `appliedLaborRate` (routes.ts:7056–7079).
- **PASS** — manager edits recompute from stored snapshot, never from live customer rates.

### Scenario F — Return for Correction

- No dedicated "return for correction" state or endpoint exists for work orders.
- For billing sheets: a billing manager can `PATCH` status back to `submitted` or `draft` while it is not billed.
- Field workers cannot re-enter billing sheets once submitted; only managers can revert.
- **NOT IMPLEMENTED AS A DEDICATED WORKFLOW** — documented as a known gap. The billing lock means once billed it cannot be returned. Pre-billed returns are possible through raw status patches but there is no purpose-built "return" flow.

---

## Phase 4 — Permission and Lock Testing

### Scenario G — Full Permission Matrix

| Role | State | View | Edit Financial | Edit Notes/Photos | Approve/Status Change | Bill | Reopen |
|---|---|---|---|---|---|---|---|
| field_tech | draft/in-progress | Own WOs only | No (pricing stripped) | No (PATCH blocked) | Start own WO (status: in_progress only) | No | No |
| field_tech | completed | Own WOs only | No | No | No | No | No |
| field_tech | billed | Own WOs only | No | No | No | No | No |
| irrigation_manager | draft/in-progress | All | Yes (financial fields stripped from PATCH per stripping logic) | Yes | Yes (full PATCH access) | No | Yes |
| irrigation_manager | completed | All | No (recompute uses snapshot) | Yes (photos PATCH) | Yes | No | Yes |
| irrigation_manager | billed | All | BLOCKED by billing lock (409) | BLOCKED | BLOCKED | No | No |
| billing_manager | any | All | Same as irrigation_manager | Same | Same | Yes (via invoice creation) | No |
| company_admin | any | All | Same as billing_manager | Same | Same | Yes | Yes |
| super_admin | any | All | Same as company_admin | Same | Same | Yes | Yes |

**Notes:**
- `requireWorkOrderUpdateAccess` (routes.ts:241–281): field_tech can only change `status: in_progress` on their own assigned WO; all other updates blocked.
- `requireBillingSheetUpdateAccess` (routes.ts:284–328): field_tech can only set `status: submitted` on their own billing sheets.
- Billed lock is enforced at API level before any update proceeds.
- PATCH to financial fields on work orders: the stripping block (routes.ts:7001–7012) removes them from the payload, so managers cannot directly overwrite them (they are recomputed from snapshot).
- **DEFECT D-3 applies here:** billing sheet financial fields ARE writable by managers via PATCH (not stripped).

### Scenario H — Billed Lock Enforcement at API Level

- `PATCH /api/work-orders/:id` — checked at routes.ts:6994–6997: returns 409 if `invoiceId != null || status === 'billed'`.
- `PATCH /api/billing-sheets/:id` — checked at routes.ts:6552–6555: same 409 response.
- `POST /api/work-orders/complete` — checked at routes.ts:6113–6116: returns 409 if already billed.
- `DELETE /api/work-orders/:id` — checks `hasInvoiceItems()` (routes.ts:7148), returns 409.
- `DELETE /api/billing-sheets/:id` — lock check present.
- **No alternate endpoint allows side-door financial edits** — all financial write paths go through the endpoints above which all enforce the lock.
- **PASS** — billed lock is enforced at API layer for all relevant endpoints.

---

## Phase 5 — UI and List Behavior

### Scenario I — Operational List Behavior

- `billing-sheets.tsx`: Groups into "Active" (draft + submitted) and "Completed" (approved + billed) with collapsible sections. Billed badges shown in purple. Status badges clearly differentiated.
- Work order lists show status badges: Pending, In Progress, Completed, Billed, Cancelled.
- `billing-sheets.tsx` line 85: `completedStatuses = ['approved', 'billed']` — approved and billed sink to "Completed" group.
- Field tech view: pricing fields stripped server-side (`applyPricingVisibility`). Hours visible but no dollar amounts.
- **PASS** — list behavior and billed visibility appears correctly implemented in the UI.

### Scenario J — Billing Manager Intake Behavior

- `GET /api/customers/:id/billing` — `unbilledWorkOrders` filter: `status === 'completed' && !invoiceId` (routes.ts:1986–1988).
- `GET /api/customers/:id/billing` — `unbilledBillingSheets` filter: `(status === 'completed' || status === 'approved') && !invoiceId` (routes.ts:1991–1993).
- **DEFECT D-4 (MEDIUM):** Work orders in `pending_review` or `approved` status do not exist in the work order status model (`pending, assigned, in_progress, completed, cancelled, billed`). The billing queue filters on `status === 'completed'` only, which means:
  - A work order that was "approved" (which in practice means status is set to `completed`) is included correctly.
  - But there is **no distinction** between a work order freshly completed and one that has been reviewed and cleared by the irrigation manager — both show as "completed". The billing manager cannot tell which tickets have been reviewed.
  - This is a visibility/workflow gap, not a financial integrity issue.
- Invoice preview (`POST /api/invoices/preview`) additionally filters on `!wo.invoiceId` to prevent double-billing. Already-billed items are excluded.
- **CONDITIONAL PASS** — financial eligibility filters are correct; reviewer-state visibility is missing.

---

## Phase 6 — Historical and Migration Safety

### Scenario K — Historical Completed-but-Unbilled Records

- Records completed before the applied-rate snapshot was implemented will have `appliedLaborRate = null`, `appliedMarkupRate = null`, `appliedTaxRate = null`, and potentially `laborSubtotal = null`.
- The customer billing endpoint (routes.ts:1938–1950) handles this: `hasBreakdown = wo.laborSubtotal != null`. For pre-fix records, `laborCost` and `partsCost` are set to 0 and `hasFinancialBreakdown = false`. The UI is expected to show `totalAmount` as authoritative.
- Invoice preview (routes.ts:2265–2268): comment "Historical backfill guardrail: if laborSubtotal is null (pre-fix record), use totalAmount for the total but show no breakdown detail." Uses `parseFloat(wo.laborSubtotal || '0')` — pre-fix records contribute 0 labor/parts breakdown but their `totalAmount` is still summed.
- **CONCERN:** For pre-fix records, the invoice preview's `laborSubtotal` and `partsSubtotal` aggregates will be understated (0) while `totalAmount` will be correct. The invoice record will store `laborSubtotal = 0` but `totalAmount = correct stored amount`. This means the PDF validation check (`partsSubtotal + laborSubtotal ≈ totalAmount`) will **fail** for these records (stored total != 0 but computed = 0).
- The PDF service's `validateRows` function (invoice-pdf-service.ts:97–118) will flag these records as validation errors and refuse to generate the PDF for invoices containing pre-fix records.
- **PASS (with caveat):** Pre-fix records can be viewed and billed, and their `totalAmount` is authoritative. However, PDF generation will fail for invoices containing them unless markup/tax happened to be zero (so parts+labor = total). This is a known transitional issue.

### Scenario L — Already Billed Historical Records

- Billed records are locked (`invoiceId != null` check on all write endpoints).
- They appear in list views with billed status badge.
- They do not re-enter billing queues (`!invoiceId` filter on all unbilled queries).
- **PASS** — historical billed records are safely locked and correctly excluded from re-billing.

---

## Phase 7 — QuickBooks Payload Audit

### Scenario M — Payload-Level Verification

**Work Order QB line construction (routes.ts:2590–2609):**
```
const totalLineAmount = parseFloat(workOrder.totalAmount || '0');     // stored value
const appliedLaborRate = parseFloat(workOrder.appliedLaborRate || workOrder.laborRate || '45');
Amount: totalLineAmount,                                              // stored value
UnitPrice: totalLineAmount,                                           // stored value
Description: `WO-... ${hours}h labor @ $${appliedLaborRate}/h, $${partsAmount} parts`
```

**Billing Sheet QB line construction (routes.ts:2613–2628):**
```
const lineTotal = parseFloat(billingSheet.laborSubtotal || '0') + parseFloat(billingSheet.partsSubtotal || '0');
Amount: lineTotal,                                                    // derived from stored fields
```

**Five-stage match table (example flow):**

| Stage | Source | Value |
|---|---|---|
| Field/completion total | `workOrder.totalAmount` stored at completion | $X |
| Billing manager display | `GET /api/customers/:id/billing` reads `totalAmount` | $X |
| Invoice preview | `POST /api/invoices/preview` sums stored `totalAmount` | $X |
| Invoice record | `invoices.totalAmount` set from same sum | $X |
| QB payload | `Amount: workOrder.totalAmount` | $X |

All five match for work orders with complete snapshots. **PASS.**

For billing sheets, the QB line uses `laborSubtotal + partsSubtotal` (not `totalAmount`). For billing sheets that include markup or tax in `totalAmount`, these would not match. However, the billing sheet schema does not have dedicated `appliedMarkupRate`/`appliedTaxRate` fields, so markup/tax for billing sheets is not separately trackable. The `totalAmount` stored on billing sheets should equal `laborSubtotal + partsSubtotal + markupAmount + taxAmount`, but the QB payload uses only `laborSubtotal + partsSubtotal`.

**DEFECT D-1 INTERSECTION:** For billing sheets created via `POST /api/work-orders/:id/billing-sheet`, markup is `"0"` and tax is hardcoded at 8.25%. For these, `totalAmount = laborSubtotal + partsSubtotal + taxAmount (8.25%)`. The QB payload uses `laborSubtotal + partsSubtotal`, which excludes the tax. So QB receives less than the stored `totalAmount` — a financial discrepancy.

---

## Phase 8 — Edge Cases and Regression

### Scenario N — Edge Cases

| Edge Case | Result | Notes |
|---|---|---|
| Zero parts, zero labor | Works — totalAmount = $0 | QB skips $0 lines (`if (totalLineAmount > 0)`) |
| Zero labor | Works — markup/tax apply to parts only | Math is correct |
| No photos | Works — photos array defaults to [] | No issue |
| Many parts lines | Works — items stored in workOrderItems table | No limit |
| Many photos | Works — stored as array | No issue |
| High-value ticket | Works — decimal precision is 10,2 | Adequate |
| Decimal-heavy parts totals | Works — stored as decimal strings | parseFloat handles |
| Tax-exempt customer (taxPercent=0) | PASS — `appliedTaxRate = 0.0000` stored; tax computed as 0 | Correct |
| Markup-free customer (markupPercent=0) | PASS — `appliedMarkupRate = 0.0000` stored; markup computed as 0 | Correct |
| Incomplete ticket blocked from billing | PASS — must be `status === 'completed'` to appear in unbilled queue | |
| Duplicate invoice attempt | PASS — `!wo.invoiceId` filter prevents including already-billed items | |
| Approval after manager edit + customer rate change | PASS — edits recompute from stored snapshot, not live customer rates | |
| Refresh/reload during approval | No server-side concern — transactions are atomic; idempotent PATCH | |

---

## Financial Integrity Matrix

| Flow Stage | Work Orders (post-fix) | Billing Sheets (standalone) | Billing Sheets (converted from WO via legacy path) |
|---|---|---|---|
| Completion/creation total | Stored from customer snapshot | Stored as supplied | **Hardcoded formula (D-1)** |
| Manager display | Reads stored value | Reads stored value | Reads stored (incorrect) value |
| Invoice preview | Reads stored value | Reads stored value | Reads stored (incorrect) value |
| Invoice record | Aggregated from stored values | Aggregated from stored values | Aggregated from stored (incorrect) values |
| QB payload (WO) | `totalAmount` authoritative | N/A | N/A |
| QB payload (BS) | N/A | `laborSubtotal + partsSubtotal` | `laborSubtotal + partsSubtotal` (excludes hardcoded tax) |
| Match? | ✅ MATCH | ✅ MATCH (if tax/markup excluded from totalAmount) | ❌ MISMATCH (QB excludes tax; totalAmount includes it) |

---

## Permission and Lock Matrix Summary

| Action | field_tech | irrigation_manager | billing_manager | company_admin |
|---|---|---|---|---|
| View own WOs | ✅ | ✅ | ✅ | ✅ |
| View all WOs | ❌ | ✅ | ✅ | ✅ |
| Edit WO financial fields | ❌ | ❌ (stripped) | ❌ (stripped) | ❌ (stripped) |
| Edit BS financial fields | ❌ | ✅ ⚠️ (D-3) | ✅ ⚠️ (D-3) | ✅ ⚠️ (D-3) |
| Edit WO non-financial | ❌ (only start) | ✅ | ✅ | ✅ |
| Edit BS non-financial | Submit only | ✅ | ✅ | ✅ |
| Approve/status WOs | ❌ | ✅ | ✅ | ✅ |
| Bill items | ❌ | ❌ | ✅ | ✅ |
| Patch billed WO | ❌ | ❌ (409 lock) | ❌ (409 lock) | ❌ (409 lock) |
| Patch billed BS | ❌ | ❌ (409 lock) | ❌ (409 lock) | ❌ (409 lock) |

---

## Defects Still Remaining

### D-1: Legacy work-order-to-billing-sheet conversion uses stripped formula (HIGH)

**Location:** `server/routes.ts`, `POST /api/work-orders/:id/billing-sheet`, lines 7326–7331, 7411  
**Impact:** Any work order converted to a billing sheet through this endpoint produces incorrect financial data: markup is forced to 0, tax is hardcoded at 8.25%, labor rate falls back to hardcoded $45/hr instead of using the work order's stored `appliedLaborRate`.  
**Remediation:** Read `appliedLaborRate`, `appliedMarkupRate`, `appliedTaxRate` from the work order record and use them to compute `laborSubtotal`, `markupAmount`, `taxAmount`, and `totalAmount` in the same pattern as the completion endpoint. Remove the hardcoded 8.25% tax and the hardcoded $45 fallback.

### D-2: No approval stamp fields on work orders or billing sheets (MEDIUM)

**Location:** `shared/schema.ts` — `workOrders` and `billingSheets` tables  
**Impact:** There is no forensic record of who approved a work order/billing sheet, when, and at what total. The `approvedBy`, `approvedAt`, `approvedTotal`, `approvedPartsSnapshot`, `approvedLaborSnapshot` fields described in the task specification do not exist in the schema. Status transitions serve as proxy approval records, but no audit trail is captured.  
**Remediation:** Add `approvedByUserId`, `approvedAt`, and `approvedTotal` columns to both tables. Populate them in a dedicated approve endpoint or in the PATCH handler when status transitions to `approved`.

### D-3: Billing sheet PATCH does not strip/protect financial snapshot fields (MEDIUM)

**Location:** `server/routes.ts`, `PATCH /api/billing-sheets/:id`, lines 6547–6588  
**Impact:** Unlike the work order PATCH which strips `appliedLaborRate`, `appliedMarkupRate`, `appliedTaxRate`, `laborSubtotal`, `partsSubtotal`, `markupAmount`, `taxAmount`, `totalAmount` from the body before processing, the billing sheet PATCH accepts all of these fields directly. A manager could overwrite the financial totals on a billing sheet without a rate-consistent recomputation.  
**Remediation:** Either (a) apply the same stripping pattern as work orders and recompute from the stored rates, or (b) accept that billing sheets are manager-computed and add server-side validation that `laborSubtotal + partsSubtotal + markupAmount + taxAmount ≈ totalAmount` whenever these fields are written.

### D-4: No irrigation manager review state visible to billing manager for work orders (LOW)

**Location:** `server/routes.ts`, `GET /api/customers/:id/billing` unbilled filter (lines 1986–1988)  
**Impact:** The billing manager queue shows all completed, unbilled work orders regardless of whether an irrigation manager has reviewed them. There is no intermediate state between `completed` (field work done) and `billed` (invoiced) to indicate manager review/clearance. Billing manager cannot distinguish "fresh completions awaiting review" from "reviewed and cleared for billing."  
**Remediation:** Implement an explicit `reviewed` or `approved` status value in the work order status lifecycle, or use an `approvedAt` timestamp (see D-2) to filter the billing queue.

---

## Historical Data Findings

1. **Pre-snapshot records** (completed before `appliedLaborRate` was added): `laborSubtotal`, `partsSubtotal`, `markupAmount`, `taxAmount`, `appliedLaborRate/Rate/Rate` are null. `totalAmount` may be populated or may be the default `"0.00"`. These records are safely handled in the billing preview (treated as $0 breakdown with `totalAmount` authoritative), but **PDF generation will fail** for invoices containing them due to the `validateRows` check (which flags `partsSubtotal + laborSubtotal != totalAmount`).

2. **Pre-billed records** created through the legacy `POST /api/work-orders/:id/billing-sheet` path: have `markupAmount = "0"` and `taxAmount` at 8.25% hardcoded, regardless of the customer's actual rates. If the customer has a different tax rate, these records are financially incorrect and cannot be retrospectively corrected without fabricating rate data.

3. **Already-billed records** are correctly locked and excluded from billing queues. No remediation needed.

---

## Final Production-Readiness Verdict

**SAFE WITH EXCEPTIONS**

The primary financial failure mode (totals discarded and rebuilt from stripped formulas) has been eliminated from the main work-order completion path. The financial snapshot infrastructure (`appliedLaborRate`, `appliedMarkupRate`, `appliedTaxRate`) is correctly placed, preserved through manager edits, and propagated through to invoice creation and the QuickBooks payload.

**Conditions for "safe" designation:**
1. Work orders must be completed through `POST /api/work-orders/complete` (the standard field-tech flow), not through `POST /api/work-orders/:id/complete`.
2. The `POST /api/work-orders/:id/billing-sheet` conversion path must not be used (or must be remediated — Defect D-1).
3. Billing sheet financial fields should be treated as manager-verified values and not further recalculated without care (Defect D-3).

**Actions required before unconditional production use:**
- Remediate D-1 (HIGH) to fix the legacy conversion path.
- Remediate D-2 (MEDIUM) to add approval audit trail.
- Remediate D-3 (MEDIUM) to protect billing sheet financial fields.
- Remediate D-4 (LOW) to improve billing manager workflow visibility.
- Address PDF generation failure for invoices containing pre-snapshot records.
