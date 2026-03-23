-- Migration: Auto-approve billing sheets created by irrigation managers
-- Task #30: Irrigation manager billing sheets auto-approve
-- Updates existing billing sheets in draft or submitted status to approved
-- where the creator (technician) has the role of irrigation_manager

UPDATE billing_sheets
SET status = 'approved',
    updated_at = NOW()
WHERE status IN ('draft', 'submitted')
  AND technician_id IN (
    SELECT id FROM users WHERE role = 'irrigation_manager'
  );
