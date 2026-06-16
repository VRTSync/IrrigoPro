/**
 * SnapshotQuickViewModal — compact glance view opened from All / Approved tab rows.
 *
 * Reuses WetCheckBillingViewModal directly (no editor logic is duplicated here).
 * Edit gating is state-driven inside WetCheckBillingViewModal:
 *   - Pre-approval (submitted / pending_manager_review): rate & hours editable;
 *     the approve action does NOT appear in this modal — full approval lives in
 *     the Slice 3 review surface (/manager/wet-checks/:id).
 *   - Approved-not-invoiced: fully editable.
 *   - Invoiced / billed: read-only (EditAffordancesPanel is suppressed).
 */
export { WetCheckBillingViewModal as SnapshotQuickViewModal } from "./wet-check-billing-view-modal";
