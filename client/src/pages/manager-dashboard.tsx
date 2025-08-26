import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Wrench, Clock, CheckCircle, Receipt, Plus } from "lucide-react";
import { useState } from "react";
import { EnhancedEstimateModal } from "@/components/estimates/enhanced-estimate-modal";
import { WorkOrderForm } from "@/components/work-orders/work-order-form";
import { StandaloneBillingSheet } from "@/components/billing/standalone-billing-sheet";
import type { Estimate, WorkOrder } from "@shared/schema";

export default function ManagerDashboard() {
  // Modal states for quick creation
  const [showEstimateModal, setShowEstimateModal] = useState(false);
  const [showWorkOrderModal, setShowWorkOrderModal] = useState(false);
  const [showBillingSheetModal, setShowBillingSheetModal] = useState(false);

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
  const pendingEstimates = (stats as any)?.pendingEstimates || 0;
  const activeWorkOrders = (stats as any)?.workOrderStats?.inProgress || 0;
  const recentEstimates = (stats as any)?.recentEstimates?.slice(0, 3) || [];
  const recentWorkOrders = (stats as any)?.recentWorkOrders?.slice(0, 3) || [];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="text-center mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Manager Dashboard</h1>
          <p className="text-gray-600 mt-2 text-sm sm:text-base">Choose an option to get started</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
          {/* Estimates */}
          <Card className="hover:shadow-lg transition-shadow flex flex-col">
            <CardHeader className="text-center relative">
              <div className="bg-blue-100 p-4 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                <FileText className="w-8 h-8 text-blue-600" />
              </div>
              {pendingEstimates > 0 && (
                <Badge className="absolute top-2 left-2 bg-orange-100 text-orange-800">
                  {pendingEstimates} pending
                </Badge>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="absolute top-2 right-2 h-8 w-8 p-0 rounded-full bg-blue-50 hover:bg-blue-100"
                onClick={() => setShowEstimateModal(true)}
                title="Create New Estimate"
              >
                <Plus className="w-4 h-4 text-blue-600" />
              </Button>
              <CardTitle className="text-xl">Estimates</CardTitle>
            </CardHeader>
            <CardContent className="text-center flex-1 flex flex-col">
              <p className="text-gray-600 mb-4 flex-1">View estimate list, create new estimates, and convert to work orders</p>
              <Link href="/estimates">
                <Button className="w-full bg-blue-600 hover:bg-blue-700 mt-auto">
                  Manage Estimates
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Work Orders */}
          <Card className="hover:shadow-lg transition-shadow flex flex-col">
            <CardHeader className="text-center relative">
              <div className="bg-green-100 p-4 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                <Wrench className="w-8 h-8 text-green-600" />
              </div>
              {activeWorkOrders > 0 && (
                <Badge className="absolute top-2 left-2 bg-blue-100 text-blue-800">
                  {activeWorkOrders} active
                </Badge>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="absolute top-2 right-2 h-8 w-8 p-0 rounded-full bg-green-50 hover:bg-green-100"
                onClick={() => setShowWorkOrderModal(true)}
                title="Create New Work Order"
              >
                <Plus className="w-4 h-4 text-green-600" />
              </Button>
              <CardTitle className="text-xl">Work Orders</CardTitle>
            </CardHeader>
            <CardContent className="text-center flex-1 flex flex-col">
              <p className="text-gray-600 mb-4 flex-1">View work order list, create new orders, and assign to technicians</p>
              <Link href="/work-orders">
                <Button className="w-full bg-green-600 hover:bg-green-700 mt-auto">
                  Manage Work Orders
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Billing Sheets */}
          <Card className="hover:shadow-lg transition-shadow flex flex-col">
            <CardHeader className="text-center relative">
              <div className="bg-orange-100 p-4 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                <Receipt className="w-8 h-8 text-orange-600" />
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="absolute top-2 right-2 h-8 w-8 p-0 rounded-full bg-orange-50 hover:bg-orange-100"
                onClick={() => setShowBillingSheetModal(true)}
                title="Create New Billing Sheet"
              >
                <Plus className="w-4 h-4 text-orange-600" />
              </Button>
              <CardTitle className="text-xl">Billing Sheets</CardTitle>
            </CardHeader>
            <CardContent className="text-center flex-1 flex flex-col">
              <p className="text-gray-600 mb-4 flex-1">Create billing sheets for work done without work orders</p>
              <Link href="/billing-sheets">
                <Button className="w-full bg-orange-600 hover:bg-orange-700 mt-auto">
                  Manage Billing
                </Button>
              </Link>
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
                <Link href="/estimates">
                  <Button 
                    variant="outline" 
                    size="sm"
                  >
                    View List
                  </Button>
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentEstimates.length === 0 ? (
                <p className="text-gray-500 text-center py-4">No recent estimates</p>
              ) : (
                <div className="space-y-3">
                  {recentEstimates.map((estimate: any) => (
                    <Link key={estimate.id} href="/estimates">
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors">
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
                    </Link>
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
                <Link href="/work-orders">
                  <Button 
                    variant="outline" 
                    size="sm"
                  >
                    View List
                  </Button>
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentWorkOrders.length === 0 ? (
                <p className="text-gray-500 text-center py-4">No recent work orders</p>
              ) : (
                <div className="space-y-3">
                  {recentWorkOrders.map((workOrder: any) => (
                    <Link key={workOrder.id} href="/work-orders">
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors">
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
                          {workOrder.status.replace('_', ' ').split(' ').map((word: string) => 
                            word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                        </Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Modals for Quick Creation */}
        <EnhancedEstimateModal
          open={showEstimateModal}
          onOpenChange={(open) => {
            setShowEstimateModal(open);
            if (!open) {
              // Refresh dashboard data when closed after successful creation
              window.location.reload();
            }
          }}
        />

        {showWorkOrderModal && (
          <WorkOrderForm
            onClose={() => setShowWorkOrderModal(false)}
            onSuccess={() => {
              setShowWorkOrderModal(false);
              // Refresh dashboard data
              window.location.reload();
            }}
          />
        )}

        <StandaloneBillingSheet
          open={showBillingSheetModal}
          onOpenChange={(open) => {
            setShowBillingSheetModal(open);
            if (!open) {
              // Refresh dashboard data when closed after successful creation
              window.location.reload();
            }
          }}
        />
    </div>
  );
}