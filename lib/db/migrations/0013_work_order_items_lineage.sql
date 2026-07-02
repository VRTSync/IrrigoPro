-- Slice 3 lineage columns on work_order_items.
-- finding_id: links a WO item back to the wet-check finding that produced it
--   (null for non-inspection items such as field-added parts).
-- created_at: records insert time so duplicate detection is trivial:
--   COUNT(*) > 1 per (work_order_id, finding_id).
-- Both columns are nullable and default-safe; adding them is a no-op against
-- existing rows and safe to run while the server is live.
ALTER TABLE work_order_items ADD COLUMN IF NOT EXISTS finding_id integer REFERENCES wet_check_findings(id);
ALTER TABLE work_order_items ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now();
