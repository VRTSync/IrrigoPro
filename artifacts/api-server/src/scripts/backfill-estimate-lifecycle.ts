// Task #642 — Backfill the canonical `estimates.lifecycle` column from
// the legacy two-axis (status, internalStatus) pair.
//
// This is the second step of the dual-write rollout: schema push adds
// the column with a default of `pending_review`, then this script
// walks every row and stamps the value derived by
// `deriveLifecycleForWrite` so legacy rows agree with the new
// write-path contract.
//
// Idempotent — safe to re-run. Only updates rows whose stored
// `lifecycle` differs from the freshly-derived value, so a no-op run
// (everything already in sync) makes zero writes.
//
// `expired` is intentionally NOT stamped: it's a read-time view over
// (lifecycle='sent', estimateDate > 30 days) so the stored row can
// roll back to `sent` automatically when `estimateDate` is reset
// (resend flow). Sent rows that the read layer presents as `expired`
// are stamped as `sent` here on purpose.
//
// Run:
//   node --import tsx/esm \
//     artifacts/api-server/src/scripts/backfill-estimate-lifecycle.ts \
//     [--dry-run] [--batch=500]

import { db } from "../db";
import { estimates } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { deriveLifecycleForWrite } from "@workspace/shared";

function parseFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const n = Number(raw.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function main(): Promise<void> {
  const dryRun = parseFlag("dry-run");
  const batchSize = parseArg("batch", 500);

  console.log(
    `[backfill-estimate-lifecycle] starting (dryRun=${dryRun}, batch=${batchSize})`,
  );

  let lastId = 0;
  let scanned = 0;
  let updated = 0;
  const counts: Record<string, number> = {};

  // Stream by ascending id in batches so memory stays bounded even
  // on tens of thousands of rows.
  for (;;) {
    const rows = await db
      .select({
        id: estimates.id,
        status: estimates.status,
        internalStatus: estimates.internalStatus,
        lifecycle: estimates.lifecycle,
      })
      .from(estimates)
      .where(sql`${estimates.id} > ${lastId}`)
      .orderBy(estimates.id)
      .limit(batchSize);
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      lastId = row.id;
      const target = deriveLifecycleForWrite({
        status: row.status,
        internalStatus: row.internalStatus,
      });
      counts[target] = (counts[target] ?? 0) + 1;
      if (row.lifecycle === target) continue;
      if (!dryRun) {
        await db
          .update(estimates)
          .set({ lifecycle: target })
          .where(eq(estimates.id, row.id));
      }
      updated += 1;
    }
    console.log(
      `[backfill-estimate-lifecycle] scanned=${scanned} updated=${updated} lastId=${lastId}`,
    );
  }

  console.log(`[backfill-estimate-lifecycle] done. Distribution:`);
  for (const [k, v] of Object.entries(counts).sort()) {
    console.log(`  ${k}: ${v}`);
  }
  console.log(
    `[backfill-estimate-lifecycle] scanned=${scanned} updated=${updated} dryRun=${dryRun}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill-estimate-lifecycle] fatal:", err);
    process.exit(1);
  });
