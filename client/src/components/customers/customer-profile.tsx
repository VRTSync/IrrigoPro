import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { 
  ArrowLeft, 
  User, 
  Mail, 
  Phone, 
  MapPin, 
  FileText, 
  Wrench, 
  Receipt, 
  Calendar,
  DollarSign,
  Clock,
  Package
} from "lucide-react";
import type { Customer, Estimate, WorkOrder, BillingSheetWithItems } from "@shared/schema";
import { EstimateDetailModal } from "@/components/estimates/estimate-detail-modal";
import { WorkOrderDetails } from "@/components/work-orders/work-order-details";
import { PropertyNotes } from "./property-notes";

interface CustomerProfileProps {
  customer: Customer;
  onBack: () => void;
}

export function CustomerProfile({ customer, onBack }: CustomerProfileProps) {
  const [selectedEstimateId, setSelectedEstimateId] = useState<number | null>(null);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null);
  const [estimateModalOpen, setEstimateModalOpen] = useState(false);
  const [workOrderModalOpen, setWorkOrderModalOpen] = useState(false);

  // Fetch customer-related data
  const { data: estimates = [] } = useQuery<Estimate[]>({
    queryKey: [`/api/customers/${customer.id}/estimates`],
  });

  const { data: workOrders = [] } = useQuery<WorkOrder[]>({
    queryKey: [`/api/customers/${customer.id}/work-orders`],
  });

  const { data: billingSheets = [] } = useQuery<BillingSheetWithItems[]>({
    queryKey: [`/api/customers/${customer.id}/billing-sheets`],
  });

  const getStatusBadge = (status: string, type: 'estimate' | 'workorder' | 'billing' = 'estimate') => {
    const statusConfig: { [key: string]: { color: string; icon: string; bg: string } } = {
      // Estimate statuses
      pending: { color: 'text-amber-700', icon: '⏳', bg: 'bg-amber-50 border-amber-200 shadow-amber-100' },
      approved: { color: 'text-emerald-700', icon: '✅', bg: 'bg-emerald-50 border-emerald-200 shadow-emerald-100' },
      rejected: { color: 'text-red-700', icon: '❌', bg: 'bg-red-50 border-red-200 shadow-red-100' },
      converted_to_work_order: { color: 'text-blue-700', icon: '🔄', bg: 'bg-blue-50 border-blue-200 shadow-blue-100' },
      
      // Work order statuses
      assigned: { color: 'text-indigo-700', icon: '👤', bg: 'bg-indigo-50 border-indigo-200 shadow-indigo-100' },
      in_progress: { color: 'text-purple-700', icon: '🔧', bg: 'bg-purple-50 border-purple-200 shadow-purple-100' },
      completed: { color: 'text-green-700', icon: '✅', bg: 'bg-green-50 border-green-200 shadow-green-100' },
      cancelled: { color: 'text-gray-700', icon: '🚫', bg: 'bg-gray-50 border-gray-200 shadow-gray-100' },
      
      // Billing sheet status (always completed)
      billed: { color: 'text-orange-700', icon: '💰', bg: 'bg-orange-50 border-orange-200 shadow-orange-100' }
    };

    const config = statusConfig[status] || { color: 'text-gray-700', icon: '?', bg: 'bg-gray-50 border-gray-200' };
    
    return (
      <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border shadow-sm font-medium text-xs ${config.bg} ${config.color}`}>
        <span className="text-sm">{config.icon}</span>
        {status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
      </div>
    );
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: 'USD' 
    }).format(amount);
  };

  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Calculate totals
  const totalEstimateValue = estimates.reduce((sum, est) => sum + Number(est.totalAmount || 0), 0);
  const totalBillingValue = billingSheets.reduce((sum, sheet) => sum + Number(sheet.totalAmount || 0), 0);

  return (
    <>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-4">
            <Button variant="outline" onClick={onBack} className="flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back to Customers
            </Button>
          </div>
          
          <div className="bg-gradient-to-r from-slate-50 to-blue-50 rounded-xl border shadow-lg p-8">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-6">
                <div className="relative">
                  <div className="bg-gradient-to-br from-blue-500 to-blue-600 p-4 rounded-2xl shadow-lg">
                    <User className="w-10 h-10 text-white" />
                  </div>
                  <div className="absolute -bottom-2 -right-2 bg-green-500 w-6 h-6 rounded-full border-4 border-white flex items-center justify-center">
                    <div className="w-2 h-2 bg-white rounded-full"></div>
                  </div>
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-gray-900 mb-3">{customer.name}</h1>
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 text-gray-700">
                      <div className="bg-white p-1.5 rounded-lg shadow-sm">
                        <Mail className="w-4 h-4 text-blue-600" />
                      </div>
                      <span className="font-medium">{customer.email}</span>
                    </div>
                    {customer.phone && (
                      <div className="flex items-center gap-3 text-gray-700">
                        <div className="bg-white p-1.5 rounded-lg shadow-sm">
                          <Phone className="w-4 h-4 text-green-600" />
                        </div>
                        <span className="font-medium">{customer.phone}</span>
                      </div>
                    )}
                    {customer.address && (
                      <div className="flex items-center gap-3 text-gray-700">
                        <div className="bg-white p-1.5 rounded-lg shadow-sm">
                          <MapPin className="w-4 h-4 text-purple-600" />
                        </div>
                        <span className="font-medium">{customer.address}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              {/* Enhanced Summary Stats */}
              <div className="grid grid-cols-3 gap-6">
                <div className="bg-white rounded-xl p-4 shadow-sm border border-blue-100 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-2">
                    <FileText className="w-6 h-6 text-blue-600" />
                    <div className="text-2xl font-bold text-blue-700">{estimates.length}</div>
                  </div>
                  <div className="text-sm font-medium text-gray-700">Estimates</div>
                  <div className="text-xs text-blue-600 font-medium mt-1">{formatCurrency(totalEstimateValue)}</div>
                </div>
                <div className="bg-white rounded-xl p-4 shadow-sm border border-green-100 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-2">
                    <Wrench className="w-6 h-6 text-green-600" />
                    <div className="text-2xl font-bold text-green-700">{workOrders.length}</div>
                  </div>
                  <div className="text-sm font-medium text-gray-700">Work Orders</div>
                  <div className="text-xs text-green-600 font-medium mt-1">Active Projects</div>
                </div>
                <div className="bg-white rounded-xl p-4 shadow-sm border border-orange-100 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-2">
                    <Receipt className="w-6 h-6 text-orange-600" />
                    <div className="text-2xl font-bold text-orange-700">{billingSheets.length}</div>
                  </div>
                  <div className="text-sm font-medium text-gray-700">Billing Sheets</div>
                  <div className="text-xs text-orange-600 font-medium mt-1">{formatCurrency(totalBillingValue)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Property Notes Section */}
        <div className="mb-8">
          <PropertyNotes customer={customer} />
        </div>

        {/* Tabs for different data */}
        <Tabs defaultValue="estimates" className="w-full">
          <TabsList className="grid w-full grid-cols-3 bg-white shadow-sm border border-gray-200 p-1 rounded-xl">
            <TabsTrigger 
              value="estimates" 
              className="flex items-center gap-2 data-[state=active]:bg-blue-500 data-[state=active]:text-white data-[state=active]:shadow-md rounded-lg transition-all duration-200"
            >
              <FileText className="w-4 h-4" />
              <span className="font-medium">Estimates</span>
              <div className="bg-blue-100 text-blue-800 data-[state=active]:bg-blue-400 data-[state=active]:text-white px-2 py-0.5 rounded-full text-xs font-bold">
                {estimates.length}
              </div>
            </TabsTrigger>
            <TabsTrigger 
              value="work-orders" 
              className="flex items-center gap-2 data-[state=active]:bg-green-500 data-[state=active]:text-white data-[state=active]:shadow-md rounded-lg transition-all duration-200"
            >
              <Wrench className="w-4 h-4" />
              <span className="font-medium">Work Orders</span>
              <div className="bg-green-100 text-green-800 data-[state=active]:bg-green-400 data-[state=active]:text-white px-2 py-0.5 rounded-full text-xs font-bold">
                {workOrders.length}
              </div>
            </TabsTrigger>
            <TabsTrigger 
              value="billing-sheets" 
              className="flex items-center gap-2 data-[state=active]:bg-orange-500 data-[state=active]:text-white data-[state=active]:shadow-md rounded-lg transition-all duration-200"
            >
              <Receipt className="w-4 h-4" />
              <span className="font-medium">Billing Sheets</span>
              <div className="bg-orange-100 text-orange-800 data-[state=active]:bg-orange-400 data-[state=active]:text-white px-2 py-0.5 rounded-full text-xs font-bold">
                {billingSheets.length}
              </div>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="estimates" className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold">Customer Estimates</h2>
              <div className="text-sm text-gray-600">
                Total Value: <span className="font-semibold text-green-600">{formatCurrency(totalEstimateValue)}</span>
              </div>
            </div>
            
            {estimates.length === 0 ? (
              <Card className="border-2 border-dashed border-gray-200">
                <CardContent className="flex items-center justify-center py-16">
                  <div className="text-center">
                    <div className="bg-blue-100 p-4 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                      <FileText className="w-10 h-10 text-blue-500" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">No Estimates Yet</h3>
                    <p className="text-gray-600">This customer doesn't have any estimates created</p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {estimates.map((estimate) => (
                  <Card key={estimate.id} className="group hover:shadow-lg transition-all duration-200 cursor-pointer border-l-4 border-l-blue-500 hover:border-l-blue-600 bg-gradient-to-r from-blue-50/30 to-transparent" 
                        onClick={() => {
                          setSelectedEstimateId(estimate.id);
                          setEstimateModalOpen(true);
                        }}>
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-3">
                            <div className="bg-blue-500 p-2 rounded-lg shadow-sm group-hover:shadow-md transition-shadow">
                              <FileText className="w-4 h-4 text-white" />
                            </div>
                            <div>
                              <h3 className="font-bold text-gray-900 text-lg group-hover:text-blue-700 transition-colors">{estimate.estimateNumber}</h3>
                              <p className="text-gray-600 font-medium">{estimate.projectName}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4 text-sm">
                            <div className="flex items-center gap-1.5 text-gray-500">
                              <Calendar className="w-4 h-4" />
                              <span>Created {formatDate(estimate.createdAt)}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-gray-500">
                              <DollarSign className="w-4 h-4" />
                              <span className="font-semibold">{formatCurrency(Number(estimate.totalAmount || 0))}</span>
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          {getStatusBadge(estimate.status, 'estimate')}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="work-orders" className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold">Customer Work Orders</h2>
            </div>
            
            {workOrders.length === 0 ? (
              <Card className="border-2 border-dashed border-gray-200">
                <CardContent className="flex items-center justify-center py-16">
                  <div className="text-center">
                    <div className="bg-green-100 p-4 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                      <Wrench className="w-10 h-10 text-green-500" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">No Work Orders</h3>
                    <p className="text-gray-600">This customer doesn't have any work orders yet</p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {workOrders.map((workOrder) => (
                  <Card key={workOrder.id} className="group hover:shadow-lg transition-all duration-200 cursor-pointer border-l-4 border-l-green-500 hover:border-l-green-600 bg-gradient-to-r from-green-50/30 to-transparent"
                        onClick={() => {
                          setSelectedWorkOrder(workOrder);
                          setWorkOrderModalOpen(true);
                        }}>
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-3">
                            <div className="bg-green-500 p-2 rounded-lg shadow-sm group-hover:shadow-md transition-shadow">
                              <Wrench className="w-4 h-4 text-white" />
                            </div>
                            <div>
                              <h3 className="font-bold text-gray-900 text-lg group-hover:text-green-700 transition-colors">{workOrder.workOrderNumber}</h3>
                              <p className="text-gray-600 font-medium">{workOrder.projectName}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4 text-sm">
                            <div className="flex items-center gap-1.5 text-gray-500">
                              <Calendar className="w-4 h-4" />
                              <span>Created {formatDate(workOrder.createdAt)}</span>
                            </div>
                            {workOrder.assignedTechnicianName && (
                              <div className="flex items-center gap-1.5 text-gray-500">
                                <User className="w-4 h-4" />
                                <span className="font-medium">{workOrder.assignedTechnicianName}</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          {getStatusBadge(workOrder.status, 'workorder')}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="billing-sheets" className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold">Customer Billing Sheets</h2>
              <div className="text-sm text-gray-600">
                Total Value: <span className="font-semibold text-green-600">{formatCurrency(totalBillingValue)}</span>
              </div>
            </div>
            
            {billingSheets.length === 0 ? (
              <Card className="border-2 border-dashed border-gray-200">
                <CardContent className="flex items-center justify-center py-16">
                  <div className="text-center">
                    <div className="bg-orange-100 p-4 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                      <Receipt className="w-10 h-10 text-orange-500" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">No Billing Sheets</h3>
                    <p className="text-gray-600">This customer doesn't have any billing sheets created</p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {billingSheets.map((billingSheet) => (
                  <Card key={billingSheet.id} className="group hover:shadow-lg transition-all duration-200 cursor-pointer border-l-4 border-l-orange-500 hover:border-l-orange-600 bg-gradient-to-r from-orange-50/30 to-transparent">
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-3">
                            <div className="bg-orange-500 p-2 rounded-lg shadow-sm group-hover:shadow-md transition-shadow">
                              <Receipt className="w-4 h-4 text-white" />
                            </div>
                            <div>
                              <h3 className="font-bold text-gray-900 text-lg group-hover:text-orange-700 transition-colors">{billingSheet.billingNumber}</h3>
                              <p className="text-gray-600 font-medium">{billingSheet.notes || 'Billing sheet'}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4 text-sm">
                            <div className="flex items-center gap-1.5 text-gray-500">
                              <Calendar className="w-4 h-4" />
                              <span>Created {formatDate(billingSheet.createdAt)}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-gray-500">
                              <User className="w-4 h-4" />
                              <span className="font-medium">{billingSheet.technicianName}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-gray-500">
                              <Package className="w-4 h-4" />
                              <span>{billingSheet.items.length} items</span>
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="mb-2">
                            {getStatusBadge('billed', 'billing')}
                          </div>
                          <div className="text-lg font-bold text-orange-600">
                            {formatCurrency(Number(billingSheet.totalAmount || 0))}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Modals */}
      {estimateModalOpen && selectedEstimateId && (
        <EstimateDetailModal
          open={estimateModalOpen}
          onOpenChange={(open) => {
            setEstimateModalOpen(open);
            if (!open) setSelectedEstimateId(null);
          }}
          estimateId={selectedEstimateId}
        />
      )}

      {workOrderModalOpen && selectedWorkOrder && (
        <WorkOrderDetails
          workOrder={selectedWorkOrder}
          onClose={() => {
            setWorkOrderModalOpen(false);
            setSelectedWorkOrder(null);
          }}
          onUpdate={() => {
            // Refresh work orders when updated
            setWorkOrderModalOpen(false);
            setSelectedWorkOrder(null);
          }}
        />
      )}
    </>
  );
}