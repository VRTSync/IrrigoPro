import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Plus, Eye, User, CheckCircle, ExternalLink, ThumbsUp, RotateCcw, Clock, Shield, ChevronDown, ChevronRight, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { WorkOrder } from "@workspace/db/schema";
import { CompletedWorkDetailModal } from "@/components/billing/completed-work-detail-modal";
import { BilledIndicator, BilledBadge } from "@/components/ui/billed-indicator";

interface WorkOrdersManagerProps {
  onBack: () => void;
}

export function WorkOrdersManager({ onBack }: WorkOrdersManagerProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [activeExpanded, setActiveExpanded] = useState(true);
  const [awaitingApprovalExpanded, setAwaitingApprovalExpanded] = useState(true);
  const [awaitingBillingExpanded, setAwaitingBillingExpanded] = useState(true);
  const [cancelledExpanded, setCancelledExpanded] = useState(false);
  const [billedExpanded, setBilledExpanded] = useState(false);
  const [billedMonthsExpanded, setBilledMonthsExpanded] = useState<Record<string, boolean>>({});
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: workOrders, isLoading } = useQuery<WorkOrder[]>({
    queryKey: ["/api/work-orders"],
  });

  const assignTechnician = useMutation({
    mutationFn: async ({ workOrderId, technicianId }: { workOrderId: number, technicianId: number }) => {
      return await apiRequest(`/api/work-orders/${workOrderId}/assign`, "POST", { technicianId });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Technician assigned successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to assign technician",
        variant: "destructive",
      });
    },
  });

  const approveWorkOrder = useMutation({
    mutationFn: async (workOrderId: number) => {
      return await apiRequest(`/api/work-orders/${workOrderId}/approve`, "POST", {});
    },
    onSuccess: () => {
      toast({
        title: "Approved",
        description: "Work order approved and passed to billing",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err?.message || "Failed to approve work order",
        variant: "destructive",
      });
    },
  });

  const returnForCorrection = useMutation({
    mutationFn: async (workOrderId: number) => {
      return await apiRequest(`/api/work-orders/${workOrderId}/return-for-correction`, "POST", {});
    },
    onSuccess: () => {
      toast({
        title: "Returned",
        description: "Work order returned to field for correction",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err?.message || "Failed to return work order",
        variant: "destructive",
      });
    },
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'assigned':
        return 'bg-blue-100 text-blue-800';
      case 'in_progress':
        return 'bg-blue-100 text-blue-800';
      case 'work_completed':
        return 'bg-green-100 text-green-800';
      case 'pending_manager_review':
        return 'bg-orange-100 text-orange-800';
      case 'approved_passed_to_billing':
        return 'bg-teal-100 text-teal-800';
      case 'billed':
        return 'bg-purple-100 text-purple-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'pending_manager_review': return 'Pending Manager Review';
      case 'approved_passed_to_billing': return 'Approved / Passed to Billing';
      case 'in_progress': return 'In Progress';
      default: return status.replace(/_/g, ' ');
    }
  };

  const isBilled = (workOrder: WorkOrder) =>
    workOrder.status === 'billed' || workOrder.invoiceId != null;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const handleViewDetails = (workOrder: WorkOrder) => {
    setSelectedWorkOrder(workOrder);
    setShowDetailModal(true);
  };

  // "not_yet_billed" filter covers all non-invoiced post-completion states to prevent
  // tickets from disappearing between status transitions
  const notYetBilledStatuses = ['work_completed', 'pending_manager_review', 'approved_passed_to_billing'];

  const filteredWorkOrders = workOrders?.filter(wo => {
    if (statusFilter === "all") return true;
    if (statusFilter === "billed") return isBilled(wo);
    if (statusFilter === "not_yet_billed") return notYetBilledStatuses.includes(wo.status) && !isBilled(wo);
    if (statusFilter === "assigned") return wo.status === 'pending' || wo.status === 'assigned';
    return wo.status === statusFilter;
  }) ?? [];

  const activeStatuses = ['pending', 'assigned', 'in_progress'];
  // "Awaiting Approval" = work_completed + pending_manager_review (manager must act on both)
  const awaitingApprovalOrders = filteredWorkOrders.filter(wo =>
    wo.status === 'work_completed' || wo.status === 'pending_manager_review'
  );
  // "Awaiting Billing" = approved_passed_to_billing (approved by manager, ready for invoice)
  const awaitingBillingOrders = filteredWorkOrders.filter(wo =>
    wo.status === 'approved_passed_to_billing' && !isBilled(wo)
  );
  const activeWorkOrders = filteredWorkOrders.filter(wo => activeStatuses.includes(wo.status));
  const cancelledWorkOrders = filteredWorkOrders.filter(wo => wo.status === 'cancelled');
  // Keep for potential filter-count reference; no longer rendered as a standalone top section
  const pendingReviewOrders = filteredWorkOrders.filter(wo => wo.status === 'pending_manager_review');
  const billedWorkOrders = filteredWorkOrders.filter(wo => isBilled(wo))
    .sort((a, b) => new Date(b.billedAt || b.completedAt || 0).getTime() - new Date(a.billedAt || a.completedAt || 0).getTime());

  const formatDate = (date: string | Date | null | undefined) => {
    if (!date) return '';
    return new Date(date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  const renderWorkOrderCard = (workOrder: WorkOrder) => (
    <Card key={workOrder.id} className={`hover:shadow-md transition-shadow ${
      isBilled(workOrder) ? 'bg-purple-50/60 border border-purple-200' :
      workOrder.status === 'pending_manager_review' ? 'border-orange-300 bg-orange-50/30' :
      workOrder.status === 'approved_passed_to_billing' ? 'border-teal-200' : ''
    }`}>
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h3 className="text-lg font-semibold">Work Order #{workOrder.id}</h3>
              <Badge className={getStatusColor(workOrder.status)}>
                {getStatusLabel(workOrder.status)}
              </Badge>
              {isBilled(workOrder) && workOrder.status !== 'billed' && (
                <BilledBadge />
              )}
            </div>
            <p className="text-gray-600 mb-1">Customer: {workOrder.customerName}</p>
            <p className="text-gray-600 mb-1">Property: {workOrder.projectAddress}</p>
            <p className="text-sm text-gray-500">
              Created: {new Date(workOrder.createdAt).toLocaleDateString()}
            </p>
            {workOrder.estimateId && (
              <p className="text-sm text-purple-600 mt-1 flex items-center gap-1">
                <ExternalLink className="w-3 h-3" />
                From Estimate #{workOrder.estimateId}
              </p>
            )}
            {workOrder.assignedTechnicianName && (
              <p className="text-sm text-blue-600 mt-1">
                Assigned to: {workOrder.assignedTechnicianName}
              </p>
            )}
            {isBilled(workOrder) && (
              <div className="mt-3">
                <BilledIndicator compact invoiceId={workOrder.invoiceId} billedAt={workOrder.billedAt} />
              </div>
            )}
            {/* Approval stamp display */}
            {(workOrder as any).approvedBy && (workOrder as any).approvedAt && (
              <div className="mt-2 p-2 bg-teal-50 border border-teal-200 rounded text-xs text-teal-800">
                <div className="flex items-center gap-1 font-medium mb-1">
                  <Shield className="w-3 h-3" />
                  Approved by {(workOrder as any).approvedBy}
                </div>
                <div>on {new Date((workOrder as any).approvedAt).toLocaleString()}</div>
                {(workOrder as any).approvedTotal && (
                  <div className="mt-1 font-semibold">
                    Approved Total: {formatCurrency(parseFloat((workOrder as any).approvedTotal))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 flex-shrink-0 w-full sm:w-auto">
            <div className="hidden sm:block text-right mb-1">
              <p className="text-sm font-semibold text-gray-900">
                {workOrder.status === 'work_completed' || workOrder.status === 'pending_manager_review' || workOrder.status === 'approved_passed_to_billing' || isBilled(workOrder) ? 'Completed' : workOrder.priority.toUpperCase()}
              </p>
              <p className="text-xs text-gray-500">Priority</p>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => handleViewDetails(workOrder)}
              className="w-full sm:w-auto"
            >
              <Eye className="w-4 h-4 mr-2" />
              View Details
            </Button>

            {!isBilled(workOrder) && workOrder.status === 'pending' && (
              <Select onValueChange={(techId) => {
                assignTechnician.mutate({
                  workOrderId: workOrder.id,
                  technicianId: parseInt(techId)
                });
              }}>
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue placeholder="Assign Tech" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">Field Tech</SelectItem>
                  <SelectItem value="4">Tech 2</SelectItem>
                  <SelectItem value="5">Tech 3</SelectItem>
                </SelectContent>
              </Select>
            )}

            {/* Manager approval actions for pending_manager_review */}
            {workOrder.status === 'pending_manager_review' && (
              <div className="flex flex-col gap-2">
                <Button
                  size="sm"
                  className="bg-teal-600 hover:bg-teal-700 text-white w-full sm:w-auto"
                  onClick={() => approveWorkOrder.mutate(workOrder.id)}
                  disabled={approveWorkOrder.isPending}
                >
                  <ThumbsUp className="w-3 h-3 mr-1" />
                  Approve / Pass to Billing
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-orange-300 text-orange-700 hover:bg-orange-50 w-full sm:w-auto"
                  onClick={() => returnForCorrection.mutate(workOrder.id)}
                  disabled={returnForCorrection.isPending}
                >
                  <RotateCcw className="w-3 h-3 mr-1" />
                  Return for Correction
                </Button>
              </div>
            )}

            {!isBilled(workOrder) && workOrder.status === 'in_progress' && (
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 w-full sm:w-auto"
                onClick={() => {
                  toast({
                    title: "Work Order Completed",
                    description: `Work Order #${workOrder.id} marked as completed`,
                  });
                }}
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                Mark Complete
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (showCreateForm) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="mb-6">
          <Button variant="outline" onClick={() => setShowCreateForm(false)}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Work Orders
          </Button>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Create New Work Order</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600">Work order creation form would go here...</p>
            <Button
              className="mt-4"
              onClick={() => {
                setShowCreateForm(false);
                toast({
                  title: "Demo",
                  description: "Work order creation form would be implemented here",
                });
              }}
            >
              Save Work Order
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={onBack}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
            <h1 className="text-3xl font-bold text-gray-900">Work Orders</h1>
          </div>
          <Button onClick={() => setShowCreateForm(true)} className="bg-green-600 hover:bg-green-700">
            <Plus className="w-4 h-4 mr-2" />
            New Work Order
          </Button>
        </div>

        {/* Filter Pills */}
        <div className="flex gap-2 flex-wrap mb-4">
          {[
            { value: "all", label: "All" },
            { value: "assigned", label: "Pending" },
            { value: "in_progress", label: "Active" },
            { value: "work_completed", label: "Completed" },
            { value: "not_yet_billed", label: "Not Yet Billed" },
            { value: "billed", label: "Billed" },
          ].map(({ value, label }) => (
            <Button
              key={value}
              variant={statusFilter === value ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(value)}
              className={value === "billed" && statusFilter !== "billed" ? "border-purple-300 text-purple-700 hover:bg-purple-50" : ""}
            >
              {label}
            </Button>
          ))}
        </div>

        {/* Work Orders List */}
        <div className="space-y-6">
          {isLoading ? (
            <div className="text-center py-8">
              <p className="text-gray-500">Loading work orders...</p>
            </div>
          ) : filteredWorkOrders.length === 0 ? (
            <Card>
              <CardContent className="text-center py-8">
                <p className="text-gray-500 mb-4">No work orders found</p>
                <Button onClick={() => setShowCreateForm(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create First Work Order
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Active Section */}
              {(statusFilter === "all" || statusFilter === "assigned" || statusFilter === "in_progress") && activeWorkOrders.length > 0 && (
                <div>
                  <button
                    onClick={() => setActiveExpanded(!activeExpanded)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      {activeExpanded ? <ChevronDown className="w-5 h-5 text-blue-700" /> : <ChevronRight className="w-5 h-5 text-blue-700" />}
                      <span className="text-base font-semibold text-blue-900">Active</span>
                      <Badge className="bg-blue-200 text-blue-900 hover:bg-blue-200">{activeWorkOrders.length}</Badge>
                    </div>
                  </button>
                  {activeExpanded && (
                    <div className="mt-3 space-y-4">
                      {activeWorkOrders.map(renderWorkOrderCard)}
                    </div>
                  )}
                </div>
              )}

              {/* Awaiting Manager Approval: work_completed + pending_manager_review */}
              {(statusFilter === "all" || statusFilter === "work_completed" || statusFilter === "pending_manager_review" || statusFilter === "not_yet_billed") && awaitingApprovalOrders.length > 0 && (
                <div>
                  <button
                    onClick={() => setAwaitingApprovalExpanded(!awaitingApprovalExpanded)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      {awaitingApprovalExpanded ? <ChevronDown className="w-5 h-5 text-orange-700" /> : <ChevronRight className="w-5 h-5 text-orange-700" />}
                      <Clock className="w-4 h-4 text-orange-600" />
                      <span className="text-base font-semibold text-orange-900">Awaiting Manager Approval</span>
                      <Badge className="bg-orange-200 text-orange-900 hover:bg-orange-200">{awaitingApprovalOrders.length}</Badge>
                    </div>
                  </button>
                  {awaitingApprovalExpanded && (
                    <div className="mt-3 space-y-4">
                      {awaitingApprovalOrders.map(renderWorkOrderCard)}
                    </div>
                  )}
                </div>
              )}

              {/* Awaiting Billing: approved_passed_to_billing (not yet invoiced) */}
              {(statusFilter === "all" || statusFilter === "approved_passed_to_billing" || statusFilter === "not_yet_billed") && awaitingBillingOrders.length > 0 && (
                <div>
                  <button
                    onClick={() => setAwaitingBillingExpanded(!awaitingBillingExpanded)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-teal-50 border border-teal-200 rounded-lg hover:bg-teal-100 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      {awaitingBillingExpanded ? <ChevronDown className="w-5 h-5 text-teal-700" /> : <ChevronRight className="w-5 h-5 text-teal-700" />}
                      <CheckCircle className="w-4 h-4 text-teal-600" />
                      <span className="text-base font-semibold text-teal-900">Approved — Awaiting Billing</span>
                      <Badge className="bg-teal-200 text-teal-900 hover:bg-teal-200">{awaitingBillingOrders.length}</Badge>
                    </div>
                  </button>
                  {awaitingBillingExpanded && (
                    <div className="mt-3 space-y-4">
                      {awaitingBillingOrders.map(renderWorkOrderCard)}
                    </div>
                  )}
                </div>
              )}

              {/* Cancelled Section — clearly separate from completed work */}
              {(statusFilter === "all" || statusFilter === "cancelled") && cancelledWorkOrders.length > 0 && (
                <div>
                  <button
                    onClick={() => setCancelledExpanded(!cancelledExpanded)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      {cancelledExpanded ? <ChevronDown className="w-5 h-5 text-red-600" /> : <ChevronRight className="w-5 h-5 text-red-600" />}
                      <XCircle className="w-4 h-4 text-red-500" />
                      <span className="text-base font-semibold text-red-800">Cancelled</span>
                      <Badge className="bg-red-200 text-red-900 hover:bg-red-200">{cancelledWorkOrders.length}</Badge>
                    </div>
                  </button>
                  {cancelledExpanded && (
                    <div className="mt-3 space-y-4">
                      {cancelledWorkOrders.map(renderWorkOrderCard)}
                    </div>
                  )}
                </div>
              )}

              {/* Billed Section */}
              {(statusFilter === "all" || statusFilter === "billed") && billedWorkOrders.length > 0 && (
                <div>
                  <button
                    onClick={() => setBilledExpanded(!billedExpanded)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      {billedExpanded ? <ChevronDown className="w-5 h-5 text-purple-700" /> : <ChevronRight className="w-5 h-5 text-purple-700" />}
                      <span className="text-base font-semibold text-purple-900">Billed</span>
                      <Badge className="bg-purple-200 text-purple-900 hover:bg-purple-200">{billedWorkOrders.length}</Badge>
                    </div>
                  </button>
                  {billedExpanded && (
                    <div className="mt-3 space-y-4">
                      {(() => {
                        const byMonth: Record<string, WorkOrder[]> = {};
                        for (const wo of billedWorkOrders) {
                          const key = formatDate(wo.billedAt || wo.completedAt) || 'Unknown';
                          if (!byMonth[key]) byMonth[key] = [];
                          byMonth[key].push(wo);
                        }
                        return Object.entries(byMonth).map(([month, monthWOs]) => {
                          const isExpanded = billedMonthsExpanded[month] !== false;
                          return (
                            <div key={month}>
                              <button
                                onClick={() => setBilledMonthsExpanded(prev => ({ ...prev, [month]: !isExpanded }))}
                                className="w-full flex items-center gap-2 px-3 py-2 bg-purple-50 border border-purple-100 rounded-lg hover:bg-purple-100 transition-colors mb-2"
                              >
                                {isExpanded ? <ChevronDown className="w-4 h-4 text-purple-600" /> : <ChevronRight className="w-4 h-4 text-purple-600" />}
                                <span className="text-sm font-semibold text-purple-800">{month} — Billed</span>
                                <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100 text-xs">{monthWOs.length}</Badge>
                              </button>
                              {isExpanded && (
                                <div className="space-y-3 ml-4">
                                  {monthWOs.map(renderWorkOrderCard)}
                                </div>
                              )}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {selectedWorkOrder && (
        <CompletedWorkDetailModal
          type="work_order"
          id={selectedWorkOrder.id}
          data={selectedWorkOrder}
          open={showDetailModal}
          onOpenChange={(open) => {
            setShowDetailModal(open);
            if (!open) setSelectedWorkOrder(null);
          }}
          showPricing={true}
        />
      )}
    </>
  );
}
