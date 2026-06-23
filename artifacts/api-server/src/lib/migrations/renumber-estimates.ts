// Adapts the existing renumber-estimates standalone script into the Super Admin
// migration registry contract so Randy can preview and apply the rename from
// /admin/migrations without terminal access.
//
// The preview() method shows the old→new number mapping for every estimate
// across all companies (capped at 200 rows in the description; the full count
// is always reported). The run() method executes the same two-phase
// transactional logic as the standalone script:
//   Phase 1 — stamp a temporary `__renum__:<id>` placeholder so the per-company
//             uniqueness index doesn't collide during the swap.
//   Phase 2 — write the final sequential numbers.
//   Post    — bump `companies.nextEstimateNumber` to `start + count` so future
//             allocations continue from the right position.
//
// Idempotent: re-running after completion is safe (companies that already have
// sequential numbers get assigned the same values, no net change). The
// completion marker in `app_settings` is set after every company is processed;
// each re-run re-computes from the live data so it's always consistent.

import type {
  MigrationDefinition,
  MigrationStatus,
  MigrationPreview,
  MigrationStep,
  MigrationStepResult,
  ProgressEmitter,
} from './types';
import { db } from '../../db';
import { estimates, companies, appSettings } from '@workspace/db';
import { sql, eq, asc } from 'drizzle-orm';

const MIGRATION_KEY = 'renumber-estimates-v1';
const PREVIEW_ROW_CAP = 200;

