/**
 * Shared seed module for issue_type_configs.
 *
 * Exports:
 *  - normalizeIssueTypeKey  — canonical key normalization (trim/lowercase/spaces+dashes→underscores)
 *  - ISSUE_TYPE_ALIASES     — semantic short-form aliases resolved after normalization
 *  - resolveIssueTypeKey    — normalization + alias resolution in one call
 *  - seedIssueTypeConfigsForCompany — idempotent per-company seeder (ON CONFLICT DO NOTHING)
 */

import { pool } from "../db";
import { WET_CHECK_ISSUE_TYPE_SEED } from "@workspace/db";

/**
 * Normalize a raw issueType string coming from the DB or a client payload into
 * the canonical snake_case key used in issue_type_configs.
 *
 * Steps: trim → lowercase → replace spaces and dashes with underscores.
 *
 * Examples:
 *   "Nozzle Replacement" → "nozzle_replacement"
 *   "nozzle-replacement" → "nozzle_replacement"
 *   "  LEAK_REPAIR "     → "leak_repair"
 */
export function normalizeIssueTypeKey(s: string): string {
  return s.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * Semantic aliases for short-form or alternate issue type keys.
 * Keys must already be normalized (output of normalizeIssueTypeKey).
 * Applied after normalization so lookup is O(1) and case-insensitive.
 */
export const ISSUE_TYPE_ALIASES: Readonly<Record<string, string>> = {
  head_replace:      "head_replacement",
  nozzle_replace:    "nozzle_replacement",
  head_adjust:       "head_adjustment",
  leak:              "leak_repair",
  pressure:          "pressure_issue",
  coverage:          "coverage_issue",
  valve:             "valve_issue",
  wiring:            "wiring_issue",
  controller:        "controller_issue",
};

/**
 * Resolve a raw issueType string to its canonical config-map key.
 * Normalizes first, then applies the ISSUE_TYPE_ALIASES map.
 */
export function resolveIssueTypeKey(raw: string): string {
  const normalized = normalizeIssueTypeKey(raw);
  return ISSUE_TYPE_ALIASES[normalized] ?? normalized;
}

/**
 * Idempotent per-company seeder — inserts the canonical issue_type_configs
 * rows for the given company using ON CONFLICT DO NOTHING so existing
 * customized rows are never overwritten.
 *
 * Returns the number of rows actually inserted (0 on a repeat run).
 */
export async function seedIssueTypeConfigsForCompany(companyId: number): Promise<number> {
  let inserted = 0;
  for (const seed of WET_CHECK_ISSUE_TYPE_SEED) {
    const res = await pool.query(
      `INSERT INTO issue_type_configs
         (company_id, issue_type, issue_group, display_label, default_labor_hours, part_category_filter, sort_order, labor_only)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (company_id, issue_type) DO NOTHING
       RETURNING id`,
      [
        companyId,
        seed.issueType,
        seed.issueGroup,
        seed.displayLabel,
        seed.defaultLaborHours,
        seed.partCategoryFilter,
        seed.sortOrder,
        seed.laborOnly ?? false,
      ],
    );
    inserted += res.rowCount ?? 0;
  }
  return inserted;
}

/**
 * One-time migration: set labor_only = true for all existing head_adjustment
 * rows. Safe to call repeatedly — it is a no-op when already set.
 * Called automatically by seedIssueTypeConfigsForActiveCompanies on startup.
 */
export async function patchLaborOnlyColumn(): Promise<number> {
  const res = await pool.query(
    `UPDATE issue_type_configs
     SET labor_only = true
     WHERE issue_type = 'head_adjustment' AND labor_only = false`,
  );
  return res.rowCount ?? 0;
}
