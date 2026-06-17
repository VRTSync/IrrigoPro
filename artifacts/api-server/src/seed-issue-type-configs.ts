import { pool } from "./db";
import { WET_CHECK_ISSUE_TYPE_SEED } from "@workspace/db";
import { seedIssueTypeConfigsForCompany, patchLaborOnlyColumn, patchPartOptionalColumn } from "./seeds/issue-type-configs";

// Re-export per-company seeder so callers (createCompany, admin endpoint,
// scripts) all share the same implementation.
export { seedIssueTypeConfigsForCompany };

// Exported so tests can prove the seed is genuinely re-run safe — each
// invocation must leave every active company at exactly SEED.length rows
// for issue_type_configs with no duplicates.
export async function seedIssueTypeConfigsForActiveCompanies(): Promise<number> {
  const allCompaniesRows = await pool.query(`SELECT id FROM companies WHERE is_active = TRUE`);
  for (const row of allCompaniesRows.rows as { id: number }[]) {
    for (const seed of WET_CHECK_ISSUE_TYPE_SEED) {
      await pool.query(
        `INSERT INTO issue_type_configs
           (company_id, issue_type, issue_group, display_label, default_labor_hours, part_category_filter, sort_order, labor_only, part_optional)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (company_id, issue_type) DO UPDATE
           SET part_optional = EXCLUDED.part_optional,
               labor_only    = EXCLUDED.labor_only`,
        [
          row.id,
          seed.issueType,
          seed.issueGroup,
          seed.displayLabel,
          seed.defaultLaborHours,
          seed.partCategoryFilter,
          seed.sortOrder,
          seed.laborOnly ?? false,
          seed.partOptional ?? false,
        ]
      );
    }
  }
  // One-time migrations — order matters: patchLaborOnlyColumn must run before
  // patchPartOptionalColumn so the labor_only guard in patchLaborOnlyColumn
  // does not re-flag rows that patchPartOptionalColumn converts.
  await patchLaborOnlyColumn();
  await patchPartOptionalColumn();
  return allCompaniesRows.rowCount ?? 0;
}
