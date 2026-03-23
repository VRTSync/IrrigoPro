-- Migration: Promote billing_manager-created billing sheets to 'approved'
-- Task #32: Billing manager billing sheets auto-approve
--
-- Background: Before Task #32, billing_manager-created billing sheets received
-- 'draft' status. This migration promotes any existing ones to 'approved' so
-- they appear in the billing queue immediately, matching the behavior for
-- irrigation_manager (Task #30).
--
-- Run result (2026-03-23): UPDATE 0 — no matching rows found in the database.
-- All existing billing_manager billing sheets were already in 'completed' or
-- 'billed' status and did not need promotion.

UPDATE billing_sheets bs
SET status = 'approved'
FROM users u
WHERE bs.technician_id = u.id
  AND u.role = 'billing_manager'
  AND bs.status IN ('draft', 'submitted');
