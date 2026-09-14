export const NOTIFICATION_TYPES = {
  WORK_ORDER_ASSIGNED: "work_order_assigned",
  WORK_ORDER_COMPLETED: "work_order_completed",
  ESTIMATE_PENDING_APPROVAL: "estimate_pending_approval",
  // Task #2010 — tripwire raised when a customer approves a branch-less
  // estimate for a multi-branch customer via their emailed token link.
  // The approval is never refused (the customer cannot supply a branch
  // and blocking them over an internal field is not acceptable), so the
  // auto-created work order is flagged to its assigned irrigation
  // manager instead. The notification `type` column is free text, so
  // adding a member here needs no migration.
  WORK_ORDER_MISSING_BRANCH: "work_order_missing_branch",
  BUDGET_WARNING: "budget_warning",
  BUDGET_EXCEEDED: "budget_exceeded",
} as const;

export type NotificationType =
  (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

export const BUDGET_NOTIFICATION_TYPES: readonly NotificationType[] = [
  NOTIFICATION_TYPES.BUDGET_WARNING,
  NOTIFICATION_TYPES.BUDGET_EXCEEDED,
] as const;
