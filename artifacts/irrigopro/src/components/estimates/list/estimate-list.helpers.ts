import { LIFECYCLE_ORDER, lifecycleOf as canonicalLifecycleOf, type LifecycleStatus } from "@/lib/lifecycle";
import type { Estimate } from "@workspace/db/schema";

export type SortField = "customer" | "amount" | "status" | "date";
export type SortDir = "asc" | "desc";

// Task #638 — re-exported from the canonical lifecycle helper so list
// code keeps its short import surface while staying in lockstep with
// the rest of the UI.
export function lifecycleOf(e: Estimate): LifecycleStatus {
  return canonicalLifecycleOf(e);
}

export function sortEstimates(
  estimates: Estimate[],
  field: SortField,
  dir: SortDir,
): Estimate[] {
  const arr = [...estimates];
  arr.sort((a, b) => {
    let cmp = 0;
    switch (field) {
      case "customer":
        cmp = a.customerName.localeCompare(b.customerName);
        break;
      case "amount":
        cmp = parseFloat(a.totalAmount) - parseFloat(b.totalAmount);
        break;
      case "status":
        cmp = LIFECYCLE_ORDER[lifecycleOf(a)] - LIFECYCLE_ORDER[lifecycleOf(b)];
        break;
      case "date":
      default: {
        const da = new Date(a.estimateDate ?? a.createdAt).getTime();
        const db = new Date(b.estimateDate ?? b.createdAt).getTime();
        cmp = da - db;
        break;
      }
    }
    return dir === "asc" ? cmp : -cmp;
  });
  return arr;
}

export function nextSort(
  current: { field: SortField; dir: SortDir },
  clicked: SortField,
): { field: SortField; dir: SortDir } {
  if (clicked === current.field) {
    return { field: clicked, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { field: clicked, dir: clicked === "date" ? "desc" : "asc" };
}

export function isResendEnabled(lifecycle: LifecycleStatus): boolean {
  return lifecycle === "expired";
}
