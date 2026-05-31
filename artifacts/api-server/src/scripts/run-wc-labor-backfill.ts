#!/usr/bin/env node
// CLI wrapper for the WC labor backfill (Slice 3).
// Usage:
//   node --import tsx/esm artifacts/api-server/src/scripts/run-wc-labor-backfill.ts [--dry-run] [--bucket=a|b]
//
// --dry-run   Print what would be updated without writing to the DB.
// --bucket=a  Run only Bucket A (unbilled backfill). Default.
// --bucket=b  Run only Bucket B (invoiced report — read-only).

import { runUnbilledBackfill, runInvoicedReport } from "../migrations/wc-labor-backfill";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const bucketArg = args.find((a) => a.startsWith("--bucket="));
const bucket = bucketArg ? bucketArg.split("=")[1] : "a";

async function main() {
  console.log(`[wc-labor-backfill] starting bucket=${bucket} dryRun=${dryRun}`);

  if (bucket === "b") {
    console.log("[wc-labor-backfill] running Bucket B (invoiced report — no writes)");
    const report = await runInvoicedReport();
    console.log(`[wc-labor-backfill] invoiced report: ${report.length} rows`);
    for (const row of report) {
      console.log(
        `  WCB #${row.wcbId} (${row.billingNumber}) customer="${row.customerName}" ` +
        `invoiceId=${row.invoiceId} computedHours=${row.computedLaborHours} ` +
        `computedSubtotal=${row.computedLaborSubtotal} storedSubtotal=${row.storedLaborSubtotal}`,
      );
    }
    process.exit(0);
    return;
  }

  // Default: Bucket A
  const result = await runUnbilledBackfill({
    dryRun,
    onProgress(p) {
      process.stdout.write(
        `\r[wc-labor-backfill] scanned=${p.scanned} updated=${p.updated} skipped=${p.skipped} failed=${p.failed}`,
      );
    },
  });

  process.stdout.write("\n");
  console.log(`[wc-labor-backfill] finished state=${result.state}`);
  console.log(`  scanned=${result.scanned} updated=${result.updated} skipped=${result.skipped} failed=${result.failed}`);
  if (result.errorMessage) {
    console.error(`  error: ${result.errorMessage}`);
  }

  process.exit(result.state === "done" || result.state === "cancelled" ? 0 : 1);
}

main().catch((err) => {
  console.error("[wc-labor-backfill] fatal:", err);
  process.exit(1);
});
