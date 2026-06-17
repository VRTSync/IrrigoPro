// Task #1409 — CLI entry for the inspection-estimate zone backfill.
//
// All reusable logic lives in ./backfill-inspection-estimate-zones-core.ts.
// This file is the command-line wrapper only; it is invoked directly via tsx
// and is NOT imported by the server bundle (the route imports the core), so
// the entry-point guard below never misfires inside the esbuild bundle.
//
// Run:
//   node --import tsx/esm \
//     artifacts/api-server/src/scripts/backfill-inspection-estimate-zones.ts \
//     --dry-run
// Review the report, then:
//   node --import tsx/esm \
//     artifacts/api-server/src/scripts/backfill-inspection-estimate-zones.ts \
//     --apply [--batch=N]

try { (process.stdout as unknown as { _handle?: { setBlocking?: (b: boolean) => void } })._handle?.setBlocking?.(true); } catch {}
try { (process.stderr as unknown as { _handle?: { setBlocking?: (b: boolean) => void } })._handle?.setBlocking?.(true); } catch {}

// Re-export the full public API so existing importers (tests) keep working.
export * from "./backfill-inspection-estimate-zones-core";

import { runBackfill, makeDbDeps } from "./backfill-inspection-estimate-zones-core";

// ── Argument parsing + entry point ────────────────────────────────────────────

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const n = Number(raw.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function main(): Promise<void> {
  const dryRun = hasFlag("dry-run");
  const apply = hasFlag("apply");
  const batchSize = parseArg("batch", 50);

  if (!dryRun && !apply) {
    console.error(
      "Usage: backfill-inspection-estimate-zones.ts --dry-run | --apply [--batch=N]",
    );
    process.exit(1);
  }

  console.log(
    `[backfill-inspection-estimate-zones] starting ` +
      `(mode=${dryRun ? "dry-run" : "apply"}, batch=${batchSize})`,
  );

  const result = await runBackfill(makeDbDeps(), { dryRun, batchSize });

  const modeLabel = dryRun ? "dry-run (no writes)" : "applied";
  console.log(
    `\n[backfill-inspection-estimate-zones] DONE\n` +
      `  total selected     : ${result.totalSelected}\n` +
      `  already processed  : ${result.alreadyProcessed}\n` +
      `  matched + applied  : ${result.matched}\n` +
      `  matched (dry-run)  : ${result.matchedDryRun}\n` +
      `  skipped (mismatch) : ${result.skippedTotalsMismatch}\n` +
      `  skipped (no finds) : ${result.skippedNoFindings}\n` +
      `  errors             : ${result.errors}\n` +
      `  mode               : ${modeLabel}`,
  );
}

// Only run when this file is the direct entry point (not when imported by tests).
import { fileURLToPath } from "url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[backfill-inspection-estimate-zones] fatal:", err);
      process.exit(1);
    });
}
