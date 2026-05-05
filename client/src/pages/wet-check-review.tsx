import { useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ChevronLeft, CheckCircle2, AlertTriangle, Calendar } from "lucide-react";
import type {
  Customer,
  InsertWetCheckFinding,
  Part,
  WetCheck,
  WetCheckFinding,
  WetCheckPhoto,
  WetCheckWithDetails,
  WetCheckZoneRecord,
} from "@shared/schema";

type Resolution =
  | "pending"
  | "repaired_in_field"
  | "sent_to_estimate"
  | "deferred_to_work_order"
  | "documented_only";

const RESOLUTION_LABEL: Record<Resolution, string> = {
  pending: "Pending decision",
  repaired_in_field: "Repaired in field",
  sent_to_estimate: "Send to estimate",
  deferred_to_work_order: "Defer to work order",
  documented_only: "Documented only",
};

type IssueGroup = "quick_fix" | "advanced" | "zone_issue";
const ISSUE_GROUP_LABEL: Record<IssueGroup, string> = {
  quick_fix: "Quick fix",
  advanced: "Advanced",
  zone_issue: "Zone issue",
};

function lineTotal(f: WetCheckFinding, laborRate: number): number {
  const qty = Number(f.quantity ?? 0);
  const partPrice = parseFloat(String(f.partPrice ?? "0"));
  const laborHours = parseFloat(String(f.laborHours ?? "0"));
  return partPrice * qty + laborHours * laborRate;
}

// ─── Inbox ───────────────────────────────────────────────────────────────────
type PendingReviewRow = WetCheck & {
  findingCounts: { quick_fix: number; advanced: number; zone_issue: number; total: number };
  totalBillable: string;
  customerLaborRate: string;
};

