-- Task #1238: Manager Workspace Merge — Slice 1
-- Adds returned_for_correction_at to both billing_sheets and work_orders.
-- Set by the return-for-correction handlers; cleared when the tech
-- resubmits (status → submitted/pending_manager_review/completed for BSs,
-- status → pending_manager_review/work_completed for WOs).
-- Drives the "Waiting on tech" stage section in the merged Manager Workspace.

ALTER TABLE billing_sheets
  ADD COLUMN IF NOT EXISTS returned_for_correction_at TIMESTAMP;

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS returned_for_correction_at TIMESTAMP;
