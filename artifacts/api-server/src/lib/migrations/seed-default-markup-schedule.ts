import { db } from "../../db";
import { companies, materialMarkupSchedules as schedules, appSettings } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { DEFAULT_MARKUP_TIERS } from "@workspace/shared";
import { insertSchedule, lockMarkupCompany } from "../../storage/markup-schedules";
import type { MigrationDefinition } from "./types";

const key = "seedDefaultMarkupSchedule.done";
async function eligible() {
  const rows = await db.select({ id: companies.id, name: companies.name, scheduleId: schedules.id }).from(companies)
    .leftJoin(schedules, and(eq(schedules.companyId, companies.id), eq(schedules.isActive, true)));
  return rows.filter(r => r.scheduleId === null);
}
export const seedDefaultMarkupScheduleMigration: MigrationDefinition = {
  id: "seed-default-markup-schedule", title: "Seed default material markup schedules",
  description: "Add six incremental cost brackets only to companies without an active schedule. Existing schedules and catalog/document prices are unchanged.",
  appSettingsKey: key,
  async check() {
    const rows = await eligible();
    const [marker] = await db.select().from(appSettings).where(eq(appSettings.key, key));
    if (!rows.length && marker) return { state: "completed", completedAt: marker.value };
    if (marker) return { state: "partially_applied", details: `${rows.length} companies need a default schedule` };
    return { state: "not_started" };
  },
  async preview() {
    const rows = await eligible();
    return {
      requiresAcknowledgement: true, orphanRows: { eligibleCompanies: rows.length },
      steps: rows.map(r => ({ id: `company-${r.id}`, description: `${r.name}: Standard Material Markup` })),
      warnings: DEFAULT_MARKUP_TIERS.map(t => `$${t.minCost.toFixed(2)}–${t.maxCost === null ? "unbounded" : "$" + t.maxCost.toFixed(2)}: ${t.markupPercent}%`),
    };
  },
  async run(emit, opts) {
    if (!opts?.acknowledged) return [{ id: "seed", status: "failed", durationMs: 0, error: "Preview acknowledgement required" }];
    const started = Date.now();
    emit({ step: "seed", status: "running" });
    try {
      const count = await db.transaction(async tx => {
        const rows = await tx.select({ id: companies.id }).from(companies).orderBy(companies.id);
        let count = 0;
        for (const row of rows) {
          await lockMarkupCompany(tx, row.id);
          const [active] = await tx.select({ id: schedules.id }).from(schedules).where(and(eq(schedules.companyId, row.id), eq(schedules.isActive, true)));
          if (active) continue;
          await insertSchedule(tx, { companyId: row.id, name: "Standard Material Markup", effectiveDate: new Date().toISOString().slice(0, 10), tiers: DEFAULT_MARKUP_TIERS }, true);
          count++;
        }
        await tx.insert(appSettings).values({ key, value: new Date().toISOString() }).onConflictDoUpdate({ target: appSettings.key, set: { value: new Date().toISOString(), updatedAt: new Date() } });
        return count;
      });
      if ((await eligible()).length) throw new Error("Companies without active schedules remain after commit");
      emit({ step: "seed", status: "success", rowsAffected: count });
      return [{ id: "seed", status: "success", durationMs: Date.now() - started, rowsAffected: count }];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit({ step: "seed", status: "failed", error: message });
      return [{ id: "seed", status: "failed", durationMs: Date.now() - started, error: message }];
    }
  },
};
