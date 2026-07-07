// Task #1739 Amendment — Invoice Revision Backfill
//
// Handles two things that can only be done at the data layer after the DDL
// push (`pnpm --filter @workspace/db run push`) has added the `revision`
// column and swapped the unique constraint:
//
// 1. Confirm backfill: existing invoices land at `revision = 1` via the
//    column DEFAULT, but this migration verifies the count so the super admin
//    has an audit trail.
//
// 2. Unwind botched `-R1` artefacts: a previous broken engine run left
//    `#04723-R1` (draft) alongside a superseded `#04723`.  This step finds
//    any invoice whose number ends in `-R\d+` and whose status is 'draft' or
//    'generated' (not 'superseded'), unlinks the chain, restores the original
//    to 'generated', resets the correction record back to 'draft', and deletes
//    the stray reissue + its items.  Idempotent — a second run skips rows that
//    are already clean.

import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { eq, and } from 'drizzle-orm';
import { invoices, invoiceItems, invoiceCorrections, appSettings } from '@workspace/db/schema';
import type {
  MigrationDefinition,
  MigrationStatus,
  MigrationPreview,
  MigrationStepResult,
  ProgressEmitter,
} from './types';

const MIGRATION_ID = 'invoice-revision-backfill-v1';
const APP_KEY = 'invoiceRevisionBackfill';

