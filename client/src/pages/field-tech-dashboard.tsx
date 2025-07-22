import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Package, FileText, Plus } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { WorkOrder } from "@shared/schema";
import { Link } from "wouter";
import { StandaloneBillingSheet } from "@/components/billing/standalone-billing-sheet";

export default function FieldTechDashboard() {
  const [showBillingModal, setShowBillingModal] = useState(false);
  
  // Get current user from localStorage
  const getCurrentUser = () => {
    const savedUser = localStorage.getItem("user");
    return savedUser ? JSON.parse(savedUser) : null;
  };

  const currentUser = getCurrentUser();

  // Get assigned work orders for this technician
  const { data: workOrders } = useQuery<WorkOrder[]>({
    queryKey: ["/api/work-orders", "technician", currentUser?.id],
    queryFn: () => apiRequest(`/api/work-orders?technician=${currentUser?.id}`, "GET"),
    enabled: !!currentUser?.id,
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Field Tech Dashboard</h1>
          <p className="text-gray-600 mt-2 text-sm sm:text-base">Manage your work orders and billing sheets</p>
        </div>

        {/* Dashboard Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {/* Work Orders Card */}
          <Card className="hover:shadow-lg transition-all duration-200 border-2 hover:border-blue-200">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-100 p-2 sm:p-3 rounded-full flex-shrink-0">
                    <Package className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-lg sm:text-xl text-gray-900">Work Orders</CardTitle>
                    <p className="text-gray-600 text-xs sm:text-sm">View assigned work</p>
                  </div>
                </div>
                <Badge variant="secondary" className="text-sm sm:text-lg px-2 sm:px-3 py-1 flex-shrink-0">
                  {workOrders?.length || 0}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-xs sm:text-sm">
                  <span className="text-gray-600">Assigned:</span>
                  <span className="font-medium">{workOrders?.filter(wo => wo.status === 'assigned').length || 0}</span>
                </div>
                <div className="flex justify-between text-xs sm:text-sm">
                  <span className="text-gray-600">In progress:</span>
                  <span className="font-medium">{workOrders?.filter(wo => wo.status === 'in_progress').length || 0}</span>
                </div>
                <div className="flex justify-between text-xs sm:text-sm">
                  <span className="text-gray-600">Completed:</span>
                  <span className="font-medium">{workOrders?.filter(wo => wo.status === 'completed').length || 0}</span>
                </div>
              </div>
              <Link href="/work-orders" className="block">
                <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                  View Work Orders
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Billing Sheets Card */}
          <Card className="hover:shadow-lg transition-all duration-200 border-2 hover:border-green-200">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-green-100 p-2 sm:p-3 rounded-full flex-shrink-0">
                    <FileText className="w-6 h-6 sm:w-8 sm:h-8 text-green-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-lg sm:text-xl text-gray-900">Billing Sheets</CardTitle>
                    <p className="text-gray-600 text-xs sm:text-sm">Create standalone billing</p>
                  </div>
                </div>
                <Button 
                  size="sm" 
                  className="bg-green-600 hover:bg-green-700 flex-shrink-0"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowBillingModal(true);
                  }}
                >
                  <Plus className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
                  <span className="hidden sm:inline">New</span>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-xs sm:text-sm">
                  <span className="text-gray-600">My sheets:</span>
                  <span className="font-medium">-</span>
                </div>
                <div className="flex justify-between text-xs sm:text-sm">
                  <span className="text-gray-600">Pending:</span>
                  <span className="font-medium">-</span>
                </div>
                <div className="flex justify-between text-xs sm:text-sm">
                  <span className="text-gray-600">Approved:</span>
                  <span className="font-medium">-</span>
                </div>
              </div>
              <Link href="/billing-sheets" className="block">
                <Button className="w-full bg-green-600 hover:bg-green-700 text-white">
                  View Billing Sheets
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>

        {/* Standalone Billing Sheet Modal */}
        <StandaloneBillingSheet
          open={showBillingModal}
          onOpenChange={setShowBillingModal}
        />
      </div>
    </div>
  );
}