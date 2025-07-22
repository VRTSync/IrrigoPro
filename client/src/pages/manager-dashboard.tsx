import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Wrench, Package, Clock, CheckCircle, Receipt } from "lucide-react";
import { EstimatesManager } from "@/components/manager/estimates-manager";
import { WorkOrdersManager } from "@/components/manager/work-orders-manager";
import { PartsListManager } from "@/components/manager/parts-list-manager";
import { EstimateDetailModal } from "@/components/estimates/estimate-detail-modal";
import { WorkOrderDetails } from "@/components/work-orders/work-order-details";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import BillingSheets from "@/pages/billing-sheets";
import type { Estimate, WorkOrder } from "@shared/schema";

type ManagerView = 'menu' | 'estimates' | 'work-orders' | 'parts' | 'billing-sheets';

export default function ManagerDashboard() {
  const [currentView, setCurrentView] = useState<ManagerView>('menu');
  const [selectedEstimateId, setSelectedEstimateId] = useState<number | null>(null);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null);
  const [estimateModalOpen, setEstimateModalOpen] = useState(false);
  const [workOrderModalOpen, setWorkOrderModalOpen] = useState(false);

  // Get dashboard stats from API
  const { data: stats } = useQuery({
    queryKey: ["/api/dashboard/stats"],
  });

  const { data: estimates } = useQuery<Estimate[]>({
    queryKey: ["/api/estimates"],
  });

  const { data: workOrders } = useQuery<WorkOrder[]>({
    queryKey: ["/api/work-orders"],
  });

  // Calculate stats from API data
  const pendingEstimates = stats?.pendingEstimates || 0;
  const activeWorkOrders = stats?.workOrderStats?.inProgress || 0;
  const recentEstimates = stats?.recentEstimates?.slice(0, 3) || [];
  const recentWorkOrders = stats?.recentWorkOrders?.slice(0, 3) || [];

  const renderContent = () => {
    switch (currentView) {
      case 'estimates':
        return <EstimatesManager onBack={() => setCurrentView('menu')} />;
      case 'work-orders':
        return <WorkOrdersManager onBack={() => setCurrentView('menu')} />;
      case 'parts':
        return <PartsListManager onBack={() => setCurrentView('menu')} />;
      case 'billing-sheets':
        return <BillingSheets />;
      default:
        return (
          <div className="max-w-4xl mx-auto px-4 py-8">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-gray-900">Manager Dashboard</h1>
              <p className="text-gray-600 mt-2">Choose an option to get started</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              {/* Estimates */}
              <Card className="hover:shadow-lg transition-shadow cursor-pointer flex flex-col" onClick={() => setCurrentView('estimates')}>
                <CardHeader className="text-center relative">
                  <div className="bg-blue-100 p-4 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                    <FileText className="w-8 h-8 text-blue-600" />
                  </div>
                  {pendingEstimates > 0 && (
                    <Badge className="absolute top-2 right-2 bg-orange-100 text-orange-800">
                      {pendingEstimates} pending
                    </Badge>
                  )}
                  <CardTitle className="text-xl">Estimates</CardTitle>
                </CardHeader>
                <CardContent className="text-center flex-1 flex flex-col">
                  <p className="text-gray-600 mb-4 flex-1">View estimate list, create new estimates, and convert to work orders</p>
                  <Button className="w-full bg-blue-600 hover:bg-blue-700 mt-auto">
                    Manage Estimates
                  </Button>
                </CardContent>
              </Card>

              {/* Work Orders */}
              <Card className="hover:shadow-lg transition-shadow cursor-pointer flex flex-col" onClick={() => setCurrentView('work-orders')}>
                <CardHeader className="text-center relative">
                  <div className="bg-green-100 p-4 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                    <Wrench className="w-8 h-8 text-green-600" />
                  </div>
                  {activeWorkOrders > 0 && (
                    <Badge className="absolute top-2 right-2 bg-blue-100 text-blue-800">
                      {activeWorkOrders} active
                    </Badge>
                  )}
                  <CardTitle className="text-xl">Work Orders</CardTitle>
                </CardHeader>
                <CardContent className="text-center flex-1 flex flex-col">
                  <p className="text-gray-600 mb-4 flex-1">View work order list, create new orders, and assign to technicians</p>
                  <Button className="w-full bg-green-600 hover:bg-green-700 mt-auto">
                    Manage Work Orders
                  </Button>
                </CardContent>
              </Card>

              {/* Parts List */}
              <Card className="hover:shadow-lg transition-shadow cursor-pointer flex flex-col" onClick={() => setCurrentView('parts')}>
                <CardHeader className="text-center">
                  <div className="bg-purple-100 p-4 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                    <Package className="w-8 h-8 text-purple-600" />
                  </div>
                  <CardTitle className="text-xl">Parts List</CardTitle>
                </CardHeader>
                <CardContent className="text-center flex-1 flex flex-col">
                  <p className="text-gray-600 mb-4 flex-1">View Parts List and Add New Parts</p>
                  <Button className="w-full bg-purple-600 hover:bg-purple-700 mt-auto">
                    View Parts
                  </Button>
                </CardContent>
              </Card>

              {/* Billing Sheets */}
              <Card className="hover:shadow-lg transition-shadow cursor-pointer flex flex-col" onClick={() => setCurrentView('billing-sheets')}>
                <CardHeader className="text-center">
                  <div className="bg-orange-100 p-4 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                    <Receipt className="w-8 h-8 text-orange-600" />
                  </div>
                  <CardTitle className="text-xl">Billing Sheets</CardTitle>
                </CardHeader>
                <CardContent className="text-center flex-1 flex flex-col">
                  <p className="text-gray-600 mb-4 flex-1">Create billing sheets for work done without work orders</p>
                  <Button className="w-full bg-orange-600 hover:bg-orange-700 mt-auto">
                    Manage Billing
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* Recent Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Recent Estimates */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock className="w-5 h-5 text-blue-600" />
                      Recent Estimates
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => window.location.href = '/estimates'}
                    >
                      View List
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {recentEstimates.length === 0 ? (
                    <p className="text-gray-500 text-center py-4">No recent estimates</p>
                  ) : (
                    <div className="space-y-3">
                      {recentEstimates.map((estimate) => (
                        <div 
                          key={estimate.id} 
                          className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
                          onClick={() => {
                            setSelectedEstimateId(estimate.id);
                            setEstimateModalOpen(true);
                          }}
                        >
                          <div>
                            <p className="font-medium">{estimate.estimateNumber}</p>
                            <p className="text-sm text-gray-600">{estimate.customerName}</p>
                          </div>
                          <Badge className={
                            estimate.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 
                            estimate.status === 'approved' ? 'bg-green-100 text-green-800' :
                            estimate.status === 'rejected' ? 'bg-red-100 text-red-800' :
                            estimate.status === 'converted_to_work_order' ? 'bg-green-100 text-green-800' :
                            'bg-gray-100 text-gray-800'
                          }>
                            {estimate.status === 'converted_to_work_order' ? 'Converted' : 
                             estimate.status.charAt(0).toUpperCase() + estimate.status.slice(1)}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Recent Work Orders */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-green-600" />
                      Recent Work Orders
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => window.location.href = '/work-orders'}
                    >
                      View List
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {recentWorkOrders.length === 0 ? (
                    <p className="text-gray-500 text-center py-4">No recent work orders</p>
                  ) : (
                    <div className="space-y-3">
                      {recentWorkOrders.map((workOrder) => (
                        <div 
                          key={workOrder.id} 
                          className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
                          onClick={() => {
                            setSelectedWorkOrder(workOrder);
                            setWorkOrderModalOpen(true);
                          }}
                        >
                          <div>
                            <p className="font-medium">{workOrder.workOrderNumber}</p>
                            <p className="text-sm text-gray-600">{workOrder.customerName}</p>
                          </div>
                          <Badge className={
                            workOrder.status === 'in_progress' ? 'bg-blue-100 text-blue-800' : 
                            workOrder.status === 'completed' ? 'bg-green-100 text-green-800' : 
                            workOrder.status === 'assigned' ? 'bg-orange-100 text-orange-800' :
                            'bg-yellow-100 text-yellow-800'
                          }>
                            {workOrder.status.replace('_', ' ').split(' ').map(word => 
                              word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {renderContent()}
      
      {/* Estimate Detail Modal */}
      <EstimateDetailModal
        open={estimateModalOpen}
        onOpenChange={setEstimateModalOpen}
        estimateId={selectedEstimateId}
      />
      
      {/* Work Order Detail Modal */}
      {selectedWorkOrder && (
        <Dialog open={workOrderModalOpen} onOpenChange={setWorkOrderModalOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <WorkOrderDetails
              workOrder={selectedWorkOrder}
              onClose={() => setWorkOrderModalOpen(false)}
              onUpdate={() => {
                // Refresh data after update
                // The query will automatically refetch
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}