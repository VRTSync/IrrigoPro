/**
 * Migration 0005: Reconcile approved wet checks
 *
 * Task #1090 — WCB Billing Gate
 *
 * The `approved` status on `wet_checks` is being retired. The new lifecycle
 * moves directly from `submitted` / `partially_converted` to `converted`
 * via the convert route. This migration is idempotent and reconciles any
 * rows that are stuck in `status = 'approved'`.
 *
 * Reconciliation rules (per finding state, applied in a single transaction
 * per batch):
 *
 *   1. No findings at all, OR all findings have `convertedAt IS NOT NULL`
 *      and none has `resolution = 'pending'`
 *      → set `status = 'converted'`, stamp `fullyConvertedAt = NOW()` if null.
 *
 *   2. At least one finding has `convertedAt IS NOT NULL` but at least one
 *      other finding still has `resolution = 'pending'`
 *      → set `status = 'partially_converted'`, clear `fullyConvertedAt`.
 *
 *   3. Zero findings have a `convertedAt` stamp (all still pending, or no
 *      findings were converted)
 *      → set `status = 'submitted'` so the manager can begin the convert flow.
 *
 * Run:
 *   node --import tsx/esm artifacts/api-server/src/migrations/0005-reconcile-approved-wet-checks.ts [--dry-run] [--batch=N]
 *
 * Safe to re-run: only touches rows still in `status = 'approved'`.
 */

import { db } from "../db";
import { wetChecks, wetCheckFindings } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

const DRY_RUN = process.argv.includes("--dry-run");
const batchArg = process.argv.find(a => a.startsWith("--batch="));
const BATCH_SIZE = batchArg ? parseInt(batchArg.split("=")[1], 10) : 100;

type TargetStatus = "converted" | "partially_converted" | "submitted";

async function deriveTarget(wcId: number): Promise<TargetStatus> {
  const findings = await db
    .select({
      id: wetCheckFindings.id,
      resolution: wetCheckFindings.resolution,
      convertedAt: wetCheckFindings.convertedAt,
    })
    .from(wetCheckFindings)
    .where(eq(wetCheckFindings.wetCheckId, wcId));

  if (findings.length === 0) return "converted";

  const hasAnyConverted = findings.some(f => f.convertedAt != null);
  const hasPending = findings.some(f => f.resolution === "pending");

  if (hasAnyConverted && !hasPending) return "converted";
  if (hasAnyConverted && hasPending) return "partially_converted";
  return "submitted";
}

async function main() {
  console.log(`[0005] reconcile-approved-wet-checks — ${DRY_RUN ? "DRY RUN" : "LIVE"}, batch=${BATCH_SIZE}`);

  let totalScanned = 0;
  const counts: Record<TargetStatus, number> = { converted: 0, partially_converted: 0, submitted: 0 };

  while (true) {
    // Always query with no OFFSET: after each batch is updated the rows are
    // moved out of status='approved', so the next iteration naturally picks up
    // the next N remaining rows. Using OFFSET on a mutating set skips rows.
    const approvedWcs = await db
      .select({ id: wetChecks.id })
      .from(wetChecks)
      .where(eq(wetChecks.status, "approved"))
      .limit(BATCH_SIZE);

    if (approvedWcs.length === 0) break;

    totalScanned += approvedWcs.length;

    const buckets: Record<TargetStatus, number[]> = {
      converted: [],
      partially_converted: [],
      submitted: [],
    };

    for (const { id } of approvedWcs) {
      const target = await deriveTarget(id);
      buckets[target].push(id);
      counts[target]++;
    }

    if (!DRY_RUN) {
      await db.transaction(async (tx) => {
        if (buckets.converted.length > 0) {
          await tx
            .update(wetChecks)
            .set({
              status: "converted",
              fullyConvertedAt: sql`coalesce(${wetChecks.fullyConvertedAt}, now())`,
              updatedAt: new Date(),
            })
            .where(inArray(wetChecks.id, buckets.converted));
        }
        if (buckets.partially_converted.length > 0) {
          await tx
            .update(wetChecks)
            .set({ status: "partially_converted", fullyConvertedAt: null, updatedAt: new Date() })
            .where(inArray(wetChecks.id, buckets.partially_converted));
        }
        if (buckets.submitted.length > 0) {
          await tx
            .update(wetChecks)
            .set({ status: "submitted", updatedAt: new Date() })
            .where(inArray(wetChecks.id, buckets.submitted));
        }
      });
    }

    console.log(
      `  batch scanned=${approvedWcs.length}` +
      ` → converted=${buckets.converted.length}` +
      ` partially_converted=${buckets.partially_converted.length}` +
      ` submitted=${buckets.submitted.length}`,
    );
  }

  console.log(
    `[0005] done — scanned=${totalScanned}` +
    ` converted=${counts.converted}` +
    ` partially_converted=${counts.partially_converted}` +
    ` submitted=${counts.submitted}` +
    (DRY_RUN ? " (dry run — no writes)" : ""),
  );
  process.exit(0);
}

main().catch(err => {
  console.error("[0005] fatal:", err);
  process.exit(1);
});
