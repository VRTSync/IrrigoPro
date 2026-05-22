import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useArrayQuery } from "@/lib/queryClient";
import { safeGet } from "@/utils/safeStorage";
import { HeaderStrip } from "@/components/admin-dashboard/header-strip";
import { KpiTile } from "@/components/admin-dashboard/kpi-tile";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, AlertTriangle, DollarSign } from "lucide-react";
import { Loader2 } from "lucide-react";
import { WetCheckCard, type WetCheckCardData } from "@/components/manager/wet-check-card";
import type { WetCheck, WetCheckBilling } from "@workspace/db/schema";

interface User { id: number; companyId?: number; name: string; role: string; }

type PendingReviewRow = WetCheck & {
  findingCounts: { quick_fix: number; advanced: number; zone_issue: number; total: number };
  totalBillable: string;
  customerLaborRate: string;
  autoBilledCount: number;
  autoBilledTotal: string;
  pendingCount: number;
  pendingTotal: string;
  dispositionCounts: { completed_in_field: number; needs_review: number };
};

function isToday(raw: string | Date | null | undefined): boolean {
  if (!raw) return false;
  const d = new Date(raw);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function toNumber(x: unknown): number {
  if (typeof x === "number") return Number.isFinite(x) ? x : 0;
  if (typeof x === "string") {
    const n = parseFloat(x);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export default function ManagerWetChecksPage() {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    const saved = safeGet("user");
    if (saved) {
      try { setUser(JSON.parse(saved)); } catch { /* ignore */ }
    }
  }, []);

  const pendingQ = useArrayQuery<PendingReviewRow>({
    queryKey: ["/api/wet-checks/pending-review"],
  });

  const wetCheckBillingsQ = useArrayQuery<WetCheckBilling>({
    queryKey: ["/api/wet-check-billings"],
  });

  const rows = pendingQ.data ?? [];

  // Sort oldest-first by submittedAt so the manager triages the longest-
  // waiting wet checks first. Wet checks without a submittedAt (still
  // in_progress shouldn't appear here, but defend anyway) sink to the end.
  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aT = a.submittedAt ? new Date(a.submittedAt).getTime() : Number.POSITIVE_INFINITY;
      const bT = b.submittedAt ? new Date(b.submittedAt).getTime() : Number.POSITIVE_INFINITY;
      return aT - bT;
    });
  }, [rows]);

  const todayWcStats = useMemo(() => {
    const billings = wetCheckBillingsQ.data ?? [];
    let total = 0;
    let count = 0;
    for (const wcb of billings) {
      if (!isToday(wcb.workDate)) continue;
      total += toNumber(wcb.totalAmount);
      count++;
    }
    return { total, wetChecks: count };
  }, [wetCheckBillingsQ.data]);

  const pendingFindingsTotal = useMemo(() => {
    return rows.reduce((sum, r) => sum + r.pendingCount, 0);
  }, [rows]);

  const queueIsEmpty = !pendingQ.isLoading && rows.length === 0;
  const health = queueIsEmpty ? "green" : "amber";
  const healthLabel = queueIsEmpty ? "All clear" : "Needs attention";

  const pendingHelper = pendingQ.isLoading
    ? undefined
    : `${pendingFindingsTotal} finding${pendingFindingsTotal === 1 ? "" : "s"} to decide`;
  const completedHelper = wetCheckBillingsQ.isLoading
    ? undefined
    : `${todayWcStats.wetChecks} wet check${todayWcStats.wetChecks === 1 ? "" : "s"} billed`;

  return (
    <div className="max-w-5xl mx-auto py-4 space-y-4" data-testid="manager-wet-checks-page">
      <HeaderStrip
        name={user?.name}
        health={health}
        healthLabel={healthLabel}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiTile
          label="Pending review"
          value={pendingQ.isLoading ? null : rows.length}
          icon={AlertTriangle}
          accent="amber"
          isLoading={pendingQ.isLoading}
          isError={pendingQ.isError}
          helper={pendingHelper}
          testId="kpi-pending-review"
        />
        <KpiTile
          label="Wet check work completed today"
          value={wetCheckBillingsQ.isLoading ? null : `$${todayWcStats.total.toFixed(2)}`}
          icon={DollarSign}
          accent="blue"
          href="/wet-check-billings"
          isLoading={wetCheckBillingsQ.isLoading}
          isError={wetCheckBillingsQ.isError}
          helper={completedHelper}
          testId="kpi-completed-today"
        />
      </div>

      {pendingQ.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="animate-spin" />
        </div>
      ) : queueIsEmpty ? (
        <Card data-testid="manager-wc-empty-state">
          <CardContent className="py-10 text-center space-y-2">
            <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto" />
            <h3 className="text-lg font-semibold text-gray-900">You're all caught up</h3>
            <p className="text-sm text-gray-500">
              No wet checks are waiting on a decision right now.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2" data-testid="manager-wc-card-list">
          {sortedRows.map((wc) => {
            const data: WetCheckCardData = {
              id: wc.id,
              customerName: wc.customerName,
              propertyAddress: wc.propertyAddress,
              technicianName: wc.technicianName,
              submittedAt: wc.submittedAt,
              autoBilledCount: wc.autoBilledCount,
              autoBilledTotal: wc.autoBilledTotal,
              pendingCount: wc.pendingCount,
              pendingTotal: wc.pendingTotal,
              dispositionCounts: wc.dispositionCounts,
            };
            return <WetCheckCard key={wc.id} wc={data} />;
          })}
        </div>
      )}
    </div>
  );
}
