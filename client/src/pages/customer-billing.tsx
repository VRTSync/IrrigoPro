import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
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
import { InvoiceList } from "@/components/billing/invoice-list";
import { InvoicePdfPreviewModal } from "@/components/billing/invoice-pdf-preview-modal";

// Extended interfaces for billing data with transformed fields
interface BillingWorkOrder extends WorkOrder {
  laborCost: number;
  partsCost: number;
  assignedTo: string;
  description: string;
  billedDate: Date | null;
  completedDate: Date | null;
}

interface BillingBillingSheet extends BillingSheet {
  laborCost: number;
  partsCost: number;
  description: string;
  billedDate: Date | null;
  completedDate: Date | null;
}

interface BillingEstimate extends Estimate {
  laborCost: number;
  partsCost: number;
  description: string;
  billedDate: Date | null;
  completedDate: Date | null;
}

interface CustomerBillingData {
  customer: Customer;
  workOrders: BillingWorkOrder[];
  billingSheets: BillingBillingSheet[];
  estimates: BillingEstimate[];
  unbilledWorkOrders: BillingWorkOrder[];
  unbilledBillingSheets: BillingBillingSheet[];
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
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<BillingWorkOrder | null>(null);
  const [selectedBillingSheet, setSelectedBillingSheet] = useState<BillingBillingSheet | null>(null);
  const [selectedEstimate, setSelectedEstimate] = useState<BillingEstimate | null>(null);
  const [showInvoicePreview, setShowInvoicePreview] = useState(false);
  const [previewInvoiceData, setPreviewInvoiceData] = useState<any>(null);
  
  // Item selection for invoice preview
  const [showItemSelection, setShowItemSelection] = useState(false);
  const [selectedWorkOrderIds, setSelectedWorkOrderIds] = useState<Set<number>>(new Set());
  const [selectedBillingSheetIds, setSelectedBillingSheetIds] = useState<Set<number>>(new Set());
  
  // Filter states
  const [dateFilter, setDateFilter] = useState<string>("last_30_days"); // Default to last 30 days
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [amountFilter, setAmountFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isFiltersExpanded, setIsFiltersExpanded] = useState(false);
  
