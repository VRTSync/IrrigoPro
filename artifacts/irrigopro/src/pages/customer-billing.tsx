import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CompletedWorkDetailModal } from "@/components/billing/completed-work-detail-modal";
import { BilledBadge, BilledIndicator } from "@/components/ui/billed-indicator";
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
  CheckCircle2,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Filter,
  X,
  Edit,
  Trash2,
  ArrowRight,
  Droplets,
  Loader2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, parseApiError, useArrayQuery } from "@/lib/queryClient";
import type { Customer, WorkOrder, BillingSheet, Estimate } from "@workspace/db/schema";
import { LIFECYCLE_TINTS, lifecycleOf } from "@workspace/shared";
import { QuickBooksIntegration } from "@/components/quickbooks/quickbooks-integration";
import { InvoiceList } from "@/components/billing/invoice-list";
import { InvoicePdfPreviewModal } from "@/components/billing/invoice-pdf-preview-modal";
import { FinancialPulseWidget } from "@/components/financial-pulse/financial-pulse-widget";
import { WetCheckBillingViewModal } from "@/components/wet-check-billings/wet-check-billing-view-modal";
import { WetCheckBillingStatusBadge } from "@/components/wet-check-billings/status-badge";

// Extended interfaces for billing data with transformed fields
interface BillingWorkOrder extends WorkOrder {
  laborCost: number;
  partsCost: number;
  assignedTo: string;
  description: string;
  billedDate: Date | null;
  completedDate: Date | null;
  hasFinancialBreakdown: boolean;
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

interface BillingWetCheckBilling {
  id: number;
  billingNumber: string;
  wetCheckId: number;
  laborCost: number;
  partsCost: number;
  description: string;
  billedDate: Date | null;
  completedDate: Date | null;
  [key: string]: unknown;
}

interface CustomerBillingData {
  customer: Customer;
  workOrders: BillingWorkOrder[];
  billingSheets: BillingBillingSheet[];
  estimates: BillingEstimate[];
  wetCheckBillings: BillingWetCheckBilling[];
  unbilledWorkOrders: BillingWorkOrder[];
  unbilledBillingSheets: BillingBillingSheet[];
  unbilledWetCheckBillings: BillingWetCheckBilling[];
  totalUnbilledAmount: number;
}

interface CustomerPreview {
  id: number;
  name: string;
  email: string;
  phone?: string;
  unbilledAmount: number;
  approvedTotal: number;
  unapprovedTotal: number;
  combinedTotal: number;
  totalUnbilled?: number;
  currentMonthUnbilled?: number;
  lastInvoiceDate?: string;
  totalWorkOrders: number;
  pendingWorkOrders: number;
  contractType?: string;
}

const MANAGER_ROLES = new Set(["irrigation_manager", "billing_manager", "company_admin", "super_admin"]);

function WetCheckBillingRow({
  wcb,
  onClick,
  userRole,
  customerId,
}: {
  wcb: BillingWetCheckBilling;
  onClick: () => void;
  userRole?: string;
  customerId?: number | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const status = String((wcb as any).status ?? "");
  const totalAmount =
    parseFloat(String((wcb as any).totalAmount ?? "0")) ||
    wcb.laborCost + wcb.partsCost;
  const invoiceId = (wcb as any).invoiceId ?? null;
  const workDate = (wcb as any).workDate ?? wcb.completedDate;
  const billed = status === "billed" || invoiceId != null;

  const showApprove =
    (status === "submitted" || status === "pending_manager_review") &&
    !!userRole && MANAGER_ROLES.has(userRole);

  const approveMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/api/wet-check-billings/${wcb.id}/approve`, "POST", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/customers", customerId, "billing"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/wet-check-billings"] });
      toast({
        title: "Wet check billing approved",
        description: `${wcb.billingNumber} is now ready to invoice.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Approve failed",
        description: error instanceof Error ? error.message : "Try again",
        variant: "destructive",
      });
    },
  });

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow border border-gray-200"
      onClick={onClick}
      data-testid={`wcb-row-${wcb.id}`}
    >
      <CardContent className="p-3">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Droplets className="w-4 h-4 text-teal-400" />
              <span className="font-medium text-sm">{wcb.billingNumber}</span>
              {status && <WetCheckBillingStatusBadge status={status} />}
              {billed && <BilledBadge />}
            </div>
            <div className="text-xs text-gray-600 mb-1">
              {wcb.description || "Wet Check Billing"}
            </div>
            {workDate && (
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <Calendar className="w-3 h-3" />
                {new Date(workDate as string).toLocaleDateString()}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium text-teal-700 whitespace-nowrap">
              {new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
              }).format(totalAmount)}
            </div>
            {showApprove && (
              <Button
                size="sm"
                onClick={(e) => { e.stopPropagation(); approveMutation.mutate(); }}
                disabled={approveMutation.isPending}
                data-testid={`approve-wcb-${wcb.id}`}
              >
                {approveMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 mr-1" />
                )}
                Approve
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CustomerBilling() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<BillingWorkOrder | null>(null);
  const [selectedBillingSheet, setSelectedBillingSheet] = useState<BillingBillingSheet | null>(null);
  const [selectedEstimate, setSelectedEstimate] = useState<BillingEstimate | null>(null);
  const [openWcbId, setOpenWcbId] = useState<number | null>(null);
  const [showWorkOrderDetail, setShowWorkOrderDetail] = useState(false);
  const [showBillingSheetDetail, setShowBillingSheetDetail] = useState(false);
  const [showInvoicePreview, setShowInvoicePreview] = useState(false);
  const [previewInvoiceData, setPreviewInvoiceData] = useState<any>(null);
  
  // Item selection for invoice preview
  const [showItemSelection, setShowItemSelection] = useState(false);
  const [selectedWorkOrderIds, setSelectedWorkOrderIds] = useState<Set<number>>(new Set());
  const [selectedBillingSheetIds, setSelectedBillingSheetIds] = useState<Set<number>>(new Set());
  const [selectedWetCheckBillingIds, setSelectedWetCheckBillingIds] = useState<Set<number>>(new Set());
  
  // Filter states
  const [dateFilter, setDateFilter] = useState<string>("last_30_days"); // Default to last 30 days
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [amountFilter, setAmountFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isFiltersExpanded, setIsFiltersExpanded] = useState(false);
  const [otherCustomersCollapsed, setOtherCustomersCollapsed] = useState(true);
  
  // PDF modal state
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [selectedPdfInvoice, setSelectedPdfInvoice] = useState<{
    invoiceId: number;
    invoiceNumber: string;
    customerEmail: string;
  } | null>(null);

  // Delete confirmation state
  const [itemToDelete, setItemToDelete] = useState<{ type: "work_order" | "billing_sheet"; id: number; label: string } | null>(null);

  // Collapsible billed sections in WO and BS tabs (collapsed by default)
  const [billedWOExpanded, setBilledWOExpanded] = useState(false);
  const [billedBSExpanded, setBilledBSExpanded] = useState(false);
  // Mobile tab billed sections (collapsed by default)
  const [mobileWOBilledExpanded, setMobileWOBilledExpanded] = useState(false);
  const [mobileBSBilledExpanded, setMobileBSBilledExpanded] = useState(false);

  // Billing period state — default to first/last day of previous calendar month
  // Use local date formatting to avoid UTC offset shifting the day
  const toLocalDateString = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const [billingPeriodStart, setBillingPeriodStart] = useState<string>(() => {
    const now = new Date();
    return toLocalDateString(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  });
  const [billingPeriodEnd, setBillingPeriodEnd] = useState<string>(() => {
    const now = new Date();
    return toLocalDateString(new Date(now.getFullYear(), now.getMonth(), 0));
  });
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const dropdownRef = useRef<HTMLDivElement>(null);

  // User role — read from localStorage (same pattern as financial-pulse.tsx)
  const userRole = (() => {
    try {
      const raw = localStorage.getItem("user");
      if (!raw) return undefined;
      const u = JSON.parse(raw);
      return u?.role as string | undefined;
    } catch { return undefined; }
  })();

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

  // Get billing-visible customers only
  const { data: customers = [], isLoading: loadingCustomers } = useArrayQuery<Customer>({
    queryKey: ["/api/customers", { billingVisible: true }],
    queryFn: () => apiRequest("/api/customers?billingVisible=true"),
  });

  // Get comprehensive customer billing data including work orders, estimates, and billing sheets
  const { data: customerPreviews = [], isLoading: loadingPreviews } = useArrayQuery<any>({
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

  const toggleWetCheckBillingSelection = (wcbId: number) => {
    setSelectedWetCheckBillingIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(wcbId)) {
        newSet.delete(wcbId);
      } else {
        newSet.add(wcbId);
      }
      return newSet;
    });
  };

  const selectAllUnbilledItems = () => {
    if (!customerBillingData) return;
    
    setSelectedWorkOrderIds(new Set(customerBillingData.unbilledWorkOrders.map(wo => wo.id)));
    setSelectedBillingSheetIds(new Set(customerBillingData.unbilledBillingSheets.map(bs => bs.id)));
    setSelectedWetCheckBillingIds(new Set((customerBillingData.unbilledWetCheckBillings ?? []).map(wcb => wcb.id)));
  };

  const clearAllSelections = () => {
    setSelectedWorkOrderIds(new Set());
    setSelectedBillingSheetIds(new Set());
    setSelectedWetCheckBillingIds(new Set());
  };

  const hasAnySelection = () => {
    return selectedWorkOrderIds.size > 0 || selectedBillingSheetIds.size > 0 || selectedWetCheckBillingIds.size > 0;
  };

  const deleteWorkOrderMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/work-orders/${id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers/billing-preview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers", selectedCustomerId, "billing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      setItemToDelete(null);
      toast({ title: "Work order deleted", description: "The work order has been removed." });
    },
    onError: (error: any) => {
      toast({ title: "Delete failed", description: parseApiError(error, "Could not delete the work order."), variant: "destructive" });
    }
  });

  // Delete billing sheet mutation
  const deleteBillingSheetMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/billing-sheets/${id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers/billing-preview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers", selectedCustomerId, "billing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing-sheets"] });
      setItemToDelete(null);
      toast({ title: "Billing sheet deleted", description: "The billing sheet has been removed." });
    },
    onError: () => {
      toast({ title: "Delete failed", description: "Could not delete the billing sheet.", variant: "destructive" });
    }
  });

  const confirmDelete = () => {
    if (!itemToDelete) return;
    if (itemToDelete.type === "work_order") {
      deleteWorkOrderMutation.mutate(itemToDelete.id);
    } else {
      deleteBillingSheetMutation.mutate(itemToDelete.id);
    }
  };

  // Preview Invoice Mutation
  const previewInvoiceMutation = useMutation({
    mutationFn: async ({ customerId, workOrderIds, billingSheetIds, wetCheckBillingIds }: { 
      customerId: number, 
      workOrderIds: number[], 
      billingSheetIds: number[],
      wetCheckBillingIds: number[]
    }) => {
      return await apiRequest("/api/invoices/preview", "POST", {
        customerId,
        workOrderIds,
        billingSheetIds,
        wetCheckBillingIds
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
    mutationFn: async ({ customerId, workOrderIds, billingSheetIds, selectedWetCheckBillingIds: wcbIds, periodStart, periodEnd }: { 
      customerId: number, 
      workOrderIds?: number[], 
      billingSheetIds?: number[],
      selectedWetCheckBillingIds?: number[],
      periodStart?: string,
      periodEnd?: string
    }) => {
      try {
        const connectionData = await apiRequest("/api/quickbooks/connection");
        if (!connectionData.isConnected) {
          throw new Error("QuickBooks is not connected. Please reconnect QuickBooks in the integrations section before creating invoices.");
        }
      } catch (err: any) {
        if (err.message?.includes("QuickBooks is not connected")) throw err;
        throw new Error("Unable to verify QuickBooks connection. Please check your QuickBooks integration and try again.");
      }

      return await apiRequest("/api/invoices/monthly", "POST", {
        customerId,
        workOrderIds,
        billingSheetIds,
        selectedWetCheckBillingIds: wcbIds,
        periodStart,
        periodEnd
      });
    },
    onSuccess: (data, { customerId }) => {
      setShowInvoicePreview(false);
      setPreviewInvoiceData(null);
      setSelectedWorkOrderIds(new Set());
      setSelectedBillingSheetIds(new Set());
      setSelectedWetCheckBillingIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['/api/wet-check-billings'] });
      const qbMessage = data.quickbooksSuccess
        ? ` and synced to QuickBooks (ID: ${data.quickbooksId})`
        : data.quickbooksError
          ? ` (QuickBooks sync skipped: ${data.quickbooksError})`
          : '';
      toast({
        title: "Invoice Created Successfully",
        description: `Monthly invoice ${data.invoiceNumber} has been created${qbMessage}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/customers", customerId, "billing"] });
      queryClient.invalidateQueries({ queryKey: ['/api/billing-sheets'] });
      queryClient.invalidateQueries({ queryKey: ['/api/customers/billing-preview'] });
      queryClient.invalidateQueries({ queryKey: ['/api/invoices'] });
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
      // Exclude hidden customers from billing list
      if (customer.hiddenFromBilling) return false;
      
      const preview = getCustomerPreview(customer);
      
      // Search term filter
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        const matchesSearch = customer.name.toLowerCase().includes(q) ||
          (customer.irrigoName || "").toLowerCase().includes(q) ||
          customer.email.toLowerCase().includes(q);
        if (!matchesSearch) return false;
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
            // Derive from the two component subtotals to stay in single-source
            // sync with the displayed Total cells (no reliance on combinedTotal).
            if (((Number(preview.approvedTotal) || 0) + (Number(preview.unapprovedTotal) || 0)) <= 0) return false;
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

  // Fetch recent invoices for the dashboard panel.
  // Task #532 — only need enough rows to find the latest invoice
  // month; the API returns invoices sorted by createdAt desc, so
  // 100 rows is plenty and saves significant bandwidth on field-LTE.
  const { data: recentInvoicesAll = [] } = useArrayQuery<any>({
    queryKey: ["/api/invoices", { limit: 100 }],
    queryFn: async () => {
      const res = await fetch("/api/invoices?limit=100");
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Compute the latest billing month from all invoices
  const recentInvoiceMonth = useMemo(() => {
    if (recentInvoicesAll.length === 0) return null;
    const latest = recentInvoicesAll.reduce((best: any, inv: any) => {
      if (!best) return inv;
      const bestKey = best.invoiceYear * 100 + best.invoiceMonth;
      const invKey = inv.invoiceYear * 100 + inv.invoiceMonth;
      return invKey > bestKey ? inv : best;
    }, null as any);
    return latest ? { year: latest.invoiceYear, month: latest.invoiceMonth } : null;
  }, [recentInvoicesAll]);

  const recentMonthInvoices = useMemo(() => {
    if (!recentInvoiceMonth) return [];
    return recentInvoicesAll.filter(
      (inv: any) => inv.invoiceYear === recentInvoiceMonth.year && inv.invoiceMonth === recentInvoiceMonth.month
    );
  }, [recentInvoicesAll, recentInvoiceMonth]);

  const recentMonthLabel = useMemo(() => {
    if (!recentInvoiceMonth) return "";
    const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    return `${MONTHS[recentInvoiceMonth.month - 1]} ${recentInvoiceMonth.year}`;
  }, [recentInvoiceMonth]);

  // Create monthly invoice mutation
  const createMonthlyInvoice = useMutation({
    mutationFn: async (customerId: number) => {
      try {
        const connectionData = await apiRequest("/api/quickbooks/connection");
        if (!connectionData.isConnected) {
          throw new Error("QuickBooks is not connected. Please reconnect QuickBooks in the integrations section before creating invoices.");
        }
      } catch (err: any) {
        if (err.message?.includes("QuickBooks is not connected")) throw err;
        throw new Error("Unable to verify QuickBooks connection. Please check your QuickBooks integration and try again.");
      }

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

  const openBillingCustomers = filteredCustomers
    .filter(c => {
      const preview = getCustomerPreview(c);
      return (preview.approvedTotal || 0) > 0 || (preview.unapprovedTotal || 0) > 0;
    })
    .sort((a, b) => {
      // Sort by displayed Total (approved + unapproved) so list order tracks
      // the same number shown to the user, not the separately-computed
      // combinedTotal field.
      const pa = getCustomerPreview(a);
      const pb = getCustomerPreview(b);
      const ta = (Number(pa.approvedTotal) || 0) + (Number(pa.unapprovedTotal) || 0);
      const tb = (Number(pb.approvedTotal) || 0) + (Number(pb.unapprovedTotal) || 0);
      return tb - ta;
    });

  const otherCustomers = filteredCustomers
    .filter(c => {
      const preview = getCustomerPreview(c);
      return (preview.approvedTotal || 0) <= 0 && (preview.unapprovedTotal || 0) <= 0;
    })
    .sort((a, b) => (a.irrigoName || a.name).localeCompare(b.irrigoName || b.name));

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
    // Task #638 — when the caller passes a lifecycle bucket
    // (`lifecycleOf(estimate)`), render the polished label/colors
    // from the shared `LIFECYCLE_TINTS` map. Work-order and
    // billing-sheet callers still pass raw enums, which fall
    // through to the legacy color/label maps below.
    const lifecycleTint =
      LIFECYCLE_TINTS[status as keyof typeof LIFECYCLE_TINTS];
    if (lifecycleTint) {
      return (
        <Badge
          className={`${lifecycleTint.bg} ${lifecycleTint.text} ${lifecycleTint.border}`}
        >
          {lifecycleTint.label}
        </Badge>
      );
    }

    const statusColors: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-800",
      assigned: "bg-blue-100 text-blue-800",
      in_progress: "bg-purple-100 text-purple-800",
      completed: "bg-green-100 text-green-800",
      pending_manager_review: "bg-orange-100 text-orange-800",
      approved_passed_to_billing: "bg-teal-100 text-teal-800",
      draft: "bg-gray-100 text-gray-800",
      submitted: "bg-blue-100 text-blue-800",
      billed: "bg-purple-100 text-purple-800"
    };

    const statusLabels: Record<string, string> = {
      pending_manager_review: "Pending Manager Review",
      approved_passed_to_billing: "Approved / Ready to Bill",
      in_progress: "In Progress",
    };

    return (
      <Badge className={statusColors[status] || "bg-gray-100 text-gray-800"}>
        {statusLabels[status] || status.replace(/_/g, ' ')}
      </Badge>
    );
  };

  return (
    <div className="min-h-screen bg-gray-200">
    <div className="flex flex-col lg:flex-row h-screen max-w-screen-2xl mx-auto bg-gray-50 shadow-xl">
      {/* Mobile: Two-Screen Navigation */}
      <div className="lg:hidden w-full h-full bg-white flex flex-col">
        {!selectedCustomerId ? (
          /* Screen 1: Customer List (Full Screen) */
          <div className="flex flex-col h-full">
            {/* Header */}
            <div className="p-4 border-b border-gray-200 bg-white">
              <h1 className="text-xl font-bold text-gray-900 mb-4">Customer Billing</h1>
              
              {/* Summary Stats */}
              {!loadingCustomers && !loadingPreviews && customers.length > 0 && (() => {
                const summaryApproved = customerPreviews.reduce((sum, p) => sum + (Number(p.approvedTotal) || 0), 0);
                const summaryUnapproved = customerPreviews.reduce((sum, p) => sum + (Number(p.unapprovedTotal) || 0), 0);
                const summaryTotal = summaryApproved + summaryUnapproved;
                const summaryTotalUnbilled = customerPreviews.reduce((sum, p) => sum + (Number(p.totalUnbilled) || 0), 0);
                const summaryThisMonth = customerPreviews.reduce((sum, p) => sum + (Number(p.currentMonthUnbilled) || 0), 0);
                return (
                <div className="mb-4">
                  <div className="bg-orange-50 p-3 rounded-lg">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs text-green-700 font-medium">Approved</span>
                      <Link href="/billing-workspace?status=approved" data-testid="drill-approved-summary">
                        <span className="text-xs font-bold text-green-800 hover:underline cursor-pointer">
                          {formatCurrency(summaryApproved)}
                        </span>
                      </Link>
                    </div>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs text-yellow-700 font-medium">Unapproved</span>
                      <Link href="/billing-workspace?status=unapproved" data-testid="drill-unapproved-summary">
                        <span className="text-xs font-bold text-yellow-800 hover:underline cursor-pointer">
                          {formatCurrency(summaryUnapproved)}
                        </span>
                      </Link>
                    </div>
                    <div className="flex justify-between items-center border-t border-orange-200 pt-1 mt-1">
                      <span className="text-xs text-orange-700 font-semibold">Total</span>
                      <span className="text-xs font-bold text-orange-800">
                        {formatCurrency(summaryTotal)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center border-t border-orange-200 pt-1 mt-1">
                      <span className="text-xs text-blue-700 font-semibold">Total Unbilled</span>
                      <span className="text-xs font-bold text-blue-800" data-testid="text-mobile-total-unbilled">
                        {formatCurrency(summaryTotalUnbilled)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs text-purple-700 font-semibold">This Month</span>
                      <span className="text-xs font-bold text-purple-800" data-testid="text-mobile-this-month">
                        {formatCurrency(summaryThisMonth)}
                      </span>
                    </div>
                    <div className="text-xs text-orange-600 mt-2 text-center">
                      {customerPreviews.filter(p => (Number(p.approvedTotal) || 0) > 0).length} customers need billing
                    </div>
                  </div>
                </div>
                );
              })()}

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
                <div className="p-4 space-y-4">
                  {openBillingCustomers.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-orange-700 uppercase tracking-wide mb-2 px-1">
                        Open Billing ({openBillingCustomers.length})
                      </div>
                      <div className="space-y-2">
                        {openBillingCustomers.map((customer) => {
                          const preview = getCustomerPreview(customer);
                          return (
                            <Card
                              key={customer.id}
                              className="p-4 cursor-pointer hover:shadow-md transition-shadow border border-gray-200"
                              onClick={() => setSelectedCustomerId(customer.id)}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <div className="font-medium text-base text-gray-900">{customer.irrigoName || customer.name}</div>
                                {(() => {
                                  const approved = Number(preview.approvedTotal) || 0;
                                  const unapproved = Number(preview.unapprovedTotal) || 0;
                                  if (approved === 0 && unapproved === 0) {
                                    return <Badge className="bg-gray-100 text-gray-600 text-xs">Up to Date</Badge>;
                                  } else if (approved === 0 && unapproved > 0) {
                                    return <Badge className="bg-yellow-100 text-yellow-800 text-xs">Pending Approval</Badge>;
                                  } else if (approved > 0 && unapproved === 0) {
                                    return <Badge className="bg-green-100 text-green-800 text-xs">Ready to Bill</Badge>;
                                  } else {
                                    return <Badge className="bg-orange-100 text-orange-800 text-xs">Mixed</Badge>;
                                  }
                                })()}
                              </div>
                              <div className="text-sm text-gray-600 mb-2">{customer.email}</div>
                              {customer.phone && (
                                <div className="text-sm text-gray-600 mb-1">{customer.phone}</div>
                              )}
                              {(() => {
                                const cardApproved = Number(preview.approvedTotal) || 0;
                                const cardUnapproved = Number(preview.unapprovedTotal) || 0;
                                const cardTotal = cardApproved + cardUnapproved;
                                return (
                                  <>
                                    <div className="flex items-center justify-between text-xs mb-0.5">
                                      <span className="text-green-700">Approved:</span>
                                      <Link href={`/billing-workspace?status=approved&customer=${customer.id}`} data-testid={`drill-approved-card-${customer.id}`}>
                                        <span className="font-medium text-green-800 hover:underline cursor-pointer">{formatCurrency(cardApproved)}</span>
                                      </Link>
                                    </div>
                                    <div className="flex items-center justify-between text-xs mb-0.5">
                                      <span className="text-yellow-700">Unapproved:</span>
                                      <Link href={`/billing-workspace?status=unapproved&customer=${customer.id}`} data-testid={`drill-unapproved-card-${customer.id}`}>
                                        <span className="font-medium text-yellow-800 hover:underline cursor-pointer">{formatCurrency(cardUnapproved)}</span>
                                      </Link>
                                    </div>
                                    <div className="flex items-center justify-between text-xs border-t border-gray-100 pt-1 mt-0.5">
                                      <span className="text-orange-700 font-medium">Total:</span>
                                      <span className="font-semibold text-orange-800">{formatCurrency(cardTotal)}</span>
                                    </div>
                                  </>
                                );
                              })()}
                              {customer.address && (
                                <div className="text-xs text-gray-500 mt-1 truncate">{customer.address}</div>
                              )}
                            </Card>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {otherCustomers.length > 0 && (
                    <div>
                      <button
                        className="w-full flex items-center justify-between text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 px-1 hover:text-gray-700 transition-colors"
                        onClick={() => setOtherCustomersCollapsed(v => !v)}
                      >
                        <span>All Other Customers ({otherCustomers.length})</span>
                        {otherCustomersCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                      </button>
                      {!otherCustomersCollapsed && (
                        <div className="space-y-2">
                          {otherCustomers.map((customer) => {
                            const preview = getCustomerPreview(customer);
                            return (
                              <Card
                                key={customer.id}
                                className="p-4 cursor-pointer hover:shadow-md transition-shadow border border-gray-200"
                                onClick={() => setSelectedCustomerId(customer.id)}
                              >
                                <div className="flex items-center justify-between mb-1">
                                  <div className="font-medium text-base text-gray-900">{customer.irrigoName || customer.name}</div>
                                  <Badge className="bg-gray-100 text-gray-600 text-xs">Up to Date</Badge>
                                </div>
                                <div className="text-sm text-gray-600 mb-1">{customer.email}</div>
                                {customer.phone && (
                                  <div className="text-sm text-gray-600 mb-1">{customer.phone}</div>
                                )}
                                <div className="flex items-center justify-between text-xs mb-0.5">
                                  <span className="text-green-700">Approved:</span>
                                  <span className="font-medium text-green-800">{formatCurrency(0)}</span>
                                </div>
                                <div className="flex items-center justify-between text-xs mb-0.5">
                                  <span className="text-yellow-700">Unapproved:</span>
                                  <span className="font-medium text-yellow-800">{formatCurrency(0)}</span>
                                </div>
                                <div className="flex items-center justify-between text-xs border-t border-gray-100 pt-0.5 mt-0.5">
                                  <span className="text-orange-700 font-medium">Total:</span>
                                  <span className="font-semibold text-orange-800">{formatCurrency(0)}</span>
                                </div>
                                {customer.address && (
                                  <div className="text-xs text-gray-500 mt-1 truncate">{customer.address}</div>
                                )}
                              </Card>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
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
                    const combined = (Number(preview.approvedTotal) || 0) + (Number(preview.unapprovedTotal) || 0);
                    return combined > 0 ? (
                      <div className="mt-2 flex gap-2 flex-wrap">
                        {(preview.approvedTotal || 0) > 0 && (
                          <Badge className="bg-green-100 text-green-800 text-xs">
                            Approved: {formatCurrency(preview.approvedTotal || 0)}
                          </Badge>
                        )}
                        {(preview.unapprovedTotal || 0) > 0 && (
                          <Badge className="bg-yellow-100 text-yellow-800 text-xs">
                            Pending: {formatCurrency(preview.unapprovedTotal || 0)}
                          </Badge>
                        )}
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
                  {/* Task #708 — Financial Pulse widget at the top of the
                      customer detail. Renders nothing for roles outside
                      FP's allow-list (super_admin / company_admin /
                      billing_manager). */}
                  <FinancialPulseWidget
                    variant="customer-detail"
                    customerId={customerBillingData.customer.id}
                  />
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
                    <TabsList className="grid w-full grid-cols-6 text-xs h-10">
                      <TabsTrigger value="unbilled" className="text-xs">
                        Unbilled ({customerBillingData.unbilledWorkOrders.length + customerBillingData.unbilledBillingSheets.length + (customerBillingData.unbilledWetCheckBillings ?? []).length})
                      </TabsTrigger>
                      <TabsTrigger value="workorders" className="text-xs">
                        Work Orders ({customerBillingData.workOrders.length})
                      </TabsTrigger>
                      <TabsTrigger value="billing" className="text-xs">
                        Billing ({customerBillingData.billingSheets.length})
                      </TabsTrigger>
                      <TabsTrigger value="wet-check-billings" className="text-xs" data-testid="tab-trigger-wet-check-billings">
                        WC Billings ({(customerBillingData.wetCheckBillings ?? []).length})
                      </TabsTrigger>
                      <TabsTrigger value="estimates" className="text-xs">
                        Estimates ({customerBillingData.estimates.length})
                      </TabsTrigger>
                      <TabsTrigger value="invoices" className="text-xs">
                        Monthly Invoices
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="unbilled" className="mt-3">
                      <div className="space-y-2">
                        {/* Unbilled Work Orders (mobile) */}
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

                        {/* Unbilled Wet Check Billings (mobile) */}
                        {(customerBillingData.unbilledWetCheckBillings ?? []).length > 0 && (
                          <div>
                            <h4 className="font-medium text-sm text-gray-900 mb-2">Unbilled Wet Check Billings</h4>
                            {(customerBillingData.unbilledWetCheckBillings ?? []).map((wcb) => (
                              <Card key={wcb.id} className="mb-2">
                                <CardContent className="p-3">
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <div className="text-sm font-medium">{wcb.billingNumber}</div>
                                      <Badge className="bg-teal-100 text-teal-800 text-xs">[WC]</Badge>
                                    </div>
                                  </div>
                                  <div className="text-xs text-gray-600 mb-2">{wcb.description || 'Wet Check Billing'}</div>
                                  <div className="flex justify-between text-sm">
                                    <span>Total:</span>
                                    <span className="font-medium">{formatCurrency(wcb.laborCost + wcb.partsCost)}</span>
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        )}

                        {customerBillingData.unbilledWorkOrders.length === 0 && customerBillingData.unbilledBillingSheets.length === 0 && (customerBillingData.unbilledWetCheckBillings ?? []).length === 0 && (
                          <div className="text-center py-6 text-gray-500 text-sm">
                            No unbilled work found
                          </div>
                        )}
                      </div>
                    </TabsContent>

                    <TabsContent value="workorders" className="mt-3">
                      <div className="space-y-2">
                        {customerBillingData.workOrders.filter(wo => !(wo.status === 'billed' || wo.invoiceId)).length > 0 ? (
                          customerBillingData.workOrders.filter(wo => !(wo.status === 'billed' || wo.invoiceId)).map((workOrder) => (
                            <Card key={workOrder.id}>
                              <CardContent className="p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="text-sm font-medium">#{workOrder.id}</div>
                                  <div className="flex items-center gap-1">
                                    {getStatusBadge(workOrder.status)}
                                  </div>
                                </div>
                                <div className="text-xs text-gray-600 mb-2">{workOrder.description}</div>
                                <div className="text-xs text-gray-500 mb-2">Assigned to: {workOrder.assignedTo}</div>
                                <div className="flex justify-between text-sm">
                                  <span>Total:</span>
                                  <span className="font-medium">{formatCurrency(workOrder.laborCost + workOrder.partsCost)}</span>
                                </div>
                              </CardContent>
                            </Card>
                          ))
                        ) : (
                          customerBillingData.workOrders.filter(wo => wo.status === 'billed' || wo.invoiceId).length === 0 && (
                            <div className="text-center py-6 text-gray-500 text-sm">No work orders found</div>
                          )
                        )}
                        {/* Billed work orders collapsible */}
                        {customerBillingData.workOrders.filter(wo => wo.status === 'billed' || wo.invoiceId).length > 0 && (
                          <div className="border border-purple-200 rounded-lg overflow-hidden">
                            <button
                              className="w-full flex items-center justify-between px-3 py-2.5 bg-purple-50 hover:bg-purple-100 transition-colors text-left"
                              onClick={() => setMobileWOBilledExpanded(!mobileWOBilledExpanded)}
                            >
                              <span className="text-sm font-medium text-purple-800 flex items-center gap-2">
                                <ChevronRight className={`w-4 h-4 transition-transform ${mobileWOBilledExpanded ? 'rotate-90' : ''}`} />
                                Billed — {customerBillingData.workOrders.filter(wo => wo.status === 'billed' || wo.invoiceId).length} items
                              </span>
                            </button>
                            {mobileWOBilledExpanded && (
                              <div className="space-y-2 p-2 bg-purple-50/40">
                                {customerBillingData.workOrders.filter(wo => wo.status === 'billed' || wo.invoiceId).map((workOrder) => (
                                  <Card key={workOrder.id} className="bg-purple-50/60 border border-purple-200">
                                    <CardContent className="p-3">
                                      <div className="flex items-center justify-between mb-2">
                                        <div className="text-sm font-medium">#{workOrder.id}</div>
                                        <div className="flex items-center gap-1">
                                          {getStatusBadge(workOrder.status)}
                                          {workOrder.status !== 'billed' && <BilledBadge />}
                                        </div>
                                      </div>
                                      <div className="text-xs text-gray-600 mb-2">{workOrder.description}</div>
                                      <div className="flex justify-between text-sm">
                                        <span>Total:</span>
                                        <span className="font-medium">{formatCurrency(workOrder.laborCost + workOrder.partsCost)}</span>
                                      </div>
                                      <div className="mt-2">
                                        <BilledIndicator compact invoiceId={workOrder.invoiceId} />
                                      </div>
                                    </CardContent>
                                  </Card>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </TabsContent>

                    <TabsContent value="billing" className="mt-3">
                      <div className="space-y-2">
                        {customerBillingData.billingSheets.filter(bs => !(bs.status === 'billed' || bs.invoiceId)).length > 0 ? (
                          customerBillingData.billingSheets.filter(bs => !(bs.status === 'billed' || bs.invoiceId)).map((billingSheet) => (
                            <Card key={billingSheet.id}>
                              <CardContent className="p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="text-sm font-medium">#{billingSheet.id}</div>
                                  <div className="flex items-center gap-1">
                                    {getStatusBadge(billingSheet.status)}
                                  </div>
                                </div>
                                <div className="text-xs text-gray-600 mb-2">{billingSheet.description}</div>
                                <div className="flex justify-between text-sm">
                                  <span>Total:</span>
                                  <span className="font-medium">{formatCurrency(billingSheet.laborCost + billingSheet.partsCost)}</span>
                                </div>
                              </CardContent>
                            </Card>
                          ))
                        ) : (
                          customerBillingData.billingSheets.filter(bs => bs.status === 'billed' || bs.invoiceId).length === 0 && (
                            <div className="text-center py-6 text-gray-500 text-sm">No billing sheets found</div>
                          )
                        )}
                        {/* Billed billing sheets collapsible */}
                        {customerBillingData.billingSheets.filter(bs => bs.status === 'billed' || bs.invoiceId).length > 0 && (
                          <div className="border border-purple-200 rounded-lg overflow-hidden">
                            <button
                              className="w-full flex items-center justify-between px-3 py-2.5 bg-purple-50 hover:bg-purple-100 transition-colors text-left"
                              onClick={() => setMobileBSBilledExpanded(!mobileBSBilledExpanded)}
                            >
                              <span className="text-sm font-medium text-purple-800 flex items-center gap-2">
                                <ChevronRight className={`w-4 h-4 transition-transform ${mobileBSBilledExpanded ? 'rotate-90' : ''}`} />
                                Billed — {customerBillingData.billingSheets.filter(bs => bs.status === 'billed' || bs.invoiceId).length} items
                              </span>
                            </button>
                            {mobileBSBilledExpanded && (
                              <div className="space-y-2 p-2 bg-purple-50/40">
                                {customerBillingData.billingSheets.filter(bs => bs.status === 'billed' || bs.invoiceId).map((billingSheet) => (
                                  <Card key={billingSheet.id} className="bg-purple-50/60 border border-purple-200">
                                    <CardContent className="p-3">
                                      <div className="flex items-center justify-between mb-2">
                                        <div className="text-sm font-medium">#{billingSheet.id}</div>
                                        <div className="flex items-center gap-1">
                                          {getStatusBadge(billingSheet.status)}
                                          {billingSheet.status !== 'billed' && <BilledBadge />}
                                        </div>
                                      </div>
                                      <div className="text-xs text-gray-600 mb-2">{billingSheet.description}</div>
                                      <div className="flex justify-between text-sm">
                                        <span>Total:</span>
                                        <span className="font-medium">{formatCurrency(billingSheet.laborCost + billingSheet.partsCost)}</span>
                                      </div>
                                      <div className="mt-2">
                                        <BilledIndicator compact invoiceId={billingSheet.invoiceId} />
                                      </div>
                                    </CardContent>
                                  </Card>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </TabsContent>

                    <TabsContent value="wet-check-billings" className="mt-3">
                      <div className="space-y-2">
                        {(customerBillingData.wetCheckBillings ?? []).length === 0 ? (
                          <Card>
                            <CardContent className="p-6 text-center text-gray-500">
                              <Droplets className="w-8 h-8 mx-auto mb-2 text-teal-300" />
                              <div className="font-medium mb-1">No wet check billings</div>
                              <div className="text-sm">No wet check billings found for this customer.</div>
                            </CardContent>
                          </Card>
                        ) : (
                          (customerBillingData.wetCheckBillings ?? []).map((wcb) => (
                            <WetCheckBillingRow
                              key={wcb.id}
                              wcb={wcb}
                              onClick={() => setOpenWcbId(wcb.id)}
                              userRole={userRole}
                              customerId={selectedCustomerId}
                            />
                          ))
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
                                  <Badge>{getStatusBadge(lifecycleOf(estimate))}</Badge>
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
          {!loadingCustomers && !loadingPreviews && customers.length > 0 && (() => {
            const summaryApproved = customerPreviews.reduce((sum, p) => sum + (Number(p.approvedTotal) || 0), 0);
            const summaryUnapproved = customerPreviews.reduce((sum, p) => sum + (Number(p.unapprovedTotal) || 0), 0);
            const summaryTotal = summaryApproved + summaryUnapproved;
            const summaryTotalUnbilled = customerPreviews.reduce((sum, p) => sum + (Number(p.totalUnbilled) || 0), 0);
            const summaryThisMonth = customerPreviews.reduce((sum, p) => sum + (Number(p.currentMonthUnbilled) || 0), 0);
            return (
            <div className="mb-4">
              <div className="bg-orange-50 p-3 rounded-lg">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-green-700 font-medium">Approved</span>
                  <Link href="/billing-workspace?status=approved" data-testid="drill-approved-summary">
                    <span className="text-xs font-bold text-green-800 hover:underline cursor-pointer">
                      {formatCurrency(summaryApproved)}
                    </span>
                  </Link>
                </div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-yellow-700 font-medium">Unapproved</span>
                  <Link href="/billing-workspace?status=unapproved" data-testid="drill-unapproved-summary">
                    <span className="text-xs font-bold text-yellow-800 hover:underline cursor-pointer">
                      {formatCurrency(summaryUnapproved)}
                    </span>
                  </Link>
                </div>
                <div className="flex justify-between items-center border-t border-orange-200 pt-1 mt-1">
                  <span className="text-xs text-orange-700 font-semibold">Total</span>
                  <span className="text-xs font-bold text-orange-800">
                    {formatCurrency(summaryTotal)}
                  </span>
                </div>
                <div className="flex justify-between items-center border-t border-orange-200 pt-1 mt-1">
                  <span className="text-xs text-blue-700 font-semibold">Total Unbilled</span>
                  <span className="text-xs font-bold text-blue-800" data-testid="text-desktop-total-unbilled">
                    {formatCurrency(summaryTotalUnbilled)}
                  </span>
                </div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-purple-700 font-semibold">This Month</span>
                  <span className="text-xs font-bold text-purple-800" data-testid="text-desktop-this-month">
                    {formatCurrency(summaryThisMonth)}
                  </span>
                </div>
                <div className="text-xs text-orange-600 mt-2 text-center">
                  {customerPreviews.filter(p => (Number(p.approvedTotal) || 0) > 0).length} customers need billing
                </div>
              </div>
            </div>
            );
          })()}

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
            <div>
              {openBillingCustomers.length > 0 && (
                <div>
                  <div className="px-4 py-2 bg-orange-50 border-b border-orange-100">
                    <span className="text-xs font-semibold text-orange-700 uppercase tracking-wide">
                      Open Billing ({openBillingCustomers.length})
                    </span>
                  </div>
                  <div className="divide-y divide-gray-200">
                    {openBillingCustomers.map((customer) => {
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
                          <div className="flex items-center justify-between mb-1">
                            <div className="font-medium text-gray-900 truncate">{customer.irrigoName || customer.name}</div>
                            {(() => {
                              const approved = preview.approvedTotal || 0;
                              const unapproved = preview.unapprovedTotal || 0;
                              if (approved > 0 && unapproved > 0) {
                                return <Badge className="bg-orange-100 text-orange-800 text-xs">Mixed</Badge>;
                              } else if (approved > 0) {
                                return <Badge className="bg-green-100 text-green-800 text-xs">Ready to Bill</Badge>;
                              } else {
                                return <Badge className="bg-yellow-100 text-yellow-800 text-xs">Pending Approval</Badge>;
                              }
                            })()}
                          </div>
                          <div className="text-xs text-gray-600 mb-1 truncate">{customer.email}</div>
                          <div className="space-y-0.5">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-green-700">Approved:</span>
                              <Link href={`/billing-workspace?status=approved&customer=${customer.id}`} data-testid={`drill-approved-card-${customer.id}`}>
                                <span className="text-xs font-medium text-green-800 hover:underline cursor-pointer">{formatCurrency(preview.approvedTotal || 0)}</span>
                              </Link>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-yellow-700">Unapproved:</span>
                              <Link href={`/billing-workspace?status=unapproved&customer=${customer.id}`} data-testid={`drill-unapproved-card-${customer.id}`}>
                                <span className="text-xs font-medium text-yellow-800 hover:underline cursor-pointer">{formatCurrency(preview.unapprovedTotal || 0)}</span>
                              </Link>
                            </div>
                            <div className="flex items-center justify-between border-t border-gray-100 pt-0.5">
                              <span className="text-xs text-orange-700 font-medium">Total:</span>
                              <span className="text-xs font-semibold text-orange-800">{formatCurrency((Number(preview.approvedTotal) || 0) + (Number(preview.unapprovedTotal) || 0))}</span>
                            </div>
                            {preview.lastInvoiceDate && (
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-gray-500">Last invoiced:</span>
                                <span className={`text-xs ${daysSinceInvoice && daysSinceInvoice > 30 ? 'text-red-600' : 'text-green-600'}`}>
                                  {formatDateWithOptions(preview.lastInvoiceDate, { month: 'short', day: 'numeric' })}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {otherCustomers.length > 0 && (
                <div>
                  <button
                    className="w-full px-4 py-2 flex items-center justify-between bg-gray-50 border-b border-gray-200 hover:bg-gray-100 transition-colors"
                    onClick={() => setOtherCustomersCollapsed(v => !v)}
                  >
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      All Other Customers ({otherCustomers.length})
                    </span>
                    {otherCustomersCollapsed ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronUp className="h-4 w-4 text-gray-400" />}
                  </button>
                  {!otherCustomersCollapsed && (
                    <div className="divide-y divide-gray-200">
                      {otherCustomers.map((customer) => {
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
                            <div className="flex items-center justify-between mb-1">
                              <div className="font-medium text-gray-900 truncate">{customer.irrigoName || customer.name}</div>
                              <Badge className="bg-gray-100 text-gray-600 text-xs">Up to Date</Badge>
                            </div>
                            <div className="text-xs text-gray-600 mb-1 truncate">{customer.email}</div>
                            <div className="space-y-0.5">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-green-700">Approved:</span>
                                <span className="text-xs font-medium text-green-800">{formatCurrency(0)}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-yellow-700">Unapproved:</span>
                                <span className="text-xs font-medium text-yellow-800">{formatCurrency(0)}</span>
                              </div>
                              <div className="flex items-center justify-between border-t border-gray-100 pt-0.5">
                                <span className="text-xs text-orange-700 font-medium">Total:</span>
                                <span className="text-xs font-semibold text-orange-800">{formatCurrency(0)}</span>
                              </div>
                              {preview.lastInvoiceDate && (
                                <div className="flex items-center justify-between">
                                  <span className="text-xs text-gray-500">Last invoiced:</span>
                                  <span className={`text-xs ${daysSinceInvoice && daysSinceInvoice > 30 ? 'text-red-600' : 'text-green-600'}`}>
                                    {formatDateWithOptions(preview.lastInvoiceDate, { month: 'short', day: 'numeric' })}
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
              )}

              {filteredCustomers.length === 0 && (
                <div className="p-4 text-center text-gray-500">No customers found</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right Content Area - Always full width on mobile, shared with desktop */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-2 lg:p-6">
          {selectedCustomerId ? (
            loadingCustomerData ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <div className="text-gray-500">Loading customer billing data...</div>
                </CardContent>
              </Card>
            ) : customerBillingData ? (
              <div className="space-y-2 md:space-y-6">
              {/* Customer Header - Mobile optimized */}
              <Card className="shadow-sm border border-gray-200">
                <CardHeader className="pb-2 p-3 md:p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <CardTitle className="text-base md:text-lg">{customerBillingData.customer.irrigoName || customerBillingData.customer.name}</CardTitle>
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

              {/* Task #708 — Financial Pulse widget at the top of the
                  desktop customer detail. */}
              <FinancialPulseWidget
                variant="customer-detail"
                customerId={customerBillingData.customer.id}
              />

              {/* Billing Summary Card - Mobile responsive */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-3">
                {/* Unbilled Work Summary - Mobile optimized */}
                <Card className="border-orange-200 bg-orange-50 shadow-sm">
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
                        {customerBillingData.unbilledWorkOrders.length} WO, {customerBillingData.unbilledBillingSheets.length} BS, {(customerBillingData.unbilledWetCheckBillings ?? []).length} WC ready
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
                <Card className="shadow-sm border border-gray-200">
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
                      <div className="flex justify-between text-xs" data-testid="total-work-wcb-row">
                        <span className="text-gray-600">Wet Check Billings:</span>
                        <span className="font-medium">{(customerBillingData.wetCheckBillings ?? []).length}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-600">Estimates:</span>
                        <span className="font-medium">{customerBillingData.estimates.length}</span>
                      </div>
                      <div className="flex justify-between text-xs text-orange-600 border-t pt-1 mt-1">
                        <span className="font-medium">Unbilled Items:</span>
                        <span className="font-medium">
                          {customerBillingData.unbilledWorkOrders.length + customerBillingData.unbilledBillingSheets.length + (customerBillingData.unbilledWetCheckBillings ?? []).length}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Work Orders and Billing Data Tabs - Mobile optimized */}
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-2 md:p-4">
              <Tabs defaultValue="unbilled" className="w-full">
                <TabsList className="grid w-full grid-cols-6 h-8">
                  <TabsTrigger value="unbilled" className="text-xs px-2">
                    Unbilled ({customerBillingData.unbilledWorkOrders.length + customerBillingData.unbilledBillingSheets.length + (customerBillingData.unbilledWetCheckBillings ?? []).length})
                  </TabsTrigger>
                  <TabsTrigger value="work_orders" className="text-xs px-2">
                    Work Orders ({customerBillingData.workOrders.length})
                  </TabsTrigger>
                  <TabsTrigger value="billing_sheets" className="text-xs px-2">
                    Billing ({customerBillingData.billingSheets.length})
                  </TabsTrigger>
                  <TabsTrigger value="wet_check_billings" className="text-xs px-2" data-testid="tab-trigger-wet-check-billings-desktop">
                    WC Billings ({(customerBillingData.wetCheckBillings ?? []).length})
                  </TabsTrigger>
                  <TabsTrigger value="estimates" className="text-xs px-2">
                    Estimates ({customerBillingData.estimates.length})
                  </TabsTrigger>
                  <TabsTrigger value="invoices" className="text-xs px-2">
                    Monthly Invoices
                  </TabsTrigger>
                </TabsList>

                {/* Unbilled Items Tab */}
                <TabsContent value="unbilled">
                  <div className="space-y-2">
                    {customerBillingData.unbilledWorkOrders.length === 0 && customerBillingData.unbilledBillingSheets.length === 0 && (customerBillingData.unbilledWetCheckBillings ?? []).length === 0 ? (
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
                                  <div className="text-sm font-medium text-orange-700 text-right">
                                    <div>{formatCurrency(parseFloat(wo.totalAmount || '0'))}</div>
                                    {wo.hasFinancialBreakdown ? (
                                      <div className="text-xs text-gray-500 font-normal">
                                        Labor: {formatCurrency(wo.laborCost)} | Parts: {formatCurrency(wo.partsCost)}
                                      </div>
                                    ) : (
                                      <div className="text-xs text-gray-400 italic">Breakdown unavailable</div>
                                    )}
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setItemToDelete({ type: "work_order", id: wo.id, label: `Work Order #${wo.id}` })}
                                    className="h-6 px-2 text-xs hover:bg-red-50 text-red-600"
                                  >
                                    <Trash2 className="w-3 h-3 mr-1" />
                                    Delete
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => { setSelectedWorkOrder(wo); setShowWorkOrderDetail(true); }}
                                    className="h-6 px-2 text-xs hover:bg-orange-50"
                                  >
                                    View
                                  </Button>
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
                                    {bs.branchName && (
                                      <div className="flex items-center gap-1">
                                        <span className="font-medium text-gray-700">Branch:</span>
                                        {bs.branchName}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="text-sm font-medium text-orange-700">
                                    {formatCurrency(bs.laborCost + bs.partsCost)}
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setItemToDelete({ type: "billing_sheet", id: bs.id, label: `Billing Sheet #${bs.id}` })}
                                    className="h-6 px-2 text-xs hover:bg-red-50 text-red-600"
                                  >
                                    <Trash2 className="w-3 h-3 mr-1" />
                                    Delete
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => { setSelectedBillingSheet(bs); setShowBillingSheetDetail(true); }}
                                    className="h-6 px-2 text-xs hover:bg-orange-50"
                                  >
                                    View
                                  </Button>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}

                        {/* Unbilled Wet Check Billings (desktop) */}
                        {(customerBillingData.unbilledWetCheckBillings ?? []).map((wcb) => (
                          <Card key={`wcb-${wcb.id}`} className="border-teal-200">
                            <CardContent className="p-3">
                              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <Receipt className="w-4 h-4 text-teal-400" />
                                    <span className="font-medium text-sm">{wcb.billingNumber}</span>
                                    <Badge className="bg-teal-100 text-teal-800 text-xs">[WC]</Badge>
                                  </div>
                                  <div className="text-xs text-gray-600 mb-2">
                                    {wcb.description || 'Wet Check Billing'}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                                    {wcb.completedDate && (
                                      <div className="flex items-center gap-1">
                                        <Calendar className="w-3 h-3" />
                                        {formatDate(wcb.completedDate)}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="text-sm font-medium text-teal-700">
                                    {formatCurrency(wcb.laborCost + wcb.partsCost)}
                                  </div>
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
                      <>
                        {/* Active (non-billed) work orders */}
                        {customerBillingData.workOrders.filter(wo => !(wo.status === 'billed' || wo.invoiceId)).map((wo) => (
                          <Card key={wo.id}>
                            <CardContent className="p-3">
                              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <FileText className="w-4 h-4 text-gray-400" />
                                    <span className="font-medium text-sm">WO #{wo.id}</span>
                                    {getStatusBadge(wo.status)}
                                  </div>
                                  <div className="text-xs text-gray-600 mb-2">{wo.description}</div>
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
                                    {wo.branchName && (
                                      <div className="flex items-center gap-1">
                                        <span className="font-medium text-gray-700">Branch:</span>
                                        {wo.branchName}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="text-sm font-medium text-right">
                                    <div>{formatCurrency(parseFloat(wo.totalAmount || '0'))}</div>
                                    {wo.hasFinancialBreakdown ? (
                                      <div className="text-xs text-gray-500 font-normal">
                                        Labor: {formatCurrency(wo.laborCost)} | Parts: {formatCurrency(wo.partsCost)}
                                      </div>
                                    ) : (
                                      <div className="text-xs text-gray-400 italic">Breakdown unavailable</div>
                                    )}
                                  </div>
                                  {(wo.status === 'billed' || wo.invoiceId) && (
                                    <span className="h-6 px-2 text-xs text-purple-700 font-medium flex items-center">Billed</span>
                                  )}
                                  {!(wo.status === 'billed' || wo.invoiceId || wo.status === 'pending_manager_review') && (
                                    <>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setItemToDelete({ type: "work_order", id: wo.id, label: `Work Order #${wo.id}` })}
                                        className="h-6 px-2 text-xs hover:bg-red-50 text-red-600"
                                      >
                                        <Trash2 className="w-3 h-3 mr-1" />
                                        Delete
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => { setSelectedWorkOrder(wo); setShowWorkOrderDetail(true); }}
                                        className="h-6 px-2 text-xs"
                                      >
                                        View
                                      </Button>
                                    </>
                                  )}
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}

                        {/* Billed Work Orders — collapsible, collapsed by default */}
                        {(() => {
                          const billedWOs = customerBillingData.workOrders.filter(wo => wo.status === 'billed' || wo.invoiceId);
                          if (billedWOs.length === 0) return null;
                          return (
                            <div className="mt-2">
                              <button
                                onClick={() => setBilledWOExpanded(!billedWOExpanded)}
                                className="w-full flex items-center justify-between px-3 py-2 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors"
                              >
                                <div className="flex items-center gap-2">
                                  {billedWOExpanded ? <ChevronDown className="w-4 h-4 text-purple-600" /> : <ChevronRight className="w-4 h-4 text-purple-600" />}
                                  <span className="text-sm font-semibold text-purple-900">Billed</span>
                                  <Badge className="bg-purple-200 text-purple-900 hover:bg-purple-200 text-xs">{billedWOs.length}</Badge>
                                </div>
                              </button>
                              {billedWOExpanded && (
                                <div className="mt-2 space-y-2">
                                  {billedWOs.map((wo) => (
                                    <Card key={wo.id} className="bg-purple-50/60 border border-purple-200">
                                      <CardContent className="p-3">
                                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                                          <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                              <FileText className="w-4 h-4 text-gray-400" />
                                              <span className="font-medium text-sm">WO #{wo.id}</span>
                                              {getStatusBadge(wo.status)}
                                              {wo.status !== 'billed' && <BilledBadge />}
                                            </div>
                                            <div className="text-xs text-gray-600 mb-1">{wo.description}</div>
                                            <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                                              {wo.completedAt && (
                                                <div className="flex items-center gap-1">
                                                  <Calendar className="w-3 h-3" />
                                                  Completed: {formatDate(wo.completedAt)}
                                                </div>
                                              )}
                                            </div>
                                            <div className="mt-2">
                                              <BilledIndicator compact invoiceId={wo.invoiceId} billedAt={wo.billedAt} />
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <div className="text-sm font-medium text-right">
                                              <div>{formatCurrency(parseFloat(wo.totalAmount || '0'))}</div>
                                            </div>
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              onClick={() => { setSelectedWorkOrder(wo); setShowWorkOrderDetail(true); }}
                                              className="h-6 px-2 text-xs"
                                            >
                                              View
                                            </Button>
                                          </div>
                                        </div>
                                      </CardContent>
                                    </Card>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </>
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
                      <>
                        {/* Active (non-billed) billing sheets */}
                        {customerBillingData.billingSheets.filter(bs => !(bs.status === 'billed' || bs.invoiceId)).map((bs) => (
                          <Card key={bs.id}>
                            <CardContent className="p-3">
                              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <Receipt className="w-4 h-4 text-gray-400" />
                                    <span className="font-medium text-sm">BS #{bs.id}</span>
                                    {getStatusBadge(bs.status)}
                                  </div>
                                  <div className="text-xs text-gray-600 mb-2">{bs.description || 'Billing Sheet'}</div>
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
                                  {(bs.status === 'billed' || bs.invoiceId) && (
                                    <span className="h-6 px-2 text-xs text-purple-700 font-medium flex items-center">Billed</span>
                                  )}
                                  {!(bs.status === 'billed' || bs.invoiceId || bs.status === 'pending_manager_review') && (
                                    <>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setItemToDelete({ type: "billing_sheet", id: bs.id, label: `Billing Sheet #${bs.id}` })}
                                        className="h-6 px-2 text-xs hover:bg-red-50 text-red-600"
                                      >
                                        <Trash2 className="w-3 h-3 mr-1" />
                                        Delete
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => { setSelectedBillingSheet(bs); setShowBillingSheetDetail(true); }}
                                        className="h-6 px-2 text-xs"
                                      >
                                        View
                                      </Button>
                                    </>
                                  )}
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}

                        {/* Billed Billing Sheets — collapsible, collapsed by default */}
                        {(() => {
                          const billedBSs = customerBillingData.billingSheets.filter(bs => bs.status === 'billed' || bs.invoiceId);
                          if (billedBSs.length === 0) return null;
                          return (
                            <div className="mt-2">
                              <button
                                onClick={() => setBilledBSExpanded(!billedBSExpanded)}
                                className="w-full flex items-center justify-between px-3 py-2 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors"
                              >
                                <div className="flex items-center gap-2">
                                  {billedBSExpanded ? <ChevronDown className="w-4 h-4 text-purple-600" /> : <ChevronRight className="w-4 h-4 text-purple-600" />}
                                  <span className="text-sm font-semibold text-purple-900">Billed</span>
                                  <Badge className="bg-purple-200 text-purple-900 hover:bg-purple-200 text-xs">{billedBSs.length}</Badge>
                                </div>
                              </button>
                              {billedBSExpanded && (
                                <div className="mt-2 space-y-2">
                                  {billedBSs.map((bs) => (
                                    <Card key={bs.id} className="bg-purple-50/60 border border-purple-200">
                                      <CardContent className="p-3">
                                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                                          <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                              <Receipt className="w-4 h-4 text-gray-400" />
                                              <span className="font-medium text-sm">BS #{bs.id}</span>
                                              {getStatusBadge(bs.status)}
                                              {bs.status !== 'billed' && <BilledBadge />}
                                            </div>
                                            <div className="text-xs text-gray-600 mb-1">{bs.description || 'Billing Sheet'}</div>
                                            {bs.workDate && (
                                              <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                                                <Calendar className="w-3 h-3" />
                                                Work Date: {formatDate(bs.workDate)}
                                              </div>
                                            )}
                                            <div className="mt-2">
                                              <BilledIndicator compact invoiceId={bs.invoiceId} />
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <div className="text-sm font-medium">
                                              {formatCurrency(bs.laborCost + bs.partsCost)}
                                            </div>
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              onClick={() => { setSelectedBillingSheet(bs); setShowBillingSheetDetail(true); }}
                                              className="h-6 px-2 text-xs"
                                            >
                                              View
                                            </Button>
                                          </div>
                                        </div>
                                      </CardContent>
                                    </Card>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </>
                    )}
                  </div>
                </TabsContent>

                {/* WC Billings Tab */}
                <TabsContent value="wet_check_billings">
                  <div className="space-y-2 mt-2">
                    {(customerBillingData.wetCheckBillings ?? []).length === 0 ? (
                      <Card>
                        <CardContent className="p-6 text-center text-gray-500">
                          <Droplets className="w-8 h-8 mx-auto mb-2 text-teal-300" />
                          <div className="font-medium mb-1">No wet check billings</div>
                          <div className="text-sm">No wet check billings found for this customer.</div>
                        </CardContent>
                      </Card>
                    ) : (
                      (customerBillingData.wetCheckBillings ?? []).map((wcb) => (
                        <WetCheckBillingRow
                          key={wcb.id}
                          wcb={wcb}
                          onClick={() => setOpenWcbId(wcb.id)}
                          userRole={userRole}
                          customerId={selectedCustomerId}
                        />
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
                                  {getStatusBadge(lifecycleOf(estimate))}
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
                                        {getStatusBadge(lifecycleOf(estimate))}
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
                                          <p className="text-sm text-gray-600">{LIFECYCLE_TINTS[lifecycleOf(estimate)].label}</p>
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
              </div>
            ) : (
              <Card>
                <CardContent className="p-8 text-center">
                  <div className="text-gray-500">No billing data found for this customer.</div>
                </CardContent>
              </Card>
            )
          ) : (
            <div className="space-y-4">
              {/* Welcome prompt */}
              <Card className="border border-gray-200">
                <CardContent className="p-6 text-center">
                  <div className="text-gray-500">
                    <User className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <div className="font-medium mb-1">Select a customer</div>
                    <div className="text-sm">Choose a customer from the list to view their billing information.</div>
                  </div>
                </CardContent>
              </Card>

              {/* Recent Invoices Panel */}
              <Card className="border border-blue-200 bg-blue-50/30">
                <CardHeader className="pb-3 pt-4 px-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Receipt className="w-4 h-4 text-blue-600" />
                      <CardTitle className="text-sm font-semibold text-blue-900">
                        Recent Invoices
                        {recentMonthLabel && (
                          <span className="ml-2 text-xs font-normal text-blue-600">— {recentMonthLabel}</span>
                        )}
                      </CardTitle>
                    </div>
                    <Link href="/invoices">
                      <Button variant="ghost" size="sm" className="text-xs text-blue-600 hover:text-blue-800 h-auto py-1 px-2 flex items-center gap-1">
                        View All
                        <ArrowRight className="w-3 h-3" />
                      </Button>
                    </Link>
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-5 pt-0">
                  {recentMonthInvoices.length === 0 ? (
                    <div className="text-center py-6">
                      <Calendar className="w-8 h-8 mx-auto mb-2 text-blue-300" />
                      <p className="text-sm text-blue-500">No invoices generated yet</p>
                      <p className="text-xs text-blue-400 mt-1">Invoices will appear here once billing is processed.</p>
                    </div>
                  ) : (
                    <>
                      {/* Summary row */}
                      <div className="flex items-center justify-between mb-3 p-3 bg-white rounded-lg border border-blue-100">
                        <div className="text-center">
                          <div className="text-lg font-bold text-blue-800">{recentMonthInvoices.length}</div>
                          <div className="text-xs text-blue-500">Invoices</div>
                        </div>
                        <div className="w-px h-8 bg-blue-200" />
                        <div className="text-center">
                          <div className="text-lg font-bold text-blue-800">
                            {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
                              recentMonthInvoices.reduce((sum: number, inv: any) => sum + parseFloat(inv.totalAmount), 0)
                            )}
                          </div>
                          <div className="text-xs text-blue-500">Total Billed</div>
                        </div>
                        <div className="w-px h-8 bg-blue-200" />
                        <div className="text-center">
                          <div className="text-lg font-bold text-emerald-700">
                            {recentMonthInvoices.filter((inv: any) => inv.quickbooksInvoiceId).length}
                          </div>
                          <div className="text-xs text-blue-500">QB Synced</div>
                        </div>
                      </div>

                      {/* Mini invoice list (up to 5) */}
                      <div className="space-y-2">
                        {recentMonthInvoices.slice(0, 5).map((invoice: any) => (
                          <div
                            key={invoice.id}
                            className="flex items-center justify-between p-2.5 bg-white rounded-md border border-blue-100 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer"
                            onClick={() => handleOpenPdf(invoice.id, invoice.invoiceNumber, invoice.customerEmail)}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-gray-800 truncate">{invoice.customerName}</p>
                              <p className="text-xs text-gray-500">#{invoice.invoiceNumber}</p>
                            </div>
                            <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                              {invoice.quickbooksInvoiceId ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                              ) : (
                                <div className="w-3.5 h-3.5 rounded-full border border-gray-300" />
                              )}
                              <span className="text-xs font-bold text-gray-800">
                                {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
                                  parseFloat(invoice.totalAmount)
                                )}
                              </span>
                            </div>
                          </div>
                        ))}
                        {recentMonthInvoices.length > 5 && (
                          <Link href="/invoices">
                            <div className="text-center py-1.5 text-xs text-blue-600 hover:text-blue-800 cursor-pointer font-medium">
                              +{recentMonthInvoices.length - 5} more — View all invoices →
                            </div>
                          </Link>
                        )}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>

      {/* Work Order Detail Modal */}
      {selectedWorkOrder && (
        <CompletedWorkDetailModal
          type="work_order"
          id={selectedWorkOrder.id}
          data={selectedWorkOrder}
          open={showWorkOrderDetail}
          onOpenChange={(open) => { setShowWorkOrderDetail(open); if (!open) setSelectedWorkOrder(null); }}
          showPricing={true}
        />
      )}

      {/* Billing Sheet Detail Modal */}
      {selectedBillingSheet && (
        <CompletedWorkDetailModal
          type="billing_sheet"
          id={selectedBillingSheet.id}
          data={selectedBillingSheet}
          open={showBillingSheetDetail}
          onOpenChange={(open) => { setShowBillingSheetDetail(open); if (!open) setSelectedBillingSheet(null); }}
          showPricing={true}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!itemToDelete} onOpenChange={(open) => { if (!open) setItemToDelete(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {itemToDelete?.type === "work_order" ? "Work Order" : "Billing Sheet"}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">
            Are you sure you want to delete <strong>{itemToDelete?.label}</strong>? This action cannot be undone.
          </p>
          <div className="flex justify-end gap-3 mt-4">
            <Button variant="outline" onClick={() => setItemToDelete(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleteWorkOrderMutation.isPending || deleteBillingSheetMutation.isPending}
            >
              {(deleteWorkOrderMutation.isPending || deleteBillingSheetMutation.isPending) ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>


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
                      <div><span className="font-medium">Period:</span> {formatDate(billingPeriodStart)} - {formatDate(billingPeriodEnd)}</div>
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
                          <td className="p-3 text-right">{item.hasBreakdown === false ? <span className="text-gray-400 italic text-xs">—</span> : formatCurrency(item.laborAmount || 0)}</td>
                          <td className="p-3 text-right">{item.hasBreakdown === false ? <span className="text-gray-400 italic text-xs">—</span> : formatCurrency(item.partsAmount || 0)}</td>
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
                    billingSheetIds: Array.from(selectedBillingSheetIds),
                    selectedWetCheckBillingIds: Array.from(selectedWetCheckBillingIds),
                    periodStart: billingPeriodStart,
                    periodEnd: billingPeriodEnd
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
              {/* Billing Period Picker */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="text-sm font-medium text-blue-900 mb-3 flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Billing Period
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex-1">
                    <label className="text-xs text-blue-700 mb-1 block">Start Date</label>
                    <Input
                      type="date"
                      value={billingPeriodStart}
                      onChange={(e) => setBillingPeriodStart(e.target.value)}
                      className="h-9 text-sm bg-white"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-blue-700 mb-1 block">End Date</label>
                    <Input
                      type="date"
                      value={billingPeriodEnd}
                      onChange={(e) => setBillingPeriodEnd(e.target.value)}
                      className="h-9 text-sm bg-white"
                    />
                  </div>
                </div>
              </div>

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
                  {selectedWorkOrderIds.size + selectedBillingSheetIds.size + selectedWetCheckBillingIds.size} item(s) selected
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
                                {formatCurrency(parseFloat(workOrder.totalAmount || '0'))}
                              </div>
                              {workOrder.hasFinancialBreakdown ? (
                                <>
                                  <div className="text-xs text-gray-500">
                                    Labor: {formatCurrency(workOrder.laborCost)}
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    Parts: {formatCurrency(workOrder.partsCost)}
                                  </div>
                                </>
                              ) : (
                                <div className="text-xs text-gray-400 italic">Breakdown unavailable</div>
                              )}
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

              {/* Wet Check Billings Section */}
              {(customerBillingData.unbilledWetCheckBillings ?? []).length > 0 && (
                <div>
                  <h3 className="font-medium text-lg mb-3 flex items-center gap-2">
                    <Receipt className="w-5 h-5 text-teal-600" />
                    Unbilled Wet Check Billings ({(customerBillingData.unbilledWetCheckBillings ?? []).length})
                  </h3>
                  <div className="space-y-2">
                    {(customerBillingData.unbilledWetCheckBillings ?? []).map((wcb) => (
                      <Card key={wcb.id} className={`cursor-pointer transition-all ${
                        selectedWetCheckBillingIds.has(wcb.id) ? 'ring-2 ring-teal-500 bg-teal-50' : ''
                      }`}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <Checkbox
                                checked={selectedWetCheckBillingIds.has(wcb.id)}
                                onCheckedChange={() => toggleWetCheckBillingSelection(wcb.id)}
                              />
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="font-medium">{wcb.billingNumber}</span>
                                  <Badge className="bg-teal-100 text-teal-800 text-xs">[WC]</Badge>
                                </div>
                                <div className="text-sm text-gray-600 mb-2">
                                  {wcb.description || 'Wet Check Billing'}
                                </div>
                                {wcb.completedDate && (
                                  <div className="text-xs text-gray-500">
                                    Completed: {formatDate(wcb.completedDate)}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-medium text-lg">
                                {formatCurrency(wcb.laborCost + wcb.partsCost)}
                              </div>
                              <div className="text-xs text-gray-500">
                                Labor: {formatCurrency(wcb.laborCost)}
                              </div>
                              <div className="text-xs text-gray-500">
                                Parts: {formatCurrency(wcb.partsCost)}
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              {/* "Review in progress" explainer for non-converted WCBs */}
              {(() => {
                const unbilledIds = new Set((customerBillingData.unbilledWetCheckBillings ?? []).map(w => w.id));
                const pendingCount = (customerBillingData.wetCheckBillings ?? []).filter(wcb => {
                  const status = String((wcb as any).status ?? "");
                  const invoiceId = (wcb as any).invoiceId ?? null;
                  return status === "approved_passed_to_billing" && invoiceId == null && !unbilledIds.has(wcb.id);
                }).length;
                if (pendingCount === 0) return null;
                return (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800 mb-2" data-testid="wcb-review-in-progress-explainer">
                    <span className="mt-0.5">⚠</span>
                    <span>
                      {pendingCount} wet check billing{pendingCount === 1 ? "" : "s"} {pendingCount === 1 ? "is" : "are"} waiting on manager review and {pendingCount === 1 ? "isn't" : "aren't"} available to invoice yet.
                    </span>
                  </div>
                );
              })()}

              {/* Summary & Actions */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="font-medium">Selected Items Summary</div>
                    <div className="text-sm text-gray-600">
                      {selectedWorkOrderIds.size} Work Orders, {selectedBillingSheetIds.size} Billing Sheets, {selectedWetCheckBillingIds.size} Wet Check Billings
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
                          .reduce((sum, bs) => sum + bs.laborCost + bs.partsCost, 0) +
                        (customerBillingData.unbilledWetCheckBillings ?? [])
                          .filter(wcb => selectedWetCheckBillingIds.has(wcb.id))
                          .reduce((sum, wcb) => sum + wcb.laborCost + wcb.partsCost, 0)
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
                        billingSheetIds: Array.from(selectedBillingSheetIds),
                        wetCheckBillingIds: Array.from(selectedWetCheckBillingIds)
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
                        Preview Invoice ({selectedWorkOrderIds.size + selectedBillingSheetIds.size + selectedWetCheckBillingIds.size} items)
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

      {/* WCB View Modal */}
      {openWcbId != null && (
        <WetCheckBillingViewModal
          wetCheckBillingId={openWcbId}
          open={openWcbId != null}
          onOpenChange={(open) => { if (!open) setOpenWcbId(null); }}
        />
      )}
    </div>
    </div>
  );
}
