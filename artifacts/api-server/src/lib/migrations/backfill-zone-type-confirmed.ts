import { db } from "../../db";
import { companies, irrigationProfileZones } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import type { MigrationDefinition, MigrationPreview, MigrationStepResult, ProgressEmitter } from "./types";

const KEY = "backfillZoneTypeConfirmed.done";
type Executor = Pick<typeof db, "select" | "update" | "execute">;
export type ZoneTypeCompany = { companyId: number; companyName: string; eligible: number; other: number };

/** Retired history is intentionally included. Every zone query is tenant scoped. */
export async function loadZoneTypeCounts(companyId?: number, q: Executor = db): Promise<ZoneTypeCompany[]> {
  const tenants = await q.select().from(companies).where(companyId === undefined ? undefined : eq(companies.id, companyId));
  const result: ZoneTypeCompany[] = [];
  for (const tenant of tenants) {
    const [counts] = await q.select({
      eligible: sql<number>`count(*) filter (where ${irrigationProfileZones.zoneType} <> 'other' and ${irrigationProfileZones.zoneTypeConfirmed} = false)::int`,
      other: sql<number>`count(*) filter (where ${irrigationProfileZones.zoneType} = 'other')::int`,
    }).from(irrigationProfileZones).where(eq(irrigationProfileZones.companyId, tenant.id));
    result.push({ companyId: tenant.id, companyName: tenant.name, eligible: counts.eligible, other: counts.other });
  }
  return result;
}

export function buildZoneTypePreview(counts: ZoneTypeCompany[]): MigrationPreview {
  return {
    requiresAcknowledgement: true,
    steps: counts.map(c => ({ id: `company_${c.companyId}`, description: `${c.companyName}: ${c.eligible} unconfirmed non-Other zones to confirm; ${c.other} Other zones (informational, unchanged)` })),
    orphanRows: {
      eligibleZones: counts.reduce((n, c) => n + c.eligible, 0),
      otherZones: counts.reduce((n, c) => n + c.other, 0),
    },
    warnings: ["Includes retired zone history. Other zones remain unchanged; unconfirmed Other types require a person to choose them."],
  };
}

// companyId is a test/operator seam; scoped runs never write the global marker.
export async function runZoneTypeBackfill(emit: ProgressEmitter, acknowledged = false, companyId?: number): Promise<MigrationStepResult[]> {
  if (!acknowledged) return [{ id: "acknowledge", status: "failed", durationMs: 0, error: "Preview acknowledgement required" }];
  const started = Date.now();
  try {
    const results = await db.transaction(async tx => {
      const tenants = await loadZoneTypeCounts(companyId, tx);
      const steps: MigrationStepResult[] = [];
      for (const tenant of tenants) {
        const id = `company_${tenant.companyId}`;
        emit({ step: id, status: "running" });
        const rows = await tx.update(irrigationProfileZones).set({ zoneTypeConfirmed: true }).where(and(
          eq(irrigationProfileZones.companyId, tenant.companyId),
          sql`${irrigationProfileZones.zoneType} <> 'other'`,
          eq(irrigationProfileZones.zoneTypeConfirmed, false),
        )).returning({ id: irrigationProfileZones.id });
        steps.push({ id, status: "success", durationMs: Date.now() - started, rowsAffected: rows.length });
      }
      // Re-read the population, not the UPDATE counters, before recording completion.
      if ((await loadZoneTypeCounts(companyId, tx)).some(c => c.eligible > 0)) {
        throw new Error("Eligible zones remain; no completion marker written");
      }
      if (companyId === undefined) {
        await tx.execute(sql`INSERT INTO app_settings (key, value) VALUES (${KEY}, 'completed')
          ON CONFLICT (key) DO UPDATE SET value = 'completed', updated_at = now()`);
      }
      return steps;
    });
    for (const result of results) emit({ step: result.id, status: "success", rowsAffected: result.rowsAffected });
    // Independently verify committed state, including concurrent changes.
    if ((await loadZoneTypeCounts(companyId)).some(c => c.eligible > 0)) {
      return [...results, { id: "verify", status: "failed", durationMs: 0, error: "Eligible zones remain after commit; run again" }];
    }
    return [...results, { id: "verify", status: "success", durationMs: 0, rowsAffected: 0 }];
  } catch (error) {
    return [{ id: "verify", status: "failed", durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) }];
  }
}

export const backfillZoneTypeConfirmedMigration: MigrationDefinition = {
  id: "backfill-zone-type-confirmed-v1",
  title: "Backfill confirmed zone types",
  description: "Confirm previously chosen non-Other types, including retired history, per company. Other zones still need explicit confirmation. Randy runs this after publish; merging does not run it.",
  appSettingsKey: KEY,
  preview: async () => buildZoneTypePreview(await loadZoneTypeCounts()),
  check: async () => {
    try {
      const remaining = (await loadZoneTypeCounts()).reduce((n, c) => n + c.eligible, 0);
      const marker = await db.execute(sql`SELECT updated_at FROM app_settings WHERE key = ${KEY}`);
      if (remaining) return marker.rows.length
        ? { state: "partially_applied", details: `${remaining} non-Other zones remain unconfirmed` }
        : { state: "not_started" };
      return marker.rows.length
        ? { state: "completed", completedAt: String(marker.rows[0].updated_at) }
        : { state: "partially_applied", details: "No eligible zones remain; run to verify and record completion." };
    } catch (error) {
      return { state: "error", details: error instanceof Error ? error.message : String(error) };
    }
  },
  run: (emit, opts) => runZoneTypeBackfill(emit, opts?.acknowledged === true),
};
