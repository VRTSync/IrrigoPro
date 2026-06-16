/**
 * CombinedReviewSurface — Slice 3
 *
 * Full-page review surface opened from a Needs Review row.
 * Composes the triage engine (WetCheckWizard) and the snapshot editor
 * (WetCheckBillingViewComponent) into one coherent surface.
 *
 * Triage step:  conditional — shown only when unrouted non-documented findings exist.
 * Snapshot step: always shown when a WCB exists.
 * Both steps are independently completable.
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, asArray, useArrayQuery } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertTriangle,
  ClipboardList,
  Loader2,
  Pencil,
  ThumbsUp,
} from "lucide-react";
import { WetCheckWizard } from "@/components/manager/wet-check-wizard";
import { WetCheckBillingViewComponent } from "@/components/billing/wet-check-billing-view";
import type { WetCheckBillingView } from "@/components/billing/wet-check-billing-view";
import { ActivityFeed } from "@/components/billing-workspace/activity-feed";
import { WcbLaborRateEdit } from "@/components/wet-check-billings/wcb-labor-rate-edit";
import { RateModeToggle } from "@/components/billing-workspace/rate-mode-toggle";
import { safeGet } from "@/utils/safeStorage";
import type {
  WetCheckWithDetails,
  WetCheckBilling,
  WetCheckBillingListItem,
} from "@workspace/db/schema";

// ── Role helpers ──────────────────────────────────────────────────────────────

function getUserRole(): string | null {
  try {
    const raw = safeGet("user");
    if (!raw) return null;
    return JSON.parse(raw)?.role ?? null;
  } catch {
    return null;
  }
}

function canSeePricing(): boolean {
  return getUserRole() !== "field_tech";
}

function canEditZoneLabor(): boolean {
  const role = getUserRole();
  return role === "billing_manager" || role === "company_admin" || role === "super_admin";
}

function canEditLaborFields(wcb: WetCheckBilling): boolean {
  if (!canEditZoneLabor()) return false;
  if (wcb.invoiceId != null) return false;
  if (wcb.status === "billed") return false;
  return true;
}

// ── Snapshot status helpers ───────────────────────────────────────────────────

function wcbStatusLabel(status: string): { label: string; className: string } {
  switch (status) {
    case "submitted":
    case "pending_manager_review":
      return { label: "Pending Approval", className: "bg-amber-50 text-amber-700 border-amber-200" };
    case "approved_passed_to_billing":
      return { label: "Approved", className: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "billed":
      return { label: "Billed", className: "bg-blue-50 text-blue-700 border-blue-200" };
    default:
      return {
        label: status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        className: "bg-gray-100 text-gray-600 border-gray-300",
      };
  }
}

function isApprovableStatus(status: string): boolean {
  return status === "submitted" || status === "pending_manager_review";
}

// ── Snapshot editor affordances (labor rate + rate-mode toggle) ───────────────
// Replicates EditAffordancesPanel from wet-check-billing-view-modal.tsx,
// but exported for use in this embedded context.

function SnapshotEditAffordances({
  wcb,
  onLaborSaved,
}: {
  wcb: WetCheckBilling & { customer?: { laborRate?: string | null; emergencyLaborRate?: string | null } | null };
  onLaborSaved: () => void;
}) {
  const [editingLaborRate, setEditingLaborRate] = useState(false);
  const currentRate = String(wcb.laborRate ?? "0");
  const rateMode = (wcb as any).rateMode ?? "normal";
  const customerRates = wcb.customer;

  return (
    <div className="space-y-3" data-testid="crs-wcb-edit-affordances">
      {customerRates && (
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <RateModeToggle
            entityPath="wet-check-billings"
            entityId={wcb.id}
            currentMode={rateMode as "normal" | "emergency"}
            normalRate={customerRates.laborRate ?? null}
            emergencyRate={customerRates.emergencyLaborRate ?? null}
            detailQueryKey={["/api/wet-check-billings", wcb.id]}
            disabled={false}
          />
        </div>
      )}
      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">Labor Rate</span>
            <span className="text-sm text-gray-900 font-semibold" data-testid="crs-wcb-labor-rate-display">
              ${parseFloat(currentRate).toFixed(2)}/hr
            </span>
          </div>
          {!editingLaborRate && (
            <button
              type="button"
              onClick={() => setEditingLaborRate(true)}
              className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
              data-testid="crs-wcb-labor-rate-pencil"
              aria-label="Edit labor rate"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {editingLaborRate && (
          <div className="mt-3">
            <WcbLaborRateEdit
              wcbId={wcb.id}
              currentRate={currentRate}
              onSuccess={onLaborSaved}
              onClose={() => setEditingLaborRate(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Snapshot section ──────────────────────────────────────────────────────────

interface SnapshotSectionProps {
  wetCheckId: number;
  wcbId: number;
  onApproveSuccess: () => void;
}

function SnapshotSection({ wetCheckId, wcbId, onApproveSuccess }: SnapshotSectionProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery<{
    wetCheckBilling: WetCheckBilling;
    customer: { laborRate: string | null; emergencyLaborRate: string | null } | null;
    view: WetCheckBillingView | null;
  }>({
    queryKey: ["/api/wet-check-billings", wcbId],
    queryFn: () => apiRequest(`/api/wet-check-billings/${wcbId}`),
  });

  const wcb = data?.wetCheckBilling
    ? { ...data.wetCheckBilling, customer: data.customer ?? undefined }
    : undefined;
  const view = data?.view ?? null;

  const showEditAffordances = !!wcb && !!view && canEditLaborFields(wcb);
  const appliedRate = String(wcb?.appliedLaborRate ?? wcb?.laborRate ?? "0");

  const [approveError, setApproveError] = useState<string | null>(null);

  const approveMut = useMutation({
    mutationFn: () => apiRequest(`/api/wet-check-billings/${wcbId}/approve`, "POST", {}),
    onSuccess: () => {
      setApproveError(null);
      qc.invalidateQueries({ queryKey: ["/api/wet-check-billings", wcbId] });
      qc.invalidateQueries({ queryKey: ["/api/wet-check-billings"] });
      qc.invalidateQueries({ queryKey: ["/api/wet-checks", wetCheckId] });
      qc.invalidateQueries({ queryKey: ["/api/wet-checks/needs-review"] });
      qc.invalidateQueries({ queryKey: ["/api/customers/billing-preview"] });
      toast({ title: "Snapshot approved", description: "Passed to billing." });
      onApproveSuccess();
    },
    onError: (e: any) => {
      const msg = e?.message ?? "Could not approve the snapshot. Please try again.";
      setApproveError(msg);
      toast({ title: "Approval failed", description: msg, variant: "destructive" });
    },
  });

  function handleLaborSaved() {
    qc.invalidateQueries({ queryKey: ["/api/wet-check-billings", wcbId] });
    qc.invalidateQueries({ queryKey: ["/api/wet-check-billings"] });
    qc.invalidateQueries({ queryKey: ["/api/customers/billing-preview"] });
    qc.invalidateQueries({ queryKey: [`/api/wet-check-billings/${wcbId}/activity`] });
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (isError || !wcb) {
    return (
      <p className="text-sm text-red-600 py-4 text-center" data-testid="crs-wcb-error">
        Failed to load snapshot details.
      </p>
    );
  }

  const statusMeta = wcbStatusLabel(wcb.status ?? "submitted");
  const approvable = isApprovableStatus(wcb.status ?? "");

  return (
    <div className="space-y-4" data-testid="crs-snapshot-section">
      {/* Status row */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">
            {wcb.billingNumber ?? `WCB-${wcb.id}`}
          </span>
          <Badge
            variant="outline"
            className={`text-xs border ${statusMeta.className}`}
            data-testid="crs-wcb-status-badge"
          >
            {statusMeta.label}
          </Badge>
        </div>
        {wcb.approvedBy && (
          <span className="text-xs text-gray-500">
            Approved by {wcb.approvedBy}
          </span>
        )}
      </div>

      {/* Edit affordances (billing_manager+ on unlocked WCBs) */}
      {showEditAffordances && (
        <SnapshotEditAffordances wcb={wcb} onLaborSaved={handleLaborSaved} />
      )}

      {/* Zone-grouped billing view */}
      {view ? (
        <WetCheckBillingViewComponent
          view={view}
          canSeePricing={canSeePricing()}
          wcbId={wcb.id}
          canEditLabor={canEditLaborFields(wcb)}
          laborRate={appliedRate}
        />
      ) : (
        <p className="text-sm text-gray-500 py-4 text-center italic">
          No zone-grouped view available for this snapshot yet.
        </p>
      )}

      {/* Activity log */}
      <ActivityFeed url={`/api/wet-check-billings/${wcb.id}/activity`} />

      {/* Approve action */}
      {approvable && (
        <div
          className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-3"
          data-testid="crs-approve-panel"
        >
          <div className="flex items-center gap-2">
            <ThumbsUp className="w-4 h-4 text-emerald-600" />
            <span className="text-sm font-medium text-emerald-800">
              Approve this snapshot for billing
            </span>
          </div>
          <p className="text-xs text-emerald-700">
            Approving locks in the labor rate, zone hours, and parts totals shown above.
            The snapshot is then visible to billing staff.
          </p>

          {approveError && (
            <div
              className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
              data-testid="crs-approve-error"
            >
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{approveError}</span>
            </div>
          )}

          <Button
            onClick={() => { setApproveError(null); approveMut.mutate(); }}
            disabled={approveMut.isPending}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            data-testid="crs-approve-button"
          >
            {approveMut.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Approving…</>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Approve Snapshot
              </>
            )}
          </Button>
        </div>
      )}

      {!approvable && wcb.status === "approved_passed_to_billing" && (
        <div
          className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
          data-testid="crs-approved-notice"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Snapshot approved and passed to billing.
        </div>
      )}
    </div>
  );
}

