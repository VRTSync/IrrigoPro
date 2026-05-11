import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { authedPhotoSrc } from "@/lib/queryClient";
import { Wrench, MapPin, StickyNote, Pencil, Search, type LucideIcon } from "lucide-react";
import type {
  Part, WetCheckFinding, WetCheckPhoto, WetCheckZoneRecord, IssueTypeConfig,
} from "@workspace/db/schema";

export interface FindingEdits {
  partId: number | null;
  partName: string | null;
  partPrice: string | null;
  quantity: number;
  laborHours: string;
}

interface FindingCardProps {
  finding: WetCheckFinding;
  zone: WetCheckZoneRecord;
  photos: WetCheckPhoto[];
  parts: Part[];
  issueConfig: IssueTypeConfig | null;
  customerLaborRate: number;
  edits: FindingEdits;
  onChange: (next: FindingEdits) => void;
}

const ISSUE_ICON: Record<string, { icon: LucideIcon; bg: string; text: string }> = {
  quick_fix:  { icon: Wrench, bg: "bg-blue-100",   text: "text-blue-700" },
  advanced:   { icon: Wrench, bg: "bg-amber-100",  text: "text-amber-700" },
  zone_issue: { icon: Wrench, bg: "bg-purple-100", text: "text-purple-700" },
};

function displayLabel(finding: WetCheckFinding, config: IssueTypeConfig | null): string {
  return config?.displayLabel ?? finding.partName ?? finding.issueType;
}

