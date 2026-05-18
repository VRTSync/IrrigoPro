// Task #683 — Estimate Command Center summary shape.
// Returned by GET /api/estimates/summary. Consumed by the company
// admin Estimate Command Center page (KPI tiles + attention strip).

export type EstimateLifecycleBucket =
  | "draft"
  | "pending_review"
  | "sent"
  | "approved"
  | "rejected"
  | "expired";

export type EstimateAttentionReason =
  | "expiring_soon"
  | "stuck_in_review"
  | "high_value_silent";

export interface EstimateAttentionRow {
  estimateId: number;
  estimateNumber: string | null;
  customerName: string | null;
  totalAmount: number;
  reason: EstimateAttentionReason;
  sinceDays: number;
  lifecycle: EstimateLifecycleBucket;
}

export interface EstimateBucketCount {
  count: number;
  totalAmount: number;
}

export interface EstimateSummary {
  byLifecycle: Record<EstimateLifecycleBucket, EstimateBucketCount>;
  windows: {
    expiringNext7Days: EstimateBucketCount;
    stuckInReviewOver3Days: EstimateBucketCount;
    approvedLast30Days: EstimateBucketCount;
    openPipeline: EstimateBucketCount;
    awaitingReview: EstimateBucketCount;
    awaitingCustomer: EstimateBucketCount;
  };
  attention: EstimateAttentionRow[];
  winRate90d: number;
}
