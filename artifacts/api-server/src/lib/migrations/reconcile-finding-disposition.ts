// Task #1538 — Reconcile wet-check finding dispositions (super-admin migration).
//
// Some wet_check_findings rows are in a split state: their `resolution` and
// `techDisposition` columns disagree. This was caused by the old per-finding
// manager-review toggle which only patched `techDisposition` and left
// `resolution` stale. Symptom: findings stuck in the manager review queue and,
// at submit, tripping the "marked complete but has no part" auto-bill guard.
//
// This migration detects split findings (unconverted only — no billing sheet,
// estimate, work order, or wet-check billing attached) and routes them:
//   - can auto-bill (has partId, noPartNeeded=true, or labor-only issue type)
//       → resolution='repaired_in_field', techDisposition='completed_in_field'
//   - cannot auto-bill (no part, not labor-only, noPartNeeded=false)
//       → resolution='pending', techDisposition='needs_review'
//
// "Split" = (techDisposition='completed_in_field' AND resolution!='repaired_in_field')
//           OR (techDisposition='needs_review'     AND resolution!='pending')
//
// The run is idempotent: a clean re-run finds zero affected rows.

import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { LABOR_ONLY_ISSUE_TYPES } from '../../storage';
import type {
  MigrationDefinition,
  MigrationStatus,
  MigrationPreview,
  MigrationStep,
  MigrationStepResult,
  ProgressEmitter,
} from './types';

const MIGRATION_ID = 'reconcile-finding-disposition-v1';
const MIGRATION_KEY = MIGRATION_ID;

// ── Shared types ──────────────────────────────────────────────────────────────

export type FindingRow = {
  id: number;
  wetCheckId: number;
  issueType: string;
  partId: number | null;
  noPartNeeded: boolean;
  resolution: string;
  techDisposition: string | null;
};

export type FindingRepair = {
  newResolution: 'pending' | 'repaired_in_field';
  newTechDisposition: 'needs_review' | 'completed_in_field';
};

export type FindingMigrationDeps = {
  getCandidates: () => Promise<FindingRow[]>;
  applyRepair: (id: number, repair: FindingRepair) => Promise<void>;
  markDone: () => Promise<void>;
};

// ── Routing logic ─────────────────────────────────────────────────────────────

/**
 * Determine the corrected resolution/techDisposition for a split finding.
 * Mirrors the auto-bill guard in storage.ts (partId == null && !noPartNeeded
 * && !LABOR_ONLY_ISSUE_TYPES) to decide which state the finding should land in.
 */
