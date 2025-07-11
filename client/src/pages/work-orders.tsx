import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  CheckCircle, 
  Clock, 
  FileText, 
  User, 
  Calendar, 
  MapPin, 
  Phone, 
  Mail,
  ArrowRight,
  DollarSign,
  ExternalLink
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";

interface WorkflowStep {
  id: string;
  title: string;
  description: string;
  status: "completed" | "current" | "pending";
  icon: React.ReactNode;
}

const workflowSteps: WorkflowStep[] = [
  {
    id: "estimate",
    title: "Estimate Created",
    description: "Initial estimate prepared and sent to customer",
    status: "completed",
    icon: <FileText className="w-5 h-5" />
  },
  {
    id: "approval",
    title: "Customer Approval",
    description: "Customer reviews and approves the estimate",
    status: "completed",
    icon: <CheckCircle className="w-5 h-5" />
  },
  {
    id: "work-order",
    title: "Work Order",
    description: "Approved estimate converted to work order",
    status: "current",
    icon: <User className="w-5 h-5" />
  },
  {
    id: "completion",
    title: "Work Completed",
    description: "Field work completed and documented",
    status: "pending",
    icon: <CheckCircle className="w-5 h-5" />
  },
  {
    id: "invoice",
    title: "Invoice Generated",
    description: "Invoice created from completed work order",
    status: "pending",
    icon: <DollarSign className="w-5 h-5" />
  },
  {
    id: "quickbooks",
    title: "QuickBooks Sync",
    description: "Invoice synchronized with QuickBooks Online",
    status: "pending",
    icon: <ExternalLink className="w-5 h-5" />
  }
];

export default function WorkOrders() {
  const [selectedTab, setSelectedTab] = useState("workflow");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch estimates for workflow demonstration
  const { data: estimates = [], isLoading: loadingEstimates } = useQuery({
    queryKey: ["/api/estimates"],
    enabled: true,
  });

  // Fetch work orders (placeholder for now)
  const { data: workOrders = [], isLoading: loadingWorkOrders } = useQuery({
    queryKey: ["/api/work-orders"],
    enabled: true,
  });

  // Fetch invoices (placeholder for now)  
  const { data: invoices = [], isLoading: loadingInvoices } = useQuery({
    queryKey: ["/api/invoices"],
    enabled: true,
  });

  // Approve estimate mutation
  const approveEstimateMutation = useMutation({
    mutationFn: async (estimateId: number) => {
      const response = await apiRequest("POST", `/api/estimates/${estimateId}/approve`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      toast({
        title: "Estimate Approved",
        description: "The estimate has been approved and is ready for work order creation."
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to approve estimate. Please try again.",
        variant: "destructive"
      });
    }
  });

  // Convert to work order mutation
  const convertToWorkOrderMutation = useMutation({
    mutationFn: async (estimateId: number) => {
      const response = await apiRequest("POST", `/api/estimates/${estimateId}/convert-to-work-order`, {
        assignedTechnicianName: "John Smith",
        scheduledDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Tomorrow
        notes: "Standard installation procedure"
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      toast({
        title: "Work Order Created",
        description: "The estimate has been converted to a work order."
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create work order. Please try again.",
        variant: "destructive"
      });
    }
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending": return "bg-yellow-100 text-yellow-800";
      case "approved": return "bg-green-100 text-green-800";
      case "rejected": return "bg-red-100 text-red-800";
      case "in_progress": return "bg-blue-100 text-blue-800";
      case "completed": return "bg-green-100 text-green-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  const getStepStatus = (step: WorkflowStep) => {
    switch (step.status) {
      case "completed":
        return "bg-green-500 text-white";
      case "current":
        return "bg-blue-500 text-white";
      case "pending":
        return "bg-gray-200 text-gray-500";
      default:
        return "bg-gray-200 text-gray-500";
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Work Orders & Workflow</h1>
        <Badge variant="outline" className="text-sm">
          Complete Business Process
        </Badge>
      </div>

      <Tabs value={selectedTab} onValueChange={setSelectedTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="workflow">Workflow Overview</TabsTrigger>
          <TabsTrigger value="estimates">Estimates</TabsTrigger>
          <TabsTrigger value="work-orders">Work Orders</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
        </TabsList>

        <TabsContent value="workflow" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ArrowRight className="w-5 h-5" />
                Complete Business Workflow
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <p className="text-muted-foreground mb-6">
                  This workflow demonstrates the complete business process from estimate creation to QuickBooks synchronization:
                </p>
                
                <div className="grid gap-4">
                  {workflowSteps.map((step, index) => (
                    <div key={step.id} className="flex items-start gap-4 p-4 rounded-lg border">
                      <div className={`p-2 rounded-full ${getStepStatus(step)}`}>
                        {step.icon}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold">{step.title}</h3>
                          <Badge variant="outline" className="text-xs">
                            Step {index + 1}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{step.description}</p>
                      </div>
                      <div className="flex items-center">
                        {step.status === "completed" && (
                          <CheckCircle className="w-5 h-5 text-green-500" />
                        )}
                        {step.status === "current" && (
                          <Clock className="w-5 h-5 text-blue-500" />
                        )}
                        {step.status === "pending" && (
                          <div className="w-5 h-5 rounded-full border-2 border-gray-300" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                  <h4 className="font-semibold text-blue-900 mb-2">Key Features:</h4>
                  <ul className="text-sm text-blue-800 space-y-1">
                    <li>• Zone-based estimates with detailed work descriptions</li>
                    <li>• Field tech interface without pricing access</li>
                    <li>• Automatic work order generation from approved estimates</li>
                    <li>• Invoice creation based on actual work completed</li>
                    <li>• QuickBooks Online integration for accounting sync</li>
                    <li>• Google Sheets integration for property and parts data</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="estimates" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Estimates Ready for Approval</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingEstimates ? (
                <div className="text-center py-8">Loading estimates...</div>
              ) : estimates.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No estimates found. Create an estimate to start the workflow.
                </div>
              ) : (
                <div className="space-y-4">
                  {estimates.map((estimate: any) => (
                    <div key={estimate.id} className="border rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-semibold">{estimate.projectName}</h3>
                          <p className="text-sm text-muted-foreground">{estimate.customerName}</p>
                          <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <MapPin className="w-4 h-4" />
                              {estimate.projectAddress}
                            </span>
                            <span className="flex items-center gap-1">
                              <DollarSign className="w-4 h-4" />
                              ${estimate.totalAmount}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <Badge className={getStatusColor(estimate.status)}>
                            {estimate.status}
                          </Badge>
                          {estimate.status === "pending" && (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={() => approveEstimateMutation.mutate(estimate.id)}
                                disabled={approveEstimateMutation.isPending}
                              >
                                Approve
                              </Button>
                            </div>
                          )}
                          {estimate.status === "approved" && (
                            <Button
                              size="sm"
                              onClick={() => convertToWorkOrderMutation.mutate(estimate.id)}
                              disabled={convertToWorkOrderMutation.isPending}
                            >
                              Create Work Order
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="work-orders" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Active Work Orders</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-muted-foreground">
                Work orders will appear here once estimates are approved and converted.
                <br />
                Complete the workflow by approving an estimate first.
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invoices" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Generated Invoices</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-muted-foreground">
                Invoices will be generated automatically when work orders are completed.
                <br />
                They can then be synchronized with QuickBooks Online.
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}