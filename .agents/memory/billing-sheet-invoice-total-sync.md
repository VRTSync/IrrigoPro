---
name: billing-sheet / invoice total sync
description: Any billing-sheet item write must keep the sheet total AND parent invoice total reconciled, or the invoice PDF guard blocks rendering.
---

# Billing-sheet item writes must keep sheet + invoice totals reconciled

The invoice PDF service has a reconciliation guard that refuses to render
when a billing sheet's stored `total_amount` != `parts_subtotal + labor_subtotal`
(tolerance $0.01), and also when the invoice's grand total != sum of its row
totals. Drift here surfaces to users as "PDF Not Available".

**Rule:** every billing-sheet item mutator (add/update/delete/replace) must
recompute the sheet's `parts_subtotal` / `labor_subtotal` / `total_amount`,
and when the sheet has an `invoiceId`, propagate the delta up to the parent
invoice's `partsSubtotal` AND `totalAmount`. There is a single resync seam
(`_resyncBillingSheetTotalsTx`) and a single invoice-propagation seam
(`_propagateBillingSheetDeltaToInvoiceTx`) in storage.ts — route new write
paths through them rather than mutating items and recomputing inline.

**Why:** the original drift bug came from item write paths that changed line
items without recomputing the sheet total, and NO billing-sheet write path
propagated to the parent invoice at all, so added parts were silently
un-billed and the guard blocked the PDF.

**Add-parts repair semantics:** when reconciling existing drift, recompute the
sheet total to `parts + labor` and fold the (positive) delta into the parent
invoice's parts + total — i.e. the customer is billed the missing parts. This
was the explicit product decision, not "lower the total to match".

**How to apply:** when touching any billing-sheet item path, confirm it ends
in a `_resyncBillingSheetTotalsTx` call inside a transaction. The
`replaceBillingSheetItemsWithResync` variant is intentionally labor-preserving
(recomputes laborSubtotal from items, not from a stale value) and is locked by
a source-scan guard — do not reroute it through the full recompute seam.
