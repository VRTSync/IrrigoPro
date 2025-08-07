import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { 
  Search, 
  FileText, 
  DollarSign, 
  Calendar,
  User,
  Phone,
  Mail,
  MapPin,
  Download,
  Receipt,
  CheckCircle,
  Clock,
  AlertTriangle,
  ChevronDown
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Customer, WorkOrder, BillingSheet, Estimate } from "@shared/schema";

interface CustomerBillingData {
  customer: Customer;
  workOrders: WorkOrder[];
  billingSheets: BillingSheet[];
  estimates: Estimate[];
  unbilledWorkOrders: WorkOrder[];
  unbilledBillingSheets: BillingSheet[];
  totalUnbilledAmount: number;
}

export default function CustomerBilling() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get all customers
  const { data: customers = [], isLoading: loadingCustomers } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  // Get detailed billing data for selected customer
  const { data: customerBillingData, isLoading: loadingCustomerData } = useQuery<CustomerBillingData>({
    queryKey: ["/api/customers", selectedCustomerId, "billing"],
    enabled: !!selectedCustomerId,
  });

  // Create monthly invoice mutation
  const createMonthlyInvoice = useMutation({
    mutationFn: async (customerId: number) => {
      return apiRequest("/api/invoices/monthly", "POST", { customerId });
    },
    onSuccess: (data) => {
      toast({
        title: "Monthly Invoice Created",
        description: `Invoice ${data.invoiceNumber} created successfully for ${data.totalAmount}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/customers", selectedCustomerId, "billing"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error Creating Invoice",
        description: error.message || "Failed to create monthly invoice",
        variant: "destructive",
      });
    },
  });

  const filteredCustomers = customers.filter(customer =>
    customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

  const formatCurrency = (amount: string | number) => {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(num);
  };

  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString();
  };

  const getStatusBadge = (status: string) => {
    const statusColors: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-800",
      assigned: "bg-blue-100 text-blue-800",
      in_progress: "bg-purple-100 text-purple-800",
      completed: "bg-green-100 text-green-800",
      draft: "bg-gray-100 text-gray-800",
      submitted: "bg-blue-100 text-blue-800",
      approved: "bg-green-100 text-green-800",
      billed: "bg-emerald-100 text-emerald-800"
    };
    
    return (
      <Badge className={statusColors[status] || "bg-gray-100 text-gray-800"}>
        {status.replace('_', ' ')}
      </Badge>
    );
  };

  return (
    <div className="w-full">
      {/* Page Header */}
      <div className="w-full bg-white border-b shadow-sm">
        <div className="container mx-auto p-4">
          <h1 className="text-2xl font-bold text-gray-900">Customer Billing</h1>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="container mx-auto p-4 space-y-4">
        {/* Full Width Customer Selector */}
        <Card className="w-full">
          <CardContent className="p-6">
            <div className="flex items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                <h2 className="text-lg font-semibold text-gray-900">Customer Selection</h2>
                <Dialog open={showCustomerModal} onOpenChange={setShowCustomerModal}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="lg" className="flex items-center gap-2 min-w-[250px] h-12">
                      <User className="w-5 h-5" />
                      {selectedCustomer ? selectedCustomer.name : "Select Customer"}
                      <ChevronDown className="w-4 h-4" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[80vh]">
                    <DialogHeader>
                      <DialogTitle className="text-xl">Select Customer</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-6">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                        <Input
                          placeholder="Search customers by name, email, or phone..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="pl-12 h-12 text-base"
                        />
                      </div>
                      <div className="max-h-96 overflow-y-auto space-y-3">
                        {loadingCustomers ? (
                          <div className="text-center text-gray-500 py-8">Loading customers...</div>
                        ) : (
                          filteredCustomers.map((customer) => (
                            <div
                              key={customer.id}
                              onClick={() => {
                                setSelectedCustomerId(customer.id);
                                setShowCustomerModal(false);
                                setSearchTerm("");
                              }}
                              className={`p-4 rounded-lg border-2 cursor-pointer transition-all hover:bg-gray-50 hover:border-blue-300 ${
                                selectedCustomerId === customer.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                              }`}
                            >
                              <div className="font-semibold text-base text-gray-900 mb-2">{customer.name}</div>
                              <div className="space-y-1">
                                <div className="text-sm text-gray-600 flex items-center gap-2">
                                  <Mail className="w-4 h-4" />
                                  {customer.email}
                                </div>
                                {customer.phone && (
                                  <div className="text-sm text-gray-600 flex items-center gap-2">
                                    <Phone className="w-4 h-4" />
                                    {customer.phone}
                                  </div>
                                )}
                                {customer.address && (
                                  <div className="text-sm text-gray-500 flex items-center gap-2">
                                    <MapPin className="w-4 h-4" />
                                    {customer.address}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
              {selectedCustomer && (
                <div className="text-base text-gray-600">
                  Managing billing for <span className="font-semibold text-gray-900">{selectedCustomer.name}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {selectedCustomerId ? (
          loadingCustomerData ? (
            <Card>
              <CardContent className="p-8 text-center">
                <div className="text-gray-500">Loading customer billing data...</div>
              </CardContent>
            </Card>
          ) : customerBillingData ? (
            <div className="space-y-3">
              {/* Customer Header - Compact */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <CardTitle className="text-lg">{customerBillingData.customer.name}</CardTitle>
                      <div className="space-y-1 text-xs text-gray-600">
                        <div className="flex items-center gap-2">
                          <Mail className="w-3 h-3" />
                          {customerBillingData.customer.email}
                        </div>
                        {customerBillingData.customer.phone && (
                          <div className="flex items-center gap-2">
                            <Phone className="w-3 h-3" />
                            {customerBillingData.customer.phone}
                          </div>
                        )}
                        {customerBillingData.customer.address && (
                          <div className="flex items-center gap-2">
                            <MapPin className="w-3 h-3" />
                            {customerBillingData.customer.address}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </CardHeader>
              </Card>

              {/* Billing Summary Card - Compact */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                {/* Unbilled Work Summary - Compact */}
                <Card className="border-orange-200 bg-orange-50">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-1 text-orange-800 text-xs">
                        <AlertTriangle className="w-3 h-3" />
                        Unbilled Work
                      </CardTitle>
                      <Badge className="bg-orange-100 text-orange-800 text-xs">
                        {formatCurrency(customerBillingData.totalUnbilledAmount)}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="space-y-2">
                      <div className="text-xs text-orange-700">
                        {customerBillingData.unbilledWorkOrders.length} WO, {customerBillingData.unbilledBillingSheets.length} BS ready
                      </div>
                      <Button
                        onClick={() => createMonthlyInvoice.mutate(selectedCustomerId)}
                        disabled={createMonthlyInvoice.isPending || customerBillingData.totalUnbilledAmount === 0}
                        className="bg-orange-600 hover:bg-orange-700 text-white w-full h-7 text-xs"
                      >
                        <Receipt className="w-3 h-3 mr-1" />
                        {createMonthlyInvoice.isPending ? "Creating..." : "Create Invoice"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Quick Stats - Compact */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-gray-700">Total Work</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-600">Work Orders:</span>
                        <span className="font-medium">{customerBillingData.workOrders.length}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-600">Billing Sheets:</span>
                        <span className="font-medium">{customerBillingData.billingSheets.length}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-600">Estimates:</span>
                        <span className="font-medium">{customerBillingData.estimates.length}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Total Revenue - Compact */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-gray-700">Revenue Overview</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-600">Completed Work:</span>
                        <span className="font-medium">
                          {formatCurrency(
                            customerBillingData.workOrders
                              .filter(wo => wo.status === 'completed')
                              .reduce((sum, wo) => sum + parseFloat(wo.totalAmount || '0'), 0) +
                            customerBillingData.billingSheets
                              .reduce((sum, bs) => sum + parseFloat(bs.totalAmount || '0'), 0)
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between text-xs text-orange-600">
                        <span>Unbilled:</span>
                        <span className="font-medium">
                          {formatCurrency(customerBillingData.totalUnbilledAmount)}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Work Details Tabs - Compact */}
              <Tabs defaultValue="work-orders" className="w-full">
                <TabsList className="grid w-full grid-cols-3 h-8">
                  <TabsTrigger value="work-orders" className="text-xs">
                    Work Orders ({customerBillingData.workOrders.length})
                  </TabsTrigger>
                  <TabsTrigger value="billing-sheets" className="text-xs">
                    Billing Sheets ({customerBillingData.billingSheets.length})
                  </TabsTrigger>
                  <TabsTrigger value="estimates" className="text-xs">
                    Estimates ({customerBillingData.estimates.length})
                  </TabsTrigger>
                </TabsList>

                {/* Work Orders Tab */}
                <TabsContent value="work-orders" className="space-y-2 mt-2">
                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <FileText className="w-4 h-4" />
                          Work Orders
                        </CardTitle>
                        <div className="text-xs text-gray-600">
                          {customerBillingData.workOrders.filter(wo => wo.status === 'completed').length} completed
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      {customerBillingData.workOrders.length === 0 ? (
                        <div className="text-center text-gray-500 py-6 text-sm">No work orders found</div>
                      ) : (
                        <div className="space-y-1 max-h-96 overflow-y-auto">
                          {customerBillingData.workOrders.map((workOrder) => (
                            <div key={workOrder.id} className={`border rounded-md p-2 transition-all ${
                              workOrder.status === 'completed' && parseFloat(workOrder.totalAmount || '0') > 0
                                ? 'border-orange-200 bg-orange-50' 
                                : 'border-gray-200'
                            }`}>
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-medium text-xs truncate">{workOrder.workOrderNumber}</span>
                                    {getStatusBadge(workOrder.status)}
                                    {workOrder.status === 'completed' && parseFloat(workOrder.totalAmount || '0') > 0 && (
                                      <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-800 px-1 py-0">
                                        Ready
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="text-xs text-gray-600 truncate">{workOrder.projectName}</div>
                                  <div className="text-xs text-gray-500 truncate">
                                    {workOrder.assignedTechnicianName || "Unassigned"} • {formatDate(workOrder.createdAt)}
                                  </div>
                                </div>
                                <div className="text-right">
                                  <Badge variant="outline" className={`text-xs ${
                                    parseFloat(workOrder.totalAmount || '0') === 0 
                                      ? 'border-red-200 text-red-600 bg-red-50' 
                                      : 'border-gray-200'
                                  }`}>
                                    {formatCurrency(workOrder.totalAmount || '0')}
                                    {parseFloat(workOrder.totalAmount || '0') === 0 && (
                                      <span className="ml-1 text-red-500">⚠</span>
                                    )}
                                  </Badge>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Billing Sheets Tab */}
                <TabsContent value="billing-sheets" className="space-y-2 mt-2">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <Receipt className="w-4 h-4" />
                        Billing Sheets
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      {customerBillingData.billingSheets.length === 0 ? (
                        <div className="text-center text-gray-500 py-6 text-sm">No billing sheets found</div>
                      ) : (
                        <div className="space-y-1 max-h-96 overflow-y-auto">
                          {customerBillingData.billingSheets.map((billingSheet) => (
                            <div key={billingSheet.id} className="border rounded-md p-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-medium text-xs truncate">{billingSheet.billingNumber}</span>
                                    {getStatusBadge(billingSheet.status)}
                                  </div>
                                  <div className="text-xs text-gray-600 truncate">{billingSheet.workDescription}</div>
                                  <div className="text-xs text-gray-500 truncate">
                                    {billingSheet.technicianName} • {formatDate(billingSheet.workDate)}
                                  </div>
                                </div>
                                <div className="text-right">
                                  <Badge variant="outline" className="text-xs">
                                    {formatCurrency(billingSheet.totalAmount)}
                                  </Badge>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Estimates Tab */}
                <TabsContent value="estimates" className="space-y-2 mt-2">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <DollarSign className="w-4 h-4" />
                        Estimates
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      {customerBillingData.estimates.length === 0 ? (
                        <div className="text-center text-gray-500 py-6 text-sm">No estimates found</div>
                      ) : (
                        <div className="space-y-1 max-h-96 overflow-y-auto">
                          {customerBillingData.estimates.map((estimate) => (
                            <div key={estimate.id} className="border rounded-md p-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-medium text-xs truncate">{estimate.estimateNumber}</span>
                                    {getStatusBadge(estimate.status)}
                                  </div>
                                  <div className="text-xs text-gray-600 truncate">{estimate.projectName}</div>
                                  <div className="text-xs text-gray-500 truncate">
                                    {formatDate(estimate.createdAt)}
                                  </div>
                                </div>
                                <div className="text-right">
                                  <Badge variant="outline" className="text-xs">
                                    {formatCurrency(estimate.totalAmount)}
                                  </Badge>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          ) : (
            <Card>
              <CardContent className="p-8 text-center">
                <div className="text-gray-500">No data found for this customer</div>
              </CardContent>
            </Card>
          )
        ) : (
          <Card>
            <CardContent className="p-8 text-center">
              <User className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Customer</h3>
              <p className="text-gray-600">Choose a customer from the dropdown above to view their billing information and create invoices.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}