export function FindingCard({
  finding, zone, photos, parts, issueConfig, customerLaborRate, edits, onChange,
}: FindingCardProps) {
  const groupKey = (finding.issueGroup ?? "advanced") as keyof typeof ISSUE_ICON;
  const icon = ISSUE_ICON[groupKey] ?? ISSUE_ICON.advanced;
  const Icon = icon.icon;

  const total = useMemo(() => {
    const partPrice = parseFloat(edits.partPrice ?? "0") || 0;
    const labor = parseFloat(edits.laborHours ?? "0") || 0;
    return partPrice * (edits.quantity ?? 0) + labor * customerLaborRate;
  }, [edits, customerLaborRate]);

  const [partPickerOpen, setPartPickerOpen] = useState(false);
  const [partSearch, setPartSearch] = useState("");

  const filteredParts = useMemo(() => {
    const q = partSearch.trim().toLowerCase();
    let list = parts;
    if (issueConfig?.partCategoryFilter) {
      const f = issueConfig.partCategoryFilter.toLowerCase();
      list = list.filter(p => (p.category ?? "").toLowerCase() === f);
    }
    if (q) list = list.filter(p => p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q));
    return list.slice(0, 50);
  }, [parts, partSearch, issueConfig]);

  const choosePart = (p: Part | null) => {
    onChange({
      ...edits,
      partId: p?.id ?? null,
      partName: p?.name ?? null,
      partPrice: p ? String(p.price ?? "0") : null,
    });
    setPartPickerOpen(false);
  };

  return (
    <Card className="border-2 border-blue-300" data-testid={`wizard-finding-${finding.id}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className={`${icon.bg} rounded-md p-2`}>
            <Icon className={`w-5 h-5 ${icon.text}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs uppercase tracking-wide text-gray-500">Pending finding</div>
            <h2 className="text-lg font-semibold text-gray-900 truncate" data-testid={`wizard-finding-${finding.id}-title`}>
              {displayLabel(finding, issueConfig)}
            </h2>
            {finding.techDisposition && (
              <Badge
                variant="outline"
                className={`mt-1 text-xs ${
                  finding.techDisposition === "completed_in_field"
                    ? "border-green-300 text-green-700 bg-green-50"
                    : "border-amber-300 text-amber-800 bg-amber-50"
                }`}
                data-testid={`wizard-finding-${finding.id}-disposition`}
              >
                Tech: {finding.techDisposition === "completed_in_field" ? "Completed in field" : "Needs manager review"}
              </Badge>
            )}
            {/* Task #464 — labor-only Mark Complete. Shown so the manager
                can see at a glance why the auto-billed sheet has a
                no-parts line for this finding. */}
            {finding.noPartNeeded && (
              <Badge
                variant="outline"
                className="mt-1 ml-1 text-xs border-blue-300 text-blue-700 bg-blue-50"
                data-testid={`wizard-finding-${finding.id}-no-part-needed`}
              >
                No part needed (labor only)
              </Badge>
            )}
          </div>
        </div>

        <div className="rounded-md border bg-gray-50 p-3 text-sm flex items-center gap-2">
          <MapPin className="w-4 h-4 text-gray-500 shrink-0" />
          <span>Controller {zone.controllerLetter} · Zone {zone.zoneNumber}</span>
        </div>

        <div className="rounded-md border bg-gray-50 p-3 text-sm flex items-start gap-2" data-testid={`wizard-finding-${finding.id}-notes`}>
          <StickyNote className="w-4 h-4 text-gray-500 shrink-0 mt-0.5" />
          <span className="whitespace-pre-wrap">
            {finding.notes && finding.notes.trim()
              ? finding.notes
              : <span className="text-gray-400 italic">No tech notes</span>}
          </span>
        </div>

        {photos.length > 0 && (
          <div className="flex gap-2 overflow-x-auto" data-testid={`wizard-finding-${finding.id}-photos`}>
            {photos.map(p => (
              <a key={p.id} href={authedPhotoSrc(p.url, "medium")} target="_blank" rel="noreferrer" className="block shrink-0">
                <img src={authedPhotoSrc(p.url, "thumb")} alt="" className="h-20 w-20 object-cover rounded border" loading="lazy" />
              </a>
            ))}
          </div>
        )}

        <div className="rounded-md border p-3 space-y-3 bg-white">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-3 space-y-1">
              <div className="text-xs text-gray-500">Part</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 text-sm" data-testid={`wizard-finding-${finding.id}-part-name`}>
                  {edits.partName
                    ? edits.partName
                    : <span className="text-gray-400 italic">No part selected</span>}
                </div>
                <Button
                  type="button" variant="outline" size="sm"
                  onClick={() => { setPartSearch(""); setPartPickerOpen(true); }}
                  data-testid={`wizard-finding-${finding.id}-pick-part`}
                >
                  <Pencil className="w-3 h-3 mr-1" /> Change
                </Button>
              </div>
              <div className="text-xs text-gray-500">
                Part price: ${parseFloat(edits.partPrice ?? "0").toFixed(2)}
              </div>
            </div>

            <label className="text-xs space-y-1">
              <span className="text-gray-500 block">Quantity</span>
              <Input
                type="number" min={1} step={1}
                value={edits.quantity}
                onChange={e => onChange({ ...edits, quantity: Math.max(1, parseInt(e.target.value || "1") || 1) })}
                data-testid={`wizard-finding-${finding.id}-qty`}
              />
            </label>

            <label className="text-xs space-y-1">
              <span className="text-gray-500 block">Labor hours</span>
              <Input
                type="number" min={0} step={0.25}
                value={edits.laborHours}
                onChange={e => onChange({ ...edits, laborHours: e.target.value })}
                data-testid={`wizard-finding-${finding.id}-labor`}
              />
            </label>

            <div className="text-xs space-y-1">
              <span className="text-gray-500 block">Labor rate (read-only)</span>
              <div className="h-9 flex items-center px-3 bg-gray-50 border rounded text-sm">
                ${customerLaborRate.toFixed(2)}/hr
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t">
            <span className="text-xs text-gray-500">Estimated total</span>
            <Badge className="text-sm" data-testid={`wizard-finding-${finding.id}-total`}>
              ${total.toFixed(2)}
            </Badge>
          </div>
        </div>
      </CardContent>

      <Dialog open={partPickerOpen} onOpenChange={setPartPickerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Pick a part</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              autoFocus placeholder="Search parts..."
              value={partSearch}
              onChange={e => setPartSearch(e.target.value)}
              className="pl-10"
              data-testid={`wizard-finding-${finding.id}-part-search`}
            />
          </div>
          <div className="max-h-80 overflow-y-auto divide-y border rounded">
            <button
              type="button"
              onClick={() => choosePart(null)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
              data-testid={`wizard-finding-${finding.id}-part-none`}
            >
              <span className="text-gray-500 italic">— No part —</span>
            </button>
            {filteredParts.length === 0 ? (
              <div className="px-3 py-4 text-sm text-gray-500 text-center">No matches</div>
            ) : filteredParts.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => choosePart(p)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
                data-testid={`wizard-finding-${finding.id}-part-${p.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-xs text-gray-500 truncate">{p.sku ?? "—"} · {p.category ?? "—"}</div>
                  </div>
                  <div className="text-xs font-semibold shrink-0">${parseFloat(String(p.price ?? "0")).toFixed(2)}</div>
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
