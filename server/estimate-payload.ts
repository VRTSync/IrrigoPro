import type { InsertEstimate, InsertEstimateItem } from "@shared/schema";

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
  estimate: Omit<InsertEstimate, "partsSubtotal" | "laborSubtotal" | "totalAmount" | "laborRate" | "estimateDate"> & {
    estimateDate?: Date | string | null;
    laborRate: string | number;
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
  const items: InsertEstimateItem[] = input.items.map((item, idx) => {
    const quantity = item.quantity ?? 1;
    const partPrice = parseFloat(String(item.partPrice ?? 0));
    const laborHours = parseFloat(String(item.laborHours ?? 0));
    const totalPrice = item.totalPrice !== undefined && item.totalPrice !== null
      ? parseFloat(String(item.totalPrice))
      : partPrice * quantity;
    return {
      description: item.description ?? "",
      partId: item.partId,
      partName: item.partName ?? null,
      partPrice: String(partPrice),
      quantity,
      laborHours: String(laborHours),
      totalPrice: totalPrice.toFixed(2),
      sortOrder: item.sortOrder ?? idx,
    } as InsertEstimateItem;
  });

  let partsSubtotal = 0;
  let totalLaborHours = 0;
  for (const item of items) {
    partsSubtotal += parseFloat(String(item.totalPrice));
    totalLaborHours += parseFloat(String(item.laborHours));
  }

  const laborRate = parseFloat(String(input.estimate.laborRate));
  const laborSubtotal = totalLaborHours * laborRate;
  const totalAmount = partsSubtotal + laborSubtotal;

  const estimate: InsertEstimate = {
    ...input.estimate,
    estimateDate: input.estimate.estimateDate
      ? new Date(input.estimate.estimateDate as string | number | Date)
      : new Date(),
    partsSubtotal: partsSubtotal.toFixed(2),
    laborSubtotal: laborSubtotal.toFixed(2),
    totalAmount: totalAmount.toFixed(2),
    laborRate: String(input.estimate.laborRate),
  } as InsertEstimate;

  return { estimate, items };
}
