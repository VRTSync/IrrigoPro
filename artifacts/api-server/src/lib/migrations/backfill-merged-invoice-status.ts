// Task #1756 — Backfill merged invoice status.
//
// Historical merges set absorbed invoices to `status = 'cancelled'` and wrote a
// single audit_log row with `action = 'invoice.merged'`, `targetId = survivingId`,
// and `details.cancelledInvoiceIds` (array of absorbed ids).
//
// This migration:
//   check   — counts audit_log rows with action='invoice.merged' whose absorbed
//             invoices are still at status='cancelled'.
//   preview — lists each cancelledInvoiceId → survivingInvoiceId pair with
//             invoice numbers.
//   run     — per-company transaction: stamps `status='merged'` +
//             `merged_into_invoice_id=survivorId` on each absorbed invoice still
//             at 'cancelled'. Genuine cancels (not referenced by any merge event)
//             are untouched. Idempotent. Writes a `total_status_backfill` activity
//             entry per updated invoice.

import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { appSettings } from '@workspace/db/schema';
import { eq } from 'drizzle-orm';
import type {
  MigrationDefinition,
  MigrationStatus,
  MigrationPreview,
  MigrationStepResult,
  ProgressEmitter,
} from './types';

const MIGRATION_ID = 'backfill-merged-invoice-status-v1';
const APP_KEY = 'backfillMergedInvoiceStatus';

// Check whether the mergedIntoInvoiceId column already exists (DDL must be pushed).
async function columnExists(): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'merged_into_invoice_id'
    LIMIT 1
  `);
  return (rows as unknown as any[]).length > 0;
}

interface MergeCandidate {
  cancelledId: number;
  cancelledNumber: string;
  survivorId: number;
  survivorNumber: string;
  companyId: number;
}

// Query historical merge-cancelled pairs from the audit log.
// Each invoice.merged audit event carries `details.cancelledInvoiceIds`
// (array of absorbed ids) and `details.survivingInvoiceId` (the survivor).
// We join on the cancelled invoice rows to filter to only those still at
// status='cancelled' (idempotent: already-repaired rows are skipped).
async function findMergeCandidates(): Promise<MergeCandidate[]> {
  const rows = await db.execute(sql`
    SELECT
      absorbed.id             AS cancelled_id,
      absorbed.invoice_number  AS cancelled_number,
      survivor.id             AS survivor_id,
      survivor.invoice_number  AS survivor_number,
      survivor.company_id     AS company_id
    FROM audit_log al
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN (al.details->'cancelledInvoiceIds') IS NOT NULL
          THEN al.details->'cancelledInvoiceIds'
        ELSE '[]'::jsonb
      END
    ) AS elem
    JOIN invoices absorbed ON absorbed.id = (elem::text)::integer
                          AND absorbed.status = 'cancelled'
    JOIN invoices survivor ON survivor.id = (al.details->>'survivingInvoiceId')::integer
    WHERE al.action = 'invoice.merged'
    ORDER BY survivor.company_id, survivor.id, absorbed.id
  `);
  return (rows as unknown as any[]).map((r: any) => ({
    cancelledId: Number(r.cancelled_id),
    cancelledNumber: String(r.cancelled_number),
    survivorId: Number(r.survivor_id),
    survivorNumber: String(r.survivor_number),
    companyId: Number(r.company_id),
  }));
}

async function check(): Promise<MigrationStatus> {
  const marker = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, APP_KEY));
  if (marker.length > 0) {
    const val = marker[0].value as any;
    return { state: 'completed', completedAt: val?.completedAt ?? '' };
  }

  if (!(await columnExists())) {
    return {
      state: 'not_started',
    };
  }

  const candidates = await findMergeCandidates();
  if (candidates.length > 0) {
    return {
      state: 'partially_applied',
      details: `${candidates.length} invoice(s) need reclassification from 'cancelled' → 'merged'.`,
    };
  }

  return { state: 'not_started' };
}

async function preview(): Promise<MigrationPreview> {
  const steps = [
    {
      id: 'verify-column',
      description: "Verify 'merged_into_invoice_id' column exists (DDL must be pushed first)",
    },
    {
      id: 'find-candidates',
      description: "Scan audit_log for historical invoice.merged events; identify absorbed invoices still at status='cancelled'",
    },
    {
      id: 'reclassify',
      description: "Per-company transaction: set status='merged' + mergedIntoInvoiceId on each absorbed invoice; write activity entry; skip genuine cancels",
    },
    {
      id: 'mark-done',
      description: 'Stamp completion marker in app_settings',
    },
  ];

  const hasColumn = await columnExists();
  const candidates = hasColumn ? await findMergeCandidates() : [];

  const warnings: string[] = [];
  if (!hasColumn) {
    warnings.push("Column 'merged_into_invoice_id' not found — run `pnpm --filter @workspace/db run push` before this migration.");
  }
  if (candidates.length === 0 && hasColumn) {
    warnings.push('No merge-cancelled invoices found. Either all are already reclassified or no merges have been performed yet.');
  }

  // Build a human-readable list of pairs for the preview surface.
  const pairLines = candidates.map(
    (c) => `#${c.cancelledNumber} (id ${c.cancelledId}) → survivor #${c.survivorNumber} (id ${c.survivorId}, company ${c.companyId})`,
  );

  return {
    steps,
    orphanRows: { mergeCandidates: candidates.length },
    warnings: [
      ...warnings,
      ...pairLines,
    ],
  };
}

