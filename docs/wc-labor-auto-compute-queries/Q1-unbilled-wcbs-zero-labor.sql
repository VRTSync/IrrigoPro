-- Q1: Unbilled WCBs with zero repair-labor subtotal and non-zero parts
-- "Unbilled" = invoice_id IS NULL and status != 'billed'
-- These are the highest-urgency rows: labor can still be corrected before
-- an invoice is cut, but only after the Slice 2 fix + Slice 3 backfill run.
SELECT
  wcb.id                          AS wcb_id,
  wcb.billing_number,
  wcb.customer_name,
  wcb.status,
  wcb.parts_subtotal,
  wcb.labor_subtotal,
  wcb.total_hours,
  wcb.total_amount,
  wcb.created_at::date            AS created_date,
  wc.company_id,
  co.name                         AS company_name
FROM wet_check_billings wcb
JOIN wet_checks       wc  ON wc.id  = wcb.wet_check_id
JOIN companies        co  ON co.id  = wc.company_id
WHERE wcb.invoice_id IS NULL
  AND wcb.status != 'billed'
  AND CAST(wcb.labor_subtotal  AS numeric) = 0
  AND CAST(wcb.parts_subtotal  AS numeric) > 0
ORDER BY wcb.created_at DESC;
