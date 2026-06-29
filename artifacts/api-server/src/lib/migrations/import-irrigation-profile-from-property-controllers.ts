// Admin migration: seed irrigation_controllers + irrigation_profile_zones from property_controllers.
//
// For every (companyId, customerId, branchName) tuple that has property_controllers rows
// but no irrigation_controllers rows, creates one irrigation_controllers row per legacy
// controller (named "Controller {letter}") with totalZones = zoneCount. Also seeds
// irrigation_profile_zones placeholder rows (zone numbers 1…zoneCount) so the profile
// page can display zone counts immediately.
//
// Idempotent: the outer guard skips any tuple that already has at least one
// irrigation_controllers row. Both inserts use ON CONFLICT DO NOTHING so concurrent or
// repeated calls produce no duplicates. Does not modify property_controllers.

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

const MIGRATION_ID = 'import-irrigation-profile-from-property-controllers-v1';
const MIGRATION_KEY = MIGRATION_ID;

// ── Types ──────────────────────────────────────────────────────────────────────

type LegacyControllerRow = {
  companyId: number;
  customerId: number;
  branchName: string;
  controllerLetter: string;
  zoneCount: number;
};

type TupleKey = string;

function tupleKey(r: LegacyControllerRow): TupleKey {
  return `${r.companyId}:${r.customerId}:${r.branchName}`;
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

/**
 * Load all property_controllers rows whose (companyId, customerId, branchName)
 * tuple has no irrigation_controllers row yet.
 */
async function loadCandidates(): Promise<LegacyControllerRow[]> {
  const result = await db.execute<{
    company_id: string;
    customer_id: string;
    branch_name: string;
    controller_letter: string;
    zone_count: string;
  }>(sql`
    SELECT
      pc.company_id,
      pc.customer_id,
      pc.branch_name,
      pc.controller_letter,
      pc.zone_count
    FROM property_controllers pc
    WHERE NOT EXISTS (
      SELECT 1
      FROM irrigation_controllers ic
      WHERE ic.company_id  = pc.company_id
        AND ic.customer_id = pc.customer_id
        AND ic.branch_name = pc.branch_name
    )
    ORDER BY pc.company_id, pc.customer_id, pc.branch_name, pc.controller_letter
  `);

  return result.rows.map((r) => ({
    companyId: Number(r.company_id),
    customerId: Number(r.customer_id),
    branchName: String(r.branch_name),
    controllerLetter: String(r.controller_letter),
    zoneCount: Number(r.zone_count),
  }));
}

/**
 * Seed one irrigation_controllers row for a legacy controller, plus
 * irrigation_profile_zones placeholder rows 1..zoneCount.
 * Uses ON CONFLICT DO NOTHING — race-safe.
 */
async function seedController(row: LegacyControllerRow): Promise<void> {
  const controllerName = `Controller ${row.controllerLetter}`;

  const inserted = await db.execute<{ id: string }>(sql`
    INSERT INTO irrigation_controllers
      (company_id, customer_id, branch_name, name, total_zones, is_active, created_at, updated_at)
    VALUES
      (${row.companyId}, ${row.customerId}, ${row.branchName}, ${controllerName}, ${row.zoneCount}, true, NOW(), NOW())
    ON CONFLICT (company_id, customer_id, branch_name, name) DO NOTHING
    RETURNING id
  `);

  let controllerId: number;
  if (inserted.rows.length > 0) {
    controllerId = Number((inserted.rows[0] as { id: string }).id);
  } else {
    const existing = await db.execute<{ id: string }>(sql`
      SELECT id FROM irrigation_controllers
      WHERE company_id  = ${row.companyId}
        AND customer_id = ${row.customerId}
        AND branch_name = ${row.branchName}
        AND name        = ${controllerName}
    `);
    if (existing.rows.length === 0) return;
    controllerId = Number((existing.rows[0] as { id: string }).id);
  }

  for (let z = 1; z <= row.zoneCount; z++) {
    const zoneName = `Zone ${z}`;
    await db.execute(sql`
      INSERT INTO irrigation_profile_zones
        (company_id, controller_id, zone_number, name, zone_type, run_time_minutes, zone_order, is_active, created_at, updated_at)
      VALUES
        (${row.companyId}, ${controllerId}, ${z}, ${zoneName}, 'other', 0, ${z}, true, NOW(), NOW())
      ON CONFLICT (company_id, controller_id, zone_number) DO NOTHING
    `);
  }
}

async function markDone(): Promise<void> {
  await db.execute(sql`
    INSERT INTO app_settings (key, value)
    VALUES (${MIGRATION_KEY}, 'completed')
    ON CONFLICT (key) DO UPDATE SET value = 'completed', updated_at = NOW()
  `);
}

// ── check / preview / run ─────────────────────────────────────────────────────

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
      const tuples = new Set(candidates.map(tupleKey));
      return {
        state: 'partially_applied',
        details: `${tuples.size} customer/branch tuple(s) have legacy controllers but no irrigation profile`,
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

  const byTuple = new Map<TupleKey, LegacyControllerRow[]>();
  for (const r of candidates) {
    const k = tupleKey(r);
    if (!byTuple.has(k)) byTuple.set(k, []);
    byTuple.get(k)!.push(r);
  }

  const steps: MigrationStep[] = [];
  for (const [, rows] of byTuple) {
    const first = rows[0]!;
    const letters = rows.map((r) => r.controllerLetter).join(', ');
    const totalZones = rows.reduce((s, r) => s + r.zoneCount, 0);
    steps.push({
      id: tupleKey(first),
      description:
        `Customer ${first.customerId} (company ${first.companyId})` +
        (first.branchName ? ` branch "${first.branchName}"` : '') +
        `: seed ${rows.length} controller(s) [${letters}] → ${totalZones} total zone placeholder(s)`,
    });
  }

  const warnings: string[] = [];
  if (byTuple.size === 0) {
    warnings.push('All customers already have an irrigation profile — nothing to seed.');
  } else {
    warnings.push(
      `Will seed irrigation_controllers rows for ${byTuple.size} customer/branch tuple(s). ` +
      'Uses ON CONFLICT DO NOTHING — safe to re-run. ' +
      'Zone placeholder rows (irrigation_profile_zones) will also be created. ' +
      'property_controllers is not modified.',
    );
  }

  return {
    steps,
    orphanRows: { customersWithoutProfile: byTuple.size },
    warnings,
  };
}

async function run(emit: ProgressEmitter): Promise<MigrationStepResult[]> {
  const candidates = await loadCandidates();

  const byTuple = new Map<TupleKey, LegacyControllerRow[]>();
  for (const r of candidates) {
    const k = tupleKey(r);
    if (!byTuple.has(k)) byTuple.set(k, []);
    byTuple.get(k)!.push(r);
  }

  const results: MigrationStepResult[] = [];

  if (byTuple.size === 0) {
    results.push({ id: 'seed_summary', status: 'skipped', durationMs: 0, rowsAffected: 0 });
    emit({ step: 'seed_summary', status: 'skipped', rowsAffected: 0 });
    await markDone();
    return results;
  }

  let seeded = 0;
  let errors = 0;

  for (const [k, rows] of byTuple) {
    const t = Date.now();
    emit({ step: k, status: 'running' });

    let tupleSeeded = 0;
    let tupleError: string | undefined;

    for (const row of rows) {
      try {
        await seedController(row);
        tupleSeeded++;
        seeded++;
      } catch (err) {
        errors++;
        const msg = err instanceof Error ? err.message : String(err);
        tupleError = tupleError ? `${tupleError}; ${msg}` : msg;
      }
    }

    if (tupleError) {
      results.push({
        id: k,
        status: 'failed',
        durationMs: Date.now() - t,
        rowsAffected: tupleSeeded,
        error: tupleError,
      });
      emit({ step: k, status: 'failed', rowsAffected: tupleSeeded, error: tupleError });
    } else {
      results.push({ id: k, status: 'success', durationMs: Date.now() - t, rowsAffected: tupleSeeded });
      emit({ step: k, status: 'success', rowsAffected: tupleSeeded });
    }
  }

  const summaryStatus = errors > 0 ? 'failed' : 'success';
  results.push({ id: 'seed_summary', status: summaryStatus, durationMs: 0, rowsAffected: seeded });
  emit({ step: 'seed_summary', status: summaryStatus, rowsAffected: seeded });

  if (errors === 0) {
    await markDone();
  }

  return results;
}

export const importIrrigationProfileMigration: MigrationDefinition = {
  id: MIGRATION_ID,
  title: 'Seed irrigation profiles from legacy property controller data',
  description:
    'For every customer that has property_controllers rows but no irrigation_controllers rows, ' +
    'creates one irrigation_controllers row per legacy controller (named "Controller {letter}") ' +
    'with totalZones = the legacy zoneCount. Also seeds irrigation_profile_zones placeholder rows ' +
    '(zone numbers 1…zoneCount) per controller. Skips any tuple that already has at least one ' +
    'irrigation_controllers row. Uses ON CONFLICT DO NOTHING — idempotent and race-safe. ' +
    'Does not modify property_controllers.',
  appSettingsKey: MIGRATION_KEY,
  check,
  preview,
  run,
};
