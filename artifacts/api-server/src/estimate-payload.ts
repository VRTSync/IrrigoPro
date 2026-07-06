import type { InsertEstimate, InsertEstimateItem } from "@workspace/db";
import { money } from "./lib/money";

// Input shape accepted by `processEstimatePayload`. Mirrors the body of
// POST /api/estimates and is also used by the Wet Check conversion path so
// both flows compute pricing identically.
export interface EstimateLineInput {
  description?: string | null;
  // Null for inspection findings that have no catalog part assigned yet.
  // The server persists null and the DB column is a nullable FK.
  partId: number | null;
  partName?: string | null;
  partPrice?: string | number | null;
  laborHours?: string | number | null;
  quantity?: number;
  totalPrice?: string | number | null;
  sortOrder?: number;
}

export interface EstimatePayloadInput {
  // Omit the auto-computed totals AND `laborRate`/`estimateDate` so callers
  // can pass them as string|number / Date|string. The function normalises
  // both before persistence.
  estimate: Omit<InsertEstimate, "partsSubtotal" | "laborSubtotal" | "totalAmount" | "laborRate" | "estimateDate" | "totalLaborHours"> & {
    estimateDate?: Date | string | null;
    laborRate: string | number;
    // Task #657 — Labor entry is flat-only for new/edited estimates. The
    // field is still accepted on the input shape for back-compat with any
    // legacy clients, but its value is ignored — `processEstimatePayload`
    // always forces `flat`.
    laborMode?: "flat" | "per_part" | null;
    totalLaborHours?: string | number | null;
  };
  items: EstimateLineInput[];
}

export interface EstimatePayloadOutput {
  estimate: InsertEstimate;
  items: InsertEstimateItem[];
}

// Convention: `laborHours` on an `EstimateLineInput` is **per-unit** hours
// (what the user enters in the form: "0.5 hours per part"). This function
// is the single boundary where per-unit input is converted to the per-line
// total stored on the estimate item (`laborHours * quantity`). All
// downstream readers — storage recompute, email renderer, wet-check append,
// detail modal — assume the stored value is the per-line total. Task #228:
// previously this multiplication was missing, so any line with quantity > 1
// undercounted labor by a factor of `quantity` whenever a non-wizard caller
// (e.g. the wet-check conversion engine) submitted per-unit hours.
export function processEstimatePayload(input: EstimatePayloadInput): EstimatePayloadOutput {
  // Task #657 — Labor is flat-only on the write path. Per-line laborHours
  // are always normalized to 0; the estimate's `totalLaborHours` field is
  // the single source of truth for `laborSubtotal`. Any incoming
  // `laborMode` value is ignored — the persisted column is forced to
  // 'flat' so reads and writes can't drift.
  const laborMode: "flat" = "flat";

  const items: InsertEstimateItem[] = input.items.map((item, idx) => {
    const quantity = item.quantity ?? 1;
    const partPrice = money(item.partPrice ?? 0);
    const totalPrice = item.totalPrice !== undefined && item.totalPrice !== null
      ? money(item.totalPrice)
      : partPrice * quantity;
    return {
      description: item.description ?? "",
      partId: item.partId,
      partName: item.partName ?? null,
      partPrice: partPrice.toFixed(2),
      quantity,
      // Task #657 — flat-only: per-row labor is always zero on disk.
      laborHours: "0.00",
      totalPrice: totalPrice.toFixed(2),
      sortOrder: item.sortOrder ?? idx,
    } as InsertEstimateItem;
  });

  let partsSubtotal = 0;
  for (const item of items) {
    partsSubtotal += money(item.totalPrice);
  }

  const laborRate = parseFloat(String(input.estimate.laborRate));
  const totalLaborHours = parseFloat(String(input.estimate.totalLaborHours ?? 0)) || 0;
  const laborSubtotal = totalLaborHours * laborRate;
  const totalAmount = partsSubtotal + laborSubtotal;

  // Default the internal review track to "pending_approval" so callers
  // (POST /api/estimates and the wet-check conversion engine) consistently
  // route every new estimate through the manager review queue.
  const internalStatus =
    (input.estimate as { internalStatus?: string | null }).internalStatus ?? "pending_approval";

  const estimate: InsertEstimate = {
    ...input.estimate,
    internalStatus,
    estimateDate: input.estimate.estimateDate
      ? new Date(input.estimate.estimateDate as string | number | Date)
      : new Date(),
    laborMode,
    totalLaborHours: totalLaborHours.toFixed(2),
    partsSubtotal: partsSubtotal.toFixed(2),
    laborSubtotal: laborSubtotal.toFixed(2),
    totalAmount: totalAmount.toFixed(2),
    laborRate: String(input.estimate.laborRate),
  } as InsertEstimate;

  return { estimate, items };
}

// Documented fallback when a customer record has no master labor rate. The
// POST and PUT /api/estimates handlers, the wet-check conversion engine, and
// the labor-rate audit all share this constant so they can never drift.
export const DEFAULT_LABOR_RATE = "45.00";

// Authoritative create-time labor rate for a new estimate: always the
// customer's master rate, falling back to DEFAULT_LABOR_RATE when the
// customer has no rate on file. Encapsulating this in a tiny pure helper
// lets the route handler AND tests share the same single source of truth.
export function resolveCreateLaborRate(
  customerLaborRate: string | number | null | undefined,
): string {
  if (customerLaborRate === null || customerLaborRate === undefined || customerLaborRate === "") {
    return DEFAULT_LABOR_RATE;
  }
  return String(customerLaborRate);
}

// Authoritative update-time labor rate for an existing estimate.
//   - If the customer was swapped, the new customer's master rate wins
//     (DEFAULT_LABOR_RATE when null), so the stored rate tracks the new
//     customer immediately.
//   - If the customer is unchanged, the originally stamped rate is preserved
//     regardless of what the client sent. We use appliedLaborRate ?? laborRate
//     so legacy records where the two diverged stay in sync with the read-time
//     totals computed by storage.getEstimate.
export function resolvePutLaborRate(opts: {
  customerChanged: boolean;
  newCustomerLaborRate?: string | number | null;
  existingAppliedLaborRate?: string | number | null;
  existingLaborRate: string | number;
}): string {
  if (opts.customerChanged) {
    return resolveCreateLaborRate(opts.newCustomerLaborRate);
  }
  const snapshot = opts.existingAppliedLaborRate ?? opts.existingLaborRate;
  return String(snapshot);
}
