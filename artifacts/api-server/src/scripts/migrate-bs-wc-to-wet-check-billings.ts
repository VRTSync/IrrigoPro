// Task #796 — Slice 5: CLI wrapper for the BS-WC → wet_check_billings migration.
//
// The migration logic lives in migrations/bs-wc-migration.ts. This file is a
// thin CLI wrapper that parses flags and delegates to runMigration().
//
// This script MUST NOT be run in production until Slice 6 (conversion-path
// switch) has been deployed. Running it before Slice 6 will leave newly
// submitted wet checks still writing to billing_sheets (wrong table) while
// historical data is in wet_check_billings.
//
// Usage:
//   node --import tsx/esm \
//     artifacts/api-server/src/scripts/migrate-bs-wc-to-wet-check-billings.ts \
//     [--dry-run] [--batch=50] [--abort-on-error] [--bs-ids=1,2,3]
//
// Flags:
//   --dry-run         Print the pre-migration reconciliation report and exit.
//                     No writes are made.
//   --batch=N         Process N rows before logging progress (default 50).
//   --abort-on-error  Stop the entire migration on the first row failure.
//                     Default: true. Pass --no-abort-on-error to continue.
//   --bs-ids=1,2,3    Only migrate specific billing_sheet IDs (comma-separated).

try { (process.stdout as unknown as { _handle?: { setBlocking?: (b: boolean) => void } })._handle?.setBlocking?.(true); } catch {}
try { (process.stderr as unknown as { _handle?: { setBlocking?: (b: boolean) => void } })._handle?.setBlocking?.(true); } catch {}

import { runMigration } from "../migrations/bs-wc-migration";

function parseFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const n = Number(raw.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseBsIds(): Set<number> | undefined {
  const raw = process.argv.find((a) => a.startsWith("--bs-ids="));
  if (!raw) return undefined;
  const part = raw.split("=")[1];
  if (!part) return undefined;
  const ids = part
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return ids.length > 0 ? new Set(ids) : undefined;
}

function parseAbortOnError(): boolean {
  if (process.argv.includes("--no-abort-on-error")) return false;
  return true;
}

async function main(): Promise<void> {
  const dryRun = parseFlag("dry-run");
  const batchSize = parseArg("batch", 50);
  const abortOnError = parseAbortOnError();
  const bsIdFilter = parseBsIds();

  console.log(
    `[bs-wc-migration] starting (dryRun=${dryRun} batch=${batchSize} abortOnError=${abortOnError} ` +
    `bsIdFilter=${bsIdFilter ? [...bsIdFilter].join(",") : "all"})`,
  );

  const result = await runMigration({
    dryRun,
    batchSize,
    abortOnError,
    bsIdFilter,
    onProgress: (p) => {
      console.log(
        JSON.stringify({
          event: "bs_wc_migration.progress",
          processed: p.processed,
          total: p.total,
          failed: p.failed,
          current_bs_id: p.currentBsId,
        }),
      );
    },
  });

  console.log(
    JSON.stringify({
      event: "bs_wc_migration.run_done",
      migrated: result.migrated,
      skipped_already_done: result.skippedAlreadyDone,
      failed: result.failed,
      failed_ids: result.failedIds,
      assertions_passed: result.assertionsPassed,
      pre: {
        bs_wc_count: result.preReport.bsWcCount,
        wcb_count: result.preReport.wcbCount,
        total_value: result.preReport.bsWcTotalValue,
      },
      ...(result.postReport
        ? {
            post: {
              bs_wc_count: result.postReport.bsWcCount,
              wcb_count: result.postReport.wcbCount,
              total_value: result.postReport.bsWcTotalValue,
            },
          }
        : {}),
    }),
  );

  if (!result.assertionsPassed) {
    console.error("[bs-wc-migration] one or more post-run assertions FAILED — check the report above");
    process.exit(1);
  }

  console.log("[bs-wc-migration] complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[bs-wc-migration] fatal:", err);
  process.exit(1);
});
