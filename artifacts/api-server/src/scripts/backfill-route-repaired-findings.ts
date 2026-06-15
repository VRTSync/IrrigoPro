// Backfill script — route orphaned `completed_in_field` findings to WCB.
//
// Finds wet-check findings where:
//   techDisposition = 'completed_in_field'
//   AND billingSheetId IS NULL
//   AND estimateId IS NULL
//   AND workOrderId IS NULL
//   AND wetCheckBillingId IS NULL
//   AND resolution != 'documented_only'
//
// Groups them by wetCheckId (matching the normal auto-bill path) and calls
// `storage.routeFindingsToWetCheckBillingBulk` once per wet check to create
// or append to its WetCheckBilling record.
//
// Idempotent: re-running after a partial run picks up where it left off.
// Progress is persisted to `app_settings`:
//   `findingBackfill.done`   — comma-separated finding IDs that succeeded
//   `findingBackfill.failed` — comma-separated finding IDs that errored
//
// Run:
//   node --import tsx/esm \
//     artifacts/api-server/src/scripts/backfill-route-repaired-findings.ts \
//     [--dry-run] [--batch=N]

import { db } from "../db";
import { storage } from "../storage";
import {
  wetCheckFindings,
  wetChecks,
  appSettings,
} from "@workspace/db/schema";
import { and, eq, isNull, ne, sql } from "drizzle-orm";

const DONE_KEY = "findingBackfill.done";
const FAILED_KEY = "findingBackfill.failed";

function parseFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const n = Number(raw.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key));
  return row?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

async function main(): Promise<void> {
  const dryRun = parseFlag("dry-run");
  const batchSize = parseArg("batch", 500);

  console.log(
    `[backfill-route-repaired-findings] starting (dryRun=${dryRun}, batch=${batchSize})`,
  );

  // Load already-processed IDs to enable resumability.
  const doneRaw = await getSetting(DONE_KEY);
  const alreadyDone = new Set(
    doneRaw
      ? doneRaw
          .split(",")
          .map(Number)
          .filter((n) => n > 0)
      : [],
  );
  const failedRaw = await getSetting(FAILED_KEY);
  const alreadyFailed = new Set(
    failedRaw
      ? failedRaw
          .split(",")
          .map(Number)
          .filter((n) => n > 0)
      : [],
  );

  console.log(
    `[backfill-route-repaired-findings] resuming from ${alreadyDone.size} done, ${alreadyFailed.size} failed`,
  );

  let lastId = 0;
  let scanned = 0;
  let routed = 0;
  let failed = 0;
  let skipped = 0;
  const newDone: number[] = [];
  const newFailed: number[] = [];

  for (;;) {
    // Fetch a batch of candidate findings, ordered by id for cursor pagination.
    const rows = await db
      .select({
        id: wetCheckFindings.id,
        wetCheckId: wetCheckFindings.wetCheckId,
        wcCompanyId: wetChecks.companyId,
      })
      .from(wetCheckFindings)
      .innerJoin(wetChecks, eq(wetCheckFindings.wetCheckId, wetChecks.id))
      .where(
        and(
          sql`${wetCheckFindings.id} > ${lastId}`,
          eq(wetCheckFindings.techDisposition, "completed_in_field"),
          isNull(wetCheckFindings.billingSheetId),
          isNull(wetCheckFindings.estimateId),
          isNull(wetCheckFindings.workOrderId),
          isNull(wetCheckFindings.wetCheckBillingId),
          ne(wetCheckFindings.resolution, "documented_only"),
        ),
      )
      .orderBy(wetCheckFindings.id)
      .limit(batchSize);

    if (rows.length === 0) break;

    // Track the cursor.
    lastId = rows[rows.length - 1].id;
    scanned += rows.length;

    // Skip findings already processed in a prior run.
    const pending = rows.filter((r) => !alreadyDone.has(r.id) && !alreadyFailed.has(r.id));
    skipped += rows.length - pending.length;

    if (pending.length === 0) {
      console.log(
        `[backfill-route-repaired-findings] batch fully skipped — lastId=${lastId}`,
      );
      continue;
    }

    // Group pending findings by wetCheckId so we mirror the auto-bill path
    // (one WCB per wet check, or appended to an existing one).
    const byWetCheck = new Map<number, { id: number; wcCompanyId: number | null }[]>();
    for (const r of pending) {
      const key = r.wetCheckId;
      if (!byWetCheck.has(key)) byWetCheck.set(key, []);
      byWetCheck.get(key)!.push({ id: r.id, wcCompanyId: r.wcCompanyId });
    }

    for (const [wetCheckId, group] of byWetCheck) {
      const ids = group.map((g) => g.id);
      const cid = group[0].wcCompanyId;

      console.log(
        `[backfill-route-repaired-findings] ${dryRun ? "[DRY RUN] would route" : "routing"} ${ids.length} finding(s) for wetCheckId=${wetCheckId} companyId=${cid}`,
      );

      if (!dryRun) {
        const result = await storage.routeFindingsToWetCheckBillingBulk(ids, cid, null);

        for (const id of result.routed) {
          newDone.push(id);
          routed += 1;
        }
        for (const e of result.errors) {
          console.error(
            `[backfill-route-repaired-findings] ERROR finding id=${e.findingId}:`,
            e.message,
          );
          newFailed.push(e.findingId);
          failed += 1;
        }
      } else {
        routed += ids.length;
      }
    }

    console.log(
      `[backfill-route-repaired-findings] batch done: scanned=${scanned} routed=${routed} failed=${failed} skipped=${skipped} lastId=${lastId}`,
    );

    // Persist progress after each batch so we can resume on timeout.
    if (!dryRun && (newDone.length > 0 || newFailed.length > 0)) {
      const allDone = [...Array.from(alreadyDone), ...newDone].join(",");
      const allFailed = [...Array.from(alreadyFailed), ...newFailed].join(",");
      await setSetting(DONE_KEY, allDone);
      await setSetting(FAILED_KEY, allFailed);
    }
  }

  console.log(
    `[backfill-route-repaired-findings] done. scanned=${scanned} routed=${routed} failed=${failed} skipped=${skipped} dryRun=${dryRun}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill-route-repaired-findings] fatal:", err);
    process.exit(1);
  });
