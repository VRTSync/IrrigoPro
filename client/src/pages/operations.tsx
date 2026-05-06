import { safeGet } from "@/utils/safeStorage";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, FileText, Wrench, ClipboardList, Calendar, DollarSign, User, MapPin, Users, CheckCircle, Clock } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { EstimateWizard } from "@/components/estimates/estimate-wizard";
import { EstimateDetailModal } from "@/components/estimates/estimate-detail-modal";
import { WorkOrderForm } from "@/components/work-orders/work-order-form";
import { CompletedWorkDetailModal } from "@/components/billing/completed-work-detail-modal";

interface Estimate {
  id: number;
  estimateNumber: string;
  customerName: string;
  projectName: string;
  status: string;
  totalAmount: number;
  createdAt: string;
  propertyAddress?: string;
}

interface WorkOrder {
  id: number;
  workOrderNumber: string;
  customerName: string;
  projectName: string;
  status: string;
  assignedTechnicianName?: string;
  totalAmount: number;
  createdAt: string;
  propertyAddress?: string;
  assignedAt?: string;
  startedAt?: string;
  completedAt?: string;
  completionSummary?: string;
  laborHours?: number;
  customerNotes?: string;
}

interface BillingSheet {
  id: number;
  billingSheetNumber: string;
  customerName: string;
  description: string;
  status: string;
  technicianName: string;
  totalAmount: number;
  createdAt: string;
  workDate: string;
  propertyAddress?: string;
  laborHours?: number;
  partsTotal?: number;
  laborTotal?: number;
  submittedAt?: string;
  approvedAt?: string;
}

