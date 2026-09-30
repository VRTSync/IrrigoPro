# Financial metrics — canonical formulas

This is the reconciliation contract for financial numbers on **Financial
Pulse** (`/financial-pulse`), its Accounting tab, and the invoices page A/R
view. The implementation in `artifacts/api-server/src/financial-pulse-math.ts`
and the shared invoice-aging module is authoritative.

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

For invoice-based Financial Pulse figures, `INVOICE_EXCLUDED_STATUSES`
(`artifacts/api-server/src/financial-pulse-math.ts`) is the shared filter:
draft, cancelled, superseded, merged, failed. Money Owed also excludes
`status = paid`, a non-null `paidAt`, or `paymentStatus = paid`. Invoiced
figures include tax and markup in `totalAmount`.

The single money-owed rule is `arAmountDue` in that same module: clamp
`resolveBalanceDue` (`lib/shared/src/invoice-aging.ts`) to zero. When
`paymentSyncedAt` is valid and `balance` exists, use the synced balance;
otherwise use the invoice total and flag the fallback as stale sync in the
invoice list. Both `computeOutstandingAr` and `computeArAging` use this
amount and the same paid/excluded-status checks. Aging due dates use
`computeEffectiveDueDate` (explicit due date, otherwise creation date plus
payment terms). The invoices page A/R view is the overdue list; there is no
separate QuickBooks overdue total.

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
- **Status filter**: shared invoice exclusions also defend against a
  `paidAt` date on an ineligible invoice.
- **Tax / markup**: included
- **Helper**: `computeCollected(invoices, start, end)`
- **Endpoint**: `GET /api/financial-pulse/kpis` → `collectedMtd.value`
- **Compared to**: prior month, same date column + window
- **QBO caveat**: `paidAt` is populated by the QuickBooks payment sync.
  This tile may show $0 if the QBO connection is inactive.

## Tile 3 — Money Owed *(previously "Outstanding A/R")*

- **Source**: `invoices` (local Postgres, NOT QuickBooks)
- **Date column**: none — point-in-time snapshot as of `now`
- **Balance / payment rule**: the shared money-owed rule above, including
  partially paid invoices at their synced remaining balance; rows marked
  paid by status, `paidAt`, or payment status contribute nothing.
- **Helper**: `computeOutstandingAr(invoices)`; `computeArAging` partitions
  exactly these dollars into Current, 0–29, 30–59 and 60+ day buckets.
- **Endpoint**: `GET /api/financial-pulse/kpis` → `outstandingAr.value`
- **QBO caveat**: accuracy depends on QuickBooks payment sync. Invoices
  are only marked paid when QBO syncs payment data back.

## Tile 4 — Projected by Month-End

- **Formula**: `(billedMtd ÷ daysElapsed) × daysInMonth`.
- **Base**: invoices created month-to-date, not the point-in-time
  uninvoiced pipeline, which cannot be run-rated by elapsed days.
- **Helper**: `computeBilled(invoices, ...getMtdWindow(now))` supplies
  billed MTD to `computeProjectedMonthEnd(billedMtd, now)`.
- **Endpoints**: `GET /api/financial-pulse/kpis` → `projectedMonthEnd.value`
  and `GET /api/financial-pulse/projections` → `projectedMonthEnd`.
  Both use the same billed run-rate helper, not two independent forecasts.

## Tile 5a — Invoiced YTD

- **Formula**: eligible invoices with `invoiceYear = currentYear`, summed
  at `totalAmount`. This is a billing-year figure, not `createdAt` YTD.
- **Helper / endpoint**: `computeInvoicedYtd` →
  `GET /api/financial-pulse/kpis` → `invoicedYtd.value`.
- **Comparison**: prior billing year, limited to invoices created through
  the same clamped calendar date a year earlier.

## Tile 5b — Work Booked YTD

- **Formula**: Invoiced YTD + uninvoiced, non-cancelled work orders and
  billing sheets created this year + uninvoiced wet-check billings with
  `workDate` this year. Uninvoiced legs exclude hidden-from-billing
  customers and rows without a customer id.
- **No double count**: any work linked to an invoice contributes through
  that invoice only; it is never added a second time as in-flight work.
- **Helper / endpoints**: `computeWorkBookedYtd` →
  `GET /api/financial-pulse/kpis` → `workBookedYtd.value` and
  `GET /api/financial-pulse/pulse-summary` → `yearToDate.value`.
  The same input rule applies on both tabs; this tile has no delta.

## Tile 6 — Work Not Yet Billed

- **Source**: `work_orders` + `billing_sheets` + `wet_check_billings`
- **Date column**: none — point-in-time snapshot
- **Status filter**: `isUnbilledWorkRow` requires `invoiceId IS NULL`
  and status other than `cancelled` for work orders and billing sheets;
  uninvoiced wet-check billings are the third leg. This includes
  in-progress work, not just rows pending approval.
- **Customer filter**: excludes customers where
  `hiddenFromBilling = true` (parity with
  `/api/customers/billing-preview`)
- **Tax / markup**: included (rolled into the row's `totalAmount`
  at the time the WO/BS was costed; not recomputed)
- **Endpoint**: `GET /api/financial-pulse/kpis` → `unbilledExposure.value`
- **Label on page**: "Work Not Yet Billed"
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
- **Parts cost**: for each in-window invoice line item, quantity ×
  catalog `parts.cost` when usable. Otherwise estimate from the billed
  parts portion (`totalPrice − laborTotal`) × `DEFAULT_PARTS_COST_PCT`
  (default 65%). Never treat a billed parts subtotal as cost. The helper
  reports both `estimatedPartsCostShortfall` and `missingCostPartLineCount`.
- **Labor cost**: linked work orders, billing sheets and wet-check billings
  each contribute technician hours × `users.hourlyWage`. For an unknown
  technician or missing wage, use `DEFAULT_HOURLY_WAGE` (default $25/hr);
  `estimatedLaborCostShortfall` and `missingWageTechCount` report the
  estimated portion. The tile warns when costs are estimated.
- **Helper**: `computeGrossMargin` in `financial-pulse-math.ts`, supplied
  with invoice line items and all three linked labor legs.
- **Endpoint**: `GET /api/financial-pulse/kpis` → `grossMarginPct.value`
- **Period**: follows the MTD/YTD selector on the Financial Pulse page.

---

## Reconciliation invariants

The status strip lives at `GET /api/manager-workspace/status-strip` and
uses its own shared work-status sets; it is not a second financial KPI
source. Overdue is answered by the invoices page A/R view.

- `computeArAging` bucket amounts sum to `computeOutstandingAr` (Money
  Owed), including partially paid invoices and the balance fallback.
- The by-technician revenue column allocates each eligible billed
  invoice once; its shares sum to the billed total for attributable work.
- Work Booked YTD matches between the Financial Pulse and Accounting tabs
  and counts invoiced work only once.
- The five budget-spend surfaces (Financial Pulse Accounting and Pulse
  customer meters, customer profile, billing preview, and budget status)
  use the shared `computeCustomerSpendBatch` / `computeCustomerSpend`
  rule rather than an invoice-only local sum.
- The KPI tile and projections panel use one `computeProjectedMonthEnd`
  result from billed MTD, never a projection of the uninvoiced pipeline.
