import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkOrderForm } from "@/components/work-orders/work-order-form";
import { WorkOrderDetails } from "@/components/work-orders/work-order-details";
import { WorkOrderCompletion } from "@/components/work-orders/work-order-completion";
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
  const [selectedWorkOrderForCompletion, setSelectedWorkOrderForCompletion] = useState<WorkOrder | null>(null);
  const [showWorkOrderForm, setShowWorkOrderForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [currentUser, setCurrentUser] = useState<any>(null);
  const queryClient = useQueryClient();

  // Get current user from localStorage and refresh user data
  useEffect(() => {
    const refreshUserData = async () => {
      const savedUser = localStorage.getItem("user");
      if (savedUser) {
        try {
          const currentUserData = JSON.parse(savedUser);
          
          // Force refresh user data from API to get updated user info
          const response = await fetch(`/api/users`);
          if (response.ok) {
            const users = await response.json();
            const updatedUser = users.find((u: any) => u.username === currentUserData.username);
            if (updatedUser) {
              // Always update localStorage with fresh data
              localStorage.setItem("user", JSON.stringify(updatedUser));
              setCurrentUser(updatedUser);
            } else {
              setCurrentUser(currentUserData);
            }
          } else {
            setCurrentUser(currentUserData);
          }
        } catch (error) {
          console.error("Error refreshing user data:", error);
        }
      }
    };
    
    refreshUserData();
  }, []);

  // For field techs, only show work orders assigned to them
  const { data: workOrders, isLoading } = useQuery<WorkOrder[]>({
    queryKey: currentUser?.role === 'field_tech' 
      ? ["/api/work-orders", "technician", currentUser?.id]
      : ["/api/work-orders"],
    queryFn: () => currentUser?.role === 'field_tech' 
      ? fetch(`/api/work-orders?technician=${currentUser.id}`).then(res => res.json())
      : fetch('/api/work-orders').then(res => res.json()),
    staleTime: 0,
    refetchOnMount: true,
    enabled: !!currentUser,
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
          
          <div className="flex flex-wrap gap-3 mb-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="flex-1 min-w-[120px]">
                <CardContent className="p-3">
                  <div className="flex items-center space-x-2">
                    <Skeleton className="h-6 w-6 rounded-full" />
                    <div>
                      <Skeleton className="h-3 w-12 mb-1" />
                      <Skeleton className="h-5 w-6" />
                    </div>
                  </div>
                </CardContent>
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
    <div className="min-h-screen bg-gray-50/30 p-4 sm:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 sm:mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
              {currentUser?.role === 'field_tech' ? 'My Work Orders' : 'Work Orders'}
            </h1>
            <p className="text-gray-600 mt-1 text-sm sm:text-base">
              {currentUser?.role === 'field_tech' 
                ? 'View and manage your assigned work'
                : 'Manage and track field work assignments'
              }
            </p>
          </div>
          {currentUser?.role !== 'field_tech' && (
            <Button 
              onClick={() => setShowWorkOrderForm(true)} 
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 sm:px-6 py-2.5 rounded-lg shadow-sm w-full sm:w-auto"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Work Order
            </Button>
          )}
        </div>

        {/* Stats Cards - Compact Single Row */}
        <div className="flex flex-wrap gap-3 mb-6">
          <Card className="bg-white border-0 shadow-sm hover:shadow-md transition-shadow flex-1 min-w-[120px]">
            <CardContent className="p-3">
              <div className="flex items-center space-x-2">
                <div className="bg-yellow-100 p-1.5 rounded-full">
                  <Clock className="w-3 h-3 text-yellow-600" />
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-600">Pending</p>
                  <p className="text-lg font-bold text-gray-900">{getStatusCount('pending')}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white border-0 shadow-sm hover:shadow-md transition-shadow flex-1 min-w-[120px]">
            <CardContent className="p-3">
              <div className="flex items-center space-x-2">
                <div className="bg-blue-100 p-1.5 rounded-full">
                  <AlertCircle className="w-3 h-3 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-600">In Progress</p>
                  <p className="text-lg font-bold text-gray-900">{getStatusCount('in_progress')}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white border-0 shadow-sm hover:shadow-md transition-shadow flex-1 min-w-[120px]">
            <CardContent className="p-3">
              <div className="flex items-center space-x-2">
                <div className="bg-green-100 p-1.5 rounded-full">
                  <CheckCircle className="w-3 h-3 text-green-600" />
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-600">Completed</p>
                  <p className="text-lg font-bold text-gray-900">{getStatusCount('completed')}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white border-0 shadow-sm hover:shadow-md transition-shadow flex-1 min-w-[120px]">
            <CardContent className="p-3">
              <div className="flex items-center space-x-2">
                <div className="bg-gray-100 p-1.5 rounded-full">
                  <FileText className="w-3 h-3 text-gray-600" />
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-600">Total</p>
                  <p className="text-lg font-bold text-gray-900">{workOrders?.length || 0}</p>
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
              <Card key={workOrder.id} className="bg-white border-0 shadow-sm hover:shadow-md transition-all duration-200">
                <CardContent className="p-4">
                  {/* Mobile-First Layout */}
                  <div className="space-y-3">
                    {/* Top Row: View Icon, Work Order #, Status Badge */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedWorkOrder(workOrder);
                          }}
                          className="flex-shrink-0 p-2 rounded-lg hover:bg-gray-50 transition-colors"
                          title="View work order details"
                        >
                          <Eye className="w-5 h-5 text-blue-600" />
                        </button>
                        <h3 className="font-semibold text-gray-900 text-base">
                          {workOrder.workOrderNumber}
                        </h3>
                      </div>
                      {getStatusBadge(workOrder.status)}
                    </div>

                    {/* Customer */}
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-gray-500 flex-shrink-0" />
                      <span className="text-gray-900 font-medium truncate">{workOrder.customerName}</span>
                    </div>

                    {/* Date Assigned */}
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-gray-500 flex-shrink-0" />
                      <span className="text-gray-700 text-sm">
                        Assigned: {formatDate(workOrder.scheduledDate)}
                      </span>
                    </div>

                    {/* Location */}
                    {workOrder.projectAddress && (
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-gray-500 flex-shrink-0" />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const encodedAddress = encodeURIComponent(workOrder.projectAddress || '');
                            const mapsUrl = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
                              ? `https://maps.apple.com/?q=${encodedAddress}`
                              : `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
                            window.open(mapsUrl, '_blank');
                          }}
                          className="text-blue-600 hover:text-blue-800 hover:underline transition-colors text-sm truncate flex-1 text-left"
                        >
                          {workOrder.projectAddress}
                        </button>
                      </div>
                    )}

                    {/* Start Button - Full Width at Bottom (only for field techs and their assigned work) */}
                    {(workOrder.status === 'in_progress' || workOrder.status === 'assigned') && 
                     currentUser?.role === 'field_tech' && 
                     workOrder.assignedTechnicianId === currentUser.id && (
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedWorkOrderForCompletion(workOrder);
                        }}
                        className="w-full bg-green-600 hover:bg-green-700 text-white mt-4"
                      >
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Start Work
                      </Button>
                    )}
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

        {/* Work Order Completion Dialog */}
        {selectedWorkOrderForCompletion && (
          <WorkOrderCompletion 
            workOrder={selectedWorkOrderForCompletion}
            open={!!selectedWorkOrderForCompletion}
            onClose={() => {
              console.log('Closing work order completion');
              setSelectedWorkOrderForCompletion(null);
            }}
            onComplete={() => {
              console.log('Work order completed');
              setSelectedWorkOrderForCompletion(null);
              queryClient.invalidateQueries({ queryKey: ['/api/work-orders'] });
            }}
          />
        )}
      </div>
    </div>
  );
}