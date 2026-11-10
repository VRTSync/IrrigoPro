import { sql, type SQL } from "drizzle-orm";
import type { db } from "../db";

export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
export type BindScope = { companyId: number; customerId?: number; branchName?: string };
export const BIND_TABLES = ["billing_sheets", "estimates", "estimate_items", "work_orders",
  "work_order_items", "work_order_zone_photos", "wet_check_zone_records"] as const;
export type BindTable = typeof BIND_TABLES[number];
export type BindCounts = Record<BindTable, { bound: number; unresolved: number }>;
export type UnresolvedRow = { table: BindTable; id: number; customerId: number; customerName: string;
  branchName: string; letter: string; zoneNumber: number | null };

export const normalizeControllerLetter = (letter: unknown): string | null =>
  (typeof letter === "string" ? letter.trim().toUpperCase() : "") || null;

/** D2: exactly one active holder wins; otherwise exactly one total holder. */
export function chooseControllerId(rows: { id: number; isActive: boolean }[]): number | null {
  const active = rows.filter(row => row.isActive);
  return active.length === 1 ? active[0].id : rows.length === 1 ? rows[0].id : null;
}

const parents: Partial<Record<BindTable, [string, string]>> = {
  estimate_items: ["estimates", "estimate_id"],
  work_order_items: ["work_orders", "work_order_id"],
  work_order_zone_photos: ["work_orders", "work_order_id"],
  wet_check_zone_records: ["wet_checks", "wet_check_id"],
};

/** Shared candidate population for read-only preview and UPDATE. Identifiers are internal constants. */
function candidates(table: BindTable, scope: BindScope): SQL {
  const parent = parents[table];
  const location = parent ? "p" : "t";
  const col = (name: string) => sql.raw(`${location}.${name}`);
  return sql`WITH eligible AS (
    SELECT t.id, ${col("company_id")} AS company_id, ${col("customer_id")} AS customer_id,
      coalesce(${col("branch_name")}, '') AS branch_name,
      upper(trim(t.controller_letter)) AS letter, t.zone_number
    FROM ${sql.identifier(table)} t
    ${parent ? sql`JOIN ${sql.identifier(parent[0])} p ON p.id = ${sql.raw(`t.${parent[1]}`)}` : sql``}
    WHERE t.controller_id IS NULL AND nullif(trim(t.controller_letter), '') IS NOT NULL
      AND ${col("customer_id")} IS NOT NULL AND ${col("company_id")} = ${scope.companyId}
      ${scope.customerId === undefined ? sql`` : sql`AND ${col("customer_id")} = ${scope.customerId}`}
      ${scope.branchName === undefined ? sql`` : sql`AND coalesce(${col("branch_name")}, '') = ${scope.branchName}`}
  ), all_candidates AS (
    SELECT e.id, ic.id AS controller_id, ic.is_active,
      count(*) OVER (PARTITION BY e.id) AS match_count
    FROM eligible e JOIN irrigation_controllers ic ON
      ic.company_id = e.company_id AND ic.customer_id = e.customer_id
      AND ic.branch_name = e.branch_name AND upper(trim(ic.letter)) = e.letter
  ), active_candidates AS (
    SELECT id, controller_id, count(*) OVER (PARTITION BY id) AS match_count
    FROM all_candidates WHERE is_active = true
  ), chosen AS (
    -- Scalar selections keep exactly one row per eligible ticket, even when
    -- either candidate set is ambiguous. Never join an ambiguous set to e.
    SELECT e.*, coalesce(
      (SELECT a.controller_id FROM active_candidates a WHERE a.id = e.id AND a.match_count = 1),
      (SELECT c.controller_id FROM all_candidates c WHERE c.id = e.id AND c.match_count = 1)
    ) AS controller_id
    FROM eligible e
  )`;
}

export async function bindTickets(q: DbExecutor, scope: BindScope): Promise<BindCounts> {
  const counts = {} as BindCounts;
  for (const table of BIND_TABLES) {
    const result = await q.execute(sql`${candidates(table, scope)}, updated AS (
      UPDATE ${sql.identifier(table)} t SET controller_id = c.controller_id FROM chosen c
      WHERE t.id = c.id AND t.controller_id IS NULL AND c.controller_id IS NOT NULL RETURNING t.id
    ) SELECT (SELECT count(*)::int FROM updated) AS bound,
      (SELECT count(*)::int FROM chosen WHERE controller_id IS NULL) AS unresolved`);
    counts[table] = { bound: Number(result.rows[0].bound), unresolved: Number(result.rows[0].unresolved) };
  }
  return counts;
}

export async function countUnbound(q: DbExecutor, scope: BindScope): Promise<BindCounts & { unresolvedRows: UnresolvedRow[] }> {
  const counts = {} as BindCounts;
  const unresolvedRows: UnresolvedRow[] = [];
  for (const table of BIND_TABLES) {
    const result = await q.execute(sql`${candidates(table, scope)}
      SELECT count(*) filter (where controller_id IS NOT NULL)::int AS bound,
        count(*) filter (where controller_id IS NULL)::int AS unresolved FROM chosen`);
    counts[table] = { bound: Number(result.rows[0].bound), unresolved: Number(result.rows[0].unresolved) };
    if (counts[table].unresolved && unresolvedRows.length < 200) {
      const rows = await q.execute(sql`${candidates(table, scope)}
        SELECT c.id, c.customer_id AS "customerId", customers.name AS "customerName",
          c.branch_name AS "branchName", c.letter, c.zone_number AS "zoneNumber"
        FROM chosen c JOIN customers ON customers.id = c.customer_id AND customers.company_id = c.company_id
        WHERE c.controller_id IS NULL ORDER BY c.id LIMIT ${200 - unresolvedRows.length}`);
      unresolvedRows.push(...rows.rows.map(row => ({ ...row, table }) as UnresolvedRow));
    }
  }
  return Object.assign(counts, { unresolvedRows });
}
