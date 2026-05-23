/**
 * Task #843 — Pure assembler that groups wet-check photos by zone and finding.
 *
 * Extracted from invoice-pdf-service.ts so it can be unit-tested without
 * pulling in puppeteer or ObjectStorageService.
 */

import type { PdfWcbZonePhotoGroup } from './pdf-view-model';
import type { WetCheckBillingView } from './wet-check-billing-view';

export type WcbPhotoRecord = {
  url: string;
  zoneRecordId: number | null;
  findingId: number | null;
};

/**
 * Group wet-check photos by zone and finding.
 *
 * Routing rules:
 *  - Photo with `findingId` set → routed to that finding's zone via the
 *    view's lineItem index, then into the per-finding group.
 *  - Photo with `findingId` null and `zoneRecordId` set → routed to the
 *    zone inferred from sibling finding-linked photos that share the same
 *    `zoneRecordId`; placed in the zone-level photo list.
 *  - Photo with no resolvable zone → excluded (falls back to flat gallery).
 *
 * Result is ordered by `view.zones` display order.
 */
export function buildWcbZonePhotoGroups(
  photos: WcbPhotoRecord[],
  view: WetCheckBillingView,
): PdfWcbZonePhotoGroup[] {
  if (photos.length === 0 || view.zones.length === 0) return [];

  type Zone = (typeof view.zones)[0];

  // findingId → WcvZone
  const findingToZone = new Map<number, Zone>();
  for (const zone of view.zones) {
    for (const li of zone.lineItems) {
      findingToZone.set(li.findingId, zone);
    }
  }

  // zoneRecordId → WcvZone (inferred from photos that have both fields set).
  // This lets us route zone-level photos (findingId null) to the correct zone.
  const zoneRecordToZone = new Map<number, Zone>();
  for (const photo of photos) {
    if (photo.zoneRecordId !== null && photo.findingId !== null) {
      const zone = findingToZone.get(photo.findingId);
      if (zone) zoneRecordToZone.set(photo.zoneRecordId, zone);
    }
  }

  // findingId → human-readable label
  const findingToLabel = new Map<number, string>();
  for (const zone of view.zones) {
    for (const li of zone.lineItems) {
      findingToLabel.set(li.findingId, li.issueDisplayLabel);
    }
  }

  // Accumulate groups keyed by zoneLabel
  const groups = new Map<string, PdfWcbZonePhotoGroup>();

  function getOrCreate(zone: Zone): PdfWcbZonePhotoGroup {
    let g = groups.get(zone.zoneLabel);
    if (!g) {
      g = { zoneLabel: zone.zoneLabel, zoneRecordId: 0, zonePhotoUrls: [], findingGroups: [] };
      groups.set(zone.zoneLabel, g);
    }
    return g;
  }

  for (const photo of photos) {
    if (!photo.url) continue;

    let zone: Zone | undefined;
    if (photo.findingId !== null) {
      zone = findingToZone.get(photo.findingId);
    } else if (photo.zoneRecordId !== null) {
      zone = zoneRecordToZone.get(photo.zoneRecordId);
    }

    if (!zone) continue; // unresolvable — excluded from per-zone rendering

    const group = getOrCreate(zone);
    if (photo.zoneRecordId !== null && group.zoneRecordId === 0) {
      group.zoneRecordId = photo.zoneRecordId;
    }

    if (photo.findingId !== null) {
      let fg = group.findingGroups.find(f => f.findingId === photo.findingId);
      if (!fg) {
        fg = {
          findingId: photo.findingId,
          issueDisplayLabel: findingToLabel.get(photo.findingId) ?? `Finding ${photo.findingId}`,
          photoUrls: [],
        };
        group.findingGroups.push(fg);
      }
      fg.photoUrls.push(photo.url);
    } else {
      group.zonePhotoUrls.push(photo.url);
    }
  }

  // Return in view.zones display order
  return view.zones
    .map(z => groups.get(z.zoneLabel))
    .filter((g): g is PdfWcbZonePhotoGroup => g !== undefined);
}
