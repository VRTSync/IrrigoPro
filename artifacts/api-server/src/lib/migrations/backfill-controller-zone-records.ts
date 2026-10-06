import { db } from "../../db";
import { storage } from "../../storage";
import { companies, customers, irrigationControllers, irrigationProfileZones } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { compressZoneRanges } from "../controller-zone-records";
import type { MigrationDefinition, MigrationPreview, MigrationStatus, MigrationStepResult, ProgressEmitter } from "./types";

const ID = "backfill-controller-zone-records-v1";
const KEY = "backfillControllerZoneRecords.done";
export interface ControllerZonePlan {
  companyId: number; companyName: string; customerId: number; customerName: string;
  controllerId: number; letter: string; totalZones: number | null; target: number | null;
  currentCount: number; created: number[]; restored: number[]; retired: number[];
  invalid?: string; needsRepair: boolean;
}

export function planControllerZones(
  ctrl: Omit<ControllerZonePlan, "target" | "currentCount" | "created" | "restored" | "retired" | "invalid" | "needsRepair">,
  rows: { zoneNumber: number; retiredAt: Date | null }[],
): ControllerZonePlan {
  const current = rows.filter(row => row.retiredAt === null);
  const target = ctrl.totalZones ?? (current.length ? Math.max(...current.map(row => row.zoneNumber)) : null);
  const invalid = target !== null && (!Number.isInteger(target) || target < 1 || target > 100)
    ? `Invalid legacy target ${target}; expected 1-100. Resolve explicitly before running.` : undefined;
  const created: number[] = [], restored: number[] = [];
  if (target !== null && !invalid) {
    for (let n = 1; n <= target; n++) {
      const row = rows.find(row => row.zoneNumber === n);
      if (!row) created.push(n);
      else if (row.retiredAt) restored.push(n);
    }
  }
  const retired = target !== null && !invalid
    ? current.filter(row => row.zoneNumber > target || row.zoneNumber < 1).map(row => row.zoneNumber) : [];
  return { ...ctrl, target, currentCount: current.length, created, restored, retired, invalid,
    needsRepair: !!invalid || created.length > 0 || restored.length > 0 || retired.length > 0 || target !== ctrl.totalZones };
}

/** Enumerate tenants first; every data leg is explicitly company scoped. */
export async function loadControllerZonePlans(companyId?: number): Promise<ControllerZonePlan[]> {
  const tenants = await db.select().from(companies).where(companyId === undefined ? undefined : eq(companies.id, companyId));
  const plans: ControllerZonePlan[] = [];
  for (const tenant of tenants) {
    const ctrls = await db.select({ controller: irrigationControllers, customerName: customers.name }).from(irrigationControllers)
      .innerJoin(customers, and(eq(customers.id, irrigationControllers.customerId), eq(customers.companyId, tenant.id)))
      .where(eq(irrigationControllers.companyId, tenant.id)).orderBy(irrigationControllers.customerId, irrigationControllers.id);
    const rows = await db.select().from(irrigationProfileZones).where(eq(irrigationProfileZones.companyId, tenant.id));
    for (const { controller: ctrl, customerName } of ctrls) {
      plans.push(planControllerZones({
        companyId: tenant.id, companyName: tenant.name, customerId: ctrl.customerId, customerName,
        controllerId: ctrl.id, letter: ctrl.letter ?? ctrl.name, totalZones: ctrl.totalZones,
      }, rows.filter(row => row.controllerId === ctrl.id)));
    }
  }
  return plans;
}

export function buildControllerZonePreview(plans: ControllerZonePlan[]): MigrationPreview {
  const affected = plans.filter(plan => plan.needsRepair);
  const count = (key: "created" | "restored" | "retired") => affected.reduce((sum, plan) => sum + plan[key].length, 0);
  const warnings = affected.filter(plan => plan.invalid).map(plan => `${plan.companyName} / ${plan.customerName} / Controller ${plan.letter}: ${plan.invalid}`);
  if (count("retired")) warnings.push(`${count("retired")} zones will be retired; identity and data are kept. Acknowledge before running.`);
  return {
    requiresAcknowledgement: count("retired") > 0,
    steps: [
      { id: "summary", description: `${affected.length} controllers, ${count("created")} zones to create, ${count("retired")} to retire; ${count("restored")} to restore` },
      ...affected.map(plan => ({
        id: `controller_${plan.companyId}_${plan.controllerId}`,
        description: `${plan.companyName} / ${plan.customerName} / Controller ${plan.letter}: ${plan.totalZones ?? "not set"} / ${plan.currentCount} rows → ${plan.invalid ?? [
          plan.created.length ? `create ${compressZoneRanges(plan.created)}` : "",
          plan.restored.length ? `restore ${compressZoneRanges(plan.restored)}` : "",
          plan.retired.length ? `retire ${compressZoneRanges(plan.retired)}` : "",
          plan.totalZones !== plan.target ? `set count ${plan.target}` : "",
        ].filter(Boolean).join("; ")}`,
      })),
    ],
    orphanRows: { controllers: affected.length, zonesToCreate: count("created"), zonesToRestore: count("restored"), zonesToRetire: count("retired"), invalidTargets: affected.filter(plan => plan.invalid).length },
    warnings,
  };
}

