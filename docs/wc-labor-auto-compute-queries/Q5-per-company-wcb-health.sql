-- Q5: Per-company WCB labor health percentages.
-- Shows total WCBs, how many have zero labor despite non-zero parts,
-- and what percentage that represents. Ranks worst companies first.
-- Use this to triage which companies need the most urgent attention after Slice 3.
SELECT
  wc.company_id,
  co.name                                                             AS company_name,
  COUNT(DISTINCT wcb.id)                                              AS total_wcbs,
  COUNT(DISTINCT CASE
    WHEN CAST(wcb.labor_subtotal AS numeric) = 0
     AND CAST(wcb.parts_subtotal AS numeric) > 0
    THEN wcb.id END)                                                  AS zero_labor_wcbs,
  ROUND(
    100.0 * COUNT(DISTINCT CASE
      WHEN CAST(wcb.labor_subtotal AS numeric) = 0
       AND CAST(wcb.parts_subtotal AS numeric) > 0
      THEN wcb.id END)
    / NULLIF(COUNT(DISTINCT wcb.id), 0),
    1
  )                                                                   AS pct_zero_labor,
  COUNT(DISTINCT CASE WHEN wcb.invoice_id IS NOT NULL THEN wcb.id END) AS invoiced_wcbs,
  COUNT(DISTINCT CASE
    WHEN wcb.invoice_id IS NOT NULL
     AND CAST(wcb.labor_subtotal AS numeric) = 0
     AND CAST(wcb.parts_subtotal AS numeric) > 0
    THEN wcb.id END)                                                  AS invoiced_zero_labor_wcbs
FROM wet_check_billings wcb
JOIN wet_checks       wc  ON wc.id  = wcb.wet_check_id
JOIN companies        co  ON co.id  = wc.company_id
GROUP BY wc.company_id, co.name
ORDER BY zero_labor_wcbs DESC, pct_zero_labor DESC;
