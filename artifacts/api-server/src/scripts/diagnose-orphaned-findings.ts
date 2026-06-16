// Findings Lane Cleanup — Orphan Diagnostic Script
//
// Read-only: mutates no rows. Safe to run against production.
//
// Finds every wet_check_finding where all four routing FKs are NULL
// (billingSheetId, wetCheckBillingId, estimateId, workOrderId) and
// resolution != 'documented_only', then classifies by parent wet-check status:
//
//   Class A — wet_check.status in ('submitted', 'pending_manager_review')
//   Class B — wet_check.status = 'partially_converted'
//   Class C — wet_check.status in ('approved', 'converted')  ← truly hidden
//   Other   — wet_check.status = 'in_progress' or anything else
//
// Also buckets by age, resolution, companyId, and flags dollar-bearing rows.
//
// Run:
//   node --import tsx/esm \
//     artifacts/api-server/src/scripts/diagnose-orphaned-findings.ts
//
// Output:
//   stdout                        — summary table
//   orphaned-findings-report.csv  — one row per orphaned finding (written to CWD)

import { db } from "../db";
import {
  wetCheckFindings,
  wetChecks,
  customers,
} from "@workspace/db";
import { isNull, ne, and, eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Class = "A" | "B" | "C" | "other";

function classifyStatus(wcStatus: string): Class {
  if (wcStatus === "submitted" || wcStatus === "pending_manager_review")
    return "A";
  if (wcStatus === "partially_converted") return "B";
  if (wcStatus === "approved" || wcStatus === "converted") return "C";
  return "other";
}

function ageBucket(ageDays: number): string {
  if (ageDays < 7) return "<7d";
  if (ageDays < 30) return "7-29d";
  if (ageDays < 90) return "30-89d";
  return "90d+";
}

const AGE_BUCKET_ORDER = ["<7d", "7-29d", "30-89d", "90d+"] as const;

// Escape a single CSV field value
function csvField(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("[diagnose-orphaned-findings] starting (read-only)\n");

  // Fetch all orphaned findings in one query
  const rows = await db
    .select({
      findingId:       wetCheckFindings.id,
      wetCheckId:      wetCheckFindings.wetCheckId,
      wcStatus:        wetChecks.status,
      resolution:      wetCheckFindings.resolution,
      techDisposition: wetCheckFindings.techDisposition,
      companyId:       wetChecks.companyId,
      customerName:    customers.name,
      partPrice:       wetCheckFindings.partPrice,
      quantity:        wetCheckFindings.quantity,
      createdAt:       wetCheckFindings.createdAt,
    })
    .from(wetCheckFindings)
    .innerJoin(wetChecks,  eq(wetCheckFindings.wetCheckId,  wetChecks.id))
    .innerJoin(customers,  eq(wetChecks.customerId,         customers.id))
    .where(
      and(
        isNull(wetCheckFindings.billingSheetId),
        isNull(wetCheckFindings.wetCheckBillingId),
        isNull(wetCheckFindings.estimateId),
        isNull(wetCheckFindings.workOrderId),
        ne(wetCheckFindings.resolution, "documented_only"),
      ),
    );

  console.log(`Total orphaned findings: ${rows.length}\n`);

  // Enrich each row with derived fields
  const now = Date.now();

  const enriched = rows.map((r) => {
    const ageDays     = Math.floor((now - r.createdAt.getTime()) / 86_400_000);
    const cls         = classifyStatus(r.wcStatus);
    const partPriceN  = r.partPrice !== null ? parseFloat(r.partPrice) : null;
    const hasDollarValue =
      partPriceN !== null && partPriceN > 0 && r.quantity > 0;

    return {
      findingId:       r.findingId,
      wetCheckId:      r.wetCheckId,
      wcStatus:        r.wcStatus,
      class:           cls,
      resolution:      r.resolution,
      techDisposition: r.techDisposition ?? "",
      companyId:       r.companyId,
      customerName:    r.customerName,
      partPrice:       r.partPrice ?? null,
      quantity:        r.quantity,
      ageDays,
      hasDollarValue,
    };
  });

  // ---------------------------------------------------------------------------
  // Aggregate
  // ---------------------------------------------------------------------------

  const classCounts: Record<Class | "other", number> = { A: 0, B: 0, C: 0, other: 0 };
  const ageCounts: Record<string, number>            = Object.fromEntries(
    AGE_BUCKET_ORDER.map((b) => [b, 0]),
  );
  const resolutionCounts: Record<string, number>     = {};
  const companyCounts: Record<number, number>        = {};
  let dollarBearingCount = 0;

  for (const r of enriched) {
    classCounts[r.class]++;

    const bucket = ageBucket(r.ageDays);
    ageCounts[bucket] = (ageCounts[bucket] ?? 0) + 1;

    resolutionCounts[r.resolution] = (resolutionCounts[r.resolution] ?? 0) + 1;

    companyCounts[r.companyId] = (companyCounts[r.companyId] ?? 0) + 1;

    if (r.hasDollarValue) dollarBearingCount++;
  }

  // ---------------------------------------------------------------------------
  // Print summary
  // ---------------------------------------------------------------------------

  const sep = "─".repeat(60);

  console.log(sep);
  console.log("ORPHANED FINDINGS — SUMMARY");
  console.log(sep);
  console.log(`${"Total:".padEnd(45)} ${enriched.length}`);
  console.log();

  console.log("By class:");
  console.log(
    `  ${"A (submitted / pending_manager_review):".padEnd(42)} ${classCounts.A}`,
  );
  console.log(
    `  ${"B (partially_converted):".padEnd(42)} ${classCounts.B}`,
  );
  console.log(
    `  ${"C (approved / converted — truly hidden):".padEnd(42)} ${classCounts.C}`,
  );
  console.log(
    `  ${"Other (in_progress, etc.):".padEnd(42)} ${classCounts.other}`,
  );
  console.log();

  console.log(`Dollar-bearing (partPrice > 0 AND quantity > 0):`);
  console.log(`  ${dollarBearingCount}`);
  console.log();

  console.log("Age distribution:");
  for (const bucket of AGE_BUCKET_ORDER) {
    console.log(`  ${bucket.padEnd(10)} ${ageCounts[bucket] ?? 0}`);
  }
  console.log();

  console.log("By resolution:");
  for (const [res, count] of Object.entries(resolutionCounts).sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    console.log(`  ${res.padEnd(35)} ${count}`);
  }
  console.log();

  console.log("By companyId (descending count):");
  for (const [cid, count] of Object.entries(companyCounts).sort(
    (a, b) => (b[1] as number) - (a[1] as number),
  )) {
    console.log(`  company ${String(cid).padStart(6)}   ${count} findings`);
  }
  console.log(sep);

  // ---------------------------------------------------------------------------
  // Write CSV
  // ---------------------------------------------------------------------------

  const csvPath = path.resolve("orphaned-findings-report.csv");

  const csvHeader = [
    "findingId",
    "wetCheckId",
    "wcStatus",
    "class",
    "resolution",
    "techDisposition",
    "companyId",
    "customerName",
    "partPrice",
    "quantity",
    "ageDays",
  ].join(",");

  const csvLines = enriched.map((r) =>
    [
      csvField(r.findingId),
      csvField(r.wetCheckId),
      csvField(r.wcStatus),
      csvField(r.class),
      csvField(r.resolution),
      csvField(r.techDisposition),
      csvField(r.companyId),
      csvField(r.customerName),
      csvField(r.partPrice),
      csvField(r.quantity),
      csvField(r.ageDays),
    ].join(","),
  );

  fs.writeFileSync(
    csvPath,
    [csvHeader, ...csvLines].join("\n") + "\n",
    "utf8",
  );

  console.log(`\nCSV written → ${csvPath}`);
  console.log("[diagnose-orphaned-findings] done");
}

main().catch((err) => {
  console.error("[diagnose-orphaned-findings] fatal:", err);
  process.exit(1);
});
