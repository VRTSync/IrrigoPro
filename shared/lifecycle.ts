// Slice 10a — Estimates Lifecycle
// Single canonical lifecycle bucket computed server-side from the
// existing (status, internalStatus, estimateDate) tuple. The customer-
// facing `status` enum and the internal review track `internalStatus`
// stay unchanged; this module just maps the two together (plus a 30-day
// expiration window) into one bucket the UI can switch on.

export const LIFECYCLE_STATUSES = [
  "draft",
  "pending_review",
  "sent",
  "approved",
  "rejected",
  "expired",
] as const;

export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

// Estimates with `internalStatus = sent_to_customer` and
// `status = pending` flip from `sent` → `expired` once the
// `estimateDate` is older than this many days. Boundary is inclusive at
// the lower end: exactly 30 days old still counts as `sent`.
export const ESTIMATE_EXPIRATION_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type EstimateLifecycleInput = {
  status?: string | null;
  internalStatus?: string | null;
  estimateDate?: Date | string | null;
};

export function computeLifecycleStatus(
  estimate: EstimateLifecycleInput,
  now: Date = new Date(),
): LifecycleStatus {
  const status = estimate.status ?? "";
  const internalStatus = estimate.internalStatus ?? "";

  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";

  if (internalStatus === "draft") return "draft";

  if (internalStatus === "sent_to_customer" && status === "pending") {
    const ed = estimate.estimateDate;
    if (ed) {
      const sent = ed instanceof Date ? ed : new Date(ed);
      if (!Number.isNaN(sent.getTime())) {
        const ageMs = now.getTime() - sent.getTime();
        const ageDays = ageMs / MS_PER_DAY;
        if (ageDays > ESTIMATE_EXPIRATION_DAYS) return "expired";
      }
    }
    return "sent";
  }

  return "pending_review";
}
