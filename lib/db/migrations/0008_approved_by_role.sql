-- Slice 2: Stamp 'billed without manager review'
-- Adds approved_by_role to work_orders, billing_sheets, and wet_check_billings
-- so the manager queue can detect when a billing-side actor (billing_manager
-- or company_admin) approved a ticket without the irrigation manager ever
-- reviewing it. Legacy rows remain NULL and are treated as "unknown" (not
-- flagged).

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS approved_by_role text;

ALTER TABLE billing_sheets
  ADD COLUMN IF NOT EXISTS approved_by_role text;

ALTER TABLE wet_check_billings
  ADD COLUMN IF NOT EXISTS approved_by_role text;
