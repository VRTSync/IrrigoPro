import { useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, asArray, useArrayQuery } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Check, FileText, Wrench, FileCheck, CheckCircle2 } from "lucide-react";
import type {
  Customer, WetCheck, WetCheckFinding, WetCheckWithDetails, WetCheckZoneRecord,
} from "@workspace/db/schema";

interface FindingItem { f: WetCheckFinding; zr: WetCheckZoneRecord; }

function lineTotal(f: WetCheckFinding, laborRate: number): number {
  const partPrice = parseFloat(String(f.partPrice ?? "0")) || 0;
  const labor = parseFloat(String(f.laborHours ?? "0")) || 0;
  return partPrice * Number(f.quantity ?? 0) + labor * laborRate;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "moments";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "less than a minute";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (rem === 0) return `${hrs} hour${hrs === 1 ? "" : "s"}`;
  return `${hrs}h ${rem}m`;
}

type PendingReviewRow = WetCheck;

interface OutcomeRowProps {
  testId: string;
  accent: "green" | "blue" | "purple" | "gray";
  icon: React.ComponentType<{ className?: string }>;
  primary: string;
  link?: { href: string; label: string };
}
const ACCENTS: Record<OutcomeRowProps["accent"], { bar: string; iconBg: string; iconText: string }> = {
  green:  { bar: "border-l-green-500",  iconBg: "bg-green-50",  iconText: "text-green-600" },
  blue:   { bar: "border-l-blue-500",   iconBg: "bg-blue-50",   iconText: "text-blue-600" },
  purple: { bar: "border-l-purple-500", iconBg: "bg-purple-50", iconText: "text-purple-600" },
  gray:   { bar: "border-l-gray-400",   iconBg: "bg-gray-100",  iconText: "text-gray-600" },
};

function OutcomeRow({ testId, accent, icon: Icon, primary, link }: OutcomeRowProps) {
  const a = ACCENTS[accent];
  return (
    <div
      className={`border-l-4 ${a.bar} bg-white px-4 py-3 flex items-center gap-3`}
      data-testid={testId}
    >
      <div className={`${a.iconBg} p-2 rounded-md shrink-0`}>
        <Icon className={`w-4 h-4 ${a.iconText}`} />
      </div>
      <div className="text-sm text-gray-900 flex-1 min-w-0">{primary}</div>
      {link && (
        <Link href={link.href}>
          <Button
            variant="link"
            size="sm"
            className="text-blue-600 h-auto p-0"
            data-testid={`${testId}-link`}
          >
            {link.label}
          </Button>
        </Link>
      )}
    </div>
  );
}

