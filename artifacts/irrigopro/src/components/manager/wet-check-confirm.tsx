import { useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, asArray, queryClient, useArrayQuery } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft, Loader2, FileText, Wrench, FileCheck, CheckCircle2,
} from "lucide-react";
import type {
  Customer, IssueTypeConfig, WetCheckFinding, WetCheckWithDetails, WetCheckZoneRecord,
} from "@workspace/db/schema";

type Resolution = WetCheckFinding["resolution"];
interface FindingItem { f: WetCheckFinding; zr: WetCheckZoneRecord; }

function lineTotal(f: WetCheckFinding, laborRate: number): number {
  const partPrice = parseFloat(String(f.partPrice ?? "0")) || 0;
  const labor = parseFloat(String(f.laborHours ?? "0")) || 0;
  return partPrice * Number(f.quantity ?? 0) + labor * laborRate;
}

function describeFinding(item: FindingItem, configs: IssueTypeConfig[]): string {
  const cfg = configs.find(c => c.issueType === item.f.issueType);
  const label = cfg?.displayLabel ?? item.f.issueType.replace(/_/g, " ");
  return `${label.toLowerCase()} at Zone ${item.zr.zoneNumber}`;
}

interface SummaryRowProps {
  testId: string;
  accent: "blue" | "purple" | "gray" | "green";
  icon: React.ComponentType<{ className?: string }>;
  primary: string;
  secondary: string;
  editHref?: string;
}
const ACCENTS: Record<SummaryRowProps["accent"], { bar: string; iconBg: string; iconText: string }> = {
  blue:   { bar: "border-l-blue-500",   iconBg: "bg-blue-50",   iconText: "text-blue-600" },
  purple: { bar: "border-l-purple-500", iconBg: "bg-purple-50", iconText: "text-purple-600" },
  gray:   { bar: "border-l-gray-400",   iconBg: "bg-gray-100",  iconText: "text-gray-600" },
  green:  { bar: "border-l-green-500",  iconBg: "bg-green-50",  iconText: "text-green-600" },
};

