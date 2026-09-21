// Retire the deferred-items follow-up work orders.
//
// Background: the completion route used to diff a work order's items against
// its originating estimate and auto-create a "follow-up" work order carrying
// every quoted-but-unused part. Three of those follow-ups at Woodglenn Squares
// HOA are phantoms: the technician substituted poly for the quoted PVC, the
// repair was finished, and the diff read the unused quoted parts as deferred
// work. Their parents are completed, manager-approved and billed, so the
// phantoms can never be reconciled back — they only sit in the active queue as
// non-continuous billing lines.
//
// Safety contract:
//   – Writes ONLY the three named phantom work orders, resolved by
//     work_order_number (not by the lineage column, which a later task drops).
//   – WO-1786572356558-607 is the genuine migration-built follow-up carrying 18
//     undone repairs and 22.50 approved hours. It is resolved, asserted present
//     and reported as an explicit no-op. No write path can reach it: every
//     UPDATE is guarded by the phantom number list AND an explicit
//     work_order_number <> keeper predicate.
//   – Aborts before any write when fewer than three phantoms resolve, when a
//     phantom is in a status other than pending/assigned (already-cancelled is
//     a clean skip), or when any resolved row's company is not the expected
//     Woodglenn company.
//   – Cancellation only. Nothing is hard-deleted; work_order_items are left
//     intact so the record stays auditable.
//   – The preview (and the run's read-only report) enumerates EVERY work order
//     with a non-null parent link, because the three named numbers came off a
//     one-day snapshot while the mechanism stayed live. Anything outside the
//     four named records is reported as a finding for human triage — it is
//     never cancelled and it never aborts the run.
//   – Idempotent: a re-run reports the three cancel steps as skipped.

import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { recordAuditEvent, type AuditEventInput } from '../../routes/audit-log';
import { logger } from '../logger';
import type {
  MigrationDefinition,
  MigrationStatus,
  MigrationPreview,
  MigrationStep,
  MigrationStepResult,
  ProgressEmitter,
} from './types';

const MIGRATION_ID = 'retire-followup-work-orders-v1';
export const RETIRE_FOLLOWUP_DONE_KEY = 'retireFollowupWorkOrders.done';

/** Woodglenn Squares HOA. Every resolved named row must belong to this company. */
export const EXPECTED_COMPANY_ID = 1;

/** The three phantom follow-ups. These are the ONLY rows this migration writes. */
export const PHANTOM_WORK_ORDER_NUMBERS = [
  'WO-1787334011979-485',
  'WO-1787333883734-723',
  'WO-1787333695634-675',
] as const;

/** The genuine follow-up. Resolved, asserted, never written. */
export const KEEPER_WORK_ORDER_NUMBER = 'WO-1786572356558-607';

const CANCELLED_STATUS = 'cancelled';
const CANCELLABLE_STATUSES = ['pending', 'assigned'] as const;

const NAMED_WORK_ORDER_NUMBERS: string[] = [
  ...PHANTOM_WORK_ORDER_NUMBERS,
  KEEPER_WORK_ORDER_NUMBER,
];

// ── Row shape ────────────────────────────────────────────────────────────────

export type FollowUpWorkOrderRow = {
  id: number;
  workOrderNumber: string;
  status: string | null;
  companyId: number | null;
  customerName: string | null;
  parentWorkOrderId: number | null;
  /** Resolved via a self-join; null when the parent row is gone. */
  parentWorkOrderNumber: string | null;
};

// ── Deps (injectable so the logic layer is testable without a DB) ────────────

export type RetireFollowUpDeps = {
  /** The four named records, looked up by work_order_number. */
  getNamedRecords(): Promise<FollowUpWorkOrderRow[]>;
  /** Every work order with a non-null parent link. Read-only, never gates a write. */
  getFollowUpLinkedRecords(): Promise<FollowUpWorkOrderRow[]>;
  /**
   * Cancels one phantom and records its audit event in the same transaction.
   * Returns the committed row count — 0 means the guarded UPDATE matched
   * nothing (concurrent modification) and must be reported as a failure.
   */
  cancelPhantom(row: FollowUpWorkOrderRow): Promise<{ rowsAffected: number }>;
  /** Fresh post-commit read of the four named records. */
  reReadNamedRecords(): Promise<FollowUpWorkOrderRow[]>;
  markDone(): Promise<void>;
};

