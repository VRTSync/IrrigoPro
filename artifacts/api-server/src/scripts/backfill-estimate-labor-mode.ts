// Task #657 — Backfill all existing estimates from `per_part` labor mode
// to flat-only labor.
//
// The estimate wizard no longer accepts per-row labor; labor is captured
// as a single estimate-level `totalLaborHours` field. This script
// consolidates legacy per_part rows so reads and writes can agree on
// flat as the only stored mode.
//
// Per row, when `laborMode='per_part'`:
//   1. Recompute legacy total labor as Σ(quantity × per-unit hours) for
//      every line. Stored `estimate_items.labor_hours` is the per-line
//      total (per-unit × quantity, post-Task #228), so summing the
//      stored values is equivalent to Σ(quantity × per-unit) and is
//      what we use as the source of truth.
//   2. That sum becomes the new `estimates.total_labor_hours` for this
//      row, preserving the labor subtotal the user originally entered.
//   3. Zero `estimate_items.labor_hours` to "0.00" so flat is the only
//      source of truth for labor going forward.
//   4. Flip `estimates.labor_mode` to 'flat'.
//
// Resumable: progress is persisted in `app_settings` (key
// `estimateLaborMode.done` — array of processed estimate ids,
// `estimateLaborMode.failed` — array of {id,error} entries) so a crash
// or timeout mid-pass can be safely re-run; previously-processed rows
// are skipped. Mirrors the `shrink-originals.ts` pattern.
//
// Run:
//   node --import tsx/esm \
//     artifacts/api-server/src/scripts/backfill-estimate-labor-mode.ts \
//     [--dry-run] [--batch=500]

try { (process.stdout as unknown as { _handle?: { setBlocking?: (b: boolean) => void } })._handle?.setBlocking?.(true); } catch {}
try { (process.stderr as unknown as { _handle?: { setBlocking?: (b: boolean) => void } })._handle?.setBlocking?.(true); } catch {}

import { db } from "../db";
import { estimates, estimateItems, appSettings } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const DONE_KEY = "estimateLaborMode.done";
const FAIL_KEY = "estimateLaborMode.failed";

function parseFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const n = Number(raw.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// `app_settings.value` is a text column; we JSON-encode arrays/objects.
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
    `[backfill-estimate-labor-mode] starting (dryRun=${dryRun}, batch=${batchSize})`,
  );

  const done = await loadIdSet(DONE_KEY);
  console.log(
    `[backfill-estimate-labor-mode] resume — ${done.size} estimate ids already processed`,
  );

  let lastId = 0;
  let scanned = 0;
  let updated = 0;
  let skippedAlreadyDone = 0;
  let totalHoursMoved = 0;
  let itemsZeroed = 0;
  let failed = 0;

  for (;;) {
    const rows = await db
      .select({
        id: estimates.id,
        laborMode: estimates.laborMode,
        totalLaborHours: estimates.totalLaborHours,
      })
      .from(estimates)
      .where(sql`${estimates.id} > ${lastId}`)
      .orderBy(estimates.id)
      .limit(batchSize);
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      lastId = row.id;
      if (done.has(row.id)) {
        skippedAlreadyDone += 1;
        continue;
      }
      if (row.laborMode !== "per_part") {
        // Mark non-per_part rows as done so subsequent runs don't re-scan
        // them either.
        done.add(row.id);
        continue;
      }

      try {
        // Sum the per-line stored labor totals for this estimate. The
        // stored value is per-unit × quantity (Task #228), so the sum
        // is equivalent to Σ(quantity × per-unit hours) — the exact
        // legacy labor total the user originally entered.
        const items = await db
          .select({ id: estimateItems.id, laborHours: estimateItems.laborHours })
          .from(estimateItems)
          .where(eq(estimateItems.estimateId, row.id));
        const sumHours = items.reduce((acc, it) => {
          const v = parseFloat(String(it.laborHours ?? "0")) || 0;
          return acc + v;
        }, 0);
        const persistedFlat =
          parseFloat(String(row.totalLaborHours ?? "0")) || 0;
        // Prefer the per-line sum when it's non-zero; otherwise fall
        // back to any value already in `totalLaborHours` so we never
        // drop labor on rows whose items had zero per-line values.
        const newTotalHours = sumHours > 0 ? sumHours : persistedFlat;

        if (!dryRun) {
          await db.transaction(async (tx) => {
            await tx
              .update(estimateItems)
              .set({ laborHours: "0.00" })
              .where(eq(estimateItems.estimateId, row.id));
            await tx
              .update(estimates)
              .set({
                laborMode: "flat",
                totalLaborHours: newTotalHours.toFixed(2),
              })
              .where(eq(estimates.id, row.id));
          });
          done.add(row.id);
        }
        updated += 1;
        totalHoursMoved += newTotalHours;
        itemsZeroed += items.length;
      } catch (err) {
        failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[backfill-estimate-labor-mode] FAILED estimate id=${row.id}: ${msg}`,
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

    // Persist the done set per batch so a mid-run timeout still lets the
    // next invocation pick up where this one left off.
    if (!dryRun) {
      await saveDoneSet(done);
    }
    console.log(
      `[backfill-estimate-labor-mode] scanned=${scanned} updated=${updated} ` +
        `skippedAlreadyDone=${skippedAlreadyDone} failed=${failed} lastId=${lastId}`,
    );
  }

  console.log(
    `[backfill-estimate-labor-mode] done. scanned=${scanned} updated=${updated} ` +
      `skippedAlreadyDone=${skippedAlreadyDone} itemsZeroed=${itemsZeroed} ` +
      `totalHoursMoved=${totalHoursMoved.toFixed(2)} failed=${failed} dryRun=${dryRun}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill-estimate-labor-mode] fatal:", err);
    process.exit(1);
  });
