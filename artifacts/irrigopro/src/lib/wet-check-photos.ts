import type {
  WetCheck,
  WetCheckFinding,
  WetCheckPhoto,
  WetCheckZoneRecord,
} from "@workspace/db/schema";
import { asArray } from "@/lib/queryClient";

type PhotoLike = Pick<WetCheckPhoto, "zoneRecordId" | "findingId">;

type ZoneLike = Pick<WetCheckZoneRecord, "id"> & {
  findings?: Pick<WetCheckFinding, "id">[] | null;
};

type WetCheckLike = {
  photos?: PhotoLike[] | null;
  zoneRecords?: ZoneLike[] | null;
};

export function countZonePhotos(
  wc: WetCheckLike | null | undefined,
  zone: ZoneLike | null | undefined,
): number {
  if (!wc || !zone) return 0;
  const findingIds = new Set(asArray(zone.findings).map((f) => f.id));
  return asArray(wc.photos).reduce((n, p) => {
    if (p.zoneRecordId === zone.id) return n + 1;
    if (p.findingId != null && findingIds.has(p.findingId)) return n + 1;
    return n;
  }, 0);
}

export function countFindingPhotos(
  wc: WetCheckLike | null | undefined,
  finding: Pick<WetCheckFinding, "id"> | null | undefined,
): number {
  if (!wc || !finding) return 0;
  return asArray(wc.photos).filter((p) => p.findingId === finding.id).length;
}

export function countLoosePhotos(
  wc: WetCheckLike | null | undefined,
): number {
  if (!wc) return 0;
  return asArray(wc.photos).filter(
    (p) => p.zoneRecordId == null && p.findingId == null,
  ).length;
}

export function countTotalPhotos(wc: WetCheckLike | null | undefined): number {
  return asArray(wc?.photos).length;
}

export type { WetCheck };
