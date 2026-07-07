// reconcile-inspection-pass.ts — Admin migration to reconcile the
// inspection pass-to-estimates seams.
//
// Two passes:
//
// Pass (a) — Stranded wet checks (Seam 2 victims):
//   mode='inspection', status='submitted', linked estimate lifecycle='approved'
//   or status='converted_to_work_order' → set WC status='converted',
//   stamp fully_converted_at=NOW().
//
// Pass (b) — Legacy over-approved estimates:
//   Inspection-origin estimates with lifecycle='approved' that the old
//   approve-inspection flow stamped WITHOUT customer involvement (all three
//   conditions must hold: approvalSentAt IS NULL, internalStatus != 'sent_to_customer',
//   approvalRespondedAt IS NULL) → set status='pending',
//   internalStatus='approved_internal', lifecycle='pending_review', approvedAt=null.
//   Estimates with a work order, customer response, or any sign they left the
//   building are listed in the preview as "skipped — already acted on."

import { db } from '../../db';
import { sql } from 'drizzle-orm';
import type {
  MigrationDefinition,
  MigrationStatus,
  MigrationPreview,
  MigrationStep,
  MigrationStepResult,
  ProgressEmitter,
} from './types';

const MIGRATION_ID = 'reconcile-inspection-pass-v1';
const DONE_KEY = 'reconcileInspectionPass.done';

// ── Types ──────────────────────────────────────────────────────────────────────

type StrandedWcRow = {
  id: number;
  companyId: number;
  estimateId: number;
  estimateLifecycle: string | null;
};

type LegacyApprovedEstimateRow = {
  id: number;
  companyId: number;
  estimateNumber: string | null;
};

type SkippedEstimateRow = {
  id: number;
  companyId: number;
  estimateNumber: string | null;
  skipReason: string;
};

// ── Candidate loaders ──────────────────────────────────────────────────────────

async function loadStrandedWcs(): Promise<StrandedWcRow[]> {
  const result = await db.execute<{
    id: unknown;
    company_id: unknown;
    estimate_id: unknown;
    estimate_lifecycle: unknown;
  }>(sql`
    SELECT
      wc.id,
      wc.company_id,
      e.id        AS estimate_id,
      e.lifecycle AS estimate_lifecycle
    FROM wet_checks wc
    JOIN estimates e ON e.origin_wet_check_id = wc.id
    WHERE wc.mode   = 'inspection'
      AND wc.status = 'submitted'
      AND (e.lifecycle = 'approved' OR e.status = 'converted_to_work_order')
    ORDER BY wc.id
  `);
  return result.rows.map(r => ({
    id: Number(r.id),
    companyId: Number(r.company_id),
    estimateId: Number(r.estimate_id),
    estimateLifecycle: r.estimate_lifecycle != null ? String(r.estimate_lifecycle) : null,
  }));
}

async function loadLegacyApprovedEstimates(): Promise<LegacyApprovedEstimateRow[]> {
  const result = await db.execute<{
    id: unknown;
    company_id: unknown;
    estimate_number: unknown;
  }>(sql`
    SELECT
      e.id,
      e.company_id,
      e.estimate_number
    FROM estimates e
    INNER JOIN wet_checks wc ON wc.id = e.origin_wet_check_id
    LEFT JOIN work_orders wo ON wo.estimate_id = e.id
    WHERE e.lifecycle           = 'approved'
      AND e.status              = 'approved'
      AND wc.mode               = 'inspection'
      AND e.approval_sent_at    IS NULL
      AND e.internal_status     != 'sent_to_customer'
      AND e.approval_responded_at IS NULL
      AND wo.id IS NULL
    ORDER BY e.id
  `);
  return result.rows.map(r => ({
    id: Number(r.id),
    companyId: Number(r.company_id),
    estimateNumber: r.estimate_number != null ? String(r.estimate_number) : null,
  }));
}

async function loadSkippedEstimates(): Promise<SkippedEstimateRow[]> {
  const result = await db.execute<{
    id: unknown;
    company_id: unknown;
    estimate_number: unknown;
    work_order_id: unknown;
    approval_sent_at: unknown;
    approval_responded_at: unknown;
    internal_status: unknown;
  }>(sql`
    SELECT
      e.id,
      e.company_id,
      e.estimate_number,
      wo.id                   AS work_order_id,
      e.approval_sent_at,
      e.approval_responded_at,
      e.internal_status
    FROM estimates e
    INNER JOIN wet_checks wc ON wc.id = e.origin_wet_check_id
    LEFT JOIN work_orders wo ON wo.estimate_id = e.id
    WHERE e.lifecycle = 'approved'
      AND e.status    = 'approved'
      AND wc.mode     = 'inspection'
      AND (
        wo.id IS NOT NULL
        OR e.approval_sent_at      IS NOT NULL
        OR e.internal_status       = 'sent_to_customer'
        OR e.approval_responded_at IS NOT NULL
      )
    ORDER BY e.id
  `);
  return result.rows.map(r => {
    let skipReason = 'already acted on';
    if (r.work_order_id != null) skipReason = `has work order #${r.work_order_id}`;
    else if (r.approval_responded_at != null) skipReason = 'customer responded';
    else if (r.internal_status === 'sent_to_customer' || r.approval_sent_at != null) skipReason = 'sent to customer';
    return {
      id: Number(r.id),
      companyId: Number(r.company_id),
      estimateNumber: r.estimate_number != null ? String(r.estimate_number) : null,
      skipReason,
    };
  });
}