// ── Pure helpers (exported for tests) ────────────────────────────────────────

export function isPhantomNumber(workOrderNumber: string): boolean {
  return (PHANTOM_WORK_ORDER_NUMBERS as readonly string[]).includes(workOrderNumber);
}

function describeRow(row: FollowUpWorkOrderRow): string {
  const parent = row.parentWorkOrderNumber
    ? row.parentWorkOrderNumber
    : row.parentWorkOrderId != null
      ? `#${row.parentWorkOrderId}`
      : 'none';
  return (
    `${row.workOrderNumber} (id ${row.id}, status ${row.status ?? 'unknown'}, ` +
    `company ${row.companyId ?? 'unknown'}, parent ${parent})`
  );
}

export type PreflightResult =
  | { ok: true; phantoms: FollowUpWorkOrderRow[]; keeper: FollowUpWorkOrderRow }
  | { ok: false; errors: string[] };

/**
 * Validates the four named records before anything is written. Every violation
 * is collected so the operator sees the whole picture in one failed step.
 */
export function preflightNamedRecords(named: FollowUpWorkOrderRow[]): PreflightResult {
  const errors: string[] = [];

  const phantoms = named.filter((row) => isPhantomNumber(row.workOrderNumber));
  const keeper = named.find((row) => row.workOrderNumber === KEEPER_WORK_ORDER_NUMBER) ?? null;

  // 1. All three phantoms must resolve.
  const missing = PHANTOM_WORK_ORDER_NUMBERS.filter(
    (num) => !phantoms.some((row) => row.workOrderNumber === num),
  );
  if (missing.length > 0) {
    errors.push(
      `Only ${phantoms.length} of ${PHANTOM_WORK_ORDER_NUMBERS.length} named phantom work order(s) resolved — ` +
      `missing: ${missing.join(', ')}. This migration only applies to the production database.`,
    );
  }

  // 2. Every resolved named row must belong to the expected company.
  for (const row of named) {
    if (Number(row.companyId) !== EXPECTED_COMPANY_ID) {
      errors.push(
        `${row.workOrderNumber} resolved to company ${row.companyId ?? 'null'}, ` +
        `expected ${EXPECTED_COMPANY_ID} (Woodglenn Squares HOA) — refusing to write to another tenant.`,
      );
    }
  }

  // 3. Every phantom must be cancellable (or already cancelled, which is a skip).
  for (const row of phantoms) {
    const status = row.status ?? '';
    if (status === CANCELLED_STATUS) continue;
    if (!(CANCELLABLE_STATUSES as readonly string[]).includes(status)) {
      errors.push(
        `${row.workOrderNumber} is in status "${status || 'unknown'}" — expected one of ` +
        `${CANCELLABLE_STATUSES.join('/')} (or already ${CANCELLED_STATUS}). ` +
        'Something moved this record outside this migration; refusing to guess.',
      );
    }
  }

  // 4. The keeper must be present AND still live. Its absence — or a status
  //    that says something already moved it — means this is not the database
  //    these constants were verified against.
  if (!keeper) {
    errors.push(
      `Keeper work order ${KEEPER_WORK_ORDER_NUMBER} did not resolve. It carries the only record of ` +
      'work still owed to the customer; refusing to run against a database where it is missing.',
    );
  } else if (!(CANCELLABLE_STATUSES as readonly string[]).includes(keeper.status ?? '')) {
    errors.push(
      `Keeper work order ${KEEPER_WORK_ORDER_NUMBER} is in status "${keeper.status || 'unknown'}" — expected ` +
      `one of ${CANCELLABLE_STATUSES.join('/')}. The genuine outstanding-work record must still be live ` +
      'before this cleanup proceeds; refusing to write.',
    );
  }

  if (errors.length > 0 || !keeper) {
    return { ok: false, errors };
  }
  return { ok: true, phantoms, keeper };
}

/** Rows with a parent link that are not one of the four named records. */
export function extraFollowUpRows(linked: FollowUpWorkOrderRow[]): FollowUpWorkOrderRow[] {
  return linked.filter((row) => !NAMED_WORK_ORDER_NUMBERS.includes(row.workOrderNumber));
}

