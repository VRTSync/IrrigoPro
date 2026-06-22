// Backfill `wet_checks.branch_name` from their associated
// `wet_check_billings` rows.
//
// Existing wet checks were created before `branch_name` was captured at
// the wet-check level. The `wet_check_billings` table already carries
// `branch_name` on many rows (it was added there first). This script
// joins wet_checks → wet_check_billings and stamps the billing's
// `branch_name` onto the wet check row wherever the check has NULL but
// at least one of its billings has a non-null value.
//
// When a wet check has multiple billing rows with different non-null
// branch names (an unusual edge case), the earliest billing row's value
// wins — it represents the original billing context for that inspection.
//
// Idempotent: only rows where `wet_checks.branch_name IS NULL` are
// considered; rows already stamped are skipped automatically.
//
// Resumable: processed wet-check ids are persisted to
// `app_settings.wetCheckBranchBackfill.done` after every batch so a
// mid-run crash or timeout can resume safely.
//
// Run:
//   node --import tsx/esm \
//     artifacts/api-server/src/scripts/backfill-wet-check-branch.ts \
//     [--dry-run] [--batch=500]

try { (process.stdout as unknown as { _handle?: { setBlocking?: (b: boolean) => void } })._handle?.setBlocking?.(true); } catch {}
try { (process.stderr as unknown as { _handle?: { setBlocking?: (b: boolean) => void } })._handle?.setBlocking?.(true); } catch {}

import { db } from "../db";
import { wetChecks, wetCheckBillings, appSettings } from "@workspace/db";
import { eq, isNull, isNotNull, sql } from "drizzle-orm";

const DONE_KEY = "wetCheckBranchBackfill.done";
const FAIL_KEY = "wetCheckBranchBackfill.failed";

function parseFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const n = Number(raw.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function loadIdSet(key: string): Promise<Set<number>> {
  const rows = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, key));
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
    // Corrupt value — start fresh.
  }
  return new Set();
}

async function saveDoneSet(ids: Set<number>): Promise<void> {
  const value = JSON.stringify(Array.from(ids).sort((a, b) => a - b));
  await db
    .insert(appSettings)
    .values({ key: DONE_KEY, value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

interface FailureEntry {
  id: number;
  error: string;
  at: string;
}

async function loadFailures(): Promise<FailureEntry[]> {
  const rows = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, FAIL_KEY));
  if (rows.length === 0) return [];
  try {
    const parsed = JSON.parse(String((rows[0] as { value: string }).value));
    return Array.isArray(parsed) ? (parsed as FailureEntry[]) : [];
  } catch {
    return [];
  }
}

async function appendFailure(entry: FailureEntry): Promise<void> {
  const existing = await loadFailures();
  const value = JSON.stringify([...existing, entry]);
  await db
    .insert(appSettings)
    .values({ key: FAIL_KEY, value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

async function main(): Promise<void> {
  const dryRun = parseFlag("dry-run");
  const batchSize = parseArg("batch", 500);

  console.log(
    `[backfill-wet-check-branch] starting (dryRun=${dryRun}, batch=${batchSize})`,
  );

  const done = await loadIdSet(DONE_KEY);
  console.log(
    `[backfill-wet-check-branch] resume — ${done.size} wet-check ids already processed`,
  );

  let lastId = 0;
  let scanned = 0;
  let updated = 0;
  let skippedAlreadyDone = 0;
  let skippedNoBilling = 0;
  let failed = 0;

  for (;;) {
    // Fetch the next batch of wet checks whose branch_name is NULL.
    const rows = await db
      .select({ id: wetChecks.id })
      .from(wetChecks)
      .where(
        sql`${wetChecks.id} > ${lastId} AND ${wetChecks.branchName} IS NULL`,
      )
      .orderBy(wetChecks.id)
      .limit(batchSize);

    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      lastId = row.id;

      if (done.has(row.id)) {
        skippedAlreadyDone += 1;
        continue;
      }

      try {
        // Find the earliest billing row for this wet check that has a
        // non-null branch_name. Ordering by id ascending gives us the
        // original billing context when multiple rows exist.
        const billings = await db
          .select({ branchName: wetCheckBillings.branchName })
          .from(wetCheckBillings)
          .where(
            sql`${wetCheckBillings.wetCheckId} = ${row.id} AND ${wetCheckBillings.branchName} IS NOT NULL`,
          )
          .orderBy(wetCheckBillings.id)
          .limit(1);

        if (billings.length === 0 || !billings[0].branchName) {
          // No billing row with a branch_name — nothing to stamp.
          skippedNoBilling += 1;
          done.add(row.id);
          continue;
        }

        const branchName = billings[0].branchName;

        if (!dryRun) {
          await db
            .update(wetChecks)
            .set({ branchName })
            .where(eq(wetChecks.id, row.id));
          done.add(row.id);
        }

        updated += 1;
        if (dryRun) {
          console.log(
            `[backfill-wet-check-branch] dry-run: would stamp id=${row.id} branchName="${branchName}"`,
          );
        }
      } catch (err) {
        failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[backfill-wet-check-branch] FAILED wet-check id=${row.id}: ${msg}`,
        );
        if (!dryRun) {
          await appendFailure({
            id: row.id,
            error: msg,
            at: new Date().toISOString(),
          });
        }
      }
    }

    // Persist the done set after every batch so a mid-run timeout can resume.
    if (!dryRun) {
      await saveDoneSet(done);
    }

    console.log(
      `[backfill-wet-check-branch] scanned=${scanned} updated=${updated} ` +
        `skippedAlreadyDone=${skippedAlreadyDone} skippedNoBilling=${skippedNoBilling} ` +
        `failed=${failed} lastId=${lastId}`,
    );
  }

  console.log(
    `[backfill-wet-check-branch] done. scanned=${scanned} updated=${updated} ` +
      `skippedAlreadyDone=${skippedAlreadyDone} skippedNoBilling=${skippedNoBilling} ` +
      `failed=${failed} dryRun=${dryRun}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill-wet-check-branch] fatal:", err);
    process.exit(1);
  });