  // PDF modal state
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [selectedPdfInvoice, setSelectedPdfInvoice] = useState<{
    invoiceId: number;
    invoiceNumber: string;
    customerEmail: string;
  } | null>(null);
  
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
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('dateFilter', dateFilter);
      if (selectedMonth) {
        params.append('selectedMonth', selectedMonth);
      }
      try {
        const response = await fetch(`/api/customers/billing-preview?${params.toString()}`);
        if (!response.ok) {
          return [];
        }
        const data = await response.json();
        return Array.isArray(data) ? data : [];
      } catch (error) {
        return [];
      }
    }
  });

  // Create a map for easy lookup of preview data by customer ID
  const previewMap = Array.isArray(customerPreviews) ? customerPreviews.reduce((map, preview) => {
    map[preview.id] = preview;
    return map;
  }, {} as Record<number, any>) : {};

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

  // Selection helper functions
  const toggleWorkOrderSelection = (workOrderId: number) => {
    setSelectedWorkOrderIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(workOrderId)) {
        newSet.delete(workOrderId);
      } else {
        newSet.add(workOrderId);
      }
      return newSet;
    });
  };

  const toggleBillingSheetSelection = (billingSheetId: number) => {
    setSelectedBillingSheetIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(billingSheetId)) {
        newSet.delete(billingSheetId);
      } else {
        newSet.add(billingSheetId);
      }
      return newSet;
    });
  };

  const selectAllUnbilledItems = () => {
    if (!customerBillingData) return;
    
    setSelectedWorkOrderIds(new Set(customerBillingData.unbilledWorkOrders.map(wo => wo.id)));
    setSelectedBillingSheetIds(new Set(customerBillingData.unbilledBillingSheets.map(bs => bs.id)));
  };

  const clearAllSelections = () => {
    setSelectedWorkOrderIds(new Set());
    setSelectedBillingSheetIds(new Set());
  };

  const hasAnySelection = () => {
    return selectedWorkOrderIds.size > 0 || selectedBillingSheetIds.size > 0;
  };

  // Preview Invoice Mutation
  const previewInvoiceMutation = useMutation({
    mutationFn: async ({ customerId, workOrderIds, billingSheetIds }: { 
      customerId: number, 
      workOrderIds: number[], 
      billingSheetIds: number[] 
    }) => {
      return await apiRequest("/api/invoices/preview", "POST", {
        customerId,
        workOrderIds,
        billingSheetIds
      });
    },
    onSuccess: (data) => {
      setPreviewInvoiceData(data);
      setShowInvoicePreview(true);
      setShowItemSelection(false);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Preview Invoice",
        description: error.message || "An error occurred while previewing the invoice.",
        variant: "destructive",
      });
    }
  });

  // Create Invoice Mutation (after preview confirmation)
  const createInvoiceMutation = useMutation({
    mutationFn: async ({ customerId, workOrderIds, billingSheetIds }: { 
      customerId: number, 
      workOrderIds?: number[], 
      billingSheetIds?: number[] 
    }) => {
      return await apiRequest("/api/invoices/monthly", "POST", {
        customerId,
        workOrderIds,
        billingSheetIds
      });
    },
    onSuccess: (data, { customerId }) => {
      setShowInvoicePreview(false);
      setPreviewInvoiceData(null);
      // Clear selections after successful invoice creation
      setSelectedWorkOrderIds(new Set());
      setSelectedBillingSheetIds(new Set());
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
    createInvoiceMutation.mutate({ customerId });
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

  // Handle opening PDF modal
  const handleOpenPdf = (invoiceId: number, invoiceNumber: string, customerEmail: string) => {
    setSelectedPdfInvoice({ invoiceId, invoiceNumber, customerEmail });
    setShowPdfModal(true);
  };

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

  const formatDate = (date: string | Date | null) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString();
  };
  
  const formatDateWithOptions = (date: string | Date | null, options?: Intl.DateTimeFormatOptions) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-US', options);
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
      {/* Mobile: Two-Screen Navigation */}
      <div className="lg:hidden w-full h-full bg-white flex flex-col">
        {!selectedCustomerId ? (
          /* Screen 1: Customer List (Full Screen) */
          <div className="flex flex-col h-full">
            {/* Header */}
            <div className="p-4 border-b border-gray-200 bg-white">
              <h1 className="text-xl font-bold text-gray-900 mb-4">Customer Billing</h1>
              
              {/* Summary Stats */}
              {!loadingCustomers && !loadingPreviews && customers.length > 0 && (
                <div className="mb-4">
                  <div className="bg-orange-50 p-4 rounded-lg text-center">
                    <div className="text-xs text-orange-700 font-medium">Total Unbilled</div>
                    <div className="text-lg font-bold text-orange-800">
                      {formatCurrency(
                        customerPreviews.reduce((sum, preview) => sum + (preview.unbilledAmount || 0), 0)
                      )}
                    </div>
                    <div className="text-xs text-orange-600 mt-1">
                      {customerPreviews.filter(preview => (preview.unbilledAmount || 0) > 0).length} customers need billing
                    </div>
                  </div>
                </div>
              )}

              {/* Search Bar */}
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Search customers..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Filter Controls */}
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

                    {/* Month Selector */}
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

            {/* Customer List (Scrollable) */}
            <div className="flex-1 overflow-y-auto">
              {loadingCustomers ? (
                <div className="p-4 text-center">
                  <div className="text-gray-500">Loading customers...</div>
                </div>
              ) : filteredCustomers.length === 0 ? (
                <div className="p-4 text-center">
                  <div className="text-gray-500">No customers found</div>
                </div>
              ) : (
                <div className="space-y-2 p-4">
                  {filteredCustomers.map((customer) => {
                    const preview = getCustomerPreview(customer);
                    return (
                      <Card
                        key={customer.id}
                        className="p-4 cursor-pointer hover:shadow-md transition-shadow border border-gray-200"
                        onClick={() => setSelectedCustomerId(customer.id)}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-medium text-base text-gray-900">{customer.name}</div>
                          {preview.billingPace >= 1.3 ? (
                            <Badge className="bg-green-100 text-green-800 text-xs">ABOVE AVG</Badge>
                          ) : preview.billingPace <= 0.7 ? (
                            <Badge className="bg-red-100 text-red-800 text-xs">BELOW AVG</Badge>
                          ) : (
                            <Badge className="bg-blue-100 text-blue-800 text-xs">ON PACE</Badge>
                          )}
                        </div>
                        <div className="text-sm text-gray-600 mb-2">{customer.email}</div>
                        {customer.phone && (
                          <div className="text-sm text-gray-600 mb-2">{customer.phone}</div>
                        )}
                        {preview.unbilledAmount > 0 && (
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-orange-700 font-medium">Unbilled Work:</span>
                            <Badge className="bg-orange-100 text-orange-800">
                              {formatCurrency(preview.unbilledAmount)}
                            </Badge>
                          </div>
                        )}
                        {customer.address && (
                          <div className="text-xs text-gray-500 mt-2 truncate">{customer.address}</div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Screen 2: Customer Details (Full Screen) */
          <div className="flex flex-col h-full">
            {/* Header with Back Button */}
            <div className="p-4 border-b border-gray-200 bg-white">
              <div className="flex items-center justify-between mb-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedCustomerId(null)}
                  className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
                >
                  <ChevronDown className="w-4 h-4 rotate-90" />
                  Back to Customers
                </Button>
                <div className="text-sm text-gray-500">
                  {customers.findIndex(c => c.id === selectedCustomerId) + 1} of {customers.length}
                </div>
              </div>
              
              {selectedCustomer && (
                <div>
                  <h1 className="text-xl font-bold text-gray-900">{selectedCustomer.name}</h1>
                  <div className="text-sm text-gray-600">{selectedCustomer.email}</div>
                  {selectedCustomer.phone && (
                    <div className="text-sm text-gray-600">{selectedCustomer.phone}</div>
                  )}
                  {(() => {
                    const preview = getCustomerPreview(selectedCustomer);
                    return preview.unbilledAmount > 0 ? (
                      <div className="mt-2">
                        <Badge className="bg-orange-100 text-orange-800">
                          Unbilled: {formatCurrency(preview.unbilledAmount)}
                        </Badge>
                      </div>
                    ) : null;
                  })()}
                </div>
              )}
            </div>

            {/* Customer Details Content */}
            <div className="flex-1 overflow-y-auto">
              {loadingCustomerData ? (
                <div className="p-4 text-center">
                  <div className="text-gray-500">Loading customer billing data...</div>
                </div>
              ) : customerBillingData ? (
                <div className="space-y-3 p-4">
                  {/* Billing Summary Card - Mobile optimized */}
                  <div className="grid grid-cols-1 gap-3">
                    {/* Unbilled Work Summary */}
                    <Card className="border-orange-200 bg-orange-50">
                      <CardHeader className="pb-2 p-3">
                        <div className="flex items-center justify-between">
                          <CardTitle className="flex items-center gap-1 text-orange-800 text-sm">
                            <AlertTriangle className="w-4 h-4" />
                            Unbilled Work
                          </CardTitle>
                          <Badge className="bg-orange-100 text-orange-800 text-sm">
                            {formatCurrency(customerBillingData.totalUnbilledAmount)}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0 px-3 pb-3">
                        <div className="space-y-2">
                          <div className="text-sm text-orange-700">
                            {customerBillingData.unbilledWorkOrders.length} Work Orders, {customerBillingData.unbilledBillingSheets.length} Billing Sheets ready
                          </div>
                          <Button
                            onClick={() => {
                              // Auto-select all unbilled items when opening
                              selectAllUnbilledItems();
                              setShowItemSelection(true);
                            }}
                            disabled={customerBillingData.totalUnbilledAmount === 0}
                            className="bg-orange-600 hover:bg-orange-700 text-white w-full h-10 text-sm"
                          >
                            <Receipt className="w-4 h-4 mr-2" />
                            Select Items to Invoice
                          </Button>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Mobile Customer Info */}
                    <Card>
                      <CardHeader className="pb-2 p-3">
                        <CardTitle className="text-base">Customer Details</CardTitle>
                      </CardHeader>
                      <CardContent className="px-3 pb-3">
                        <div className="space-y-2 text-sm">
                          <div className="flex items-center gap-2">
                            <Mail className="w-4 h-4 text-gray-500" />
                            <span className="break-all">{customerBillingData.customer.email}</span>
                          </div>
                          {customerBillingData.customer.phone && (
                            <div className="flex items-center gap-2">
                              <Phone className="w-4 h-4 text-gray-500" />
                              {customerBillingData.customer.phone}
                            </div>
                          )}
                          {customerBillingData.customer.address && (
                            <div className="flex items-center gap-2">
                              <MapPin className="w-4 h-4 text-gray-500" />
                              <span className="break-words">{customerBillingData.customer.address}</span>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Mobile Tabs for Work Orders, Billing Sheets, etc. */}
                  <Tabs defaultValue="unbilled" className="w-full">
                    <TabsList className="grid w-full grid-cols-5 text-xs h-10">
                      <TabsTrigger value="unbilled" className="text-xs">
                        Unbilled ({customerBillingData.unbilledWorkOrders.length + customerBillingData.unbilledBillingSheets.length})
                      </TabsTrigger>
                      <TabsTrigger value="workorders" className="text-xs">
                        Work Orders ({customerBillingData.workOrders.length})
                      </TabsTrigger>
                      <TabsTrigger value="billing" className="text-xs">
                        Billing ({customerBillingData.billingSheets.length})
                      </TabsTrigger>
                      <TabsTrigger value="estimates" className="text-xs">
                        Estimates ({customerBillingData.estimates.length})
                      </TabsTrigger>
                      <TabsTrigger value="invoices" className="text-xs">
                        Invoices
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="unbilled" className="mt-3">
                      <div className="space-y-2">
                        {/* Unbilled Work Orders */}
                        {customerBillingData.unbilledWorkOrders.length > 0 && (
                          <div>
                            <h4 className="font-medium text-sm text-gray-900 mb-2">Unbilled Work Orders</h4>
                            {customerBillingData.unbilledWorkOrders.map((workOrder) => (
                              <Card key={workOrder.id} className="mb-2">
                                <CardContent className="p-3">
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="text-sm font-medium">#{workOrder.id}</div>
                                    <Badge>{getStatusBadge(workOrder.status)}</Badge>
                                  </div>
                                  <div className="text-xs text-gray-600 mb-2">{workOrder.description}</div>
                                  <div className="flex justify-between text-sm">
                                    <span>Total:</span>
                                    <span className="font-medium">{formatCurrency(workOrder.laborCost + workOrder.partsCost)}</span>
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        )}

                        {/* Unbilled Billing Sheets */}
                        {customerBillingData.unbilledBillingSheets.length > 0 && (
                          <div>
                            <h4 className="font-medium text-sm text-gray-900 mb-2">Unbilled Billing Sheets</h4>
                            {customerBillingData.unbilledBillingSheets.map((billingSheet) => (
                              <Card key={billingSheet.id} className="mb-2">
                                <CardContent className="p-3">
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="text-sm font-medium">#{billingSheet.id}</div>
                                    <Badge>{getStatusBadge(billingSheet.status)}</Badge>
                                  </div>
                                  <div className="text-xs text-gray-600 mb-2">{billingSheet.description}</div>
                                  <div className="flex justify-between text-sm">
                                    <span>Total:</span>
                                    <span className="font-medium">{formatCurrency(billingSheet.laborCost + billingSheet.partsCost)}</span>
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        )}

                        {customerBillingData.unbilledWorkOrders.length === 0 && customerBillingData.unbilledBillingSheets.length === 0 && (
                          <div className="text-center py-6 text-gray-500 text-sm">
                            No unbilled work found
                          </div>
                        )}
                      </div>
                    </TabsContent>

                    <TabsContent value="workorders" className="mt-3">
                      <div className="space-y-2">
                        {customerBillingData.workOrders.length > 0 ? (
                          customerBillingData.workOrders.map((workOrder) => (
                            <Card key={workOrder.id}>
                              <CardContent className="p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="text-sm font-medium">#{workOrder.id}</div>
                                  <Badge>{getStatusBadge(workOrder.status)}</Badge>
                                </div>
                                <div className="text-xs text-gray-600 mb-2">{workOrder.description}</div>
                                <div className="text-xs text-gray-500 mb-2">
                                  Assigned to: {workOrder.assignedTo}
                                </div>
                                <div className="flex justify-between text-sm">
                                  <span>Total:</span>
                                  <span className="font-medium">{formatCurrency(workOrder.laborCost + workOrder.partsCost)}</span>
                                </div>
                                {workOrder.completedAt && (
                                  <div className="text-xs text-gray-500 mt-1">
                                    Completed: {formatDate(workOrder.completedAt)}
                                  </div>
                                )}
                              </CardContent>
                            </Card>
                          ))
                        ) : (
                          <div className="text-center py-6 text-gray-500 text-sm">
                            No work orders found
                          </div>
                        )}
                      </div>
                    </TabsContent>

                    <TabsContent value="billing" className="mt-3">
                      <div className="space-y-2">
                        {customerBillingData.billingSheets.length > 0 ? (
                          customerBillingData.billingSheets.map((billingSheet) => (
                            <Card key={billingSheet.id}>
                              <CardContent className="p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="text-sm font-medium">#{billingSheet.id}</div>
                                  <Badge>{getStatusBadge(billingSheet.status)}</Badge>
                                </div>
                                <div className="text-xs text-gray-600 mb-2">{billingSheet.description}</div>
                                <div className="flex justify-between text-sm">
                                  <span>Total:</span>
                                  <span className="font-medium">{formatCurrency(billingSheet.laborCost + billingSheet.partsCost)}</span>
                                </div>
                                {billingSheet.workDate && (
                                  <div className="text-xs text-gray-500 mt-1">
                                    Work Date: {formatDate(billingSheet.workDate)}
                                  </div>
                                )}
                              </CardContent>
                            </Card>
                          ))
                        ) : (
                          <div className="text-center py-6 text-gray-500 text-sm">
                            No billing sheets found
                          </div>
                        )}
                      </div>
                    </TabsContent>

                    <TabsContent value="estimates" className="mt-3">
                      <div className="space-y-2">
                        {customerBillingData.estimates.length > 0 ? (
                          customerBillingData.estimates.map((estimate) => (
                            <Card key={estimate.id}>
                              <CardContent className="p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="text-sm font-medium">#{estimate.id}</div>
                                  <Badge>{getStatusBadge(estimate.status)}</Badge>
                                </div>
                                <div className="text-xs text-gray-600 mb-2">{estimate.description}</div>
                                <div className="flex justify-between text-sm">
                                  <span>Total:</span>
                                  <span className="font-medium">{formatCurrency(estimate.laborCost + estimate.partsCost)}</span>
                                </div>
                              </CardContent>
                            </Card>
                          ))
                        ) : (
                          <div className="text-center py-6 text-gray-500 text-sm">
                            No estimates found
                          </div>
                        )}
                      </div>
                    </TabsContent>

                    <TabsContent value="invoices" className="mt-3">
                      <InvoiceList 
                        customerId={selectedCustomerId} 
                        onOpenPdf={handleOpenPdf}
                      />
                    </TabsContent>
                  </Tabs>
                </div>
              ) : (
                <div className="p-4 text-center">
                  <div className="text-gray-500">No billing data available</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Desktop: Left Sidebar - Customer List */}
      <div className="hidden lg:flex lg:w-1/3 bg-white border-r border-gray-200 flex-col">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-xl font-bold text-gray-900 mb-4">Customer Billing</h1>
          

          
          {/* Summary Stats */}
          {!loadingCustomers && !loadingPreviews && customers.length > 0 && (
            <div className="mb-4">
              <div className="bg-orange-50 p-3 rounded-lg text-center">
                <div className="text-xs text-orange-700 font-medium">Total Unbilled</div>
                <div className="text-lg font-bold text-orange-800">
                  {formatCurrency(
                    customerPreviews.reduce((sum, preview) => sum + (preview.unbilledAmount || 0), 0)
                  )}
                </div>
                <div className="text-xs text-orange-600 mt-1">
                  {customerPreviews.filter(preview => (preview.unbilledAmount || 0) > 0).length} customers need billing
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
                  ? Math.floor((Date.now() - new Date(preview.lastInvoiceDate!).getTime()) / (1000 * 60 * 60 * 24))
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
                      {preview.unbilledAmount > 0 ? (
                        <Badge className="bg-orange-100 text-orange-800 text-xs">
                          NEEDS BILLING
                        </Badge>
                      ) : (
                        <Badge className="bg-green-100 text-green-800 text-xs">
                          UP TO DATE
                        </Badge>
                      )}
                    </div>

                    <div className="text-xs text-gray-600 mb-2 truncate">{customer.email}</div>
                    
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">This month:</span>
                        <span className="text-xs font-medium">
                          {formatCurrency(preview.currentMonthBilling)}
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
                            {formatDateWithOptions(preview.lastInvoiceDate, { 
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
                        onClick={() => {
                          // Auto-select all unbilled items when opening
                          selectAllUnbilledItems();
                          setShowItemSelection(true);
                        }}
                        disabled={customerBillingData.totalUnbilledAmount === 0}
                        className="bg-orange-600 hover:bg-orange-700 text-white w-full h-8 text-xs"
                      >
                        <Receipt className="w-3 h-3 mr-1" />
                        Select Items to Invoice
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
                <TabsList className="grid w-full grid-cols-5 h-8">
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
                  <TabsTrigger value="invoices" className="text-xs px-2">
                    Invoices
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
                                      {formatDate(wo.scheduledDate)}
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
                                            <p className="text-sm text-gray-600">{formatDate(wo.scheduledDate)}</p>
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
                                      {formatDate(bs.workDate)}
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
                                            <p className="text-sm text-gray-600">{formatDate(bs.workDate)}</p>
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
                                  {wo.completedAt && (
                                    <div className="flex items-center gap-1">
                                      <Calendar className="w-3 h-3" />
                                      Completed: {formatDate(wo.completedAt)}
                                    </div>
                                  )}
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
                                          <p className="text-sm text-gray-600">{wo.scheduledDate ? new Date(wo.scheduledDate).toLocaleDateString() : 'Not scheduled'}</p>
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
                                  {bs.workDate && (
                                    <div className="flex items-center gap-1">
                                      <Calendar className="w-3 h-3" />
                                      Work Date: {formatDate(bs.workDate)}
                                    </div>
                                  )}
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

                {/* Invoices Tab */}
                <TabsContent value="invoices">
                  <div className="mt-3">
                    <InvoiceList 
                      customerId={selectedCustomerId} 
                      onOpenPdf={handleOpenPdf}
                    />
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

      {/* Invoice Preview Dialog */}
      <Dialog open={showInvoicePreview} onOpenChange={setShowInvoicePreview}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="w-5 h-5" />
              Invoice Preview
            </DialogTitle>
          </DialogHeader>
          
          {previewInvoiceData && (
            <div className="space-y-6">
              {/* Invoice Header */}
              <div className="border-b pb-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h3 className="font-semibold text-lg mb-2">Invoice Details</h3>
                    <div className="space-y-1 text-sm">
                      <div><span className="font-medium">Invoice #:</span> {previewInvoiceData.invoiceNumber}</div>
                      <div><span className="font-medium">Date:</span> {formatDate(new Date())}</div>
                      <div><span className="font-medium">Period:</span> {formatDate(previewInvoiceData.periodStart)} - {formatDate(previewInvoiceData.periodEnd)}</div>
                    </div>
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg mb-2">Bill To</h3>
                    <div className="space-y-1 text-sm">
                      <div className="font-medium">{previewInvoiceData.customerName}</div>
                      <div>{previewInvoiceData.customerEmail}</div>
                      {previewInvoiceData.customerPhone && <div>{previewInvoiceData.customerPhone}</div>}
                    </div>
                  </div>
                </div>
              </div>

              {/* Invoice Items */}
              <div>
                <h3 className="font-semibold text-lg mb-3">Invoice Items</h3>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left p-3 font-medium">Description</th>
                        <th className="text-right p-3 font-medium">Date</th>
                        <th className="text-right p-3 font-medium">Labor Hours</th>
                        <th className="text-right p-3 font-medium">Labor</th>
                        <th className="text-right p-3 font-medium">Parts</th>
                        <th className="text-right p-3 font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {previewInvoiceData.items?.map((item: any, index: number) => (
                        <tr key={index}>
                          <td className="p-3">
                            <div className="font-medium">{item.description}</div>
                            <div className="text-sm text-gray-600">{item.technicianName}</div>
                          </td>
                          <td className="p-3 text-right text-sm">{formatDate(item.workDate)}</td>
                          <td className="p-3 text-right">{item.laborHours || '0.00'}</td>
                          <td className="p-3 text-right">{formatCurrency(item.laborAmount || 0)}</td>
                          <td className="p-3 text-right">{formatCurrency(item.partsAmount || 0)}</td>
                          <td className="p-3 text-right font-medium">{formatCurrency(item.totalAmount || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Invoice Summary */}
              <div className="border-t pt-4">
                <div className="flex justify-end">
                  <div className="w-64 space-y-2">
                    <div className="flex justify-between">
                      <span>Labor Subtotal:</span>
                      <span>{formatCurrency(previewInvoiceData.laborSubtotal)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Parts Subtotal:</span>
                      <span>{formatCurrency(previewInvoiceData.partsSubtotal)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Markup:</span>
                      <span>{formatCurrency(previewInvoiceData.markupAmount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Tax:</span>
                      <span>{formatCurrency(previewInvoiceData.taxAmount)}</span>
                    </div>
                    <div className="flex justify-between border-t pt-2 font-bold text-lg">
                      <span>Total:</span>
                      <span>{formatCurrency(previewInvoiceData.totalAmount)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end space-x-3 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => setShowInvoicePreview(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => createInvoiceMutation.mutate({
                    customerId: selectedCustomerId!,
                    workOrderIds: Array.from(selectedWorkOrderIds),
                    billingSheetIds: Array.from(selectedBillingSheetIds)
                  })}
                  disabled={createInvoiceMutation.isPending}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {createInvoiceMutation.isPending ? (
                    <>
                      <Clock className="w-4 h-4 mr-2 animate-spin" />
                      Creating & Sending to QuickBooks...
                    </>
                  ) : (
                    <>
                      <Receipt className="w-4 h-4 mr-2" />
                      Create Invoice & Send to QuickBooks
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Item Selection Dialog */}
      <Dialog open={showItemSelection} onOpenChange={setShowItemSelection}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="w-5 h-5" />
              Select Items to Invoice
            </DialogTitle>
          </DialogHeader>
          
          {customerBillingData && (
            <div className="space-y-6">
              {/* Selection Controls */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={selectAllUnbilledItems}
                    className="text-sm"
                  >
                    <CheckCircle className="w-4 h-4 mr-1" />
                    Select All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearAllSelections}
                    className="text-sm"
                  >
                    <X className="w-4 h-4 mr-1" />
                    Clear All
                  </Button>
                </div>
                <div className="text-sm text-gray-600">
                  {selectedWorkOrderIds.size + selectedBillingSheetIds.size} item(s) selected
                </div>
              </div>

              {/* Work Orders Section */}
              {customerBillingData.unbilledWorkOrders.length > 0 && (
                <div>
                  <h3 className="font-medium text-lg mb-3 flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    Unbilled Work Orders ({customerBillingData.unbilledWorkOrders.length})
                  </h3>
                  <div className="space-y-2">
                    {customerBillingData.unbilledWorkOrders.map((workOrder) => (
                      <Card key={workOrder.id} className={`cursor-pointer transition-all ${
                        selectedWorkOrderIds.has(workOrder.id) ? 'ring-2 ring-blue-500 bg-blue-50' : ''
                      }`}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <Checkbox
                                checked={selectedWorkOrderIds.has(workOrder.id)}
                                onCheckedChange={() => toggleWorkOrderSelection(workOrder.id)}
                              />
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="font-medium">Work Order #{workOrder.id}</span>
                                  {getStatusBadge(workOrder.status)}
                                </div>
                                <div className="text-sm text-gray-600 mb-2">
                                  {workOrder.description}
                                </div>
                                <div className="text-xs text-gray-500">
                                  Assigned to: {workOrder.assignedTo}
                                </div>
                                {workOrder.completedAt && (
                                  <div className="text-xs text-gray-500">
                                    Completed: {formatDate(workOrder.completedAt)}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-medium text-lg">
                                {formatCurrency(workOrder.laborCost + workOrder.partsCost)}
                              </div>
                              <div className="text-xs text-gray-500">
                                Labor: {formatCurrency(workOrder.laborCost)}
                              </div>
                              <div className="text-xs text-gray-500">
                                Parts: {formatCurrency(workOrder.partsCost)}
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              {/* Billing Sheets Section */}
              {customerBillingData.unbilledBillingSheets.length > 0 && (
                <div>
                  <h3 className="font-medium text-lg mb-3 flex items-center gap-2">
                    <DollarSign className="w-5 h-5" />
                    Unbilled Billing Sheets ({customerBillingData.unbilledBillingSheets.length})
                  </h3>
                  <div className="space-y-2">
                    {customerBillingData.unbilledBillingSheets.map((billingSheet) => (
                      <Card key={billingSheet.id} className={`cursor-pointer transition-all ${
                        selectedBillingSheetIds.has(billingSheet.id) ? 'ring-2 ring-blue-500 bg-blue-50' : ''
                      }`}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <Checkbox
                                checked={selectedBillingSheetIds.has(billingSheet.id)}
                                onCheckedChange={() => toggleBillingSheetSelection(billingSheet.id)}
                              />
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="font-medium">Billing Sheet #{billingSheet.id}</span>
                                  {getStatusBadge(billingSheet.status)}
                                </div>
                                <div className="text-sm text-gray-600 mb-2">
                                  {billingSheet.description}
                                </div>
                                {billingSheet.workDate && (
                                  <div className="text-xs text-gray-500">
                                    Work Date: {formatDate(billingSheet.workDate)}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-medium text-lg">
                                {formatCurrency(billingSheet.laborCost + billingSheet.partsCost)}
                              </div>
                              <div className="text-xs text-gray-500">
                                Labor: {formatCurrency(billingSheet.laborCost)}
                              </div>
                              <div className="text-xs text-gray-500">
                                Parts: {formatCurrency(billingSheet.partsCost)}
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              {/* Summary & Actions */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="font-medium">Selected Items Summary</div>
                    <div className="text-sm text-gray-600">
                      {selectedWorkOrderIds.size} Work Orders, {selectedBillingSheetIds.size} Billing Sheets
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium text-lg">
                      Total: {formatCurrency(
                        customerBillingData.unbilledWorkOrders
                          .filter(wo => selectedWorkOrderIds.has(wo.id))
                          .reduce((sum, wo) => sum + wo.laborCost + wo.partsCost, 0) +
                        customerBillingData.unbilledBillingSheets
                          .filter(bs => selectedBillingSheetIds.has(bs.id))
                          .reduce((sum, bs) => sum + bs.laborCost + bs.partsCost, 0)
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="flex justify-end space-x-3">
                  <Button
                    variant="outline"
                    onClick={() => setShowItemSelection(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      if (!hasAnySelection()) {
                        toast({
                          title: "No Items Selected",
                          description: "Please select at least one item to preview the invoice.",
                          variant: "destructive",
                        });
                        return;
                      }
                      
                      previewInvoiceMutation.mutate({
                        customerId: selectedCustomerId!,
                        workOrderIds: Array.from(selectedWorkOrderIds),
                        billingSheetIds: Array.from(selectedBillingSheetIds)
                      });
                    }}
                    disabled={previewInvoiceMutation.isPending || !hasAnySelection()}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {previewInvoiceMutation.isPending ? (
                      <>
                        <Clock className="w-4 h-4 mr-2 animate-spin" />
                        Generating Preview...
                      </>
                    ) : (
                      <>
                        <Receipt className="w-4 h-4 mr-2" />
                        Preview Invoice ({selectedWorkOrderIds.size + selectedBillingSheetIds.size} items)
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Invoice PDF Preview Modal */}
      {selectedPdfInvoice && (
        <InvoicePdfPreviewModal
          invoiceId={selectedPdfInvoice.invoiceId}
          invoiceNumber={selectedPdfInvoice.invoiceNumber}
          customerEmail={selectedPdfInvoice.customerEmail}
          open={showPdfModal}
          onOpenChange={setShowPdfModal}
        />
      )}
    </div>
  );
}
