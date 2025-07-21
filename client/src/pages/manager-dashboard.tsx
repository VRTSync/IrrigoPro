import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Wrench, Package, Clock, CheckCircle } from "lucide-react";
import { EstimatesManager } from "@/components/manager/estimates-manager";
import { WorkOrdersManager } from "@/components/manager/work-orders-manager";
import { PartsListManager } from "@/components/manager/parts-list-manager";
import type { Estimate, WorkOrder } from "@shared/schema";

type ManagerView = 'menu' | 'estimates' | 'work-orders' | 'parts';

export default function ManagerDashboard() {
  const [currentView, setCurrentView] = useState<ManagerView>('menu');

  // Get data for dashboard stats
  const { data: estimates } = useQuery<Estimate[]>({
    queryKey: ["/api/estimates"],
  });

  const { data: workOrders } = useQuery<WorkOrder[]>({
    queryKey: ["/api/work-orders"],
  });

  // Calculate stats
  const pendingEstimates = estimates?.filter(e => e.status === 'pending').length || 0;
  const activeWorkOrders = workOrders?.filter(w => w.status === 'in_progress').length || 0;
  const recentEstimates = estimates?.slice(-3) || [];
  const recentWorkOrders = workOrders?.slice(-3) || [];

  const renderContent = () => {
    switch (currentView) {
      case 'estimates':
        return <EstimatesManager onBack={() => setCurrentView('menu')} />;
      case 'work-orders':
        return <WorkOrdersManager onBack={() => setCurrentView('menu')} />;
      case 'parts':
        return <PartsListManager onBack={() => setCurrentView('menu')} />;
      default:
        return (
          <div className="max-w-4xl mx-auto px-4 py-8">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-gray-900">Manager Dashboard</h1>
              <p className="text-gray-600 mt-2">Choose an option to get started</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
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
                        <div key={estimate.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div>
                            <p className="font-medium">#{estimate.id} - {estimate.customerName}</p>
                            <p className="text-sm text-gray-600">{estimate.status}</p>
                          </div>
                          <Badge className={estimate.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}>
                            {estimate.totalAmount ? `$${estimate.totalAmount}` : 'TBD'}
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
                        <div key={workOrder.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div>
                            <p className="font-medium">#{workOrder.id} - {workOrder.customerName}</p>
                            <p className="text-sm text-gray-600">{workOrder.status.replace('_', ' ')}</p>
                          </div>
                          <Badge className={
                            workOrder.status === 'in_progress' ? 'bg-blue-100 text-blue-800' : 
                            workOrder.status === 'completed' ? 'bg-green-100 text-green-800' : 
                            'bg-yellow-100 text-yellow-800'
                          }>
                            {workOrder.totalAmount ? `$${workOrder.totalAmount}` : workOrder.priority}
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
    </div>
  );
}