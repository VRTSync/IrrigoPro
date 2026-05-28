-- Q2: Already-invoiced WCBs with zero repair-labor subtotal and non-zero parts
-- These are terminal: an invoice has been cut with under-reported labor.
-- Slice 3 backfill cannot fix them; a correcting credit memo is needed
-- for each row here. Surface for accounting review.
SELECT
  wcb.id                          AS wcb_id,
  wcb.billing_number,
  wcb.customer_name,
  wcb.status,
  wcb.parts_subtotal,
  wcb.labor_subtotal,
  wcb.total_hours,
  wcb.total_amount,
  wcb.invoice_id,
  wcb.billed_at::date             AS billed_date,
  wc.company_id,
  co.name                         AS company_name
FROM wet_check_billings wcb
JOIN wet_checks       wc  ON wc.id  = wcb.wet_check_id
JOIN companies        co  ON co.id  = wc.company_id
WHERE (wcb.invoice_id IS NOT NULL OR wcb.status = 'billed')
  AND CAST(wcb.labor_subtotal  AS numeric) = 0
  AND CAST(wcb.parts_subtotal  AS numeric) > 0
ORDER BY wcb.billed_at DESC;