function extraFindingStep(row: FollowUpWorkOrderRow): MigrationStep {
  return {
    id: `finding_extra_${row.workOrderNumber}`,
    description:
      `FINDING — unenumerated follow-up-linked work order ${row.workOrderNumber} ` +
      `(id ${row.id}): status ${row.status ?? 'unknown'}, company ${row.companyId ?? 'unknown'}, ` +
      `parent ${row.parentWorkOrderNumber ?? (row.parentWorkOrderId != null ? `#${row.parentWorkOrderId}` : 'unknown')}. ` +
      'Reported only — this migration does NOT cancel it. Triage before the parent link column is dropped.',
  };
}

export function buildRetireFollowUpPreview(
  named: FollowUpWorkOrderRow[],
  linked: FollowUpWorkOrderRow[],
  opts: { parentColumnMissing?: boolean } = {},
): MigrationPreview {
  const steps: MigrationStep[] = [];
  const warnings: string[] = [];

  let toCancel = 0;
  let alreadyCancelled = 0;

  for (const number of PHANTOM_WORK_ORDER_NUMBERS) {
    const row = named.find((r) => r.workOrderNumber === number);
    if (!row) {
      steps.push({
        id: `cancel_${number}`,
        description: `${number}: NOT FOUND in this database — run() will abort without writing.`,
      });
      continue;
    }
    if (row.status === CANCELLED_STATUS) {
      alreadyCancelled++;
      steps.push({
        id: `cancel_${number}`,
        description: `${describeRow(row)}: already cancelled — will be skipped.`,
      });
      continue;
    }
    toCancel++;
    steps.push({
      id: `cancel_${number}`,
      description:
        `${describeRow(row)}: status "${row.status ?? 'unknown'}" → "${CANCELLED_STATUS}". ` +
        'Line items are left intact; one audit entry is written against the work order.',
    });
  }

  const keeper = named.find((r) => r.workOrderNumber === KEEPER_WORK_ORDER_NUMBER);
  steps.push({
    id: `keep_${KEEPER_WORK_ORDER_NUMBER}`,
    description: keeper
      ? `${describeRow(keeper)}: genuine follow-up carrying undone repairs — resolved and asserted present, NOT modified.`
      : `${KEEPER_WORK_ORDER_NUMBER}: NOT FOUND — run() will abort without writing (the keeper must be present).`,
  });

  const extras = extraFollowUpRows(linked);
  for (const row of extras) steps.push(extraFindingStep(row));

  // Preflight violations are what run() would abort on — surface them here.
  const preflight = preflightNamedRecords(named);
  if (!preflight.ok) {
    for (const error of preflight.errors) warnings.push(`ABORT CONDITION: ${error}`);
  }

  if (opts.parentColumnMissing) {
    warnings.push(
      'The parent_work_order_id column no longer exists in this database — the full follow-up ' +
      'population could not be enumerated. Only the four named records are reported.',
    );
  } else if (extras.length === 0) {
    warnings.push(
      'No follow-up-linked work orders beyond the four named records were found — the named set ' +
      'is the whole population in this database.',
    );
  } else {
    warnings.push(
      `${extras.length} follow-up-linked work order(s) beyond the four named records were found. ` +
      'They are REPORTED ONLY — this migration does not cancel them, and they do not abort the run. ' +
      'Triage them before the parent_work_order_id column is dropped, or they become unexplained ' +
      'pending work orders with nothing left to say where they came from.',
    );
  }

  warnings.push(
    `Writes at most ${PHANTOM_WORK_ORDER_NUMBERS.length} row(s): ${PHANTOM_WORK_ORDER_NUMBERS.join(', ')} — ` +
    `status → ${CANCELLED_STATUS} only. Nothing is deleted, no work_order_items are touched, and ` +
    `${KEEPER_WORK_ORDER_NUMBER} is never written to.`,
  );
  warnings.push(
    'run() aborts before any write if fewer than three phantoms resolve, if a phantom is in a status ' +
    `other than ${CANCELLABLE_STATUSES.join('/')} (already-cancelled is a clean skip), or if any resolved ` +
    `record belongs to a company other than ${EXPECTED_COMPANY_ID}.`,
  );

  return {
    steps,
    orphanRows: {
      namedRecordsResolved: named.length,
      phantomsToCancel: toCancel,
      phantomsAlreadyCancelled: alreadyCancelled,
      extraFollowUpLinked: extras.length,
    },
    warnings,
  };
}

// ── Deps-injectable runner (exported for tests) ──────────────────────────────

