export const NOTIFICATION_TYPES = {
  WORK_ORDER_ASSIGNED: "work_order_assigned",
  WORK_ORDER_COMPLETED: "work_order_completed",
  ESTIMATE_PENDING_APPROVAL: "estimate_pending_approval",
  BUDGET_WARNING: "budget_warning",
  BUDGET_EXCEEDED: "budget_exceeded",
} as const;

export type NotificationType =
  (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

export const BUDGET_NOTIFICATION_TYPES: readonly NotificationType[] = [
  NOTIFICATION_TYPES.BUDGET_WARNING,
  NOTIFICATION_TYPES.BUDGET_EXCEEDED,
] as const;
