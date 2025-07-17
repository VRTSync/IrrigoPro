import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { BillingSheet } from "./billing-sheet";
import { 
  FileText, 
  Calendar, 
  Clock, 
  User, 
  MapPin, 
  Phone, 
  Mail,
  CheckCircle,
  Play,
  Pause,
  AlertCircle,
  Edit,
  Receipt
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { WorkOrder } from "@shared/schema";

interface WorkOrderDetailsProps {
  workOrder: WorkOrder;
  onClose: () => void;
  onUpdate: () => void;
}

export function WorkOrderDetails({ workOrder, onClose, onUpdate }: WorkOrderDetailsProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const [showBillingSheet, setShowBillingSheet] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const updateWorkOrderStatus = useMutation({
    mutationFn: async (status: string) => {
      const updateData: any = { status };
      
      if (status === 'in_progress' && !workOrder.startedAt) {
        updateData.startedAt = new Date().toISOString();
      }
      
      if (status === 'completed' && !workOrder.completedAt) {
        updateData.completedAt = new Date().toISOString();
      }
      
      return apiRequest(`/api/work-orders/${workOrder.id}`, {
        method: 'PATCH',
        body: updateData,
      });
    },
    onSuccess: (data, status) => {
      toast({
        title: "Work Order Updated",
        description: `Work order status changed to ${status.replace('_', ' ')}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      onUpdate();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update work order",
        variant: "destructive",
      });
    },
  });

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
    if (!date) return "Not set";
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusActions = () => {
    const buttons = [];
    
    if (workOrder.status === 'pending') {
      buttons.push(
        <Button
          key="start"
          onClick={() => updateWorkOrderStatus.mutate('in_progress')}
          disabled={updateWorkOrderStatus.isPending}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          <Play className="w-4 h-4 mr-2" />
          Start Work
        </Button>
      );
    }
    
    if (workOrder.status === 'in_progress') {
      buttons.push(
        <Button
          key="complete"
          onClick={() => updateWorkOrderStatus.mutate('completed')}
          disabled={updateWorkOrderStatus.isPending}
          className="bg-green-600 hover:bg-green-700 text-white"
        >
          <CheckCircle className="w-4 h-4 mr-2" />
          Complete
        </Button>
      );
    }
    
    if (workOrder.status !== 'cancelled') {
      buttons.push(
        <Button
          key="cancel"
          onClick={() => updateWorkOrderStatus.mutate('cancelled')}
          disabled={updateWorkOrderStatus.isPending}
          variant="outline"
          className="text-red-600 hover:text-red-700"
        >
          <AlertCircle className="w-4 h-4 mr-2" />
          Cancel
        </Button>
      );
    }
    
    return buttons;
  };

  if (showBillingSheet) {
    return (
      <Dialog open={true} onOpenChange={onClose}>
        <DialogContent className="max-w-6xl max-h-[95vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Billing Sheet - {workOrder.workOrderNumber}</DialogTitle>
          </DialogHeader>
          <BillingSheet
            workOrder={workOrder}
            onSave={() => {
              setShowBillingSheet(false);
              onUpdate();
            }}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <div className="flex items-center">
              <FileText className="w-5 h-5 mr-2" />
              {workOrder.workOrderNumber}
            </div>
            <div className="flex items-center space-x-2">
              {getStatusBadge(workOrder.status)}
              {getPriorityBadge(workOrder.priority)}
              {getWorkTypeBadge(workOrder.workType)}
            </div>
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="billing">Billing</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {/* Status & Actions */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Status & Actions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div>
                      <div className="text-sm text-gray-500">Current Status</div>
                      <div className="font-medium">{getStatusBadge(workOrder.status)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Priority</div>
                      <div className="font-medium">{getPriorityBadge(workOrder.priority)}</div>
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    {getStatusActions()}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Customer & Project Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center">
                    <User className="w-5 h-5 mr-2" />
                    Customer Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <div className="text-sm text-gray-500">Name</div>
                    <div className="font-medium">{workOrder.customerName}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">Email</div>
                    <div className="font-medium flex items-center">
                      <Mail className="w-4 h-4 mr-2" />
                      {workOrder.customerEmail}
                    </div>
                  </div>
                  {workOrder.customerPhone && (
                    <div>
                      <div className="text-sm text-gray-500">Phone</div>
                      <div className="font-medium flex items-center">
                        <Phone className="w-4 h-4 mr-2" />
                        {workOrder.customerPhone}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center">
                    <MapPin className="w-5 h-5 mr-2" />
                    Project Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <div className="text-sm text-gray-500">Project Name</div>
                    <div className="font-medium">{workOrder.projectName}</div>
                  </div>
                  {workOrder.projectAddress && (
                    <div>
                      <div className="text-sm text-gray-500">Address</div>
                      <div className="font-medium">{workOrder.projectAddress}</div>
                    </div>
                  )}
                  <div>
                    <div className="text-sm text-gray-500">Work Type</div>
                    <div className="font-medium">{getWorkTypeBadge(workOrder.workType)}</div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Timeline */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center">
                  <Clock className="w-5 h-5 mr-2" />
                  Timeline
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <div className="text-sm text-gray-500">Created</div>
                    <div className="font-medium">{formatDate(workOrder.createdAt)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">Scheduled</div>
                    <div className="font-medium">{formatDate(workOrder.scheduledDate)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">Started</div>
                    <div className="font-medium">{formatDate(workOrder.startedAt)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">Completed</div>
                    <div className="font-medium">{formatDate(workOrder.completedAt)}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="details" className="space-y-6">
            {/* Work Description */}
            {workOrder.description && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Work Description</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-gray-700 whitespace-pre-wrap">{workOrder.description}</p>
                </CardContent>
              </Card>
            )}

            {/* Assignment */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center">
                  <User className="w-5 h-5 mr-2" />
                  Assignment
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div>
                  <div className="text-sm text-gray-500">Assigned Technician</div>
                  <div className="font-medium">
                    {workOrder.assignedTechnicianName || "Not assigned"}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Special Instructions */}
            {workOrder.specialInstructions && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Special Instructions</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-gray-700 whitespace-pre-wrap">{workOrder.specialInstructions}</p>
                </CardContent>
              </Card>
            )}

            {/* Notes */}
            {workOrder.notes && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-gray-700 whitespace-pre-wrap">{workOrder.notes}</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="billing" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center">
                  <Receipt className="w-5 h-5 mr-2" />
                  Billing Information
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8">
                  <Receipt className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">
                    Create Billing Sheet
                  </h3>
                  <p className="text-gray-600 mb-4">
                    Document materials used, labor hours, and work performed for this work order.
                  </p>
                  <Button 
                    onClick={() => setShowBillingSheet(true)}
                    className="bg-primary text-white hover:bg-blue-700"
                  >
                    <Receipt className="w-4 h-4 mr-2" />
                    Create Billing Sheet
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end space-x-4 pt-4">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}