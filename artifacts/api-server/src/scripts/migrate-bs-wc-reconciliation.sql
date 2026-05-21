-- migrate-bs-wc-reconciliation.sql
-- Task #796 — Standalone pre/post migration reconciliation queries for ops use.
--
-- Run these queries BEFORE and AFTER executing the migration script to verify
-- the data was moved correctly. All queries are read-only (SELECT only).
--
-- Usage:
--   psql $DATABASE_URL -f migrate-bs-wc-reconciliation.sql
--
-- Or run individual blocks as needed in your DB client.

-- ─────────────────────────────────────────────────────────────────────────────
-- QUERY 1: BS-WC billing sheets summary
-- What it tells ops: how many BS-WC rows remain in billing_sheets, how many
-- distinct customers they belong to, their combined invoice value, and how
-- many are already linked to an invoice (i.e., already billed).
-- Pre-migration: shows the full population to be migrated.
-- Post-migration: should show count=0 if all rows migrated successfully,
--   or count=N where N equals the number of failed rows.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  COUNT(*)                                            AS bs_wc_count,
  COUNT(DISTINCT customer_id)                         AS bs_wc_distinct_customers,
  COALESCE(SUM(total_amount), 0)                      AS bs_wc_total_value,
  COUNT(*) FILTER (WHERE invoice_id IS NOT NULL)      AS bs_wc_already_billed
FROM billing_sheets
WHERE billing_number LIKE 'BS-WC-%';

-- ─────────────────────────────────────────────────────────────────────────────
-- QUERY 2: wet_check_findings linked to BS-WC billing sheets
-- What it tells ops: how many findings still reference a BS-WC billing_sheet_id
-- rather than a wet_check_billing_id. Pre-migration: this is the full count of
-- findings to be re-keyed. Post-migration: should be 0 if all rows succeeded;
-- non-zero means some finding FKs were not updated (migration failure).
-- ─────────────────────────────────────────────────────────────────────────────
SELECT COUNT(*) AS findings_linked_to_bs_wc
FROM wet_check_findings
WHERE billing_sheet_id IN (
  SELECT id FROM billing_sheets WHERE billing_number LIKE 'BS-WC-%'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- QUERY 3: invoice_items linked to BS-WC billing sheets
-- What it tells ops: how many invoice line items still reference a BS-WC
-- billing_sheet_id. Pre-migration: shows invoice items to be re-keyed to
-- wet_check_billing_id. Post-migration: should be 0 if all rows succeeded.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT COUNT(*) AS invoice_items_linked_to_bs_wc
FROM invoice_items
WHERE billing_sheet_id IN (
  SELECT id FROM billing_sheets WHERE billing_number LIKE 'BS-WC-%'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- QUERY 4: wet_check_billings total count
-- What it tells ops: the total number of rows in the wet_check_billings table.
-- Pre-migration: baseline count (may be 0 if table is empty, or N if some rows
-- were created by other means). Post-migration: should equal
--   (pre-migration wcb count) + (number of BS-WC rows successfully migrated).
-- ─────────────────────────────────────────────────────────────────────────────
SELECT COUNT(*) AS wcb_total_count
FROM wet_check_billings;

-- ─────────────────────────────────────────────────────────────────────────────
-- QUERY 5: Dangling FK checks (post-migration only)
-- What it tells ops: are there any wet_check_findings or invoice_items rows
-- whose billing_sheet_id references a billing_sheets row that no longer exists?
-- Post-migration: both counts should be 0. Non-zero values indicate a FK
-- integrity problem introduced by the migration.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  'wet_check_findings'   AS table_name,
  COUNT(*)               AS dangling_billing_sheet_id_refs
FROM wet_check_findings
WHERE billing_sheet_id IS NOT NULL
  AND billing_sheet_id NOT IN (SELECT id FROM billing_sheets)

UNION ALL

SELECT
  'invoice_items'        AS table_name,
  COUNT(*)               AS dangling_billing_sheet_id_refs
FROM invoice_items
WHERE billing_sheet_id IS NOT NULL
  AND billing_sheet_id NOT IN (SELECT id FROM billing_sheets);

-- ─────────────────────────────────────────────────────────────────────────────
-- QUERY 6: Per-status breakdown of remaining BS-WC rows (useful on partial runs)
-- What it tells ops: if some rows failed to migrate, this shows which statuses
-- they were in so ops can decide whether to retry or handle manually.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  status,
  COUNT(*) AS count
FROM billing_sheets
WHERE billing_number LIKE 'BS-WC-%'
GROUP BY status
ORDER BY status;

-- ─────────────────────────────────────────────────────────────────────────────
-- QUERY 7: Migration checkpoint state
-- What it tells ops: the contents of the bsWcMigration.done and
-- bsWcMigration.failed checkpoints persisted by the script. Useful for
-- diagnosing a partial run or verifying idempotency before a re-run.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  key,
  CASE
    WHEN key = 'bsWcMigration.failedDetails' THEN LEFT(value, 500) || '...(truncated)'
    ELSE value
  END AS value,
  updated_at
FROM app_settings
WHERE key IN ('bsWcMigration.done', 'bsWcMigration.failed', 'bsWcMigration.failedDetails')
ORDER BY key;

-- ─────────────────────────────────────────────────────────────────────────────
-- QUERY 8: Sample of migrated wet_check_billings rows (post-migration)
-- What it tells ops: a spot-check of the 20 most recently created WCB rows so
-- ops can verify billing numbers follow the WC-YYYY-NNNN format, statuses look
-- correct, and wetCheckId links are populated.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  id,
  billing_number,
  customer_name,
  wet_check_id,
  status,
  total_hours,
  total_amount,
  invoice_id,
  created_at
FROM wet_check_billings
ORDER BY id DESC
LIMIT 20;