async function check(): Promise<MigrationStatus> {
  const marker = await db.execute(
    sql`SELECT value, updated_at FROM app_settings WHERE key = ${MIGRATION_KEY}`,
  );
  if (marker.rows.length > 0 && marker.rows[0].value === 'completed') {
    return { state: 'completed', completedAt: String(marker.rows[0].updated_at ?? '') };
  }

  // Count estimates that still have a timestamp-style number (EST-\d{13}) or
  // legacy wet-check style. These are the ones that need renumbering.
  const legacyCount = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt FROM estimates
    WHERE estimate_number ~ '^EST-\d{10,}$'
       OR estimate_number ~ '^EST-WC-'
       OR estimate_number ~ '^EST-\d{4}-'
  `);
  const cnt = Number((legacyCount.rows[0] as { cnt: number }).cnt);

  if (marker.rows.length > 0) {
    return {
      state: 'partially_applied',
      details: `${cnt} estimate(s) still have legacy timestamp-style numbers`,
    };
  }
  if (cnt === 0) {
    return { state: 'completed', completedAt: '' };
  }
  return { state: 'not_started' };
}

async function preview(): Promise<MigrationPreview> {
  const allCompanies = await db
    .select({ id: companies.id, startingEstimateNumber: companies.startingEstimateNumber })
    .from(companies)
    .orderBy(asc(companies.id));

  const steps: MigrationStep[] = [];
  let totalEstimates = 0;
  let shownRows = 0;

  for (const company of allCompanies) {
    const rows = await db
      .select({ id: estimates.id, estimateNumber: estimates.estimateNumber })
      .from(estimates)
      .where(eq(estimates.companyId, company.id))
      .orderBy(asc(estimates.createdAt), asc(estimates.id));

    if (rows.length === 0) continue;

    const start = company.startingEstimateNumber ?? 50000;
    totalEstimates += rows.length;

    const assignments = rows.map((r, idx) => ({
      id: r.id,
      oldNumber: r.estimateNumber,
      newNumber: String(start + idx),
    }));

    // Show at most PREVIEW_ROW_CAP total rows across all companies to keep the
    // preview payload manageable.
    const toShow = Math.max(0, PREVIEW_ROW_CAP - shownRows);
    const slice = assignments.slice(0, toShow);
    shownRows += slice.length;

    for (const a of slice) {
      steps.push({
        id: `company_${company.id}_estimate_${a.id}`,
        description: `Company ${company.id}: ${a.oldNumber} → ${a.newNumber}`,
      });
    }

    if (assignments.length > slice.length) {
      steps.push({
        id: `company_${company.id}_more`,
        description: `Company ${company.id}: … and ${assignments.length - slice.length} more estimate(s) up to ${String(start + assignments.length - 1)} (nextEstimateNumber = ${start + assignments.length})`,
      });
    }
  }

  const warnings: string[] = [];
  if (totalEstimates === 0) {
    warnings.push('No estimates found across all companies — nothing to renumber.');
  } else {
    warnings.push(
      `${totalEstimates} estimate(s) across ${allCompanies.length} company(ies) will be renumbered.`,
    );
    warnings.push(
      'Each company\'s estimates are ordered by created_at asc, id asc. Numbers start at ' +
      'companies.startingEstimateNumber (default 50000). Existing short sequential numbers will ' +
      'be reassigned from the same starting seed — run is idempotent.',
    );
    if (shownRows >= PREVIEW_ROW_CAP) {
      warnings.push(`Preview capped at ${PREVIEW_ROW_CAP} rows. All ${totalEstimates} estimates will be processed on Run.`);
    }
  }

  // orphanRows drives the acknowledgement gate — set to the total estimate
  // count so the operator must acknowledge before Run is enabled.
  return {
    steps,
    orphanRows: { estimatesToRenumber: totalEstimates },
    warnings,
  };
}

async function run(emit: ProgressEmitter): Promise<MigrationStepResult[]> {
  const results: MigrationStepResult[] = [];

  const allCompanies = await db
    .select({ id: companies.id, startingEstimateNumber: companies.startingEstimateNumber })
    .from(companies)
    .orderBy(asc(companies.id));

  let totalRenumbered = 0;

  for (const company of allCompanies) {
    const stepId = `company_${company.id}`;
    emit({ step: stepId, status: 'running' });
    const t = Date.now();

    try {
      const rows = await db
        .select({ id: estimates.id, estimateNumber: estimates.estimateNumber })
        .from(estimates)
        .where(eq(estimates.companyId, company.id))
        .orderBy(asc(estimates.createdAt), asc(estimates.id));

      if (rows.length === 0) {
        // Pin nextEstimateNumber to the configured starting value even when
        // there are no estimates, so the first allocation lands correctly.
        await db
          .update(companies)
          .set({ nextEstimateNumber: company.startingEstimateNumber ?? 50000 })
          .where(eq(companies.id, company.id));
        results.push({ id: stepId, status: 'skipped', durationMs: Date.now() - t, rowsAffected: 0 });
        emit({ step: stepId, status: 'skipped', rowsAffected: 0 });
        continue;
      }

      const start = company.startingEstimateNumber ?? 50000;
      const assignments = rows.map((r, idx) => ({
        id: r.id,
        newNumber: String(start + idx),
      }));

      await db.transaction(async (tx) => {
        // Phase 1: stamp temporary values to clear uniqueness slots.
        for (const a of assignments) {
          await tx
            .update(estimates)
            .set({ estimateNumber: `__renum__:${a.id}` })
            .where(eq(estimates.id, a.id));
        }
        // Phase 2: write final per-company sequence numbers.
        for (const a of assignments) {
          await tx
            .update(estimates)
            .set({ estimateNumber: a.newNumber })
            .where(eq(estimates.id, a.id));
        }
        // Pin the next allocation just past the last assigned row.
        await tx
          .update(companies)
          .set({ nextEstimateNumber: start + assignments.length })
          .where(eq(companies.id, company.id));
      });

      totalRenumbered += assignments.length;
      results.push({
        id: stepId,
        status: 'success',
        durationMs: Date.now() - t,
        rowsAffected: assignments.length,
      });
      emit({ step: stepId, status: 'success', rowsAffected: assignments.length });
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ id: stepId, status: 'failed', durationMs: Date.now() - t, error });
      emit({ step: stepId, status: 'failed', error });
      // Continue with remaining companies — a single-company failure should not
      // abort the whole migration.
    }
  }

  // Mark completed only when no steps failed.
  const anyFailed = results.some((r) => r.status === 'failed');
  const markId = 'mark_completed';
  emit({ step: markId, status: 'running' });
  const t = Date.now();
  if (!anyFailed) {
    await db.execute(sql`
      INSERT INTO app_settings (key, value)
      VALUES (${MIGRATION_KEY}, 'completed')
      ON CONFLICT (key) DO UPDATE SET value = 'completed', updated_at = NOW()
    `);
    results.push({ id: markId, status: 'success', durationMs: Date.now() - t, rowsAffected: totalRenumbered });
    emit({ step: markId, status: 'success', rowsAffected: totalRenumbered });
  } else {
    results.push({
      id: markId,
      status: 'skipped',
      durationMs: Date.now() - t,
      error: 'One or more companies failed — marker not set. Re-run after fixing failures.',
    });
    emit({ step: markId, status: 'skipped' });
  }

  return results;
}

export const renumberEstimatesMigration: MigrationDefinition = {
  id: MIGRATION_KEY,
  title: 'Renumber estimates to short per-company sequences',
  description:
    'Replaces long timestamp-based estimate numbers (EST-1778541777944, EST-WC-123-…) ' +
    'with short per-company sequential numbers starting at each company\'s ' +
    'startingEstimateNumber (default 50000). Also resets nextEstimateNumber so ' +
    'future allocations continue from the right position. Two-phase write avoids ' +
    'uniqueness-index collisions mid-swap. Idempotent and resumable — a clean ' +
    're-run renumbers to the same values, 0 net change.',
  appSettingsKey: MIGRATION_KEY,
  check,
  preview,
  run,
};
