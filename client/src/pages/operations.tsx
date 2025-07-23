import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, FileText, Wrench, ClipboardList, Calendar, DollarSign, User, MapPin } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";

interface Estimate {
  id: number;
  estimateNumber: string;
  customerName: string;
  projectName: string;
  status: string;
  totalAmount: number;
  createdAt: string;
  propertyAddress?: string;
}

interface WorkOrder {
  id: number;
  workOrderNumber: string;
  customerName: string;
  projectName: string;
  status: string;
  assignedTechnicianName?: string;
  totalAmount: number;
  createdAt: string;
  propertyAddress?: string;
}

interface BillingSheet {
  id: number;
  billingSheetNumber: string;
  customerName: string;
  description: string;
  status: string;
  technicianName: string;
  totalAmount: number;
  createdAt: string;
  workDate: string;
}

export default function Operations() {
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const { data: estimates = [], isLoading: estimatesLoading } = useQuery<Estimate[]>({
    queryKey: ["/api/estimates"],
  });

  const { data: workOrders = [], isLoading: workOrdersLoading } = useQuery<WorkOrder[]>({
    queryKey: ["/api/work-orders"],
  });

  const { data: billingSheets = [], isLoading: billingSheetsLoading } = useQuery<BillingSheet[]>({
    queryKey: ["/api/billing-sheets"],
  });

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case "pending":
      case "draft":
        return "bg-yellow-100 text-yellow-800";
      case "approved":
      case "active":
        return "bg-green-100 text-green-800";
      case "rejected":
        return "bg-red-100 text-red-800";
      case "completed":
        return "bg-blue-100 text-blue-800";
      case "in_progress":
        return "bg-orange-100 text-orange-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  const CreateWorkModal = () => (
    <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Work Item</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <Link href="/estimates?create=true">
            <Button 
              className="w-full h-16 flex flex-col items-center justify-center space-y-2"
              onClick={() => setCreateModalOpen(false)}
            >
              <FileText className="h-6 w-6" />
              <span>Create Estimate</span>
            </Button>
          </Link>
          <Link href="/work-orders?create=true">
            <Button
              className="w-full h-16 flex flex-col items-center justify-center space-y-2"
              variant="outline"
              onClick={() => setCreateModalOpen(false)}
            >
              <Wrench className="h-6 w-6" />
              <span>Create Work Order</span>
            </Button>
          </Link>
          <Link href="/billing-sheets?create=true">
            <Button
              className="w-full h-16 flex flex-col items-center justify-center space-y-2"
              variant="outline"
              onClick={() => setCreateModalOpen(false)}
            >
              <ClipboardList className="h-6 w-6" />
              <span>Create Billing Sheet</span>
            </Button>
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );

  if (estimatesLoading || workOrdersLoading || billingSheetsLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const allItems = [
    ...estimates.map(item => ({ ...item, type: 'estimate' as const })),
    ...workOrders.map(item => ({ ...item, type: 'workorder' as const })),
    ...billingSheets.map(item => ({ ...item, type: 'billingsheet' as const }))
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Operations</h1>
          <p className="text-gray-600 mt-1">Manage all estimates, work orders, and billing sheets</p>
        </div>
        <CreateWorkModal />
        <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
          <DialogTrigger asChild>
            <Button className="mt-4 sm:mt-0">
              <Plus className="h-4 w-4 mr-2" />
              Create New
            </Button>
          </DialogTrigger>
        </Dialog>
      </div>

      <Tabs defaultValue="all" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="all">All ({allItems.length})</TabsTrigger>
          <TabsTrigger value="estimates">Estimates ({estimates.length})</TabsTrigger>
          <TabsTrigger value="workorders">Work Orders ({workOrders.length})</TabsTrigger>
          <TabsTrigger value="billingsheets">Billing Sheets ({billingSheets.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-4">
          {allItems.length === 0 ? (
            <Card className="p-8 text-center">
              <div className="text-gray-500">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No work items found</p>
                <p className="text-sm mt-2">Create your first estimate, work order, or billing sheet to get started.</p>
              </div>
            </Card>
          ) : (
            <div className="space-y-4">
              {allItems.map((item) => (
                <Card key={`${item.type}-${item.id}`} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between space-y-4 lg:space-y-0">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3 mb-2">
                          {item.type === 'estimate' && <FileText className="h-5 w-5 text-blue-600" />}
                          {item.type === 'workorder' && <Wrench className="h-5 w-5 text-green-600" />}
                          {item.type === 'billingsheet' && <ClipboardList className="h-5 w-5 text-purple-600" />}
                          <h3 className="font-semibold text-lg">
                            {item.type === 'estimate' && (item as any).estimateNumber}
                            {item.type === 'workorder' && (item as any).workOrderNumber}
                            {item.type === 'billingsheet' && (item as any).billingSheetNumber}
                          </h3>
                          <Badge className={getStatusColor(item.status)}>
                            {item.status.replace('_', ' ')}
                          </Badge>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm text-gray-600">
                          <div className="flex items-center space-x-2">
                            <User className="h-4 w-4" />
                            <span>{item.customerName}</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Calendar className="h-4 w-4" />
                            <span>{format(new Date(item.createdAt), "MMM d, yyyy")}</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <DollarSign className="h-4 w-4" />
                            <span>{formatCurrency(item.totalAmount)}</span>
                          </div>
                          {(item.type === 'estimate' || item.type === 'workorder') && (item as any).propertyAddress && (
                            <div className="flex items-center space-x-2">
                              <MapPin className="h-4 w-4" />
                              <span className="truncate">{(item as any).propertyAddress}</span>
                            </div>
                          )}
                          {item.type === 'workorder' && (item as any).assignedTechnicianName && (
                            <div className="flex items-center space-x-2">
                              <User className="h-4 w-4" />
                              <span>Tech: {(item as any).assignedTechnicianName}</span>
                            </div>
                          )}
                          {item.type === 'billingsheet' && (
                            <div className="flex items-center space-x-2">
                              <User className="h-4 w-4" />
                              <span>Tech: {(item as any).technicianName}</span>
                            </div>
                          )}
                        </div>
                        
                        <p className="text-gray-700 mt-2 font-medium">
                          {item.type === 'estimate' && (item as any).projectName}
                          {item.type === 'workorder' && (item as any).projectName}
                          {item.type === 'billingsheet' && (item as any).description}
                        </p>
                      </div>
                      
                      <div className="flex space-x-2">
                        <Link 
                          href={
                            item.type === 'estimate' ? '/estimates' :
                            item.type === 'workorder' ? '/work-orders' :
                            '/billing-sheets'
                          }
                        >
                          <Button variant="outline" size="sm">
                            View Details
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="estimates" className="space-y-4">
          {estimates.length === 0 ? (
            <Card className="p-8 text-center">
              <div className="text-gray-500">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No estimates found</p>
              </div>
            </Card>
          ) : (
            <div className="space-y-4">
              {estimates.map((estimate) => (
                <Card key={estimate.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between space-y-4 lg:space-y-0">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3 mb-2">
                          <FileText className="h-5 w-5 text-blue-600" />
                          <h3 className="font-semibold text-lg">{estimate.estimateNumber}</h3>
                          <Badge className={getStatusColor(estimate.status)}>
                            {estimate.status.replace('_', ' ')}
                          </Badge>
                        </div>
                        <p className="text-gray-700 font-medium mb-2">{estimate.projectName}</p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-600">
                          <div className="flex items-center space-x-2">
                            <User className="h-4 w-4" />
                            <span>{estimate.customerName}</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Calendar className="h-4 w-4" />
                            <span>{format(new Date(estimate.createdAt), "MMM d, yyyy")}</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <DollarSign className="h-4 w-4" />
                            <span>{formatCurrency(estimate.totalAmount)}</span>
                          </div>
                        </div>
                      </div>
                      <Link href="/estimates">
                        <Button variant="outline" size="sm">
                          View Details
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="workorders" className="space-y-4">
          {workOrders.length === 0 ? (
            <Card className="p-8 text-center">
              <div className="text-gray-500">
                <Wrench className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No work orders found</p>
              </div>
            </Card>
          ) : (
            <div className="space-y-4">
              {workOrders.map((workOrder) => (
                <Card key={workOrder.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between space-y-4 lg:space-y-0">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3 mb-2">
                          <Wrench className="h-5 w-5 text-green-600" />
                          <h3 className="font-semibold text-lg">{workOrder.workOrderNumber}</h3>
                          <Badge className={getStatusColor(workOrder.status)}>
                            {workOrder.status.replace('_', ' ')}
                          </Badge>
                        </div>
                        <p className="text-gray-700 font-medium mb-2">{workOrder.projectName}</p>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm text-gray-600">
                          <div className="flex items-center space-x-2">
                            <User className="h-4 w-4" />
                            <span>{workOrder.customerName}</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Calendar className="h-4 w-4" />
                            <span>{format(new Date(workOrder.createdAt), "MMM d, yyyy")}</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <DollarSign className="h-4 w-4" />
                            <span>{formatCurrency(workOrder.totalAmount)}</span>
                          </div>
                          {workOrder.assignedTechnicianName && (
                            <div className="flex items-center space-x-2">
                              <User className="h-4 w-4" />
                              <span>Tech: {workOrder.assignedTechnicianName}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <Link href="/work-orders">
                        <Button variant="outline" size="sm">
                          View Details
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="billingsheets" className="space-y-4">
          {billingSheets.length === 0 ? (
            <Card className="p-8 text-center">
              <div className="text-gray-500">
                <ClipboardList className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No billing sheets found</p>
              </div>
            </Card>
          ) : (
            <div className="space-y-4">
              {billingSheets.map((billingSheet) => (
                <Card key={billingSheet.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between space-y-4 lg:space-y-0">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3 mb-2">
                          <ClipboardList className="h-5 w-5 text-purple-600" />
                          <h3 className="font-semibold text-lg">{billingSheet.billingSheetNumber}</h3>
                          <Badge className={getStatusColor(billingSheet.status)}>
                            {billingSheet.status.replace('_', ' ')}
                          </Badge>
                        </div>
                        <p className="text-gray-700 font-medium mb-2">{billingSheet.description}</p>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm text-gray-600">
                          <div className="flex items-center space-x-2">
                            <User className="h-4 w-4" />
                            <span>{billingSheet.customerName}</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Calendar className="h-4 w-4" />
                            <span>{format(new Date(billingSheet.workDate), "MMM d, yyyy")}</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <DollarSign className="h-4 w-4" />
                            <span>{formatCurrency(billingSheet.totalAmount)}</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <User className="h-4 w-4" />
                            <span>Tech: {billingSheet.technicianName}</span>
                          </div>
                        </div>
                      </div>
                      <Link href="/billing-sheets">
                        <Button variant="outline" size="sm">
                          View Details
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}