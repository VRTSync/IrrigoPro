// Task #796 — Slice 5: Migrate existing BS-WC billing_sheets rows to
// wet_check_billings, update all FK references, and delete the old rows.
//
// This script is written now but MUST NOT be run in production until
// Slice 6 (the conversion-path switch) has been deployed. Running it
// before Slice 6 will leave newly submitted wet checks still writing to
// billing_sheets (wrong table) while historical data is in wet_check_billings.
//
// Usage:
//   node --import tsx/esm \
//     artifacts/api-server/src/scripts/migrate-bs-wc-to-wet-check-billings.ts \
//     [--dry-run] [--batch=50] [--abort-on-error] [--bs-ids=1,2,3]
//
// Flags:
//   --dry-run         Print the pre-migration reconciliation report and exit.
//                     No writes are made.
//   --batch=N         Process N rows before logging progress (default 50).
//   --abort-on-error  Stop the entire migration on the first row failure.
//                     Default: true. Pass --no-abort-on-error to continue.
//   --bs-ids=1,2,3    Only migrate specific billing_sheet IDs (comma-separated).
//
// Resumable: processed billing_sheet ids are checkpointed to app_settings
//   key bsWcMigration.done        (JSON array of numbers)
//   key bsWcMigration.failed      (JSON array of numbers)
//   key bsWcMigration.failedDetails (JSON array of {id, error, stage, at})
//
// Rollback: not supported. Restoration requires restoring from DB backup.
// The script is intentionally one-directional.
//
// Atomicity guarantee:
//   Every row migration is a SINGLE db.transaction(...) call. Steps (a)–(k)
//   all run inside that transaction, including the billing-number allocation
//   (via tx.execute) and the WCB insert (via tx.insert). If any step fails
//   the entire tx is rolled back — no partial writes escape.

try { (process.stdout as unknown as { _handle?: { setBlocking?: (b: boolean) => void } })._handle?.setBlocking?.(true); } catch {}
try { (process.stderr as unknown as { _handle?: { setBlocking?: (b: boolean) => void } })._handle?.setBlocking?.(true); } catch {}

import { db } from "../db";
import {
  billingSheets,
  wetCheckBillings,
  wetCheckFindings,
  invoiceItems,
  billingSheetItems,
  manualPartReviews,
  appSettings,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";

// ── Checkpoint keys ───────────────────────────────────────────────────────────

const DONE_KEY = "bsWcMigration.done";
const FAILED_KEY = "bsWcMigration.failed";
const FAILED_DETAILS_KEY = "bsWcMigration.failedDetails";

// ── CLI flag helpers ──────────────────────────────────────────────────────────

export function parseFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

export function parseArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const n = Number(raw.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseBsIds(): Set<number> | undefined {
  const raw = process.argv.find((a) => a.startsWith("--bs-ids="));
  if (!raw) return undefined;
  const part = raw.split("=")[1];
  if (!part) return undefined;
  const ids = part
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return ids.length > 0 ? new Set(ids) : undefined;
}

function parseAbortOnError(): boolean {
  if (process.argv.includes("--no-abort-on-error")) return false;
  return true;
}

// ── Checkpoint helpers ────────────────────────────────────────────────────────

export async function loadIdSet(key: string): Promise<Set<number>> {
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
    // Corrupt — start fresh.
  }
  return new Set();
}

export interface FailureDetail {
  id: number;
  error: string;
  stage: string;
  at: string;
}

export async function loadFailureDetails(): Promise<FailureDetail[]> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, FAILED_DETAILS_KEY));
  if (rows.length === 0) return [];
  try {
    const parsed = JSON.parse(String((rows[0] as { value: string }).value));
    return Array.isArray(parsed) ? (parsed as FailureDetail[]) : [];
  } catch {
    return [];
  }
}

