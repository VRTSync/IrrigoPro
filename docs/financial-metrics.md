# Financial metrics — canonical formulas

Task #720 / #726. This is the single source of truth for every shared
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

Financial Pulse's MTD/YTD selector governs Profit Margin, revenue mix, and
the drill-down tables, not every tile. The two revenue-trend lines are both
invoiced revenue by `createdAt`; uninvoiced wet-check work belongs in Work
Not Yet Billed instead. Months whose invoices have no recorded parts/labor
subtotals have no split plotted, not a $0 split. The customer drill-down
reports both returned rows and the full total when the 500-row view is
truncated. Table dollar amounts retain two decimal places, like their CSVs;
the headline tiles display whole dollars.

For invoice-based Financial Pulse figures, the canonical excluded statuses
are **draft, cancelled, superseded, merged, failed**. Money Owed additionally
excludes paid invoices. The Work Not Yet Billed snapshot includes uninvoiced
wet-check billings as well as work orders and billing sheets.

The MTD comparison to last month and YTD comparison to last year clamp the
day to the last day of the target month when it is shorter (March 31 compares
through February 28; February 29 compares through February 28 last year).

---

## Tile 1 — Billed Last Cycle

- **Source**: `invoices`
- **Date column**: `invoices.invoiceMonth` / `invoices.invoiceYear`
  (billing period, NOT `createdAt`). An April invoice created in early
  May is counted in the April cycle, not the May cycle.
- **Cycle selection**: the most recent **closed** billing cycle, excluding
  the current in-progress month, from eligible invoices in scope.
- **Status filter**: excludes `draft`, `cancelled`, `superseded`, `merged`, `failed`.
- **Helper**: `getDistinctBillingCycles(invoices, { closedAsOf: now })[0]` to find the cycle,
  then `computeBilledForCycle(invoices, cycle)` to sum it.
- **Endpoint**: `GET /api/financial-pulse/kpis` → `billedLastCycle.value`
- **Delta**: compared to the second-most-recent billing cycle
  (`cycles[1]`), NOT a fixed calendar window.
- **No QBO dependency.** All data is local.

## Tile 2 — Collected MTD

- **Source**: `invoices`
- **Date column**: `invoices.paidAt`
- **Window**: MTD (first of current month 00:00 local → now)
- **Status filter**: excludes `draft`, `cancelled`, `superseded`, `merged`, `failed`. A row with
  `paidAt` in the window but status `draft` / `cancelled` is a data bug;
  the read path defends against it explicitly.
- **Tax / markup**: included
- **Helper**: `computeCollected(invoices, start, end)`
- **Endpoint**: `GET /api/financial-pulse/kpis` → `collectedMtd.value`
- **Compared to**: prior month, same date column + window
- **QBO caveat**: `paidAt` is populated by the QuickBooks payment sync.
  This tile may show $0 if the QBO connection is inactive.

## Tile 3 — Money Owed *(previously "Outstanding A/R")*

- **Source**: `invoices` (local Postgres, NOT QuickBooks)
- **Date column**: none — point-in-time snapshot as of `now`
- **Status filter**: excludes `draft`, `cancelled`, `superseded`, `merged`, `failed`, and `paid`. A
  row with a non-null `paidAt` is also excluded (defends against
  stale status).
- **Tax / markup**: included
- **Helper**: `computeOutstandingAr(invoices)`
- **Endpoint**: `GET /api/financial-pulse/kpis` → `outstandingAr.value`
- **QBO caveat**: accuracy depends on QuickBooks payment sync. Invoices
  are only marked paid when QBO syncs payment data back.

## Tile 4 — Projected by Month-End *(previously "Projected Month-End")*

- **Formula**: `(billedMtd ÷ daysElapsed) × daysInMonth`.
- **Base**: invoices created month-to-date, not the point-in-time
  uninvoiced pipeline, which cannot be run-rated by elapsed days.
- **Helper**: `computeProjectedMonthEnd(billedMtd, now)`
- **Endpoint**: `GET /api/financial-pulse/kpis` → `projectedMonthEnd.value`

## Tile 5 — Invoiced YTD and Work Booked YTD

