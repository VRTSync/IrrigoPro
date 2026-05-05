import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, Loader2, FileText, Wrench, FileCheck, ListChecks } from "lucide-react";
import type {
  Customer, IssueTypeConfig, Part, WetCheckFinding, WetCheckPhoto,
  WetCheckWithDetails, WetCheckZoneRecord,
} from "@shared/schema";
import { FindingCard, type FindingEdits } from "./finding-card";
import { DecisionCard } from "./decision-card";
import { AutoBilledBanner } from "./auto-billed-banner";

type Resolution =
  | "pending" | "repaired_in_field" | "sent_to_estimate" | "deferred_to_work_order" | "documented_only";

interface FindingItem { f: WetCheckFinding; zr: WetCheckZoneRecord; }

function lineTotal(edits: FindingEdits, laborRate: number): number {
  const partPrice = parseFloat(edits.partPrice ?? "0") || 0;
  const labor = parseFloat(edits.laborHours ?? "0") || 0;
  return partPrice * (edits.quantity ?? 0) + labor * laborRate;
}

function lineTotalFinding(f: WetCheckFinding, laborRate: number): number {
  const partPrice = parseFloat(String(f.partPrice ?? "0")) || 0;
  const labor = parseFloat(String(f.laborHours ?? "0")) || 0;
  return partPrice * Number(f.quantity ?? 0) + labor * laborRate;
}

function makeEdits(f: WetCheckFinding, configs: IssueTypeConfig[]): FindingEdits {
  const cfg = configs.find(c => c.issueType === f.issueType);
  const laborFromTech = parseFloat(String(f.laborHours ?? "0"));
  const fallback = cfg ? parseFloat(String(cfg.defaultLaborHours)) : 0;
  const labor = Number.isFinite(laborFromTech) && laborFromTech > 0 ? laborFromTech : (fallback || 0);
  return {
    partId: f.partId ?? null,
    partName: f.partName ?? null,
    partPrice: f.partPrice != null ? String(f.partPrice) : null,
    quantity: Math.max(1, Number(f.quantity ?? 1) || 1),
    laborHours: String(labor),
  };
}

