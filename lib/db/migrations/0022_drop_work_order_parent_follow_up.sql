-- Migration 0022: drop the deferred-items follow-up work order link.
-- Reverses 0019_work_order_parent_follow_up.sql.
--
-- Slice 3, the last step of removing the deferred-items follow-up work order.
-- The completion handler that diffed an approved estimate's line items against
-- the completed work order's items and auto-created a follow-up work order for
-- whatever did not match is gone, along with its storage methods, routes and UI
-- surfaces. That diff could not distinguish work that was not done from a part
-- that was substituted, and substitution is the normal case, so completed and
-- billed tickets grew phantom follow-ups.
--
-- With no remaining reader or writer, the column and its partial unique index
-- come out. 0019 is deliberately left in place: this directory is a record of
-- how the database reached its current shape, and a drop is recorded as its own
-- forward migration rather than by rewriting history (same pattern as
-- 0018_document_controller_fk_drop_legacy.sql).
--
-- GATE — do not apply this to production until retire-followup-work-orders-v1
-- has been run and verified there. Dropping the column first strands the
-- phantom `pending` work orders in a customer's active queue with no lineage to
-- explain where they came from. See
-- docs/retire-followup-work-orders-v1-production-run.md.
--
-- Not dropped here, and not to be confused with the column below:
--   * work_orders.origin_wet_check_id          — live lineage tag (0011)
--   * work_orders_estimate_unique_idx          — still enforced
--   * work_orders_status_scheduled_idx         — still enforced

-- Index first: dropping the column would take it with it, but being explicit
-- keeps the reversal readable and makes a partial re-run safe.
DROP INDEX IF EXISTS work_orders_follow_up_unique_idx;

ALTER TABLE work_orders DROP COLUMN IF EXISTS parent_work_order_id;