export async function runRetireFollowUpMigration(
  deps: RetireFollowUpDeps,
  emit: ProgressEmitter,
  log: (data: Record<string, unknown>, msg: string) => void = (data, msg) => logger.info(data, msg),
): Promise<MigrationStepResult[]> {
  const results: MigrationStepResult[] = [];

  // ── Preflight: resolve the four named records, validate, write nothing ────
  const tPre = Date.now();
  emit({ step: 'preflight', status: 'running' });

  let named: FollowUpWorkOrderRow[];
  try {
    named = await deps.getNamedRecords();
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    emit({ step: 'preflight', status: 'failed', error });
    return [{ id: 'preflight', status: 'failed', durationMs: Date.now() - tPre, error }];
  }

  const preflight = preflightNamedRecords(named);
  if (!preflight.ok) {
    const error =
      'Preflight failed — nothing was written:\n' +
      preflight.errors.map((e) => `  • ${e}`).join('\n');
    emit({ step: 'preflight', status: 'failed', error });
    return [{ id: 'preflight', status: 'failed', durationMs: Date.now() - tPre, error }];
  }

  // Step 6 — log the resolved ids, statuses and companies BEFORE writing.
  log(
    {
      migrationId: MIGRATION_ID,
      phase: 'before',
      records: named.map((row) => ({
        id: row.id,
        workOrderNumber: row.workOrderNumber,
        status: row.status,
        companyId: row.companyId,
        parentWorkOrderId: row.parentWorkOrderId,
      })),
    },
    '[retire-followup-work-orders] resolved named records before writing',
  );

  emit({ step: 'preflight', status: 'success', rowsAffected: 0 });
  results.push({ id: 'preflight', status: 'success', durationMs: Date.now() - tPre, rowsAffected: 0 });

  // ── Cancel the three phantoms ─────────────────────────────────────────────
  let failures = 0;

  for (const number of PHANTOM_WORK_ORDER_NUMBERS) {
    const row = preflight.phantoms.find((r) => r.workOrderNumber === number)!;
    const stepId = `cancel_${number}`;
    const t0 = Date.now();

    if (row.status === CANCELLED_STATUS) {
      emit({ step: stepId, status: 'skipped', rowsAffected: 0 });
      results.push({ id: stepId, status: 'skipped', durationMs: Date.now() - t0, rowsAffected: 0 });
      continue;
    }

    // Defensive interlock: the loop only ever walks the phantom list, but the
    // write path refuses anything that is not a phantom regardless.
    if (!isPhantomNumber(row.workOrderNumber) || row.workOrderNumber === KEEPER_WORK_ORDER_NUMBER) {
      const error = `Refusing to write to ${row.workOrderNumber} — not a named phantom.`;
      emit({ step: stepId, status: 'failed', error });
      results.push({ id: stepId, status: 'failed', durationMs: Date.now() - t0, error });
      failures++;
      continue;
    }

    emit({ step: stepId, status: 'running' });
    try {
      const { rowsAffected } = await deps.cancelPhantom(row);
      if (rowsAffected === 0) {
        const error =
          `${row.workOrderNumber} guarded update matched 0 rows — the record changed status, ` +
          'company or existence since preflight. Nothing was written for this record.';
        emit({ step: stepId, status: 'failed', error });
        results.push({ id: stepId, status: 'failed', durationMs: Date.now() - t0, error });
        failures++;
        continue;
      }
      emit({ step: stepId, status: 'success', rowsAffected });
      results.push({ id: stepId, status: 'success', durationMs: Date.now() - t0, rowsAffected });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      emit({ step: stepId, status: 'failed', error });
      results.push({ id: stepId, status: 'failed', durationMs: Date.now() - t0, error });
      failures++;
    }
  }

  // ── The keeper: resolved, asserted, explicitly not touched ────────────────
  const keeperStepId = `keep_${KEEPER_WORK_ORDER_NUMBER}`;
  emit({ step: keeperStepId, status: 'skipped', rowsAffected: 0 });
  results.push({ id: keeperStepId, status: 'skipped', durationMs: 0, rowsAffected: 0 });

  // ── Read-only report of anything else still carrying a parent link ────────
  try {
    const linked = await deps.getFollowUpLinkedRecords();
    for (const row of extraFollowUpRows(linked)) {
      const stepId = `finding_extra_${row.workOrderNumber}`;
      emit({ step: stepId, status: 'skipped', rowsAffected: 0 });
      results.push({
        id: stepId,
        status: 'skipped',
        durationMs: 0,
        rowsAffected: 0,
        error:
          `Reported only: ${describeRow(row)}. Not cancelled by this migration — triage before the ` +
          'parent link column is dropped.',
      });
    }
  } catch (err) {
    // The enumeration is read-only context; it must never fail the run.
    log(
      { migrationId: MIGRATION_ID, err: err instanceof Error ? err.message : String(err) },
      '[retire-followup-work-orders] follow-up population enumeration failed (reported only)',
    );
  }

  // ── Step 6 — the run's own report is not proof; re-read after commit ──────
  const tVerify = Date.now();
  emit({ step: 'verify', status: 'running' });
  try {
    const after = await deps.reReadNamedRecords();
    log(
      {
        migrationId: MIGRATION_ID,
        phase: 'after',
        records: after.map((row) => ({
          id: row.id,
          workOrderNumber: row.workOrderNumber,
          status: row.status,
          companyId: row.companyId,
          parentWorkOrderId: row.parentWorkOrderId,
        })),
      },
      '[retire-followup-work-orders] re-read named records after writing',
    );

    const problems: string[] = [];
    for (const number of PHANTOM_WORK_ORDER_NUMBERS) {
      const row = after.find((r) => r.workOrderNumber === number);
      if (!row) {
        problems.push(`${number} no longer resolves after the run.`);
      } else if (row.status !== CANCELLED_STATUS) {
        problems.push(`${number} is still in status "${row.status ?? 'unknown'}" after the run.`);
      }
    }
    const keeperBefore = preflight.keeper;
    const keeperAfter = after.find((r) => r.workOrderNumber === KEEPER_WORK_ORDER_NUMBER);
    if (!keeperAfter) {
      problems.push(`${KEEPER_WORK_ORDER_NUMBER} no longer resolves after the run.`);
    } else if (keeperAfter.status !== keeperBefore.status || keeperAfter.id !== keeperBefore.id) {
      problems.push(
        `${KEEPER_WORK_ORDER_NUMBER} changed during the run ` +
        `(was id ${keeperBefore.id}/${keeperBefore.status ?? 'unknown'}, ` +
        `now id ${keeperAfter.id}/${keeperAfter.status ?? 'unknown'}).`,
      );
    }

    if (problems.length > 0) {
      const error = `Post-write re-read disagrees with the run:\n${problems.map((p) => `  • ${p}`).join('\n')}`;
      emit({ step: 'verify', status: 'failed', error });
      results.push({ id: 'verify', status: 'failed', durationMs: Date.now() - tVerify, error });
      failures++;
    } else {
      emit({ step: 'verify', status: 'success', rowsAffected: 0 });
      results.push({ id: 'verify', status: 'success', durationMs: Date.now() - tVerify, rowsAffected: 0 });
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    emit({ step: 'verify', status: 'failed', error });
    results.push({ id: 'verify', status: 'failed', durationMs: Date.now() - tVerify, error });
    failures++;
  }

  if (failures === 0) {
    await deps.markDone();
  }

  return results;
}

// ── DB layer ─────────────────────────────────────────────────────────────────

type RawRow = {
  id: number | string;
  work_order_number: string;
  status: string | null;
  company_id: number | string | null;
  customer_name: string | null;
  parent_work_order_id: number | string | null;
  parent_work_order_number: string | null;
};

function mapRow(r: RawRow): FollowUpWorkOrderRow {
  return {
    id: Number(r.id),
    workOrderNumber: String(r.work_order_number),
    status: r.status,
    companyId: r.company_id != null ? Number(r.company_id) : null,
    customerName: r.customer_name ?? null,
    parentWorkOrderId: r.parent_work_order_id != null ? Number(r.parent_work_order_id) : null,
    parentWorkOrderNumber: r.parent_work_order_number ?? null,
  };
}

/**
 * The lineage column is dropped by a later task. Guarding on its existence
 * keeps this migration's check()/preview() from 500-ing the admin page once
 * that happens.
 */
async function parentColumnExists(): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_orders' AND column_name = 'parent_work_order_id'
    LIMIT 1
  `);
  return result.rows.length > 0;
}

const namedNumberList = sql.join(
  NAMED_WORK_ORDER_NUMBERS.map((n) => sql`${n}`),
  sql`, `,
);

const phantomNumberList = sql.join(
  PHANTOM_WORK_ORDER_NUMBERS.map((n) => sql`${n}`),
  sql`, `,
);

async function queryNamedRecords(): Promise<FollowUpWorkOrderRow[]> {
  const hasParentColumn = await parentColumnExists();
  const result = hasParentColumn
    ? await db.execute<RawRow>(sql`
        SELECT wo.id,
               wo.work_order_number,
               wo.status,
               wo.company_id,
               wo.customer_name,
               wo.parent_work_order_id,
               parent.work_order_number AS parent_work_order_number
        FROM work_orders wo
        LEFT JOIN work_orders parent ON parent.id = wo.parent_work_order_id
        WHERE wo.work_order_number IN (${namedNumberList})
        ORDER BY wo.id
      `)
    : await db.execute<RawRow>(sql`
        SELECT wo.id,
               wo.work_order_number,
               wo.status,
               wo.company_id,
               wo.customer_name,
               NULL::integer AS parent_work_order_id,
               NULL::text    AS parent_work_order_number
        FROM work_orders wo
        WHERE wo.work_order_number IN (${namedNumberList})
        ORDER BY wo.id
      `);
  return result.rows.map(mapRow);
}

async function queryFollowUpLinkedRecords(): Promise<FollowUpWorkOrderRow[]> {
  if (!(await parentColumnExists())) return [];
  const result = await db.execute<RawRow>(sql`
    SELECT wo.id,
           wo.work_order_number,
           wo.status,
           wo.company_id,
           wo.customer_name,
           wo.parent_work_order_id,
           parent.work_order_number AS parent_work_order_number
    FROM work_orders wo
    LEFT JOIN work_orders parent ON parent.id = wo.parent_work_order_id
    WHERE wo.parent_work_order_id IS NOT NULL
    ORDER BY wo.id
  `);
  return result.rows.map(mapRow);
}

/**
 * The exact audit payload written for a cancelled phantom. Pure and exported so
 * the real contract (action name, severity, target, attribution, summary) is
 * covered by tests rather than only by a test double.
 */
export function buildCancellationAuditEvent(row: FollowUpWorkOrderRow): AuditEventInput {
  const parentLabel =
    row.parentWorkOrderNumber ??
    (row.parentWorkOrderId != null ? `#${row.parentWorkOrderId}` : 'unknown parent');

  return {
    action: 'work_order.cancelled',
    actionType: 'data_repair',
    targetType: 'work_order',
    targetId: String(row.id),
    severity: 'warning',
    actorLabel: 'super_admin_migration',
    actorCompanyId: row.companyId ?? EXPECTED_COMPANY_ID,
    summary:
      `Cancelled by migration ${MIGRATION_ID} (Task #2028): retiring the deferred-items follow-up ` +
      `auto-created from parent work order ${parentLabel}. The parent's repair was completed with ` +
      'substituted parts, so this follow-up carried no real outstanding work. Line items left intact.',
    details: {
      migrationId: MIGRATION_ID,
      taskRef: '2028',
      workOrderNumber: row.workOrderNumber,
      previousStatus: row.status,
      newStatus: CANCELLED_STATUS,
      parentWorkOrderId: row.parentWorkOrderId,
      parentWorkOrderNumber: row.parentWorkOrderNumber,
    },
  };
}