export function WetCheckWizard({ id }: { id: number }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: wc, isLoading } = useQuery<WetCheckWithDetails>({
    queryKey: ["/api/wet-checks", id],
    queryFn: () => apiRequest(`/api/wet-checks/${id}`),
  });
  const { data: customer } = useQuery<Customer>({
    queryKey: ["/api/customers", wc?.customerId],
    queryFn: () => apiRequest(`/api/customers/${wc!.customerId}`),
    enabled: !!wc?.customerId,
  });
  const { data: parts = [] } = useQuery<Part[]>({ queryKey: ["/api/parts"] });
  const { data: issueConfigs = [] } = useQuery<IssueTypeConfig[]>({
    queryKey: ["/api/wet-checks/issue-types"],
  });

  const customerLaborRate = parseFloat(String(customer?.laborRate ?? "45")) || 45;

  const allFindings: FindingItem[] = useMemo(() => {
    if (!wc) return [];
    return wc.zoneRecords.flatMap(zr => zr.findings.map(f => ({ f, zr })));
  }, [wc]);

  const pendingFindings = useMemo(
    () => allFindings.filter(({ f }) => (f.resolution ?? "pending") === "pending" && f.convertedAt == null),
    [allFindings],
  );

  const autoBilled = useMemo(
    () => allFindings.filter(({ f }) => f.resolution === "repaired_in_field" && f.billingSheetId != null),
    [allFindings],
  );

  // N = total findings that need (or needed) a manager decision.
  // Excludes the auto-billed-in-field rows.
  const totalDecisions = allFindings.filter(({ f }) =>
    !(f.resolution === "repaired_in_field" && f.billingSheetId != null),
  ).length;
  const completedDecisions = totalDecisions - pendingFindings.length;
  const progressPct = totalDecisions === 0 ? 100 : Math.round((completedDecisions / totalDecisions) * 100);

  const [activeId, setActiveId] = useState<number | null>(null);
  const [edits, setEdits] = useState<FindingEdits | null>(null);

  // The active finding is whichever pending row matches our explicit pointer.
  // If the pointer is stale (initial mount, refetch dropped the row, etc.) we
  // fall back to the first pending finding so the wizard always has work to do.
  const activeIdx = activeId == null ? -1 : pendingFindings.findIndex(p => p.f.id === activeId);
  const active = activeIdx >= 0 ? pendingFindings[activeIdx] : (pendingFindings[0] ?? null);
  const upNext = pendingFindings.filter(p => p.f.id !== active?.f.id);

  const photosByFinding = useMemo(() => {
    const m = new Map<number, WetCheckPhoto[]>();
    if (!wc) return m;
    for (const p of wc.photos) {
      if (p.findingId == null) continue;
      const arr = m.get(p.findingId) ?? [];
      arr.push(p); m.set(p.findingId, arr);
    }
    return m;
  }, [wc]);

  // Sync the explicit pointer + edit buffer with whichever finding is active.
  // Setting activeId from inside this effect (rather than deriving it) keeps
  // manual navigation (Skip / Save & next) authoritative — those handlers
  // bump activeId directly and the next render sees `active` follow.
  useEffect(() => {
    if (!active) {
      if (activeId !== null) setActiveId(null);
      if (edits !== null) setEdits(null);
      return;
    }
    if (active.f.id !== activeId) {
      setActiveId(active.f.id);
      setEdits(makeEdits(active.f, issueConfigs));
    }
  }, [active, activeId, edits, issueConfigs]);

  // Bundle-building chip — track findings sent to estimate during this session.
  const [bundleIds, setBundleIds] = useState<Set<number>>(new Set());
  const [bundleTotal, setBundleTotal] = useState(0);

  const editMut = useMutation({
    mutationFn: (vars: { fid: number; patch: FindingEdits }) =>
      apiRequest(`/api/wet-checks/findings/${vars.fid}`, "PATCH", {
        partId: vars.patch.partId,
        partName: vars.patch.partName,
        partPrice: vars.patch.partPrice,
        quantity: vars.patch.quantity,
        laborHours: vars.patch.laborHours,
      }),
  });

  const routeMut = useMutation({
    mutationFn: (vars: { fid: number; resolution: Resolution }) =>
      apiRequest(`/api/wet-checks/findings/${vars.fid}/route`, "PATCH", { resolution: vars.resolution }),
  });

  const convertMut = useMutation({
    mutationFn: () => apiRequest(`/api/wet-checks/${id}/convert`, "POST", {}),
    onSuccess: (result: { billingSheetId: number | null; estimateId: number | null; workOrderId: number | null }) => {
      const bits: string[] = [];
      if (result.billingSheetId) bits.push(`Billing #${result.billingSheetId}`);
      if (result.estimateId) bits.push(`Estimate #${result.estimateId}`);
      if (result.workOrderId) bits.push(`Work order #${result.workOrderId}`);
      toast({ title: "Wet check converted", description: bits.join(" · ") || "No new records created" });
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks", id] });
      navigate("/manager/wet-checks");
    },
    onError: (e: Error) => toast({ title: "Convert failed", description: e?.message, variant: "destructive" }),
  });

  const advancing = editMut.isPending || routeMut.isPending || convertMut.isPending;

  const handleDecision = async (resolution: Exclude<Resolution, "pending">) => {
    if (!active || !edits) return;
    try {
      await editMut.mutateAsync({ fid: active.f.id, patch: edits });
      await routeMut.mutateAsync({ fid: active.f.id, resolution });
      if (resolution === "sent_to_estimate") {
        const t = lineTotal(edits, customerLaborRate);
        setBundleIds(prev => {
          if (prev.has(active.f.id)) return prev;
          const next = new Set(prev); next.add(active.f.id); return next;
        });
        setBundleTotal(prev => prev + t);
      }
      const remaining = pendingFindings.length - 1;
      await queryClient.invalidateQueries({ queryKey: ["/api/wet-checks", id] });
      if (remaining <= 0) {
        // Last pending finding handled — hand off to the existing convert flow.
        // 5D will replace this with the confirm/done screens.
        convertMut.mutate();
      }
    } catch (e: any) {
      toast({ title: "Failed to save", description: e?.message, variant: "destructive" });
    }
  };

  const handleSkip = async () => {
    if (!active) return;
    // Resolution is already pending; just rotate to the next one locally.
    const idx = pendingFindings.findIndex(p => p.f.id === active.f.id);
    const next = pendingFindings[idx + 1];
    if (next) {
      setActiveId(next.f.id);
      setEdits(makeEdits(next.f, issueConfigs));
    } else {
      toast({ title: "No more pending findings", description: "This is the last one." });
    }
  };

  const handleSaveNext = async () => {
    if (!active || !edits) return;
    try {
      await editMut.mutateAsync({ fid: active.f.id, patch: edits });
      await queryClient.invalidateQueries({ queryKey: ["/api/wet-checks", id] });
      const idx = pendingFindings.findIndex(p => p.f.id === active.f.id);
      const next = pendingFindings[idx + 1];
      if (next) {
        setActiveId(next.f.id);
        setEdits(makeEdits(next.f, issueConfigs));
      }
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
    }
  };

  if (isLoading || !wc) {
    return <div className="flex justify-center py-10"><Loader2 className="animate-spin" /></div>;
  }

  const autoBilledTotal = autoBilled.reduce((s, { f }) => s + lineTotalFinding(f, customerLaborRate), 0);
  const autoBilledSheetId = autoBilled[0]?.f.billingSheetId ?? null;

  // Resume / empty state — no pending findings remain.
  if (!active) {
    return (
      <div className="max-w-3xl mx-auto py-4 space-y-4">
        <BackLink />
        <AutoBilledBanner
          count={autoBilled.length}
          total={autoBilledTotal}
          technicianName={wc.technicianName}
          billingSheetId={autoBilledSheetId}
        />
        <Card>
          <CardContent className="py-8 text-center space-y-4">
            <ListChecks className="w-10 h-10 mx-auto text-green-600" />
            <div className="text-lg font-semibold">All findings have a decision</div>
            <p className="text-sm text-gray-600">Nothing left to triage on this wet check.</p>
            {wc.status !== "converted" && (
              <Button
                onClick={() => convertMut.mutate()}
                disabled={convertMut.isPending}
                data-testid="wizard-convert-now"
              >
                {convertMut.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                Convert wet check
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const decisionIndex = completedDecisions + 1;
  const issueConfig = issueConfigs.find(c => c.issueType === active.f.issueType) ?? null;

  return (
    <div className="max-w-3xl mx-auto py-4 space-y-4">
      <BackLink />

      <div className="space-y-2" data-testid="wizard-header">
        <div className="text-xs text-gray-500">
          {wc.customerName} · <span className="text-gray-400">WC-{wc.id}</span>
        </div>
        <h1 className="text-2xl font-bold">Decision {decisionIndex} of {totalDecisions || 1}</h1>
        <div className="bg-gray-100 rounded-full overflow-hidden" style={{ height: 6, width: 90 }}>
          <div
            className="bg-blue-500 transition-all"
            style={{ width: `${progressPct}%`, height: 6 }}
            data-testid="wizard-progress-bar"
          />
        </div>
        <div className="text-xs text-gray-500" data-testid="wizard-progress-label">{progressPct}% complete</div>
      </div>

      <AutoBilledBanner
        count={autoBilled.length}
        total={autoBilledTotal}
        technicianName={wc.technicianName}
        billingSheetId={autoBilledSheetId}
      />

      {bundleIds.size > 0 && (
        <Card className="border-blue-200 bg-blue-50/60" data-testid="wizard-bundle-chip">
          <CardContent className="py-2 flex items-center gap-2 text-sm text-blue-900">
            <FileText className="w-4 h-4 text-blue-700" />
            <span>
              Building estimate: {bundleIds.size} finding{bundleIds.size === 1 ? "" : "s"} · ${bundleTotal.toFixed(2)}
            </span>
          </CardContent>
        </Card>
      )}

      {edits && (
        <FindingCard
          finding={active.f}
          zone={active.zr}
          photos={photosByFinding.get(active.f.id) ?? []}
          parts={parts}
          issueConfig={issueConfig}
          customerLaborRate={customerLaborRate}
          edits={edits}
          onChange={setEdits}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="wizard-decision-row">
        <DecisionCard
          testId="wizard-decision-estimate"
          accent="blue"
          icon={FileText}
          title="Send to estimate"
          helper="Customer must approve before work starts"
          disabled={advancing}
          loading={advancing}
          onClick={() => handleDecision("sent_to_estimate")}
        />
        <DecisionCard
          testId="wizard-decision-work-order"
          accent="purple"
          icon={Wrench}
          title="Queue as work order"
          helper="Adds to the work queue, schedule any time"
          disabled={advancing}
          onClick={() => handleDecision("deferred_to_work_order")}
        />
        <DecisionCard
          testId="wizard-decision-document"
          accent="gray"
          icon={FileCheck}
          title="Document only"
          helper="Logged for the record, no work scheduled"
          disabled={advancing}
          onClick={() => handleDecision("documented_only")}
        />
      </div>

      {upNext.length > 0 && (
        <div className="space-y-2" data-testid="wizard-up-next">
          <div className="text-xs uppercase tracking-wide text-gray-500">Up next</div>
          {upNext.map(({ f, zr }) => {
            const cfg = issueConfigs.find(c => c.issueType === f.issueType) ?? null;
            return (
              <div
                key={f.id}
                className="rounded-md border bg-gray-50 px-3 py-2 text-xs text-gray-600 flex items-center justify-between"
                data-testid={`wizard-up-next-${f.id}`}
              >
                <span className="truncate">
                  {cfg?.displayLabel ?? f.partName ?? f.issueType} · Controller {zr.controllerLetter} · Zone {zr.zoneNumber}
                </span>
                <Badge variant="outline" className="text-[10px]">Pending</Badge>
              </div>
            );
          })}
        </div>
      )}

      <div className="sticky bottom-0 bg-white border-t py-3 flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          onClick={handleSkip}
          disabled={advancing}
          data-testid="wizard-skip"
        >
          Skip for now
        </Button>
        <Button
          variant="outline"
          onClick={handleSaveNext}
          disabled={advancing}
          data-testid="wizard-save-next"
        >
          {advancing && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
          Save &amp; next
        </Button>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/manager/wet-checks">
      <Button variant="ghost" data-testid="wizard-back-to-inbox">
        <ChevronLeft className="w-4 h-4 mr-1" /> Back to inbox
      </Button>
    </Link>
  );
}
