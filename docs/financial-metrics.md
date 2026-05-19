# Financial metrics — canonical formulas

Task #720. This is the single source of truth for every shared
financial KPI that appears on **Financial Pulse** (`/financial-pulse`)
and on the **Billing Workspace** (`/billing-workspace`). When in
doubt, the helpers in
`artifacts/api-server/src/financial-pulse-math.ts` are authoritative;
tile labels and tooltips on both pages must use the wording from
this document so the two screens stay reconciled.

All metrics are read-side. All metrics are tenant-scoped through
`customers.companyId`. For `super_admin` with no `?companyId` query
param the scope is global; for `company_admin` / `billing_manager`
the scope is always the caller's company. No metric is computed
from a cross-tenant cached rollup. Tax and markup are baked into
`invoices.totalAmount` at finalization time and **are included**
in every dollar tile below.

## Billed MTD / Billed YTD

- **Source**: `invoices` (joined to `customers` for scoping)
- **Date column**: `invoices.createdAt`
- **Window**:
  - MTD = first of current month 00:00 local → now (exclusive of the
    upper bound, inclusive of the lower)
  - YTD = January 1 of current year 00:00 local → now
- **Status filter**: excludes `draft` and `cancelled`. Every other
  status (`sent`, `paid`, `partial`, `overdue`, `pending`) is in.
- **Tax / markup**: included (baked into `totalAmount`)
- **Helper**: `computeBilled(invoices, start, end)`
- **Endpoint**: `GET /api/financial-pulse/kpis` → `billedMtd.value`
  / `billedYtd.value`
- **Compared to**: prior-month-to-date (MTD) / prior-year-to-date
  (YTD)

## Collected MTD

- **Source**: `invoices`
- **Date column**: `invoices.paidAt`
- **Window**: MTD (same definition as Billed MTD)
- **Status filter**: excludes `draft` and `cancelled`. A row with
  a `paidAt` inside the window but status of `draft` / `cancelled`
  is a data bug, but the read path defends against it explicitly so
  the tile cannot be inflated.
- **Tax / markup**: included
- **Helper**: `computeCollected(invoices, start, end)`
- **Endpoint**: `GET /api/financial-pulse/kpis` →
  `collectedMtd.value`
- **Compared to**: prior month, same date column + window

## Outstanding A/R

- **Source**: `invoices` (local Postgres, NOT QuickBooks)
- **Date column**: none — point-in-time snapshot as of `now`
- **Status filter**: excludes `draft`, `cancelled`, and `paid`. A
  row with a non-null `paidAt` is also excluded (defends against
  stale status).
- **Tax / markup**: included
- **Helper**: `computeOutstandingAr(invoices)`
- **Endpoint**: `GET /api/financial-pulse/kpis` →
  `outstandingAr.value`

## Overdue in QuickBooks  *(distinct from Outstanding A/R)*

This is a **different metric** from Outstanding A/R. It uses the
local invoice mirror but applies a past-due-date filter, and is the
number a manager would see if they opened QuickBooks directly. It
appears on the Billing Workspace only.

- **Source**: `invoices`
- **Date column**: `invoices.dueDate` vs. `now`
- **Window**: all invoices whose `dueDate` is in the past
- **Status filter**: excludes `draft`, `cancelled`, `paid`
- **Tax / markup**: included
- **Endpoint**: `GET /api/quickbooks/overdue-summary` →
  `overdueCount` / `overdueAmount` / `asOf`
- **Freshness**: response is cached for **15 minutes** per
  `role+companyId` and carries an `asOf` ISO timestamp so the UI
  can render "as of HH:MM" beside the value.

A non-overdue but unpaid invoice (due date in the future) IS in
Outstanding A/R and IS NOT in QuickBooks Overdue. A drafted
invoice is in neither. That is by design — both numbers stay.

## Unbilled Exposure

- **Source**: `work_orders` + `billing_sheets`
- **Date column**: none — point-in-time snapshot
- **Status filter**: rows with `invoiceId IS NULL` and a status in
  one of:
  - work orders: `approved_passed_to_billing`,
    `pending_manager_review`, `work_completed`
  - billing sheets: `approved_passed_to_billing`,
    `pending_manager_review`, `completed`, `submitted`
- **Customer filter**: excludes customers where
  `hiddenFromBilling = true` (parity with
  `/api/customers/billing-preview`)
- **Tax / markup**: included (rolled into the row's `totalAmount`
  at the time the WO/BS was costed; not recomputed)
- **Endpoint**: `GET /api/financial-pulse/kpis` →
  `unbilledExposure.value`

## Awaiting Approval *(Billing Workspace only)*

- **Source**: `work_orders` + `billing_sheets` in scope
- **Window**: none — count of currently-open items
- **Status filter**:
  - work orders: `pending_manager_review`, `work_completed`
  - billing sheets: `pending_manager_review`, `submitted`,
    `completed`
- **Endpoint**: `GET /api/billing-workspace/status-strip` →
  `awaitingApproval`

## Approved This Week *(Billing Workspace, rolling 7d)*

- **Source**: `work_orders` + `billing_sheets` in scope
- **Date column**: `approvedAt` (falls back to `updatedAt` when the
  row predates the column)
- **Window**: rolling 7 days (`now - 7d` → `now`). Tile must carry
  a "7d" badge so it does not read as MTD next to Billed MTD.
- **Status filter**:
  - work orders: `approved`, `billed`, `invoiced`,
    `completed_approved`
  - billing sheets: `approved`, `billed`, `invoiced`
- **Endpoint**: `GET /api/billing-workspace/status-strip` →
  `approvedThisWeek`

## Drafts Last 24h *(Billing Workspace, rolling 24h)*

- **Source**: `work_orders` + `billing_sheets` in scope
- **Date column**: `createdAt`
- **Window**: rolling 24 hours (`now - 24h` → `now`). Tile must
  carry a "24h" badge.
- **Status filter**:
  - work orders: `draft`, `scheduled`, `in_progress`
  - billing sheets: `draft`, `in_progress`
- **Endpoint**: `GET /api/billing-workspace/status-strip` →
  `draftsLast24h`

## Reconciliation contract

Anywhere two tiles refer to the same underlying number, both
surfaces MUST go through the same helper in `financial-pulse-math.ts`
and the same endpoint. The Billing Workspace embeds the Financial
Pulse KPI widget for Billed MTD / Collected MTD / Outstanding A/R —
it does **not** recompute them locally in
`billing-workspace-routes.ts`. The QuickBooks Overdue tile is the
only Billing-Workspace tile whose dollar amount comes from a
different formula; it lives next to Outstanding A/R and is labeled
as a separate concept.