async function cancelPhantomDb(row: FollowUpWorkOrderRow): Promise<{ rowsAffected: number }> {
  return db.transaction(async (tx) => {
    // Every predicate here is a guard: the id, its own number, the phantom
    // allow-list, an explicit keeper denial, the tenant, and the status the
    // preflight saw. Anything else matches zero rows and writes nothing.
    const updated = await tx.execute(sql`
      UPDATE work_orders
      SET status = ${CANCELLED_STATUS}, updated_at = NOW()
      WHERE id = ${row.id}
        AND work_order_number = ${row.workOrderNumber}
        AND work_order_number IN (${phantomNumberList})
        AND work_order_number <> ${KEEPER_WORK_ORDER_NUMBER}
        AND company_id = ${EXPECTED_COMPANY_ID}
        AND status IN (${sql.join(CANCELLABLE_STATUSES.map((s) => sql`${s}`), sql`, `)})
    `);

    const rowsAffected = Number((updated as { rowCount?: number | null }).rowCount ?? 0);
    if (rowsAffected === 0) return { rowsAffected: 0 };

    await recordAuditEvent(null, buildCancellationAuditEvent(row), { tx, strict: true });

    return { rowsAffected };
  });
}

async function markDoneDb(): Promise<void> {
  const now = new Date().toISOString();
  await db.execute(sql`
    INSERT INTO app_settings (key, value)
    VALUES (${RETIRE_FOLLOWUP_DONE_KEY}, ${now})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `);
}

