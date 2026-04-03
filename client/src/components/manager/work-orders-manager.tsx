import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Plus, Eye, User, CheckCircle, ExternalLink, ChevronDown, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { WorkOrder } from "@shared/schema";
import { CompletedWorkDetailModal } from "@/components/billing/completed-work-detail-modal";

interface WorkOrdersManagerProps {
  onBack: () => void;
}

export function WorkOrdersManager({ onBack }: WorkOrdersManagerProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [activeExpanded, setActiveExpanded] = useState(true);
  const [completedExpanded, setCompletedExpanded] = useState(true);
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

  const isBilled = (wo: WorkOrder) => wo.status === 'billed' || wo.invoiceId != null;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-800">Pending</Badge>;
      case 'in_progress':
        return <Badge className="bg-blue-100 text-blue-800">In Progress</Badge>;
      case 'completed':
        return <Badge className="bg-green-100 text-green-800">Completed</Badge>;
      case 'billed':
        return <Badge className="bg-purple-100 text-purple-800">Billed</Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-800">{status.replace(/_/g, ' ')}</Badge>;
    }
  };

  const handleViewDetails = (workOrder: WorkOrder) => {
    setSelectedWorkOrder(workOrder);
    setShowDetailModal(true);
  };

  const filteredWorkOrders = workOrders?.filter(wo => {
    if (statusFilter === "all") return true;
    if (statusFilter === "billed") return isBilled(wo);
    if (statusFilter === "not_yet_billed") return wo.status === 'completed' && !isBilled(wo);
    if (statusFilter === "assigned") return wo.status === 'pending' || wo.status === 'assigned';
    return wo.status === statusFilter;
  }) ?? [];

  const activeStatuses = ['pending', 'assigned', 'in_progress'];
  const completedStatuses = ['completed', 'cancelled'];
  const activeWorkOrders = filteredWorkOrders.filter(wo => activeStatuses.includes(wo.status));
  const notYetBilledWorkOrders = filteredWorkOrders.filter(wo => completedStatuses.includes(wo.status) && !isBilled(wo));
  const billedWorkOrders = filteredWorkOrders.filter(wo => isBilled(wo))
    .sort((a, b) => new Date(b.billedAt || b.completedAt || 0).getTime() - new Date(a.billedAt || a.completedAt || 0).getTime());

  const formatDate = (date: string | Date | null | undefined) => {
    if (!date) return '';
    return new Date(date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  const renderWorkOrderCard = (workOrder: WorkOrder) => (
    <Card key={workOrder.id} className={`hover:shadow-md transition-shadow ${isBilled(workOrder) ? 'opacity-80' : ''}`}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-lg font-semibold">Work Order #{workOrder.id}</h3>
              {getStatusBadge(workOrder.status)}
              {isBilled(workOrder) && workOrder.status !== 'billed' && (
                <Badge className="bg-purple-100 text-purple-800">Billed</Badge>
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
            {isBilled(workOrder) && workOrder.billedAt && (
              <p className="text-sm text-purple-700 mt-1 font-medium">
                Billed on {new Date(workOrder.billedAt).toLocaleDateString()}
              </p>
            )}
            {isBilled(workOrder) && (
              <p className="text-xs text-purple-700 mt-1 font-medium">
                This record has been billed and cannot be edited.
              </p>
            )}
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-lg font-semibold text-gray-900">
                {workOrder.status === 'completed' || isBilled(workOrder) ? 'Completed' : workOrder.priority.toUpperCase()}
              </p>
              <p className="text-sm text-gray-500">Priority</p>
            </div>

            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleViewDetails(workOrder)}
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
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Assign Tech" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3">Field Tech</SelectItem>
                    <SelectItem value="4">Tech 2</SelectItem>
                    <SelectItem value="5">Tech 3</SelectItem>
                  </SelectContent>
                </Select>
              )}

              {!isBilled(workOrder) && workOrder.status === 'in_progress' && (
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-700"
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
            { value: "completed", label: "Completed" },
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
        <div className="space-y-4">
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
              {(statusFilter === "all" || statusFilter === "assigned" || statusFilter === "in_progress") && (
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
                      {activeWorkOrders.length === 0 ? (
                        <p className="text-center text-gray-500 py-6">No active work orders</p>
                      ) : (
                        activeWorkOrders.map(renderWorkOrderCard)
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Completed (Not Yet Billed) Section */}
              {(statusFilter === "all" || statusFilter === "completed" || statusFilter === "not_yet_billed") && (
                <div>
                  <button
                    onClick={() => setCompletedExpanded(!completedExpanded)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      {completedExpanded ? <ChevronDown className="w-5 h-5 text-gray-600" /> : <ChevronRight className="w-5 h-5 text-gray-600" />}
                      <span className="text-base font-semibold text-gray-700">Completed</span>
                      <Badge variant="secondary">{notYetBilledWorkOrders.length}</Badge>
                    </div>
                  </button>
                  {completedExpanded && (
                    <div className="mt-3 space-y-4">
                      {notYetBilledWorkOrders.length === 0 ? (
                        <p className="text-center text-gray-500 py-6">No completed work orders</p>
                      ) : (
                        notYetBilledWorkOrders.map(renderWorkOrderCard)
                      )}
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
