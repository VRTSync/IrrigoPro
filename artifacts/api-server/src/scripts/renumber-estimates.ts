// Task #669 — One-time migration from legacy timestamp / wet-check style
// estimate numbers (e.g. `EST-1715401234567`, `EST-WC-123-…`,
// `EST-2024-001`) to short per-company 5-digit sequences starting from
// each company's `startingEstimateNumber` (default 50000).
//
// Per company:
//   1. Load every estimate (incl. soft-deleted ones, so we don't
//      reuse a freed number on a future undelete) ordered by
//      `createdAt asc, id asc`.
//   2. Assign new numbers starting at `companies.startingEstimateNumber`
//      and incrementing by 1 per row.
//   3. Write each `estimates.estimateNumber` and bump
//      `companies.nextEstimateNumber` to `start + count`.
//
// Estimates with no `companyId` (legacy / orphaned rows) are skipped —
// they have nothing to anchor a per-company sequence to.
//
// Two-phase write to avoid colliding with the new
// `estimates_company_number_unique_idx` mid-update: phase 1 stamps a
// temporary prefixed number (`__renum__:<id>`) for every target row,
// phase 2 writes the final values. Both phases are batched in a single
// transaction per company so a crash leaves the company either
// fully-pre-staged or fully-final, never half-and-half.
//
// Resumable: progress is persisted in `app_settings` under key
// `estimateRenumber.done` (array of completed company ids) and
// `estimateRenumber.failed` (array of {companyId,error,at} entries).
// Mirrors the `backfill-estimate-labor-mode.ts` pattern.
//
// Run:
//   node --import tsx/esm \
//     artifacts/api-server/src/scripts/renumber-estimates.ts \
//     [--dry-run] [--batch=50]
//
// `--batch` controls how many companies are processed per outer loop
// iteration. The default (50) is fine for almost any tenant count;
// large multi-tenant installs can lower it to reduce per-iteration
// transaction size.

try { (process.stdout as unknown as { _handle?: { setBlocking?: (b: boolean) => void } })._handle?.setBlocking?.(true); } catch {}
try { (process.stderr as unknown as { _handle?: { setBlocking?: (b: boolean) => void } })._handle?.setBlocking?.(true); } catch {}

import { db } from "../db";
import { estimates, companies, appSettings } from "@workspace/db";
import { eq, asc } from "drizzle-orm";

const DONE_KEY = "estimateNumberRenumber.done";
const FAIL_KEY = "estimateNumberRenumber.failed";

function parseFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const n = Number(raw.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function loadIdSet(key: string): Promise<Set<number>> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, key));
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
    // corrupt — start fresh
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
  companyId: number;
  error: string;
  at: string;
}

async function loadFailures(): Promise<FailureEntry[]> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, FAIL_KEY));
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
  const batchSize = parseArg("batch", 50);

  console.log(
    `[renumber-estimates] starting (dryRun=${dryRun}, batch=${batchSize})`,
  );

  const done = await loadIdSet(DONE_KEY);
  console.log(
    `[renumber-estimates] resume — ${done.size} companies already processed`,
  );

  const allCompanies = await db
    .select({
      id: companies.id,
      startingEstimateNumber: companies.startingEstimateNumber,
    })
    .from(companies)
    .orderBy(asc(companies.id));

  let scannedCompanies = 0;
  let renumberedCompanies = 0;
  let renumberedEstimates = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < allCompanies.length; i += batchSize) {
    const slice = allCompanies.slice(i, i + batchSize);
    for (const company of slice) {
      scannedCompanies += 1;
      if (done.has(company.id)) {
        skipped += 1;
        continue;
      }
      const start = company.startingEstimateNumber ?? 50000;

      try {
        const rows = await db
          .select({ id: estimates.id, estimateNumber: estimates.estimateNumber })
          .from(estimates)
          .where(eq(estimates.companyId, company.id))
          .orderBy(asc(estimates.createdAt), asc(estimates.id));

        if (rows.length === 0) {
          // Nothing to renumber, but still pin `nextEstimateNumber` to
          // the configured starting value so the first allocation lands
          // there.
          if (!dryRun) {
            await db
              .update(companies)
              .set({ nextEstimateNumber: start })
              .where(eq(companies.id, company.id));
            done.add(company.id);
          }
          continue;
        }

        const assignments = rows.map((r, idx) => ({
          id: r.id,
          oldNumber: r.estimateNumber,
          newNumber: String(start + idx),
        }));

        if (!dryRun) {
          await db.transaction(async (tx) => {
            // Phase 1: stamp temp values to clear the per-company
            // uniqueness slots we're about to reuse.
            for (const a of assignments) {
              await tx
                .update(estimates)
                .set({ estimateNumber: `__renum__:${a.id}` })
                .where(eq(estimates.id, a.id));
            }
            // Phase 2: write final per-company sequence numbers.
            for (const a of assignments) {
              await tx
                .update(estimates)
                .set({ estimateNumber: a.newNumber })
                .where(eq(estimates.id, a.id));
            }
            // Pin the next allocation just past the last assigned row.
            await tx
              .update(companies)
              .set({ nextEstimateNumber: start + assignments.length })
              .where(eq(companies.id, company.id));
          });
          done.add(company.id);
        }

        renumberedCompanies += 1;
        renumberedEstimates += assignments.length;
        if (dryRun) {
          const preview = assignments
            .slice(0, 3)
            .map((a) => `${a.oldNumber}→${a.newNumber}`)
            .join(", ");
          console.log(
            `[renumber-estimates] company=${company.id} would renumber ${assignments.length} (${preview}${assignments.length > 3 ? ", …" : ""}) nextEstimateNumber=${start + assignments.length}`,
          );
        }
      } catch (err) {
        failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[renumber-estimates] FAILED company id=${company.id}: ${msg}`,
        );
        if (!dryRun) {
          await appendFailure({
            companyId: company.id,
            error: msg,
            at: new Date().toISOString(),
          });
        }
      }
    }
    if (!dryRun) await saveDoneSet(done);
    console.log(
      `[renumber-estimates] scannedCompanies=${scannedCompanies} renumberedCompanies=${renumberedCompanies} renumberedEstimates=${renumberedEstimates} skipped=${skipped} failed=${failed}`,
    );
  }

  console.log(
    `[renumber-estimates] done. scannedCompanies=${scannedCompanies} renumberedCompanies=${renumberedCompanies} renumberedEstimates=${renumberedEstimates} skipped=${skipped} failed=${failed} dryRun=${dryRun}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[renumber-estimates] fatal:", err);
    process.exit(1);
  });