// ── Preview builder ────────────────────────────────────────────────────────────

async function buildPreview(): Promise<MigrationPreview> {
  const [stranded, legacy, skipped] = await Promise.all([
    loadStrandedWcs(),
    loadLegacyApprovedEstimates(),
    loadSkippedEstimates(),
  ]);

  const steps: MigrationStep[] = [];
  const warnings: string[] = [];

  // Group stranded WCs by company.
  const strandedByCompany = new Map<number, StrandedWcRow[]>();
  for (const row of stranded) {
    const arr = strandedByCompany.get(row.companyId) ?? [];
    arr.push(row);
    strandedByCompany.set(row.companyId, arr);
  }

  if (stranded.length === 0) {
    steps.push({
      id: 'pass_a_summary',
      description: 'Pass (a) — No stranded wet checks found.',
    });
  } else {
    for (const [companyId, rows] of strandedByCompany) {
      const wcIds = rows.map(r => String(r.id)).join(', ');
      steps.push({
        id: `pass_a_company_${companyId}`,
        description:
          `Pass (a) — Company ${companyId}: ${rows.length} stranded wet check(s) → convert. ` +
          `WC IDs: [${wcIds}]`,
      });
    }
    warnings.push(
      `Pass (a): ${stranded.length} stranded inspection wet check(s) will be set to converted.`,
    );
  }

  // Group legacy estimates by company.
  const legacyByCompany = new Map<number, LegacyApprovedEstimateRow[]>();
  for (const row of legacy) {
    const arr = legacyByCompany.get(row.companyId) ?? [];
    arr.push(row);
    legacyByCompany.set(row.companyId, arr);
  }

  if (legacy.length === 0) {
    steps.push({
      id: 'pass_b_summary',
      description: 'Pass (b) — No over-approved inspection estimates found.',
    });
  } else {
    for (const [companyId, rows] of legacyByCompany) {
      const estNums = rows.map(r => r.estimateNumber ?? `#${r.id}`).join(', ');
      steps.push({
        id: `pass_b_company_${companyId}`,
        description:
          `Pass (b) — Company ${companyId}: ${rows.length} over-approved estimate(s) → ` +
          `set pending/approved_internal/pending_review. Estimates: [${estNums}]`,
      });
    }
    warnings.push(
      `Pass (b): ${legacy.length} inspection estimate(s) will be stepped back to approved_internal.`,
    );
  }

  // Skipped estimates.
  if (skipped.length > 0) {
    const skippedByCompany = new Map<number, SkippedEstimateRow[]>();
    for (const row of skipped) {
      const arr = skippedByCompany.get(row.companyId) ?? [];
      arr.push(row);
      skippedByCompany.set(row.companyId, arr);
    }
    for (const [companyId, rows] of skippedByCompany) {
      steps.push({
        id: `pass_b_skipped_company_${companyId}`,
        description:
          `Pass (b) — Company ${companyId}: ${rows.length} estimate(s) skipped — already acted on. ` +
          rows.map(r => `${r.estimateNumber ?? `#${r.id}`} (${r.skipReason})`).join(', '),
      });
    }
  }

  if (stranded.length === 0 && legacy.length === 0) {
    warnings.push('Nothing to reconcile — all inspection rows are already consistent.');
  }

  return {
    steps,
    orphanRows: {
      strandedWetChecks: stranded.length,
      overApprovedEstimates: legacy.length,
      skippedEstimates: skipped.length,
    },
    warnings,
  };
}

// ── Runner ─────────────────────────────────────────────────────────────────────

async function runMigration(
  emit: ProgressEmitter,
): Promise<MigrationStepResult[]> {
  const results: MigrationStepResult[] = [];

  // ── Pass (a): stamp stranded WCs as converted ──────────────────────────────
  {
    const t = Date.now();
    emit({ step: 'pass_a', status: 'running' });
    try {
      const stranded = await loadStrandedWcs();
      if (stranded.length === 0) {
        results.push({ id: 'pass_a', status: 'skipped', durationMs: Date.now() - t, rowsAffected: 0 });
        emit({ step: 'pass_a', status: 'skipped', rowsAffected: 0 });
      } else {
        const ids = stranded.map(r => r.id);
        await db.execute(sql`
          UPDATE wet_checks
          SET status             = 'converted',
              fully_converted_at = NOW(),
              updated_at         = NOW()
          WHERE id = ANY(${ids})
            AND mode   = 'inspection'
            AND status = 'submitted'
        `);
        results.push({ id: 'pass_a', status: 'success', durationMs: Date.now() - t, rowsAffected: ids.length });
        emit({ step: 'pass_a', status: 'success', rowsAffected: ids.length });
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ id: 'pass_a', status: 'failed', durationMs: Date.now() - t, error });
      emit({ step: 'pass_a', status: 'failed', error });
      return results;
    }
  }

  // ── Pass (b): step back legacy over-approved estimates ─────────────────────
  {
    const t = Date.now();
    emit({ step: 'pass_b', status: 'running' });
    try {
      const legacy = await loadLegacyApprovedEstimates();
      if (legacy.length === 0) {
        results.push({ id: 'pass_b', status: 'skipped', durationMs: Date.now() - t, rowsAffected: 0 });
        emit({ step: 'pass_b', status: 'skipped', rowsAffected: 0 });
      } else {
        const ids = legacy.map(r => r.id);
        await db.execute(sql`
          UPDATE estimates
          SET status          = 'pending',
              internal_status = 'approved_internal',
              lifecycle       = 'pending_review',
              approved_at     = NULL,
              updated_at      = NOW()
          WHERE id = ANY(${ids})
            AND lifecycle           = 'approved'
            AND internal_status    != 'sent_to_customer'
            AND approval_responded_at IS NULL
        `);
        results.push({ id: 'pass_b', status: 'success', durationMs: Date.now() - t, rowsAffected: ids.length });
        emit({ step: 'pass_b', status: 'success', rowsAffected: ids.length });
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ id: 'pass_b', status: 'failed', durationMs: Date.now() - t, error });
      emit({ step: 'pass_b', status: 'failed', error });
      return results;
    }
  }

  // ── Mark done ──────────────────────────────────────────────────────────────
  {
    const t = Date.now();
    emit({ step: 'mark_done', status: 'running' });
    try {
      await db.execute(sql`
        INSERT INTO app_settings (key, value)
        VALUES (${DONE_KEY}, ${new Date().toISOString()})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `);
      results.push({ id: 'mark_done', status: 'success', durationMs: Date.now() - t });
      emit({ step: 'mark_done', status: 'success' });
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ id: 'mark_done', status: 'failed', durationMs: Date.now() - t, error });
      emit({ step: 'mark_done', status: 'failed', error });
    }
  }

  return results;
}