function SummaryRow({ testId, accent, icon: Icon, primary, secondary, editHref }: SummaryRowProps) {
  const a = ACCENTS[accent];
  return (
    <div
      className={`border-l-4 ${a.bar} bg-white px-4 py-3 flex items-start gap-3`}
      data-testid={testId}
    >
      <div className={`${a.iconBg} p-2 rounded-md shrink-0`}>
        <Icon className={`w-4 h-4 ${a.iconText}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-gray-900">{primary}</div>
        <div className="text-xs text-gray-600 mt-0.5">{secondary}</div>
      </div>
      {editHref && (
        <Link href={editHref}>
          <Button
            variant="link"
            size="sm"
            className="text-xs text-blue-600 h-auto p-0 shrink-0"
            data-testid={`${testId}-edit`}
          >
            Edit
          </Button>
        </Link>
      )}
    </div>
  );
}

export function WetCheckConfirm({ id }: { id: number }) {
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
  const { data: issueConfigs = [] } = useArrayQuery<IssueTypeConfig>({
    queryKey: ["/api/wet-checks/issue-types"],
  });

  const customerLaborRate = parseFloat(String(customer?.laborRate ?? "45")) || 45;

  const allFindings: FindingItem[] = useMemo(() => {
    if (!wc) return [];
    // Task #540 — null-safe traversal of nested arrays.
    return asArray(wc.zoneRecords).flatMap(zr =>
      asArray(zr.findings).map(f => ({ f, zr })),
    );
  }, [wc]);

  const groups = useMemo(() => {
    const by = (r: Resolution) => allFindings.filter(({ f }) => f.resolution === r);
    return {
      sentEst: by("sent_to_estimate"),
      deferred: by("deferred_to_work_order"),
      documented: by("documented_only"),
      repaired: by("repaired_in_field"),
    };
  }, [allFindings]);

  const totals = useMemo(() => ({
    estimate:  groups.sentEst.reduce((s, it) => s + lineTotal(it.f, customerLaborRate), 0),
    workOrder: groups.deferred.reduce((s, it) => s + lineTotal(it.f, customerLaborRate), 0),
    repaired:  groups.repaired.reduce((s, it) => s + lineTotal(it.f, customerLaborRate), 0),
  }), [groups, customerLaborRate]);

  const convertMut = useMutation({
    mutationFn: () => apiRequest(`/api/wet-checks/${id}/convert`, "POST", {}),
    onSuccess: (resp: any) => {
      // Stash an authoritative convert end-time so the done screen's
      // time-to-complete copy never drifts. Prefer the server-provided
      // fullyConvertedAt from the convert response; fall back to client
      // clock so the value is still populated if the field is absent.
      const serverTs = resp?.wetCheck?.fullyConvertedAt;
      const stamp = serverTs ? new Date(serverTs).getTime() : Date.now();
      try {
        sessionStorage.setItem(`wc-converted-at-${id}`, String(stamp));
      } catch { /* sessionStorage may be unavailable; the fallback still works */ }
      // Done screen reads the freshly-updated wet check; invalidate so it
      // sees fullyConvertedAt + linked estimate/WO/billing IDs on findings.
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks/pending-review"] });
      navigate(`/manager/wet-checks/${id}/done`);
    },
    onError: (e: Error) => toast({
      title: "Convert failed",
      description: e?.message ?? "Could not finalize this wet check.",
      variant: "destructive",
    }),
  });

  if (isLoading || !wc) {
    return <div className="flex justify-center py-10"><Loader2 className="animate-spin" /></div>;
  }

  const firstSentEst   = groups.sentEst[0];
  const firstDeferred  = groups.deferred[0];
  const firstDocumentd = groups.documented[0];
  const firstRepaired  = groups.repaired[0];
  const repairedSheetId = groups.repaired.find(it => it.f.billingSheetId != null)?.f.billingSheetId ?? null;

  const hasAnyAction =
    groups.sentEst.length > 0 || groups.deferred.length > 0 ||
    groups.documented.length > 0 || groups.repaired.length > 0;

  return (
    <div className="max-w-3xl mx-auto py-4 space-y-4 px-4 sm:px-0" data-testid="wet-check-confirm">
      <Link href={`/manager/wet-checks/${id}`}>
        <Button variant="ghost" data-testid="confirm-back-to-wizard">
          <ChevronLeft className="w-4 h-4 mr-1" /> Back to wizard
        </Button>
      </Link>

      <div className="space-y-1">
        <h1 className="text-2xl font-bold" data-testid="confirm-heading">
          Almost done — review and confirm
        </h1>
        <div className="text-sm text-gray-500" data-testid="confirm-subtitle">
          {wc.customerName} · WC-{wc.id}
        </div>
      </div>

      <Card className="overflow-hidden" data-testid="confirm-summary-card">
        <CardContent className="p-0 divide-y">
          {!hasAnyAction && (
            <div className="px-4 py-6 text-sm text-gray-500 text-center" data-testid="confirm-empty">
              No findings to act on. Confirming will simply finalize the wet check.
            </div>
          )}

          {groups.sentEst.length > 0 && firstSentEst && (
            <SummaryRow
              testId="confirm-row-estimate"
              accent="blue"
              icon={FileText}
              primary={`1 estimate will be created · $${totals.estimate.toFixed(2)}`}
              secondary={`${describeFinding(firstSentEst, issueConfigs)} · ${groups.sentEst.length} line item${groups.sentEst.length === 1 ? "" : "s"} · customer approval email will send`}
              editHref={`/manager/wet-checks/${id}?edit=${firstSentEst.f.id}`}
            />
          )}

          {groups.deferred.length > 0 && firstDeferred && (
            <SummaryRow
              testId="confirm-row-work-order"
              accent="purple"
              icon={Wrench}
              primary={`1 work order added to queue · $${totals.workOrder.toFixed(2)}`}
              secondary={`${describeFinding(firstDeferred, issueConfigs)} · unscheduled · schedule any time from work orders list`}
              editHref={`/manager/wet-checks/${id}?edit=${firstDeferred.f.id}`}
            />
          )}

          {groups.documented.length > 0 && firstDocumentd && (
            <SummaryRow
              testId="confirm-row-documented"
              accent="gray"
              icon={FileCheck}
              primary={`${groups.documented.length} finding${groups.documented.length === 1 ? "" : "s"} documented`}
              secondary={`${describeFinding(firstDocumentd, issueConfigs)} · no action needed`}
              editHref={`/manager/wet-checks/${id}?edit=${firstDocumentd.f.id}`}
            />
          )}

          {groups.repaired.length > 0 && firstRepaired && (
            <SummaryRow
              testId="confirm-row-completed-in-field"
              accent="green"
              icon={CheckCircle2}
              primary={`${groups.repaired.length} finding${groups.repaired.length === 1 ? "" : "s"} completed in field · $${totals.repaired.toFixed(2)}`}
              secondary={`repaired by ${wc.technicianName} during wet check${repairedSheetId ? ` · wet check billing #${repairedSheetId}` : ""}`}
              editHref={`/manager/wet-checks/${id}?edit=${firstRepaired.f.id}`}
            />
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
        <Link
          href={
            firstSentEst || firstDeferred || firstDocumentd || firstRepaired
              ? `/manager/wet-checks/${id}?edit=${(firstSentEst ?? firstDeferred ?? firstDocumentd ?? firstRepaired)!.f.id}`
              : `/manager/wet-checks/${id}`
          }
        >
          <Button variant="outline" data-testid="confirm-edit-decisions">
            Edit decisions
          </Button>
        </Link>
        <Button
          onClick={() => convertMut.mutate()}
          disabled={convertMut.isPending}
          data-testid="confirm-convert"
        >
          {convertMut.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
          Confirm and convert
        </Button>
      </div>
    </div>
  );
}
