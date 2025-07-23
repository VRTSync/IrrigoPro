import { useState } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

import { WorkOrderCompletion } from "./work-order-completion";
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
  Receipt,
  Building,
  Hash,
  Target,
  Timer,
  MessageSquare,
  Users,
  Download,
  ArrowRight
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { WorkOrder, User as UserType } from "@shared/schema";

interface WorkOrderDetailsProps {
  workOrder: WorkOrder;
  onClose: () => void;
  onUpdate: () => void;
  showAddDetailsButton?: boolean;
}

export function WorkOrderDetails({ workOrder, onClose, onUpdate, showAddDetailsButton = false }: WorkOrderDetailsProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const [showCompletionForm, setShowCompletionForm] = useState(false);
  const [selectedTechnicianId, setSelectedTechnicianId] = useState<string>("");
  const [isEditingPriority, setIsEditingPriority] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get field technicians for reassignment
  const { data: fieldTechs } = useQuery<UserType[]>({
    queryKey: ["/api/users"],
    select: (users) => users?.filter(user => user.role === 'field_tech') || [],
  });

  const updatePriority = useMutation({
    mutationFn: async (priority: string) => {
      return apiRequest(`/api/work-orders/${workOrder.id}`, "PATCH", { priority });
    },
    onSuccess: () => {
      toast({
        title: "Priority Updated",
        description: "Work order priority has been updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      setIsEditingPriority(false);
      onUpdate();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update priority",
        variant: "destructive",
      });
    },
  });

  const reassignWorkOrder = useMutation({
    mutationFn: async (technicianId: string) => {
      const selectedTech = fieldTechs?.find(tech => tech.id.toString() === technicianId);
      if (!selectedTech) throw new Error("Technician not found");
      
      return apiRequest(`/api/work-orders/${workOrder.id}/assign`, "POST", {
        technicianId: selectedTech.id,
        technicianName: selectedTech.name,
      });
    },
    onSuccess: () => {
      toast({
        title: "Work Order Reassigned",
        description: "Work order has been successfully reassigned to field technician",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      setSelectedTechnicianId("");
      onUpdate();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to reassign work order",
        variant: "destructive",
      });
    },
  });

  const handleCreateInvoice = async () => {
    try {
      await apiRequest(`/api/work-orders/${workOrder.id}/create-invoice`, "POST");
      toast({
        title: "Success",
        description: "Invoice created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to create invoice",
        variant: "destructive",
      });
    }
  };

  const handleSyncToQuickBooks = async () => {
    try {
      await apiRequest(`/api/work-orders/${workOrder.id}/sync-quickbooks`, "POST");
      toast({
        title: "Success",
        description: "Synced to QuickBooks successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to sync to QuickBooks",
        variant: "destructive",
      });
    }
  };

  const updateWorkOrderStatus = useMutation({
    mutationFn: async (status: string) => {
      const updateData: any = { status };
      
      return apiRequest(`/api/work-orders/${workOrder.id}`, "PATCH", updateData);
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

  const getPriorityBadge = (priority: string, showLabel: boolean = false) => {
    const priorityMap = {
      'urgent': { bg: 'bg-red-100 text-red-800 border-red-200', label: 'Emergency' },
      'high': { bg: 'bg-orange-100 text-orange-800 border-orange-200', label: 'High Priority' },
      'medium': { bg: 'bg-yellow-100 text-yellow-800 border-yellow-200', label: 'Standard' },
      'low': { bg: 'bg-green-100 text-green-800 border-green-200', label: 'Low Priority' }
    };
    
    const config = priorityMap[priority as keyof typeof priorityMap];
    if (!config) return <Badge variant="outline">{priority}</Badge>;
    
    const label = showLabel ? config.label : priority.charAt(0).toUpperCase() + priority.slice(1);
    return <Badge className={config.bg}>{label}</Badge>;
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
    
    // Complete button moved to bottom - not included here
    
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

  return (
    <>
      <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="w-[95vw] max-w-4xl h-[95vh] max-h-[95vh] overflow-hidden p-0 flex flex-col">
        <DialogHeader className="p-4 sm:p-6 border-b border-gray-200 flex-shrink-0">
          <DialogTitle className="flex items-center space-x-2 text-lg sm:text-xl">
            <FileText className="w-5 h-5" />
            <span>Work Order Details</span>
          </DialogTitle>
        </DialogHeader>

        {/* Status Banner - Only for Completed */}
        {workOrder.status === 'completed' && (
          <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white p-4 sm:p-6 flex-shrink-0 border-b">
            <div className="flex items-center justify-center space-x-3">
              <CheckCircle className="w-8 h-8 flex-shrink-0" />
              <div className="text-center">
                <h3 className="text-xl sm:text-2xl font-bold">✅ WORK COMPLETED</h3>
                <p className="text-green-100 text-sm sm:text-base mt-1">
                  Work order finished • Ready for invoicing
                </p>
              </div>
              <CheckCircle className="w-8 h-8 flex-shrink-0" />
            </div>
          </div>
        )}

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="progress">Progress</TabsTrigger>
            <TabsTrigger value="invoicing" className="flex items-center gap-2">
              <Receipt className="w-4 h-4" />
              Invoicing
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6 mt-6">
            {/* Header Status Bar */}
            <div className="flex items-center justify-between bg-gray-50 p-4 rounded-lg">
              <div className="flex items-center gap-3">
                {getStatusBadge(workOrder.status)}
                <div className="flex items-center gap-2">
                  {!isEditingPriority ? (
                    <>
                      {getPriorityBadge(workOrder.priority, true)}
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => setIsEditingPriority(true)}
                        className="h-6 px-2 text-xs"
                      >
                        <Edit className="w-3 h-3" />
                      </Button>
                    </>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Select 
                        value={workOrder.priority} 
                        onValueChange={(priority) => updatePriority.mutate(priority)}
                      >
                        <SelectTrigger className="h-6 w-32 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low Priority</SelectItem>
                          <SelectItem value="medium">Standard</SelectItem>
                          <SelectItem value="high">High Priority</SelectItem>
                          <SelectItem value="urgent">Emergency</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => setIsEditingPriority(false)}
                        className="h-6 px-2 text-xs"
                      >
                        ✕
                      </Button>
                    </div>
                  )}
                </div>
                {workOrder.estimateId && (
                  <Badge className="bg-green-100 text-green-800 border-green-200">
                    From EST-{workOrder.estimateId}
                  </Badge>
                )}
              </div>
              <div className="flex gap-2">
                {getStatusActions()}
              </div>
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Work Order Information */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center space-x-2">
                    <FileText className="w-5 h-5" />
                    <span>Work Order Information</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <span className="font-medium text-gray-700">Work Order Number:</span>
                    <p className="text-lg font-semibold text-gray-900">{workOrder.workOrderNumber}</p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Project Name:</span>
                    <p className="text-gray-900">{workOrder.projectName}</p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Status:</span>
                    <div className="mt-1">
                      {getStatusBadge(workOrder.status)}
                    </div>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Priority:</span>
                    <div className="mt-1">
                      {getPriorityBadge(workOrder.priority, true)}
                    </div>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Scheduled Date:</span>
                    <p className="text-gray-900">{formatDate(workOrder.scheduledDate)}</p>
                  </div>
                </CardContent>
              </Card>

              {/* Customer Information */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center space-x-2">
                    <Users className="w-5 h-5" />
                    <span>Customer Information</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <span className="font-medium text-gray-700">Customer Name:</span>
                    <p className="text-gray-900">{workOrder.customerName}</p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Email:</span>
                    <p className="text-gray-900">{workOrder.customerEmail}</p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Phone:</span>
                    <p className="text-gray-900">{workOrder.customerPhone || 'Not provided'}</p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Project Address:</span>
                    <p className="text-gray-900">{workOrder.projectAddress || 'Not provided'}</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Assignment and Progress Details */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Assignment & Progress Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <div className="flex items-center space-x-2">
                      <User className="w-5 h-5 text-blue-600" />
                      <span className="font-medium text-blue-900">Assigned Technician</span>
                    </div>
                    <p className="text-lg font-bold text-blue-900 mt-1">
                      {workOrder.assignedTechnicianName || 'Unassigned'}
                    </p>
                  </div>
                  
                  <div className="bg-green-50 p-4 rounded-lg">
                    <div className="flex items-center space-x-2">
                      <Calendar className="w-5 h-5 text-green-600" />
                      <span className="font-medium text-green-900">Started</span>
                    </div>
                    <p className="text-lg font-bold text-green-900 mt-1">
                      {workOrder.startedAt ? formatDate(workOrder.startedAt) : 'Not started'}
                    </p>
                  </div>

                  <div className="bg-purple-50 p-4 rounded-lg">
                    <div className="flex items-center space-x-2">
                      <CheckCircle className="w-5 h-5 text-purple-600" />
                      <span className="font-medium text-purple-900">Completed</span>
                    </div>
                    <p className="text-lg font-bold text-purple-900 mt-1">
                      {workOrder.completedAt ? formatDate(workOrder.completedAt) : 'In progress'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Timeline */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Timer className="w-5 h-5 text-blue-600" />
                  Timeline
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                    <div>
                      <p className="font-medium text-gray-900">Work Order Created</p>
                      <p className="text-sm text-gray-600">{formatDate(workOrder.createdAt)}</p>
                    </div>
                  </div>
                  
                  {workOrder.startedAt && (
                    <div className="flex items-center gap-4">
                      <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                      <div>
                        <p className="font-medium text-gray-900">Work Started</p>
                        <p className="text-sm text-gray-600">{formatDate(workOrder.startedAt)}</p>
                      </div>
                    </div>
                  )}
                  
                  {workOrder.completedAt && (
                    <div className="flex items-center gap-4">
                      <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                      <div>
                        <p className="font-medium text-gray-900">Work Completed</p>
                        <p className="text-sm text-gray-600">{formatDate(workOrder.completedAt)}</p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Reassignment Section - Only show for managers when work order is assigned to them */}
            {workOrder.assignedTechnicianName === "Manager" && fieldTechs && fieldTechs.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Users className="w-5 h-5 text-blue-600" />
                    Assign to Field Technician
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-gray-600">
                    This work order is currently assigned to you as the manager. Select a field technician to hand it off for field work.
                  </p>
                  <div className="flex gap-3">
                    <Select 
                      value={selectedTechnicianId} 
                      onValueChange={setSelectedTechnicianId}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Choose field technician..." />
                      </SelectTrigger>
                      <SelectContent>
                        {fieldTechs.map((tech) => (
                          <SelectItem key={tech.id} value={tech.id.toString()}>
                            {tech.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button 
                      onClick={() => {
                        if (selectedTechnicianId) {
                          reassignWorkOrder.mutate(selectedTechnicianId);
                        }
                      }}
                      disabled={!selectedTechnicianId || reassignWorkOrder.isPending}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      {reassignWorkOrder.isPending ? "Assigning..." : "Assign"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Notes and Instructions */}
            {(workOrder.description || workOrder.specialInstructions || workOrder.notes) && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-blue-600" />
                    Notes & Instructions
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {workOrder.description && (
                    <div>
                      <h4 className="font-medium text-gray-900 mb-2">Description</h4>
                      <p className="text-gray-700 bg-gray-50 p-3 rounded-lg">{workOrder.description}</p>
                    </div>
                  )}
                  
                  {workOrder.specialInstructions && (
                    <div>
                      <h4 className="font-medium text-gray-900 mb-2">Special Instructions</h4>
                      <p className="text-gray-700 bg-yellow-50 p-3 rounded-lg border border-yellow-200">{workOrder.specialInstructions}</p>
                    </div>
                  )}
                  
                  {workOrder.notes && (
                    <div>
                      <h4 className="font-medium text-gray-900 mb-2">Notes</h4>
                      <p className="text-gray-700 bg-blue-50 p-3 rounded-lg border border-blue-200">{workOrder.notes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="progress" className="space-y-6 mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-blue-600" />
                  Work Progress
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">Progress tracking features will be implemented here.</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="invoicing" className="space-y-6 mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Receipt className="w-5 h-5 text-blue-600" />
                  Invoice Generation
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {workOrder.status === 'completed' ? (
                    <div className="flex gap-4">
                      <Button
                        onClick={() => handleCreateInvoice()}
                        className="bg-green-600 hover:bg-green-700 text-white"
                      >
                        <Receipt className="w-4 h-4 mr-2" />
                        Create Invoice
                      </Button>
                      <Button
                        onClick={() => handleSyncToQuickBooks()}
                        className="bg-blue-600 hover:bg-blue-700 text-white"
                        variant="outline"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Sync to QuickBooks
                      </Button>
                    </div>
                  ) : (
                    <div className="text-gray-500">
                      <p>Work order must be completed before creating an invoice.</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Action Buttons - Bottom Section */}
        {showAddDetailsButton && (workOrder.status === 'pending' || workOrder.status === 'assigned') && (
          <div className="border-t border-gray-200 p-4 sm:p-6 bg-gray-50">
            <div className="flex justify-center">
              <Button
                onClick={() => {
                  // Just close the modal - user can manually start work later
                  onClose();
                }}
                className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 text-lg font-semibold"
                size="lg"
              >
                <ArrowRight className="w-5 h-5 mr-2" />
                Add Details
                <span className="ml-2 text-sm opacity-80">Next Step</span>
              </Button>
            </div>
          </div>
        )}
        
        {workOrder.status === 'in_progress' && (
          <div className="border-t border-gray-200 p-4 sm:p-6 bg-gray-50">
            <div className="flex justify-center">
              <Button
                onClick={() => setShowCompletionForm(true)}
                className="bg-green-600 hover:bg-green-700 text-white px-8 py-3 text-lg font-semibold"
                size="lg"
              >
                <CheckCircle className="w-5 h-5 mr-2" />
                Complete Work Order
              </Button>
            </div>
          </div>
        )}
        </div>
      </DialogContent>
    </Dialog>

    {/* Work Order Completion Modal */}
    {showCompletionForm && (
      <WorkOrderCompletion
        workOrder={workOrder}
        open={showCompletionForm}
        onClose={() => setShowCompletionForm(false)}
        onComplete={onUpdate}
      />
    )}
    </>
  );
}