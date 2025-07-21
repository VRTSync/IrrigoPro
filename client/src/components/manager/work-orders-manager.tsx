import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Plus, Eye, User, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { WorkOrder } from "@shared/schema";

interface WorkOrdersManagerProps {
  onBack: () => void;
}

export function WorkOrdersManager({ onBack }: WorkOrdersManagerProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: workOrders, isLoading } = useQuery<WorkOrder[]>({
    queryKey: ["/api/work-orders"],
  });

  const assignTechnician = useMutation({
    mutationFn: async ({ workOrderId, technicianId }: { workOrderId: number, technicianId: number }) => {
      return await apiRequest(`/api/work-orders/${workOrderId}/assign`, "POST", { technicianId });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Technician assigned successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to assign technician",
        variant: "destructive",
      });
    },
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'in_progress':
        return 'bg-blue-100 text-blue-800';
      case 'completed':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  if (showCreateForm) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="mb-6">
          <Button variant="outline" onClick={() => setShowCreateForm(false)}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Work Orders
          </Button>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Create New Work Order</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600">Work order creation form would go here...</p>
            <Button 
              className="mt-4" 
              onClick={() => {
                setShowCreateForm(false);
                toast({
                  title: "Demo",
                  description: "Work order creation form would be implemented here",
                });
              }}
            >
              Save Work Order
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
          <h1 className="text-3xl font-bold text-gray-900">Work Orders</h1>
        </div>
        <Button onClick={() => setShowCreateForm(true)} className="bg-green-600 hover:bg-green-700">
          <Plus className="w-4 h-4 mr-2" />
          New Work Order
        </Button>
      </div>

      {/* Work Orders List */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="text-center py-8">
            <p className="text-gray-500">Loading work orders...</p>
          </div>
        ) : workOrders?.length === 0 ? (
          <Card>
            <CardContent className="text-center py-8">
              <p className="text-gray-500 mb-4">No work orders found</p>
              <Button onClick={() => setShowCreateForm(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create First Work Order
              </Button>
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
                    <p className="text-gray-600 mb-1">Customer: {workOrder.customerName}</p>
                    <p className="text-gray-600 mb-1">Property: {workOrder.propertyAddress}</p>
                    <p className="text-sm text-gray-500">
                      Created: {new Date(workOrder.createdAt).toLocaleDateString()}
                    </p>
                    {workOrder.assignedTechnicianName && (
                      <p className="text-sm text-blue-600 mt-1">
                        Assigned to: {workOrder.assignedTechnicianName}
                      </p>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-lg font-semibold text-gray-900">
                        {workOrder.status === 'completed' ? 'Completed' : workOrder.priority.toUpperCase()}
                      </p>
                      <p className="text-sm text-gray-500">Priority</p>
                    </div>
                    
                    <div className="flex flex-col gap-2">
                      <Button variant="outline" size="sm">
                        <Eye className="w-4 h-4 mr-2" />
                        View Details
                      </Button>
                      
                      {workOrder.status === 'pending' && (
                        <Select onValueChange={(techId) => {
                          assignTechnician.mutate({ 
                            workOrderId: workOrder.id, 
                            technicianId: parseInt(techId) 
                          });
                        }}>
                          <SelectTrigger className="w-40">
                            <SelectValue placeholder="Assign Tech" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="3">Field Tech</SelectItem>
                            <SelectItem value="4">Tech 2</SelectItem>
                            <SelectItem value="5">Tech 3</SelectItem>
                          </SelectContent>
                        </Select>
                      )}

                      {workOrder.status === 'in_progress' && (
                        <Button 
                          size="sm" 
                          className="bg-green-600 hover:bg-green-700"
                          onClick={() => {
                            // Quick complete action
                            toast({
                              title: "Work Order Completed",
                              description: `Work Order #${workOrder.id} marked as completed`,
                            });
                          }}
                        >
                          <CheckCircle className="w-4 h-4 mr-2" />
                          Mark Complete
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}