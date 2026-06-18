// Task #1422 / #1434 — Real-DB dependency bindings for the billing-sheet /
// invoice total reconciliation core.
//
// The pure repair math + orchestration live in
// reconcile-billing-sheet-invoice-totals-core.ts. This module supplies the
// concrete Postgres-backed `ReconciliationDeps` (resume set, failure log,
// candidate query, and the atomic repair write). Both the CLI entry point
// (reconcile-billing-sheet-invoice-totals.ts) and the admin migration
// (lib/migrations/reconcile-billing-sheet-invoice-totals.ts) build their
// deps from here so the DB wiring lives in exactly one place.

import { db } from "../db";
import { billingSheets, invoices, appSettings } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  RECONCILE_DONE_KEY,
  TOLERANCE,
  type ReconciliationDeps,
  type DriftedSheetRow,
  type SheetRepair,
  type FailureEntry,
} from "./reconcile-billing-sheet-invoice-totals-core";

export const RECONCILE_FAIL_KEY = "reconcileBillingSheetInvoiceTotals.failed";

async function loadIdSet(key: string): Promise<Set<number>> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, key));
  if (rows.length === 0) return new Set();
  try {
    const parsed = JSON.parse(String((rows[0] as { value: string }).value));
    if (Array.isArray(parsed)) {
      return new Set(
        parsed
          .map((v) => (typeof v === "number" ? v : Number(v)))
          .filter((n) => Number.isFinite(n)),
      );
    }
  } catch {
    // Corrupt value — start fresh.
  }
  return new Set();
}

async function saveDoneSet(ids: Set<number>): Promise<void> {
  const value = JSON.stringify(Array.from(ids).sort((a, b) => a - b));
  await db
    .insert(appSettings)
    .values({ key: RECONCILE_DONE_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

async function loadFailures(): Promise<FailureEntry[]> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, RECONCILE_FAIL_KEY));
  if (rows.length === 0) return [];
  try {
    const parsed = JSON.parse(String((rows[0] as { value: string }).value));
    return Array.isArray(parsed) ? (parsed as FailureEntry[]) : [];
  } catch {
    return [];
  }
}

async function appendFailure(entry: FailureEntry): Promise<void> {
  const existing = await loadFailures();
  const value = JSON.stringify([...existing, entry]);
  await db
    .insert(appSettings)
    .values({ key: RECONCILE_FAIL_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

/**
 * Read-only candidate query: invoiced billing sheets whose
 * `parts + labor` disagrees with the stored `total_amount` beyond tolerance.
 * Used by both `preview()` (no further mutation) and `run()`.
 */
async function getCandidates(): Promise<DriftedSheetRow[]> {
  const rows = await db
    .select({
      id: billingSheets.id,
      invoiceId: billingSheets.invoiceId,
      partsSubtotal: billingSheets.partsSubtotal,
      laborSubtotal: billingSheets.laborSubtotal,
      totalAmount: billingSheets.totalAmount,
    })
    .from(billingSheets)
    .where(
      sql`${billingSheets.invoiceId} IS NOT NULL AND ABS(
        (COALESCE(${billingSheets.partsSubtotal}, 0) + COALESCE(${billingSheets.laborSubtotal}, 0))
        - COALESCE(${billingSheets.totalAmount}, 0)
      ) > ${TOLERANCE}`,
    )
    .orderBy(billingSheets.id);
  return rows.map((r) => ({
    id: r.id,
    invoiceId: r.invoiceId as number,
    partsSubtotal: r.partsSubtotal,
    laborSubtotal: r.laborSubtotal,
    totalAmount: r.totalAmount,
  }));
}

function makeApplyRepair(log: (msg: string) => void) {
  return async function applyRepair(row: DriftedSheetRow, repair: SheetRepair): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .update(billingSheets)
        .set({ totalAmount: repair.newSheetTotal.toFixed(2), updatedAt: new Date() })
        .where(eq(billingSheets.id, row.id));

      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, row.invoiceId));
      if (!inv) {
        throw new Error(`parent invoice ${row.invoiceId} not found for billing sheet ${row.id}`);
      }
      const newParts = (parseFloat(String(inv.partsSubtotal ?? 0)) || 0) + repair.delta;
      const newTotal = (parseFloat(String(inv.totalAmount ?? 0)) || 0) + repair.delta;
      await tx
        .update(invoices)
        .set({ partsSubtotal: newParts.toFixed(2), totalAmount: newTotal.toFixed(2), updatedAt: new Date() })
        .where(eq(invoices.id, row.invoiceId));

      log(
        `[reconcile-bs-invoice-totals] APPLIED billing_sheet ${row.id} total=${repair.newSheetTotal.toFixed(2)} ` +
        `→ invoice ${row.invoiceId} partsSubtotal=${newParts.toFixed(2)} totalAmount=${newTotal.toFixed(2)} ` +
        `(delta +${repair.delta.toFixed(2)})`,
      );
    });
  };
}

/**
 * Build the Postgres-backed `ReconciliationDeps`. `log` is used for the
 * per-sheet APPLIED line (CLI passes `console.log`; the admin migration
 * passes its own logger so nothing writes to stdout from the request path).
 */
export function createReconcileDbDeps(log: (msg: string) => void = () => {}): ReconciliationDeps {
  return {
    loadIdSet,
    saveDoneSet,
    appendFailure,
    getCandidates,
    applyRepair: makeApplyRepair(log),
  };
}

export { getCandidates as getReconcileCandidates };
