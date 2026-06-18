// Task #1422 — Reconcile billing-sheet / invoice total drift (core logic).
//
// Side-effect-free module: contains the pure repair math plus an
// injectable `runReconciliation` orchestration. The CLI entry point lives
// in reconcile-billing-sheet-invoice-totals.ts and supplies the real DB
// deps; tests supply in-memory deps so the orchestration is exercised
// without a database.
//
// Repair semantics (per Task #1422): a drifted invoiced billing sheet has
// `parts_subtotal + labor_subtotal != total_amount` because parts were added
// to its line items but the sheet total (and the parent invoice total) were
// never recomputed. The fix recomputes the sheet total to
// `parts_subtotal + labor_subtotal` (raising it by the missing parts) and
// folds the same delta into the parent invoice's `partsSubtotal` AND
// `totalAmount` — add-parts semantics, the customer is billed more.

// Same tolerance as the PDF reconciliation guard (invoice-pdf-service.ts).
export const TOLERANCE = 0.01;

export interface DriftedSheetRow {
  id: number;
  invoiceId: number;
  partsSubtotal: string | null;
  laborSubtotal: string | null;
  totalAmount: string | null;
}

export interface SheetRepair {
  /** Recomputed sheet total = parts + labor. */
  newSheetTotal: number;
  /** newSheetTotal − oldSheetTotal — the missing parts amount to fold up. */
  delta: number;
}

function toNum(val: string | number | null | undefined): number {
  if (val === null || val === undefined) return 0;
  const n = typeof val === "string" ? parseFloat(val) : val;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Pure repair math. Returns the recomputed sheet total and the delta to fold
 * into the parent invoice, or `null` when the sheet already reconciles
 * (|delta| within tolerance) so callers can skip it idempotently.
 */
export function computeSheetRepair(row: DriftedSheetRow): SheetRepair | null {
  const parts = toNum(row.partsSubtotal);
  const labor = toNum(row.laborSubtotal);
  const oldTotal = toNum(row.totalAmount);
  const newSheetTotal = parts + labor;
  const delta = newSheetTotal - oldTotal;
  if (Math.abs(delta) <= TOLERANCE) return null;
  return { newSheetTotal, delta };
}

export interface FailureEntry {
  id: number;
  error: string;
  at: string;
}

export interface ReconciliationDeps {
  loadIdSet: (key: string) => Promise<Set<number>>;
  saveDoneSet: (ids: Set<number>) => Promise<void>;
  appendFailure: (entry: FailureEntry) => Promise<void>;
  /** Invoiced billing sheets whose parts+labor != total (within tolerance). */
  getCandidates: () => Promise<DriftedSheetRow[]>;
  /**
   * Persist the repair atomically: set the sheet total to `newSheetTotal` and
   * add `delta` to the parent invoice's partsSubtotal AND totalAmount.
   */
  applyRepair: (row: DriftedSheetRow, repair: SheetRepair) => Promise<void>;
}

export interface ReconciliationOptions {
  dryRun: boolean;
  batchSize: number;
  log?: (msg: string) => void;
  logError?: (msg: string) => void;
}

export interface ReconciliationResult {
  totalCandidates: number;
  alreadyProcessed: number;
  repaired: number;
  repairedDryRun: number;
  alreadyReconciled: number;
  errors: number;
}

const DONE_KEY = "reconcileBillingSheetInvoiceTotals.done";

export async function runReconciliation(
  deps: ReconciliationDeps,
  opts: ReconciliationOptions,
): Promise<ReconciliationResult> {
  const log = opts.log ?? console.log;
  const logErr = opts.logError ?? console.error;
  const TAG = "[reconcile-bs-invoice-totals]";

  const done = await deps.loadIdSet(DONE_KEY);
  log(`${TAG} resume — done=${done.size}${opts.dryRun ? " (dry-run)" : ""}`);

  const candidates = await deps.getCandidates();
  log(`${TAG} ${candidates.length} invoiced billing sheet(s) with total drift found`);

  const pending = candidates.filter((r) => !done.has(r.id));
  const alreadyProcessed = candidates.length - pending.length;
  log(`${TAG} ${pending.length} remaining after resume filter (${alreadyProcessed} already done)`);

  let repaired = 0;
  let repairedDryRun = 0;
  let alreadyReconciled = 0;
  let errors = 0;

  for (let i = 0; i < pending.length; i += opts.batchSize) {
    const batch = pending.slice(i, i + opts.batchSize);
    for (const row of batch) {
      try {
        const repair = computeSheetRepair(row);
        if (!repair) {
          alreadyReconciled++;
          done.add(row.id);
          log(`${TAG} billing_sheet ${row.id}: already reconciled — skip`);
          continue;
        }

        log(
          `${TAG} billing_sheet ${row.id} → invoice ${row.invoiceId}: ` +
          `parts=${toNum(row.partsSubtotal).toFixed(2)} labor=${toNum(row.laborSubtotal).toFixed(2)} ` +
          `oldTotal=${toNum(row.totalAmount).toFixed(2)} newTotal=${repair.newSheetTotal.toFixed(2)} ` +
          `delta=${repair.delta.toFixed(2)}` +
          (opts.dryRun ? " (dry-run, no write)" : ""),
        );

        if (opts.dryRun) {
          repairedDryRun++;
          continue;
        }

        await deps.applyRepair(row, repair);
        repaired++;
        done.add(row.id);
      } catch (err) {
        errors++;
        const message = err instanceof Error ? err.message : String(err);
        logErr(`${TAG} billing_sheet ${row.id}: ERROR — ${message}`);
        await deps.appendFailure({ id: row.id, error: message, at: new Date().toISOString() });
      }
    }
    if (!opts.dryRun) await deps.saveDoneSet(done);
  }

  if (!opts.dryRun) await deps.saveDoneSet(done);

  log(
    `${TAG} done — candidates=${candidates.length} alreadyProcessed=${alreadyProcessed} ` +
    `repaired=${repaired} repairedDryRun=${repairedDryRun} ` +
    `alreadyReconciled=${alreadyReconciled} errors=${errors}`,
  );

  return {
    totalCandidates: candidates.length,
    alreadyProcessed,
    repaired,
    repairedDryRun,
    alreadyReconciled,
    errors,
  };
}

export const RECONCILE_DONE_KEY = DONE_KEY;
