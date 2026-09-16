// Task #1864 — Single canonical "how much has this customer spent" helper.
//
// Previously three surfaces (budget-routes, budget-alert-service,
// financial-pulse customer summary) each had hand-rolled exclusion loops
// with diverging status sets, causing the same customer to show different
// totals on different screens.
//
// This module is the ONE source of truth for customer spend in a window.
// All callers must import `computeCustomerSpend` (one customer) or
// `computeCustomerSpendBatch` (a list) from here.
//
// Task #2017 — the two Financial Pulse tabs used to hand-roll their own
// accumulation loops, so a customer could read Healthy on the Pulse tab,
// Approaching in the Accounting drill-down and Over on their own profile on
// the same afternoon. They now consume this module too. Because the
// Accounting tab loads up to 500 customers across two windows, the set-based
// `computeCustomerSpendBatch` is the real implementation and the
// single-customer function is a thin wrapper over it — one implementation of
// the spend rules, not two that have to be kept in step.
//
// Design decisions:
//   - Invoice leg: uses `storage.getInvoicesByCustomerIds` so the company-id
//     scope is the invoice's OWN company column, applied by the same storage
//     helper (and the same `_companyScopeForInvoice` predicate) the
//     single-customer reader uses.
//   - WCB leg: queries wet_check_billings directly. That table has no company
//     column, so tenancy is resolved by joining to the customer — a batch
//     takes an arbitrary id list and must not answer for a foreign customer.
//     WCBs are bucketed by `workDate` (the logical work date), NOT createdAt,
//     because that is the auditable date the wet check was performed.
//   - Excluded invoice statuses: the canonical set from `financial-pulse-math`
//     (draft, cancelled, superseded, merged, failed). Never re-declare.
//   - `merged` and `failed` invoices are excluded — their amounts already
//     live on the surviving invoice or are not revenue.
//   - Both legs sum in application code, not in SQL, so the arithmetic is
//     literally the same `toNum` coercion on both paths and rounding cannot
//     drift between the batch and a single customer.

import { db } from "./db";
import { customers, wetCheckBillings } from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { INVOICE_EXCLUDED_STATUSES, toNum } from "./financial-pulse-math";
import { storage } from "./storage";

export interface CustomerSpendResult {
  /** Sum of non-excluded invoice totals with createdAt inside the window. */
  invoiced: number;
  /** Sum of uninvoiced wet-check billing totals with workDate inside the window. */
  pendingNotBilled: number;
  /** invoiced + pendingNotBilled */
  total: number;
}

function zeroSpend(): CustomerSpendResult {
  return { invoiced: 0, pendingNotBilled: 0, total: 0 };
}

/** Coerce a column that may arrive as a Date, an ISO string, or null. */
function toSpendDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value == null) return null;
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Compute how much each of a list of customers has spent in a given window.
 *
 * Issues a FIXED number of queries (one invoice query, one wet-check query)
 * regardless of how many customer ids are passed, and returns an entry for
 * every requested id — zeroes for customers with no activity, and zeroes for
 * an id that belongs to another company.
 *
 * @param customerIds — customers to query; duplicates are collapsed
 * @param companyId   — company scope, or null ONLY for super_admin (global view)
 * @param window      — inclusive start, exclusive end (same semantics used
 *                      everywhere else in financial-pulse-math)
 */
export async function computeCustomerSpendBatch(
  customerIds: number[],
  companyId: number | null,
  window: { start: Date; end: Date },
): Promise<Map<number, CustomerSpendResult>> {
  const ids = Array.from(
    new Set(customerIds.filter((id) => typeof id === "number" && Number.isFinite(id))),
  );
  const out = new Map<number, CustomerSpendResult>();
  for (const id of ids) out.set(id, zeroSpend());
  if (ids.length === 0) return out;

  const [invoiceRows, wcbRows] = await Promise.all([
    // ── Invoice leg ──────────────────────────────────────────────────────
    // Scoped on the invoice's own company column (not the customer's), which
    // is what the single-customer storage reader has always done. Filtering
    // on the customer's company instead would make the two legs disagree for
    // any invoice whose company was ever re-stamped.
    storage.getInvoicesByCustomerIds(ids, companyId),
    // ── Uninvoiced wet-check billing leg ─────────────────────────────────
    // wet_check_billings has no company column, so tenancy comes from the
    // customer. A customer belongs to exactly one company, so this cannot
    // change a correct single-customer caller's result — it only stops a
    // batch from answering for a foreign id.
    db
      .select({
        customerId: wetCheckBillings.customerId,
        invoiceId: wetCheckBillings.invoiceId,
        totalAmount: wetCheckBillings.totalAmount,
        workDate: wetCheckBillings.workDate,
      })
      .from(wetCheckBillings)
      .innerJoin(customers, eq(wetCheckBillings.customerId, customers.id))
      .where(
        companyId == null
          ? inArray(wetCheckBillings.customerId, ids)
          : and(
              inArray(wetCheckBillings.customerId, ids),
              eq(customers.companyId, companyId),
            ),
      ),
  ]);

  for (const inv of invoiceRows) {
    if (INVOICE_EXCLUDED_STATUSES.has(inv.status)) continue; // merged & failed excluded
    const entry = inv.customerId == null ? undefined : out.get(inv.customerId);
    if (!entry) continue;
    const d = toSpendDate(inv.createdAt);
    if (!d) continue;
    if (d >= window.start && d < window.end) {
      entry.invoiced += toNum(inv.totalAmount);
      entry.total = entry.invoiced + entry.pendingNotBilled;
    }
  }

  for (const wcb of wcbRows) {
    // Only rows with invoiceId IS NULL are counted — invoiced WCBs already
    // flow through the invoice totals above.
    if (wcb.invoiceId != null) continue;
    const entry = wcb.customerId == null ? undefined : out.get(wcb.customerId);
    if (!entry) continue;
    const d = toSpendDate(wcb.workDate);
    if (!d) continue;
    if (d >= window.start && d < window.end) {
      entry.pendingNotBilled += toNum(wcb.totalAmount);
      entry.total = entry.invoiced + entry.pendingNotBilled;
    }
  }

  return out;
}

/**
 * Compute how much a customer has spent in a given window.
 *
 * Thin wrapper over `computeCustomerSpendBatch` for a single id — the spend
 * rules live in exactly one place. Signature, return shape and semantics are
 * unchanged from Task #1864, so every existing caller is untouched.
 *
 * @param customerId  — customer to query
 * @param companyId   — company scope for the invoice lookup; pass the
 *                      customer's companyId for company-scoped users,
 *                      null ONLY for super_admin (global view).
 * @param window      — inclusive start, exclusive end
 */
export async function computeCustomerSpend(
  customerId: number,
  companyId: number | null,
  window: { start: Date; end: Date },
): Promise<CustomerSpendResult> {
  const batch = await computeCustomerSpendBatch([customerId], companyId, window);
  return batch.get(customerId) ?? zeroSpend();
}

/**
 * Task #2017 — flatten a spend map to the `total` per customer, the figure the
 * budget meters read. Keeps both Financial Pulse endpoints from re-deriving it.
 */
export function spendTotals(
  batch: Map<number, CustomerSpendResult>,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const [customerId, spend] of batch) out.set(customerId, spend.total);
  return out;
}