async function columnExists(): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'revision'
    LIMIT 1
  `);
  return (rows as unknown as any[]).length > 0;
}

async function findStrayReissues(): Promise<Array<{ id: number; invoiceNumber: string; status: string; originalId: number | null }>> {
  if (!(await columnExists())) return [];
  const rows = await db.execute(sql`
    SELECT id, invoice_number, status, superseded_by_invoice_id
    FROM invoices
    WHERE invoice_number ~ '-R[0-9]+$'
      AND status NOT IN ('superseded', 'cancelled')
    ORDER BY id
  `);
  return (rows as unknown as any[]).map((r: any) => ({
    id: r.id,
    invoiceNumber: r.invoice_number,
    status: r.status,
    originalId: null,
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

  const strays = await findStrayReissues();
  if (strays.length > 0) {
    return {
      state: 'partially_applied',
      details: `${strays.length} stray -R\u2026 invoice(s) need unwinding: ${strays.map(s => s.invoiceNumber).join(', ')}`,
    };
  }

  return { state: 'not_started' };
}

async function preview(): Promise<MigrationPreview> {
  const steps: MigrationPreview['steps'] = [
    {
      id: 'verify-column',
      description: "Verify 'revision' column exists on invoices (DDL must be pushed first)",
    },
    {
      id: 'count-backfill',
      description: "Count invoices at revision = 1 (auto-applied by column DEFAULT)",
    },
    {
      id: 'unwind-stray-reissues',
      description: "Find -R… suffix invoices in non-superseded status and unlink the correction chain (delete stray reissue + items, restore original to generated, reset correction to draft)",
    },
  ];

  const hasColumn = await columnExists();
  const strays = hasColumn ? await findStrayReissues() : [];

  const warnings: string[] = [];
  if (!hasColumn) {
    warnings.push("Column 'revision' not found — run `pnpm --filter @workspace/db run push` before this migration.");
  }
  if (strays.length > 0) {
    warnings.push(`${strays.length} stray -R… invoice(s) will be deleted: ${strays.map(s => `#${s.invoiceNumber} (id ${s.id})`).join(', ')}`);
  }

  return {
    steps,
    orphanRows: { strayReissues: strays.length },
    warnings,
  };
}

async function run(emit: ProgressEmitter): Promise<MigrationStepResult[]> {
  const results: MigrationStepResult[] = [];
  const start = Date.now();

  // ── Step 1: Verify column ────────────────────────────────────────────────
  const t1 = Date.now();
  emit({ step: 'verify-column', status: 'running' });
  const hasColumn = await columnExists();
  if (!hasColumn) {
    const err = "Column 'revision' does not exist. Run `pnpm --filter @workspace/db run push` first.";
    emit({ step: 'verify-column', status: 'failed', error: err });
    results.push({ id: 'verify-column', status: 'failed', durationMs: Date.now() - t1, error: err });
    return results;
  }
  emit({ step: 'verify-column', status: 'success' });
  results.push({ id: 'verify-column', status: 'success', durationMs: Date.now() - t1 });

  // ── Step 2: Count backfill (informational) ───────────────────────────────
  const t2 = Date.now();
  emit({ step: 'count-backfill', status: 'running' });
  const countRows = await db.execute(sql`SELECT COUNT(*) AS n FROM invoices WHERE revision = 1`);
  const count = parseInt(String((countRows as unknown as any[])[0]?.n ?? '0'));
  emit({ step: 'count-backfill', status: 'success', rowsAffected: count });
  results.push({ id: 'count-backfill', status: 'success', durationMs: Date.now() - t2, rowsAffected: count });

  // ── Step 3: Unwind stray -Rn reissues ────────────────────────────────────
  const t3 = Date.now();
  emit({ step: 'unwind-stray-reissues', status: 'running' });
  const strays = await findStrayReissues();

  let unwound = 0;
  for (const stray of strays) {
    // Find the original invoice that was superseded and points to this stray.
    const originalRows = await db.execute(sql`
      SELECT id FROM invoices
      WHERE superseded_by_invoice_id = ${stray.id}
        AND status = 'superseded'
      LIMIT 1
    `);
    const originalId = (originalRows as unknown as any[])[0]?.id ?? null;

    // Delete the stray reissue's invoice_items first (FK child).
    await db.delete(invoiceItems).where(eq(invoiceItems.invoiceId, stray.id));

    // Delete the stray reissue invoice itself.
    await db.delete(invoices).where(eq(invoices.id, stray.id));

    if (originalId) {
      // Restore original to generated + clear the superseded-by link.
      await db
        .update(invoices)
        .set({ status: 'generated', supersededByInvoiceId: null, updatedAt: new Date() } as any)
        .where(eq(invoices.id, originalId));

      // Reset any reissued correction that pointed to the stray.
      await db
        .update(invoiceCorrections)
        .set({ status: 'draft', reissuedInvoiceId: null, updatedAt: new Date() } as any)
        .where(
          and(
            eq(invoiceCorrections.originalInvoiceId, originalId),
            eq(invoiceCorrections.status, 'reissued'),
          ),
        );
    }

    unwound++;
  }

  if (strays.length === 0) {
    emit({ step: 'unwind-stray-reissues', status: 'skipped', rowsAffected: 0 });
    results.push({ id: 'unwind-stray-reissues', status: 'skipped', durationMs: Date.now() - t3, rowsAffected: 0 });
  } else {
    emit({ step: 'unwind-stray-reissues', status: 'success', rowsAffected: unwound });
    results.push({ id: 'unwind-stray-reissues', status: 'success', durationMs: Date.now() - t3, rowsAffected: unwound });
  }

  // ── Stamp completion ─────────────────────────────────────────────────────
  const completedAt = new Date().toISOString();
  await db
    .insert(appSettings)
    .values({ key: APP_KEY, value: { completedAt, unwound, revisionCount: count } } as any)
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: { completedAt, unwound, revisionCount: count }, updatedAt: new Date() } as any,
    });

  return results;
}

export const invoiceRevisionBackfillMigration: MigrationDefinition = {
  id: MIGRATION_ID,
  title: 'Stable invoice numbers — revision backfill & unwind',
  description:
    'Verifies the `revision` column is present (DDL pushed), counts the backfill, ' +
    'and unwinds any stray `-R1` / `-R2` reissue artefacts left by the previous broken engine.',
  appSettingsKey: APP_KEY,
  check,
  preview,
  run,
};
