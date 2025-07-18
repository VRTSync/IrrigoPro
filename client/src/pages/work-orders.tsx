import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkOrderForm } from "@/components/work-orders/work-order-form";
import { WorkOrderDetails } from "@/components/work-orders/work-order-details";
import { 
  Plus, 
  Search, 
  Calendar, 
  Clock, 
  CheckCircle, 
  AlertCircle, 
  User,
  MapPin,
  FileText,
  Eye
} from "lucide-react";
import type { WorkOrder } from "@shared/schema";

export default function WorkOrders() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null);
  const [showWorkOrderForm, setShowWorkOrderForm] = useState(false);
  const queryClient = useQueryClient();

  const { data: workOrders, isLoading } = useQuery<WorkOrder[]>({
    queryKey: ["/api/work-orders"],
  });

  const filteredWorkOrders = workOrders?.filter ? workOrders.filter(workOrder =>
    workOrder.projectName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    workOrder.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    workOrder.workOrderNumber.toLowerCase().includes(searchQuery.toLowerCase())
  ) : [];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">Pending</Badge>;
      case 'in_progress':
        return <Badge variant="default" className="bg-blue-100 text-blue-800">In Progress</Badge>;
      case 'completed':
        return <Badge variant="default" className="bg-green-100 text-green-800">Completed</Badge>;
      case 'cancelled':
        return <Badge variant="destructive">Cancelled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return <Badge variant="destructive">Urgent</Badge>;
      case 'high':
        return <Badge variant="default" className="bg-orange-100 text-orange-800">High</Badge>;
      case 'medium':
        return <Badge variant="secondary">Medium</Badge>;
      case 'low':
        return <Badge variant="outline">Low</Badge>;
      default:
        return <Badge variant="outline">{priority}</Badge>;
    }
  };

  const getWorkTypeBadge = (workType: string) => {
    switch (workType) {
      case 'estimate_based':
        return <Badge variant="default" className="bg-blue-100 text-blue-800">From Estimate</Badge>;
      case 'direct_billing':
        return <Badge variant="default" className="bg-green-100 text-green-800">Direct Billing</Badge>;
      case 'maintenance':
        return <Badge variant="default" className="bg-purple-100 text-purple-800">Maintenance</Badge>;
      default:
        return <Badge variant="outline">{workType}</Badge>;
    }
  };

  const formatDate = (date: string | Date | null) => {
    if (!date) return "Not scheduled";
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Group work orders by customer/property
  const groupedWorkOrders = filteredWorkOrders?.reduce((acc, workOrder) => {
    const key = `${workOrder.customerName} - ${workOrder.projectAddress || 'No Address'}`;
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(workOrder);
    return acc;
  }, {} as Record<string, WorkOrder[]>);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Work Orders</h1>
            <p className="text-gray-600 mt-1">Manage and track field work assignments</p>
          </div>
          <div className="mt-4 sm:mt-0">
            <Button 
              onClick={() => setShowWorkOrderForm(true)} 
              className="bg-primary text-white hover:bg-blue-700"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Work Order
            </Button>
          </div>
        </div>
      </div>

      <Tabs defaultValue="grouped" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="grouped">By Property</TabsTrigger>
          <TabsTrigger value="list">All Work Orders</TabsTrigger>
        </TabsList>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search work orders..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        <TabsContent value="grouped" className="space-y-4">
          {isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="bg-white shadow-sm border border-gray-200">
                  <CardHeader>
                    <Skeleton className="h-6 w-64" />
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {Array.from({ length: 2 }).map((_, j) => (
                        <div key={j} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div className="space-y-2">
                            <Skeleton className="h-4 w-48" />
                            <Skeleton className="h-3 w-32" />
                          </div>
                          <Skeleton className="h-8 w-20" />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(groupedWorkOrders || {}).map(([propertyKey, orders]) => (
                <Card key={propertyKey} className="bg-white shadow-sm border border-gray-200">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center">
                      <MapPin className="w-5 h-5 mr-2 text-gray-500" />
                      {propertyKey}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {orders.map((workOrder) => (
                        <div 
                          key={workOrder.id}
                          className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                        >
                          <div className="space-y-2">
                            <div className="flex items-center space-x-3">
                              <span className="font-medium text-gray-900">
                                {workOrder.workOrderNumber}
                              </span>
                              <span className="text-gray-600">
                                {workOrder.projectName}
                              </span>
                              {getWorkTypeBadge(workOrder.workType)}
                            </div>
                            <div className="flex items-center space-x-4 text-sm text-gray-500">
                              <div className="flex items-center">
                                <Calendar className="w-4 h-4 mr-1" />
                                {formatDate(workOrder.scheduledDate)}
                              </div>
                              {workOrder.assignedTechnicianName && (
                                <div className="flex items-center">
                                  <User className="w-4 h-4 mr-1" />
                                  {workOrder.assignedTechnicianName}
                                </div>
                              )}
                              <div className="flex items-center space-x-2">
                                {getStatusBadge(workOrder.status)}
                                {getPriorityBadge(workOrder.priority)}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSelectedWorkOrder(workOrder)}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="list" className="space-y-4">
          <Card className="bg-white shadow-sm border border-gray-200">
            <CardHeader>
              <CardTitle>All Work Orders</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Work Order
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Customer/Property
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Type & Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Scheduled
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Technician
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {isLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i}>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <Skeleton className="h-4 w-32" />
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <Skeleton className="h-4 w-48" />
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <Skeleton className="h-4 w-24" />
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <Skeleton className="h-4 w-32" />
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <Skeleton className="h-4 w-24" />
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right">
                            <Skeleton className="h-8 w-16" />
                          </td>
                        </tr>
                      ))
                    ) : (
                      filteredWorkOrders?.map((workOrder) => (
                        <tr key={workOrder.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="bg-blue-50 p-2 rounded-lg mr-3">
                                <FileText className="w-4 h-4 text-blue-600" />
                              </div>
                              <div>
                                <div className="text-sm font-medium text-gray-900">
                                  {workOrder.workOrderNumber}
                                </div>
                                <div className="text-sm text-gray-500">
                                  {workOrder.projectName}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{workOrder.customerName}</div>
                            <div className="text-sm text-gray-500">{workOrder.projectAddress}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="space-y-1">
                              {getWorkTypeBadge(workOrder.workType)}
                              {getStatusBadge(workOrder.status)}
                              {getPriorityBadge(workOrder.priority)}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {formatDate(workOrder.scheduledDate)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {workOrder.assignedTechnicianName || "Unassigned"}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSelectedWorkOrder(workOrder)}
                              className="text-gray-600 hover:text-gray-900"
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Empty State */}
      {!isLoading && filteredWorkOrders?.length === 0 && (
        <Card className="bg-white shadow-sm border border-gray-200">
          <CardContent className="p-12 text-center">
            <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No work orders found</h3>
            <p className="text-gray-600 mb-4">
              {searchQuery ? "No work orders match your search criteria." : "Get started by creating your first work order."}
            </p>
            <Button 
              onClick={() => setShowWorkOrderForm(true)}
              className="bg-primary text-white hover:bg-blue-700"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Work Order
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Work Order Form Modal */}
      {showWorkOrderForm && (
        <WorkOrderForm
          onClose={() => setShowWorkOrderForm(false)}
          onSuccess={() => {
            setShowWorkOrderForm(false);
            queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
          }}
        />
      )}

      {/* Work Order Details Modal */}
      {selectedWorkOrder && (
        <WorkOrderDetails
          workOrder={selectedWorkOrder}
          onClose={() => setSelectedWorkOrder(null)}
          onUpdate={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
          }}
        />
      )}
    </div>
  );
}