export function createRetireFollowUpDbDeps(): RetireFollowUpDeps {
  return {
    getNamedRecords: queryNamedRecords,
    getFollowUpLinkedRecords: queryFollowUpLinkedRecords,
    cancelPhantom: cancelPhantomDb,
    reReadNamedRecords: queryNamedRecords,
    markDone: markDoneDb,
  };
}

async function readMarker(): Promise<string | null> {
  const marker = await db.execute<{ value: unknown; updated_at: unknown }>(sql`
    SELECT value, updated_at FROM app_settings WHERE key = ${RETIRE_FOLLOWUP_DONE_KEY} LIMIT 1
  `);
  if (marker.rows.length === 0) return null;
  const row = marker.rows[0];
  return String(row.value ?? row.updated_at ?? '');
}

// ── check / preview / run (framework contract) ───────────────────────────────

/** Pure status resolution, exported so the states are testable without a DB. */
export function resolveRetireFollowUpStatus(
  named: FollowUpWorkOrderRow[],
  marker: string | null,
): MigrationStatus {
  const phantoms = named.filter((row) => isPhantomNumber(row.workOrderNumber));
  const remaining = phantoms.filter((row) => row.status !== CANCELLED_STATUS).length;

  if (phantoms.length === 0) {
    // Not the production database (or the rows are gone) — nothing to retire.
    return marker != null
      ? { state: 'completed', completedAt: marker }
      : { state: 'not_started' };
  }
  if (remaining === 0) {
    return { state: 'completed', completedAt: marker ?? '' };
  }
  if (marker != null) {
    return {
      state: 'partially_applied',
      details: `${remaining} phantom follow-up work order(s) are still active`,
    };
  }
  return { state: 'not_started' };
}

