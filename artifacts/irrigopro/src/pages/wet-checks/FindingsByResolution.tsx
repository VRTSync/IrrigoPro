import { CheckCircle2, Wrench, MinusCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { asArray } from "@/lib/queryClient";
import type { WetCheckFinding, WetCheckZoneRecord } from "@workspace/db/schema";

// Slice 3 — Per-resolution findings summary the sticky chips scroll to.
// Groups findings into Complete (auto-billed on submit), Pending (need a
// manager decision), and lists N/A zones, so the tech can audit what
// each chip count represents before committing the submit.
export function FindingsByResolution({
  findings,
  zoneRecords,
}: {
  findings: WetCheckFinding[];
  zoneRecords: WetCheckZoneRecord[];
}) {
  const complete = findings.filter(f => f.resolution === "repaired_in_field");
  const pending = findings.filter(f => f.resolution === "pending");
  // Task #540 — defend against null nested arrays even when the parent
  // already extracted the prop; the FindingsByResolution callsite is
  // memoized off `wc.zoneRecords` upstream and may receive null in tests.
  const safeZoneRecords = asArray(zoneRecords);
  const naZones = safeZoneRecords.filter(z => z.status === "not_applicable");
  const zoneById = new Map(safeZoneRecords.map(z => [z.id, z]));
  const label = (f: WetCheckFinding) => {
    const zr = zoneById.get(f.zoneRecordId);
    const loc = zr ? `Zone ${zr.controllerLetter}${zr.zoneNumber}` : `Finding #${f.id}`;
    return `${loc} · ${f.partName ?? f.issueType} × ${Number(f.quantity ?? 0)}`;
  };
  return (
    <div className="space-y-3" data-testid="findings-by-resolution">
      <Card id="findings-group-complete">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            Complete · {complete.length}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs">
          {complete.length === 0
            ? <div className="text-gray-500">Nothing marked complete yet.</div>
            : <ul className="space-y-1" data-testid="group-complete-list">
                {complete.map(f => <li key={f.id} data-testid={`group-complete-row-${f.id}`}>{label(f)}</li>)}
              </ul>}
        </CardContent>
      </Card>
      <Card id="findings-group-pending">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Wrench className="w-4 h-4 text-amber-600" />
            Needs decision · {pending.length}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs">
          {pending.length === 0
            ? <div className="text-gray-500">No pending findings.</div>
            : <ul className="space-y-1" data-testid="group-pending-list">
                {pending.map(f => <li key={f.id} data-testid={`group-pending-row-${f.id}`}>{label(f)}</li>)}
              </ul>}
        </CardContent>
      </Card>
      <Card id="findings-group-na">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <MinusCircle className="w-4 h-4 text-gray-500" />
            N/A · {naZones.length}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs">
          {naZones.length === 0
            ? <div className="text-gray-500">No N/A zones.</div>
            : <div className="flex flex-wrap gap-1" data-testid="group-na-list">
                {naZones.map(z => (
                  <Badge key={z.id} variant="outline" data-testid={`group-na-zone-${z.controllerLetter}${z.zoneNumber}`}>
                    {z.controllerLetter}{z.zoneNumber}
                  </Badge>
                ))}
              </div>}
        </CardContent>
      </Card>
    </div>
  );
}
