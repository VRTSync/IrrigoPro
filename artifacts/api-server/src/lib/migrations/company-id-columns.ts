import { db } from '../../db';
import { sql } from 'drizzle-orm';
import type { MigrationDefinition, MigrationStatus, MigrationPreview, MigrationStepResult, ProgressEmitter } from './types';

const MIGRATION_KEY = 'company-id-columns-v1';

const TABLES = ['work_orders', 'billing_sheets', 'invoices', 'estimates'] as const;

async function check(): Promise<MigrationStatus> {
  const marker = await db.execute(
    sql`SELECT value, updated_at FROM app_settings WHERE key = ${MIGRATION_KEY}`
  );
  if (marker.rows.length > 0 && marker.rows[0].value === 'completed') {
    const completedAt = String(marker.rows[0].updated_at ?? '');
    return { state: 'completed', completedAt };
  }

  const cols = await db.execute<{ table_name: string; is_nullable: string }>(sql`
    SELECT table_name, is_nullable FROM information_schema.columns
    WHERE column_name = 'company_id'
      AND table_name IN ('work_orders', 'billing_sheets', 'invoices', 'estimates')
      AND table_schema = 'public'
  `);

  if (cols.rows.length < 4) {
    return { state: 'not_started' };
  }

  const stillNullable = cols.rows.filter((r) => r.is_nullable === 'YES');
  if (stillNullable.length > 0) {
    return {
      state: 'partially_applied',
      details: `${stillNullable.length} of 4 tables still have nullable company_id`,
    };
  }

  return { state: 'completed', completedAt: '' };
}

async function preview(): Promise<MigrationPreview> {
  const orphans: Record<string, number> = {};
  for (const table of TABLES) {
    const r = await db.execute<{ orphans: string }>(sql`
      SELECT COUNT(*)::text AS orphans
      FROM ${sql.identifier(table)} t
      LEFT JOIN customers c ON t.customer_id = c.id
      WHERE t.customer_id IS NOT NULL AND (c.id IS NULL OR c.company_id IS NULL)
    `);
    orphans[table] = parseInt(r.rows[0]?.orphans ?? '0', 10);
  }

  const warnings: string[] = [];
  for (const [tbl, n] of Object.entries(orphans)) {
    if (n > 0) {
      warnings.push(
        `${n} ${tbl} row(s) reference a missing or company-less customer — ` +
        `backfill cannot assign them; fix before running.`,
      );
    }
  }

  return {
    steps: [
      { id: 'step1_add_columns',     description: 'Add nullable company_id columns to all four tables (IF NOT EXISTS)' },
      { id: 'step2_backfill',        description: 'Backfill company_id from customer join on all four tables' },
      { id: 'step3_assert_no_nulls', description: 'Verify zero NULL rows remain — abort if any found' },
      { id: 'step4_apply_not_null',  description: 'Apply NOT NULL constraints to all four tables' },
      { id: 'step5_create_indexes',  description: 'Create indexes on company_id columns' },
      { id: 'step6_mark_completed',  description: 'Mark migration completed in app_settings' },
    ],
    orphanRows: orphans,
    warnings,
  };
}

