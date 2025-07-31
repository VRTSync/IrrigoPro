import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  Wrench,
  Play,
  Users,
  List
} from "lucide-react";
import type { WorkOrder } from "@shared/schema";

export default function WorkOrders() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null);
  const [selectedWorkOrderForStart, setSelectedWorkOrderForStart] = useState<WorkOrder | null>(null);
  const [selectedWorkOrderForCompletion, setSelectedWorkOrderForCompletion] = useState<WorkOrder | null>(null);
  const [showWorkOrderForm, setShowWorkOrderForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [groupByCustomer, setGroupByCustomer] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

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
    
    // Check for create parameter in URL
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('create') === 'true') {
      setShowWorkOrderForm(true);
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    }
    
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

  // Fetch field technicians for assignment (managers only)
  const { data: fieldTechs } = useQuery({
    queryKey: ['/api/users/field-techs'],
    staleTime: 300000, // 5 minutes
    enabled: currentUser?.role === 'irrigation_manager',
  });



  const filteredWorkOrders = workOrders?.filter ? workOrders.filter(workOrder => {
    const matchesSearch = workOrder.projectName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         workOrder.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         workOrder.workOrderNumber.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === "all" || workOrder.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  }) : [];

  // Group work orders by customer
  const groupedWorkOrders = groupByCustomer ? 
    filteredWorkOrders.reduce((acc, workOrder) => {
      const customerName = workOrder.customerName;
      if (!acc[customerName]) {
        acc[customerName] = [];
      }
      acc[customerName].push(workOrder);
      return acc;
    }, {} as Record<string, WorkOrder[]>) : null;

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



  // Reassign work order mutation
  const reassignWorkOrder = useMutation({
    mutationFn: async ({ workOrderId, technicianId, technicianName }: { workOrderId: number; technicianId: number; technicianName: string }) => {
      return apiRequest(`/api/work-orders/${workOrderId}/assign`, "POST", {
        technicianId,
        technicianName,
      });
    },
    onSuccess: () => {
      toast({
        title: "Work Order Reassigned",
        description: "Work order has been successfully reassigned",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to reassign work order",
        variant: "destructive",
      });
    },
  });

  // Handle loading state for currentUser
  if (!currentUser) {
    return <div>Loading user data...</div>;
  }

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
            {Array.from({ length: 3 }).map((_, i) => (
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


        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
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

        {/* View Options */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">View:</span>
            <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
              <Button
                variant={!groupByCustomer ? "default" : "ghost"}
                size="sm"
                onClick={() => setGroupByCustomer(false)}
                className="px-3 py-1.5 text-xs"
              >
                <List className="w-3 h-3 mr-1.5" />
                List
              </Button>
              <Button
                variant={groupByCustomer ? "default" : "ghost"}
                size="sm"
                onClick={() => setGroupByCustomer(true)}
                className="px-3 py-1.5 text-xs"
              >
                <Users className="w-3 h-3 mr-1.5" />
                By Customer
              </Button>
            </div>
          </div>
          <div className="text-sm text-gray-600">
            {filteredWorkOrders.length} work order{filteredWorkOrders.length !== 1 ? 's' : ''}
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
        ) : groupByCustomer && groupedWorkOrders ? (
          // Grouped view by customer
          <div className="space-y-6">
            {Object.entries(groupedWorkOrders)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([customerName, customerWorkOrders]) => (
                <Card key={customerName} className="bg-white border-0 shadow-sm">
                  <CardHeader className="pb-3 border-b border-gray-100">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <User className="w-5 h-5 text-blue-600" />
                      {customerName}
                      <Badge variant="outline" className="ml-2">
                        {customerWorkOrders.length} work order{customerWorkOrders.length !== 1 ? 's' : ''}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="space-y-1">
                      {customerWorkOrders
                        .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())
                        .map((workOrder) => (
                          <div key={workOrder.id} className="p-4 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-b-0">
                            <div className="flex flex-col h-full">
                              {/* Header: Work Order # and Status */}
                              <div className="flex items-center justify-between mb-3">
                                <h4 className="font-semibold text-gray-900 text-base">
                                  {workOrder.workOrderNumber}
                                </h4>
                                {getStatusBadge(workOrder.status)}
                              </div>

                              {/* Content Area */}
                              <div className="flex-1 space-y-2 mb-4">
                                {/* Project Name */}
                                <div className="flex items-center gap-2">
                                  <FileText className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                  <span className="text-gray-700 text-sm truncate">{workOrder.projectName}</span>
                                </div>

                                {/* Date Scheduled */}
                                <div className="flex items-center gap-2">
                                  <Calendar className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                  <span className="text-gray-700 text-sm">
                                    Scheduled: {formatDate(workOrder.scheduledDate)}
                                  </span>
                                </div>

                                {/* Location */}
                                <div className="flex items-center gap-2">
                                  <MapPin className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                  <span className="text-gray-700 text-sm truncate">{workOrder.projectAddress}</span>
                                </div>

                                {/* Assigned Technician */}
                                {workOrder.assignedTechnicianName && (
                                  <div className="flex items-center gap-2">
                                    <User className="w-4 h-4 text-blue-500 flex-shrink-0" />
                                    <span className="text-blue-700 text-sm font-medium">
                                      Assigned to: {workOrder.assignedTechnicianName}
                                    </span>
                                  </div>
                                )}
                              </div>

                              {/* Action Buttons */}
                              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                                <div className="text-xs text-gray-500">
                                  Created {formatDate(workOrder.createdAt)}
                                </div>
                                <div className="flex items-center gap-2">
                                  {/* Only show green View button for all cards */}
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setSelectedWorkOrder(workOrder)}
                                    className="text-xs px-3 py-1.5 bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                                  >
                                    <Eye className="w-3 h-3 mr-1" />
                                    View
                                  </Button>
                                  {currentUser?.role === 'irrigation_manager' && workOrder.status !== 'completed' && (
                                    <Select
                                      onValueChange={(techId: string) => {
                                        const selectedTech = Array.isArray(fieldTechs) ? fieldTechs.find((tech: any) => tech.id.toString() === techId) : undefined;
                                        if (selectedTech) {
                                          reassignWorkOrder.mutate({
                                            workOrderId: workOrder.id,
                                            technicianId: selectedTech.id,
                                            technicianName: selectedTech.name,
                                          });
                                        } else if (techId === currentUser.id.toString()) {
                                          reassignWorkOrder.mutate({
                                            workOrderId: workOrder.id,
                                            technicianId: currentUser.id,
                                            technicianName: currentUser.name,
                                          });
                                        }
                                      }}
                                    >
                                      <SelectTrigger className="w-32 h-8 text-xs bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 focus:bg-blue-100">
                                        <SelectValue placeholder="Assign" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value={currentUser.id.toString()}>
                                          Assign to Me
                                        </SelectItem>
                                        {Array.isArray(fieldTechs) ? fieldTechs.map((tech: any) => (
                                          <SelectItem key={tech.id} value={tech.id.toString()}>
                                            {tech.name}
                                          </SelectItem>
                                        )) : []}
                                      </SelectContent>
                                    </Select>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
          </div>
        ) : (
          // List view (default)
          <div className="space-y-4">
            {filteredWorkOrders
              ?.sort((a, b) => {
                // For field techs: Put completed work orders at the bottom
                if (currentUser?.role === 'field_tech') {
                  if (a.status === 'completed' && b.status !== 'completed') return 1;
                  if (a.status !== 'completed' && b.status === 'completed') return -1;
                }
                // Otherwise sort by creation date (oldest to newest)
                return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
              })
              ?.map((workOrder) => (
              <Card key={workOrder.id} className={`border-0 shadow-sm hover:shadow-md transition-all duration-200 ${
                workOrder.status === 'completed' && currentUser?.role === 'field_tech' 
                  ? 'bg-green-50 border-l-4 border-l-green-500' 
                  : 'bg-white'
              }`}>
                <CardContent className="p-4">
                  <div className="flex flex-col h-full">
                    {/* Header: Work Order # and Status */}
                    <div className="flex items-center justify-between mb-3">
                      <h3 className={`font-semibold text-base ${
                        workOrder.status === 'completed' && currentUser?.role === 'field_tech'
                          ? 'text-green-800'
                          : 'text-gray-900'
                      }`}>
                        {workOrder.workOrderNumber}
                        {workOrder.status === 'completed' && currentUser?.role === 'field_tech' && (
                          <span className="ml-2 text-sm font-medium text-green-600">✓ COMPLETED</span>
                        )}
                      </h3>
                      {getStatusBadge(workOrder.status)}
                    </div>

                    {/* Content Area */}
                    <div className="flex-1 space-y-2 mb-4">
                      {/* Customer */}
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-gray-500 flex-shrink-0" />
                        <span className="text-gray-900 font-medium truncate">{workOrder.customerName}</span>
                      </div>

                      {/* Project Name */}
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-gray-500 flex-shrink-0" />
                        <span className="text-gray-700 text-sm truncate">{workOrder.projectName}</span>
                      </div>

                      {/* Date Assigned */}
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-gray-500 flex-shrink-0" />
                        <span className="text-gray-700 text-sm">
                          Assigned: {formatDate(workOrder.assignedDate)}
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

                      {/* Assignment Indicator */}
                      <div className="mt-3">
                        {workOrder.assignedTechnicianName ? (
                          <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg p-2">
                            <Wrench className="w-4 h-4 text-blue-600 flex-shrink-0" />
                            <div className="flex-1">
                              <p className="text-xs font-medium text-blue-600">Assigned to</p>
                              <p className="text-sm font-semibold text-blue-700">{workOrder.assignedTechnicianName}</p>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-lg p-2">
                            <AlertCircle className="w-4 h-4 text-yellow-600 flex-shrink-0" />
                            <div className="flex-1">
                              <p className="text-sm font-medium text-yellow-700">Unassigned</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Action Buttons at Bottom */}
                    <div className="border-t pt-3 mt-auto">
                      {currentUser?.role === 'field_tech' ? (
                        // Field Tech View - Only green View button for assigned work orders
                        <>
                          {(workOrder.assignedTechnicianId === currentUser.id || workOrder.assignedTechnicianName === currentUser.name) && (
                            <Button
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedWorkOrder(workOrder);
                              }}
                              className={`w-full ${
                                workOrder.status === 'completed'
                                  ? 'bg-green-700 hover:bg-green-800 text-white border border-green-600'
                                  : 'bg-green-600 hover:bg-green-700 text-white'
                              }`}
                            >
                              <Eye className="w-4 h-4 mr-1" />
                              {workOrder.status === 'completed' ? 'View Completed' : 'View'}
                            </Button>
                          )}
                          
                          {/* Show message for unassigned work orders */}
                          {!(workOrder.assignedTechnicianId === currentUser.id || workOrder.assignedTechnicianName === currentUser.name) && (
                            <div className="text-center text-gray-500 text-sm py-2">
                              Work order not assigned to you
                            </div>
                          )}
                        </>
                      ) : (
                        // Manager/Admin View - View button and Assignment dropdown
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedWorkOrder(workOrder);
                            }}
                            className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            View
                          </Button>
                          {currentUser?.role === 'irrigation_manager' && workOrder.status !== 'completed' && (
                            <Select
                              onValueChange={(techId: string) => {
                                const selectedTech = Array.isArray(fieldTechs) ? fieldTechs.find((tech: any) => tech.id.toString() === techId) : undefined;
                                if (selectedTech) {
                                  reassignWorkOrder.mutate({
                                    workOrderId: workOrder.id,
                                    technicianId: selectedTech.id,
                                    technicianName: selectedTech.name,
                                  });
                                } else if (techId === currentUser.id.toString()) {
                                  reassignWorkOrder.mutate({
                                    workOrderId: workOrder.id,
                                    technicianId: currentUser.id,
                                    technicianName: currentUser.name,
                                  });
                                }
                              }}
                            >
                              <SelectTrigger className="w-32 h-8 text-xs bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 focus:bg-blue-100">
                                <SelectValue placeholder="Assign" />
                              </SelectTrigger>
                              <SelectContent>
                                {currentUser?.id && (
                                  <SelectItem value={currentUser.id.toString()}>
                                    Assign to Me
                                  </SelectItem>
                                )}
                                {Array.isArray(fieldTechs) ? fieldTechs.map((tech: any) => (
                                  <SelectItem key={tech.id} value={tech.id.toString()}>
                                    {tech.name}
                                  </SelectItem>
                                )) : []}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      )}
                    </div>
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

        {/* Work Order Details Dialog - View Only */}
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
            showAddDetailsButton={false}
            onStartWork={(workOrder) => {
              console.log('Starting work order from details modal');
              setSelectedWorkOrder(null);
              setSelectedWorkOrderForCompletion(workOrder);
            }}
          />
        )}

        {/* Work Order Details Dialog - Start Work Order */}
        {selectedWorkOrderForStart && (
          <WorkOrderDetails 
            workOrder={selectedWorkOrderForStart}
            onClose={() => {
              console.log('Closing work order start details');
              setSelectedWorkOrderForStart(null);
            }}
            onUpdate={() => {
              console.log('Updating work orders');
              queryClient.invalidateQueries({ queryKey: ['/api/work-orders'] });
            }}
            showAddDetailsButton={true}
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