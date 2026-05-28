-- Q4: Companies with zero issue_type_configs rows (Hypothesis 1 — empty catalog).
-- Any company returned here will produce $0.00 labor for every auto-computed zone
-- regardless of issueType. The Slice 2 fix must add a startup guard that
-- prevents zone-labor compute when no catalog rows exist, surfacing a clear
-- error instead of silently writing 0.00.
SELECT
  c.id                            AS company_id,
  c.name                          AS company_name,
  c.is_active,
  c.created_at::date              AS company_created,
  (SELECT COUNT(*)
   FROM wet_checks wc
   WHERE wc.company_id = c.id)   AS wet_check_count,
  (SELECT COUNT(*)
   FROM wet_check_billings wcb
   JOIN wet_checks wc2 ON wc2.id = wcb.wet_check_id
   WHERE wc2.company_id = c.id)  AS wcb_count
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM issue_type_configs itc WHERE itc.company_id = c.id
)
ORDER BY c.id;
