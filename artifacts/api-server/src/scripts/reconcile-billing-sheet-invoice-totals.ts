// Task #1422 — Reconcile billing-sheet / invoice total drift (CLI entry).
//
// Finds invoiced billing sheets where `parts_subtotal + labor_subtotal`
// disagrees with the stored `total_amount`, recomputes the sheet total, and
// folds the missing-parts delta into the parent invoice's partsSubtotal AND
// totalAmount (add-parts semantics — the customer is billed more). The pure
// repair math + orchestration live in
// reconcile-billing-sheet-invoice-totals-core.ts so they can be unit-tested
// without a database.
//
// Idempotent + resumable: processed billing-sheet ids are persisted in
// `app_settings` under `reconcileBillingSheetInvoiceTotals.done` and any
// failures under `reconcileBillingSheetInvoiceTotals.failed`, mirroring the
// existing backfill scripts. A clean re-run reports `repaired=0` because every
// row already reconciles.
//
// Run:
//   node --import tsx/esm \
//     artifacts/api-server/src/scripts/reconcile-billing-sheet-invoice-totals.ts \
//     [--dry-run] [--batch=500]

try { (process.stdout as unknown as { _handle?: { setBlocking?: (b: boolean) => void } })._handle?.setBlocking?.(true); } catch {}
try { (process.stderr as unknown as { _handle?: { setBlocking?: (b: boolean) => void } })._handle?.setBlocking?.(true); } catch {}

import { db } from "../db";
import { billingSheets, invoices, appSettings } from "@workspace/db";
import { eq, isNotNull, sql } from "drizzle-orm";
import {
  runReconciliation,
  RECONCILE_DONE_KEY,
  TOLERANCE,
  type DriftedSheetRow,
  type SheetRepair,
  type FailureEntry,
} from "./reconcile-billing-sheet-invoice-totals-core";

const FAIL_KEY = "reconcileBillingSheetInvoiceTotals.failed";

function parseFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const n = Number(raw.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

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
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, FAIL_KEY));
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
    .values({ key: FAIL_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

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

async function applyRepair(row: DriftedSheetRow, repair: SheetRepair): Promise<void> {
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

    console.log(
      `[reconcile-bs-invoice-totals] APPLIED billing_sheet ${row.id} total=${repair.newSheetTotal.toFixed(2)} ` +
      `→ invoice ${row.invoiceId} partsSubtotal=${newParts.toFixed(2)} totalAmount=${newTotal.toFixed(2)} ` +
      `(delta +${repair.delta.toFixed(2)})`,
    );
  });
}

async function main(): Promise<void> {
  const dryRun = parseFlag("dry-run");
  const batchSize = parseArg("batch", 500);

  console.log(`[reconcile-bs-invoice-totals] starting (dryRun=${dryRun}, batch=${batchSize})`);

  const result = await runReconciliation(
    { loadIdSet, saveDoneSet, appendFailure, getCandidates, applyRepair },
    { dryRun, batchSize },
  );

  console.log(
    `[reconcile-bs-invoice-totals] FINISHED — candidates=${result.totalCandidates} ` +
    `repaired=${result.repaired} repairedDryRun=${result.repairedDryRun} ` +
    `alreadyReconciled=${result.alreadyReconciled} alreadyProcessed=${result.alreadyProcessed} ` +
    `errors=${result.errors} dryRun=${dryRun}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[reconcile-bs-invoice-totals] fatal:", err);
    process.exit(1);
  });