async function saveIdSet(key: string, ids: Set<number>): Promise<void> {
  const value = JSON.stringify(Array.from(ids).sort((a, b) => a - b));
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

async function appendFailureDetail(detail: FailureDetail): Promise<void> {
  const existing = await loadFailureDetails();
  const value = JSON.stringify([...existing, detail]);
  await db
    .insert(appSettings)
    .values({ key: FAILED_DETAILS_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

// ── Status mapping ────────────────────────────────────────────────────────────

// Maps billing_sheets.status → wet_check_billings.status.
// Throws if the input status is not recognized.
export function mapStatus(bsStatus: string): string {
  switch (bsStatus) {
    case "draft":
      // Draft BS-WC rows are treated as submitted in the new system —
      // there is no draft state in wet_check_billings.
      return "submitted";
    case "submitted":
      return "submitted";
    case "pending_manager_review":
      return "pending_manager_review";
    case "completed":
      // Legacy BS status — maps to pending_manager_review in the new system.
      return "pending_manager_review";
    case "approved":
      // Legacy BS status — maps to approved_passed_to_billing.
      return "approved_passed_to_billing";
    case "approved_passed_to_billing":
      return "approved_passed_to_billing";
    case "billed":
      return "billed";
    default:
      throw new Error(`unrecognized billing_sheets.status: '${bsStatus}'`);
  }
}

// ── Billing number counter — setup + transactional allocation ─────────────────

// Ensure the billing_number_counters table and the WC-{year}- seed row exist
// before any migration starts. These are idempotent DDL/INSERT ops that are
// safe to run outside the per-row transaction. Must be called once at startup.
export async function ensureWcBillingCounterSeeded(): Promise<void> {
  const year = new Date().getFullYear();
  const prefix = `WC-${year}-`;

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS billing_number_counters (
      prefix TEXT PRIMARY KEY,
      last_seq INTEGER NOT NULL DEFAULT 0
    )
  `);

  await db.execute(sql`
    INSERT INTO billing_number_counters (prefix, last_seq)
    VALUES (${prefix}, 999)
    ON CONFLICT (prefix) DO NOTHING
  `);
}

// Allocate the next WC billing number using the provided transaction context.
// The UPDATE is part of the surrounding tx — if the tx rolls back, the
// sequence increment is also rolled back and the number is never consumed.
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function allocateBillingNumberInTx(tx: DbTx): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `WC-${year}-`;

  const result = await tx.execute(sql`
    UPDATE billing_number_counters
    SET last_seq = last_seq + 1
    WHERE prefix = ${prefix}
    RETURNING last_seq
  `);
  const seq = Number((result.rows[0] as { last_seq: unknown }).last_seq);
  if (!Number.isFinite(seq) || seq <= 0) {
    throw Object.assign(
      new Error(`billing_number_counters returned unexpected seq=${seq} for prefix '${prefix}'`),
      { stage: "alloc_billing_number" },
    );
  }
  return `${prefix}${seq.toString().padStart(4, "0")}`;
}

// ── Reconciliation queries ────────────────────────────────────────────────────

export interface ReconciliationReport {
  bsWcCount: number;
  bsWcDistinctCustomers: number;
  bsWcTotalValue: number;
  bsWcAlreadyBilled: number;
  findingsLinkedToBsWc: number;
  invoiceItemsLinkedToBsWc: number;
  wcbCount: number;
  danglingFindingsBsWcId: number;
  danglingInvoiceItemsBsWcId: number;
}

export async function runReconciliationQueries(): Promise<ReconciliationReport> {
  const bsWcResult = await db.execute<{
    count: string;
    distinct_customers: string;
    total_value: string;
    already_billed: string;
  }>(sql`
    SELECT
      COUNT(*)                                            AS count,
      COUNT(DISTINCT customer_id)                         AS distinct_customers,
      COALESCE(SUM(total_amount), 0)::text                AS total_value,
      COUNT(*) FILTER (WHERE invoice_id IS NOT NULL)      AS already_billed
    FROM billing_sheets
    WHERE billing_number LIKE 'BS-WC-%'
  `);
  const bsWcRow = bsWcResult.rows[0] ?? {
    count: "0", distinct_customers: "0", total_value: "0", already_billed: "0",
  };

  const findingsResult = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*) AS count
    FROM wet_check_findings
    WHERE billing_sheet_id IN (
      SELECT id FROM billing_sheets WHERE billing_number LIKE 'BS-WC-%'
    )
  `);
  const findingsRow = findingsResult.rows[0] ?? { count: "0" };

  const invoiceItemsResult = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*) AS count
    FROM invoice_items
    WHERE billing_sheet_id IN (
      SELECT id FROM billing_sheets WHERE billing_number LIKE 'BS-WC-%'
    )
  `);
  const invoiceItemsRow = invoiceItemsResult.rows[0] ?? { count: "0" };

  const wcbResult = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*) AS count FROM wet_check_billings
  `);
  const wcbRow = wcbResult.rows[0] ?? { count: "0" };

  // Dangling FK checks (meaningful both pre- and post-migration).
  const danglingFindingsResult = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*) AS count
    FROM wet_check_findings
    WHERE billing_sheet_id IS NOT NULL
      AND billing_sheet_id NOT IN (SELECT id FROM billing_sheets)
  `);
  const danglingFindingsRow = danglingFindingsResult.rows[0] ?? { count: "0" };

  const danglingInvoiceResult = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*) AS count
    FROM invoice_items
    WHERE billing_sheet_id IS NOT NULL
      AND billing_sheet_id NOT IN (SELECT id FROM billing_sheets)
  `);
  const danglingInvoiceRow = danglingInvoiceResult.rows[0] ?? { count: "0" };

  return {
    bsWcCount: Number(bsWcRow.count),
    bsWcDistinctCustomers: Number(bsWcRow.distinct_customers),
    bsWcTotalValue: parseFloat(String(bsWcRow.total_value)) || 0,
    bsWcAlreadyBilled: Number(bsWcRow.already_billed),
    findingsLinkedToBsWc: Number(findingsRow.count),
    invoiceItemsLinkedToBsWc: Number(invoiceItemsRow.count),
    wcbCount: Number(wcbRow.count),
    danglingFindingsBsWcId: Number(danglingFindingsRow.count),
    danglingInvoiceItemsBsWcId: Number(danglingInvoiceRow.count),
  };
}