function PendingReviewInbox() {
  const [, navigate] = useLocation();
  // Inbox shows ONLY freshly-submitted wet checks awaiting first review.
  // The /pending-review aggregate endpoint includes per-row issueGroup
  // counts and a server-computed total estimated billable so the manager
  // can triage at a glance without opening every record.
  const { data: rows = [], isLoading } = useQuery<PendingReviewRow[]>({
    queryKey: ["/api/wet-checks/pending-review"],
  });

  return (
    <div className="max-w-4xl mx-auto py-4 space-y-4">
      <h1 className="text-2xl font-bold">Wet Checks → Pending Review</h1>
      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin" /></div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-6 text-center text-gray-500 text-sm">
          No wet checks awaiting review.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {rows.map(wc => (
            <Card
              key={wc.id}
              className="cursor-pointer hover:bg-gray-50"
              onClick={() => navigate(`/wet-checks/${wc.id}/review`)}
              data-testid={`wc-row-${wc.id}`}
            >
              <CardContent className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{wc.customerName}</div>
                  <div className="text-xs text-gray-500 truncate">{wc.propertyAddress ?? "—"}</div>
                  <div className="text-xs text-gray-500">
                    Tech: {wc.technicianName} · Submitted{" "}
                    {wc.submittedAt ? new Date(wc.submittedAt).toLocaleString() : "—"}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant="outline"
                      className="text-xs"
                      data-testid={`wc-row-${wc.id}-count-quick_fix`}
                    >
                      Quick fix · {wc.findingCounts.quick_fix}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="text-xs"
                      data-testid={`wc-row-${wc.id}-count-advanced`}
                    >
                      Advanced · {wc.findingCounts.advanced}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="text-xs"
                      data-testid={`wc-row-${wc.id}-count-zone_issue`}
                    >
                      Zone issue · {wc.findingCounts.zone_issue}
                    </Badge>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Badge variant="secondary">submitted</Badge>
                  <Badge
                    className="text-xs"
                    data-testid={`wc-row-${wc.id}-total-billable`}
                  >
                    ${wc.totalBillable}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Review detail ───────────────────────────────────────────────────────────
function FindingRow({
  finding,
  zone,
  photos,
  parts,
  customerLaborRate,
  scheduledDate,
  onSetScheduled,
  readOnly,
  pricingLocked,
}: {
  finding: WetCheckFinding;
  zone: WetCheckZoneRecord;
  photos: WetCheckPhoto[];
  parts: Part[];
  customerLaborRate: number;
  scheduledDate: string | null;
  onSetScheduled: (id: number, iso: string | null) => void;
  readOnly: boolean;
  // Pricing controls (qty/labor/part) are frozen once approved; routing
  // remains editable so the manager can still finish routing decisions.
  pricingLocked: boolean;
}) {
  const { toast } = useToast();
  // documented_only findings have convertedAt but no FK, so check both.
  const isConverted =
    finding.convertedAt != null ||
    finding.billingSheetId != null ||
    finding.estimateId != null ||
    finding.workOrderId != null;

  const routeMut = useMutation({
    mutationFn: (resolution: Resolution) =>
      apiRequest(`/api/wet-checks/findings/${finding.id}/route`, "PATCH", { resolution }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks", finding.wetCheckId] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e?.message, variant: "destructive" }),
  });

  const editMut = useMutation({
    mutationFn: (patch: Partial<InsertWetCheckFinding>) =>
      apiRequest(`/api/wet-checks/findings/${finding.id}`, "PATCH", patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks", finding.wetCheckId] });
    },
    onError: (e: Error) => toast({ title: "Edit failed", description: e?.message, variant: "destructive" }),
  });

  const total = lineTotal(finding, customerLaborRate);
  const dropdownDisabled = readOnly || isConverted || routeMut.isPending;

  return (
    <div className="border rounded p-3 space-y-2" data-testid={`finding-row-${finding.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-sm">
            {finding.partName ?? finding.issueType}
            <span className="ml-2 text-xs text-gray-500">[{finding.issueGroup}]</span>
          </div>
          <div className="text-xs text-gray-500">
            Zone {zone.controllerLetter}{zone.zoneNumber}
            {finding.notes ? ` · ${finding.notes}` : ""}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-semibold">${total.toFixed(2)}</div>
          {isConverted && (
            <Badge variant="outline" className="mt-1">
              {finding.billingSheetId ? "Billed" : finding.estimateId ? "Estimate" : "Work Order"}
            </Badge>
          )}
        </div>
      </div>

      {/* Photo thumbnails captured against this finding. The wet-check
          response colocates photos by findingId so the manager sees the
          field-tech evidence when deciding routing. */}
      {photos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto" data-testid={`finding-photos-${finding.id}`}>
          {photos.map(p => (
            <a
              key={p.id}
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="block shrink-0"
            >
              <img
                src={p.url}
                alt={p.caption ?? "Wet check photo"}
                className="h-16 w-16 object-cover rounded border"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="text-xs">
          <span className="text-gray-500">Qty</span>
          <Input
            type="number" min={1} step={1}
            defaultValue={Number(finding.quantity ?? 1)}
            disabled={isConverted || readOnly || pricingLocked}
            onBlur={(e) => {
              const v = parseInt(e.currentTarget.value);
              if (!isNaN(v) && v !== Number(finding.quantity)) editMut.mutate({ quantity: v });
            }}
            data-testid={`finding-qty-${finding.id}`}
          />
        </label>
        <label className="text-xs">
          <span className="text-gray-500">Labor hrs</span>
          <Input
            type="number" min={0} step={0.05}
            defaultValue={parseFloat(String(finding.laborHours ?? 0))}
            disabled={isConverted || readOnly || pricingLocked}
            onBlur={(e) => {
              const v = parseFloat(e.currentTarget.value);
              const cur = parseFloat(String(finding.laborHours ?? 0));
              if (!isNaN(v) && v !== cur) editMut.mutate({ laborHours: String(v) });
            }}
            data-testid={`finding-labor-${finding.id}`}
          />
        </label>
        <label className="text-xs col-span-2">
          <span className="text-gray-500">Part (snapshot)</span>
          {/* Manager part-swap picker. Server overwrites partName/partPrice
              authoritatively from the catalog; client cannot smuggle a
              manipulated price in. */}
          <Select
            value={finding.partId != null ? String(finding.partId) : "__none"}
            onValueChange={(v) => {
              const next = v === "__none" ? null : parseInt(v);
              if (next !== finding.partId) editMut.mutate({ partId: next });
            }}
            disabled={isConverted || readOnly || pricingLocked}
          >
            <SelectTrigger data-testid={`finding-part-${finding.id}`}>
              <SelectValue placeholder="Select part" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="__none">— No part —</SelectItem>
              {parts.map(p => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}{p.sku ? ` (${p.sku})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        {!isConverted && (
          <label className="text-xs col-span-2 sm:col-span-4">
            <span className="text-gray-500">Routing</span>
            <Select
              value={finding.resolution ?? "pending"}
              onValueChange={(v) => routeMut.mutate(v as Resolution)}
              disabled={dropdownDisabled}
            >
              <SelectTrigger data-testid={`finding-route-${finding.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(RESOLUTION_LABEL) as Resolution[]).map(k => (
                  <SelectItem key={k} value={k}>{RESOLUTION_LABEL[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        )}
      </div>

      {finding.resolution === "deferred_to_work_order" && !isConverted && (
        <label className="text-xs flex items-center gap-2">
          <Calendar className="w-3 h-3 text-gray-500" />
          <span className="text-gray-500">Schedule date</span>
          <Input
            type="date"
            value={scheduledDate ?? ""}
            onChange={(e) => onSetScheduled(finding.id, e.currentTarget.value || null)}
            data-testid={`finding-sched-${finding.id}`}
          />
        </label>
      )}
    </div>
  );
}

function WetCheckReviewDetail({ id }: { id: number }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [scheduledDates, setScheduledDates] = useState<Record<number, string | null>>({});

  const { data: wc, isLoading } = useQuery<WetCheckWithDetails>({
    queryKey: ["/api/wet-checks", id],
    queryFn: () => apiRequest(`/api/wet-checks/${id}`),
  });

  const { data: customer } = useQuery<Customer>({
    queryKey: ["/api/customers", wc?.customerId],
    queryFn: () => apiRequest(`/api/customers/${wc!.customerId}`),
    enabled: !!wc?.customerId,
  });

  // Parts catalog for the manager part-swap picker. Loaded once for the
  // page; the catalog is small enough that paging isn't worth the UX cost.
  const { data: parts = [] } = useQuery<Part[]>({
    queryKey: ["/api/parts"],
  });

  const customerLaborRate = parseFloat(String(customer?.laborRate ?? "45"));

  const approveMut = useMutation({
    mutationFn: () => apiRequest(`/api/wet-checks/${id}/approve`, "POST", {}),
    onSuccess: () => {
      toast({ title: "Wet check approved" });
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks", id] });
    },
    onError: (e: Error) => toast({ title: "Approve failed", description: e?.message, variant: "destructive" }),
  });

  const convertMut = useMutation({
    mutationFn: () => apiRequest(`/api/wet-checks/${id}/convert`, "POST", { scheduledDates }),
    onSuccess: (result: { billingSheetId: number | null; estimateId: number | null; workOrderId: number | null }) => {
      toast({
        title: "Converted",
        description: [
          result.billingSheetId ? `Billing #${result.billingSheetId}` : null,
          result.estimateId ? `Estimate #${result.estimateId}` : null,
          result.workOrderId ? `Work order #${result.workOrderId}` : null,
        ].filter(Boolean).join(" · ") || "No destinations created",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks", id] });
    },
    onError: (e: Error) => toast({ title: "Convert failed", description: e?.message, variant: "destructive" }),
  });

  const findings = useMemo(() => {
    if (!wc) return [];
    return wc.zoneRecords.flatMap(zr => zr.findings.map(f => ({ f, zr })));
  }, [wc]);

  const counts = useMemo(() => {
    const c: Record<Resolution, number> = {
      pending: 0, repaired_in_field: 0, sent_to_estimate: 0, deferred_to_work_order: 0, documented_only: 0,
    };
    for (const { f } of findings) c[(f.resolution as Resolution) ?? "pending"]++;
    return c;
  }, [findings]);

  // Issue-group counts give the manager an at-a-glance shape of the visit
  // (lots of quick-fix nozzle work vs. a few zone-level wiring problems).
  const groupCounts = useMemo(() => {
    const g: Record<IssueGroup, number> = { quick_fix: 0, advanced: 0, zone_issue: 0 };
    for (const { f } of findings) {
      const k = (f.issueGroup as IssueGroup) ?? "advanced";
      g[k] = (g[k] ?? 0) + 1;
    }
    return g;
  }, [findings]);

  const eligible = findings.filter(({ f }) =>
    f.resolution !== "pending" &&
    f.convertedAt == null &&
    f.billingSheetId == null && f.estimateId == null && f.workOrderId == null,
  );
  const billingTotal = eligible
    .filter(({ f }) => f.resolution === "repaired_in_field")
    .reduce((s, { f }) => s + lineTotal(f, customerLaborRate), 0);
  // Total estimated billable across all monetised buckets (repaired-in-field
  // billing sheet + sent-to-estimate). Documented and deferred do not flow
  // to immediate revenue.
  const totalBillable = eligible
    .filter(({ f }) => f.resolution === "repaired_in_field" || f.resolution === "sent_to_estimate")
    .reduce((s, { f }) => s + lineTotal(f, customerLaborRate), 0);

  // Group photos by findingId for quick lookup in the row component.
  const photosByFinding = useMemo(() => {
    const m = new Map<number, WetCheckPhoto[]>();
    if (!wc) return m;
    for (const p of wc.photos) {
      if (p.findingId == null) continue;
      const arr = m.get(p.findingId) ?? [];
      arr.push(p);
      m.set(p.findingId, arr);
    }
    return m;
  }, [wc]);

  if (isLoading || !wc) {
    return <div className="flex justify-center py-10"><Loader2 className="animate-spin" /></div>;
  }

  const isReadOnly = wc.status === "converted";
  const canConvert =
    !isReadOnly &&
    eligible.length > 0 &&
    !convertMut.isPending;

  // Group findings by zone, sort each zone's findings by issueGroup.
  const groupOrder: Record<string, number> = { quick_fix: 0, advanced: 1, zone_issue: 2 };
  const zoneFindingsSorted = wc.zoneRecords
    .filter(zr => zr.findings.length > 0)
    .map(zr => ({
      zr,
      findings: [...zr.findings].sort(
        (a, b) => (groupOrder[a.issueGroup] ?? 99) - (groupOrder[b.issueGroup] ?? 99),
      ),
    }));

  return (
    <div className="max-w-4xl mx-auto py-4 space-y-4">
      <Button variant="ghost" onClick={() => navigate("/wet-checks/pending-review")}>
        <ChevronLeft className="w-4 h-4 mr-1" /> Pending Review
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>{wc.customerName}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          <div>{wc.propertyAddress ?? "—"}</div>
          <div className="text-gray-600">
            Tech: {wc.technicianName} · Submitted{" "}
            {wc.submittedAt ? new Date(wc.submittedAt).toLocaleString() : "—"}
          </div>
          <div className="text-gray-600">Weather: {wc.weather ?? "—"}</div>
          {wc.notes && <div className="text-gray-700">Notes: {wc.notes}</div>}
          <div className="pt-2 flex flex-wrap items-center gap-2">
            <Badge>{wc.status}</Badge>
            <Badge variant="outline">Customer labor rate: ${customerLaborRate.toFixed(2)}/hr</Badge>
            {(Object.keys(ISSUE_GROUP_LABEL) as IssueGroup[]).map(k => (
              <Badge key={k} variant="secondary" data-testid={`group-chip-${k}`}>
                {ISSUE_GROUP_LABEL[k]}: {groupCounts[k]}
              </Badge>
            ))}
            <Badge variant="default" data-testid="total-billable">
              Total billable: ${totalBillable.toFixed(2)}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Routing summary</CardTitle></CardHeader>
        <CardContent className="text-sm grid grid-cols-2 sm:grid-cols-3 gap-2">
          <div><span className="text-gray-500">Pending:</span> {counts.pending}</div>
          <div><span className="text-gray-500">Repaired:</span> {counts.repaired_in_field}</div>
          <div><span className="text-gray-500">→ Estimate:</span> {counts.sent_to_estimate}</div>
          <div><span className="text-gray-500">→ Work order:</span> {counts.deferred_to_work_order}</div>
          <div><span className="text-gray-500">Documented:</span> {counts.documented_only}</div>
          <div><span className="text-gray-500">Repaired billable:</span> ${billingTotal.toFixed(2)}</div>
        </CardContent>
      </Card>

      {zoneFindingsSorted.length === 0 ? (
        <Card><CardContent className="py-6 text-center text-gray-500 text-sm">
          No findings on this wet check.
        </CardContent></Card>
      ) : (
        zoneFindingsSorted.map(({ zr, findings: fs }) => (
          <Card key={zr.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Zone {zr.controllerLetter}{zr.zoneNumber}
                <Badge variant="outline" className="ml-2">{zr.status}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {fs.map(f => (
                <FindingRow
                  key={f.id}
                  finding={f}
                  zone={zr}
                  photos={photosByFinding.get(f.id) ?? []}
                  parts={parts}
                  customerLaborRate={customerLaborRate}
                  scheduledDate={scheduledDates[f.id] ?? null}
                  onSetScheduled={(fid, iso) =>
                    setScheduledDates(prev => ({ ...prev, [fid]: iso }))
                  }
                  readOnly={isReadOnly}
                  // Lock pricing only on the wet-check-wide `approved`
                  // pre-conversion gate. Once a wet check is in
                  // `partially_converted`, the per-finding `isConverted`
                  // check inside FindingRow already disables editing for
                  // already-converted rows; remaining unconverted findings
                  // must stay editable so the manager can re-route/reprice
                  // them before re-running convert.
                  pricingLocked={wc.status === "approved"}
                />
              ))}
            </CardContent>
          </Card>
        ))
      )}

      <div className="sticky bottom-0 bg-white border-t py-3 flex items-center justify-between gap-3">
        <div className="text-xs text-gray-500">
          {counts.pending > 0 && (
            <span className="flex items-center gap-1"><AlertTriangle className="w-3 h-3" />
              {counts.pending} finding(s) still pending — they will be left for a future conversion.
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {wc.status === "submitted" && (
            <Button
              variant="outline"
              onClick={() => approveMut.mutate()}
              disabled={approveMut.isPending}
              data-testid="btn-approve"
            >
              {approveMut.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
              Approve
            </Button>
          )}
          <Button
            onClick={() => {
              if (counts.pending > 0) {
                const ok = window.confirm(
                  `${counts.pending} finding(s) are still pending and will NOT be included in this conversion. ` +
                  `The wet check will be marked partially_converted and you'll need to come back to finish them. Convert anyway?`
                );
                if (!ok) return;
              }
              convertMut.mutate();
            }}
            disabled={!canConvert}
            data-testid="btn-convert"
          >
            {convertMut.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
            Convert ({eligible.length})
          </Button>
        </div>
      </div>

      {(wc.status === "converted" || wc.status === "partially_converted") && (
        <ConvertedLinks wc={wc} />
      )}
    </div>
  );
}

function ConvertedLinks({ wc }: { wc: WetCheckWithDetails }) {
  const allFindings = wc.zoneRecords.flatMap(zr => zr.findings);
  const billingIds = Array.from(new Set(allFindings.map(f => f.billingSheetId).filter((x): x is number => !!x)));
  const estIds = Array.from(new Set(allFindings.map(f => f.estimateId).filter((x): x is number => !!x)));
  const woIds = Array.from(new Set(allFindings.map(f => f.workOrderId).filter((x): x is number => !!x)));
  if (billingIds.length === 0 && estIds.length === 0 && woIds.length === 0) return null;
  // Deep links jump straight to the specific record so the manager doesn't
  // have to scan a list page after conversion.
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Created records</CardTitle></CardHeader>
      <CardContent className="text-sm space-y-1">
        {billingIds.map(bid => (
          <div key={`bs-${bid}`}>
            <Link className="text-blue-600 underline" href={`/billing-sheets?openSheet=${bid}`}>Billing sheet #{bid}</Link>
          </div>
        ))}
        {estIds.map(eid => (
          <div key={`est-${eid}`}>
            <Link className="text-blue-600 underline" href={`/estimates?openEstimate=${eid}`}>Estimate #{eid}</Link>
          </div>
        ))}
        {woIds.map(wid => (
          <div key={`wo-${wid}`}>
            <Link className="text-blue-600 underline" href={`/work-orders?openWorkOrder=${wid}`}>Work order #{wid}</Link>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ─── Page entry ──────────────────────────────────────────────────────────────
export default function WetCheckReviewPage() {
  const [matchDetail, params] = useRoute<{ id: string }>("/wet-checks/:id/review");
  if (matchDetail) return <WetCheckReviewDetail id={parseInt(params!.id)} />;
  return <PendingReviewInbox />;
}