export function WetCheckDone({ id }: { id: number }) {
  const [, navigate] = useLocation();

  const { data: wc, isLoading } = useQuery<WetCheckWithDetails>({
    queryKey: ["/api/wet-checks", id],
    queryFn: () => apiRequest(`/api/wet-checks/${id}`),
  });
  const { data: customer } = useQuery<Customer>({
    queryKey: ["/api/customers", wc?.customerId],
    queryFn: () => apiRequest(`/api/customers/${wc!.customerId}`),
    enabled: !!wc?.customerId,
  });
  const { data: pending = [] } = useArrayQuery<PendingReviewRow>({
    queryKey: ["/api/wet-checks/pending-review"],
  });

  const customerLaborRate = parseFloat(String(customer?.laborRate ?? "45")) || 45;

  const allFindings: FindingItem[] = useMemo(() => {
    if (!wc) return [];
    // Task #540 — null-safe traversal of nested arrays.
    return asArray(wc.zoneRecords).flatMap(zr =>
      asArray(zr.findings).map(f => ({ f, zr })),
    );
  }, [wc]);

  const groups = useMemo(() => ({
    repaired:   allFindings.filter(({ f }) => f.resolution === "repaired_in_field"),
    sentEst:    allFindings.filter(({ f }) => f.resolution === "sent_to_estimate"),
    deferred:   allFindings.filter(({ f }) => f.resolution === "deferred_to_work_order"),
    documented: allFindings.filter(({ f }) => f.resolution === "documented_only"),
  }), [allFindings]);

  const totals = useMemo(() => ({
    repaired:  groups.repaired.reduce((s, it) => s + lineTotal(it.f, customerLaborRate), 0),
    estimate:  groups.sentEst.reduce((s, it) => s + lineTotal(it.f, customerLaborRate), 0),
    workOrder: groups.deferred.reduce((s, it) => s + lineTotal(it.f, customerLaborRate), 0),
  }), [groups, customerLaborRate]);

  const estimateId = groups.sentEst.find(it => it.f.estimateId != null)?.f.estimateId ?? null;
  const workOrderId = groups.deferred.find(it => it.f.workOrderId != null)?.f.workOrderId ?? null;

  const totalDecisions = allFindings.length;
  const durationMs = useMemo(() => {
    if (!wc?.submittedAt) return 0;
    const start = new Date(wc.submittedAt).getTime();
    // Prefer the persisted convert timestamp; if the wet check refetch hasn't
    // landed yet, use the moment we stashed in confirm right after the convert
    // call returned. Final fallback is now() so the copy never blanks out.
    let end = Date.now();
    if (wc.fullyConvertedAt) {
      end = new Date(wc.fullyConvertedAt).getTime();
    } else {
      try {
        const stashed = sessionStorage.getItem(`wc-converted-at-${id}`);
        const n = stashed ? parseInt(stashed) : NaN;
        if (Number.isFinite(n)) end = n;
      } catch { /* sessionStorage may be unavailable; fall through to now() */ }
    }
    return end - start;
  }, [wc, id]);

  const remainingPending = useMemo(
    () => pending.filter(p => p.id !== id),
    [pending, id],
  );
  const nextWetCheckId = remainingPending[0]?.id ?? null;

  if (isLoading || !wc) {
    return <div className="flex justify-center py-10"><Loader2 className="animate-spin" /></div>;
  }

  return (
    <div className="max-w-3xl mx-auto py-8 space-y-6 px-4 sm:px-0" data-testid="wet-check-done">
      <style>{`
        @keyframes wetCheckHeroScale {
          0% { transform: scale(0.6); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        .wet-check-hero {
          animation: wetCheckHeroScale 200ms ease-out both;
        }
      `}</style>

      <div className="text-center space-y-3">
        <div
          className="wet-check-hero mx-auto rounded-full bg-green-100 flex items-center justify-center"
          style={{ width: 56, height: 56 }}
          data-testid="done-hero-check"
        >
          <Check className="w-8 h-8 text-green-600" />
        </div>
        <h1 className="text-2xl font-bold" data-testid="done-heading">Wet check complete</h1>
        <div className="text-sm text-gray-500" data-testid="done-subtitle">
          {totalDecisions} finding{totalDecisions === 1 ? "" : "s"} handled in {formatDuration(durationMs)}
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0 divide-y">
          <OutcomeRow
            testId="done-row-completed-in-field"
            accent="green"
            icon={CheckCircle2}
            primary={`${groups.repaired.length} completed in field · $${totals.repaired.toFixed(2)}`}
          />
          <OutcomeRow
            testId="done-row-estimate"
            accent="blue"
            icon={FileText}
            primary={`Estimate sent for approval · $${totals.estimate.toFixed(2)}`}
            link={estimateId ? { href: `/estimates?openEstimate=${estimateId}`, label: "View estimate" } : undefined}
          />
          <OutcomeRow
            testId="done-row-work-order"
            accent="purple"
            icon={Wrench}
            primary={`Added to work queue · $${totals.workOrder.toFixed(2)}`}
            link={workOrderId ? { href: `/work-orders?openWorkOrder=${workOrderId}`, label: "View work order" } : undefined}
          />
          <OutcomeRow
            testId="done-row-documented"
            accent="gray"
            icon={FileCheck}
            primary={`${groups.documented.length} documented`}
          />
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => navigate("/manager")}
          data-testid="done-done-for-now"
        >
          Done for now
        </Button>
        {nextWetCheckId != null && (
          <Button
            onClick={() => navigate(`/manager/wet-checks/${nextWetCheckId}`)}
            data-testid="done-review-next"
          >
            Review next ({remainingPending.length} remaining)
          </Button>
        )}
      </div>
    </div>
  );
}