function printReport(label: string, report: ReconciliationReport): void {
  console.log(`[bs-wc-migration] ${label}:`);
  console.log(`  billing_sheets WHERE billing_number LIKE 'BS-WC-%':`);
  console.log(
    `    count=${report.bsWcCount} distinct_customers=${report.bsWcDistinctCustomers}` +
    ` total_value=${report.bsWcTotalValue.toFixed(2)} already_billed=${report.bsWcAlreadyBilled}`,
  );
  console.log(`  wet_check_findings linked to BS-WC rows: ${report.findingsLinkedToBsWc}`);
  console.log(`  invoice_items linked to BS-WC rows: ${report.invoiceItemsLinkedToBsWc}`);
  console.log(`  wet_check_billings total count: ${report.wcbCount}`);
  console.log(`  dangling findings FK: ${report.danglingFindingsBsWcId}`);
  console.log(`  dangling invoice_items FK: ${report.danglingInvoiceItemsBsWcId}`);
}

// ── Per-row migration ─────────────────────────────────────────────────────────

export interface RowMigrationResult {
  wcbId: number;
  wcbNumber: string;
  findingsUpdated: number;
  invoiceItemsUpdated: number;
  bsiDeleted: number;
  /** totalAmount captured from the BS row, for the post-run totals assertion. */
  totalAmount: number;
}

