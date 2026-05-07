import type { InsertEstimate, InsertEstimateItem } from "@workspace/db";

// Input shape accepted by `processEstimatePayload`. Mirrors the body of
// POST /api/estimates and is also used by the Wet Check conversion path so
// both flows compute pricing identically.
export interface EstimateLineInput {
  description?: string | null;
  partId: number;
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
    // Task #396 — labor entry mode. 'flat' uses totalLaborHours; 'per_part'
    // sums per-line laborHours.
    laborMode?: "flat" | "per_part" | null;
    totalLaborHours?: string | number | null;
  };
  items: EstimateLineInput[];
}

export interface EstimatePayloadOutput {
  estimate: InsertEstimate;
  items: InsertEstimateItem[];
}

// Convention: `laborHours` on an estimate item is the per-line total
// (already multiplied by quantity). The /api/estimates handler, the email
// renderer, the Wet Check conversion engine, and the storage recompute all
// share this convention.
export function processEstimatePayload(input: EstimatePayloadInput): EstimatePayloadOutput {
  // Task #396 — Labor mode. 'flat' is the new default; per-line laborHours are
  // forced to 0 and the estimate's totalLaborHours field is the source of
  // truth for laborSubtotal. 'per_part' preserves today's behavior of summing
  // per-line laborHours.
  const laborMode: "flat" | "per_part" =
    input.estimate.laborMode === "per_part" ? "per_part" : "flat";

  const items: InsertEstimateItem[] = input.items.map((item, idx) => {
    const quantity = item.quantity ?? 1;
    const partPrice = parseFloat(String(item.partPrice ?? 0));
    const rawLaborHours = parseFloat(String(item.laborHours ?? 0)) || 0;
    // Flat mode normalizes per-line labor to 0 — totals come from totalLaborHours.
    const laborHours = laborMode === "flat" ? 0 : rawLaborHours;
    const totalPrice = item.totalPrice !== undefined && item.totalPrice !== null
      ? parseFloat(String(item.totalPrice))
      : partPrice * quantity;
    return {
      description: item.description ?? "",
      partId: item.partId,
      partName: item.partName ?? null,
      partPrice: String(partPrice),
      quantity,
      laborHours: laborHours.toFixed(2),
      totalPrice: totalPrice.toFixed(2),
      sortOrder: item.sortOrder ?? idx,
    } as InsertEstimateItem;
  });

  let partsSubtotal = 0;
  let perPartLaborHoursSum = 0;
  for (const item of items) {
    partsSubtotal += parseFloat(String(item.totalPrice));
    perPartLaborHoursSum += parseFloat(String(item.laborHours));
  }

  const laborRate = parseFloat(String(input.estimate.laborRate));
  const flatHoursRaw = parseFloat(String(input.estimate.totalLaborHours ?? 0)) || 0;
  const totalLaborHours = laborMode === "flat" ? flatHoursRaw : perPartLaborHoursSum;
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
