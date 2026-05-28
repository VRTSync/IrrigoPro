-- Q3: Findings whose issueType does not match any catalog row for the
-- parent company (Hypothesis 2 — key-mismatch path).
-- An empty result set rules out Hypothesis 2 for the queried database.
-- A non-empty result set identifies the exact strings that need catalog rows
-- added (or finding records corrected) before a backfill can run cleanly.
SELECT
  f.issue_type,
  wc.company_id,
  co.name                         AS company_name,
  COUNT(*)                        AS finding_count,
  COUNT(DISTINCT wcb.id)          AS affected_wcb_count
FROM wet_check_findings f
JOIN wet_checks       wc  ON wc.id  = f.wet_check_id
JOIN companies        co  ON co.id  = wc.company_id
LEFT JOIN wet_check_billings wcb
  ON wcb.id = f.wet_check_billing_id
WHERE NOT EXISTS (
  SELECT 1
  FROM issue_type_configs itc
  WHERE itc.company_id = wc.company_id
    AND itc.issue_type  = f.issue_type
)
GROUP BY f.issue_type, wc.company_id, co.name
ORDER BY finding_count DESC;
