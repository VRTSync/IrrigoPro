import { humanizeIssueType } from "./inspection-issue-labels.js";

// ── Input shapes ─────────────────────────────────────────────────────────────

/** Minimal finding fields required to build inspection estimate line items. */
export interface FindingForEstimate {
  zoneRecordId: number;
  partId: number | null;
  partName: string | null;
  partPrice: string | null;
  quantity: number;
  laborHours: string;
  issueType: string;
  notes: string | null;
}

/** Zone context keyed by zone-record id. */
export interface ZoneForEstimate {
  controllerLetter: string;
  zoneNumber: number;
}

// ── Output shape ─────────────────────────────────────────────────────────────

/** A single merged estimate line item (without estimateId — caller adds it). */
export interface EstimateItemDraft {
  description: string;
  partId: number | null;
  partName: string;
  partPrice: string;
  laborHours: string;
  quantity: number;
  totalPrice: string;
  sortOrder: number;
  controllerLetter: string | null;
  zoneNumber: number | null;
  issueType: string | null;
}

export interface BuildInspectionEstimateItemsResult {
  items: EstimateItemDraft[];
  totalLaborHours: number;
}

// ── Core helper ───────────────────────────────────────────────────────────────

/**
 * Build merged estimate line items from a set of inspection wet-check findings.
 *
 * Inspection mode is documentation-first: every finding becomes a line item
 * regardless of whether a part was assigned.  Within a zone, findings with the
 * same (controllerLetter, zoneNumber, partId/partName, issueType) are merged
 * into one row (quantity + laborHours summed).  Items are sorted
 * controller → zone → partName for stable display order.
 *
 * Extracted from storage.ts#buildEstimateFromInspectionWetCheck so both the
 * live generation path and the backfill script share identical logic.
 */
export function buildInspectionEstimateItems(
  findings: FindingForEstimate[],
  zoneByRecordId: Map<number, ZoneForEstimate>,
): BuildInspectionEstimateItemsResult {
  const totalLaborHours = findings.reduce(
    (s, f) => s + (parseFloat(String(f.laborHours ?? "0")) || 0),
    0,
  );

  type MergedItem = {
    controllerLetter: string | null;
    zoneNumber: number | null;
    issueType: string | null;
    partId: number | null;
    partName: string;
    partPrice: number;
    quantity: number;
    laborHours: number;
    description: string;
  };

  // Merge key: pipe-separated (controllerLetter|zoneNumber|partId|partName|issueType)
  const mergeMap = new Map<string, MergedItem>();

  for (const f of findings) {
    const zone = zoneByRecordId.get(f.zoneRecordId);
    const controllerLetter = zone?.controllerLetter ?? null;
    const zoneNumber = zone?.zoneNumber ?? null;
    // Use catalog part name when present; humanize the issue type for
    // labor-only / no-part findings so raw enum strings never reach the UI.
    const resolvedPartName = f.partName ?? humanizeIssueType(f.issueType);
    const partPrice = parseFloat(String(f.partPrice ?? "0")) || 0;
    const qty = f.quantity ?? 1;
    const labor = parseFloat(String(f.laborHours ?? "0")) || 0;

    const key = `${controllerLetter ?? ""}|${zoneNumber ?? ""}|${f.partId ?? ""}|${resolvedPartName}|${f.issueType}`;
    const existing = mergeMap.get(key);
    if (existing) {
      existing.quantity += qty;
      existing.laborHours += labor;
    } else {
      mergeMap.set(key, {
        controllerLetter,
        zoneNumber,
        issueType: f.issueType,
        partId: f.partId,
        partName: resolvedPartName,
        partPrice,
        quantity: qty,
        laborHours: labor,
        description: f.notes ?? resolvedPartName,
      });
    }
  }

  // Sort by controller → zone → partName for stable display order.
  const sortedItems = [...mergeMap.values()].sort((a, b) => {
    const cl = (a.controllerLetter ?? "").localeCompare(b.controllerLetter ?? "");
    if (cl !== 0) return cl;
    return (a.zoneNumber ?? 0) - (b.zoneNumber ?? 0);
  });

  const items: EstimateItemDraft[] = sortedItems.map((item, idx) => ({
    description: item.description,
    partId: item.partId,
    partName: item.partName,
    partPrice: item.partPrice.toFixed(2),
    laborHours: item.laborHours.toFixed(2),
    quantity: item.quantity,
    totalPrice: (item.partPrice * item.quantity).toFixed(2),
    sortOrder: idx,
    controllerLetter: item.controllerLetter,
    zoneNumber: item.zoneNumber,
    issueType: item.issueType,
  }));

  return { items, totalLaborHours };
}