export function computeFindingRepair(
  row: Pick<FindingRow, 'partId' | 'noPartNeeded' | 'issueType'>,
  laborOnlyTypes: ReadonlySet<string> = LABOR_ONLY_ISSUE_TYPES,
): FindingRepair {
  const canAutoBill =
    row.partId != null ||
    row.noPartNeeded ||
    laborOnlyTypes.has(row.issueType);

  return canAutoBill
    ? { newResolution: 'repaired_in_field', newTechDisposition: 'completed_in_field' }
    : { newResolution: 'pending',           newTechDisposition: 'needs_review' };
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function loadCandidates(): Promise<FindingRow[]> {
  const result = await db.execute<{
    id: number;
    wet_check_id: number;
    issue_type: string;
    part_id: number | null;
    no_part_needed: boolean;
    resolution: string;
    tech_disposition: string | null;
  }>(sql`
    SELECT
      id,
      wet_check_id,
      issue_type,
      part_id,
      no_part_needed,
      resolution,
      tech_disposition
    FROM wet_check_findings
    WHERE (
      (tech_disposition = 'completed_in_field' AND resolution != 'repaired_in_field')
      OR
      (tech_disposition = 'needs_review'       AND resolution != 'pending')
    )
    AND billing_sheet_id   IS NULL
    AND wet_check_billing_id IS NULL
    AND estimate_id        IS NULL
    AND work_order_id      IS NULL
    ORDER BY id
  `);
  return result.rows.map((r) => ({
    id: Number(r.id),
    wetCheckId: Number(r.wet_check_id),
    issueType: String(r.issue_type),
    partId: r.part_id != null ? Number(r.part_id) : null,
    noPartNeeded: Boolean(r.no_part_needed),
    resolution: String(r.resolution),
    techDisposition: r.tech_disposition != null ? String(r.tech_disposition) : null,
  }));
}

function makeDbDeps(): FindingMigrationDeps {
  return {
    getCandidates: loadCandidates,
    applyRepair: async (id, repair) => {
      await db.execute(sql`
        UPDATE wet_check_findings
        SET resolution       = ${repair.newResolution},
            tech_disposition = ${repair.newTechDisposition},
            updated_at       = NOW()
        WHERE id = ${id}
      `);
    },
    markDone: async () => {
      await db.execute(sql`
        INSERT INTO app_settings (key, value)
        VALUES (${MIGRATION_KEY}, 'completed')
        ON CONFLICT (key) DO UPDATE SET value = 'completed', updated_at = NOW()
      `);
    },
  };
}

// ── Pure preview builder (exported for tests) ─────────────────────────────────

export function buildFindingDispositionPreview(
  candidates: FindingRow[],
  laborOnlyTypes: ReadonlySet<string> = LABOR_ONLY_ISSUE_TYPES,
): MigrationPreview {
  const steps: MigrationStep[] = [];

  for (const row of candidates) {
    const repair = computeFindingRepair(row, laborOnlyTypes);
    steps.push({
      id: `finding_${row.id}`,
      description:
        `Finding #${row.id} (wet check #${row.wetCheckId}, issue: ${row.issueType}): ` +
        `resolution ${row.resolution} / techDisposition ${row.techDisposition ?? 'null'} ` +
        `→ ${repair.newResolution} / ${repair.newTechDisposition}`,
    });
  }

  const warnings: string[] = [];
  if (candidates.length === 0) {
    warnings.push('No split findings found — all resolution/techDisposition pairs are already consistent.');
  } else {
    warnings.push(
      `${candidates.length} finding(s) have mismatched resolution / techDisposition and will be reconciled. ` +
      `Findings that cannot auto-bill (no part, not labor-only) will be routed to needs_review; ` +
      `the rest will be aligned to repaired_in_field / completed_in_field. ` +
      'Acknowledge to proceed.',
    );
  }

  // Per the task spec: candidate count goes into `warnings`, not `orphanRows`,
  // so the Run button is not permanently gated by the framework's orphan-row
  // block. Set orphanRows to {} so Run is always available once acknowledged.
  return {
    steps,
    orphanRows: {},
    warnings,
  };
}

// ── Deps-injectable runner (exported for tests) ───────────────────────────────

export async function runFindingDispositionMigration(
  deps: FindingMigrationDeps,
  emit: ProgressEmitter,
  laborOnlyTypes: ReadonlySet<string> = LABOR_ONLY_ISSUE_TYPES,
): Promise<MigrationStepResult[]> {
  const results: MigrationStepResult[] = [];
  const candidates = await deps.getCandidates();

  if (candidates.length === 0) {
    results.push({
      id: 'reconcile_summary',
      status: 'skipped',
      durationMs: 0,
      rowsAffected: 0,
    });
    emit({ step: 'reconcile_summary', status: 'skipped', rowsAffected: 0 });
    await deps.markDone();
    return results;
  }

  let repaired = 0;
  let errors = 0;

  for (const row of candidates) {
    const stepId = `finding_${row.id}`;
    const t = Date.now();
    emit({ step: stepId, status: 'running' });
    const repair = computeFindingRepair(row, laborOnlyTypes);
    try {
      await deps.applyRepair(row.id, repair);
      repaired++;
      results.push({ id: stepId, status: 'success', durationMs: Date.now() - t, rowsAffected: 1 });
      emit({ step: stepId, status: 'success', rowsAffected: 1 });
    } catch (err) {
      errors++;
      const error = err instanceof Error ? err.message : String(err);
      results.push({ id: stepId, status: 'failed', durationMs: Date.now() - t, error });
      emit({ step: stepId, status: 'failed', error });
    }
  }

  const summaryStatus = errors > 0 ? 'failed' : 'success';
  results.push({
    id: 'reconcile_summary',
    status: summaryStatus,
    durationMs: 0,
    rowsAffected: repaired,
    error: errors > 0 ? `${errors} finding(s) failed to reconcile` : undefined,
  });
  emit({ step: 'reconcile_summary', status: summaryStatus, rowsAffected: repaired });

  if (errors === 0) {
    await deps.markDone();
  }

  return results;
}

// ── check / preview / run (framework contract) ────────────────────────────────

async function check(): Promise<MigrationStatus> {
  try {
    const candidates = await loadCandidates();
    if (candidates.length === 0) {
      const marker = await db.execute(
        sql`SELECT updated_at FROM app_settings WHERE key = ${MIGRATION_KEY}`,
      );
      const completedAt = marker.rows.length > 0
        ? String((marker.rows[0] as { updated_at?: unknown }).updated_at ?? '')
        : '';
      return { state: 'completed', completedAt };
    }

    const marker = await db.execute(
      sql`SELECT value FROM app_settings WHERE key = ${MIGRATION_KEY}`,
    );
    if (marker.rows.length > 0) {
      return {
        state: 'partially_applied',
        details: `${candidates.length} finding(s) still have mismatched resolution / techDisposition`,
      };
    }
    return { state: 'not_started' };
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    return { state: 'error', details };
  }
}

async function preview(): Promise<MigrationPreview> {
  const candidates = await loadCandidates();
  return buildFindingDispositionPreview(candidates);
}

async function run(emit: ProgressEmitter): Promise<MigrationStepResult[]> {
  return runFindingDispositionMigration(makeDbDeps(), emit);
}

export const reconcileFindingDispositionMigration: MigrationDefinition = {
  id: MIGRATION_ID,
  title: 'Reconcile wet-check finding dispositions',
  description:
    'Fixes wet_check_findings rows where resolution and techDisposition disagree ' +
    '(caused by the old per-finding manager-review toggle that only patched ' +
    'techDisposition and left resolution stale). Findings that can auto-bill are ' +
    'aligned to repaired_in_field / completed_in_field; others are routed to ' +
    'needs_review. Only touches unconverted findings (no billing sheet, estimate, ' +
    'work order, or wet-check billing attached). Idempotent — a clean re-run ' +
    'finds zero rows.',
  appSettingsKey: MIGRATION_KEY,
  check,
  preview,
  run,
};