// All 11 steps — (a) through (k) per the spec — execute inside a single
// db.transaction() call. If ANY step throws, the entire transaction rolls back:
//   - the WCB insert is rolled back
//   - the billing-number sequence increment is rolled back
//   - no FK updates, no BS deletion, no checkpoint update escapes
// No compensating cleanup is needed or used.
export async function migrateRow(bsId: number): Promise<RowMigrationResult> {
  return db.transaction(async (tx) => {
    // (a) Load and verify the BS row.
    const bsRows = await tx.select().from(billingSheets).where(eq(billingSheets.id, bsId));
    const bs = bsRows[0];
    if (!bs) {
      throw Object.assign(new Error(`billing_sheet id=${bsId} not found`), { stage: "load" });
    }
    if (!bs.billingNumber.startsWith("BS-WC-")) {
      throw Object.assign(
        new Error(`billing_sheet id=${bsId} has number '${bs.billingNumber}' — not a BS-WC row`),
        { stage: "verify" },
      );
    }

    // (b) Derive wetCheckId from findings. Abort if none.
    const findingRows = await tx
      .select({ wetCheckId: wetCheckFindings.wetCheckId })
      .from(wetCheckFindings)
      .where(eq(wetCheckFindings.billingSheetId, bsId));
    const distinctWetCheckIds = [...new Set(findingRows.map((r) => r.wetCheckId))];
    if (distinctWetCheckIds.length === 0) {
      throw Object.assign(
        new Error(
          `billing_sheet id=${bsId} (${bs.billingNumber}) has no linked wet_check_findings — cannot derive wetCheckId`,
        ),
        { stage: "derive_wet_check_id" },
      );
    }
    if (distinctWetCheckIds.length > 1) {
      throw Object.assign(
        new Error(
          `billing_sheet id=${bsId} (${bs.billingNumber}) links to multiple wet checks (${distinctWetCheckIds.join(",")}) — ambiguous`,
        ),
        { stage: "derive_wet_check_id" },
      );
    }
    const wetCheckId = distinctWetCheckIds[0]!;

    // (d) Map status — throws on unrecognized value.
    const wcbStatus = mapStatus(bs.status);

    // (i) Check manual_part_reviews before doing any destructive writes.
    const mprRows = await tx
      .select({ id: manualPartReviews.id })
      .from(manualPartReviews)
      .where(eq(manualPartReviews.billingSheetId, bsId));
    if (mprRows.length > 0) {
      throw Object.assign(
        new Error(
          `billing_sheet id=${bsId} (${bs.billingNumber}) has ${mprRows.length} pending manual_part_reviews — resolve before migrating`,
        ),
        { stage: "manual_part_reviews_check" },
      );
    }

    // (c) Allocate WC billing number inside the transaction. The sequence
    // UPDATE is part of this tx — if anything below throws, the increment
    // is rolled back and the number is never used.
    const wcbNumber = await allocateBillingNumberInTx(tx);

    // (e) Insert the new wet_check_billings row inside the transaction.
    const [wcbRow] = await tx.insert(wetCheckBillings).values({
      billingNumber: wcbNumber,
      customerId: bs.customerId ?? undefined,
      customerName: bs.customerName,
      propertyAddress: bs.propertyAddress,
      workDate: bs.workDate,
      technicianName: bs.technicianName,
      technicianId: bs.technicianId ?? undefined,
      wetCheckId,
      status: wcbStatus,
      totalHours: bs.totalHours,
      laborRate: bs.laborRate,
      laborSubtotal: bs.laborSubtotal,
      partsSubtotal: bs.partsSubtotal,
      totalAmount: bs.totalAmount,
      appliedLaborRate: bs.appliedLaborRate ?? undefined,
      invoiceId: bs.invoiceId ?? undefined,
      billedAt: bs.billedAt ?? undefined,
      photos: bs.photos ?? [],
      notes: bs.notes ?? undefined,
      branchName: bs.branchName ?? undefined,
      approvedBy: bs.approvedBy ?? undefined,
      approvedByUserId: bs.approvedByUserId ?? undefined,
      approvedAt: bs.approvedAt ?? undefined,
      approvedTotal: bs.approvedTotal ?? undefined,
      noPhotosNeeded: bs.noPhotosNeeded,
      noPhotosNeededBy: bs.noPhotosNeededBy ?? undefined,
      noPhotosNeededAt: bs.noPhotosNeededAt ?? undefined,
    }).returning();
    const wcbId = wcbRow!.id;

    // (f) Update wet_check_findings FKs.
    const fuRes = await tx
      .update(wetCheckFindings)
      .set({ wetCheckBillingId: wcbId, billingSheetId: null })
      .where(eq(wetCheckFindings.billingSheetId, bsId));
    const findingsUpdated = fuRes.rowCount ?? 0;

    // (g) Update invoice_items FKs and sourceType.
    const iiRes = await tx
      .update(invoiceItems)
      .set({
        wetCheckBillingId: wcbId,
        billingSheetId: null,
        sourceType: "wet_check_billing",
        sourceId: wcbId,
      })
      .where(eq(invoiceItems.billingSheetId, bsId));
    const invoiceItemsUpdated = iiRes.rowCount ?? 0;

    // (h) Delete billing_sheet_items.
    const bsiRes = await tx
      .delete(billingSheetItems)
      .where(eq(billingSheetItems.billingSheetId, bsId));
    const bsiDeleted = bsiRes.rowCount ?? 0;

    // (j) Delete the BS row.
    await tx.delete(billingSheets).where(eq(billingSheets.id, bsId));

    // (k) Append bs.id to the done checkpoint inside the same transaction.
    const doneRows = await tx.select().from(appSettings).where(eq(appSettings.key, DONE_KEY));
    let doneSet: Set<number> = new Set();
    if (doneRows.length > 0) {
      try {
        const parsed = JSON.parse(String((doneRows[0] as { value: string }).value));
        if (Array.isArray(parsed)) {
          doneSet = new Set(
            parsed.map((v: unknown) => Number(v)).filter((n) => Number.isFinite(n)),
          );
        }
      } catch { /* start fresh */ }
    }
    doneSet.add(bsId);
    const doneValue = JSON.stringify(Array.from(doneSet).sort((a, b) => a - b));
    await tx
      .insert(appSettings)
      .values({ key: DONE_KEY, value: doneValue })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: doneValue, updatedAt: new Date() },
      });

    return {
      wcbId,
      wcbNumber,
      findingsUpdated,
      invoiceItemsUpdated,
      bsiDeleted,
      totalAmount: parseFloat(String(bs.totalAmount)) || 0,
    };
  });
}

