import { catalogLaborHours } from "@workspace/shared";
import { resolveIssueTypeKey } from "../seeds/issue-type-configs";
import { computeWetCheckBillingPartsSubtotal } from "../wet-check-billing-view";

export type LaborCatalog = Map<string, string | null>;

export function buildLaborCatalog(
  configs: Array<{ issueType: string; defaultLaborHours: string | null }>,
): LaborCatalog {
  return new Map(configs.map(c => [resolveIssueTypeKey(c.issueType), c.defaultLaborHours]));
}

export function catalogLaborHoursForFinding(
  f: { issueType: string; quantity: number | null },
  catalog: LaborCatalog,
): number {
  const perUnit = catalog.get(resolveIssueTypeKey(f.issueType));
  return perUnit == null ? 0 : catalogLaborHours(perUnit, f.quantity);
}

export function computeAutoZoneRepairLaborHours(
  findings: Array<{ issueType: string; quantity: number | null }>,
  catalog: LaborCatalog,
): number {
  return findings.reduce((sum, f) => sum + catalogLaborHoursForFinding(f, catalog), 0);
}

export function canAutoBillFinding(
  f: { partId: number | null; noPartNeeded: boolean | null; issueType: string | null },
  laborOnlyTypes: ReadonlySet<string>,
): boolean {
  return f.partId != null || Boolean(f.noPartNeeded) || laborOnlyTypes.has(f.issueType ?? "");
}

export type RepairTotals = {
  partsSubtotal: number;
  laborHours: number;
  laborSubtotal: number;
  grandTotal: number;
};

export function computeRepairedInFieldTotals(input: {
  billed: Array<{ zoneRecordId: number; noPartNeeded: boolean; partPrice: string | null; quantity: number | null }>;
  zones: Array<{ id: number; repairLaborHours: string | null; repairLaborManuallySet: boolean }>;
  zoneFindings: Map<number, Array<{ issueType: string; quantity: number | null }>>;
  catalog: LaborCatalog;
  wcBaseLaborHours: number;
  laborRate: number;
}): RepairTotals {
  const zoneById = new Map(input.zones.map(z => [z.id, z]));
  let laborHours = input.wcBaseLaborHours;
  for (const id of new Set(input.billed.map(f => f.zoneRecordId))) {
    const zone = zoneById.get(id);
    if (!zone) throw new Error(`Billed wet-check zone ${id} not found`);
    laborHours += zone.repairLaborManuallySet
      ? parseFloat(String(zone.repairLaborHours ?? "0")) || 0
      : computeAutoZoneRepairLaborHours(input.zoneFindings.get(id) ?? [], input.catalog);
  }
  const partsSubtotal = computeWetCheckBillingPartsSubtotal(
    input.billed.map(f => ({ ...f, quantity: f.quantity ?? 0 })),
  );
  const laborSubtotal = laborHours * input.laborRate;
  return { partsSubtotal, laborHours, laborSubtotal, grandTotal: partsSubtotal + laborSubtotal };
}