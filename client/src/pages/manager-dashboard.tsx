import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer, PageContent, PageHeader } from "@/components/ui/page-header";
import { FAB } from "@/components/ui/fab";
import { ActionSheet, ActionSheetItem, ActionSheetSection } from "@/components/ui/action-sheet";
import { FileText, Wrench, Receipt, AlertCircle, CheckCircle2, ClipboardCheck, User, ExternalLink } from "lucide-react";
import { useState } from "react";
import { EstimateModal } from "@/components/estimates/estimate-modal";
import { WorkOrderForm } from "@/components/work-orders/work-order-form";
import { StandaloneBillingSheet } from "@/components/billing/standalone-billing-sheet";
import { CompletedWorkDetailModal } from "@/components/billing/completed-work-detail-modal";
import { BillingSheetViewModal } from "@/components/billing/billing-sheet-view-modal";
import type { WorkOrder, BillingSheet } from "@shared/schema";
import { format } from "date-fns";

const ATTENTION_STATUSES = ["work_completed", "pending_manager_review", "submitted"];
const OPEN_STATUSES = ["assigned", "in_progress"];
const BILLING_READY_STATUSES = ["approved_passed_to_billing"];

function formatStatus(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtDate(date: string | Date | null | undefined) {
  if (!date) return "—";
  try {
    return format(new Date(date), "MMM d, yyyy");
  } catch {
    return "—";
  }
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "pending_manager_review" || status === "work_completed"
      ? "warning"
      : status === "submitted"
      ? "info"
      : status === "in_progress"
      ? "info"
      : status === "assigned"
      ? "secondary"
      : status === "approved_passed_to_billing"
      ? "success"
      : "secondary";
  return <Badge variant={variant as any}>{formatStatus(status)}</Badge>;
}

function PipelineBarSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-20 rounded-xl" />
      ))}
    </div>
  );
}

function SectionSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-16 rounded-xl" />
      ))}
    </div>
  );
}

