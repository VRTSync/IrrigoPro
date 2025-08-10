import { useState, useRef, useEffect } from "react";
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
  ChevronUp,
  Filter,
  X
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Customer, WorkOrder, BillingSheet, Estimate } from "@shared/schema";
import { QuickBooksIntegration } from "@/components/quickbooks/quickbooks-integration";

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
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null);
  const [selectedBillingSheet, setSelectedBillingSheet] = useState<BillingSheet | null>(null);
  const [selectedEstimate, setSelectedEstimate] = useState<Estimate | null>(null);
  
  // Filter states
  const [dateFilter, setDateFilter] = useState<string>("last_30_days"); // Default to last 30 days
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [amountFilter, setAmountFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isFiltersExpanded, setIsFiltersExpanded] = useState(false);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowCustomerDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  // Create Invoice Mutation
  const createInvoiceMutation = useMutation({
    mutationFn: async (customerId: number) => {
      const response = await apiRequest("POST", "/api/invoices/monthly", {
        customerId
      });
      return response.json();
    },
    onSuccess: (data, customerId) => {
      toast({
        title: "Invoice Created Successfully",
        description: `Monthly invoice ${data.invoiceNumber} has been created and synced to QuickBooks.`,
      });
      // Refresh customer billing data and previews
      queryClient.invalidateQueries({ queryKey: ['customer-billing', customerId] });
      queryClient.invalidateQueries({ queryKey: ['/api/customers/billing-preview'] });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Create Invoice",
        description: error.message || "An error occurred while creating the invoice.",
        variant: "destructive",
      });
    }
  });

  const handleCreateInvoice = (customerId: number) => {
    createInvoiceMutation.mutate(customerId);
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
      {/* Mobile: Customer Selector */}
      <div className="lg:hidden w-full bg-white border-b border-gray-200 flex-col max-h-[40vh]">
        <div className="p-3 border-b border-gray-200">
          <h1 className="text-lg font-bold text-gray-900 mb-3">Customer Billing</h1>
          
          {/* Mobile Summary Stats */}
          {!loadingCustomers && !loadingPreviews && customers.length > 0 && (
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="bg-orange-50 p-2 rounded-lg text-center">
                <div className="text-xs text-orange-700 font-medium">Total Unbilled</div>
                <div className="text-xs font-bold text-orange-800">
                  {formatCurrency(
                    customerPreviews.reduce((sum, preview) => sum + (preview.unbilledAmount || 0), 0)
                  )}
                </div>
              </div>
              <div className="bg-blue-50 p-2 rounded-lg text-center">
                <div className="text-xs text-blue-700 font-medium">Active Customers</div>
                <div className="text-xs font-bold text-blue-800">
                  {customerPreviews.filter(preview => 
                    (preview.unbilledAmount || 0) > 0 || (preview.pendingWorkOrders || 0) > 0
                  ).length}
                </div>
              </div>
            </div>
          )}

          {/* Mobile Customer Search/Selector - Dropdown Style */}
          <div className="relative mb-3" ref={dropdownRef}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder={selectedCustomerId 
                  ? customers.find(c => c.id === selectedCustomerId)?.name || "Search customers..."
                  : "Search customers..."
                }
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setShowCustomerDropdown(true);
                }}
                onFocus={() => setShowCustomerDropdown(true)}
                className="pl-10 h-8 text-sm"
              />
              <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            </div>
            
            {/* Customer Dropdown */}
            {showCustomerDropdown && (
              <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-80 overflow-y-auto">
                {filteredCustomers.length === 0 ? (
                  <div className="p-4 text-center text-gray-500 text-sm">No customers found</div>
                ) : (
                  filteredCustomers.map((customer) => {
                    const preview = getCustomerPreview(customer);
                    return (
                      <div
                        key={customer.id}
                        onClick={() => {
                          setSelectedCustomerId(customer.id);
                          setSearchTerm("");
                          setShowCustomerDropdown(false);
                        }}
                        className={`p-3 cursor-pointer hover:bg-gray-50 border-b border-gray-100 last:border-b-0 ${
                          selectedCustomerId === customer.id ? 'bg-blue-50' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="font-medium text-sm text-gray-900">{customer.name}</div>
                          {preview.billingPace >= 1.3 ? (
                            <Badge className="bg-green-100 text-green-800 text-xs">ABOVE AVG</Badge>
                          ) : preview.billingPace <= 0.7 ? (
                            <Badge className="bg-red-100 text-red-800 text-xs">BELOW AVG</Badge>
                          ) : (
                            <Badge className="bg-blue-100 text-blue-800 text-xs">ON PACE</Badge>
                          )}
                        </div>
                        <div className="text-xs text-gray-600 mb-1">{customer.email}</div>
                        {preview.unbilledAmount > 0 && (
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-orange-700">Unbilled:</span>
                            <Badge className="bg-orange-100 text-orange-800 text-xs">
                              {formatCurrency(preview.unbilledAmount)}
                            </Badge>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Mobile Filter Controls - Collapsible */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsFiltersExpanded(!isFiltersExpanded)}
                className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900 p-0 h-auto"
              >
                <Filter className="w-4 h-4" />
                Filters
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {activeFilterCount}
                  </Badge>
                )}
                {isFiltersExpanded ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </Button>
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

            {/* Collapsible Filter Content */}
            {isFiltersExpanded && (
              <div className="space-y-3 animate-in slide-in-from-top-2 duration-200">
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
            )}
          </div>



          {/* Selected Customer Summary - Only show when customer is selected */}
          {selectedCustomerId && (
            <div className="border-t border-gray-200 p-3 bg-gray-50 mt-3">
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium text-sm text-gray-900">
                  {customers.find(c => c.id === selectedCustomerId)?.name}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedCustomerId(null)}
                  className="h-6 w-6 p-0 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              {(() => {
                const preview = getCustomerPreview(customers.find(c => c.id === selectedCustomerId)!);
                return (
                  <div className="space-y-1">
                    <div className="text-xs text-gray-600">
                      {customers.find(c => c.id === selectedCustomerId)?.email}
                    </div>
                    {preview.unbilledAmount > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-orange-700">Unbilled:</span>
                        <Badge className="bg-orange-100 text-orange-800 text-xs">
                          {formatCurrency(preview.unbilledAmount)}
                        </Badge>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      {/* Desktop: Left Sidebar - Customer List */}
      <div className="hidden lg:flex lg:w-1/3 bg-white border-r border-gray-200 flex-col">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-xl font-bold text-gray-900 mb-4">Customer Billing</h1>
          

          
          {/* Summary Stats */}
          {!loadingCustomers && !loadingPreviews && customers.length > 0 && (
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className="bg-orange-50 p-2 rounded-lg text-center">
                <div className="text-xs text-orange-700 font-medium">Total Unbilled</div>
                <div className="text-sm font-bold text-orange-800">
                  {formatCurrency(
                    customerPreviews.reduce((sum, preview) => sum + (preview.unbilledAmount || 0), 0)
                  )}
                </div>
              </div>
              <div className="bg-blue-50 p-2 rounded-lg text-center">
                <div className="text-xs text-blue-700 font-medium">Active Customers</div>
                <div className="text-sm font-bold text-blue-800">
                  {customerPreviews.filter(preview => 
                    (preview.unbilledAmount || 0) > 0 || (preview.pendingWorkOrders || 0) > 0
                  ).length}
                </div>
              </div>
            </div>
          )}

          {/* Desktop Search Bar */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search customers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Filter Controls - Collapsible */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsFiltersExpanded(!isFiltersExpanded)}
                className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900 p-0 h-auto"
              >
                <Filter className="w-4 h-4" />
                Filters
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {activeFilterCount}
                  </Badge>
                )}
                {isFiltersExpanded ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </Button>
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

            {/* Collapsible Filter Content */}
            {isFiltersExpanded && (
              <div className="space-y-3 animate-in slide-in-from-top-2 duration-200">
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
            )}
          </div>
        </div>
        
        {/* Desktop Customer List */}
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
                    className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                      selectedCustomerId === customer.id ? 'bg-blue-50 border-r-2 border-blue-500' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-medium text-gray-900 truncate">{customer.name}</div>
                      {preview.billingPace >= 1.3 ? (
                        <Badge className="bg-green-100 text-green-800 text-xs">
                          ABOVE AVG
                        </Badge>
                      ) : preview.billingPace <= 0.7 ? (
                        <Badge className="bg-red-100 text-red-800 text-xs">
                          BELOW AVG
                        </Badge>
                      ) : (
                        <Badge className="bg-blue-100 text-blue-800 text-xs">
                          ON PACE
                        </Badge>
                      )}
                    </div>

                    <div className="text-xs text-gray-600 mb-2 truncate">{customer.email}</div>
                    
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">This month:</span>
                        <span className="text-xs font-medium">
                          {formatCurrency(preview.currentMonthBilling)} 
                          <span className="text-gray-400 ml-1">
                            (avg: {formatCurrency(preview.monthlyAverage)})
                          </span>
                        </span>
                      </div>

                      {preview.unbilledAmount > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-orange-700 font-medium">Unbilled:</span>
                          <Badge className="bg-orange-100 text-orange-800 text-xs">
                            {formatCurrency(preview.unbilledAmount)}
                          </Badge>
                        </div>
                      )}

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

      {/* Right Content Area - Always full width on mobile, shared with desktop */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-2 lg:p-4">
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
                        onClick={() => handleCreateInvoice(selectedCustomerId!)}
                        disabled={createInvoiceMutation.isPending || customerBillingData.totalUnbilledAmount === 0}
                        className="bg-orange-600 hover:bg-orange-700 text-white w-full h-8 text-xs"
                      >
                        {createInvoiceMutation.isPending ? (
                          <>
                            <Clock className="w-3 h-3 mr-1 animate-spin" />
                            Creating...
                          </>
                        ) : (
                          <>
                            <Receipt className="w-3 h-3 mr-1" />
                            Create Invoice
                          </>
                        )}
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
              </div>

              {/* Work Orders and Billing Data Tabs - Mobile optimized */}
              <Tabs defaultValue="unbilled" className="w-full">
                <TabsList className="grid w-full grid-cols-4 h-8">
                  <TabsTrigger value="unbilled" className="text-xs px-2">
                    Unbilled ({customerBillingData.unbilledWorkOrders.length + customerBillingData.unbilledBillingSheets.length})
                  </TabsTrigger>
                  <TabsTrigger value="work_orders" className="text-xs px-2">
                    Work Orders ({customerBillingData.workOrders.length})
                  </TabsTrigger>
                  <TabsTrigger value="billing_sheets" className="text-xs px-2">
                    Billing ({customerBillingData.billingSheets.length})
                  </TabsTrigger>
                  <TabsTrigger value="estimates" className="text-xs px-2">
                    Estimates ({customerBillingData.estimates.length})
                  </TabsTrigger>
                </TabsList>

                {/* Unbilled Items Tab */}
                <TabsContent value="unbilled">
                  <div className="space-y-2">
                    {customerBillingData.unbilledWorkOrders.length === 0 && customerBillingData.unbilledBillingSheets.length === 0 ? (
                      <Card>
                        <CardContent className="p-6 text-center text-gray-500">
                          <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-500" />
                          <div className="font-medium mb-1">All caught up!</div>
                          <div className="text-sm">No unbilled work for this customer.</div>
                        </CardContent>
                      </Card>
                    ) : (
                      <>
                        {/* Unbilled Work Orders */}
                        {customerBillingData.unbilledWorkOrders.map((wo) => (
                          <Card key={`wo-${wo.id}`} className="border-orange-200">
                            <CardContent className="p-3">
                              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <FileText className="w-4 h-4 text-gray-400" />
                                    <span className="font-medium text-sm">WO #{wo.id}</span>
                                    {getStatusBadge(wo.status)}
                                  </div>
                                  <div className="text-xs text-gray-600 mb-2">
                                    {wo.description}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                                    <div className="flex items-center gap-1">
                                      <Calendar className="w-3 h-3" />
                                      {new Date(wo.scheduledDate).toLocaleDateString()}
                                    </div>
                                    {wo.assignedTo && (
                                      <div className="flex items-center gap-1">
                                        <User className="w-3 h-3" />
                                        {wo.assignedTo}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="text-sm font-medium text-orange-700">
                                    {formatCurrency(wo.laborCost + wo.partsCost)}
                                  </div>
                                  <Dialog>
                                    <DialogTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setSelectedWorkOrder(wo)}
                                        className="h-6 px-2 text-xs hover:bg-orange-50"
                                      >
                                        View
                                      </Button>
                                    </DialogTrigger>
                                    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                                      <DialogHeader>
                                        <DialogTitle className="flex items-center gap-2">
                                          <FileText className="w-4 h-4" />
                                          Work Order #{wo.id}
                                          {getStatusBadge(wo.status)}
                                        </DialogTitle>
                                      </DialogHeader>
                                      {/* Work order details content would go here */}
                                      <div className="space-y-4">
                                        <div>
                                          <h4 className="font-medium mb-2">Description</h4>
                                          <p className="text-sm text-gray-600">{wo.description}</p>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                          <div>
                                            <h4 className="font-medium mb-1">Scheduled Date</h4>
                                            <p className="text-sm text-gray-600">{new Date(wo.scheduledDate).toLocaleDateString()}</p>
                                          </div>
                                          <div>
                                            <h4 className="font-medium mb-1">Status</h4>
                                            <p className="text-sm text-gray-600">{wo.status.replace('_', ' ')}</p>
                                          </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                          <div>
                                            <h4 className="font-medium mb-1">Labor Cost</h4>
                                            <p className="text-sm text-gray-600">{formatCurrency(wo.laborCost)}</p>
                                          </div>
                                          <div>
                                            <h4 className="font-medium mb-1">Parts Cost</h4>
                                            <p className="text-sm text-gray-600">{formatCurrency(wo.partsCost)}</p>
                                          </div>
                                        </div>
                                        <div>
                                          <h4 className="font-medium mb-1">Total Cost</h4>
                                          <p className="text-lg font-bold text-orange-700">{formatCurrency(wo.laborCost + wo.partsCost)}</p>
                                        </div>
                                      </div>
                                    </DialogContent>
                                  </Dialog>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}

                        {/* Unbilled Billing Sheets */}
                        {customerBillingData.unbilledBillingSheets.map((bs) => (
                          <Card key={`bs-${bs.id}`} className="border-orange-200">
                            <CardContent className="p-3">
                              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <Receipt className="w-4 h-4 text-gray-400" />
                                    <span className="font-medium text-sm">BS #{bs.id}</span>
                                    {getStatusBadge(bs.status)}
                                  </div>
                                  <div className="text-xs text-gray-600 mb-2">
                                    {bs.description || 'Billing Sheet'}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                                    <div className="flex items-center gap-1">
                                      <Calendar className="w-3 h-3" />
                                      {new Date(bs.createdAt).toLocaleDateString()}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="text-sm font-medium text-orange-700">
                                    {formatCurrency(bs.laborCost + bs.partsCost)}
                                  </div>
                                  <Dialog>
                                    <DialogTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setSelectedBillingSheet(bs)}
                                        className="h-6 px-2 text-xs hover:bg-orange-50"
                                      >
                                        View
                                      </Button>
                                    </DialogTrigger>
                                    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                                      <DialogHeader>
                                        <DialogTitle className="flex items-center gap-2">
                                          <Receipt className="w-4 h-4" />
                                          Billing Sheet #{bs.id}
                                          {getStatusBadge(bs.status)}
                                        </DialogTitle>
                                      </DialogHeader>
                                      {/* Billing sheet details content would go here */}
                                      <div className="space-y-4">
                                        <div>
                                          <h4 className="font-medium mb-2">Description</h4>
                                          <p className="text-sm text-gray-600">{bs.description || 'No description provided'}</p>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                          <div>
                                            <h4 className="font-medium mb-1">Created Date</h4>
                                            <p className="text-sm text-gray-600">{new Date(bs.createdAt).toLocaleDateString()}</p>
                                          </div>
                                          <div>
                                            <h4 className="font-medium mb-1">Status</h4>
                                            <p className="text-sm text-gray-600">{bs.status.replace('_', ' ')}</p>
                                          </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                          <div>
                                            <h4 className="font-medium mb-1">Labor Cost</h4>
                                            <p className="text-sm text-gray-600">{formatCurrency(bs.laborCost)}</p>
                                          </div>
                                          <div>
                                            <h4 className="font-medium mb-1">Parts Cost</h4>
                                            <p className="text-sm text-gray-600">{formatCurrency(bs.partsCost)}</p>
                                          </div>
                                        </div>
                                        <div>
                                          <h4 className="font-medium mb-1">Total Cost</h4>
                                          <p className="text-lg font-bold text-orange-700">{formatCurrency(bs.laborCost + bs.partsCost)}</p>
                                        </div>
                                      </div>
                                    </DialogContent>
                                  </Dialog>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </>
                    )}
                  </div>
                </TabsContent>

                {/* All Work Orders Tab */}
                <TabsContent value="work_orders">
                  <div className="space-y-2">
                    {customerBillingData.workOrders.length === 0 ? (
                      <Card>
                        <CardContent className="p-6 text-center text-gray-500">
                          <FileText className="w-8 h-8 mx-auto mb-2" />
                          <div className="font-medium mb-1">No work orders</div>
                          <div className="text-sm">No work orders found for this customer.</div>
                        </CardContent>
                      </Card>
                    ) : (
                      customerBillingData.workOrders.map((wo) => (
                        <Card key={wo.id}>
                          <CardContent className="p-3">
                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <FileText className="w-4 h-4 text-gray-400" />
                                  <span className="font-medium text-sm">WO #{wo.id}</span>
                                  {getStatusBadge(wo.status)}
                                </div>
                                <div className="text-xs text-gray-600 mb-2">
                                  {wo.description}
                                </div>
                                <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                                  <div className="flex items-center gap-1">
                                    <Calendar className="w-3 h-3" />
                                    {new Date(wo.scheduledDate).toLocaleDateString()}
                                  </div>
                                  {wo.assignedTo && (
                                    <div className="flex items-center gap-1">
                                      <User className="w-3 h-3" />
                                      {wo.assignedTo}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="text-sm font-medium">
                                  {formatCurrency(wo.laborCost + wo.partsCost)}
                                </div>
                                <Dialog>
                                  <DialogTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setSelectedWorkOrder(wo)}
                                      className="h-6 px-2 text-xs"
                                    >
                                      View
                                    </Button>
                                  </DialogTrigger>
                                  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                                    <DialogHeader>
                                      <DialogTitle className="flex items-center gap-2">
                                        <FileText className="w-4 h-4" />
                                        Work Order #{wo.id}
                                        {getStatusBadge(wo.status)}
                                      </DialogTitle>
                                    </DialogHeader>
                                    <div className="space-y-4">
                                      <div>
                                        <h4 className="font-medium mb-2">Description</h4>
                                        <p className="text-sm text-gray-600">{wo.description}</p>
                                      </div>
                                      <div className="grid grid-cols-2 gap-4">
                                        <div>
                                          <h4 className="font-medium mb-1">Scheduled Date</h4>
                                          <p className="text-sm text-gray-600">{new Date(wo.scheduledDate).toLocaleDateString()}</p>
                                        </div>
                                        <div>
                                          <h4 className="font-medium mb-1">Status</h4>
                                          <p className="text-sm text-gray-600">{wo.status.replace('_', ' ')}</p>
                                        </div>
                                      </div>
                                      <div className="grid grid-cols-2 gap-4">
                                        <div>
                                          <h4 className="font-medium mb-1">Labor Cost</h4>
                                          <p className="text-sm text-gray-600">{formatCurrency(wo.laborCost)}</p>
                                        </div>
                                        <div>
                                          <h4 className="font-medium mb-1">Parts Cost</h4>
                                          <p className="text-sm text-gray-600">{formatCurrency(wo.partsCost)}</p>
                                        </div>
                                      </div>
                                      <div>
                                        <h4 className="font-medium mb-1">Total Cost</h4>
                                        <p className="text-lg font-bold">{formatCurrency(wo.laborCost + wo.partsCost)}</p>
                                      </div>
                                    </div>
                                  </DialogContent>
                                </Dialog>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </div>
                </TabsContent>

                {/* Billing Sheets Tab */}
                <TabsContent value="billing_sheets">
                  <div className="space-y-2">
                    {customerBillingData.billingSheets.length === 0 ? (
                      <Card>
                        <CardContent className="p-6 text-center text-gray-500">
                          <Receipt className="w-8 h-8 mx-auto mb-2" />
                          <div className="font-medium mb-1">No billing sheets</div>
                          <div className="text-sm">No billing sheets found for this customer.</div>
                        </CardContent>
                      </Card>
                    ) : (
                      customerBillingData.billingSheets.map((bs) => (
                        <Card key={bs.id}>
                          <CardContent className="p-3">
                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <Receipt className="w-4 h-4 text-gray-400" />
                                  <span className="font-medium text-sm">BS #{bs.id}</span>
                                  {getStatusBadge(bs.status)}
                                </div>
                                <div className="text-xs text-gray-600 mb-2">
                                  {bs.description || 'Billing Sheet'}
                                </div>
                                <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                                  <div className="flex items-center gap-1">
                                    <Calendar className="w-3 h-3" />
                                    {new Date(bs.createdAt).toLocaleDateString()}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="text-sm font-medium">
                                  {formatCurrency(bs.laborCost + bs.partsCost)}
                                </div>
                                <Dialog>
                                  <DialogTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setSelectedBillingSheet(bs)}
                                      className="h-6 px-2 text-xs"
                                    >
                                      View
                                    </Button>
                                  </DialogTrigger>
                                  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                                    <DialogHeader>
                                      <DialogTitle className="flex items-center gap-2">
                                        <Receipt className="w-4 h-4" />
                                        Billing Sheet #{bs.id}
                                        {getStatusBadge(bs.status)}
                                      </DialogTitle>
                                    </DialogHeader>
                                    <div className="space-y-4">
                                      <div>
                                        <h4 className="font-medium mb-2">Description</h4>
                                        <p className="text-sm text-gray-600">{bs.description || 'No description provided'}</p>
                                      </div>
                                      <div className="grid grid-cols-2 gap-4">
                                        <div>
                                          <h4 className="font-medium mb-1">Created Date</h4>
                                          <p className="text-sm text-gray-600">{new Date(bs.createdAt).toLocaleDateString()}</p>
                                        </div>
                                        <div>
                                          <h4 className="font-medium mb-1">Status</h4>
                                          <p className="text-sm text-gray-600">{bs.status.replace('_', ' ')}</p>
                                        </div>
                                      </div>
                                      <div className="grid grid-cols-2 gap-4">
                                        <div>
                                          <h4 className="font-medium mb-1">Labor Cost</h4>
                                          <p className="text-sm text-gray-600">{formatCurrency(bs.laborCost)}</p>
                                        </div>
                                        <div>
                                          <h4 className="font-medium mb-1">Parts Cost</h4>
                                          <p className="text-sm text-gray-600">{formatCurrency(bs.partsCost)}</p>
                                        </div>
                                      </div>
                                      <div>
                                        <h4 className="font-medium mb-1">Total Cost</h4>
                                        <p className="text-lg font-bold">{formatCurrency(bs.laborCost + bs.partsCost)}</p>
                                      </div>
                                    </div>
                                  </DialogContent>
                                </Dialog>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </div>
                </TabsContent>

                {/* Estimates Tab */}
                <TabsContent value="estimates">
                  <div className="space-y-2">
                    {customerBillingData.estimates.length === 0 ? (
                      <Card>
                        <CardContent className="p-6 text-center text-gray-500">
                          <DollarSign className="w-8 h-8 mx-auto mb-2" />
                          <div className="font-medium mb-1">No estimates</div>
                          <div className="text-sm">No estimates found for this customer.</div>
                        </CardContent>
                      </Card>
                    ) : (
                      customerBillingData.estimates.map((estimate) => (
                        <Card key={estimate.id}>
                          <CardContent className="p-3">
                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <DollarSign className="w-4 h-4 text-gray-400" />
                                  <span className="font-medium text-sm">EST #{estimate.id}</span>
                                  {getStatusBadge(estimate.status)}
                                </div>
                                <div className="text-xs text-gray-600 mb-2">
                                  {estimate.description}
                                </div>
                                <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                                  <div className="flex items-center gap-1">
                                    <Calendar className="w-3 h-3" />
                                    {new Date(estimate.createdAt).toLocaleDateString()}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="text-sm font-medium">
                                  {formatCurrency(estimate.laborCost + estimate.partsCost)}
                                </div>
                                <Dialog>
                                  <DialogTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setSelectedEstimate(estimate)}
                                      className="h-6 px-2 text-xs"
                                    >
                                      View
                                    </Button>
                                  </DialogTrigger>
                                  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                                    <DialogHeader>
                                      <DialogTitle className="flex items-center gap-2">
                                        <DollarSign className="w-4 h-4" />
                                        Estimate #{estimate.id}
                                        {getStatusBadge(estimate.status)}
                                      </DialogTitle>
                                    </DialogHeader>
                                    <div className="space-y-4">
                                      <div>
                                        <h4 className="font-medium mb-2">Description</h4>
                                        <p className="text-sm text-gray-600">{estimate.description}</p>
                                      </div>
                                      <div className="grid grid-cols-2 gap-4">
                                        <div>
                                          <h4 className="font-medium mb-1">Created Date</h4>
                                          <p className="text-sm text-gray-600">{new Date(estimate.createdAt).toLocaleDateString()}</p>
                                        </div>
                                        <div>
                                          <h4 className="font-medium mb-1">Status</h4>
                                          <p className="text-sm text-gray-600">{estimate.status.replace('_', ' ')}</p>
                                        </div>
                                      </div>
                                      <div className="grid grid-cols-2 gap-4">
                                        <div>
                                          <h4 className="font-medium mb-1">Labor Cost</h4>
                                          <p className="text-sm text-gray-600">{formatCurrency(estimate.laborCost)}</p>
                                        </div>
                                        <div>
                                          <h4 className="font-medium mb-1">Parts Cost</h4>
                                          <p className="text-sm text-gray-600">{formatCurrency(estimate.partsCost)}</p>
                                        </div>
                                      </div>
                                      <div>
                                        <h4 className="font-medium mb-1">Total Cost</h4>
                                        <p className="text-lg font-bold">{formatCurrency(estimate.laborCost + estimate.partsCost)}</p>
                                      </div>
                                    </div>
                                  </DialogContent>
                                </Dialog>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </div>
                </TabsContent>
              </Tabs>
              </div>
            ) : (
              <Card>
                <CardContent className="p-8 text-center">
                  <div className="text-gray-500">No billing data found for this customer.</div>
                </CardContent>
              </Card>
            )
          ) : (
            <Card>
              <CardContent className="p-8 text-center">
                <div className="text-gray-500">
                  <User className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <div className="font-medium mb-2">Select a customer</div>
                  <div className="text-sm">Choose a customer from the list to view their billing information.</div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
