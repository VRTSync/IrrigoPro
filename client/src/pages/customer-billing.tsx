import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
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
  AlertTriangle
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

  const formatCurrency = (amount: number | string) => {
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
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Customer Billing</h1>
          <p className="text-gray-600">Manage customer invoices and billing</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Customer List Panel */}
        <div className="lg:col-span-1">
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5" />
                Customers
              </CardTitle>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Search customers..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-96 overflow-y-auto">
                {loadingCustomers ? (
                  <div className="p-4 text-center text-gray-500">Loading customers...</div>
                ) : (
                  <div className="space-y-2 p-4">
                    {filteredCustomers.map((customer) => (
                      <div
                        key={customer.id}
                        onClick={() => setSelectedCustomerId(customer.id)}
                        className={`p-3 rounded-lg border cursor-pointer transition-colors hover:bg-gray-50 ${
                          selectedCustomerId === customer.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                        }`}
                      >
                        <div className="font-medium text-gray-900">{customer.name}</div>
                        <div className="text-sm text-gray-600">{customer.email}</div>
                        {customer.phone && (
                          <div className="text-sm text-gray-500">{customer.phone}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Customer Details & Billing Panel */}
        <div className="lg:col-span-2">
          {selectedCustomerId ? (
            loadingCustomerData ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <div className="text-gray-500">Loading customer billing data...</div>
                </CardContent>
              </Card>
            ) : customerBillingData ? (
              <div className="space-y-6">
                {/* Customer Header */}
                <Card>
                  <CardHeader>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                      <div>
                        <CardTitle className="text-xl">{customerBillingData.customer.name}</CardTitle>
                        <div className="space-y-1 text-sm text-gray-600">
                          <div className="flex items-center gap-2">
                            <Mail className="w-4 h-4" />
                            {customerBillingData.customer.email}
                          </div>
                          {customerBillingData.customer.phone && (
                            <div className="flex items-center gap-2">
                              <Phone className="w-4 h-4" />
                              {customerBillingData.customer.phone}
                            </div>
                          )}
                          {customerBillingData.customer.address && (
                            <div className="flex items-center gap-2">
                              <MapPin className="w-4 h-4" />
                              {customerBillingData.customer.address}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                </Card>

                {/* Unbilled Work Summary */}
                {(customerBillingData.unbilledWorkOrders.length > 0 || customerBillingData.unbilledBillingSheets.length > 0) && (
                  <Card className="border-orange-200 bg-orange-50">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2 text-orange-800">
                          <AlertTriangle className="w-5 h-5" />
                          Unbilled Work
                        </CardTitle>
                        <Badge className="bg-orange-100 text-orange-800">
                          {formatCurrency(customerBillingData.totalUnbilledAmount)}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                        <div className="text-sm text-orange-700">
                          {customerBillingData.unbilledWorkOrders.length} completed work orders, {customerBillingData.unbilledBillingSheets.length} approved billing sheets ready for invoicing
                        </div>
                        <Button
                          onClick={() => createMonthlyInvoice.mutate(selectedCustomerId)}
                          disabled={createMonthlyInvoice.isPending}
                          className="bg-orange-600 hover:bg-orange-700 text-white"
                        >
                          <Receipt className="w-4 h-4 mr-2" />
                          {createMonthlyInvoice.isPending ? "Creating..." : "Create Monthly Invoice"}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Work Details Tabs */}
                <Tabs defaultValue="work-orders" className="w-full">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="work-orders">Work Orders</TabsTrigger>
                    <TabsTrigger value="billing-sheets">Billing Sheets</TabsTrigger>
                    <TabsTrigger value="estimates">Estimates</TabsTrigger>
                  </TabsList>

                  {/* Work Orders Tab */}
                  <TabsContent value="work-orders" className="space-y-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <FileText className="w-5 h-5" />
                          Work Orders ({customerBillingData.workOrders.length})
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {customerBillingData.workOrders.length === 0 ? (
                          <div className="text-center text-gray-500 py-8">No work orders found</div>
                        ) : (
                          <div className="space-y-3">
                            {customerBillingData.workOrders.map((workOrder) => (
                              <div key={workOrder.id} className="border border-gray-200 rounded-lg p-4">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                  <div className="flex-1">
                                    <div className="font-medium">{workOrder.workOrderNumber}</div>
                                    <div className="text-sm text-gray-600">{workOrder.projectName}</div>
                                    <div className="text-sm text-gray-500">
                                      Technician: {workOrder.assignedTechnicianName || "Unassigned"}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    {getStatusBadge(workOrder.status)}
                                    {workOrder.totalAmount && (
                                      <Badge variant="outline">
                                        {formatCurrency(workOrder.totalAmount)}
                                      </Badge>
                                    )}
                                    <div className="text-sm text-gray-500">
                                      {formatDate(workOrder.createdAt)}
                                    </div>
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
                  <TabsContent value="billing-sheets" className="space-y-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Receipt className="w-5 h-5" />
                          Billing Sheets ({customerBillingData.billingSheets.length})
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {customerBillingData.billingSheets.length === 0 ? (
                          <div className="text-center text-gray-500 py-8">No billing sheets found</div>
                        ) : (
                          <div className="space-y-3">
                            {customerBillingData.billingSheets.map((billingSheet) => (
                              <div key={billingSheet.id} className="border border-gray-200 rounded-lg p-4">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                  <div className="flex-1">
                                    <div className="font-medium">{billingSheet.billingNumber}</div>
                                    <div className="text-sm text-gray-600">{billingSheet.workDescription}</div>
                                    <div className="text-sm text-gray-500">
                                      Technician: {billingSheet.technicianName}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    {getStatusBadge(billingSheet.status)}
                                    <Badge variant="outline">
                                      {formatCurrency(billingSheet.totalAmount)}
                                    </Badge>
                                    <div className="text-sm text-gray-500">
                                      {formatDate(billingSheet.workDate)}
                                    </div>
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
                  <TabsContent value="estimates" className="space-y-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <DollarSign className="w-5 h-5" />
                          Estimates ({customerBillingData.estimates.length})
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {customerBillingData.estimates.length === 0 ? (
                          <div className="text-center text-gray-500 py-8">No estimates found</div>
                        ) : (
                          <div className="space-y-3">
                            {customerBillingData.estimates.map((estimate) => (
                              <div key={estimate.id} className="border border-gray-200 rounded-lg p-4">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                  <div className="flex-1">
                                    <div className="font-medium">{estimate.estimateNumber}</div>
                                    <div className="text-sm text-gray-600">{estimate.projectName}</div>
                                    <div className="text-sm text-gray-500">
                                      {estimate.projectAddress}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    {getStatusBadge(estimate.status)}
                                    {estimate.totalAmount && (
                                      <Badge variant="outline">
                                        {formatCurrency(estimate.totalAmount)}
                                      </Badge>
                                    )}
                                    <div className="text-sm text-gray-500">
                                      {formatDate(estimate.createdAt)}
                                    </div>
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
                <p className="text-gray-600">Choose a customer from the list to view their billing information and create invoices.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}