async function check(): Promise<MigrationStatus> {
  try {
    const [named, marker] = await Promise.all([queryNamedRecords(), readMarker()]);
    return resolveRetireFollowUpStatus(named, marker);
  } catch (err) {
    return { state: 'error', details: err instanceof Error ? err.message : String(err) };
  }
}

async function preview(): Promise<MigrationPreview> {
  const hasParentColumn = await parentColumnExists();
  const [named, linked] = await Promise.all([
    queryNamedRecords(),
    hasParentColumn ? queryFollowUpLinkedRecords() : Promise.resolve<FollowUpWorkOrderRow[]>([]),
  ]);
  return buildRetireFollowUpPreview(named, linked, { parentColumnMissing: !hasParentColumn });
}

async function run(emit: ProgressEmitter): Promise<MigrationStepResult[]> {
  return runRetireFollowUpMigration(createRetireFollowUpDbDeps(), emit);
}

export const retireFollowupWorkOrdersMigration: MigrationDefinition = {
  id: MIGRATION_ID,
  title: 'Retire the phantom deferred-items follow-up work orders',
  description:
    'Cancels the three phantom follow-up work orders at Woodglenn Squares HOA ' +
    `(${PHANTOM_WORK_ORDER_NUMBERS.join(', ')}) that the deferred-items diff auto-created when their ` +
    'parents were completed with substituted parts. The parents are completed, approved and billed, ' +
    'so the follow-ups can never be reconciled back. Cancellation only — nothing is deleted and ' +
    'line items stay intact, with one audit entry per cancelled record on its Activity tab. ' +
    `${KEEPER_WORK_ORDER_NUMBER}, the genuine follow-up carrying 18 undone repairs and 22.50 approved ` +
    'hours, is resolved, asserted present and never written to. The preview additionally enumerates ' +
    'every work order that still carries a parent link and reports anything outside the named four as ' +
    'a finding for human triage — reported only, never cancelled. Idempotent: a re-run skips.',
  appSettingsKey: RETIRE_FOLLOWUP_DONE_KEY,
  check,
  preview,
  run,
};
