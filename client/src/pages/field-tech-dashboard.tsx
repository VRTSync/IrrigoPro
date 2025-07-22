import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Package, FileText, Plus } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { WorkOrder } from "@shared/schema";
import { Link } from "wouter";

export default function FieldTechDashboard() {
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
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Field Tech Dashboard</h1>
          <p className="text-gray-600 mt-2">Manage your work orders and billing sheets</p>
        </div>

        {/* Dashboard Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Work Orders Card */}
          <Link href="/work-orders">
            <Card className="hover:shadow-lg transition-all duration-200 cursor-pointer border-2 hover:border-blue-200">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="bg-blue-100 p-3 rounded-full">
                      <Package className="w-8 h-8 text-blue-600" />
                    </div>
                    <div>
                      <CardTitle className="text-xl text-gray-900">Work Orders</CardTitle>
                      <p className="text-gray-600 text-sm">View and manage assigned work</p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-lg px-3 py-1">
                    {workOrders?.length || 0}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Assigned to me:</span>
                    <span className="font-medium">{workOrders?.filter(wo => wo.status === 'assigned').length || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">In progress:</span>
                    <span className="font-medium">{workOrders?.filter(wo => wo.status === 'in_progress').length || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Completed:</span>
                    <span className="font-medium">{workOrders?.filter(wo => wo.status === 'completed').length || 0}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>

          {/* Billing Sheets Card */}
          <Link href="/billing-sheets">
            <Card className="hover:shadow-lg transition-all duration-200 cursor-pointer border-2 hover:border-green-200">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="bg-green-100 p-3 rounded-full">
                      <FileText className="w-8 h-8 text-green-600" />
                    </div>
                    <div>
                      <CardTitle className="text-xl text-gray-900">Billing Sheets</CardTitle>
                      <p className="text-gray-600 text-sm">Create billing for standalone work</p>
                    </div>
                  </div>
                  <Button size="sm" className="bg-green-600 hover:bg-green-700">
                    <Plus className="w-4 h-4 mr-2" />
                    New
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">This week:</span>
                    <span className="font-medium">-</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Pending:</span>
                    <span className="font-medium">-</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Approved:</span>
                    <span className="font-medium">-</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>


      </div>
    </div>
  );
}