import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, FileText, Wrench, ClipboardList, Calendar, DollarSign, User, MapPin, Users, CheckCircle, Clock } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { EnhancedEstimateModal } from "@/components/estimates/enhanced-estimate-modal";
import { EstimateDetailModal } from "@/components/estimates/estimate-detail-modal";

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
}

export default function Operations() {
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [estimateModalOpen, setEstimateModalOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'all' | 'estimates' | 'workorders' | 'billingsheets'>('all');
  
  // State for detail modals
  const [selectedEstimate, setSelectedEstimate] = useState<Estimate | null>(null);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null);
  const [selectedBillingSheet, setSelectedBillingSheet] = useState<BillingSheet | null>(null);

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
      case "completed":
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
    setEstimateModalOpen(true);
  };

  const CreateWorkModal = () => (
    <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
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
  );

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
        <CreateWorkModal />
        <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
          <DialogTrigger asChild>
            <Button className="mt-4 sm:mt-0">
              <Plus className="h-4 w-4 mr-2" />
              Create New
            </Button>
          </DialogTrigger>
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
                          setSelectedWorkOrder(item as WorkOrder);
                        } else if (item.type === 'billingsheet') {
                          setSelectedBillingSheet(item as BillingSheet);
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

      {/* Enhanced Estimate Modal */}
      <EnhancedEstimateModal 
        open={estimateModalOpen} 
        onOpenChange={setEstimateModalOpen}
        estimateId={null}
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
        <Dialog open={!!selectedWorkOrder} onOpenChange={() => setSelectedWorkOrder(null)}>
          <DialogContent className="w-[95vw] max-w-6xl h-[95vh] max-h-[95vh] overflow-hidden p-0 flex flex-col">
            <DialogHeader className="p-4 sm:p-6 border-b border-gray-200 flex-shrink-0">
              <DialogTitle className="flex items-center space-x-2 text-lg sm:text-xl">
                <Wrench className="w-5 h-5" />
                <span>Work Order Details - {selectedWorkOrder.workOrderNumber}</span>
              </DialogTitle>
            </DialogHeader>

            {/* Status Banner for Completed Work Orders */}
            {selectedWorkOrder.status === 'completed' && (
              <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white p-4 sm:p-6 flex-shrink-0 border-b">
                <div className="flex items-center justify-center space-x-3">
                  <CheckCircle className="w-8 h-8 flex-shrink-0" />
                  <div className="text-center">
                    <h3 className="text-xl sm:text-2xl font-bold">✓ WORK ORDER COMPLETED</h3>
                    <p className="text-green-100 text-sm sm:text-base mt-1">
                      Work has been completed and is ready for invoicing
                    </p>
                  </div>
                  <CheckCircle className="w-8 h-8 flex-shrink-0" />
                </div>
              </div>
            )}

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              <div className="space-y-4 sm:space-y-6">
                {/* Header Information */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg flex items-center space-x-2">
                        <Wrench className="w-5 h-5" />
                        <span>Work Order Information</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div>
                        <span className="font-medium text-gray-700">Work Order Number:</span>
                        <p className="text-lg font-semibold text-gray-900">{selectedWorkOrder.workOrderNumber}</p>
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">Project Name:</span>
                        <p className="text-gray-900">{selectedWorkOrder.projectName}</p>
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">Status:</span>
                        <div className="mt-1">
                          <Badge className={`${getStatusColor(selectedWorkOrder.status)} text-sm font-semibold px-3 py-1`}>
                            {selectedWorkOrder.status.replace('_', ' ').toUpperCase()}
                          </Badge>
                        </div>
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">Created Date:</span>
                        <p className="text-gray-900">{format(new Date(selectedWorkOrder.createdAt), "MMM d, yyyy 'at' h:mm a")}</p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg flex items-center space-x-2">
                        <Users className="w-5 h-5" />
                        <span>Customer & Assignment</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div>
                        <span className="font-medium text-gray-700">Customer Name:</span>
                        <p className="text-gray-900">{selectedWorkOrder.customerName}</p>
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">Property Address:</span>
                        <p className="text-gray-900">{selectedWorkOrder.propertyAddress || 'Not provided'}</p>
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">Assigned Technician:</span>
                        <p className="text-gray-900">{selectedWorkOrder.assignedTechnicianName || 'Not assigned'}</p>
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">Assignment Date:</span>
                        <p className="text-gray-900">
                          {selectedWorkOrder.assignedAt 
                            ? format(new Date(selectedWorkOrder.assignedAt), "MMM d, yyyy 'at' h:mm a")
                            : 'Not assigned yet'
                          }
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Work Summary */}
                {(selectedWorkOrder.completionSummary || selectedWorkOrder.laborHours) && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg flex items-center space-x-2">
                        <Clock className="w-5 h-5" />
                        <span>Work Summary</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {selectedWorkOrder.laborHours && (
                        <div>
                          <span className="font-medium text-gray-700">Labor Hours:</span>
                          <p className="text-gray-900 font-semibold">{selectedWorkOrder.laborHours} hours</p>
                        </div>
                      )}
                      {selectedWorkOrder.completionSummary && (
                        <div>
                          <span className="font-medium text-gray-700">Completion Summary:</span>
                          <p className="text-gray-900 mt-2 bg-gray-50 p-4 rounded-lg">{selectedWorkOrder.completionSummary}</p>
                        </div>
                      )}
                      {selectedWorkOrder.customerNotes && (
                        <div>
                          <span className="font-medium text-gray-700">Customer Notes:</span>
                          <p className="text-gray-900 mt-2 bg-blue-50 p-4 rounded-lg border-l-4 border-blue-400">{selectedWorkOrder.customerNotes}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Financial Summary */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center space-x-2">
                      <DollarSign className="w-5 h-5" />
                      <span>Financial Summary</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-gradient-to-br from-gray-50 to-gray-100 p-6 rounded-lg border">
                      <div className="flex justify-between items-center py-3 bg-white rounded-lg px-4 border-2 border-blue-200">
                        <span className="text-xl font-bold text-gray-900">Total Amount:</span>
                        <span className="text-2xl font-bold text-blue-600">{formatCurrency(selectedWorkOrder.totalAmount)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Work Progress */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center space-x-2">
                      <Calendar className="w-5 h-5" />
                      <span>Work Progress Timeline</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-3">
                      <div className="flex items-center space-x-3">
                        <div className="w-3 h-3 bg-blue-500 rounded-full flex-shrink-0"></div>
                        <div>
                          <p className="font-medium text-gray-900">Work Order Created</p>
                          <p className="text-sm text-gray-600">{format(new Date(selectedWorkOrder.createdAt), "MMM d, yyyy 'at' h:mm a")}</p>
                        </div>
                      </div>
                      
                      {selectedWorkOrder.assignedAt && (
                        <div className="flex items-center space-x-3">
                          <div className="w-3 h-3 bg-orange-500 rounded-full flex-shrink-0"></div>
                          <div>
                            <p className="font-medium text-gray-900">Assigned to Technician</p>
                            <p className="text-sm text-gray-600">{format(new Date(selectedWorkOrder.assignedAt), "MMM d, yyyy 'at' h:mm a")}</p>
                          </div>
                        </div>
                      )}
                      
                      {selectedWorkOrder.startedAt && (
                        <div className="flex items-center space-x-3">
                          <div className="w-3 h-3 bg-yellow-500 rounded-full flex-shrink-0"></div>
                          <div>
                            <p className="font-medium text-gray-900">Work Started</p>
                            <p className="text-sm text-gray-600">{format(new Date(selectedWorkOrder.startedAt), "MMM d, yyyy 'at' h:mm a")}</p>
                          </div>
                        </div>
                      )}
                      
                      {selectedWorkOrder.completedAt && (
                        <div className="flex items-center space-x-3">
                          <div className="w-3 h-3 bg-green-500 rounded-full flex-shrink-0"></div>
                          <div>
                            <p className="font-medium text-gray-900">Work Completed</p>
                            <p className="text-sm text-gray-600">{format(new Date(selectedWorkOrder.completedAt), "MMM d, yyyy 'at' h:mm a")}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Actions Footer */}
            <div className="flex justify-end space-x-2 p-4 sm:p-6 border-t bg-gray-50 flex-shrink-0">
              <Button variant="outline" onClick={() => setSelectedWorkOrder(null)}>
                Close
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Enhanced Billing Sheet Detail Modal */}
      {selectedBillingSheet && (
        <Dialog open={!!selectedBillingSheet} onOpenChange={() => setSelectedBillingSheet(null)}>
          <DialogContent className="w-[95vw] max-w-6xl h-[95vh] max-h-[95vh] overflow-hidden p-0 flex flex-col">
            <DialogHeader className="p-4 sm:p-6 border-b border-gray-200 flex-shrink-0">
              <DialogTitle className="flex items-center space-x-2 text-lg sm:text-xl">
                <FileText className="w-5 h-5" />
                <span>Billing Sheet Details - {selectedBillingSheet.billingSheetNumber || `BS-${selectedBillingSheet.id}`}</span>
              </DialogTitle>
            </DialogHeader>

            {/* Status Banner for Approved Billing Sheets */}
            {selectedBillingSheet.status === 'approved' && (
              <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white p-4 sm:p-6 flex-shrink-0 border-b">
                <div className="flex items-center justify-center space-x-3">
                  <CheckCircle className="w-8 h-8 flex-shrink-0" />
                  <div className="text-center">
                    <h3 className="text-xl sm:text-2xl font-bold">✓ BILLING SHEET APPROVED</h3>
                    <p className="text-green-100 text-sm sm:text-base mt-1">
                      This billing sheet has been approved and is ready for invoicing
                    </p>
                  </div>
                  <CheckCircle className="w-8 h-8 flex-shrink-0" />
                </div>
              </div>
            )}

            {selectedBillingSheet.status === 'billed' && (
              <div className="bg-gradient-to-r from-purple-500 to-indigo-600 text-white p-4 sm:p-6 flex-shrink-0 border-b">
                <div className="flex items-center justify-center space-x-3">
                  <DollarSign className="w-8 h-8 flex-shrink-0" />
                  <div className="text-center">
                    <h3 className="text-xl sm:text-2xl font-bold">💰 BILLED TO CUSTOMER</h3>
                    <p className="text-purple-100 text-sm sm:text-base mt-1">
                      This billing sheet has been included in customer invoicing
                    </p>
                  </div>
                  <DollarSign className="w-8 h-8 flex-shrink-0" />
                </div>
              </div>
            )}

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              <div className="space-y-4 sm:space-y-6">
                {/* Header Information */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg flex items-center space-x-2">
                        <FileText className="w-5 h-5" />
                        <span>Billing Sheet Information</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div>
                        <span className="font-medium text-gray-700">Billing Sheet Number:</span>
                        <p className="text-lg font-semibold text-gray-900">{selectedBillingSheet.billingSheetNumber || `BS-${selectedBillingSheet.id}`}</p>
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">Work Date:</span>
                        <p className="text-gray-900">{format(new Date(selectedBillingSheet.workDate), "MMM d, yyyy")}</p>
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">Status:</span>
                        <div className="mt-1">
                          <Badge className={`${getStatusColor(selectedBillingSheet.status)} text-sm font-semibold px-3 py-1`}>
                            {selectedBillingSheet.status.replace('_', ' ').toUpperCase()}
                          </Badge>
                        </div>
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">Created Date:</span>
                        <p className="text-gray-900">{format(new Date(selectedBillingSheet.createdAt), "MMM d, yyyy 'at' h:mm a")}</p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg flex items-center space-x-2">
                        <Users className="w-5 h-5" />
                        <span>Customer & Technician</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div>
                        <span className="font-medium text-gray-700">Customer Name:</span>
                        <p className="text-gray-900">{selectedBillingSheet.customerName}</p>
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">Property Address:</span>
                        <p className="text-gray-900">{selectedBillingSheet.propertyAddress || 'Not provided'}</p>
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">Technician:</span>
                        <p className="text-gray-900">{selectedBillingSheet.technicianName}</p>
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">Hours Worked:</span>
                        <p className="text-gray-900 font-semibold">{selectedBillingSheet.laborHours || 0} hours</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Work Description */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center space-x-2">
                      <Wrench className="w-5 h-5" />
                      <span>Work Performed</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div>
                      <span className="font-medium text-gray-700">Description of Work:</span>
                      <p className="text-gray-900 mt-2 bg-gray-50 p-4 rounded-lg border-l-4 border-blue-400">{selectedBillingSheet.description}</p>
                    </div>
                  </CardContent>
                </Card>

                {/* Financial Breakdown */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center space-x-2">
                      <DollarSign className="w-5 h-5" />
                      <span>Financial Breakdown</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-gradient-to-br from-gray-50 to-gray-100 p-6 rounded-lg border">
                      <div className="space-y-4">
                        {selectedBillingSheet.partsTotal && (
                          <div className="flex justify-between items-center py-2 border-b border-gray-200">
                            <span className="text-gray-700 font-medium">Parts Total:</span>
                            <span className="text-gray-900 font-semibold">{formatCurrency(selectedBillingSheet.partsTotal)}</span>
                          </div>
                        )}
                        {selectedBillingSheet.laborTotal && (
                          <div className="flex justify-between items-center py-2 border-b border-gray-200">
                            <span className="text-gray-700 font-medium">Labor Total:</span>
                            <span className="text-gray-900 font-semibold">{formatCurrency(selectedBillingSheet.laborTotal)}</span>
                          </div>
                        )}
                        {selectedBillingSheet.taxAmount && (
                          <div className="flex justify-between items-center py-2 border-b border-gray-200">
                            <span className="text-gray-700 font-medium">Tax:</span>
                            <span className="text-gray-900 font-semibold">{formatCurrency(selectedBillingSheet.taxAmount)}</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center py-3 bg-white rounded-lg px-4 border-2 border-blue-200">
                          <span className="text-xl font-bold text-gray-900">Total Amount:</span>
                          <span className="text-2xl font-bold text-blue-600">{formatCurrency(selectedBillingSheet.totalAmount)}</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Status Timeline */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center space-x-2">
                      <Calendar className="w-5 h-5" />
                      <span>Status Timeline</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-3">
                      <div className="flex items-center space-x-3">
                        <div className="w-3 h-3 bg-blue-500 rounded-full flex-shrink-0"></div>
                        <div>
                          <p className="font-medium text-gray-900">Billing Sheet Created</p>
                          <p className="text-sm text-gray-600">{format(new Date(selectedBillingSheet.createdAt), "MMM d, yyyy 'at' h:mm a")}</p>
                        </div>
                      </div>
                      
                      {selectedBillingSheet.submittedAt && (
                        <div className="flex items-center space-x-3">
                          <div className="w-3 h-3 bg-yellow-500 rounded-full flex-shrink-0"></div>
                          <div>
                            <p className="font-medium text-gray-900">Submitted for Review</p>
                            <p className="text-sm text-gray-600">{format(new Date(selectedBillingSheet.submittedAt), "MMM d, yyyy 'at' h:mm a")}</p>
                          </div>
                        </div>
                      )}
                      
                      {selectedBillingSheet.approvedAt && (
                        <div className="flex items-center space-x-3">
                          <div className="w-3 h-3 bg-green-500 rounded-full flex-shrink-0"></div>
                          <div>
                            <p className="font-medium text-gray-900">Approved</p>
                            <p className="text-sm text-gray-600">{format(new Date(selectedBillingSheet.approvedAt), "MMM d, yyyy 'at' h:mm a")}</p>
                          </div>
                        </div>
                      )}
                      
                      {selectedBillingSheet.status === 'billed' && (
                        <div className="flex items-center space-x-3">
                          <div className="w-3 h-3 bg-purple-500 rounded-full flex-shrink-0"></div>
                          <div>
                            <p className="font-medium text-gray-900">Billed to Customer</p>
                            <p className="text-sm text-gray-600">Included in monthly invoice</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Actions Footer */}
            <div className="flex justify-end space-x-2 p-4 sm:p-6 border-t bg-gray-50 flex-shrink-0">
              <Button variant="outline" onClick={() => setSelectedBillingSheet(null)}>
                Close
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}