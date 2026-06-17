/**
 * CombinedReviewSurface — Slice 3 + Slice 2 (Inspection Mode)
 *
 * Full-page review surface opened from a Needs Review row.
 *
 * Service mode (mode === 'service'):
 *   Triage step:   conditional — shown only when unrouted non-documented findings exist.
 *   Snapshot step: always shown when a WCB exists.
 *
 * Inspection mode (mode === 'inspection'):
 *   Skips finding-triage (Inspection WCs document only; no individual routing).
 *   Shows InspectionEstimateSection instead — auto-builds one estimate from findings,
 *   lets the manager review line items, then approve (which converts the WC).
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  FileText,
  Clock,
} from "lucide-react";
import { WetCheckWizard } from "@/components/manager/wet-check-wizard";
import { EstimateDetailModal } from "@/components/estimates/estimate-detail-modal";
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
  EstimateWithItems,
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

// ── Inspection estimate section ───────────────────────────────────────────────
// Shown instead of the triage + snapshot flow for mode === 'inspection'.
// Calls build-inspection-estimate (idempotent) on mount to get/create the
// estimate, shows a read-only summary of line items and totals, then lets the
// manager approve it (which also marks the wet check `converted`).

interface InspectionEstimateSectionProps {
  wetCheckId: number;
  onApproveSuccess: () => void;
}

function InspectionEstimateSection({ wetCheckId, onApproveSuccess }: InspectionEstimateSectionProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);

  // Build (or fetch) the estimate on mount. This is an idempotent POST.
  const {
    data: estimate,
    isLoading: buildLoading,
    isError: buildError,
    refetch: refetchEstimate,
  } = useQuery<EstimateWithItems>({
    queryKey: ["/api/wet-checks", wetCheckId, "inspection-estimate"],
    queryFn: () => apiRequest(`/api/wet-checks/${wetCheckId}/build-inspection-estimate`, "POST", {}),
    retry: 1,
    staleTime: 0,
  });

  const [approveErr, setApproveErr] = useState<string | null>(null);

  const approveMut = useMutation({
    mutationFn: () =>
      apiRequest(`/api/wet-checks/${wetCheckId}/approve-inspection`, "POST", {}),
    onSuccess: () => {
      setApproveErr(null);
      qc.invalidateQueries({ queryKey: ["/api/wet-checks", wetCheckId] });
      qc.invalidateQueries({ queryKey: ["/api/wet-checks/needs-review"] });
      qc.invalidateQueries({ queryKey: ["/api/estimates"] });
      toast({
        title: "Inspection approved",
        description: "Estimate approved and wet check marked converted.",
      });
      onApproveSuccess();
    },
    onError: (e: any) => {
      const msg = e?.message ?? "Could not approve. Please try again.";
      setApproveErr(msg);
      toast({ title: "Approval failed", description: msg, variant: "destructive" });
    },
  });

  if (buildLoading) {
    return (
      <div className="space-y-3" data-testid="crs-inspection-loading">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (buildError || !estimate) {
    return (
      <div
        className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 space-y-2"
        data-testid="crs-inspection-build-error"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Could not load the estimate for this inspection. Please retry.</span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => refetchEstimate()}
          className="border-red-300 text-red-700 hover:bg-red-100"
        >
          Retry
        </Button>
      </div>
    );
  }

  const isAlreadyApproved = estimate.lifecycle === "approved";
  const items = estimate.items ?? [];
  const partsSubtotal = parseFloat(String(estimate.partsSubtotal ?? "0"));
  const laborSubtotal = parseFloat(String(estimate.laborSubtotal ?? "0"));
  const totalAmount = parseFloat(String(estimate.totalAmount ?? "0"));
  const totalLaborHours = parseFloat(String(estimate.totalLaborHours ?? "0"));

  return (
    <div className="space-y-4" data-testid="crs-inspection-estimate-section">
      {/* Estimate header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">
            {estimate.estimateNumber ?? `EST-${estimate.id}`}
          </span>
          <Badge
            variant="outline"
            className={`text-xs border ${
              isAlreadyApproved
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-amber-50 text-amber-700 border-amber-200"
            }`}
            data-testid="crs-inspection-estimate-status"
          >
            {isAlreadyApproved ? "Approved" : "Pending Approval"}
          </Badge>
        </div>
        {!isAlreadyApproved && (
          <Button
            size="sm"
            variant="outline"
            className="text-xs border-gray-300 text-gray-700 hover:bg-gray-50"
            onClick={() => setEditorOpen(true)}
            data-testid="crs-inspection-edit-estimate-button"
          >
            <Pencil className="w-3.5 h-3.5 mr-1.5" />
            Edit Estimate
          </Button>
        )}
      </div>

      {/* Estimate editor modal — lets the manager adjust line items before approving */}
      <EstimateDetailModal
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) {
            // Refetch after the editor closes so our preview reflects any edits.
            void refetchEstimate();
          }
        }}
        estimateId={estimate.id}
      />

      {/* Line items table */}
      {items.length > 0 ? (
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm" data-testid="crs-inspection-line-items">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Description</th>
                {canSeePricing() && (
                  <>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Qty</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Unit $</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Total</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map(item => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-800">
                    {item.description ?? item.partName ?? "—"}
                  </td>
                  {canSeePricing() && (
                    <>
                      <td className="px-4 py-2 text-right text-gray-600">{item.quantity ?? 1}</td>
                      <td className="px-4 py-2 text-right text-gray-600">
                        ${parseFloat(String(item.partPrice ?? "0")).toFixed(2)}
                      </td>
                      <td className="px-4 py-2 text-right font-medium text-gray-900">
                        ${parseFloat(String(item.totalPrice ?? "0")).toFixed(2)}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 py-6 text-center">
          <p className="text-sm text-gray-500">No part findings — estimate captures labor only.</p>
        </div>
      )}

      {/* Totals */}
      {canSeePricing() && (
        <div
          className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-1 text-sm"
          data-testid="crs-inspection-totals"
        >
          <div className="flex justify-between text-gray-600">
            <span>Parts subtotal</span>
            <span>${partsSubtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>Labor ({totalLaborHours.toFixed(2)} hrs × ${parseFloat(String(estimate.laborRate ?? "0")).toFixed(2)}/hr)</span>
            <span>${laborSubtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-semibold text-gray-900 border-t border-gray-200 pt-2 mt-1">
            <span>Total</span>
            <span>${totalAmount.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Approve action */}
      {!isAlreadyApproved && (
        <div
          className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-3"
          data-testid="crs-inspection-approve-panel"
        >
          <div className="flex items-center gap-2">
            <ThumbsUp className="w-4 h-4 text-emerald-600" />
            <span className="text-sm font-medium text-emerald-800">
              Approve inspection estimate
            </span>
          </div>
          <p className="text-xs text-emerald-700">
            Approving this estimate confirms the documented findings and converts the wet check.
            The estimate is then available for customer review.
          </p>

          {approveErr && (
            <div
              className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
              data-testid="crs-inspection-approve-error"
            >
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{approveErr}</span>
            </div>
          )}

          <Button
            onClick={() => { setApproveErr(null); approveMut.mutate(); }}
            disabled={approveMut.isPending}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            data-testid="crs-inspection-approve-button"
          >
            {approveMut.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Approving…</>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Approve Estimate &amp; Convert
              </>
            )}
          </Button>
        </div>
      )}

      {isAlreadyApproved && (
        <div
          className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
          data-testid="crs-inspection-approved-notice"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Inspection estimate approved. Wet check converted.
        </div>
      )}
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

// ── In-progress banner (shown when the tech hasn't submitted yet) ─────────────

function InProgressBanner({ wetCheckId }: { wetCheckId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const role = getUserRole();
  const isAdmin = role === "company_admin" || role === "super_admin";

  const forceSubmitMut = useMutation({
    mutationFn: () =>
      apiRequest(`/api/wet-checks/${wetCheckId}/force-submit`, "POST", {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/wet-checks", wetCheckId] });
      qc.invalidateQueries({ queryKey: ["/api/wet-checks/needs-review"] });
      toast({
        title: "Wet check marked as submitted",
        description: "Routing and triage are now available.",
      });
      setConfirmOpen(false);
    },
    onError: (e: any) => {
      toast({
        title: "Could not mark as submitted",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      });
      setConfirmOpen(false);
    },
  });

  return (
    <>
      <div
        className="rounded-xl border border-amber-200 bg-amber-50 p-5 space-y-3"
        data-testid="crs-in-progress-banner"
      >
        <div className="flex items-start gap-3">
          <Clock className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-amber-900">
              Inspection still in progress
            </p>
            <p className="text-sm text-amber-800">
              The field tech hasn't submitted this wet check yet. Routing and triage will be available once they submit.
            </p>
            {isAdmin && (
              <p className="text-xs text-amber-700 mt-1">
                If the tech's submit failed due to an offline or network issue, you can manually mark it as submitted below.
              </p>
            )}
          </div>
        </div>
        {isAdmin && (
          <div className="pl-8">
            <Button
              size="sm"
              variant="outline"
              className="border-amber-400 text-amber-800 hover:bg-amber-100"
              onClick={() => setConfirmOpen(true)}
              data-testid="crs-force-submit-button"
            >
              Mark as Submitted
            </Button>
          </div>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark wet check as submitted?</AlertDialogTitle>
            <AlertDialogDescription>
              This will transition the wet check from "In Progress" to "Submitted" and unlock routing and triage. Use this only if the field tech's submit failed due to a connectivity issue and the inspection is actually complete.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={forceSubmitMut.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => forceSubmitMut.mutate()}
              disabled={forceSubmitMut.isPending}
              data-testid="crs-force-submit-confirm"
            >
              {forceSubmitMut.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Marking…</>
              ) : (
                "Mark as Submitted"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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

  const isInspection = (wc as any)?.mode === "inspection";

  const allFindings = !wc
    ? []
    : asArray(wc.zoneRecords).flatMap(zr =>
        asArray(zr.findings).map(f => ({ f, zr })),
      );

  // Only count findings that genuinely need a manager routing decision.
  // completed_in_field findings are auto-routed into the WCB snapshot on
  // Approve & Convert, so they never appear as "pending" triage items.
  const unroutedFindings = allFindings.filter(
    ({ f }) =>
      f.convertedAt == null &&
      !(f.resolution === "repaired_in_field" && f.billingSheetId != null) &&
      f.billingSheetId == null &&
      f.estimateId == null &&
      f.workOrderId == null &&
      f.wetCheckBillingId == null &&
      f.resolution !== "documented_only" &&
      f.techDisposition !== "completed_in_field",
  );

  // For service WCs: triage step is shown when there are unrouted findings.
  // For inspection WCs: no triage step — all findings go into one estimate.
  const needsTriage = !isInspection && unroutedFindings.length > 0;

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
          {isInspection && (
            <Badge variant="outline" className="text-xs border bg-violet-50 text-violet-700 border-violet-200">
              Inspection
            </Badge>
          )}
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

      {/* ── In-progress guard: hide routing UI until the tech submits ───── */}
      {wc.status === "in_progress" && (
        <InProgressBanner wetCheckId={wetCheckId} />
      )}

      {/* ── Inspection mode: single estimate review ─────────────────────── */}
      {isInspection && wc.status !== "in_progress" && (
        <SectionCard
          title="Inspection Report — Estimate Review"
          badge="Inspection"
          badgeClassName="bg-violet-50 text-violet-700 border-violet-200"
          defaultOpen
          testId="crs-inspection-section"
        >
          <div className="text-xs text-gray-500 mb-3">
            This is an inspection wet check. All documented findings have been consolidated into a
            single estimate below. Review the line items and approve to convert the wet check.
          </div>
          <InspectionEstimateSection
            wetCheckId={wetCheckId}
            onApproveSuccess={handleApproveSuccess}
          />
        </SectionCard>
      )}

      {/* ── Service mode: triage + snapshot flow ────────────────────────── */}
      {!isInspection && wc.status !== "in_progress" && (
        <>
          {/* Triage section (conditional) */}
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

          {/* Snapshot section */}
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
        </>
      )}
    </div>
  );
}
