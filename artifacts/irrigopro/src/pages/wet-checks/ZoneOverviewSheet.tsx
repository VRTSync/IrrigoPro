import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Camera } from "lucide-react";
import { asArray } from "@/lib/queryClient";
import { tintForControllerLetter } from "@/lib/lifecycle";
import type { PropertyController, WetCheckZoneRecord, WetCheckFinding } from "@workspace/db/schema";

type ZoneRecord = WetCheckZoneRecord & { findings: WetCheckFinding[] };

export function ZoneOverviewSheet({
  open,
  onClose,
  controllers,
  zoneRecords,
  activeLetter,
  activeZone,
  onNavigate,
  photos,
}: {
  open: boolean;
  onClose: () => void;
  controllers: PropertyController[];
  zoneRecords: ZoneRecord[];
  activeLetter: string;
  activeZone: number;
  onNavigate: (letter: string, zone: number) => void;
  photos: { zoneRecordId: number | null; findingId: number | null }[];
}) {
  const recordMap = new Map(
    zoneRecords.map((r) => [`${r.controllerLetter}-${r.zoneNumber}`, r]),
  );

  let okCount = 0;
  let needsWorkCount = 0;
  let naCount = 0;
  let uncheckedCount = 0;

  for (const c of controllers) {
    for (let z = 1; z <= c.zoneCount; z++) {
      const r = recordMap.get(`${c.controllerLetter}-${z}`);
      if (!r || r.status === "not_checked") uncheckedCount++;
      else if (r.status === "checked_ok") okCount++;
      else if (r.status === "checked_with_issues") needsWorkCount++;
      else if (r.status === "not_applicable") naCount++;
    }
  }

  function zoneCellClass(r: ZoneRecord | undefined, letter: string, zone: number): string {
    const isActive = letter === activeLetter && zone === activeZone;
    const base = "relative aspect-square min-h-[44px] text-xs font-semibold rounded transition-transform active:scale-95";
    const ring = isActive ? " ring-2 ring-blue-500 ring-offset-1" : "";
    if (!r || r.status === "not_checked") return `${base} bg-white border border-gray-300 text-gray-600${ring}`;
    if (r.status === "checked_ok") return `${base} bg-green-500 text-white${ring}`;
    if (r.status === "checked_with_issues") return `${base} bg-amber-500 text-white${ring}`;
    if (r.status === "not_applicable") return `${base} bg-gray-400 text-white${ring}`;
    return `${base} bg-white border border-gray-300 text-gray-600${ring}`;
  }

  function photoCountForZone(r: ZoneRecord | undefined): number {
    if (!r) return 0;
    const findingIds = new Set(asArray(r.findings).map((f) => f.id));
    return photos.filter(
      (p) =>
        p.zoneRecordId === r.id ||
        (p.findingId != null && findingIds.has(p.findingId)),
    ).length;
  }

  return (
    <Sheet open={open} onOpenChange={(b) => { if (!b) onClose(); }}>
      <SheetContent
        side="bottom"
        className="h-[80vh] sm:h-[70vh] overflow-y-auto pb-safe"
        data-testid="zone-overview-sheet"
      >
        <SheetHeader className="pb-2">
          <SheetTitle>All Zones</SheetTitle>
        </SheetHeader>

        <div className="flex flex-wrap items-center gap-1.5 mb-4 text-xs">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500 text-white font-semibold">
            ✓ OK · {okCount}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500 text-white font-semibold">
            ! Needs work · {needsWorkCount}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-400 text-white font-semibold">
            N/A · {naCount}
          </span>
          {uncheckedCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border border-gray-300 text-gray-700 font-semibold">
              Remaining · {uncheckedCount}
            </span>
          )}
        </div>

        <div className="space-y-5">
          {controllers.map((ctrl) => {
            const tint = tintForControllerLetter(ctrl.controllerLetter);
            return (
              <div key={ctrl.controllerLetter}>
                <div className={`text-xs uppercase tracking-wide font-bold mb-2 ${tint.label}`}>
                  Controller {ctrl.controllerLetter}
                </div>
                <div className="grid grid-cols-6 sm:grid-cols-10 gap-1.5">
                  {Array.from({ length: ctrl.zoneCount }, (_, i) => i + 1).map((n) => {
                    const r = recordMap.get(`${ctrl.controllerLetter}-${n}`);
                    const isMarkedComplete = r?.status === "checked_with_issues" && r?.markedCompleteAt != null;
                    const photoCount = photoCountForZone(r);
                    return (
                      <button
                        key={n}
                        className={zoneCellClass(r, ctrl.controllerLetter, n)}
                        onClick={() => {
                          onNavigate(ctrl.controllerLetter, n);
                          onClose();
                        }}
                        data-testid={`overview-zone-${ctrl.controllerLetter}-${n}`}
                        aria-label={`Controller ${ctrl.controllerLetter} Zone ${n}${r ? ` — ${r.status}` : " — unchecked"}`}
                      >
                        {n}
                        {isMarkedComplete && (
                          <span className="absolute -top-1 -right-1 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-white text-green-600 shadow ring-1 ring-green-600">
                            <CheckCircle2 className="w-2.5 h-2.5" strokeWidth={3} />
                          </span>
                        )}
                        {photoCount > 0 && (
                          <span className="absolute -bottom-1 -right-1 inline-flex items-center justify-center min-w-[12px] h-3 px-0.5 rounded-full bg-white text-[8px] font-bold text-gray-800 shadow ring-1 ring-gray-400">
                            <Camera className="w-1.5 h-1.5 mr-px" aria-hidden />
                            {photoCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="pt-4">
          <Button variant="outline" className="w-full" onClick={onClose}>
            Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
