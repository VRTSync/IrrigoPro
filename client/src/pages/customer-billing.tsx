import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  ChevronDown,
  Filter,
  X
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

interface CustomerPreview {
  id: number;
  name: string;
  email: string;
  phone?: string;
  unbilledAmount: number;
  lastInvoiceDate?: string;
  totalWorkOrders: number;
  pendingWorkOrders: number;
  contractType?: string;
}

export default function CustomerBilling() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null);
  const [selectedBillingSheet, setSelectedBillingSheet] = useState<BillingSheet | null>(null);
  const [selectedEstimate, setSelectedEstimate] = useState<Estimate | null>(null);
  
  // Filter states
  const [dateFilter, setDateFilter] = useState<string>("last_30_days"); // Default to last 30 days
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [amountFilter, setAmountFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get all customers
  const { data: customers = [], isLoading: loadingCustomers } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  // Get comprehensive customer billing data including work orders, estimates, and billing sheets
  const { data: customerPreviews = [], isLoading: loadingPreviews } = useQuery<any[]>({
    queryKey: ["/api/customers/billing-preview", dateFilter, selectedMonth],
    queryFn: () => {
      const params = new URLSearchParams();
      params.append('dateFilter', dateFilter);
      if (selectedMonth) {
        params.append('selectedMonth', selectedMonth);
      }
      return fetch(`/api/customers/billing-preview?${params.toString()}`).then(res => res.json());
    }
  });

  // Create a map for easy lookup of preview data by customer ID
  const previewMap = customerPreviews.reduce((map, preview) => {
    map[preview.id] = preview;
    return map;
  }, {} as Record<number, any>);

  const getCustomerPreview = (customer: Customer) => {
    return previewMap[customer.id] || {
      ...customer,
      currentMonthBilling: 0,
      monthlyAverage: 0,
      billingPace: 0,
      unbilledAmount: 0,
      lastInvoiceDate: null,
      pendingWorkOrders: 0,
      totalWorkOrders: 0
    };
  };

  // Generate month options for the dropdown
  const generateMonthOptions = () => {
    const months = [];
    const currentDate = new Date();
    
    // Add current and previous 11 months
    for (let i = 0; i < 12; i++) {
      const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthLabel = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      months.push({ value: monthKey, label: monthLabel });
    }
    
    return months;
  };

  // Filter customers based on current filter settings
  const filterCustomers = (customers: Customer[]) => {
    return customers.filter(customer => {
      const preview = getCustomerPreview(customer);
      
      // Search term filter
      if (searchTerm && !customer.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
          !customer.email.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false;
      }
      
      // Amount filter
      if (amountFilter !== "all") {
        const amount = preview.currentMonthBilling || 0;
        switch (amountFilter) {
          case "under_500":
            if (amount >= 500) return false;
            break;
          case "500_to_2000":
            if (amount < 500 || amount > 2000) return false;
            break;
          case "over_2000":
            if (amount <= 2000) return false;
            break;
        }
      }
      
      // Status filter
      if (statusFilter !== "all") {
        switch (statusFilter) {
          case "has_unbilled":
            if (!preview.unbilledAmount || preview.unbilledAmount <= 0) return false;
            break;
          case "no_activity":
            if (preview.totalWorkOrders > 0) return false;
            break;
        }
      }
      
      // Date filter (this will be handled by backend API calls later)
      return true;
    });
  };

  // Reset all filters
  const resetFilters = () => {
    setDateFilter("last_30_days");
    setSelectedMonth("");
    setAmountFilter("all");
    setStatusFilter("all");
    setSearchTerm("");
  };

  // Count active filters
  const activeFilterCount = [
    dateFilter !== "last_30_days" ? 1 : 0,
    selectedMonth ? 1 : 0,
    amountFilter !== "all" ? 1 : 0,
    statusFilter !== "all" ? 1 : 0,
    searchTerm ? 1 : 0
  ].reduce((sum, count) => sum + count, 0);

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

  const filteredCustomers = filterCustomers(customers);

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
    <div className="flex flex-col lg:flex-row h-screen bg-gray-50">
      {/* Mobile/Tablet: Full-width Customer List, Desktop: Left Sidebar */}
      <div className="w-full lg:w-1/3 bg-white border-b lg:border-b-0 lg:border-r border-gray-200 flex flex-col max-h-[40vh] lg:max-h-none">
        <div className="p-3 md:p-4 border-b border-gray-200">
          <h1 className="text-lg md:text-xl font-bold text-gray-900 mb-3 md:mb-4">Customer Billing</h1>
          
          {/* Summary Stats - More compact on mobile */}
          {!loadingCustomers && !loadingPreviews && customers.length > 0 && (
            <div className="grid grid-cols-2 gap-2 mb-3 md:mb-4">
              <div className="bg-orange-50 p-2 rounded-lg text-center">
                <div className="text-xs text-orange-700 font-medium">Total Unbilled</div>
                <div className="text-xs md:text-sm font-bold text-orange-800">
                  {formatCurrency(
                    customerPreviews.reduce((sum, preview) => sum + (preview.unbilledAmount || 0), 0)
                  )}
                </div>
              </div>
              <div className="bg-blue-50 p-2 rounded-lg text-center">
                <div className="text-xs text-blue-700 font-medium">Active Customers</div>
                <div className="text-xs md:text-sm font-bold text-blue-800">
                  {customerPreviews.filter(preview => 
                    (preview.unbilledAmount || 0) > 0 || (preview.pendingWorkOrders || 0) > 0
                  ).length}
                </div>
              </div>
            </div>
          )}

          {/* Search Bar - More compact on mobile */}
          <div className="relative mb-3 md:mb-4">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search customers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 h-8 md:h-10 text-sm"
            />
          </div>

          {/* Filter Controls */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <Filter className="w-4 h-4" />
                Filters
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {activeFilterCount}
                  </Badge>
                )}
              </h3>
              {activeFilterCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetFilters}
                  className="text-xs h-6 px-2"
                >
                  <X className="w-3 h-3 mr-1" />
                  Clear
                </Button>
              )}
            </div>

            {/* Date Range Filter */}
            <div>
              <label className="text-xs text-gray-600 mb-1 block">Date Range</label>
              <Select value={dateFilter} onValueChange={setDateFilter}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Time</SelectItem>
                  <SelectItem value="last_30_days">Last 30 Days</SelectItem>
                  <SelectItem value="current_month">Current Month</SelectItem>
                  <SelectItem value="last_90_days">Last 90 Days</SelectItem>
                  <SelectItem value="custom_month">Specific Month</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Month Selector (shown when custom_month is selected) */}
            {dateFilter === "custom_month" && (
              <div>
                <label className="text-xs text-gray-600 mb-1 block">Select Month</label>
                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Choose month..." />
                  </SelectTrigger>
                  <SelectContent>
                    {generateMonthOptions().map(month => (
                      <SelectItem key={month.value} value={month.value}>
                        {month.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Amount Filter */}
            <div>
              <label className="text-xs text-gray-600 mb-1 block">Billing Amount</label>
              <Select value={amountFilter} onValueChange={setAmountFilter}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Amounts</SelectItem>
                  <SelectItem value="under_500">Under $500</SelectItem>
                  <SelectItem value="500_to_2000">$500 - $2,000</SelectItem>
                  <SelectItem value="over_2000">Over $2,000</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Status Filter */}
            <div>
              <label className="text-xs text-gray-600 mb-1 block">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Customers</SelectItem>
                  <SelectItem value="has_unbilled">Has Unbilled Work</SelectItem>
                  <SelectItem value="no_activity">No Recent Activity</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Results Summary */}
            <div className="text-xs text-gray-500 pt-2 border-t">
              Showing {filteredCustomers.length} of {customers.length} customers
            </div>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto">
          {(loadingCustomers || loadingPreviews) ? (
            <div className="p-4 text-center text-gray-500">Loading customer billing data...</div>
          ) : (
            <div className="divide-y divide-gray-200">
              {filteredCustomers.map((customer) => {
                const preview = getCustomerPreview(customer);
                const daysSinceInvoice = preview.lastInvoiceDate 
                  ? Math.floor((Date.now() - new Date(preview.lastInvoiceDate).getTime()) / (1000 * 60 * 60 * 24))
                  : null;
                
                return (
                  <div
                    key={customer.id}
                    onClick={() => setSelectedCustomerId(customer.id)}
                    className={`p-3 md:p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                      selectedCustomerId === customer.id ? 'bg-blue-50 border-r-2 border-blue-500' : ''
                    }`}
                  >
                    {/* Customer Name and Billing Pace Badge - Mobile optimized */}
                    <div className="flex items-center justify-between mb-1.5 md:mb-2">
                      <div className="font-medium text-gray-900 text-sm md:text-base truncate pr-2">{customer.name}</div>
                      {preview.billingPace >= 1.3 ? (
                        <Badge className="bg-green-100 text-green-800 text-xs flex-shrink-0">
                          ABOVE AVG
                        </Badge>
                      ) : preview.billingPace <= 0.7 ? (
                        <Badge className="bg-red-100 text-red-800 text-xs flex-shrink-0">
                          BELOW AVG
                        </Badge>
                      ) : (
                        <Badge className="bg-blue-100 text-blue-800 text-xs flex-shrink-0">
                          ON PACE
                        </Badge>
                      )}
                    </div>

                    {/* Contact Info - More compact on mobile */}
                    <div className="text-xs text-gray-600 mb-1.5 md:mb-2 truncate">{customer.email}</div>
                    
                    {/* Billing Summary - Mobile optimized */}
                    <div className="space-y-1">
                      {/* Monthly Billing Pace */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">This month:</span>
                        <span className="text-xs font-medium">
                          {formatCurrency(preview.currentMonthBilling)} 
                          <span className="text-gray-400 ml-1">
                            (avg: {formatCurrency(preview.monthlyAverage)})
                          </span>
                        </span>
                      </div>

                      {/* Unbilled Amount */}
                      {preview.unbilledAmount > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-orange-700 font-medium">Unbilled:</span>
                          <Badge className="bg-orange-100 text-orange-800 text-xs">
                            {formatCurrency(preview.unbilledAmount)}
                          </Badge>
                        </div>
                      )}

                      {/* Last Invoice Date */}
                      {preview.lastInvoiceDate && (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-500">Last invoiced:</span>
                          <span className={`text-xs ${daysSinceInvoice && daysSinceInvoice > 30 ? 'text-red-600' : 'text-green-600'}`}>
                            {new Date(preview.lastInvoiceDate).toLocaleDateString('en-US', { 
                              month: 'short', 
                              day: 'numeric' 
                            })}
                          </span>
                        </div>
                      )}




                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right Content Area - Mobile optimized */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-2 md:p-4">
          {selectedCustomerId ? (
            loadingCustomerData ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <div className="text-gray-500">Loading customer billing data...</div>
                </CardContent>
              </Card>
            ) : customerBillingData ? (
              <div className="space-y-2 md:space-y-4">
              {/* Customer Header - Mobile optimized */}
              <Card>
                <CardHeader className="pb-2 p-3 md:p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <CardTitle className="text-base md:text-lg">{customerBillingData.customer.name}</CardTitle>
                      <div className="space-y-1 text-xs text-gray-600 mt-1">
                        <div className="flex items-center gap-2">
                          <Mail className="w-3 h-3" />
                          <span className="truncate">{customerBillingData.customer.email}</span>
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
                            <span className="truncate">{customerBillingData.customer.address}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </CardHeader>
              </Card>

              {/* Billing Summary Card - Mobile responsive */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-3">
                {/* Unbilled Work Summary - Mobile optimized */}
                <Card className="border-orange-200 bg-orange-50">
                  <CardHeader className="pb-2 p-3">
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
                  <CardContent className="pt-0 px-3 pb-3">
                    <div className="space-y-2">
                      <div className="text-xs text-orange-700">
                        {customerBillingData.unbilledWorkOrders.length} WO, {customerBillingData.unbilledBillingSheets.length} BS ready
                      </div>
                      <Button
                        onClick={() => createMonthlyInvoice.mutate(selectedCustomerId)}
                        disabled={createMonthlyInvoice.isPending || customerBillingData.totalUnbilledAmount === 0}
                        className="bg-orange-600 hover:bg-orange-700 text-white w-full h-8 text-xs"
                      >
                        <Receipt className="w-3 h-3 mr-1" />
                        {createMonthlyInvoice.isPending ? "Creating..." : "Create Invoice"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Quick Stats - Mobile optimized */}
                <Card>
                  <CardHeader className="pb-2 p-3">
                    <CardTitle className="text-xs text-gray-700">Total Work</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 px-3 pb-3">
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
                      <div className="flex justify-between text-xs text-orange-600 border-t pt-1 mt-1">
                        <span className="font-medium">Unbilled Items:</span>
                        <span className="font-medium">
                          {customerBillingData.unbilledWorkOrders.length + customerBillingData.unbilledBillingSheets.length}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Total Revenue - Mobile optimized */}
                <Card>
                  <CardHeader className="pb-2 p-3">
                    <CardTitle className="text-xs text-gray-700">Revenue Overview</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 px-3 pb-3">
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

              {/* Work Details Tabs - Mobile responsive */}
              <Tabs defaultValue="work-orders" className="w-full">
                <TabsList className="grid w-full grid-cols-3 h-8 md:h-10">
                  <TabsTrigger value="work-orders" className="text-xs md:text-sm px-2">
                    <span className="hidden md:inline">Work Orders</span>
                    <span className="md:hidden">WO</span>
                    <span className="ml-1">({customerBillingData.workOrders.length})</span>
                  </TabsTrigger>
                  <TabsTrigger value="billing-sheets" className="text-xs md:text-sm px-2">
                    <span className="hidden md:inline">Billing Sheets</span>
                    <span className="md:hidden">BS</span>
                    <span className="ml-1">({customerBillingData.billingSheets.length})</span>
                  </TabsTrigger>
                  <TabsTrigger value="estimates" className="text-xs md:text-sm px-2">
                    <span className="hidden md:inline">Estimates</span>
                    <span className="md:hidden">EST</span>
                    <span className="ml-1">({customerBillingData.estimates.length})</span>
                  </TabsTrigger>
                </TabsList>

                {/* Work Orders Tab - Mobile optimized */}
                <TabsContent value="work-orders" className="space-y-2 mt-2">
                  <Card>
                    <CardHeader className="pb-2 p-3">
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
                    <CardContent className="pt-0 px-3 pb-3">
                      {customerBillingData.workOrders.length === 0 ? (
                        <div className="text-center text-gray-500 py-4 md:py-6 text-sm">No work orders found</div>
                      ) : (
                        <div className="space-y-1 max-h-80 md:max-h-96 overflow-y-auto">
                          {customerBillingData.workOrders.map((workOrder) => (
                            <div 
                              key={workOrder.id} 
                              onClick={() => setSelectedWorkOrder(workOrder)}
                              className={`border rounded-md p-2 md:p-3 transition-all cursor-pointer hover:shadow-md ${
                                workOrder.status === 'completed' && parseFloat(workOrder.totalAmount || '0') > 0
                                  ? 'border-orange-200 bg-orange-50 hover:bg-orange-100' 
                                  : 'border-gray-200 hover:bg-gray-50'
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
                            <div 
                              key={billingSheet.id} 
                              onClick={() => setSelectedBillingSheet(billingSheet)}
                              className="border rounded-md p-2 cursor-pointer hover:shadow-md hover:bg-gray-50 transition-all">
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
                            <div 
                              key={estimate.id} 
                              onClick={() => setSelectedEstimate(estimate)}
                              className="border rounded-md p-2 cursor-pointer hover:shadow-md hover:bg-gray-50 transition-all">
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
              <p className="text-gray-600">Choose a customer from the list to view their billing information and create invoices.</p>
            </CardContent>
          </Card>
        )}
        </div>
      </div>

      {/* Work Order Details Modal */}
      <Dialog open={!!selectedWorkOrder} onOpenChange={() => setSelectedWorkOrder(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Work Order Details - {selectedWorkOrder?.workOrderNumber}
            </DialogTitle>
          </DialogHeader>
          {selectedWorkOrder && (
            <div className="space-y-6">
              {/* Header Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium text-gray-600">Project Name</label>
                    <p className="text-sm">{selectedWorkOrder.projectName}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600">Status</label>
                    <div className="mt-1">{getStatusBadge(selectedWorkOrder.status)}</div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600">Assigned Technician</label>
                    <p className="text-sm">{selectedWorkOrder.assignedTechnicianName || "Unassigned"}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600">Work Type</label>
                    <p className="text-sm capitalize">{selectedWorkOrder.workType?.replace('_', ' ') || 'Standard'}</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium text-gray-600">Created Date</label>
                    <p className="text-sm">{formatDate(selectedWorkOrder.createdAt)}</p>
                  </div>
                  {selectedWorkOrder.startedAt && (
                    <div>
                      <label className="text-sm font-medium text-gray-600">Started Date</label>
                      <p className="text-sm">{formatDate(selectedWorkOrder.startedAt)}</p>
                    </div>
                  )}
                  {selectedWorkOrder.completedAt && (
                    <div>
                      <label className="text-sm font-medium text-gray-600">Completed Date</label>
                      <p className="text-sm">{formatDate(selectedWorkOrder.completedAt)}</p>
                    </div>
                  )}
                  <div>
                    <label className="text-sm font-medium text-gray-600">Priority</label>
                    <p className="text-sm capitalize">{selectedWorkOrder.priority || 'Normal'}</p>
                  </div>
                </div>
              </div>

              {/* Location & Instructions */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {selectedWorkOrder.projectAddress && (
                  <div>
                    <label className="text-sm font-medium text-gray-600">Project Address</label>
                    <p className="text-sm bg-gray-50 p-2 rounded">{selectedWorkOrder.projectAddress}</p>
                  </div>
                )}
                {selectedWorkOrder.locationNotes && (
                  <div>
                    <label className="text-sm font-medium text-gray-600">Location Notes</label>
                    <p className="text-sm bg-gray-50 p-2 rounded">{selectedWorkOrder.locationNotes}</p>
                  </div>
                )}
              </div>

              {/* Work Details */}
              <div className="space-y-4">
                {selectedWorkOrder.description && (
                  <div>
                    <label className="text-sm font-medium text-gray-600">Work Description</label>
                    <p className="text-sm bg-gray-50 p-3 rounded">{selectedWorkOrder.description}</p>
                  </div>
                )}
                
                {selectedWorkOrder.specialInstructions && (
                  <div>
                    <label className="text-sm font-medium text-gray-600">Special Instructions</label>
                    <p className="text-sm bg-blue-50 p-3 rounded border border-blue-200">{selectedWorkOrder.specialInstructions}</p>
                  </div>
                )}

                {selectedWorkOrder.workSummary && (
                  <div>
                    <label className="text-sm font-medium text-gray-600">Work Summary (Technician Report)</label>
                    <p className="text-sm bg-green-50 p-3 rounded border border-green-200">{selectedWorkOrder.workSummary}</p>
                  </div>
                )}
              </div>

              {/* Labor & Financial Details */}
              <div className="bg-gray-50 p-4 rounded-lg">
                <h4 className="text-sm font-medium text-gray-700 mb-3">Labor & Financial Details</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {selectedWorkOrder.totalHours && (
                    <div>
                      <label className="text-xs text-gray-500">Total Hours</label>
                      <p className="text-sm font-medium">{selectedWorkOrder.totalHours} hrs</p>
                    </div>
                  )}
                  {selectedWorkOrder.totalPartsCost && (
                    <div>
                      <label className="text-xs text-gray-500">Parts Cost</label>
                      <p className="text-sm font-medium">{formatCurrency(selectedWorkOrder.totalPartsCost)}</p>
                    </div>
                  )}
                  <div>
                    <label className="text-xs text-gray-500">Total Amount</label>
                    <p className="text-lg font-semibold text-green-600">{formatCurrency(selectedWorkOrder.totalAmount || '0')}</p>
                  </div>
                  {selectedWorkOrder.totalItems !== null && (
                    <div>
                      <label className="text-xs text-gray-500">Parts Used</label>
                      <p className="text-sm font-medium">{selectedWorkOrder.totalItems || 0} items</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Notes Section */}
              <div className="space-y-4">
                {selectedWorkOrder.notes && (
                  <div>
                    <label className="text-sm font-medium text-gray-600">Internal Notes</label>
                    <p className="text-sm bg-yellow-50 p-3 rounded border border-yellow-200">{selectedWorkOrder.notes}</p>
                  </div>
                )}
                
                {selectedWorkOrder.customerNotes && (
                  <div>
                    <label className="text-sm font-medium text-gray-600">Customer Notes</label>
                    <p className="text-sm bg-blue-50 p-3 rounded border border-blue-200">{selectedWorkOrder.customerNotes}</p>
                  </div>
                )}
              </div>

              {/* Photos Section */}
              {selectedWorkOrder.photos && selectedWorkOrder.photos.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-gray-600 mb-2 block">Photos ({selectedWorkOrder.photos.length})</label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {selectedWorkOrder.photos.map((photo, index) => (
                      <div key={index} className="relative">
                        <img 
                          src={photo} 
                          alt={`Work photo ${index + 1}`}
                          className="w-full h-24 object-cover rounded border hover:scale-105 transition-transform cursor-pointer"
                          onClick={() => window.open(photo, '_blank')}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Attachments Section */}
              {selectedWorkOrder.attachments && selectedWorkOrder.attachments.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-gray-600 mb-2 block">Attachments ({selectedWorkOrder.attachments.length})</label>
                  <div className="space-y-1">
                    {selectedWorkOrder.attachments.map((attachment, index) => (
                      <div key={index} className="flex items-center gap-2 text-sm">
                        <FileText className="w-4 h-4 text-gray-500" />
                        <a href={attachment} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                          Attachment {index + 1}
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Billing Sheet Details Modal */}
      <Dialog open={!!selectedBillingSheet} onOpenChange={() => setSelectedBillingSheet(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="w-5 h-5" />
              Billing Sheet Details - {selectedBillingSheet?.billingNumber}
            </DialogTitle>
          </DialogHeader>
          {selectedBillingSheet && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div>
                    <label className="text-sm font-medium text-gray-600">Work Description</label>
                    <p className="text-sm">{selectedBillingSheet.workDescription}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600">Status</label>
                    <div className="mt-1">{getStatusBadge(selectedBillingSheet.status)}</div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600">Technician</label>
                    <p className="text-sm">{selectedBillingSheet.technicianName}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600">Total Amount</label>
                    <p className="text-lg font-semibold text-green-600">{formatCurrency(selectedBillingSheet.totalAmount)}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <div>
                    <label className="text-sm font-medium text-gray-600">Work Date</label>
                    <p className="text-sm">{formatDate(selectedBillingSheet.workDate)}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600">Created Date</label>
                    <p className="text-sm">{formatDate(selectedBillingSheet.createdAt)}</p>
                  </div>
                  {selectedBillingSheet.totalHours && (
                    <div>
                      <label className="text-sm font-medium text-gray-600">Hours Worked</label>
                      <p className="text-sm">{selectedBillingSheet.totalHours}</p>
                    </div>
                  )}
                </div>
              </div>
              
              {selectedBillingSheet.notes && (
                <div>
                  <label className="text-sm font-medium text-gray-600">Notes</label>
                  <p className="text-sm bg-gray-50 p-3 rounded mt-1">{selectedBillingSheet.notes}</p>
                </div>
              )}
              
              {selectedBillingSheet.workLocation && (
                <div>
                  <label className="text-sm font-medium text-gray-600">Location</label>
                  <p className="text-sm">{selectedBillingSheet.workLocation}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Estimate Details Modal */}
      <Dialog open={!!selectedEstimate} onOpenChange={() => setSelectedEstimate(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5" />
              Estimate Details - {selectedEstimate?.estimateNumber}
            </DialogTitle>
          </DialogHeader>
          {selectedEstimate && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div>
                    <label className="text-sm font-medium text-gray-600">Project Name</label>
                    <p className="text-sm">{selectedEstimate.projectName}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600">Status</label>
                    <div className="mt-1">{getStatusBadge(selectedEstimate.status)}</div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600">Total Amount</label>
                    <p className="text-lg font-semibold text-green-600">{formatCurrency(selectedEstimate.totalAmount)}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600">Valid Until</label>
                    <p className="text-sm">No expiration set</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <div>
                    <label className="text-sm font-medium text-gray-600">Created Date</label>
                    <p className="text-sm">{formatDate(selectedEstimate.createdAt)}</p>
                  </div>
                  {selectedEstimate.approvedAt && (
                    <div>
                      <label className="text-sm font-medium text-gray-600">Approved Date</label>
                      <p className="text-sm">{formatDate(selectedEstimate.approvedAt)}</p>
                    </div>
                  )}
                  <div>
                    <label className="text-sm font-medium text-gray-600">Status</label>
                    <p className="text-sm capitalize">{selectedEstimate.status}</p>
                  </div>
                </div>
              </div>
              
              {selectedEstimate.description && (
                <div>
                  <label className="text-sm font-medium text-gray-600">Project Description</label>
                  <p className="text-sm bg-gray-50 p-3 rounded mt-1">{selectedEstimate.description}</p>
                </div>
              )}
              
              {selectedEstimate.projectAddress && (
                <div>
                  <label className="text-sm font-medium text-gray-600">Location</label>
                  <p className="text-sm">{selectedEstimate.projectAddress}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}