// ── Main migration runner ─────────────────────────────────────────────────────

export interface MigrationOptions {
  dryRun: boolean;
  batchSize: number;
  abortOnError: boolean;
  bsIdFilter?: Set<number>;
}

export interface MigrationResult {
  migrated: number;
  skippedAlreadyDone: number;
  failed: number;
  failedIds: number[];
  preReport: ReconciliationReport;
  postReport?: ReconciliationReport;
  assertionsPassed: boolean;
}

export async function runMigration(opts: MigrationOptions): Promise<MigrationResult> {
  const { dryRun, batchSize, abortOnError, bsIdFilter } = opts;

  // Pre-migration reconciliation (always runs, even in dry-run).
  const preReport = await runReconciliationQueries();
  printReport("PRE-MIGRATION REPORT", preReport);

  if (dryRun) {
    console.log("[bs-wc-migration] --dry-run: no writes will be made. Exiting.");
    return {
      migrated: 0,
      skippedAlreadyDone: 0,
      failed: 0,
      failedIds: [],
      preReport,
      assertionsPassed: true,
    };
  }

  // Ensure the billing counter table and seed row exist before any transactions.
  await ensureWcBillingCounterSeeded();

  // Load checkpoint.
  const doneSet = await loadIdSet(DONE_KEY);
  const failedSet = await loadIdSet(FAILED_KEY);
  console.log(
    `[bs-wc-migration] checkpoint: ${doneSet.size} already done, ${failedSet.size} previously failed`,
  );

  // Fetch all BS-WC ids ordered by id ascending (stable processing order).
  const allBsWcRows = await db
    .select({ id: billingSheets.id })
    .from(billingSheets)
    .where(sql`${billingSheets.billingNumber} LIKE 'BS-WC-%'`)
    .orderBy(billingSheets.id);

  // Apply --bs-ids filter if provided; preserve natural ordering.
  let candidates = allBsWcRows.map((r) => r.id);
  if (bsIdFilter && bsIdFilter.size > 0) {
    candidates = candidates.filter((id) => bsIdFilter.has(id));
  }

  console.log(
    `[bs-wc-migration] ${allBsWcRows.length} total BS-WC rows, ` +
    `${candidates.length} in working set (checkpoint has ${doneSet.size} done)`,
  );

  let migrated = 0;
  let skippedAlreadyDone = 0;
  let failed = 0;
  const failedIds: number[] = [];
  // Accumulate total_amount for the post-run totals assertion.
  let migratedTotalValue = 0;

  for (let offset = 0; offset < candidates.length; offset += batchSize) {
    const batch = candidates.slice(offset, offset + batchSize);

    for (const bsId of batch) {
      // Check checkpoint — skip if already processed in a prior run.
      if (doneSet.has(bsId)) {
        skippedAlreadyDone += 1;
        continue;
      }

      const rowStart = Date.now();
      try {
        const result = await migrateRow(bsId);
        migrated += 1;
        migratedTotalValue += result.totalAmount;
        doneSet.add(bsId);
        console.log(
          JSON.stringify({
            event: "bs_wc_migration.row_done",
            bs_id: bsId,
            wcb_id: result.wcbId,
            wcb_number: result.wcbNumber,
            findings_updated: result.findingsUpdated,
            invoice_items_updated: result.invoiceItemsUpdated,
            bsi_deleted: result.bsiDeleted,
            total_amount: result.totalAmount,
            duration_ms: Date.now() - rowStart,
          }),
        );
      } catch (err) {
        failed += 1;
        failedIds.push(bsId);
        const msg = err instanceof Error ? err.message : String(err);
        const stage = (err as { stage?: string }).stage ?? "unknown";
        console.error(
          JSON.stringify({
            event: "bs_wc_migration.row_failed",
            bs_id: bsId,
            stage,
            error: msg,
            duration_ms: Date.now() - rowStart,
          }),
        );
        // Record failure in a separate (non-failing) transaction.
        try {
          failedSet.add(bsId);
          await saveIdSet(FAILED_KEY, failedSet);
          await appendFailureDetail({ id: bsId, error: msg, stage, at: new Date().toISOString() });
        } catch (cpErr) {
          console.error("[bs-wc-migration] failed to save failure checkpoint:", cpErr);
        }
        if (abortOnError) {
          console.error(`[bs-wc-migration] aborting due to --abort-on-error (bs_id=${bsId})`);
          break;
        }
      }
    }

    console.log(
      `[bs-wc-migration] progress: migrated=${migrated} skippedAlreadyDone=${skippedAlreadyDone} failed=${failed}`,
    );

    if (abortOnError && failed > 0) break;
  }

  // ── Post-run reconciliation and assertions ────────────────────────────────

  const postReport = await runReconciliationQueries();
  printReport("POST-MIGRATION REPORT", postReport);

  // Expected values:
  // - Remaining BS-WC rows = rows that failed (not migrated, not skipped).
  // - WCB count = pre baseline + how many we successfully migrated.
  // - Total value: pre total = sum of migrated amounts + remaining (failed) amounts.
  //   migratedTotalValue was accumulated per-row; postReport.bsWcTotalValue is the
  //   remaining (failed) rows' total. Their sum should equal preReport.bsWcTotalValue.
  const expectedRemainingBsWc = failed;
  const expectedWcbCount = preReport.wcbCount + migrated;
  const expectedPreTotal = migratedTotalValue + postReport.bsWcTotalValue;

  const assertions: Array<{ name: string; pass: boolean; detail: string }> = [
    {
      name: "remaining_bs_wc_equals_failed",
      pass: postReport.bsWcCount === expectedRemainingBsWc,
      detail: `remaining BS-WC rows=${postReport.bsWcCount}, expected=${expectedRemainingBsWc}`,
    },
    {
      name: "wcb_count_matches",
      pass: postReport.wcbCount === expectedWcbCount,
      detail: `wcb count=${postReport.wcbCount}, expected=${expectedWcbCount} (pre=${preReport.wcbCount} + migrated=${migrated})`,
    },
    {
      name: "totals_match",
      pass: Math.abs(preReport.bsWcTotalValue - expectedPreTotal) < 0.01,
      detail:
        `pre total=${preReport.bsWcTotalValue.toFixed(2)}, ` +
        `migrated=${migratedTotalValue.toFixed(2)} + remaining=${postReport.bsWcTotalValue.toFixed(2)} = ${expectedPreTotal.toFixed(2)}`,
    },
    {
      name: "no_dangling_findings",
      pass: postReport.danglingFindingsBsWcId === 0,
      detail: `dangling wet_check_findings.billing_sheet_id refs=${postReport.danglingFindingsBsWcId}`,
    },
    {
      name: "no_dangling_invoice_items",
      pass: postReport.danglingInvoiceItemsBsWcId === 0,
      detail: `dangling invoice_items.billing_sheet_id refs=${postReport.danglingInvoiceItemsBsWcId}`,
    },
  ];

  let assertionsPassed = true;
  for (const a of assertions) {
    const icon = a.pass ? "✓" : "✗";
    console.log(`[bs-wc-migration] assertion ${icon} ${a.name}: ${a.detail}`);
    if (!a.pass) assertionsPassed = false;
  }

  console.log(
    JSON.stringify({
      event: "bs_wc_migration.run_done",
      migrated,
      skipped_already_done: skippedAlreadyDone,
      failed,
      failed_ids: failedIds,
      migrated_total_value: migratedTotalValue,
      assertions_passed: assertionsPassed,
      pre: {
        bs_wc_count: preReport.bsWcCount,
        wcb_count: preReport.wcbCount,
        total_value: preReport.bsWcTotalValue,
      },
      post: {
        bs_wc_count: postReport.bsWcCount,
        wcb_count: postReport.wcbCount,
        total_value: postReport.bsWcTotalValue,
      },
    }),
  );

  return {
    migrated,
    skippedAlreadyDone,
    failed,
    failedIds,
    preReport,
    postReport,
    assertionsPassed,
  };
}

// ── CLI entry point ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const dryRun = parseFlag("dry-run");
  const batchSize = parseArg("batch", 50);
  const abortOnError = parseAbortOnError();
  const bsIdFilter = parseBsIds();

  console.log(
    `[bs-wc-migration] starting (dryRun=${dryRun} batch=${batchSize} abortOnError=${abortOnError} ` +
    `bsIdFilter=${bsIdFilter ? [...bsIdFilter].join(",") : "all"})`,
  );

  const result = await runMigration({ dryRun, batchSize, abortOnError, bsIdFilter });

  if (!result.assertionsPassed) {
    console.error("[bs-wc-migration] one or more post-run assertions FAILED — check the report above");
    process.exit(1);
  }

  console.log("[bs-wc-migration] complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[bs-wc-migration] fatal:", err);
  process.exit(1);
});