// ── No-WCB placeholder ────────────────────────────────────────────────────────

function NoSnapshotYet() {
  return (
    <div
      className="rounded-lg border border-dashed border-gray-200 bg-gray-50 py-8 text-center"
      data-testid="crs-no-snapshot"
    >
      <ClipboardList className="w-8 h-8 text-gray-300 mx-auto mb-2" />
      <p className="text-sm text-gray-500">No WC snapshot has been generated yet.</p>
      <p className="text-xs text-gray-400 mt-1">
        A snapshot is created automatically when findings are converted.
      </p>
    </div>
  );
}

// ── Section accordion wrapper ─────────────────────────────────────────────────

function SectionCard({
  title,
  badge,
  badgeClassName,
  defaultOpen,
  collapsible,
  children,
  testId,
}: {
  title: string;
  badge?: string;
  badgeClassName?: string;
  defaultOpen?: boolean;
  collapsible?: boolean;
  children: React.ReactNode;
  testId?: string;
}) {
  const [open, setOpen] = useState(defaultOpen ?? true);

  return (
    <Card data-testid={testId}>
      <CardHeader
        className={`py-3 px-4 ${collapsible ? "cursor-pointer select-none" : ""}`}
        onClick={collapsible ? () => setOpen(o => !o) : undefined}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-semibold text-gray-900">{title}</CardTitle>
            {badge && (
              <Badge
                variant="outline"
                className={`text-xs border ${badgeClassName ?? "bg-gray-100 text-gray-700 border-gray-300"}`}
              >
                {badge}
              </Badge>
            )}
          </div>
          {collapsible && (
            <button
              type="button"
              className="text-gray-400 hover:text-gray-600"
              aria-label={open ? "Collapse section" : "Expand section"}
            >
              {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          )}
        </div>
      </CardHeader>
      {open && (
        <CardContent className="px-4 pb-5 pt-0">
          {children}
        </CardContent>
      )}
    </Card>
  );
}

// ── Main surface ──────────────────────────────────────────────────────────────

interface CombinedReviewSurfaceProps {
  wetCheckId: number;
}

export function CombinedReviewSurface({ wetCheckId }: CombinedReviewSurfaceProps) {
  const [, navigate] = useLocation();

  const { data: wc, isLoading: wcLoading } = useQuery<WetCheckWithDetails>({
    queryKey: ["/api/wet-checks", wetCheckId],
    queryFn: () => apiRequest(`/api/wet-checks/${wetCheckId}`),
  });

  const { data: wcbList = [] } = useArrayQuery<WetCheckBillingListItem>({
    queryKey: ["/api/wet-check-billings"],
  });

  const associatedWcb = wcbList.find(b => b.wetCheckId === wetCheckId) ?? null;
  const wcbId = associatedWcb?.id ?? null;

  const allFindings = !wc
    ? []
    : asArray(wc.zoneRecords).flatMap(zr =>
        asArray(zr.findings).map(f => ({ f, zr })),
      );

  const unroutedFindings = allFindings.filter(
    ({ f }) =>
      f.convertedAt == null &&
      !(f.resolution === "repaired_in_field" && f.billingSheetId != null) &&
      f.billingSheetId == null &&
      f.estimateId == null &&
      f.workOrderId == null &&
      f.wetCheckBillingId == null &&
      f.resolution !== "documented_only",
  );

  const needsTriage = unroutedFindings.length > 0;

  function handleApproveSuccess() {
    navigate("/wet-checks?tab=needs-review");
  }

  if (wcLoading) {
    return (
      <div className="max-w-4xl mx-auto py-6 px-4 space-y-4" data-testid="crs-loading">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-5 w-72" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!wc) {
    return (
      <div className="max-w-4xl mx-auto py-6 px-4" data-testid="crs-not-found">
        <p className="text-sm text-red-600">Wet check not found.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 space-y-6" data-testid="crs-surface">
      {/* ── Page header ────────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => navigate("/wet-checks?tab=needs-review")}
          className="inline-flex items-center text-xs text-gray-500 hover:text-gray-700 transition-colors"
          data-testid="crs-back"
        >
          <ChevronLeft className="w-3.5 h-3.5 mr-0.5" />
          Back to Needs Review
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-bold text-gray-900" data-testid="crs-heading">
            {wc.customerName ?? "Unknown Customer"}
          </h1>
          <span className="font-mono text-sm text-gray-400">WC-{wc.id}</span>
          {wc.status && (
            <Badge variant="secondary" className="text-xs">
              {wc.status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
            </Badge>
          )}
        </div>
        {wc.propertyAddress && (
          <p className="text-sm text-gray-500">{wc.propertyAddress}</p>
        )}
      </div>

      {/* ── Triage section (conditional) ───────────────────────────────────── */}
      {needsTriage && (
        <SectionCard
          title="Step 1 — Triage Findings"
          badge={`${unroutedFindings.length} pending`}
          badgeClassName="bg-amber-50 text-amber-700 border-amber-200"
          collapsible
          defaultOpen
          testId="crs-triage-section"
        >
          <div className="text-xs text-gray-500 mb-3">
            Route each unresolved finding to an estimate, work order, or document it before approving the snapshot.
          </div>
          <WetCheckWizard id={wetCheckId} />
        </SectionCard>
      )}

      {/* Triage complete notice (when no unrouted findings remain) */}
      {!needsTriage && allFindings.length > 0 && (
        <div
          className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
          data-testid="crs-triage-complete"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          All findings have been triaged.
        </div>
      )}

      {/* ── Snapshot section ────────────────────────────────────────────────── */}
      <SectionCard
        title="Step 2 — WC Snapshot Review"
        badge={associatedWcb ? wcbStatusLabel(associatedWcb.status ?? "submitted").label : undefined}
        badgeClassName={associatedWcb ? wcbStatusLabel(associatedWcb.status ?? "submitted").className : undefined}
        defaultOpen
        testId="crs-snapshot-card"
      >
        {wcbId != null ? (
          <SnapshotSection
            wetCheckId={wetCheckId}
            wcbId={wcbId}
            onApproveSuccess={handleApproveSuccess}
          />
        ) : (
          <NoSnapshotYet />
        )}
      </SectionCard>
    </div>
  );
}
