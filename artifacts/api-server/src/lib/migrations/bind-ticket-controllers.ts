import { db } from "../../db";
import { companies } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { BIND_TABLES, bindTickets, countUnbound, type DbExecutor, type BindCounts, type UnresolvedRow } from "../ticket-controller-binding";
import type { MigrationDefinition, MigrationPreview, MigrationStatus, MigrationStepResult, ProgressEmitter } from "./types";

const KEY = "bindTicketControllers.done";
export type BindingCompany = { companyId: number; companyName: string; counts: BindCounts; unresolvedRows: UnresolvedRow[] };
export const totalBindable = (counts: BindCounts) => BIND_TABLES.reduce((n, table) => n + counts[table].bound, 0);
const totalUnresolved = (counts: BindCounts) => BIND_TABLES.reduce((n, table) => n + counts[table].unresolved, 0);

export async function loadTicketBindingCounts(companyId?: number, q: DbExecutor = db): Promise<BindingCompany[]> {
  const tenants = await q.select().from(companies).where(companyId === undefined ? undefined : eq(companies.id, companyId));
  const result: BindingCompany[] = [];
  for (const tenant of tenants) {
    const { unresolvedRows, ...counts } = await countUnbound(q, { companyId: tenant.id });
    result.push({ companyId: tenant.id, companyName: tenant.name, counts, unresolvedRows });
  }
  return result;
}

export function buildTicketBindingPreview(tenants: BindingCompany[]): MigrationPreview {
  return {
    requiresAcknowledgement: true,
    steps: tenants.map(c => ({
      id: `company_${c.companyId}`,
      description: `${c.companyName}: ${totalBindable(c.counts)} tickets to tie to their clock (${BIND_TABLES.map(table => `${table}: ${c.counts[table].bound} bindable, ${c.counts[table].unresolved} unresolved`).join("; ")}); ${totalUnresolved(c.counts)} can't be matched`,
    })),
    orphanRows: {
      bindable: tenants.reduce((n, c) => n + totalBindable(c.counts), 0),
      unresolved: tenants.reduce((n, c) => n + totalUnresolved(c.counts), 0),
    },
    warnings: [
      "Unmatched tickets keep their letter and stay untied. Listed below.",
      ...tenants.flatMap(c => c.unresolvedRows).slice(0, 50).map(row =>
        `${row.customerName} · ${row.branchName || "—"} · ${row.table} #${row.id} · letter ${row.letter} zone ${row.zoneNumber}`),
    ],
  };
}

export function ticketBindingCheckState(remaining: number, completedAt?: string): MigrationStatus {
  if (remaining > 0) return completedAt !== undefined
    ? { state: "partially_applied", details: `${remaining} bindable tickets remain` }
    : { state: "not_started" };
  return { state: "completed", completedAt: completedAt ?? "" };
}

// Scoped runs are a test/operator seam and never write the global completion marker.
export async function runTicketBinding(emit: ProgressEmitter, acknowledged = false, companyId?: number): Promise<MigrationStepResult[]> {
  if (!acknowledged) return [{ id: "acknowledge", status: "failed", durationMs: 0, error: "Preview acknowledgement required" }];
  const started = Date.now();
  try {
    const results = await db.transaction(async tx => {
      const tenants = await tx.select().from(companies).where(companyId === undefined ? undefined : eq(companies.id, companyId));
      const steps: MigrationStepResult[] = [];
      for (const tenant of tenants) {
        const id = `company_${tenant.id}`;
        emit({ step: id, status: "running" });
        const counts = await bindTickets(tx, { companyId: tenant.id });
        if (totalBindable(await countUnbound(tx, { companyId: tenant.id })) > 0) {
          throw new Error("Bindable tickets remain; no completion marker written");
        }
        steps.push({ id, status: "success", durationMs: Date.now() - started, rowsAffected: totalBindable(counts) });
      }
      if ((await loadTicketBindingCounts(companyId, tx)).some(c => totalBindable(c.counts) > 0)) {
        throw new Error("Bindable tickets remain; no completion marker written");
      }
      if (companyId === undefined) {
        await tx.execute(sql`INSERT INTO app_settings (key, value) VALUES (${KEY}, 'completed')
          ON CONFLICT (key) DO UPDATE SET value = 'completed', updated_at = now()`);
      }
      return steps;
    });
    for (const step of results) emit({ step: step.id, status: "success", rowsAffected: step.rowsAffected });
    if ((await loadTicketBindingCounts(companyId)).some(c => totalBindable(c.counts) > 0)) {
      return [...results, { id: "verify", status: "failed", durationMs: 0, error: "Bindable tickets remain after commit; run again" }];
    }
    return [...results, { id: "verify", status: "success", durationMs: 0, rowsAffected: 0 }];
  } catch (error) {
    return [{ id: "verify", status: "failed", durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) }];
  }
}

export const bindTicketControllersMigration: MigrationDefinition = {
  id: "bind-ticket-controllers-v1",
  title: "Bind tickets to their clocks",
  description: "Tie every billing sheet, work order, estimate and wet-check zone to its clock by id, so renaming a clock never moves its history. Randy runs this after publish; merging does not run it.",
  appSettingsKey: KEY,
  preview: async () => buildTicketBindingPreview(await loadTicketBindingCounts()),
  check: async () => {
    try {
      const remaining = (await loadTicketBindingCounts()).reduce((n, c) => n + totalBindable(c.counts), 0);
      const marker = await db.execute(sql`SELECT updated_at FROM app_settings WHERE key = ${KEY}`);
      return ticketBindingCheckState(remaining, marker.rows.length ? String(marker.rows[0].updated_at) : undefined);
    } catch (error) {
      return { state: "error", details: error instanceof Error ? error.message : String(error) };
    }
  },
  run: (emit, opts) => runTicketBinding(emit, opts?.acknowledged === true),
};
