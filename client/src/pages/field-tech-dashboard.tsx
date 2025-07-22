import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, Clock, Package, CheckCircle, User, MapPin, FileText, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { WorkOrderCompletion } from "@/components/work-orders/work-order-completion";
import type { WorkOrder, FieldWorkSession } from "@shared/schema";
import { Link } from "wouter";

export default function FieldTechDashboard() {
  const [activeTimer, setActiveTimer] = useState<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get current user from localStorage
  const getCurrentUser = () => {
    const savedUser = localStorage.getItem("user");
    return savedUser ? JSON.parse(savedUser) : null;
  };

  const currentUser = getCurrentUser();

  // Get assigned work orders for this technician
  const { data: workOrders, isLoading } = useQuery<WorkOrder[]>({
    queryKey: ["/api/work-orders", "technician", currentUser?.id],
    queryFn: () => apiRequest(`/api/work-orders?technician=${currentUser?.id}`, "GET"),
    enabled: !!currentUser?.id,
  });

  // Get active field work session
  const { data: activeSession } = useQuery<FieldWorkSession | null>({
    queryKey: ["/api/field-work-sessions/active"],
  });

  const startWork = useMutation({
    mutationFn: async (workOrderId: number) => {
      return await apiRequest("/api/field-work-sessions", "POST", {
        workOrderId,
        startTime: new Date().toISOString(),
      });
    },
    onSuccess: (session) => {
      setActiveTimer(session.workOrderId);
      toast({
        title: "Work Started",
        description: "Timer started for this work order",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/field-work-sessions/active"] });
    },
  });

  const stopWork = useMutation({
    mutationFn: async (sessionId: number) => {
      return await apiRequest(`/api/field-work-sessions/${sessionId}/complete`, "POST");
    },
    onSuccess: () => {
      setActiveTimer(null);
      toast({
        title: "Work Completed",
        description: "Time logged successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/field-work-sessions/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders/assigned"] });
    },
  });

  const formatTime = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'assigned':
        return 'bg-blue-100 text-blue-800';
      case 'in_progress':
        return 'bg-yellow-100 text-yellow-800';
      case 'completed':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Field Tech Portal</h1>
          <p className="text-gray-600 mt-2">Manage your assigned work orders and billing</p>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <Card className="hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="bg-blue-100 p-3 rounded-full">
                  <Package className="w-6 h-6 text-blue-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900">Work Orders</h3>
                  <p className="text-gray-600">View and manage assigned work</p>
                </div>
                <Badge variant="secondary">
                  {workOrders?.length || 0} active
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Link href="/billing-sheets">
            <Card className="hover:shadow-md transition-shadow cursor-pointer">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="bg-green-100 p-3 rounded-full">
                    <FileText className="w-6 h-6 text-green-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900">Billing Sheets</h3>
                    <p className="text-gray-600">Create billing for standalone work</p>
                  </div>
                  <Button size="sm" className="bg-green-600 hover:bg-green-700">
                    <Plus className="w-4 h-4 mr-2" />
                    New
                  </Button>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Active Timer Card */}
        {activeSession && (
          <Card className="mb-6 border-2 border-blue-200 bg-blue-50">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="bg-blue-100 p-3 rounded-full">
                    <Clock className="w-6 h-6 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold">Active Work Session</h3>
                    <p className="text-gray-600">Work Order #{activeSession.workOrderId}</p>
                    <p className="text-sm text-gray-500">
                      Started: {new Date(activeSession.startTime).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
                <Button 
                  onClick={() => stopWork.mutate(activeSession.id)}
                  className="bg-red-600 hover:bg-red-700"
                  disabled={stopWork.isPending}
                >
                  <Pause className="w-4 h-4 mr-2" />
                  Stop Work
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Work Orders List */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900">My Work Orders</h2>
          
          {isLoading ? (
            <div className="text-center py-8">
              <p className="text-gray-500">Loading work orders...</p>
            </div>
          ) : workOrders?.length === 0 ? (
            <Card>
              <CardContent className="text-center py-8">
                <User className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No work orders assigned</h3>
                <p className="text-gray-600">Check back later for new assignments</p>
              </CardContent>
            </Card>
          ) : (
            workOrders?.map((workOrder) => (
              <Card key={workOrder.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold">Work Order #{workOrder.id}</h3>
                        <Badge className={getStatusColor(workOrder.status)}>
                          {workOrder.status.replace('_', ' ')}
                        </Badge>
                      </div>
                      
                      <div className="space-y-1 text-gray-600">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4" />
                          <span>Customer: {workOrder.customerName}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4" />
                          <span>Location: {workOrder.propertyAddress}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Package className="w-4 h-4" />
                          <span>Items: {workOrder.totalItems || 0} parts</span>
                        </div>
                      </div>

                      {workOrder.notes && (
                        <div className="mt-3 p-3 bg-yellow-50 rounded-lg">
                          <p className="text-sm text-yellow-800">
                            <strong>Notes:</strong> {workOrder.notes}
                          </p>
                        </div>
                      )}
                    </div>
                    
                    <div className="flex flex-col gap-2 ml-6">
                      {workOrder.status === 'assigned' && !activeSession && (
                        <Button 
                          onClick={() => startWork.mutate(workOrder.id)}
                          disabled={startWork.isPending}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          <Play className="w-4 h-4 mr-2" />
                          Start Work
                        </Button>
                      )}

                      {workOrder.status === 'in_progress' && (
                        <Button variant="outline" size="sm">
                          <Package className="w-4 h-4 mr-2" />
                          Log Parts
                        </Button>
                      )}

                      <Button variant="outline" size="sm">
                        View Details
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-blue-600">
                {workOrders?.filter(w => w.status === 'assigned').length || 0}
              </div>
              <p className="text-sm text-gray-600">Assigned</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-yellow-600">
                {workOrders?.filter(w => w.status === 'in_progress').length || 0}
              </div>
              <p className="text-sm text-gray-600">In Progress</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-green-600">
                {workOrders?.filter(w => w.status === 'completed').length || 0}
              </div>
              <p className="text-sm text-gray-600">Completed</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-gray-600">
                {activeSession ? formatTime(activeSession.totalMinutes || 0) : '0h 0m'}
              </div>
              <p className="text-sm text-gray-600">Today's Time</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}