export default function ManagerDashboard() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [showCreateSheet, setShowCreateSheet] = useState(false);
  const [showEstimateModal, setShowEstimateModal] = useState(false);
  const [showWorkOrderModal, setShowWorkOrderModal] = useState(false);
  const [showBillingSheetModal, setShowBillingSheetModal] = useState(false);

  const [reviewWorkOrder, setReviewWorkOrder] = useState<WorkOrder | null>(null);
  const [reviewBillingSheet, setReviewBillingSheet] = useState<BillingSheet | null>(null);

  const { data: workOrders = [], isLoading: woLoading } = useQuery<WorkOrder[]>({
    queryKey: ["/api/work-orders"],
  });

  const { data: billingSheets = [], isLoading: bsLoading } = useQuery<BillingSheet[]>({
    queryKey: ["/api/billing-sheets"],
  });

  const isLoading = woLoading || bsLoading;

  const attentionWorkOrders = (workOrders as WorkOrder[]).filter((wo) =>
    ATTENTION_STATUSES.includes(wo.status) && wo.status !== "billed" && wo.invoiceId == null
  );
  const attentionBillingSheets = (billingSheets as BillingSheet[]).filter((bs) =>
    ATTENTION_STATUSES.includes(bs.status) && bs.status !== "billed" && bs.invoiceId == null
  );
  const openWorkOrders = (workOrders as WorkOrder[]).filter((wo) =>
    OPEN_STATUSES.includes(wo.status)
  );
  const billingReadyWorkOrders = (workOrders as WorkOrder[]).filter((wo) =>
    BILLING_READY_STATUSES.includes(wo.status)
  );
  const billingReadyBillingSheets = (billingSheets as BillingSheet[]).filter((bs) =>
    BILLING_READY_STATUSES.includes(bs.status)
  );

  const needsReviewCount = attentionWorkOrders.length + attentionBillingSheets.length;
  const openWorkOrderCount = openWorkOrders.length;
  const readyForBillingCount = billingReadyWorkOrders.length + billingReadyBillingSheets.length;

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    queryClient.invalidateQueries({ queryKey: ["/api/billing-sheets"] });
  }

  return (
    <PageContainer>
      <PageHeader title="Dashboard" subtitle="Pipeline overview" />

      <PageContent className="space-y-6">
        {/* Pipeline Summary Bar */}
        {isLoading ? (
          <PipelineBarSkeleton />
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <button
              className="text-left rounded-xl p-4 bg-emerald-50 border border-emerald-100 hover:bg-emerald-100 transition-colors"
              onClick={() => setLocation("/work-orders")}
              data-testid="pipeline-open-work-orders"
            >
              <div className="flex items-center gap-2 mb-1">
                <Wrench className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-medium text-emerald-700 uppercase tracking-wide">Open Work Orders</span>
              </div>
              <p className="text-3xl font-bold text-emerald-800">{openWorkOrderCount}</p>
            </button>

            <button
              className={`text-left rounded-xl p-4 border transition-colors ${
                needsReviewCount > 0
                  ? "bg-amber-50 border-amber-200 hover:bg-amber-100"
                  : "bg-slate-50 border-slate-100 hover:bg-slate-100"
              }`}
              data-testid="pipeline-needs-review"
              onClick={() => document.getElementById("needs-attention")?.scrollIntoView({ behavior: "smooth" })}
            >
              <div className="flex items-center gap-2 mb-1">
                <AlertCircle className={`w-4 h-4 ${needsReviewCount > 0 ? "text-amber-600" : "text-slate-400"}`} />
                <span className={`text-xs font-medium uppercase tracking-wide ${needsReviewCount > 0 ? "text-amber-700" : "text-slate-500"}`}>
                  Needs Review
                </span>
              </div>
              <p className={`text-3xl font-bold ${needsReviewCount > 0 ? "text-amber-800" : "text-slate-600"}`}>
                {needsReviewCount}
              </p>
            </button>

            <button
              className={`text-left rounded-xl p-4 border transition-colors ${
                readyForBillingCount > 0
                  ? "bg-sky-50 border-sky-100 hover:bg-sky-100"
                  : "bg-slate-50 border-slate-100 hover:bg-slate-100"
              }`}
              data-testid="pipeline-ready-for-billing"
              onClick={() => document.getElementById("ready-for-billing")?.scrollIntoView({ behavior: "smooth" })}
            >
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className={`w-4 h-4 ${readyForBillingCount > 0 ? "text-sky-600" : "text-slate-400"}`} />
                <span className={`text-xs font-medium uppercase tracking-wide ${readyForBillingCount > 0 ? "text-sky-700" : "text-slate-500"}`}>
                  Ready for Billing
                </span>
              </div>
              <p className={`text-3xl font-bold ${readyForBillingCount > 0 ? "text-sky-800" : "text-slate-600"}`}>
                {readyForBillingCount}
              </p>
            </button>
          </div>
        )}

        {/* Needs Your Attention */}
        <section id="needs-attention">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-5 h-5 text-amber-500" />
            <h2 className="text-base font-semibold text-slate-800">Needs Your Attention</h2>
            {!isLoading && needsReviewCount > 0 && (
              <Badge variant="warning" className="ml-1">{needsReviewCount}</Badge>
            )}
          </div>

          {isLoading ? (
            <SectionSkeleton />
          ) : needsReviewCount === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-slate-400">
                <ClipboardCheck className="w-10 h-10 mx-auto mb-2 text-slate-200" />
                <p className="text-sm">Nothing waiting for your review</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {attentionWorkOrders.map((wo) => (
                <div
                  key={`wo-${wo.id}`}
                  className="flex items-center justify-between gap-3 p-4 rounded-xl bg-white border border-slate-200 hover:border-amber-200 hover:bg-amber-50/30 transition-colors"
                  data-testid={`attention-wo-${wo.id}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 rounded-lg bg-emerald-50 shrink-0">
                      <Wrench className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-slate-900 text-sm truncate">{wo.workOrderNumber}</p>
                        <StatusBadge status={wo.status} />
                      </div>
                      <p className="text-xs text-slate-500 truncate">{wo.customerName}</p>
                      {wo.assignedTechnicianName && (
                        <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                          <User className="w-3 h-3" />
                          {wo.assignedTechnicianName}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <p className="text-xs text-slate-400 hidden sm:block">{fmtDate(wo.scheduledDate || wo.createdAt)}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-amber-300 text-amber-700 hover:bg-amber-50"
                      onClick={() => setReviewWorkOrder(wo)}
                      data-testid={`review-wo-${wo.id}`}
                    >
                      Review
                    </Button>
                  </div>
                </div>
              ))}

              {attentionBillingSheets.map((bs) => (
                <div
                  key={`bs-${bs.id}`}
                  className="flex items-center justify-between gap-3 p-4 rounded-xl bg-white border border-slate-200 hover:border-amber-200 hover:bg-amber-50/30 transition-colors"
                  data-testid={`attention-bs-${bs.id}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 rounded-lg bg-amber-50 shrink-0">
                      <Receipt className="w-4 h-4 text-amber-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-slate-900 text-sm truncate">{bs.billingNumber}</p>
                        <StatusBadge status={bs.status} />
                      </div>
                      <p className="text-xs text-slate-500 truncate">{bs.customerName}</p>
                      {bs.technicianName && (
                        <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                          <User className="w-3 h-3" />
                          {bs.technicianName}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <p className="text-xs text-slate-400 hidden sm:block">{fmtDate(bs.workDate)}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-amber-300 text-amber-700 hover:bg-amber-50"
                      onClick={() => setReviewBillingSheet(bs)}
                      data-testid={`review-bs-${bs.id}`}
                    >
                      Review
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Open Work Orders */}
        <section id="open-work-orders">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Wrench className="w-5 h-5 text-emerald-500" />
              <h2 className="text-base font-semibold text-slate-800">Open Work Orders</h2>
              {!isLoading && openWorkOrderCount > 0 && (
                <Badge variant="secondary" className="ml-1">{openWorkOrderCount}</Badge>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-emerald-600 hover:text-emerald-700 text-xs"
              onClick={() => setLocation("/work-orders")}
            >
              View All <ExternalLink className="w-3 h-3 ml-1" />
            </Button>
          </div>

          {isLoading ? (
            <SectionSkeleton />
          ) : openWorkOrders.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-slate-400">
                <Wrench className="w-10 h-10 mx-auto mb-2 text-slate-200" />
                <p className="text-sm">No open work orders in the field</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {openWorkOrders.map((wo) => (
                <div
                  key={`open-wo-${wo.id}`}
                  className="flex items-center justify-between gap-3 p-4 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer"
                  onClick={() => setLocation("/work-orders")}
                  data-testid={`open-wo-${wo.id}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 rounded-lg bg-emerald-50 shrink-0">
                      <Wrench className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-slate-900 text-sm truncate">{wo.workOrderNumber}</p>
                        <StatusBadge status={wo.status} />
                      </div>
                      <p className="text-xs text-slate-500 truncate">{wo.customerName}</p>
                      {wo.assignedTechnicianName && (
                        <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                          <User className="w-3 h-3" />
                          {wo.assignedTechnicianName}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <p className="text-xs text-slate-400">{fmtDate(wo.scheduledDate || wo.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Ready for Billing */}
        <section id="ready-for-billing">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-5 h-5 text-sky-500" />
            <h2 className="text-base font-semibold text-slate-800">Ready for Billing</h2>
            {!isLoading && readyForBillingCount > 0 && (
              <Badge variant="secondary" className="ml-1">{readyForBillingCount}</Badge>
            )}
          </div>

          {isLoading ? (
            <SectionSkeleton />
          ) : readyForBillingCount === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-slate-400">
                <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-slate-200" />
                <p className="text-sm">No records queued for billing</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {billingReadyWorkOrders.map((wo) => (
                <div
                  key={`billing-wo-${wo.id}`}
                  className="flex items-center justify-between gap-3 p-4 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
                  data-testid={`billing-wo-${wo.id}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 rounded-lg bg-emerald-50 shrink-0">
                      <Wrench className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-slate-900 text-sm truncate">{wo.workOrderNumber}</p>
                        <Badge variant="success">Approved</Badge>
                        <span className="text-xs text-slate-400">Work Order</span>
                      </div>
                      <p className="text-xs text-slate-500 truncate">{wo.customerName}</p>
                    </div>
                  </div>
                  <div className="shrink-0">
                    <p className="text-xs text-slate-400">{fmtDate(wo.approvedAt || wo.updatedAt)}</p>
                  </div>
                </div>
              ))}

              {billingReadyBillingSheets.map((bs) => (
                <div
                  key={`billing-bs-${bs.id}`}
                  className="flex items-center justify-between gap-3 p-4 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
                  data-testid={`billing-bs-${bs.id}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 rounded-lg bg-amber-50 shrink-0">
                      <Receipt className="w-4 h-4 text-amber-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-slate-900 text-sm truncate">{bs.billingNumber}</p>
                        <Badge variant="success">Approved</Badge>
                        <span className="text-xs text-slate-400">Billing Sheet</span>
                      </div>
                      <p className="text-xs text-slate-500 truncate">{bs.customerName}</p>
                    </div>
                  </div>
                  <div className="shrink-0">
                    <p className="text-xs text-slate-400">{fmtDate(bs.approvedAt || bs.updatedAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </PageContent>

      {/* Floating Action Button */}
      <FAB onClick={() => setShowCreateSheet(true)} testId="fab-create" />

      {/* Create Action Sheet */}
      <ActionSheet
        open={showCreateSheet}
        onOpenChange={setShowCreateSheet}
        title="Create New"
        description="Choose what you want to create"
      >
        <ActionSheetSection>
          <ActionSheetItem
            icon={<FileText className="w-5 h-5" />}
            onClick={() => {
              setShowCreateSheet(false);
              setShowEstimateModal(true);
            }}
          >
            New Estimate
          </ActionSheetItem>
          <ActionSheetItem
            icon={<Wrench className="w-5 h-5" />}
            onClick={() => {
              setShowCreateSheet(false);
              setShowWorkOrderModal(true);
            }}
          >
            New Work Order
          </ActionSheetItem>
          <ActionSheetItem
            icon={<Receipt className="w-5 h-5" />}
            onClick={() => {
              setShowCreateSheet(false);
              setShowBillingSheetModal(true);
            }}
          >
            New Billing Sheet
          </ActionSheetItem>
        </ActionSheetSection>
      </ActionSheet>

      {/* Modals */}
      <EstimateModal
        open={showEstimateModal}
        onOpenChange={(open) => {
          setShowEstimateModal(open);
          if (!open) invalidateAll();
        }}
      />

      {showWorkOrderModal && (
        <WorkOrderForm
          onClose={() => setShowWorkOrderModal(false)}
          onSuccess={() => {
            setShowWorkOrderModal(false);
            invalidateAll();
          }}
        />
      )}

      <StandaloneBillingSheet
        open={showBillingSheetModal}
        onOpenChange={(open) => {
          setShowBillingSheetModal(open);
          if (!open) invalidateAll();
        }}
      />

      {/* Work Order Review Modal */}
      {reviewWorkOrder && (
        <CompletedWorkDetailModal
          type="work_order"
          id={reviewWorkOrder.id}
          data={reviewWorkOrder}
          open={!!reviewWorkOrder}
          onOpenChange={(open) => {
            if (!open) {
              setReviewWorkOrder(null);
              invalidateAll();
            }
          }}
          showPricing
        />
      )}

      {/* Billing Sheet Review Modal */}
      {reviewBillingSheet && (
        <BillingSheetViewModal
          sheet={reviewBillingSheet}
          open={!!reviewBillingSheet}
          onOpenChange={(open) => {
            if (!open) {
              setReviewBillingSheet(null);
              invalidateAll();
            }
          }}
        />
      )}
    </PageContainer>
  );
}
