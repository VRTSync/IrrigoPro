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
  Clock
} from "lucide-react";
import type { Customer, Estimate, WorkOrder, BillingSheetWithItems } from "@shared/schema";
import { EstimateDetailModal } from "@/components/estimates/estimate-detail-modal";
import { WorkOrderDetails } from "@/components/work-orders/work-order-details";

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

  const getStatusBadge = (status: string) => {
    const statusColors: { [key: string]: string } = {
      pending: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
      converted_to_work_order: 'bg-blue-100 text-blue-800',
      assigned: 'bg-blue-100 text-blue-800',
      in_progress: 'bg-purple-100 text-purple-800',
      completed: 'bg-green-100 text-green-800',
      cancelled: 'bg-gray-100 text-gray-800'
    };

    return (
      <Badge className={statusColors[status] || 'bg-gray-100 text-gray-800'}>
        {status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
      </Badge>
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
          
          <div className="bg-white rounded-lg border shadow-sm p-6">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="bg-blue-100 p-3 rounded-full">
                  <User className="w-8 h-8 text-blue-600" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">{customer.name}</h1>
                  <div className="flex items-center gap-4 text-gray-600 mt-2">
                    <div className="flex items-center gap-1">
                      <Mail className="w-4 h-4" />
                      {customer.email}
                    </div>
                    {customer.phone && (
                      <div className="flex items-center gap-1">
                        <Phone className="w-4 h-4" />
                        {customer.phone}
                      </div>
                    )}
                  </div>
                  {customer.address && (
                    <div className="flex items-center gap-1 text-gray-600 mt-1">
                      <MapPin className="w-4 h-4" />
                      {customer.address}
                    </div>
                  )}
                </div>
              </div>
              
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold text-blue-600">{estimates.length}</div>
                  <div className="text-sm text-gray-600">Estimates</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-green-600">{workOrders.length}</div>
                  <div className="text-sm text-gray-600">Work Orders</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-orange-600">{billingSheets.length}</div>
                  <div className="text-sm text-gray-600">Billing Sheets</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs for different data */}
        <Tabs defaultValue="estimates" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="estimates" className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Estimates ({estimates.length})
            </TabsTrigger>
            <TabsTrigger value="work-orders" className="flex items-center gap-2">
              <Wrench className="w-4 h-4" />
              Work Orders ({workOrders.length})
            </TabsTrigger>
            <TabsTrigger value="billing-sheets" className="flex items-center gap-2">
              <Receipt className="w-4 h-4" />
              Billing Sheets ({billingSheets.length})
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
              <Card>
                <CardContent className="flex items-center justify-center py-12">
                  <div className="text-center">
                    <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-600">No estimates found for this customer</p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {estimates.map((estimate) => (
                  <Card key={estimate.id} className="hover:shadow-md transition-shadow cursor-pointer" 
                        onClick={() => {
                          setSelectedEstimateId(estimate.id);
                          setEstimateModalOpen(true);
                        }}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold text-gray-900">{estimate.estimateNumber}</h3>
                          <p className="text-gray-600">{estimate.projectName}</p>
                          <div className="flex items-center gap-2 mt-2">
                            <Calendar className="w-4 h-4 text-gray-400" />
                            <span className="text-sm text-gray-600">
                              {formatDate(estimate.createdAt)}
                            </span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-semibold text-green-600">
                            {formatCurrency(Number(estimate.totalAmount || 0))}
                          </div>
                          <div className="mt-2">
                            {getStatusBadge(estimate.status)}
                          </div>
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
              <Card>
                <CardContent className="flex items-center justify-center py-12">
                  <div className="text-center">
                    <Wrench className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-600">No work orders found for this customer</p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {workOrders.map((workOrder) => (
                  <Card key={workOrder.id} className="hover:shadow-md transition-shadow cursor-pointer"
                        onClick={() => {
                          setSelectedWorkOrder(workOrder);
                          setWorkOrderModalOpen(true);
                        }}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold text-gray-900">{workOrder.workOrderNumber}</h3>
                          <p className="text-gray-600">{workOrder.projectName}</p>
                          <div className="flex items-center gap-4 mt-2">
                            <div className="flex items-center gap-1">
                              <Calendar className="w-4 h-4 text-gray-400" />
                              <span className="text-sm text-gray-600">
                                {formatDate(workOrder.createdAt)}
                              </span>
                            </div>
                            {workOrder.assignedTechnicianName && (
                              <div className="flex items-center gap-1">
                                <User className="w-4 h-4 text-gray-400" />
                                <span className="text-sm text-gray-600">
                                  {workOrder.assignedTechnicianName}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="mb-2">
                            {getStatusBadge(workOrder.status)}
                          </div>
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
              <Card>
                <CardContent className="flex items-center justify-center py-12">
                  <div className="text-center">
                    <Receipt className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-600">No billing sheets found for this customer</p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {billingSheets.map((billingSheet) => (
                  <Card key={billingSheet.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold text-gray-900">{billingSheet.billingNumber}</h3>
                          <p className="text-gray-600">{billingSheet.notes || 'No description'}</p>
                          <div className="flex items-center gap-4 mt-2">
                            <div className="flex items-center gap-1">
                              <Calendar className="w-4 h-4 text-gray-400" />
                              <span className="text-sm text-gray-600">
                                {formatDate(billingSheet.createdAt)}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <User className="w-4 h-4 text-gray-400" />
                              <span className="text-sm text-gray-600">
                                {billingSheet.technicianName}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-semibold text-green-600">
                            {formatCurrency(Number(billingSheet.totalAmount || 0))}
                          </div>
                          <div className="text-sm text-gray-600 mt-1">
                            {billingSheet.items.length} items
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