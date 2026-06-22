// Task #1437 (Slice 3) — Work-order zone backfill migration wrapper.
//
// Adapts the resumable backfill core
// (../../scripts/backfill-work-order-zones-core) to the Super Admin migration
// registry contract (check / preview / run). The heavy lifting — candidate
// selection, source resolution, part/qty matching, idempotent app_settings
// bookkeeping — lives in the core; this file only translates it into migration
// steps and a single completion marker.

import type {
  MigrationDefinition,
  MigrationStatus,
  MigrationPreview,
  MigrationStepResult,
  ProgressEmitter,
} from './types';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import {
  makeDbDeps,
  runBackfill,
  getBackfillStatus,
} from '../../scripts/backfill-work-order-zones-core';

const MIGRATION_KEY = 'work-order-zones-v1';

async function check(): Promise<MigrationStatus> {
  const marker = await db.execute(
    sql`SELECT value, updated_at FROM app_settings WHERE key = ${MIGRATION_KEY}`,
  );
  if (marker.rows.length > 0 && marker.rows[0].value === 'completed') {
    return { state: 'completed', completedAt: String(marker.rows[0].updated_at ?? '') };
  }

  const status = await getBackfillStatus();
  if (status.candidateCount === 0) {
    // No inspection-origin WO still has zone-less items.
    return status.doneCount > 0
      ? { state: 'completed', completedAt: '' }
      : { state: 'not_started' };
  }

  if (status.doneCount > 0 || status.seenCount > 0) {
    return {
      state: 'partially_applied',
      details:
        `${status.candidateCount} WO(s) still have zone-less items ` +
        `(${status.doneCount} stamped, ${status.seenCount} skipped, ` +
        `${status.failedCount} failed so far)`,
    };
  }

  return { state: 'not_started' };
}

async function preview(): Promise<MigrationPreview> {
  const status = await getBackfillStatus();

  const warnings: string[] = [];
  if (status.candidateCount === 0) {
    warnings.push('No inspection-origin work orders with zone-less items remain — nothing to backfill.');
  }
  if (status.failedCount > 0) {
    warnings.push(`${status.failedCount} work order(s) failed a prior run — they will be retried.`);
  }

  return {
    steps: [
      {
        id: 'step1_backfill',
        description:
          'Re-derive controller/zone/issue for each zone-less item on inspection-origin ' +
          'work orders (from the parent estimate, falling back to the source wet check) ' +
          'and stamp them. Resumable; skips work orders that cannot be confidently mapped. ' +
          `${status.candidateCount} candidate work order(s) to process; ` +
          `${status.doneCount} already stamped.`,
      },
      { id: 'step2_mark_completed', description: 'Mark migration completed in app_settings' },
    ],
    orphanRows: {
      skipped: status.seenCount,
      failed: status.failedCount,
    },
    warnings,
  };
}

async function run(emit: ProgressEmitter): Promise<MigrationStepResult[]> {
  const results: MigrationStepResult[] = [];

  // step1 — run the resumable backfill core (apply mode).
  let matched = 0;
  {
    const t = Date.now();
    emit({ step: 'step1_backfill', status: 'running' });
    try {
      const result = await runBackfill(makeDbDeps(), { dryRun: false, batchSize: 50 });
      matched = result.matched;
      results.push({
        id: 'step1_backfill',
        status: 'success',
        durationMs: Date.now() - t,
        rowsAffected: result.matched,
      });
      emit({ step: 'step1_backfill', status: 'success', rowsAffected: result.matched });
    } catch (err: any) {
      const error = err?.message ?? String(err);
      results.push({ id: 'step1_backfill', status: 'failed', durationMs: Date.now() - t, error });
      emit({ step: 'step1_backfill', status: 'failed', error });
      return results;
    }
  }

  // step2 — mark completed only when no zone-less candidates remain.
  {
    const t = Date.now();
    emit({ step: 'step2_mark_completed', status: 'running' });
    try {
      const status = await getBackfillStatus();
      if (status.candidateCount === 0) {
        await db.execute(sql`
          INSERT INTO app_settings (key, value) VALUES (${MIGRATION_KEY}, 'completed')
          ON CONFLICT (key) DO UPDATE SET value = 'completed', updated_at = NOW()
        `);
        results.push({ id: 'step2_mark_completed', status: 'success', durationMs: Date.now() - t });
        emit({ step: 'step2_mark_completed', status: 'success' });
      } else {
        // Some WOs remain unmappable/skipped — leave the marker unset so the
        // migration shows as partially_applied and can be re-run after fixes.
        results.push({
          id: 'step2_mark_completed',
          status: 'skipped',
          durationMs: Date.now() - t,
          rowsAffected: matched,
        });
        emit({ step: 'step2_mark_completed', status: 'skipped' });
      }
    } catch (err: any) {
      const error = err?.message ?? String(err);
      results.push({ id: 'step2_mark_completed', status: 'failed', durationMs: Date.now() - t, error });
      emit({ step: 'step2_mark_completed', status: 'failed', error });
      return results;
    }
  }

  return results;
}

export const workOrderZonesMigration: MigrationDefinition = {
  id: MIGRATION_KEY,
  title: 'Backfill work-order zone detail (Task #1437)',
  description:
    'Re-derives per-item controller/zone/issue for existing inspection-origin ' +
    'work orders whose items predate the estimate→WO zone-carry. Sources from ' +
    'the parent estimate (falling back to the source wet check), matched by ' +
    'part + quantity. Never touches quantity, labor, totals, or completion ' +
    'state. Idempotent and resumable — safe to re-run.',
  appSettingsKey: MIGRATION_KEY,
  check,
  preview,
  run,
};