async function run(emit: ProgressEmitter): Promise<MigrationStepResult[]> {
  const results: MigrationStepResult[] = [];

  // ── Step 1: Verify column ────────────────────────────────────────────────
  const t1 = Date.now();
  emit({ step: 'verify-column', status: 'running' });
  const hasColumn = await columnExists();
  if (!hasColumn) {
    const err = "Column 'merged_into_invoice_id' does not exist. Run `pnpm --filter @workspace/db run push` first.";
    emit({ step: 'verify-column', status: 'failed', error: err });
    results.push({ id: 'verify-column', status: 'failed', durationMs: Date.now() - t1, error: err });
    return results;
  }
  emit({ step: 'verify-column', status: 'success' });
  results.push({ id: 'verify-column', status: 'success', durationMs: Date.now() - t1 });

  // ── Step 2: Find candidates ──────────────────────────────────────────────
  const t2 = Date.now();
  emit({ step: 'find-candidates', status: 'running' });
  const candidates = await findMergeCandidates();
  emit({ step: 'find-candidates', status: 'success', rowsAffected: candidates.length });
  results.push({ id: 'find-candidates', status: 'success', durationMs: Date.now() - t2, rowsAffected: candidates.length });

  if (candidates.length === 0) {
    // Zero candidates is unexpected when audit_log rows exist for invoice.merged
    // actions. This typically means the source was already migrated OR the audit
    // log data is absent. Fail fast rather than silently marking complete.
    const noRowsErr = 'No merge-candidate rows found. Either all absorbed invoices are already reclassified, or the audit_log contains no invoice.merged events. If this is the first run against a fresh DB, this is expected and safe to ignore by marking done manually. Otherwise, inspect the audit_log before proceeding.';
    emit({ step: 'reclassify', status: 'failed', error: noRowsErr, rowsAffected: 0 });
    results.push({ id: 'reclassify', status: 'failed', durationMs: 0, rowsAffected: 0, error: noRowsErr });
    return results;
  } else {
    // ── Step 3: Reclassify per-company in a transaction ────────────────────
    const t3 = Date.now();
    emit({ step: 'reclassify', status: 'running' });

    // Group candidates by companyId so each company's work is atomic.
    const byCompany = new Map<number, MergeCandidate[]>();
    for (const c of candidates) {
      const arr = byCompany.get(c.companyId) ?? [];
      arr.push(c);
      byCompany.set(c.companyId, arr);
    }

    let updated = 0;
    for (const [companyId, batch] of byCompany) {
      await db.transaction(async (tx) => {
        for (const c of batch) {
          await tx.execute(sql`
            UPDATE invoices
            SET
              status = 'merged',
              merged_into_invoice_id = ${c.survivorId},
              updated_at = NOW()
            WHERE id = ${c.cancelledId}
              AND status = 'cancelled'
              AND company_id = ${companyId}
          `);
          // Write a lightweight activity entry so the invoice audit trail
          // reflects the backfill.
          await tx.execute(sql`
            INSERT INTO audit_log (
              occurred_at, actor_label, action_type, action, severity,
              target_type, target_id, summary, details
            ) VALUES (
              NOW(),
              'backfill-merged-invoice-status-v1',
              'invoice',
              'total_status_backfill',
              'info',
              'invoice',
              ${String(c.cancelledId)},
              ${`Reclassified from cancelled → merged (absorbed into #${c.survivorNumber})`},
              ${JSON.stringify({ survivorId: c.survivorId, survivorNumber: c.survivorNumber, cancelledId: c.cancelledId, cancelledNumber: c.cancelledNumber, companyId })}::jsonb
            )
          `);
          updated++;
        }
      });
    }
    emit({ step: 'reclassify', status: 'success', rowsAffected: updated });
    results.push({ id: 'reclassify', status: 'success', durationMs: Date.now() - t3, rowsAffected: updated });
  }

  // ── Step 4: Mark done ────────────────────────────────────────────────────
  const t4 = Date.now();
  emit({ step: 'mark-done', status: 'running' });
  const completedAt = new Date().toISOString();
  const reclassified = (results.find((r) => r.id === 'reclassify')?.rowsAffected) ?? 0;
  await db
    .insert(appSettings)
    .values({ key: APP_KEY, value: { completedAt, reclassified } } as any)
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: { completedAt, reclassified }, updatedAt: new Date() } as any,
    });
  emit({ step: 'mark-done', status: 'success' });
  results.push({ id: 'mark-done', status: 'success', durationMs: Date.now() - t4 });

  return results;
}

export const backfillMergedInvoiceStatusMigration: MigrationDefinition = {
  id: MIGRATION_ID,
  title: 'Reclassify merge-absorbed invoices from cancelled → merged',
  description:
    "Scans the audit_log for historical `invoice.merged` events, finds their absorbed invoices " +
    "still at status='cancelled', stamps status='merged' + mergedIntoInvoiceId on each (per-company " +
    "transactions), and writes an activity entry. Genuine cancels are untouched. Idempotent.",
  appSettingsKey: APP_KEY,
  check,
  preview,
  run,
};