// ── check ──────────────────────────────────────────────────────────────────────

async function check(): Promise<MigrationStatus> {
  try {
    const [stranded, legacy] = await Promise.all([
      loadStrandedWcs(),
      loadLegacyApprovedEstimates(),
    ]);
    if (stranded.length === 0 && legacy.length === 0) {
      const marker = await db.execute(
        sql`SELECT updated_at FROM app_settings WHERE key = ${DONE_KEY}`,
      );
      const completedAt = marker.rows.length > 0
        ? String((marker.rows[0] as Record<string, unknown>).updated_at ?? '')
        : new Date().toISOString();
      return { state: 'completed', completedAt };
    }
    const marker = await db.execute(
      sql`SELECT value FROM app_settings WHERE key = ${DONE_KEY}`,
    );
    if (marker.rows.length > 0) {
      return {
        state: 'partially_applied',
        details:
          `${stranded.length} stranded WC(s) and ${legacy.length} over-approved estimate(s) remain`,
      };
    }
    return { state: 'not_started' };
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    return { state: 'error', details };
  }
}

// ── Export ─────────────────────────────────────────────────────────────────────

export const reconcileInspectionPassMigration: MigrationDefinition = {
  id: MIGRATION_ID,
  title: 'Reconcile inspection pass-to-estimates',
  description:
    'Two-pass reconciliation for the inspection pass-to-estimates flow. ' +
    'Pass (a): stamps stranded inspection wet checks (status=submitted whose linked estimate ' +
    'is already approved/WO-created) as converted. ' +
    'Pass (b): steps back legacy over-approved estimates (lifecycle=approved set by the old ' +
    'approve-inspection flow without customer involvement) to ' +
    'status=pending/internalStatus=approved_internal/lifecycle=pending_review. ' +
    'Estimates with a work order, customer response, or any sign they left the building are skipped.',
  appSettingsKey: DONE_KEY,
  check,
  preview: buildPreview,
  run: runMigration,
};
