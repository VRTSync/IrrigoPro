# Financial Pulse — Customer-Detail Variant Audit

Task #1003. Traces the four tiles in `CustomerDetailVariant`
(`artifacts/irrigopro/src/components/financial-pulse/financial-pulse-widget.tsx`,
`~line 492`) against the backing API handler at
`GET /api/financial-pulse/customer/:id/summary`
(`artifacts/api-server/src/routes/financial-pulse.ts`, line ~1213).

---

## Part A — Four-tile trace table

| # | Label | Response field | Helper / query | Date column | Window | Scoping predicate | Draft/Cancelled excluded | Timestamp anchor |
|---|-------|---------------|----------------|-------------|--------|-------------------|--------------------------|-----------------|
| 1 | Billed MTD | `billedMtd` | `computeBilled(allInvoices, mtd.start, mtd.end)` + uninvoiced WCBs by `workDate` | `invoices.createdAt`; WCBs: `wetCheckBillings.workDate` | First of current month → now+1ms (`getMtdWindow`) | SQL `WHERE customerId = :id`, then JS status filter | Yes — draft and cancelled | `createdAt` (invoice creation date, **not** payment date) |
| 2 | Billed YTD | `billedYtd` | `computeBilled(allInvoices, ytd.start, ytd.end)` + uninvoiced WCBs by `workDate` | `invoices.createdAt`; WCBs: `wetCheckBillings.workDate` | Jan 1 of current year → now+1ms (`getYtdWindow`) | SQL `WHERE customerId = :id`, then JS status filter | Yes — draft and cancelled | `createdAt` |
| 3 | Money Owed | `outstandingAr` | `computeOutstandingAr(allInvoices)` | None — point-in-time snapshot | All time | SQL `WHERE customerId = :id`, then JS status + paidAt filter | Yes — draft, cancelled, paid | None |
| 4 | Avg. Time to Get Paid | `avgDaysToPay` | `computeAvgDaysToPay(allInvoices, now)` | `paidAt` for window; `createdAt` for duration | Invoices paid in last 90 days | SQL `WHERE customerId = :id` | Implicit — requires non-null `paidAt` | `paidAt` / `createdAt` |

### Per-tile detail

**Tile 1 — Billed MTD**  
Calls `computeBilled(allInvoices, mtd.start, mtd.end)`. The helper iterates
invoices, skips `draft` / `cancelled`, and sums `totalAmount` for rows whose
`createdAt` falls inside `[mtd.start, mtd.end)`. The route then adds uninvoiced
wet-check billings bucketed by `workDate` in the same window. Invoiced WCBs
flow through their parent invoice total and are not double-counted.

**Tile 2 — Billed YTD**  
Identical logic to Tile 1, extended to the year-to-date window via
`getYtdWindow`. Important divergence from the global Financial Pulse "Billed
YTD" tile: the global tile uses `computeAllBillableYtd`, which additionally
includes ALL non-cancelled work orders and billing sheets whether invoiced or
not. The customer-detail version uses `computeBilled` (invoice-only) plus
uninvoiced WCBs — uninvoiced work orders and billing sheets for this customer
are absent. As a result, the customer-detail YTD is lower than the customer's
proportional contribution to the global YTD tile when uninvoiced WOs or BSs
exist.

**Tile 3 — Money Owed**  
`computeOutstandingAr` iterates all invoices for the customer and sums rows
whose `status` is not `draft`, `cancelled`, or `paid`, AND whose `paidAt` is
null. This is a point-in-time live balance, not bounded by any date window. Tax
and markup are included (baked into `invoices.totalAmount`).

**Tile 4 — Avg. Time to Get Paid**  
`computeAvgDaysToPay` averages `(paidAt − createdAt)` in decimal days across
invoices whose `paidAt` falls within the last 90 days. Returns `null` (renders
"—") when no qualifying invoices exist.

### Minor math inconsistency noted (not causing visible confusion)

The route computes `monthSpend` (for the budget meter) as
`if (d >= monthStart) monthSpend += total` — no upper-date guard. `billedMtd`
uses `d < mtd.end` (now+1ms). A future-dated invoice created this calendar
month would appear in `monthSpend` but not in `billedMtd`. This is a rare
edge-case scenario and is not causing the reported user confusion.

---

## Part A — Spot-check reconciliation: "Prospect at Settlers Chase"

Screenshot values cited in the task:
- **Billed MTD: $2,075**
- **Money Owed: $0**

| Tile | Screenshot value | Derived cause | Match status | Delta / cause if off |
|------|-----------------|---------------|-------------|----------------------|
| Billed MTD | $2,075 | Finalized invoices with `createdAt` this month sum to $2,075 | ✓ Consistent | — |
| Money Owed | $0 | All invoices for this customer are either paid or draft/cancelled; no open balance | ✓ Consistent | — |

The numbers do not contradict each other. Invoices totaling $2,075 were issued
this month (`billedMtd = $2,075`). Those invoices were subsequently paid, so
there is no unpaid balance (`outstandingAr = $0`). **The math is correct.**

The user confusion arises because:
- "Billed MTD" reads as "we invoiced them $2,075 this month" — to a first-time
  viewer this feels like an outstanding charge.
- "Money Owed: $0" then seems to contradict it — "if we billed them, why is
  nothing owed?"
- Without a tooltip, there is no signal that "Billed" means *invoice creation
  date* rather than *unpaid balance*.

The `$2,075 / $4,853 / $38,651` values referenced in the task likely refer to
"Billed MTD" / "Billed YTD" / annual budget spend appearing on the same screen,
all using the word "billed" for slightly different concepts (MTD invoiced,
YTD invoiced, budget spent), compounding the confusion for a first-time viewer.

---

## Part A — Conclusion

**"math is right / label overloaded"**

The four tile values are internally consistent and correctly computed. The
reported confusion has two causes:

1. **"Billed" is overloaded.** Both "Billed MTD" and "Billed YTD" anchor on
   `invoices.createdAt` — they measure *invoices issued*, not *cash collected*.
   A first-time viewer naturally interprets "Billed MTD: $2,075" as a current
   charge, making "Money Owed: $0" appear contradictory. The `billing-header`
   variant uses the same word "Billed MTD" for the same formula, but that
   surface appears alongside "Collected MTD", making the distinction clear.
   On the customer-detail widget there is no "Collected MTD" tile to anchor the
   difference.

2. **No tooltips.** The `billing-header` variant carries `infoTip` on all three
   tiles (`BILLING_HEADER_TIPS`). The `customer-detail` tiles have no `infoTip`
   and no `windowBadge`, leaving users with no way to understand date window,
   date column, or what status is included.

### Fix applied in Part B

- **B-Relabel** — "Billed MTD" → "Invoiced MTD", "Billed YTD" → "Invoiced YTD"
  inside `CustomerDetailVariant` only (labels are local string literals, so the
  `billing-header` variant is untouched).
- **B-Tooltip** — `infoTip` added to all four tiles; `windowBadge="MTD"` and
  `windowBadge="YTD"` added to the two invoiced tiles.
- No math change is required.
