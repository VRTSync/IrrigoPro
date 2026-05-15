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
  // Task #642 — canonical lifecycle column. Preferred over (status,
  // internalStatus) when set. `null`/missing means a pre-migration row.
  lifecycle?: string | null;
};

// Task #642 — write-time derivation of the lifecycle column from the
// two legacy axes. Returns only the five *stored* lifecycle values;
// `expired` is intentionally excluded because it's a read-time view
// over (lifecycle='sent', estimateDate > 30 days). Every write path
// that mutates `status` or `internalStatus` must also pass the result
// of this helper through as `lifecycle` so the column stays in sync
// with the legacy axes during the dual-write window.
export type StoredLifecycleStatus = Exclude<LifecycleStatus, "expired">;

export function deriveLifecycleForWrite(opts: {
  status?: string | null;
  internalStatus?: string | null;
}): StoredLifecycleStatus {
  const status = opts.status ?? "";
  const internalStatus = opts.internalStatus ?? "";

  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  if (internalStatus === "draft") return "draft";
  if (internalStatus === "sent_to_customer" && status === "pending") return "sent";
  return "pending_review";
}

const STORED_LIFECYCLES = new Set<string>([
  "draft",
  "pending_review",
  "sent",
  "approved",
  "rejected",
]);

export function computeLifecycleStatus(
  estimate: EstimateLifecycleInput,
  now: Date = new Date(),
): LifecycleStatus {
  // Task #642 — Prefer the stored lifecycle column when present.
  // Legacy (status, internalStatus) is consulted only when the column
  // is missing/invalid (e.g. backfill not yet run, or an in-memory
  // fixture in a test). `sent` always re-checks the expiry window so
  // a row can flip into `expired` without a write.
  const stored = (estimate.lifecycle ?? "") as string;
  const useStored = STORED_LIFECYCLES.has(stored);
  const base: StoredLifecycleStatus = useStored
    ? (stored as StoredLifecycleStatus)
    : deriveLifecycleForWrite(estimate);

  if (base === "sent") {
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

  return base;
}

// Slice 10c — shared tint + label map so the board column headers and the
// list status badges stay visually in sync. Tailwind class strings only;
// the consumers compose them as needed.
export const LIFECYCLE_TINTS: Record<
  LifecycleStatus,
  { label: string; bg: string; text: string; border: string }
> = {
  draft: {
    label: "Draft",
    bg: "bg-gray-100",
    text: "text-gray-700",
    border: "border-gray-200",
  },
  pending_review: {
    label: "Pending review",
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
  },
  sent: {
    label: "Sent",
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-200",
  },
  approved: {
    label: "Approved",
    bg: "bg-green-50",
    text: "text-green-700",
    border: "border-green-200",
  },
  rejected: {
    label: "Rejected",
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
  },
  expired: {
    label: "Expired",
    bg: "bg-gray-100",
    text: "text-gray-500",
    border: "border-gray-200",
  },
};

// Lifecycle order used for list "Status" sorting.
export const LIFECYCLE_ORDER: Record<LifecycleStatus, number> = {
  draft: 0,
  pending_review: 1,
  sent: 2,
  approved: 3,
  rejected: 4,
  expired: 5,
};