export interface BackfillZoneDeps {
  load(): Promise<ControllerZonePlan[]>;
  repair(companyId: number, controllerId: number, acknowledged: boolean): Promise<number>;
  markDone(): Promise<void>;
}

export async function runControllerZoneBackfill(deps: BackfillZoneDeps, emit: ProgressEmitter, acknowledged = false): Promise<MigrationStepResult[]> {
  const plans = await deps.load();
  if (!acknowledged && plans.some(plan => plan.retired.length)) {
    return [{ id: "acknowledge", status: "failed", durationMs: 0, error: "Retirement acknowledgement required" }];
  }
  const results: MigrationStepResult[] = [];
  for (const plan of plans.filter(plan => plan.needsRepair)) {
    const id = `controller_${plan.companyId}_${plan.controllerId}`;
    const start = Date.now();
    emit({ step: id, status: "running" });
    try {
      if (plan.invalid) throw new Error(plan.invalid);
      const rowsAffected = await deps.repair(plan.companyId, plan.controllerId, acknowledged);
      results.push({ id, status: "success", durationMs: Date.now() - start, rowsAffected });
      emit({ step: id, status: "success", rowsAffected });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ id, status: "failed", durationMs: Date.now() - start, error: message });
      emit({ step: id, status: "failed", error: message });
    }
  }
  // Independent post-commit read, not the runner's counters or marker.
  const remaining = (await deps.load()).filter(plan => plan.needsRepair);
  if (remaining.length || results.some(result => result.status === "failed")) {
    results.push({ id: "verify", status: "failed", durationMs: 0, error: `${remaining.length} controllers remain unreconciled; no completion marker written` });
  } else {
    await deps.markDone();
    results.push({ id: "verify", status: "success", durationMs: 0, rowsAffected: 0 });
  }
  return results;
}

async function check(): Promise<MigrationStatus> {
  try {
    const remaining = (await loadControllerZonePlans()).filter(plan => plan.needsRepair);
    const marker = await db.execute(sql`SELECT updated_at FROM app_settings WHERE key = ${KEY}`);
    if (remaining.length) return marker.rows.length
      ? { state: "partially_applied", details: `${remaining.length} controllers remain unreconciled (including invalid legacy targets)` }
      : { state: "not_started" };
    return marker.rows.length
      ? { state: "completed", completedAt: String(marker.rows[0].updated_at) }
      : { state: "partially_applied", details: "Zone records agree; run to verify and record completion." };
  } catch (err) { return { state: "error", details: err instanceof Error ? err.message : String(err) }; }
}

export const backfillControllerZoneRecordsMigration: MigrationDefinition = {
  id: ID, title: "Backfill controller zone records",
  description: "Reconcile every counted controller to positions 1–N. Fill gaps and restore or retire rows without deleting zone identity or data. Unknown controllers with no current rows stay unconfigured.",
  appSettingsKey: KEY, check,
  preview: async () => buildControllerZonePreview(await loadControllerZonePlans()),
  run: async (emit, opts) => runControllerZoneBackfill({
    load: loadControllerZonePlans,
    repair: (companyId, id, acknowledged) => storage.backfillControllerZoneRecords(companyId, id, acknowledged),
    markDone: async () => {
      await db.transaction(async tx => {
        // Serialize final verification with every controller writer before setting the marker.
        await tx.select({ id: irrigationControllers.id }).from(irrigationControllers).orderBy(irrigationControllers.id).for("update");
        const result = await tx.execute(sql`
          SELECT c.id FROM irrigation_controllers c
          LEFT JOIN irrigation_profile_zones z ON z.controller_id = c.id AND z.company_id = c.company_id AND z.retired_at IS NULL
          GROUP BY c.id
          HAVING (c.total_zones IS NULL AND count(z.id) > 0)
             OR (c.total_zones IS NOT NULL AND (
               c.total_zones NOT BETWEEN 1 AND 100 OR count(z.id) <> c.total_zones
               OR min(z.zone_number) <> 1 OR max(z.zone_number) <> c.total_zones))
        `);
        if (result.rows.length) throw new Error("Controllers changed during final verification; run again");
        await tx.execute(sql`INSERT INTO app_settings (key, value) VALUES (${KEY}, 'completed')
          ON CONFLICT (key) DO UPDATE SET value = 'completed', updated_at = now()`);
      });
    },
  }, emit, opts?.acknowledged === true),
};
