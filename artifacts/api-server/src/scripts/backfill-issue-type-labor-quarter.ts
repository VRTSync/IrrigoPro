// Task #751 — Backfill issue_type_configs.default_labor_hours to 0.25 increments.
//
// Values like "0.10" and "0.05" do not align to the 0.25-hour stepper the
// new tech UI enforces. This script quantizes every row to the nearest 0.25,
// with a minimum of 0.25 (so 0 and sub-0.25 values become 0.25 rather than 0).
//
// Quantization: quantized = Math.max(0.25, Math.round(value * 4) / 4)
// Examples:
//   0      → 0.25
//   0.10   → 0.25
//   0.33   → 0.25
//   0.40   → 0.50
//   1.00   → 1.00
//   1.55   → 1.50
//
// Resumable: progress is persisted in `app_settings` under key
// `issueTypeLaborQuarter.done` (array of processed row ids). A crash or
// timeout mid-pass can be safely re-run; already-processed rows are skipped.
//
// Run:
//   node --import tsx/esm \
//     artifacts/api-server/src/scripts/backfill-issue-type-labor-quarter.ts \
//     [--dry-run] [--batch=N]

try { (process.stdout as unknown as { _handle?: { setBlocking?: (b: boolean) => void } })._handle?.setBlocking?.(true); } catch {}
try { (process.stderr as unknown as { _handle?: { setBlocking?: (b: boolean) => void } })._handle?.setBlocking?.(true); } catch {}

import { db } from "../db";
import { issueTypeConfigs, appSettings } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const DONE_KEY = "issueTypeLaborQuarter.done";
const FAIL_KEY = "issueTypeLaborQuarter.failed";

function parseFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const n = Number(raw.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function quantizeTo025(raw: string | number | null | undefined): string {
  const v = parseFloat(String(raw ?? "0")) || 0;
  const quantized = Math.max(0.25, Math.round(v * 4) / 4);
  return quantized.toFixed(2);
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
    `[backfill-issue-type-labor-quarter] starting (dryRun=${dryRun}, batch=${batchSize})`,
  );

  const done = await loadIdSet(DONE_KEY);
  console.log(
    `[backfill-issue-type-labor-quarter] resume — ${done.size} row ids already processed`,
  );

  let lastId = 0;
  let scanned = 0;
  let updated = 0;
  let skippedAlreadyDone = 0;
  let skippedAlreadyValid = 0;
  let failed = 0;

  for (;;) {
    const rows = await db
      .select({
        id: issueTypeConfigs.id,
        issueType: issueTypeConfigs.issueType,
        defaultLaborHours: issueTypeConfigs.defaultLaborHours,
      })
      .from(issueTypeConfigs)
      .where(sql`${issueTypeConfigs.id} > ${lastId}`)
      .orderBy(issueTypeConfigs.id)
      .limit(batchSize);

    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      lastId = row.id;

      if (done.has(row.id)) {
        skippedAlreadyDone += 1;
        continue;
      }

      const quantized = quantizeTo025(row.defaultLaborHours);

      if (quantized === String(row.defaultLaborHours).trim()) {
        skippedAlreadyValid += 1;
        done.add(row.id);
        continue;
      }

      try {
        if (dryRun) {
          console.log(
            `[backfill-issue-type-labor-quarter] [dry-run] id=${row.id} issueType=${row.issueType} ` +
              `${row.defaultLaborHours} → ${quantized}`,
          );
        } else {
          await db
            .update(issueTypeConfigs)
            .set({ defaultLaborHours: quantized })
            .where(eq(issueTypeConfigs.id, row.id));
          done.add(row.id);
        }
        updated += 1;
      } catch (err) {
        failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[backfill-issue-type-labor-quarter] FAILED id=${row.id}: ${msg}`,
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

    if (!dryRun) {
      await saveDoneSet(done);
    }

    console.log(
      `[backfill-issue-type-labor-quarter] scanned=${scanned} updated=${updated} ` +
        `skippedAlreadyValid=${skippedAlreadyValid} skippedAlreadyDone=${skippedAlreadyDone} ` +
        `failed=${failed} lastId=${lastId}`,
    );
  }

  console.log(
    `[backfill-issue-type-labor-quarter] done. scanned=${scanned} updated=${updated} ` +
      `skippedAlreadyValid=${skippedAlreadyValid} skippedAlreadyDone=${skippedAlreadyDone} ` +
      `failed=${failed} dryRun=${dryRun}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill-issue-type-labor-quarter] fatal:", err);
    process.exit(1);
  });
