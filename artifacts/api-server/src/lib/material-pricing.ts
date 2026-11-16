import { computeCustomerPrice, isMaterialMarkupEligible, markupScheduleParams } from "@workspace/shared";
import type { Part } from "@workspace/db";
import * as schedules from "../storage/markup-schedules";

export async function resolveMaterialSchedule(companyId: number, customerId?: number | null) {
  const active = await schedules.getActiveMarkupSchedule(companyId);
  // Resolve the customer even with no default to enforce ownership, not silently ignore it.
  const override = customerId ? await schedules.getCustomerMarkupOverride(customerId, companyId) : null;
  if (!active) return null;
  return override ? schedules.getMarkupSchedule(override.scheduleId, companyId) : active;
}
export function materialUnitPrice(part: { cost?: string | number | null; category: string; price: string | number }, context?: schedules.MarkupScheduleContext | null) {
  return context && isMaterialMarkupEligible(part) ? computeCustomerPrice(Number(part.cost), markupScheduleParams(context)) : Number(part.price);
}

export type PricingLine = {
  id?: number | null; sourceItemId?: number | null; partId?: number | null;
  partPrice?: string | number; unitPrice?: string | number;
  quantity?: string | number;
};
export class MaterialPricingError extends Error { readonly status = 400; }
type PricingStore = {
  getPart(id: number): Promise<Part | undefined>;
};
/** Stored parent-scoped line IDs, not catalog IDs or client flags, establish a frozen price. */
export async function priceDocumentLines<T extends PricingLine>(
  items: T[], companyId: number, customerId: number | null | undefined,
  stored: readonly PricingLine[], store: PricingStore,
  field: "unitPrice" | "partPrice" = "unitPrice",
  validateSubmitted = false,
  loadSchedule = resolveMaterialSchedule,
): Promise<T[]> {
  if (!Number.isInteger(companyId) || companyId <= 0) throw new MaterialPricingError("Explicit company context is required for pricing");
  const context = await loadSchedule(companyId, customerId);
  const originals = new Map(stored.map(line => [line.id, line]));
  const seen = new Set<number>();
  const parts = new Map<number, Part>();
  const out: T[] = [];
  for (const line of items) {
    const id = Number(line.sourceItemId ?? line.id);
    const original = originals.get(id);
    let unit: number;
    const qty = Number(line.quantity ?? 0);
    if (!Number.isFinite(qty) || qty < 0) throw new MaterialPricingError("Invalid line quantity");
    if (original) {
      if (seen.has(id)) throw new MaterialPricingError("An existing line cannot be submitted more than once");
      seen.add(id);
      if (Number(line.partId ?? 0) !== Number(original.partId ?? 0)) throw new MaterialPricingError("Add a new line to change a catalog part");
      unit = Number(original[field] ?? (field === "unitPrice" ? original.partPrice : original.unitPrice));
    } else if (line.partId) {
      const partId = Number(line.partId);
      let part = parts.get(partId);
      if (!part) {
        part = await store.getPart(partId);
        if (!part || part.companyId !== companyId) throw new schedules.MarkupNotFound();
        parts.set(partId, part);
      }
      unit = materialUnitPrice(part, context);
      if (validateSubmitted && (!Number.isFinite(Number(line[field])) || Math.abs(Number(line[field]) - unit) > .005))
        throw new MaterialPricingError(`Catalog price for "${part.name}" changed. Refresh the part and try again.`);
    } else {
      unit = Number(line[field] ?? (field === "unitPrice" ? line.partPrice : line.unitPrice) ?? 0);
    }
    if (!Number.isFinite(unit) || unit < 0 || unit > 99999999.99) throw new MaterialPricingError("Invalid line price");
    out.push({ ...line, ...(original ? { sourceItemId: original.id } : {}), [field]: unit.toFixed(2), totalPrice: (unit * qty).toFixed(2) });
  }
  return out;
}
