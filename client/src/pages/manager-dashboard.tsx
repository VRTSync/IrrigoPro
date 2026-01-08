import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MetricTile, MetricGrid, MetricTileSkeleton } from "@/components/ui/metric-tile";
import { TaskCard, TaskCardSkeleton } from "@/components/ui/task-card";
import { PageContainer, PageContent, PageHeader } from "@/components/ui/page-header";
import { FAB } from "@/components/ui/fab";
import { ActionSheet, ActionSheetItem, ActionSheetSection } from "@/components/ui/action-sheet";
import { FileText, Wrench, Receipt, Clock, CheckCircle, Plus, ChevronRight, ArrowRight } from "lucide-react";
import { useState } from "react";
import { EstimateModal } from "@/components/estimates/estimate-modal";
import { WorkOrderForm } from "@/components/work-orders/work-order-form";
import { StandaloneBillingSheet } from "@/components/billing/standalone-billing-sheet";
import type { Estimate, WorkOrder } from "@shared/schema";

export default function ManagerDashboard() {
  const [, setLocation] = useLocation();
  const [showCreateSheet, setShowCreateSheet] = useState(false);
  const [showEstimateModal, setShowEstimateModal] = useState(false);
  const [showWorkOrderModal, setShowWorkOrderModal] = useState(false);
  const [showBillingSheetModal, setShowBillingSheetModal] = useState(false);

  const { data: stats, isLoading } = useQuery({
    queryKey: ["/api/dashboard/stats"],
  });

  const pendingEstimates = (stats as any)?.pendingEstimates || 0;
  const activeWorkOrders = (stats as any)?.workOrderStats?.inProgress || 0;
  const assignedWorkOrders = (stats as any)?.workOrderStats?.assigned || 0;
  const completedWorkOrders = (stats as any)?.workOrderStats?.completed || 0;
  const recentEstimates = (stats as any)?.recentEstimates?.slice(0, 3) || [];
  const recentWorkOrders = (stats as any)?.recentWorkOrders?.slice(0, 3) || [];

  const getEstimateStatus = (status: string) => {
    switch (status) {
      case 'pending': return 'pending' as const;
      case 'approved': return 'complete' as const;
      case 'rejected': return 'urgent' as const;
      case 'converted_to_work_order': return 'complete' as const;
      default: return 'draft' as const;
    }
  };

  const getWorkOrderStatus = (status: string) => {
    switch (status) {
      case 'in_progress': return 'active' as const;
      case 'completed': return 'complete' as const;
      case 'assigned': return 'pending' as const;
      default: return 'pending' as const;
    }
  };

  const formatStatus = (status: string) => {
    if (status === 'converted_to_work_order') return 'Converted';
    return status.replace('_', ' ').split(' ').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  return (
    <PageContainer>
      <PageHeader
        title="Dashboard"
        subtitle="Choose an option to get started"
      />

      <PageContent className="space-y-6">
        {/* Quick Stats */}
        {isLoading ? (
          <MetricGrid>
            <MetricTileSkeleton />
            <MetricTileSkeleton />
            <MetricTileSkeleton />
            <MetricTileSkeleton />
          </MetricGrid>
        ) : (
          <MetricGrid>
            <MetricTile
              label="Pending Estimates"
              value={pendingEstimates}
              icon={FileText}
              variant={pendingEstimates > 0 ? "warning" : "default"}
              onClick={() => setLocation("/estimates")}
              testId="metric-pending-estimates"
            />
            <MetricTile
              label="Active Work"
              value={activeWorkOrders}
              icon={Wrench}
              variant={activeWorkOrders > 0 ? "primary" : "default"}
              onClick={() => setLocation("/work-orders")}
              testId="metric-active-work"
            />
            <MetricTile
              label="Assigned"
              value={assignedWorkOrders}
              icon={Clock}
              variant="default"
              onClick={() => setLocation("/work-orders")}
              testId="metric-assigned"
            />
            <MetricTile
              label="Completed"
              value={completedWorkOrders}
              icon={CheckCircle}
              variant="success"
              onClick={() => setLocation("/work-orders")}
              testId="metric-completed"
            />
          </MetricGrid>
        )}

        {/* Quick Action Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Estimates Card */}
          <Card className="hover:shadow-md transition-all duration-200 hover:-translate-y-0.5">
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-sky-50">
                  <FileText className="w-6 h-6 text-sky-500" />
                </div>
                <div>
                  <CardTitle className="text-lg">Estimates</CardTitle>
                  {pendingEstimates > 0 && (
                    <Badge variant="warning" className="mt-1">{pendingEstimates} pending</Badge>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="rounded-full bg-sky-50 hover:bg-sky-100"
                onClick={() => setShowEstimateModal(true)}
                data-testid="button-new-estimate"
              >
                <Plus className="w-4 h-4 text-sky-600" />
              </Button>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-sm text-slate-500 mb-4">Create, view, and convert estimates to work orders</p>
              <Link href="/estimates">
                <Button className="w-full" data-testid="button-manage-estimates">
                  Manage Estimates
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Work Orders Card */}
          <Card className="hover:shadow-md transition-all duration-200 hover:-translate-y-0.5">
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-emerald-50">
                  <Wrench className="w-6 h-6 text-emerald-500" />
                </div>
                <div>
                  <CardTitle className="text-lg">Work Orders</CardTitle>
                  {activeWorkOrders > 0 && (
                    <Badge variant="info" className="mt-1">{activeWorkOrders} active</Badge>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="rounded-full bg-emerald-50 hover:bg-emerald-100"
                onClick={() => setShowWorkOrderModal(true)}
                data-testid="button-new-work-order"
              >
                <Plus className="w-4 h-4 text-emerald-600" />
              </Button>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-sm text-slate-500 mb-4">Create work orders and assign to technicians</p>
              <Link href="/work-orders">
                <Button variant="success" className="w-full" data-testid="button-manage-work-orders">
                  Manage Work Orders
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Billing Sheets Card */}
          <Card className="hover:shadow-md transition-all duration-200 hover:-translate-y-0.5">
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-amber-50">
                  <Receipt className="w-6 h-6 text-amber-500" />
                </div>
                <div>
                  <CardTitle className="text-lg">Billing Sheets</CardTitle>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="rounded-full bg-amber-50 hover:bg-amber-100"
                onClick={() => setShowBillingSheetModal(true)}
                data-testid="button-new-billing-sheet"
              >
                <Plus className="w-4 h-4 text-amber-600" />
              </Button>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-sm text-slate-500 mb-4">Create billing sheets for work without orders</p>
              <Link href="/billing-sheets">
                <Button variant="outline" className="w-full border-amber-200 text-amber-700 hover:bg-amber-50" data-testid="button-manage-billing">
                  Manage Billing
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>

        {/* Recent Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Estimates */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-sky-500" />
                  <CardTitle className="text-base">Recent Estimates</CardTitle>
                </div>
                <Link href="/estimates">
                  <Button variant="ghost" size="sm" className="text-sky-600 hover:text-sky-700" data-testid="link-view-estimates">
                    View All <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {isLoading ? (
                <div className="space-y-3">
                  <TaskCardSkeleton />
                  <TaskCardSkeleton />
                </div>
              ) : recentEstimates.length === 0 ? (
                <div className="text-center py-8">
                  <FileText className="w-12 h-12 text-slate-200 mx-auto mb-3" />
                  <p className="text-slate-500">No recent estimates</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentEstimates.map((estimate: any) => (
                    <Link key={estimate.id} href="/estimates">
                      <div 
                        className="flex items-center justify-between p-4 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer"
                        data-testid={`card-estimate-${estimate.id}`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-slate-900 truncate">{estimate.estimateNumber}</p>
                          <p className="text-sm text-slate-500 truncate">{estimate.customerName}</p>
                        </div>
                        <Badge 
                          variant={
                            estimate.status === 'pending' ? 'warning' : 
                            estimate.status === 'approved' || estimate.status === 'converted_to_work_order' ? 'success' :
                            estimate.status === 'rejected' ? 'destructive' : 'secondary'
                          }
                        >
                          {formatStatus(estimate.status)}
                        </Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Work Orders */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-emerald-500" />
                  <CardTitle className="text-base">Recent Work Orders</CardTitle>
                </div>
                <Link href="/work-orders">
                  <Button variant="ghost" size="sm" className="text-emerald-600 hover:text-emerald-700" data-testid="link-view-work-orders">
                    View All <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {isLoading ? (
                <div className="space-y-3">
                  <TaskCardSkeleton />
                  <TaskCardSkeleton />
                </div>
              ) : recentWorkOrders.length === 0 ? (
                <div className="text-center py-8">
                  <Wrench className="w-12 h-12 text-slate-200 mx-auto mb-3" />
                  <p className="text-slate-500">No recent work orders</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentWorkOrders.map((workOrder: any) => (
                    <Link key={workOrder.id} href="/work-orders">
                      <div 
                        className="flex items-center justify-between p-4 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer"
                        data-testid={`card-work-order-${workOrder.id}`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-slate-900 truncate">{workOrder.workOrderNumber}</p>
                          <p className="text-sm text-slate-500 truncate">{workOrder.customerName}</p>
                        </div>
                        <Badge 
                          variant={
                            workOrder.status === 'in_progress' ? 'info' : 
                            workOrder.status === 'completed' ? 'success' : 
                            workOrder.status === 'assigned' ? 'warning' : 'secondary'
                          }
                        >
                          {formatStatus(workOrder.status)}
                        </Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </PageContent>

      {/* Floating Action Button */}
      <FAB
        onClick={() => setShowCreateSheet(true)}
        testId="fab-create"
      />

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
          if (!open) {
            window.location.reload();
          }
        }}
      />

      {showWorkOrderModal && (
        <WorkOrderForm
          onClose={() => setShowWorkOrderModal(false)}
          onSuccess={() => {
            setShowWorkOrderModal(false);
            window.location.reload();
          }}
        />
      )}

      <StandaloneBillingSheet
        open={showBillingSheetModal}
        onOpenChange={(open) => {
          setShowBillingSheetModal(open);
          if (!open) {
            window.location.reload();
          }
        }}
      />
    </PageContainer>
  );
}
