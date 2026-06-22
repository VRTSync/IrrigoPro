/**
 * Client-side mirror of the zone-grouping logic in
 * `artifacts/api-server/src/estimate-pdf-html.ts`.
 *
 * Kept in sync by design: same key structure (controllerLetter | zoneNumber),
 * same sort order (controller asc → zone asc), same totals formula
 * (partsTotal + laborHrs × laborRate). Any structural change here must also
 * be applied to the server-side `buildZoneGroups` function.
 *
 * `humanizeIssueType` is derived from `WET_CHECK_ISSUE_TYPE_SEED` — the same
 * source of truth the server uses — so in-app labels exactly match the PDF.
 */
import { WET_CHECK_ISSUE_TYPE_SEED } from "@workspace/db/schema";

export interface EstimateItemLike {
  id?: number;
  partName?: string | null;
  description?: string | null;
  quantity?: number | null;
  partPrice?: string | number | null;
  laborHours?: string | number | null;
  totalPrice?: string | number | null;
  controllerLetter?: string | null;
  zoneNumber?: number | null;
  issueType?: string | null;
}

export interface EstimateZoneGroup {
  controllerLetter: string;
  zoneNumber: number;
  zoneKey: string;
  zoneLabel: string;
  items: EstimateItemLike[];
  partsTotal: number;
  laborHrs: number;
  zoneTotal: number;
}

/**
 * Returns true when any item carries zone context — which only happens for
 * estimates generated from an Inspection wet check.
 */
export function isInspectionOriginEstimate(
  items: EstimateItemLike[] | null | undefined,
): boolean {
  return (
    Array.isArray(items) &&
    items.some((it) => it.controllerLetter != null || it.zoneNumber != null)
  );
}

// Canonical label map built from the same seed the server uses
// (see `artifacts/api-server/src/inspection-issue-labels.ts`).
// Sharing `WET_CHECK_ISSUE_TYPE_SEED` ensures in-app labels are
// identical to what the estimate PDF prints.
const ISSUE_LABEL_MAP: Readonly<Record<string, string>> = Object.fromEntries(
  WET_CHECK_ISSUE_TYPE_SEED.map((s) => [s.issueType, s.displayLabel]),
);

/**
 * Returns the human-readable label for a raw issue-type enum value.
 * Derived from `WET_CHECK_ISSUE_TYPE_SEED` so labels exactly match the PDF.
 * Falls back to title-casing for any future issue types not yet in the seed.
 */
export function humanizeIssueType(issueType: string | null | undefined): string {
  if (!issueType) return "Finding";
  return (
    ISSUE_LABEL_MAP[issueType] ??
    issueType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/**
 * Groups estimate items by (controllerLetter, zoneNumber) and computes
 * per-zone totals. Returns groups sorted by controllerLetter asc, then
 * zoneNumber asc — matching the PDF order.
 */
export function groupEstimateItemsByZone(
  items: EstimateItemLike[],
  laborRate: number,
): EstimateZoneGroup[] {
  const groupMap = new Map<string, EstimateZoneGroup>();

  for (const item of items) {
    const cl = item.controllerLetter ?? "";
    const zn = item.zoneNumber ?? 0;
    const key = `${cl}|${zn}`;

    let group = groupMap.get(key);
    if (!group) {
      const zoneLabel =
        cl && zn != null
          ? `Controller ${cl} · Zone ${zn}`
          : cl
          ? `Controller ${cl}`
          : `Zone ${zn}`;
      group = {
        controllerLetter: cl,
        zoneNumber: zn,
        zoneKey: key,
        zoneLabel,
        items: [],
        partsTotal: 0,
        laborHrs: 0,
        zoneTotal: 0,
      };
      groupMap.set(key, group);
    }
    group.items.push(item);
    group.partsTotal += parseFloat(String(item.totalPrice ?? 0)) || 0;
    group.laborHrs += parseFloat(String(item.laborHours ?? 0)) || 0;
  }

  for (const g of groupMap.values()) {
    g.zoneTotal = g.partsTotal + g.laborHrs * laborRate;
  }

  return [...groupMap.values()].sort((a, b) => {
    const cl = a.controllerLetter.localeCompare(b.controllerLetter);
    if (cl !== 0) return cl;
    return a.zoneNumber - b.zoneNumber;
  });
}
