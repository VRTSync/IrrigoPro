#!/usr/bin/env node
/**
 * reconcile-finding-dispositions.ts
 *
 * One-time idempotent script (Task #1535) that fixes findings where
 * `techDisposition` and `resolution` disagree — the "split-brain" state that
 * could block wet-check submission with "Cannot auto-bill finding" errors.
 *
 * What it fixes:
 *   Case 1 — resolution='repaired_in_field' AND techDisposition='needs_review'
 *     → set techDisposition='completed_in_field'  (trust the resolution)
 *
 *   Case 2 — techDisposition='completed_in_field' AND resolution='pending'
 *     AND the finding IS billable (has a part, noPartNeeded, or is labor-only)
 *     → set resolution='repaired_in_field'  (align to the completed state)
 *
 *   Case 3 — techDisposition='completed_in_field' AND resolution='pending'
 *     AND the finding is NOT billable (no part, no noPartNeeded, not labor-only)
 *     → set techDisposition='needs_review'  (re-route to manager queue)
 *
 *   Case 4 — issueType='custom_review' AND resolution != 'pending'
 *     → set resolution='pending', techDisposition='needs_review'
 *     (custom_review findings must never auto-bill)
 *
 * Usage:
 *   node --import tsx/esm artifacts/api-server/src/scripts/reconcile-finding-dispositions.ts [--dry-run] [--batch=N]
 *
 * Resumable: uses app_settings('findingDispositionReconcile.done') to store
 * already-processed finding IDs so it can be re-run safely after interruption.
 */

import "dotenv/config";
import { db } from "../db";
import {
  wetCheckFindings,
  appSettings,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const LABOR_ONLY_ISSUE_TYPES = new Set([
  "head_adjustment",
]);

const isDryRun = process.argv.includes("--dry-run");
const batchArg = process.argv.find(a => a.startsWith("--batch="));
const BATCH = batchArg ? parseInt(batchArg.replace("--batch=", ""), 10) : 500;

async function loadDone(): Promise<Set<number>> {
  const [row] = await db.select().from(appSettings)
    .where(eq(appSettings.key, "findingDispositionReconcile.done"));
  if (!row) return new Set();
  try {
    const ids = JSON.parse(row.value as string) as number[];
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

async function persistDone(ids: Set<number>): Promise<void> {
  const value = JSON.stringify([...ids]);
  await db.insert(appSettings)
    .values({ key: "findingDispositionReconcile.done", value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value },
    });
}

function isBillable(f: {
  partId: number | null;
  noPartNeeded: boolean;
  issueType: string | null;
}): boolean {
  return f.partId != null || f.noPartNeeded || LABOR_ONLY_ISSUE_TYPES.has(f.issueType ?? "");
}

async function main() {
  console.log(`[reconcile-finding-dispositions] start  dry-run=${isDryRun}  batch=${BATCH}`);

  const done = await loadDone();
  console.log(`  Previously processed: ${done.size} finding(s)`);

  const allFindings = await db.select().from(wetCheckFindings);
  console.log(`  Total findings in DB: ${allFindings.length}`);

  const toFix: Array<{
    id: number;
    reason: string;
    patch: Partial<{ resolution: string; techDisposition: string }>;
  }> = [];

  for (const f of allFindings) {
    if (done.has(f.id)) continue;

    // Case 4: custom_review must always be pending/needs_review
    if (f.issueType === "custom_review" && f.resolution !== "pending") {
      toFix.push({
        id: f.id,
        reason: `custom_review with resolution='${f.resolution}' → reset to pending/needs_review`,
        patch: { resolution: "pending", techDisposition: "needs_review" },
      });
      continue;
    }

    // Case 1: repaired_in_field but techDisposition says needs_review
    if (f.resolution === "repaired_in_field" && f.techDisposition === "needs_review") {
      toFix.push({
        id: f.id,
        reason: `resolution=repaired_in_field but techDisposition=needs_review → align disposition to completed_in_field`,
        patch: { techDisposition: "completed_in_field" },
      });
      continue;
    }

    // Cases 2 & 3: completed_in_field + resolution=pending — split-brain
    if (
      f.techDisposition === "completed_in_field" &&
      f.resolution === "pending" &&
      f.convertedAt == null &&
      f.wetCheckBillingId == null &&
      f.billingSheetId == null
    ) {
      if (isBillable(f)) {
        // Case 2: billable — trust the disposition, align resolution
        toFix.push({
          id: f.id,
          reason: `completed_in_field/pending with part/noPartNeeded → align resolution to repaired_in_field`,
          patch: { resolution: "repaired_in_field" },
        });
      } else {
        // Case 3: not billable — re-route to manager queue
        toFix.push({
          id: f.id,
          reason: `completed_in_field/pending with no part → re-route techDisposition to needs_review`,
          patch: { techDisposition: "needs_review" },
        });
      }
      continue;
    }
  }

  console.log(`  Findings needing correction: ${toFix.length}`);
  if (toFix.length === 0) {
    console.log("  Nothing to do — all findings are consistent.");
    return;
  }

  let updated = 0;
  for (let i = 0; i < toFix.length; i += BATCH) {
    const slice = toFix.slice(i, i + BATCH);
    for (const item of slice) {
      console.log(`  [${item.id}] ${item.reason}`);
      if (!isDryRun) {
        await db.update(wetCheckFindings)
          .set(item.patch as Record<string, string>)
          .where(eq(wetCheckFindings.id, item.id));
        done.add(item.id);
        updated++;
      }
    }
    if (!isDryRun) {
      await persistDone(done);
      console.log(`  batch ${Math.floor(i / BATCH) + 1} committed (${updated} total so far)`);
    }
  }

  if (isDryRun) {
    console.log(`  [DRY RUN] would have updated ${toFix.length} finding(s)`);
  } else {
    console.log(`  Done. Updated ${updated} finding(s).`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
