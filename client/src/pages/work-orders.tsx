import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Eye,
  Filter,
  ArrowRight,
  Wrench
} from "lucide-react";
import type { WorkOrder } from "@shared/schema";

export default function WorkOrders() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null);
  const [showWorkOrderForm, setShowWorkOrderForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const queryClient = useQueryClient();

  const { data: workOrders, isLoading } = useQuery<WorkOrder[]>({
    queryKey: ["/api/work-orders"],
  });

  const filteredWorkOrders = workOrders?.filter ? workOrders.filter(workOrder => {
    const matchesSearch = workOrder.projectName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         workOrder.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         workOrder.workOrderNumber.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === "all" || workOrder.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  }) : [];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Pending</Badge>;
      case 'in_progress':
        return <Badge className="bg-blue-100 text-blue-800 border-blue-200">In Progress</Badge>;
      case 'completed':
        return <Badge className="bg-green-100 text-green-800 border-green-200">Completed</Badge>;
      case 'cancelled':
        return <Badge className="bg-red-100 text-red-800 border-red-200">Cancelled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      case 'high':
        return <AlertCircle className="w-4 h-4 text-orange-500" />;
      case 'medium':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'low':
        return <Clock className="w-4 h-4 text-green-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-500" />;
    }
  };

  const formatDate = (date: string | Date | null) => {
    if (!date) return "Not scheduled";
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getStatusCount = (status: string) => {
    return workOrders?.filter(wo => wo.status === status).length || 0;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50/30 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <Skeleton className="h-8 w-48 mb-2" />
              <Skeleton className="h-5 w-72" />
            </div>
            <Skeleton className="h-10 w-36" />
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="p-6">
                <Skeleton className="h-4 w-16 mb-2" />
                <Skeleton className="h-8 w-8" />
              </Card>
            ))}
          </div>

          <div className="space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4 flex-1">
                    <Skeleton className="h-12 w-12 rounded-lg" />
                    <div className="flex-1">
                      <Skeleton className="h-6 w-32 mb-2" />
                      <Skeleton className="h-4 w-40 mb-2" />
                      <Skeleton className="h-4 w-48 mb-3" />
                      <Skeleton className="h-4 w-32 mb-3" />
                      <div className="flex space-x-6">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-4 w-40" />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Skeleton className="h-6 w-16" />
                    <Skeleton className="h-6 w-20" />
                    <Skeleton className="h-8 w-8" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/30 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Work Orders</h1>
            <p className="text-gray-600 mt-1">Manage and track field work assignments</p>
          </div>
          <Button 
            onClick={() => setShowWorkOrderForm(true)} 
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg shadow-sm"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Work Order
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <Card className="bg-white border-0 shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Pending</p>
                  <p className="text-2xl font-bold text-gray-900">{getStatusCount('pending')}</p>
                </div>
                <div className="bg-yellow-100 p-3 rounded-full">
                  <Clock className="w-5 h-5 text-yellow-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white border-0 shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">In Progress</p>
                  <p className="text-2xl font-bold text-gray-900">{getStatusCount('in_progress')}</p>
                </div>
                <div className="bg-blue-100 p-3 rounded-full">
                  <AlertCircle className="w-5 h-5 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white border-0 shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Completed</p>
                  <p className="text-2xl font-bold text-gray-900">{getStatusCount('completed')}</p>
                </div>
                <div className="bg-green-100 p-3 rounded-full">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white border-0 shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Total</p>
                  <p className="text-2xl font-bold text-gray-900">{workOrders?.length || 0}</p>
                </div>
                <div className="bg-gray-100 p-3 rounded-full">
                  <FileText className="w-5 h-5 text-gray-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-8">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search work orders..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-white border-gray-200 shadow-sm"
            />
          </div>
          <div className="flex gap-2">
            <Button 
              variant={statusFilter === "all" ? "default" : "outline"}
              onClick={() => setStatusFilter("all")}
              className="px-4 py-2"
            >
              All
            </Button>
            <Button 
              variant={statusFilter === "pending" ? "default" : "outline"}
              onClick={() => setStatusFilter("pending")}
              className="px-4 py-2"
            >
              Pending
            </Button>
            <Button 
              variant={statusFilter === "in_progress" ? "default" : "outline"}
              onClick={() => setStatusFilter("in_progress")}
              className="px-4 py-2"
            >
              Active
            </Button>
            <Button 
              variant={statusFilter === "completed" ? "default" : "outline"}
              onClick={() => setStatusFilter("completed")}
              className="px-4 py-2"
            >
              Completed
            </Button>
          </div>
        </div>

        {/* Work Orders Grid */}
        {filteredWorkOrders?.length === 0 ? (
          <Card className="bg-white border-0 shadow-sm">
            <CardContent className="p-12 text-center">
              <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No work orders found</h3>
              <p className="text-gray-600 mb-6">
                {searchQuery ? "No work orders match your search criteria." : "Get started by creating your first work order."}
              </p>
              <Button 
                onClick={() => setShowWorkOrderForm(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Work Order
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredWorkOrders
              ?.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()) // Sort oldest to newest
              ?.map((workOrder) => (
              <Card key={workOrder.id} className="bg-white border-0 shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer group">
                <CardContent className="p-6 relative">
                  <div className="flex items-start justify-between">
                    {/* Left side - Job Information */}
                    <div className="flex items-start space-x-4 flex-1 pr-4">
                      <div className="bg-blue-50 p-3 rounded-lg flex-shrink-0">
                        <FileText className="w-6 h-6 text-blue-600" />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-3 mb-2">
                          <h3 className="font-semibold text-gray-900 text-lg">
                            {workOrder.workOrderNumber}
                          </h3>
                          {getPriorityIcon(workOrder.priority)}
                        </div>
                        
                        {/* Customer - Right under work order number */}
                        <div className="flex items-center space-x-2 mb-2">
                          <User className="w-4 h-4 text-blue-600 flex-shrink-0" />
                          <p className="font-medium text-gray-900">{workOrder.customerName}</p>
                        </div>
                        
                        <p className="text-gray-700 font-medium mb-3">
                          {workOrder.projectName}
                        </p>
                        
                        <div className="space-y-1">
                          <div className="flex items-center space-x-1 text-sm text-gray-600">
                            <Calendar className="w-4 h-4 flex-shrink-0" />
                            <span>{formatDate(workOrder.scheduledDate)}</span>
                          </div>

                          {workOrder.projectAddress && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const encodedAddress = encodeURIComponent(workOrder.projectAddress);
                                const mapsUrl = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
                                  ? `https://maps.apple.com/?q=${encodedAddress}` // iOS Maps
                                  : `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`; // Google Maps
                                window.open(mapsUrl, '_blank');
                              }}
                              className="flex items-center space-x-1 text-sm text-blue-600 hover:text-blue-800 hover:underline transition-colors"
                              title="Click for directions"
                            >
                              <MapPin className="w-4 h-4 flex-shrink-0" />
                              <span className="truncate">{workOrder.projectAddress}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Top Right - Badges and View Button */}
                    <div className="absolute top-6 right-6 flex items-start space-x-3">
                      <div className="flex items-start justify-end space-x-2 flex-wrap">
                        {getStatusBadge(workOrder.status)}
                        {workOrder.estimateId && (
                          <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
                            From EST-{workOrder.estimateId}
                          </Badge>
                        )}
                        {workOrder.priority === 'urgent' && (
                          <Badge className="text-xs bg-red-100 text-red-800 border-red-200">Emergency</Badge>
                        )}
                        {workOrder.priority === 'high' && (
                          <Badge className="text-xs bg-orange-100 text-orange-800 border-orange-200">High</Badge>
                        )}
                      </div>
                      
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          console.log('Setting selected work order:', workOrder);
                          setSelectedWorkOrder(workOrder);
                        }}
                        className="text-xs flex-shrink-0"
                      >
                        View Work Order
                      </Button>
                    </div>
                  </div>

                  {/* Bottom Right - Technician Assignment */}
                  <div className="absolute bottom-6 right-6 flex flex-col items-end space-y-2">
                    <div className="flex items-center space-x-2">
                      {workOrder.assignedTechnicianName ? (
                        <>
                          <Wrench className="w-5 h-5 text-orange-600 flex-shrink-0" />
                          <div className="text-right">
                            <p className="font-medium text-gray-900 text-sm">{workOrder.assignedTechnicianName}</p>
                            <p className="text-xs text-gray-500">Assigned Technician</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="relative">
                            <Wrench className="w-5 h-5 text-red-400 flex-shrink-0" />
                            <div className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                          </div>
                          <div className="text-right">
                            <p className="text-red-600 font-medium text-sm">Needs Assignment</p>
                            <p className="text-xs text-red-500">No technician assigned</p>
                          </div>
                        </>
                      )}
                    </div>
                    
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        // TODO: Open technician assignment modal
                        console.log('Assign technician to work order:', workOrder.id);
                      }}
                      className="text-xs text-blue-600 hover:text-blue-800"
                    >
                      {workOrder.assignedTechnicianName ? 'Reassign' : 'Assign Technician'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Work Order Form Dialog */}
        {showWorkOrderForm && (
          <WorkOrderForm 
            onClose={() => setShowWorkOrderForm(false)} 
            onSuccess={() => {
              setShowWorkOrderForm(false);
              queryClient.invalidateQueries({ queryKey: ['/api/work-orders'] });
            }}
          />
        )}

        {/* Work Order Details Dialog */}
        {selectedWorkOrder && (
          <WorkOrderDetails 
            workOrder={selectedWorkOrder}
            onClose={() => {
              console.log('Closing work order details');
              setSelectedWorkOrder(null);
            }}
            onUpdate={() => {
              console.log('Updating work orders');
              queryClient.invalidateQueries({ queryKey: ['/api/work-orders'] });
            }}
          />
        )}
      </div>
    </div>
  );
}