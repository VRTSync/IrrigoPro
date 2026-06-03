-- Task #1093 — Command Center Inline Edit Slice 1
-- Adds rate_mode column to billing_sheets, work_orders, and wet_check_billings.
-- 'normal' → customer.laborRate, 'emergency' → customer.emergencyLaborRate.
-- Default is 'normal' so existing rows are unchanged.

ALTER TABLE billing_sheets
  ADD COLUMN IF NOT EXISTS rate_mode TEXT NOT NULL DEFAULT 'normal'
  CHECK (rate_mode IN ('normal', 'emergency'));

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS rate_mode TEXT NOT NULL DEFAULT 'normal'
  CHECK (rate_mode IN ('normal', 'emergency'));

ALTER TABLE wet_check_billings
  ADD COLUMN IF NOT EXISTS rate_mode TEXT NOT NULL DEFAULT 'normal'
  CHECK (rate_mode IN ('normal', 'emergency'));