export default function Operations() {
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [estimateWizardOpen, setEstimateWizardOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'all' | 'estimates' | 'workorders' | 'billingsheets'>('all');
  const [showWorkOrderForm, setShowWorkOrderForm] = useState(false);
  
  const queryClient = useQueryClient();
  
  // Get current user to check role
  const getCurrentUser = () => {
    const savedUser = safeGet("user");
    return savedUser ? JSON.parse(savedUser) : null;
  };
  
  const currentUser = getCurrentUser();
  
  // State for detail modals
  const [selectedEstimate, setSelectedEstimate] = useState<Estimate | null>(null);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<any | null>(null);
  const [selectedBillingSheet, setSelectedBillingSheet] = useState<any | null>(null);

  const { data: estimates = [], isLoading: estimatesLoading } = useQuery<Estimate[]>({
    queryKey: ["/api/estimates"],
  });

  const { data: workOrders = [], isLoading: workOrdersLoading } = useQuery<WorkOrder[]>({
    queryKey: ["/api/work-orders"],
  });

  const { data: billingSheets = [], isLoading: billingSheetsLoading } = useQuery<BillingSheet[]>({
    queryKey: ["/api/billing-sheets"],
  });

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case "pending":
      case "draft":
        return "bg-yellow-100 text-yellow-800";
      case "approved":
      case "active":
        return "bg-green-100 text-green-800";
      case "rejected":
        return "bg-red-100 text-red-800";
      case "work_completed":
        return "bg-blue-100 text-blue-800";
      case "in_progress":
        return "bg-orange-100 text-orange-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  const handleCreateEstimate = () => {
    setCreateModalOpen(false);
    setEstimateWizardOpen(true);
  };

  const handleCreateWorkOrder = () => {
    setCreateModalOpen(false);
    // For company admin users, open inline form instead of redirecting
    if (currentUser?.role === 'company_admin') {
      setShowWorkOrderForm(true);
    }
  };

  const handleWorkOrderFormClose = () => {
    setShowWorkOrderForm(false);
  };

  const handleWorkOrderFormSuccess = () => {
    setShowWorkOrderForm(false);
    queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
  };



  if (estimatesLoading || workOrdersLoading || billingSheetsLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const allItems = [
    ...estimates.map(item => ({ ...item, type: 'estimate' as const })),
    ...workOrders.map(item => ({ ...item, type: 'workorder' as const })),
    ...billingSheets.map(item => ({ ...item, type: 'billingsheet' as const }))
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const getFilteredItems = () => {
    switch (activeFilter) {
      case 'estimates':
        return estimates.map(item => ({ ...item, type: 'estimate' as const }));
      case 'workorders':
        return workOrders.map(item => ({ ...item, type: 'workorder' as const }));
      case 'billingsheets':
        return billingSheets.map(item => ({ ...item, type: 'billingsheet' as const }));
      default:
        return allItems;
    }
  };

  const filteredItems = getFilteredItems();

  return (
    <div className="max-w-7xl mx-auto -mt-2">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 sm:mb-6 pt-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Operations</h1>
          <p className="text-gray-600 mt-1">Manage all estimates, work orders, and billing sheets</p>
        </div>
        <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
          <DialogTrigger asChild>
            <Button className="mt-4 sm:mt-0">
              <Plus className="h-4 w-4 mr-2" />
              Create New
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create New Work Item</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <Button 
                className="w-full h-16 flex flex-col items-center justify-center space-y-2"
                onClick={handleCreateEstimate}
              >
                <FileText className="h-6 w-6" />
                <span>Create Estimate</span>
              </Button>
              {currentUser?.role === 'company_admin' ? (
                <Button
                  className="w-full h-16 flex flex-col items-center justify-center space-y-2"
                  variant="outline"
                  onClick={handleCreateWorkOrder}
                >
                  <Wrench className="h-6 w-6" />
                  <span>Create Work Order</span>
                </Button>
              ) : (
                <Link href="/work-orders?create=true">
                  <Button
                    className="w-full h-16 flex flex-col items-center justify-center space-y-2"
                    variant="outline"
                    onClick={() => setCreateModalOpen(false)}
                  >
                    <Wrench className="h-6 w-6" />
                    <span>Create Work Order</span>
                  </Button>
                </Link>
              )}
              <Link href="/billing-sheets?create=true">
                <Button
                  className="w-full h-16 flex flex-col items-center justify-center space-y-2"
                  variant="outline"
                  onClick={() => setCreateModalOpen(false)}
                >
                  <ClipboardList className="h-6 w-6" />
                  <span>Create Billing Sheet</span>
                </Button>
              </Link>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filter Buttons */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Button
          variant={activeFilter === 'all' ? 'default' : 'outline'}
          onClick={() => setActiveFilter('all')}
          className="flex flex-col items-center justify-center h-16 space-y-1"
        >
          <span className="font-medium">All</span>
          <span className="text-xs">({allItems.length})</span>
        </Button>
        <Button
          variant={activeFilter === 'estimates' ? 'default' : 'outline'}
          onClick={() => setActiveFilter('estimates')}
          className="flex flex-col items-center justify-center h-16 space-y-1"
        >
          <FileText className="h-4 w-4" />
          <span className="text-xs">Estimates ({estimates.length})</span>
        </Button>
        <Button
          variant={activeFilter === 'workorders' ? 'default' : 'outline'}
          onClick={() => setActiveFilter('workorders')}
          className="flex flex-col items-center justify-center h-16 space-y-1"
        >
          <Wrench className="h-4 w-4" />
          <span className="text-xs">Work Orders ({workOrders.length})</span>
        </Button>
        <Button
          variant={activeFilter === 'billingsheets' ? 'default' : 'outline'}
          onClick={() => setActiveFilter('billingsheets')}
          className="flex flex-col items-center justify-center h-16 space-y-1"
        >
          <ClipboardList className="h-4 w-4" />
          <span className="text-xs">Billing Sheets ({billingSheets.length})</span>
        </Button>
      </div>

      {/* Filtered Results */}
      <div className="space-y-4">
        {filteredItems.length === 0 ? (
          <Card className="p-8 text-center">
            <div className="text-gray-500">
              {activeFilter === 'estimates' && <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />}
              {activeFilter === 'workorders' && <Wrench className="h-12 w-12 mx-auto mb-4 opacity-50" />}
              {activeFilter === 'billingsheets' && <ClipboardList className="h-12 w-12 mx-auto mb-4 opacity-50" />}
              {activeFilter === 'all' && <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />}
              <p>No {activeFilter === 'all' ? 'work items' : activeFilter.replace('sheets', ' sheets').replace('orders', ' orders')} found</p>
              {activeFilter === 'all' && (
                <p className="text-sm mt-2">Create your first estimate, work order, or billing sheet to get started.</p>
              )}
            </div>
          </Card>
        ) : (
          filteredItems.map((item) => (
            <Card key={`${item.type}-${item.id}`} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between space-y-4 lg:space-y-0">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      {item.type === 'estimate' && <FileText className="h-5 w-5 text-blue-600" />}
                      {item.type === 'workorder' && <Wrench className="h-5 w-5 text-green-600" />}
                      {item.type === 'billingsheet' && <ClipboardList className="h-5 w-5 text-purple-600" />}
                      <h3 className="font-semibold text-lg">
                        {item.type === 'estimate' && (item as any).estimateNumber}
                        {item.type === 'workorder' && (item as any).workOrderNumber}
                        {item.type === 'billingsheet' && (
                          (item as any).billingSheetNumber || `Billing Sheet #${(item as any).id}`
                        )}
                      </h3>
                      <Badge className={getStatusColor(item.status)}>
                        {item.status.replace('_', ' ')}
                      </Badge>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm text-gray-600">
                      <div className="flex items-center space-x-2">
                        <User className="h-4 w-4" />
                        <span>{item.customerName}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Calendar className="h-4 w-4" />
                        <span>{format(new Date(item.createdAt), "MMM d, yyyy")}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <DollarSign className="h-4 w-4" />
                        <span>{formatCurrency(item.totalAmount)}</span>
                      </div>
                      {(item.type === 'estimate' || item.type === 'workorder') && (item as any).propertyAddress && (
                        <div className="flex items-center space-x-2">
                          <MapPin className="h-4 w-4" />
                          <span className="truncate">{(item as any).propertyAddress}</span>
                        </div>
                      )}
                      {item.type === 'workorder' && (item as any).assignedTechnicianName && (
                        <div className="flex items-center space-x-2">
                          <User className="h-4 w-4" />
                          <span>Tech: {(item as any).assignedTechnicianName}</span>
                        </div>
                      )}
                      {item.type === 'billingsheet' && (
                        <>
                          <div className="flex items-center space-x-2">
                            <User className="h-4 w-4" />
                            <span>Tech: {(item as any).technicianName}</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Calendar className="h-4 w-4" />
                            <span>Work: {format(new Date((item as any).workDate), "MMM d, yyyy")}</span>
                          </div>
                        </>
                      )}
                    </div>
                    
                    <div className="mt-2">
                      {item.type === 'estimate' && (
                        <p className="text-gray-700 font-medium">{(item as any).projectName}</p>
                      )}
                      {item.type === 'workorder' && (
                        <p className="text-gray-700 font-medium">{(item as any).projectName}</p>
                      )}
                      {item.type === 'billingsheet' && (
                        <div>
                          <p className="text-gray-700 font-medium">
                            Work for {(item as any).customerName}
                          </p>
                          <p className="text-gray-600 text-sm mt-1 line-clamp-2">
                            {(item as any).description}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex space-x-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => {
                        if (item.type === 'estimate') {
                          setSelectedEstimate(item as Estimate);
                        } else if (item.type === 'workorder') {
                          setSelectedWorkOrder(item);
                        } else if (item.type === 'billingsheet') {
                          setSelectedBillingSheet(item);
                        }
                      }}
                    >
                      View Details
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Estimate Wizard */}
      <EstimateWizard
        open={estimateWizardOpen}
        onOpenChange={setEstimateWizardOpen}
      />

      {/* Detail Modals */}
      {selectedEstimate && (
        <EstimateDetailModal
          estimateId={selectedEstimate.id}
          open={!!selectedEstimate}
          onOpenChange={(open) => {
            if (!open) setSelectedEstimate(null);
          }}
          onEdit={(estimateId) => {
            setSelectedEstimate(null);
            // Could navigate to estimates page with edit mode
          }}
        />
      )}

      {selectedWorkOrder && (
        <CompletedWorkDetailModal
          type="work_order"
          id={selectedWorkOrder.id}
          data={selectedWorkOrder}
          open={!!selectedWorkOrder}
          onOpenChange={(open) => { if (!open) setSelectedWorkOrder(null); }}
          showPricing={true}
        />
      )}


      {/* Billing Sheet Detail Modal */}
      {selectedBillingSheet && (
        <CompletedWorkDetailModal
          type="billing_sheet"
          id={selectedBillingSheet.id}
          data={selectedBillingSheet}
          open={!!selectedBillingSheet}
          onOpenChange={(open) => { if (!open) setSelectedBillingSheet(null); }}
          showPricing={true}
        />
      )}

      {/* Work Order Form for Company Admin Users */}
      {showWorkOrderForm && (
        <Dialog open={showWorkOrderForm} onOpenChange={setShowWorkOrderForm}>
          <DialogContent className="max-w-4xl max-h-[95vh] overflow-y-auto">
            <WorkOrderForm 
              onClose={handleWorkOrderFormClose}
              onSuccess={handleWorkOrderFormSuccess}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}