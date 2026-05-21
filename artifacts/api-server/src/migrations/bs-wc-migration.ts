// Task #808 — Extracted migration module for BS-WC → wet_check_billings.
// All per-row logic, reconciliation, and checkpointing live here.
// The CLI script (scripts/migrate-bs-wc-to-wet-check-billings.ts) is a
// thin wrapper over this module. The HTTP admin endpoints call runMigration
// directly via the job-state tracker in lib/migration-runner-state.ts.

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

export function mapStatus(bsStatus: string): string {
  switch (bsStatus) {
    case "draft":
      return "submitted";
    case "submitted":
      return "submitted";
    case "pending_manager_review":
      return "pending_manager_review";
    case "completed":
      return "pending_manager_review";
    case "approved":
      return "approved_passed_to_billing";
    case "approved_passed_to_billing":
      return "approved_passed_to_billing";
    case "billed":
      return "billed";
    default:
      throw new Error(`unrecognized billing_sheets.status: '${bsStatus}'`);
  }
}

// ── Billing number counter ────────────────────────────────────────────────────

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

// Convenience alias — returns the reconciliation report for a given phase label.
// Phase argument is informational only; both phases call the same queries.
export async function getReconciliationReport(
  _phase: "pre" | "post",
): Promise<ReconciliationReport> {
  return runReconciliationQueries();
}

// ── Per-row migration ─────────────────────────────────────────────────────────

export interface RowMigrationResult {
  wcbId: number;
  wcbNumber: string;
  findingsUpdated: number;
  invoiceItemsUpdated: number;
  bsiDeleted: number;
  totalAmount: number;
}

export async function migrateRow(bsId: number): Promise<RowMigrationResult> {
  return db.transaction(async (tx) => {
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

    const wcbStatus = mapStatus(bs.status);

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

    const wcbNumber = await allocateBillingNumberInTx(tx);

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

    const fuRes = await tx
      .update(wetCheckFindings)
      .set({ wetCheckBillingId: wcbId, billingSheetId: null })
      .where(eq(wetCheckFindings.billingSheetId, bsId));
    const findingsUpdated = fuRes.rowCount ?? 0;

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

    const bsiRes = await tx
      .delete(billingSheetItems)
      .where(eq(billingSheetItems.billingSheetId, bsId));
    const bsiDeleted = bsiRes.rowCount ?? 0;

    await tx.delete(billingSheets).where(eq(billingSheets.id, bsId));

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

// ── Migration runner ──────────────────────────────────────────────────────────

export interface MigrationOptions {
  dryRun: boolean;
  batchSize: number;
  abortOnError: boolean;
  bsIdFilter?: Set<number>;
  /** When set, the runner checks this token at the top of every row
   * iteration and stops early (with failed=0 for the cancelled rows). */
  cancelToken?: { cancelled: boolean };
  /** Optional progress callback fired after each row. */
  onProgress?: (progress: {
    processed: number;
    total: number;
    failed: number;
    currentBsId: number;
  }) => void;
}

export interface MigrationResult {
  migrated: number;
  skippedAlreadyDone: number;
  failed: number;
  failedIds: number[];
  preReport: ReconciliationReport;
  postReport?: ReconciliationReport;
  assertionsPassed: boolean;
  cancelledEarly?: boolean;
}

export async function runMigration(opts: MigrationOptions): Promise<MigrationResult> {
  const { dryRun, batchSize, abortOnError, bsIdFilter, cancelToken, onProgress } = opts;

  const preReport = await runReconciliationQueries();

  if (dryRun) {
    return {
      migrated: 0,
      skippedAlreadyDone: 0,
      failed: 0,
      failedIds: [],
      preReport,
      assertionsPassed: true,
    };
  }

  await ensureWcBillingCounterSeeded();

  const doneSet = await loadIdSet(DONE_KEY);
  const failedSet = await loadIdSet(FAILED_KEY);

  const allBsWcRows = await db
    .select({ id: billingSheets.id })
    .from(billingSheets)
    .where(sql`${billingSheets.billingNumber} LIKE 'BS-WC-%'`)
    .orderBy(billingSheets.id);

  let candidates = allBsWcRows.map((r) => r.id);
  if (bsIdFilter && bsIdFilter.size > 0) {
    candidates = candidates.filter((id) => bsIdFilter.has(id));
  }

  const total = candidates.filter((id) => !doneSet.has(id)).length;
  let migrated = 0;
  let skippedAlreadyDone = 0;
  let failed = 0;
  const failedIds: number[] = [];
  let migratedTotalValue = 0;
  let cancelledEarly = false;

  for (let offset = 0; offset < candidates.length; offset += batchSize) {
    const batch = candidates.slice(offset, offset + batchSize);

    for (const bsId of batch) {
      // Check cancel token at the top of every iteration.
      if (cancelToken?.cancelled) {
        cancelledEarly = true;
        break;
      }

      if (doneSet.has(bsId)) {
        skippedAlreadyDone += 1;
        continue;
      }

      try {
        const result = await migrateRow(bsId);
        migrated += 1;
        migratedTotalValue += result.totalAmount;
        doneSet.add(bsId);
        onProgress?.({
          processed: migrated,
          total,
          failed,
          currentBsId: bsId,
        });
      } catch (err) {
        failed += 1;
        failedIds.push(bsId);
        const msg = err instanceof Error ? err.message : String(err);
        const stage = (err as { stage?: string }).stage ?? "unknown";
        try {
          failedSet.add(bsId);
          await saveIdSet(FAILED_KEY, failedSet);
          await appendFailureDetail({ id: bsId, error: msg, stage, at: new Date().toISOString() });
        } catch {
          // checkpoint save failures are best-effort
        }
        if (abortOnError) break;
      }
    }

    if (cancelledEarly) break;
    if (abortOnError && failed > 0) break;
  }

  const postReport = await runReconciliationQueries();

  const expectedRemainingBsWc = failed;
  const expectedWcbCount = preReport.wcbCount + migrated;
  const expectedPreTotal = migratedTotalValue + postReport.bsWcTotalValue;

  const assertions: Array<{ name: string; pass: boolean }> = [
    {
      name: "remaining_bs_wc_equals_failed",
      pass: cancelledEarly || postReport.bsWcCount === expectedRemainingBsWc,
    },
    {
      name: "wcb_count_matches",
      pass: postReport.wcbCount === expectedWcbCount,
    },
    {
      name: "totals_match",
      pass: Math.abs(preReport.bsWcTotalValue - expectedPreTotal) < 0.01,
    },
    {
      name: "no_dangling_findings",
      pass: postReport.danglingFindingsBsWcId === 0,
    },
    {
      name: "no_dangling_invoice_items",
      pass: postReport.danglingInvoiceItemsBsWcId === 0,
    },
  ];

  const assertionsPassed = assertions.every((a) => a.pass);

  return {
    migrated,
    skippedAlreadyDone,
    failed,
    failedIds,
    preReport,
    postReport,
    assertionsPassed,
    cancelledEarly,
  };
}