- **Definition**: Invoiced YTD is eligible invoices in this billing year.
  Work Booked YTD adds eligible work booked this year without an invoice.
- **Formula**:
  ```
  invoices[invoiceYear = currentYear, eligible status].sum(totalAmount)
  + uninvoiced workOrders[createdAt.year = currentYear].sum(totalAmount)
  + uninvoiced billingSheets[createdAt.year = currentYear].sum(totalAmount)
  + uninvoiced wetCheckBillings[workDate.year = currentYear].sum(totalAmount)
  ```
  Invoiced work is counted through its invoice only.
- **Status filter for WOs/BSs**: excludes `cancelled` only.
- **Helpers**: `computeInvoicedYtd`, `computeWorkBookedYtd`
- **Endpoint**: `GET /api/financial-pulse/kpis` → `invoicedYtd.value`,
  `workBookedYtd.value`
- **Compared to**: Invoiced YTD compares to prior-year invoiced YTD
  through the same (clamped) calendar date; Work Booked YTD has no delta.

## Tile 6 — Unbilled Pipeline

- **Source**: `work_orders` + `billing_sheets` + `wet_check_billings`
- **Date column**: none — point-in-time snapshot
- **Status filter**: rows with `invoiceId IS NULL` and **any status
  except `cancelled`**. This intentionally includes in-progress,
  draft, assigned, approved, submitted, completed — any work that
  hasn't been invoiced yet and hasn't been explicitly abandoned.
  Restricting to a narrow status allowlist (the pre-Task-#726
  behaviour) significantly undercounted the pipeline.
- **Customer filter**: excludes customers where
  `hiddenFromBilling = true` (parity with
  `/api/customers/billing-preview`)
- **Tax / markup**: included (rolled into the row's `totalAmount`
  at the time the WO/BS was costed; not recomputed)
- **Endpoint**: `GET /api/financial-pulse/kpis` → `unbilledExposure.value`
- **Label on page**: "Work Not Yet Billed" (previously "Unbilled Pipeline" /
  "Unbilled Exposure" — renamed in Task #730 for plain-language clarity)
- **Note**: This is a point-in-time balance, not the base of a run-rate
  projection.

## Tile 7 — Avg. Time to Get Paid *(previously "Avg Days to Pay")*

- **Source**: `invoices`
- **Date column**: `paidAt` (for window), `createdAt` (for duration)
- **Window**: invoices paid in the last 90 days
- **Formula**: average of `(paidAt − createdAt)` in days
- **Helper**: `computeAvgDaysToPay(invoices, now)`
- **Endpoint**: `GET /api/financial-pulse/kpis` → `avgDaysToPay.value`
- **QBO caveat**: requires QuickBooks payment sync to populate `paidAt`.

## Tile 8 — Profit Margin *(previously "Gross Margin")*

- **Formula**: `(revenue − partsCost − laborCost) ÷ revenue`
  for invoices in the selected period (MTD or YTD).
- **Parts cost**: from work orders / billing sheets tied to those invoices.
- **Labor cost**: technician hours × `users.hourlyWage`. Falls back to
  `DEFAULT_HOURLY_WAGE` env var (default $25/hr) when wage is missing;
  a warning triangle is shown on the tile when any technician falls back.
- **Helper**: `computeGrossMargin({invoices, workOrders, billingSheets, usersById, fallbackHourlyWage, window})`
- **Endpoint**: `GET /api/financial-pulse/kpis` → `grossMarginPct.value`
- **Period**: follows the MTD/YTD selector on the Financial Pulse page.

---

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

---

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

---

## Reconciliation contract

Anywhere two tiles refer to the same underlying number, both
surfaces MUST go through the same helper in `financial-pulse-math.ts`
and the same endpoint. The Billing Workspace embeds the Financial
Pulse KPI widget for Billed MTD / Collected MTD / Money Owed —
it does **not** recompute them locally in
`billing-workspace-routes.ts`. The QuickBooks Overdue tile is the
only Billing-Workspace tile whose dollar amount comes from a
different formula; it lives next to Money Owed and is labeled
as a separate concept.