async function run(emit: ProgressEmitter): Promise<MigrationStepResult[]> {
  const results: MigrationStepResult[] = [];

  // step1 — add nullable columns (IF NOT EXISTS makes this idempotent)
  {
    const t = Date.now();
    emit({ step: 'step1_add_columns', status: 'running' });
    try {
      await db.execute(sql`ALTER TABLE "work_orders"    ADD COLUMN IF NOT EXISTS "company_id" integer REFERENCES "companies"("id")`);
      await db.execute(sql`ALTER TABLE "billing_sheets" ADD COLUMN IF NOT EXISTS "company_id" integer REFERENCES "companies"("id")`);
      await db.execute(sql`ALTER TABLE "invoices"       ADD COLUMN IF NOT EXISTS "company_id" integer REFERENCES "companies"("id")`);
      await db.execute(sql`ALTER TABLE "estimates"      ADD COLUMN IF NOT EXISTS "company_id" integer REFERENCES "companies"("id")`);
      results.push({ id: 'step1_add_columns', status: 'success', durationMs: Date.now() - t });
      emit({ step: 'step1_add_columns', status: 'success' });
    } catch (err: any) {
      const error = err?.message ?? String(err);
      results.push({ id: 'step1_add_columns', status: 'failed', durationMs: Date.now() - t, error });
      emit({ step: 'step1_add_columns', status: 'failed', error });
      return results;
    }
  }

  // step2 — backfill company_id from customer join
  {
    const t = Date.now();
    emit({ step: 'step2_backfill', status: 'running' });
    try {
      const r1 = await db.execute(sql`
        UPDATE "work_orders" wo
          SET "company_id" = c."company_id"
          FROM "customers" c
          WHERE wo."customer_id" = c."id" AND wo."company_id" IS NULL
      `);
      const r2 = await db.execute(sql`
        UPDATE "billing_sheets" bs
          SET "company_id" = c."company_id"
          FROM "customers" c
          WHERE bs."customer_id" = c."id" AND bs."company_id" IS NULL
      `);
      const r3 = await db.execute(sql`
        UPDATE "invoices" inv
          SET "company_id" = c."company_id"
          FROM "customers" c
          WHERE inv."customer_id" = c."id" AND inv."company_id" IS NULL
      `);
      const r4 = await db.execute(sql`
        UPDATE "estimates" est
          SET "company_id" = c."company_id"
          FROM "customers" c
          WHERE est."customer_id" = c."id" AND est."company_id" IS NULL
      `);
      const rowsAffected = (r1.rowCount ?? 0) + (r2.rowCount ?? 0) + (r3.rowCount ?? 0) + (r4.rowCount ?? 0);
      results.push({ id: 'step2_backfill', status: 'success', durationMs: Date.now() - t, rowsAffected });
      emit({ step: 'step2_backfill', status: 'success', rowsAffected });
    } catch (err: any) {
      const error = err?.message ?? String(err);
      results.push({ id: 'step2_backfill', status: 'failed', durationMs: Date.now() - t, error });
      emit({ step: 'step2_backfill', status: 'failed', error });
      return results;
    }
  }

  // step3 — assert zero NULLs remain
  {
    const t = Date.now();
    emit({ step: 'step3_assert_no_nulls', status: 'running' });
    try {
      const nullCounts: Record<string, number> = {};
      for (const table of TABLES) {
        const r = await db.execute<{ nulls: string }>(sql`
          SELECT COUNT(*)::text AS nulls FROM ${sql.identifier(table)} WHERE "company_id" IS NULL
        `);
        nullCounts[table] = parseInt(r.rows[0]?.nulls ?? '0', 10);
      }
      const violators = Object.entries(nullCounts).filter(([, n]) => n > 0);
      if (violators.length > 0) {
        const detail = violators.map(([t, n]) => `${t}: ${n} NULL row(s)`).join(', ');
        const error = `Orphan rows with NULL company_id found — cannot apply NOT NULL. ${detail}`;
        results.push({ id: 'step3_assert_no_nulls', status: 'failed', durationMs: Date.now() - t, error });
        emit({ step: 'step3_assert_no_nulls', status: 'failed', error });
        return results;
      }
      results.push({ id: 'step3_assert_no_nulls', status: 'success', durationMs: Date.now() - t });
      emit({ step: 'step3_assert_no_nulls', status: 'success' });
    } catch (err: any) {
      const error = err?.message ?? String(err);
      results.push({ id: 'step3_assert_no_nulls', status: 'failed', durationMs: Date.now() - t, error });
      emit({ step: 'step3_assert_no_nulls', status: 'failed', error });
      return results;
    }
  }

  // step4 — apply NOT NULL constraints
  {
    const t = Date.now();
    emit({ step: 'step4_apply_not_null', status: 'running' });
    try {
      await db.execute(sql`ALTER TABLE "work_orders"    ALTER COLUMN "company_id" SET NOT NULL`);
      await db.execute(sql`ALTER TABLE "billing_sheets" ALTER COLUMN "company_id" SET NOT NULL`);
      await db.execute(sql`ALTER TABLE "invoices"       ALTER COLUMN "company_id" SET NOT NULL`);
      await db.execute(sql`ALTER TABLE "estimates"      ALTER COLUMN "company_id" SET NOT NULL`);
      results.push({ id: 'step4_apply_not_null', status: 'success', durationMs: Date.now() - t });
      emit({ step: 'step4_apply_not_null', status: 'success' });
    } catch (err: any) {
      const error = err?.message ?? String(err);
      results.push({ id: 'step4_apply_not_null', status: 'failed', durationMs: Date.now() - t, error });
      emit({ step: 'step4_apply_not_null', status: 'failed', error });
      return results;
    }
  }

  // step5 — create indexes
  {
    const t = Date.now();
    emit({ step: 'step5_create_indexes', status: 'running' });
    try {
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "work_orders_company_idx"                  ON "work_orders"    ("company_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "work_orders_company_status_scheduled_idx" ON "work_orders"    ("company_id", "status", "scheduled_date")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "billing_sheets_company_idx"               ON "billing_sheets" ("company_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "invoices_company_idx"                     ON "invoices"       ("company_id")`);
      results.push({ id: 'step5_create_indexes', status: 'success', durationMs: Date.now() - t });
      emit({ step: 'step5_create_indexes', status: 'success' });
    } catch (err: any) {
      const error = err?.message ?? String(err);
      results.push({ id: 'step5_create_indexes', status: 'failed', durationMs: Date.now() - t, error });
      emit({ step: 'step5_create_indexes', status: 'failed', error });
      return results;
    }
  }

  // step6 — mark completed in app_settings
  {
    const t = Date.now();
    emit({ step: 'step6_mark_completed', status: 'running' });
    try {
      await db.execute(sql`
        INSERT INTO app_settings (key, value) VALUES (${MIGRATION_KEY}, 'completed')
        ON CONFLICT (key) DO UPDATE SET value = 'completed', updated_at = NOW()
      `);
      results.push({ id: 'step6_mark_completed', status: 'success', durationMs: Date.now() - t });
      emit({ step: 'step6_mark_completed', status: 'success' });
    } catch (err: any) {
      const error = err?.message ?? String(err);
      results.push({ id: 'step6_mark_completed', status: 'failed', durationMs: Date.now() - t, error });
      emit({ step: 'step6_mark_completed', status: 'failed', error });
      return results;
    }
  }

  return results;
}

export const companyIdColumnsMigration: MigrationDefinition = {
  id: MIGRATION_KEY,
  title: 'Add company_id columns + backfill (Slice 4)',
  description:
    'Adds company_id to work_orders, billing_sheets, invoices, and tightens ' +
    'estimates.company_id to NOT NULL. Backfills from the customer link, ' +
    'verifies no orphans remain, applies constraints, creates indexes. ' +
    'Idempotent — safe to re-run.',
  appSettingsKey: MIGRATION_KEY,
  check,
  preview,
  run,
};
