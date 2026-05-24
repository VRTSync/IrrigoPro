import { useLocation, useRoute } from "wouter";
import { useArrayQuery } from "@/lib/queryClient";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer, PageContent, PageHeader } from "@/components/ui/page-header";
import {
  Loader2,
  MapPin,
  User,
  Clock,
  Wrench,
  Zap,
  AlertTriangle,
  ClipboardCheck,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import type { WetCheck } from "@workspace/db/schema";
import { WetCheckWizard } from "@/components/manager/wet-check-wizard";

// ─── Types ────────────────────────────────────────────────────────────────────
type PendingReviewRow = WetCheck & {
  findingCounts: { quick_fix: number; advanced: number; zone_issue: number; total: number };
  totalBillable: string;
  customerLaborRate: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "submitted":
      return <Badge variant="info">Submitted</Badge>;
    case "partially_converted":
      return <Badge variant="warning">Partially Converted</Badge>;
    case "approved":
      return <Badge variant="success">Approved</Badge>;
    default:
      return (
        <Badge variant="secondary">
          {status
            .split("_")
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ")}
        </Badge>
      );
  }
}

function reviewButtonLabel(status: string): string {
  return status === "partially_converted" ? "Continue Review" : "Begin Review";
}

// ─── Card skeleton while loading ──────────────────────────────────────────────
function QueueCardSkeleton() {
  return (
    <Card className="border-l-4 border-l-slate-200">
      <CardContent className="pt-5 pb-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2 flex-1">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="text-right space-y-2 shrink-0">
            <Skeleton className="h-6 w-28 ml-auto" />
            <Skeleton className="h-7 w-20 ml-auto" />
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
      </CardContent>
      <CardFooter className="pt-0 border-t border-slate-100 justify-end">
        <Skeleton className="h-9 w-32" />
      </CardFooter>
    </Card>
  );
}

// ─── Single queue card ────────────────────────────────────────────────────────
function QueueCard({ wc, onReview }: { wc: PendingReviewRow; onReview: () => void }) {
  const { quick_fix, advanced, zone_issue } = wc.findingCounts;
  const totalVal = parseFloat(wc.totalBillable ?? "0");
  const isPartial = wc.status === "partially_converted";

  return (
    <Card
      className="border-l-4 border-l-cyan-500 hover:shadow-md transition-shadow duration-200 cursor-pointer"
      onClick={onReview}
      data-testid={`wc-row-${wc.id}`}
    >
      {/* Main body */}
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between gap-4">
          {/* Left — identity */}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base font-bold text-slate-900 leading-tight">
                {wc.customerName ?? "Unknown Customer"}
              </span>
              <StatusBadge status={wc.status ?? "submitted"} />
            </div>

            {wc.propertyAddress && (
              <div className="flex items-center gap-1.5 text-sm text-slate-500">
                <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                <span className="truncate">{wc.propertyAddress}</span>
              </div>
            )}

            <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
              {wc.technicianName && (
                <span className="flex items-center gap-1">
                  <User className="w-3.5 h-3.5" />
                  {wc.technicianName}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                Submitted {timeAgo(wc.submittedAt)}
              </span>
            </div>
          </div>

          {/* Right — value */}
          <div className="shrink-0 text-right space-y-0.5">
            <div className="text-xs text-slate-400 font-medium uppercase tracking-wide">
              Est. Value
            </div>
            <div
              className={`text-xl font-bold tabular-nums ${
                totalVal > 0 ? "text-emerald-600" : "text-slate-400"
              }`}
              data-testid={`wc-row-${wc.id}-total-billable`}
            >
              ${totalVal > 0 ? totalVal.toFixed(2) : "—"}
            </div>
          </div>
        </div>

        {/* Finding chips */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {quick_fix > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold bg-sky-50 text-sky-700 border border-sky-200"
              data-testid={`wc-row-${wc.id}-count-quick_fix`}
            >
              <Zap className="w-3 h-3" />
              Quick Fix
              <span className="ml-0.5 bg-sky-200 text-sky-800 rounded-full w-4 h-4 inline-flex items-center justify-center text-[10px] font-bold">
                {quick_fix}
              </span>
            </span>
          )}
          {advanced > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200"
              data-testid={`wc-row-${wc.id}-count-advanced`}
            >
              <Wrench className="w-3 h-3" />
              Advanced
              <span className="ml-0.5 bg-amber-200 text-amber-800 rounded-full w-4 h-4 inline-flex items-center justify-center text-[10px] font-bold">
                {advanced}
              </span>
            </span>
          )}
          {zone_issue > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold bg-red-50 text-red-700 border border-red-200"
              data-testid={`wc-row-${wc.id}-count-zone_issue`}
            >
              <AlertTriangle className="w-3 h-3" />
              Zone Issue
              <span className="ml-0.5 bg-red-200 text-red-800 rounded-full w-4 h-4 inline-flex items-center justify-center text-[10px] font-bold">
                {zone_issue}
              </span>
            </span>
          )}
          {quick_fix === 0 && advanced === 0 && zone_issue === 0 && (
            <span className="text-xs text-slate-400 italic">No findings recorded</span>
          )}
        </div>
      </CardContent>

      {/* Footer CTA */}
      <CardFooter className="pt-0 border-t border-slate-100 justify-between items-center">
        <span className="text-xs text-slate-400">
          {isPartial
            ? "Some findings still pending conversion"
            : `${wc.findingCounts.total} finding${wc.findingCounts.total !== 1 ? "s" : ""} to review`}
        </span>
        <Button
          size="sm"
          variant={isPartial ? "outline" : "default"}
          className={
            isPartial
              ? "border-amber-300 text-amber-700 hover:bg-amber-50"
              : "bg-cyan-600 hover:bg-cyan-700 text-white"
          }
          onClick={e => {
            e.stopPropagation();
            onReview();
          }}
        >
          {reviewButtonLabel(wc.status ?? "submitted")}
          <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
        </Button>
      </CardFooter>
    </Card>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyQueue() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center px-6">
      <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center mb-5">
        <CheckCircle2 className="w-8 h-8 text-emerald-500" />
      </div>
      <h2 className="text-lg font-bold text-slate-900 mb-1">All caught up</h2>
      <p className="text-sm text-slate-500 max-w-xs">
        No wet checks are waiting for review right now. New submissions will appear here automatically.
      </p>
    </div>
  );
}

// ─── Inbox ────────────────────────────────────────────────────────────────────
function PendingReviewInbox() {
  const [, navigate] = useLocation();

  const { data: rows = [], isLoading } = useArrayQuery<PendingReviewRow>({
    queryKey: ["/api/wet-checks/pending-review"],
  });

  return (
    <PageContainer>
      <PageHeader
        title="Wet Check Queue"
        subtitle={
          isLoading
            ? "Loading…"
            : rows.length === 0
            ? "No items pending review"
            : `${rows.length} wet check${rows.length !== 1 ? "s" : ""} awaiting review`
        }
        actions={
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-cyan-100 flex items-center justify-center">
              <ClipboardCheck className="w-4 h-4 text-cyan-600" />
            </div>
          </div>
        }
      />

      <PageContent>
        {isLoading ? (
          <div className="space-y-4">
            <QueueCardSkeleton />
            <QueueCardSkeleton />
            <QueueCardSkeleton />
          </div>
        ) : rows.length === 0 ? (
          <EmptyQueue />
        ) : (
          <div className="space-y-4">
            {rows.map(wc => (
              <QueueCard
                key={wc.id}
                wc={wc}
                onReview={() => navigate(`/manager/wet-checks/${wc.id}`)}
              />
            ))}
          </div>
        )}
      </PageContent>
    </PageContainer>
  );
}

// ─── Page entry ──────────────────────────────────────────────────────────────
// Both `/wet-checks/:id/review` (legacy) and `/manager/wet-checks/:id` render
// the wizard. The inbox renders when neither pattern matches.
export default function WetCheckReviewPage() {
  const [matchManager, managerParams] = useRoute<{ id: string }>("/manager/wet-checks/:id");
  const [matchLegacy, legacyParams] = useRoute<{ id: string }>("/wet-checks/:id/review");
  const id = matchManager
    ? parseInt(managerParams!.id)
    : matchLegacy
    ? parseInt(legacyParams!.id)
    : NaN;
  if (Number.isFinite(id)) return <WetCheckWizard id={id} />;
  return <PendingReviewInbox />;
}
