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

import { runReconciliation } from "./reconcile-billing-sheet-invoice-totals-core";
import { createReconcileDbDeps } from "./reconcile-billing-sheet-invoice-totals-db";

function parseFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const n = Number(raw.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function main(): Promise<void> {
  const dryRun = parseFlag("dry-run");
  const batchSize = parseArg("batch", 500);

  console.log(`[reconcile-bs-invoice-totals] starting (dryRun=${dryRun}, batch=${batchSize})`);

  const result = await runReconciliation(
    createReconcileDbDeps(console.log),
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
