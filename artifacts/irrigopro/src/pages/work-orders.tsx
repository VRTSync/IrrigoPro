import { useState, useEffect } from "react";
import { safeGet, safeSet } from "@/utils/safeStorage";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { WorkOrderListSkeleton } from "@/components/ui/loading-skeleton";

import { useToast } from "@/hooks/use-toast";
import { apiRequest, parseApiError, useArrayQuery } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MetricTile, MetricGrid } from "@/components/ui/metric-tile";
import { PageContainer, PageContent, PageHeader } from "@/components/ui/page-header";
import { FAB } from "@/components/ui/fab";
import { WorkOrderWizard } from "@/components/work-orders/work-order-wizard";
import { buildMapsUrl } from "@/lib/maps-url";
import { WorkOrderDetails } from "@/components/work-orders/work-order-details";
import { CompletedWorkDetailModal } from "@/components/billing/completed-work-detail-modal";
import { WorkOrderCompletion } from "@/components/work-orders/work-order-completion";
import { 
  Plus, 
  Search, 
  Calendar, 
  Clock, 
  CheckCircle, 
  AlertCircle, 
  User,
  MapPin,
  FileText,
  Eye,
  Filter,
  ArrowRight,
  Wrench,
  Play,
  Users,
  List,
  Edit,
  Trash2,
  ExternalLink,
  ChevronRight,
  ChevronDown,
  Camera
} from "lucide-react";
import { Link } from "wouter";
import type { WorkOrder } from "@workspace/db/schema";
import { BilledIndicator, BilledBadge } from "@/components/ui/billed-indicator";

export default function WorkOrders() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null);
  const [selectedWorkOrderForStart, setSelectedWorkOrderForStart] = useState<WorkOrder | null>(null);
  const [selectedWorkOrderForCompletion, setSelectedWorkOrderForCompletion] = useState<WorkOrder | null>(null);
  const [showWorkOrderForm, setShowWorkOrderForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [groupByCustomer, setGroupByCustomer] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<any>(() => {
    const savedUser = safeGet("user");
    if (savedUser) {
      try { return JSON.parse(savedUser); } catch { return null; }
    }
    return null;
  });
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
  const [activeExpanded, setActiveExpanded] = useState(true);
  const [completedExpanded, setCompletedExpanded] = useState(true);
  const [billedExpanded, setBilledExpanded] = useState(false);
  const [billedMonthsExpanded, setBilledMonthsExpanded] = useState<Record<string, boolean>>({});
  const [billedCustomerExpanded, setBilledCustomerExpanded] = useState<Record<string, boolean>>({});
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Check for create parameter in URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('create') === 'true') {
      setShowWorkOrderForm(true);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Deep-link support: ?openWorkOrder=<id> opens the work-order details modal
  // once the list is loaded. Used by the Labor Rate Audit page so admins can
  // jump straight to a specific ticket.
  const [pendingOpenWorkOrderId, setPendingOpenWorkOrderId] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const v = new URLSearchParams(window.location.search).get("openWorkOrder");
    const id = v ? parseInt(v, 10) : NaN;
    return Number.isFinite(id) ? id : null;
  });

  // For field techs, only show work orders assigned to them
  const { data: workOrders = [], isLoading, isError } = useArrayQuery<WorkOrder>({
    queryKey: currentUser?.role === 'field_tech' 
      ? ["/api/work-orders", "technician", currentUser?.id]
      : ["/api/work-orders"],
    queryFn: () => currentUser?.role === 'field_tech' 
      ? apiRequest(`/api/work-orders?technician=${currentUser.id}`, "GET")
      : apiRequest('/api/work-orders', "GET"),
    staleTime: 0,
    refetchOnMount: true,
    enabled: !!currentUser,
  });

  // Open the deep-linked work order once the list arrives, then strip the param
  useEffect(() => {
    if (pendingOpenWorkOrderId == null || !workOrders) return;
    const target = workOrders.find((wo: WorkOrder) => wo.id === pendingOpenWorkOrderId);
    if (target) {
      setSelectedWorkOrder(target);
      const url = new URL(window.location.href);
      url.searchParams.delete("openWorkOrder");
      window.history.replaceState({}, "", url.toString());
      setPendingOpenWorkOrderId(null);
    }
  }, [pendingOpenWorkOrderId, workOrders]);

  // Fetch notifications for assignment dates (field techs only)
  const { data: notifications } = useQuery({
    queryKey: ["/api/notifications", currentUser?.id],
    queryFn: () => apiRequest(`/api/notifications/${currentUser.id}`, "GET"),
    enabled: !!currentUser && currentUser.role === 'field_tech',
  });

  // Helper function to get assignment date from notifications
  const getAssignmentDate = (workOrder: WorkOrder) => {
    if (!workOrder.assignedTechnicianId) return workOrder.updatedAt;
    
    // For field techs, try to find the assignment notification
    if (currentUser?.role === 'field_tech' && notifications) {
      const assignmentNotification = notifications.find((notif: any) => 
        notif.type === 'work_order_assigned' && 
        notif.relatedEntityId === workOrder.id &&
        notif.userId === currentUser.id
      );
      
      if (assignmentNotification) {
        return assignmentNotification.createdAt;
      }
    }
    
    // Fallback to updatedAt for managers and when no notification is found
    return workOrder.updatedAt;
  };

  // Fetch field technicians for assignment (managers and admins)
  const canReassign = ['irrigation_manager', 'company_admin', 'super_admin'].includes(currentUser?.role ?? '');
  const { data: fieldTechs } = useQuery({
    queryKey: ['/api/users/field-techs'],
    staleTime: 300000, // 5 minutes
    enabled: canReassign,
  });

  // "Missing photos" detection — drives the amber banner + per-work-order badge
  // for past work orders that lost their uploaded photos before the Task #143 fix.
  // The server authoritatively decides which qualify (cutoff lives on the server).
  const canSeeMissingPhotos = currentUser?.role === 'company_admin'
    || currentUser?.role === 'billing_manager'
    || currentUser?.role === 'irrigation_manager'
    || currentUser?.role === 'super_admin';
  const { data: missingPhotosData } = useQuery<{ cutoff: string; count: number; workOrders: WorkOrder[] }>({
    queryKey: ["/api/work-orders/missing-photos"],
    enabled: !!canSeeMissingPhotos,
  });
  const missingPhotoIds = new Set((missingPhotosData?.workOrders ?? []).map(w => w.id));
  const isMissingPhotos = (wo: WorkOrder) => missingPhotoIds.has(wo.id);
  const missingPhotosCount = missingPhotosData?.count ?? 0;



  const isBilled = (workOrder: WorkOrder) =>
    workOrder.status === 'billed' || (workOrder.invoiceId != null);

  const filteredWorkOrders = workOrders?.filter ? workOrders.filter(workOrder => {
    const matchesSearch = workOrder.projectName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         workOrder.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         workOrder.workOrderNumber.toLowerCase().includes(searchQuery.toLowerCase());
    
    let matchesStatus: boolean;
    if (statusFilter === "all") {
      matchesStatus = true;
    } else if (statusFilter === "billed") {
      matchesStatus = isBilled(workOrder);
    } else if (statusFilter === "not_yet_billed") {
      // Include all canonical post-completion states that are not yet invoiced
      const postCompletionStatuses = ['work_completed', 'pending_manager_review', 'approved_passed_to_billing'];
      matchesStatus = postCompletionStatuses.includes(workOrder.status) && !isBilled(workOrder);
    } else if (statusFilter === "assigned") {
      // "Pending" pill — matches both 'pending' and 'assigned' statuses
      matchesStatus = workOrder.status === 'pending' || workOrder.status === 'assigned';
    } else {
      matchesStatus = workOrder.status === statusFilter;
    }
    
    return matchesSearch && matchesStatus;
  }) : [];

  // Group work orders by customer
  const groupedWorkOrders = groupByCustomer ? 
    filteredWorkOrders.reduce((acc, workOrder) => {
      const customerName = workOrder.customerName;
      if (!acc[customerName]) {
        acc[customerName] = [];
      }
      acc[customerName].push(workOrder);
      return acc;
    }, {} as Record<string, WorkOrder[]>) : null;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
      case 'assigned':
        return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Pending</Badge>;
      case 'in_progress':
        return <Badge className="bg-blue-100 text-blue-800 border-blue-200">In Progress</Badge>;
      case 'work_completed':
        return <Badge className="bg-green-100 text-green-800 border-green-200">Completed</Badge>;
      case 'billed':
        return <Badge className="bg-purple-100 text-purple-800 border-purple-200">Billed</Badge>;
      case 'cancelled':
        return <Badge className="bg-red-100 text-red-800 border-red-200">Cancelled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getBilledBadge = () => (
    <Badge className="bg-purple-100 text-purple-800 border-purple-200">Billed</Badge>
  );

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      case 'high':
        return <AlertCircle className="w-4 h-4 text-orange-500" />;
      case 'medium':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'low':
        return <Clock className="w-4 h-4 text-green-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-500" />;
    }
  };

  const formatDate = (date: string | Date | null) => {
    if (!date) return "Not scheduled";
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getStatusCount = (status: string) => {
    return filteredWorkOrders?.filter(wo => wo.status === status).length || 0;
  };



  // Reassign work order mutation
  const reassignWorkOrder = useMutation({
    mutationFn: async ({ workOrderId, technicianId, technicianName }: { workOrderId: number; technicianId: number; technicianName: string }) => {
      return apiRequest(`/api/work-orders/${workOrderId}/assign`, "POST", {
        technicianId,
        technicianName,
      });
    },
    onSuccess: () => {
      toast({
        title: "Work Order Reassigned",
        description: "Work order has been successfully reassigned",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to reassign work order",
        variant: "destructive",
      });
    },
  });

  const deleteWorkOrder = useMutation({
    mutationFn: async (workOrderId: number) => {
      return apiRequest(`/api/work-orders/${workOrderId}`, "DELETE");
    },
    onSuccess: () => {
      toast({
        title: "Work Order Deleted",
        description: "Work order has been successfully deleted",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: parseApiError(error, "Failed to delete work order"),
        variant: "destructive",
      });
    },
  });

  // Bulk delete work orders mutation
  const bulkDeleteWorkOrders = useMutation({
    mutationFn: async (ids: number[]) => {
      return apiRequest("/api/work-orders/bulk", "DELETE", { ids });
    },
    onSuccess: (data: any) => {
      const deleted: number = data?.deleted ?? 0;
      const skipMessage: string | undefined = data?.skipMessage;
      if (skipMessage) {
        toast({
          title: `${deleted} Work Order(s) Deleted`,
          description: skipMessage,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Work Orders Deleted",
          description: `${deleted} work order(s) deleted successfully`,
        });
      }
      setSelectedIds(new Set());
      setShowBulkDeleteDialog(false);
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: parseApiError(error, "Failed to delete work orders"),
        variant: "destructive",
      });
      setShowBulkDeleteDialog(false);
    },
  });

  // Check if user can edit/delete work orders
  const canEditDelete = currentUser?.role === 'company_admin' || currentUser?.role === 'billing_manager' || currentUser?.role === 'irrigation_manager';

  // Handle loading state for currentUser (fallback — should rarely trigger since state is initialized synchronously)
  if (!currentUser) {
    return <WorkOrderListSkeleton />;
  }

  // Show loading skeleton while loading (after all hooks)
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50/30 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <Skeleton className="h-8 w-48 mb-2" />
              <Skeleton className="h-5 w-72" />
            </div>
            <Skeleton className="h-10 w-36" />
          </div>
          
          <div className="flex flex-wrap gap-3 mb-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="flex-1 min-w-[120px]">
                <CardContent className="p-3">
                  <div className="flex items-center space-x-2">
                    <Skeleton className="h-6 w-6 rounded-full" />
                    <div>
                      <Skeleton className="h-3 w-12 mb-1" />
                      <Skeleton className="h-5 w-6" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4 flex-1">
                    <Skeleton className="h-12 w-12 rounded-lg" />
                    <div className="flex-1">
                      <Skeleton className="h-6 w-32 mb-2" />
                      <Skeleton className="h-4 w-40 mb-2" />
                      <Skeleton className="h-4 w-48 mb-3" />
                      <Skeleton className="h-4 w-32 mb-3" />
                      <div className="flex space-x-6">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-4 w-40" />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Skeleton className="h-6 w-16" />
                    <Skeleton className="h-6 w-20" />
                    <Skeleton className="h-8 w-8" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={currentUser?.role === 'field_tech' ? 'My Work Orders' : 'Work Orders'}
        subtitle={currentUser?.role === 'field_tech' 
          ? 'View and manage your assigned work'
          : 'Manage and track field work assignments'
        }
        actions={currentUser?.role !== 'field_tech' && (
          <Button 
            onClick={() => setShowWorkOrderForm(true)} 
            className="hidden sm:flex"
            data-testid="button-new-work-order"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Work Order
          </Button>
        )}
      />

      <PageContent className="space-y-5">
        {/* Missing photos report banner */}
        {canSeeMissingPhotos && missingPhotosCount > 0 && (
          <Link href="/work-orders/missing-photos">
            <a
              className="block border border-amber-300 bg-amber-50 hover:bg-amber-100 transition-colors rounded-lg px-4 py-3"
              data-testid="banner-missing-photos"
            >
              <div className="flex items-center gap-3">
                <Camera className="w-5 h-5 text-amber-700 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-amber-900">
                    {missingPhotosCount} past work order{missingPhotosCount === 1 ? '' : 's'} missing photos
                  </p>
                  <p className="text-xs text-amber-800">
                    Photos uploaded before the recent fix were lost. View the report to ask techs to re-attach them.
                  </p>
                </div>
                <ChevronRight className="w-5 h-5 text-amber-700 flex-shrink-0" />
              </div>
            </a>
          </Link>
        )}

        {/* Stats Cards - Mobile-Optimized Grid */}
        <MetricGrid className="grid-cols-3">
          <MetricTile
            label="Pending"
            value={getStatusCount('assigned')}
            icon={Clock}
            variant={getStatusCount('assigned') > 0 ? "warning" : "default"}
            testId="metric-pending"
          />
          <MetricTile
            label="In Progress"
            value={getStatusCount('in_progress')}
            icon={AlertCircle}
            variant={getStatusCount('in_progress') > 0 ? "primary" : "default"}
            testId="metric-in-progress"
          />
          <MetricTile
            label="Completed"
            value={getStatusCount('work_completed')}
            icon={CheckCircle}
            variant="success"
            testId="metric-completed"
          />
        </MetricGrid>

        {/* Search and Filters */}
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
            <Input
              placeholder="Search work orders..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-12"
              data-testid="input-search"
            />
          </div>
          
          {/* Filter Pills - Horizontally Scrollable on Mobile */}
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-5 px-5 scrollbar-hide">
            <Button 
              variant={statusFilter === "all" ? "default" : "outline"}
              onClick={() => setStatusFilter("all")}
              size="sm"
              className="flex-shrink-0"
              data-testid="filter-all"
            >
              All
            </Button>
            <Button 
              variant={statusFilter === "assigned" ? "default" : "outline"}
              onClick={() => setStatusFilter("assigned")}
              size="sm"
              className="flex-shrink-0"
              data-testid="filter-pending"
            >
              Pending
            </Button>
            <Button 
              variant={statusFilter === "in_progress" ? "default" : "outline"}
              onClick={() => setStatusFilter("in_progress")}
              size="sm"
              className="flex-shrink-0"
              data-testid="filter-active"
            >
              Active
            </Button>
            <Button 
              variant={statusFilter === "work_completed" ? "default" : "outline"}
              onClick={() => setStatusFilter("work_completed")}
              size="sm"
              className="flex-shrink-0"
              data-testid="filter-completed"
            >
              Completed
            </Button>
            <Button 
              variant={statusFilter === "not_yet_billed" ? "default" : "outline"}
              onClick={() => setStatusFilter("not_yet_billed")}
              size="sm"
              className="flex-shrink-0"
              data-testid="filter-not-yet-billed"
            >
              Not Yet Billed
            </Button>
            <Button 
              variant={statusFilter === "billed" ? "default" : "outline"}
              onClick={() => setStatusFilter("billed")}
              size="sm"
              className={`flex-shrink-0 ${statusFilter === "billed" ? "bg-purple-700 hover:bg-purple-800" : "border-purple-300 text-purple-700 hover:bg-purple-50"}`}
              data-testid="filter-billed"
            >
              Billed
            </Button>
          </div>
        </div>

        {/* View Options */}
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            {canEditDelete && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (selectedIds.size === filteredWorkOrders.length && filteredWorkOrders.length > 0) {
                    setSelectedIds(new Set());
                  } else {
                    setSelectedIds(new Set(filteredWorkOrders.map(wo => wo.id)));
                  }
                }}
                className="text-gray-600 text-xs"
              >
                {selectedIds.size === filteredWorkOrders.length && filteredWorkOrders.length > 0 ? 'Deselect All' : 'Select All'}
              </Button>
            )}
            <span className="text-sm font-medium text-slate-600 hidden sm:inline">View:</span>
            <div className="flex gap-1 p-1 bg-slate-100 rounded-xl">
              <Button
                variant={!groupByCustomer ? "default" : "ghost"}
                size="sm"
                onClick={() => setGroupByCustomer(false)}
                className="rounded-lg"
                data-testid="view-list"
              >
                <List className="w-4 h-4 sm:mr-1.5" />
                <span className="hidden sm:inline">List</span>
              </Button>
              <Button
                variant={groupByCustomer ? "default" : "ghost"}
                size="sm"
                onClick={() => setGroupByCustomer(true)}
                className="rounded-lg"
                data-testid="view-by-customer"
              >
                <Users className="w-4 h-4 sm:mr-1.5" />
                <span className="hidden sm:inline">By Customer</span>
              </Button>
            </div>
          </div>
          <div className="text-sm text-slate-500">
            {filteredWorkOrders.length} work order{filteredWorkOrders.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Selection Toolbar */}
        {canEditDelete && selectedIds.size > 0 && (
          <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
            <span className="text-sm font-medium text-blue-700">{selectedIds.size} selected</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelectedIds(new Set())}
              className="text-blue-600 border-blue-300 hover:bg-blue-100 text-xs"
            >
              Clear
            </Button>
            <Button
              size="sm"
              onClick={() => setShowBulkDeleteDialog(true)}
              className="bg-red-600 hover:bg-red-700 text-white ml-auto text-xs"
            >
              <Trash2 className="w-3 h-3 mr-1" />
              Delete {selectedIds.size} Selected
            </Button>
          </div>
        )}

        {/* Work Orders Grid */}
        {isError ? (
          <Card className="bg-white border-0 shadow-sm">
            <CardContent className="p-12 text-center">
              <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Session expired</h3>
              <p className="text-gray-600 mb-6">
                Your session has expired or you are not logged in. Please log in again to view work orders.
              </p>
              <Button
                onClick={() => { window.location.href = "/login"; }}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg"
              >
                Go to Login
              </Button>
            </CardContent>
          </Card>
        ) : filteredWorkOrders?.length === 0 ? (
          <Card className="bg-white border-0 shadow-sm">
            <CardContent className="p-12 text-center">
              <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No work orders found</h3>
              <p className="text-gray-600 mb-6">
                {searchQuery ? "No work orders match your search criteria." : "Get started by creating your first work order."}
              </p>
              <Button 
                onClick={() => setShowWorkOrderForm(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Work Order
              </Button>
            </CardContent>
          </Card>
        ) : groupByCustomer && groupedWorkOrders ? (
          // Grouped view by customer
          <div className="space-y-6">
            {Object.entries(groupedWorkOrders)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([customerName, customerWorkOrders]) => (
                <Card key={customerName} className="bg-white border-0 shadow-sm">
                  <CardHeader className="pb-3 border-b border-gray-100">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <User className="w-5 h-5 text-blue-600" />
                      {customerName}
                      <Badge variant="outline" className="ml-2">
                        {customerWorkOrders.length} work order{customerWorkOrders.length !== 1 ? 's' : ''}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    {/* Active (non-billed) work orders */}
                    <div className="space-y-1">
                      {customerWorkOrders
                        .filter(wo => !isBilled(wo))
                        .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())
                        .map((workOrder) => (
                          <div key={workOrder.id} className="p-4 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-b-0">
                            <div className="flex flex-col h-full">
                              {/* Header: Work Order # and Status */}
                              <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                  {canEditDelete && (
                                    <Checkbox
                                      checked={selectedIds.has(workOrder.id)}
                                      onCheckedChange={() => toggleSelect(workOrder.id)}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  )}
                                  <h4 className="font-semibold text-gray-900 text-base">
                                    {workOrder.workOrderNumber}
                                  </h4>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap justify-end">
                                  {getStatusBadge(workOrder.status)}
                                  {!workOrder.scheduledDate && (
                                    <Badge
                                      variant="outline"
                                      className="bg-purple-50 text-purple-700 border-purple-200"
                                      data-testid={`badge-unscheduled-${workOrder.id}`}
                                    >
                                      Unscheduled
                                    </Badge>
                                  )}
                                  {isBilled(workOrder) && workOrder.status !== 'billed' && getBilledBadge()}
                                  {canSeeMissingPhotos && isMissingPhotos(workOrder) && (
                                    <Badge
                                      className="bg-amber-100 text-amber-800 hover:bg-amber-100"
                                      title="Photos uploaded for this work order were lost. Open it and use Add Photos to re-attach."
                                      data-testid={`badge-missing-photos-${workOrder.id}`}
                                    >
                                      <Camera className="w-3 h-3 mr-1" /> Missing Photos
                                    </Badge>
                                  )}
                                </div>
                              </div>

                              {/* Content Area */}
                              <div className="flex-1 space-y-2 mb-4">
                                {/* Project Name */}
                                <div className="flex items-center gap-2">
                                  <FileText className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                  <span className="text-gray-700 text-sm truncate">{workOrder.projectName}</span>
                                </div>

                                {/* Date Scheduled */}
                                <div className="flex items-center gap-2">
                                  <Calendar className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                  <span className="text-gray-700 text-sm">
                                    Scheduled: {formatDate(workOrder.scheduledDate)}
                                  </span>
                                </div>

                                {/* Location */}
                                <div className="flex items-center gap-2">
                                  <MapPin className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                  <span className="text-gray-700 text-sm truncate">{workOrder.projectAddress}</span>
                                </div>

                                {/* Source Estimate Reference */}
                                {workOrder.estimateId && (
                                  <div className="flex items-center gap-2">
                                    <ExternalLink className="w-4 h-4 text-purple-500 flex-shrink-0" />
                                    <span className="text-purple-700 text-sm font-medium">
                                      From Estimate #{workOrder.estimateId}
                                    </span>
                                  </div>
                                )}

                                {/* Assigned Technician */}
                                {workOrder.assignedTechnicianName && (
                                  <div className="flex items-center gap-2">
                                    <User className="w-4 h-4 text-blue-500 flex-shrink-0" />
                                    <span className="text-blue-700 text-sm font-medium">
                                      Assigned to: {workOrder.assignedTechnicianName}
                                    </span>
                                  </div>
                                )}

                                {/* Completion Date */}
                                {workOrder.status === 'work_completed' && workOrder.completedAt && (
                                  <div className="flex items-center gap-2">
                                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                                    <span className="text-green-700 text-sm font-medium">
                                      Completed by {workOrder.completedByUserName || 'Unknown'} on {formatDate(workOrder.completedAt)}
                                    </span>
                                  </div>
                                )}

                                {/* Billed Indicator */}
                                {isBilled(workOrder) && (
                                  <div className="flex items-center gap-2">
                                    <CheckCircle className="w-4 h-4 text-purple-500 flex-shrink-0" />
                                    <span className="text-purple-700 text-sm font-medium">
                                      Billed{workOrder.billedAt ? ` on ${formatDate(workOrder.billedAt)}` : ''}
                                    </span>
                                  </div>
                                )}
                              </div>

                              {/* Action Buttons */}
                              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                                <div className="text-xs text-gray-500">
                                  Created {formatDate(workOrder.createdAt)}
                                </div>
                                <div className="flex items-center gap-2">
                                  {/* View button for all cards */}
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setSelectedWorkOrder(workOrder)}
                                    className="text-xs px-3 py-1.5 bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                                  >
                                    <Eye className="w-3 h-3 mr-1" />
                                    View / Edit
                                  </Button>
                                  
                                  {/* Assignment dropdown for managers and admins — hidden for billed */}
                                  {canReassign && !isBilled(workOrder) && (
                                    <Select
                                      value={workOrder.assignedTechnicianId?.toString() ?? ""}
                                      onValueChange={(techId: string) => {
                                        const selectedTech = Array.isArray(fieldTechs) ? fieldTechs.find((tech: any) => tech.id.toString() === techId) : undefined;
                                        if (selectedTech) {
                                          reassignWorkOrder.mutate({
                                            workOrderId: workOrder.id,
                                            technicianId: selectedTech.id,
                                            technicianName: selectedTech.name,
                                          });
                                        } else if (techId === currentUser.id.toString()) {
                                          reassignWorkOrder.mutate({
                                            workOrderId: workOrder.id,
                                            technicianId: currentUser.id,
                                            technicianName: currentUser.name,
                                          });
                                        }
                                      }}
                                    >
                                      <SelectTrigger className="w-32 h-8 text-xs bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 focus:bg-blue-100">
                                        <SelectValue placeholder="Assign" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value={currentUser.id.toString()}>
                                          Assign to Me
                                        </SelectItem>
                                        {Array.isArray(fieldTechs) ? fieldTechs.map((tech: any) => (
                                          <SelectItem key={tech.id} value={tech.id.toString()}>
                                            {tech.name}
                                          </SelectItem>
                                        )) : []}
                                      </SelectContent>
                                    </Select>
                                  )}
                                  
                                  {/* Delete button for company admin and billing manager — hidden for billed */}
                                  {canEditDelete && !isBilled(workOrder) && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        if (confirm(`Are you sure you want to delete work order ${workOrder.workOrderNumber}? This action cannot be undone.`)) {
                                          deleteWorkOrder.mutate(workOrder.id);
                                        }
                                      }}
                                      className="text-xs px-3 py-1.5 bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
                                    >
                                      <Trash2 className="w-3 h-3 mr-1" />
                                      Delete
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                    {/* Billed work orders — collapsible section */}
                    {customerWorkOrders.filter(wo => isBilled(wo)).length > 0 && (
                      <div className="border-t border-purple-100">
                        <button
                          className="w-full flex items-center justify-between px-4 py-2.5 bg-purple-50 hover:bg-purple-100 transition-colors text-left"
                          onClick={() => setBilledCustomerExpanded(prev => ({
                            ...prev,
                            [customerName]: !prev[customerName],
                          }))}
                        >
                          <div className="flex items-center gap-2 text-sm font-medium text-purple-800">
                            <ChevronDown className={`w-4 h-4 transition-transform ${billedCustomerExpanded[customerName] ? '' : '-rotate-90'}`} />
                            Billed — {customerWorkOrders.filter(wo => isBilled(wo)).length} item{customerWorkOrders.filter(wo => isBilled(wo)).length !== 1 ? 's' : ''}
                          </div>
                        </button>
                        {billedCustomerExpanded[customerName] && (
                          <div className="space-y-1">
                            {customerWorkOrders
                              .filter(wo => isBilled(wo))
                              .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())
                              .map((workOrder) => (
                                <div key={workOrder.id} className="p-4 bg-purple-50/40 hover:bg-purple-50 transition-colors border-b border-purple-50 last:border-b-0">
                                  <div className="flex flex-col h-full">
                                    <div className="flex items-center justify-between mb-3">
                                      <div className="flex items-center gap-2">
                                        <h4 className="font-semibold text-gray-900 text-base">{workOrder.workOrderNumber}</h4>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        {getStatusBadge(workOrder.status)}
                                        {workOrder.status !== 'billed' && getBilledBadge()}
                                      </div>
                                    </div>
                                    <div className="flex-1 space-y-2 mb-4">
                                      {workOrder.projectName && (
                                        <div className="flex items-center gap-2">
                                          <FileText className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                          <span className="text-gray-700 text-sm truncate">{workOrder.projectName}</span>
                                        </div>
                                      )}
                                      <div className="mt-1">
                                        <BilledIndicator compact invoiceId={workOrder.invoiceId} billedAt={workOrder.billedAt} />
                                      </div>
                                    </div>
                                    <div className="flex items-center justify-end pt-3 border-t border-purple-100">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setSelectedWorkOrder(workOrder)}
                                        className="text-xs px-3 py-1.5 bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                                      >
                                        <Eye className="w-3 h-3 mr-1" />
                                        View
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
          </div>
        ) : (
          // List view (default) - with collapsible Active/Completed sections
          (() => {
            const activeStatuses = ['pending', 'assigned', 'in_progress'];
            // Canonical completed statuses (excluding cancelled — that is separate)
            const completedStatuses = ['work_completed', 'pending_manager_review', 'approved_passed_to_billing', 'billed'];
            const activeWorkOrders = filteredWorkOrders.filter(wo => activeStatuses.includes(wo.status))
              .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
            // Completed but not billed (covers work_completed, pending_manager_review, and approved_passed_to_billing)
            const notYetBilledWorkOrders = filteredWorkOrders.filter(wo => completedStatuses.includes(wo.status) && !isBilled(wo))
              .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
            // Billed work orders (completed + invoiced), sorted by billedAt descending
            const billedWorkOrders = filteredWorkOrders.filter(wo => isBilled(wo))
              .sort((a, b) => new Date(b.billedAt || b.completedAt || 0).getTime() - new Date(a.billedAt || a.completedAt || 0).getTime());
            const completedWorkOrders = notYetBilledWorkOrders;

            const renderWorkOrderCard = (workOrder: WorkOrder) => (
              <Card key={workOrder.id} className={`border-0 shadow-sm hover:shadow-md transition-all duration-200 ${
                isBilled(workOrder)
                  ? 'bg-purple-50/60 border border-purple-200'
                  : workOrder.status === 'work_completed' && currentUser?.role === 'field_tech' 
                    ? 'bg-green-50 border-l-4 border-l-green-500' 
                    : 'bg-white'
              }`}>
                <CardContent className="p-4">
                  <div className="flex flex-col h-full">
                    {/* Header: Work Order # and Status */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        {canEditDelete && !isBilled(workOrder) && (
                          <Checkbox
                            checked={selectedIds.has(workOrder.id)}
                            onCheckedChange={() => toggleSelect(workOrder.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}
                        <h3 className={`font-semibold text-base ${
                          workOrder.status === 'work_completed' && currentUser?.role === 'field_tech'
                            ? 'text-green-800'
                            : 'text-gray-900'
                        }`}>
                          {workOrder.workOrderNumber}
                          {workOrder.status === 'work_completed' && currentUser?.role === 'field_tech' && (
                            <span className="ml-2 text-sm font-medium text-green-600">✓ COMPLETED</span>
                          )}
                        </h3>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        {getStatusBadge(workOrder.status)}
                        {!workOrder.scheduledDate && (
                          <Badge
                            variant="outline"
                            className="bg-purple-50 text-purple-700 border-purple-200"
                            data-testid={`badge-unscheduled-${workOrder.id}`}
                          >
                            Unscheduled
                          </Badge>
                        )}
                        {isBilled(workOrder) && workOrder.status !== 'billed' && getBilledBadge()}
                        {canSeeMissingPhotos && isMissingPhotos(workOrder) && (
                          <Badge
                            className="bg-amber-100 text-amber-800 hover:bg-amber-100"
                            title="Photos uploaded for this work order were lost. Open it and use Add Photos to re-attach."
                            data-testid={`badge-missing-photos-${workOrder.id}`}
                          >
                            <Camera className="w-3 h-3 mr-1" /> Missing Photos
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Content Area */}
                    <div className="flex-1 space-y-2 mb-4">
                      {/* Customer */}
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-gray-500 flex-shrink-0" />
                        <span className="text-gray-900 font-medium truncate">{workOrder.customerName}</span>
                      </div>

                      {/* Project Name */}
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-gray-500 flex-shrink-0" />
                        <span className="text-gray-700 text-sm truncate">{workOrder.projectName}</span>
                      </div>

                      {/* Source Estimate Reference */}
                      {workOrder.estimateId && (
                        <div className="flex items-center gap-2">
                          <ExternalLink className="w-4 h-4 text-purple-500 flex-shrink-0" />
                          <span className="text-purple-700 text-sm font-medium">
                            From Estimate #{workOrder.estimateId}
                          </span>
                        </div>
                      )}

                      {/* Date Assigned */}
                      {workOrder.assignedTechnicianId && (
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-gray-500 flex-shrink-0" />
                          <span className="text-gray-700 text-sm">
                            Assigned: {formatDate(getAssignmentDate(workOrder))}
                          </span>
                        </div>
                      )}

                      {/* Location */}
                      {(workOrder.workLocationLat != null || workOrder.projectAddress) && (
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4 text-gray-500 flex-shrink-0" />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const url = buildMapsUrl({
                                lat: workOrder.workLocationLat,
                                lng: workOrder.workLocationLng,
                                address: workOrder.workLocationAddress || workOrder.projectAddress,
                                label:
                                  workOrder.workLocationAddress ||
                                  workOrder.projectAddress ||
                                  workOrder.customerName,
                              });
                              if (url) window.open(url, '_blank');
                            }}
                            className="text-blue-600 hover:text-blue-800 hover:underline transition-colors text-sm truncate flex-1 text-left"
                          >
                            {workOrder.workLocationAddress || workOrder.projectAddress || `${Number(workOrder.workLocationLat).toFixed(5)}, ${Number(workOrder.workLocationLng).toFixed(5)}`}
                          </button>
                        </div>
                      )}

                      {/* Assignment and Completion Indicator */}
                      <div className="mt-3 space-y-2">
                        {workOrder.assignedTechnicianName ? (
                          <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg p-2">
                            <Wrench className="w-4 h-4 text-blue-600 flex-shrink-0" />
                            <div className="flex-1">
                              <p className="text-xs font-medium text-blue-600">Assigned to</p>
                              <p className="text-sm font-semibold text-blue-700">{workOrder.assignedTechnicianName}</p>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-lg p-2">
                            <AlertCircle className="w-4 h-4 text-yellow-600 flex-shrink-0" />
                            <div className="flex-1">
                              <p className="text-sm font-medium text-yellow-700">Unassigned</p>
                            </div>
                          </div>
                        )}

                        {/* Completion Date Indicator */}
                        {workOrder.status === 'work_completed' && workOrder.completedAt && (
                          <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg p-2">
                            <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                            <div className="flex-1">
                              <p className="text-sm font-semibold text-green-700">
                                Completed by {workOrder.completedByUserName || 'Unknown'} on {formatDate(workOrder.completedAt)}
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Billed Indicator */}
                        {isBilled(workOrder) && (
                          <BilledIndicator
                            invoiceId={workOrder.invoiceId}
                            billedAt={workOrder.billedAt}
                          />
                        )}
                      </div>
                    </div>

                    {/* Action Buttons at Bottom */}
                    <div className="border-t pt-3 mt-auto">
                      {currentUser?.role === 'field_tech' ? (
                        // Field Tech View - Only green View button for assigned work orders
                        <>
                          {workOrder.assignedTechnicianId === currentUser.id && (() => {
                            const isTerminal =
                              workOrder.status === 'work_completed' ||
                              workOrder.status === 'approved_passed_to_billing' ||
                              workOrder.status === 'billed' ||
                              workOrder.invoiceId != null;
                            return (
                              <Button
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isTerminal) {
                                    setSelectedWorkOrder(workOrder);
                                  } else {
                                    setSelectedWorkOrderForStart(workOrder);
                                  }
                                }}
                                className={`w-full ${
                                  isTerminal
                                    ? 'bg-green-700 hover:bg-green-800 text-white border border-green-600'
                                    : 'bg-green-600 hover:bg-green-700 text-white'
                                }`}
                              >
                                <Eye className="w-4 h-4 mr-1" />
                                {isTerminal ? 'View Completed' : 'View'}
                              </Button>
                            );
                          })()}

                          {/* Show message for unassigned work orders */}
                          {workOrder.assignedTechnicianId !== currentUser.id && (
                            <div className="text-center text-gray-500 text-sm py-2">
                              Work order not assigned to you
                            </div>
                          )}
                        </>
                      ) : (
                        // Manager/Admin View - View button and Assignment dropdown
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedWorkOrder(workOrder);
                            }}
                            className="bg-green-600 hover:bg-green-700 text-white flex-1 sm:flex-none"
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            View / Edit
                          </Button>
                          
                          {/* Assignment dropdown for managers and admins */}
                          {!isBilled(workOrder) && canReassign && (
                            <Select
                              value={workOrder.assignedTechnicianId?.toString() ?? ""}
                              onValueChange={(techId: string) => {
                                const selectedTech = Array.isArray(fieldTechs) ? fieldTechs.find((tech: any) => tech.id.toString() === techId) : undefined;
                                if (selectedTech) {
                                  reassignWorkOrder.mutate({
                                    workOrderId: workOrder.id,
                                    technicianId: selectedTech.id,
                                    technicianName: selectedTech.name,
                                  });
                                } else if (techId === currentUser.id.toString()) {
                                  reassignWorkOrder.mutate({
                                    workOrderId: workOrder.id,
                                    technicianId: currentUser.id,
                                    technicianName: currentUser.name,
                                  });
                                }
                              }}
                            >
                              <SelectTrigger className="flex-1 sm:flex-none sm:w-32 h-8 text-xs bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 focus:bg-blue-100">
                                <SelectValue placeholder="Assign" />
                              </SelectTrigger>
                              <SelectContent>
                                {currentUser?.id && (
                                  <SelectItem value={currentUser.id.toString()}>
                                    Assign to Me
                                  </SelectItem>
                                )}
                                {Array.isArray(fieldTechs) ? fieldTechs.map((tech: any) => (
                                  <SelectItem key={tech.id} value={tech.id.toString()}>
                                    {tech.name}
                                  </SelectItem>
                                )) : []}
                              </SelectContent>
                            </Select>
                          )}
                          
                          {/* Delete button for company admin and billing manager — hidden for billed */}
                          {canEditDelete && !isBilled(workOrder) && (
                            <Button
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm(`Are you sure you want to delete work order ${workOrder.workOrderNumber}? This action cannot be undone.`)) {
                                  deleteWorkOrder.mutate(workOrder.id);
                                }
                              }}
                              className="bg-red-600 hover:bg-red-700 text-white flex-1 sm:flex-none"
                            >
                              <Trash2 className="w-4 h-4 mr-1" />
                              Delete
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );

            return (
              <div className="space-y-4">
                {/* Active Section — hidden when "Billed" or "Not Yet Billed" filter active */}
                {(statusFilter === "all" || statusFilter === "assigned" || statusFilter === "in_progress") && (
                  <div>
                    <button
                      onClick={() => setActiveExpanded(!activeExpanded)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        {activeExpanded ? <ChevronDown className="w-5 h-5 text-blue-700" /> : <ChevronRight className="w-5 h-5 text-blue-700" />}
                        <span className="text-base font-semibold text-blue-900">Active</span>
                        <Badge className="bg-blue-200 text-blue-900 hover:bg-blue-200">{activeWorkOrders.length}</Badge>
                      </div>
                    </button>
                    {activeExpanded && (
                      <div className="mt-3 space-y-4">
                        {activeWorkOrders.length === 0 ? (
                          <p className="text-center text-gray-500 py-6">No active work orders</p>
                        ) : (
                          activeWorkOrders.map(renderWorkOrderCard)
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Completed / Awaiting Billing Section — hidden when "Billed" filter active */}
                {(statusFilter === "all" || statusFilter === "work_completed" || statusFilter === "not_yet_billed") && (
                  <div>
                    <button
                      onClick={() => setCompletedExpanded(!completedExpanded)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        {completedExpanded ? <ChevronDown className="w-5 h-5 text-gray-600" /> : <ChevronRight className="w-5 h-5 text-gray-600" />}
                        <span className="text-base font-semibold text-gray-700">Completed / Awaiting Billing</span>
                        <Badge variant="secondary">{completedWorkOrders.length}</Badge>
                      </div>
                    </button>
                    {completedExpanded && (
                      <div className="mt-3 space-y-4">
                        {completedWorkOrders.length === 0 ? (
                          <p className="text-center text-gray-500 py-6">No completed work orders</p>
                        ) : (
                          completedWorkOrders.map(renderWorkOrderCard)
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Billed Section */}
                {billedWorkOrders.length > 0 && (
                  <div>
                    <button
                      onClick={() => setBilledExpanded(!billedExpanded)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        {billedExpanded ? <ChevronDown className="w-5 h-5 text-purple-700" /> : <ChevronRight className="w-5 h-5 text-purple-700" />}
                        <span className="text-base font-semibold text-purple-900">Billed</span>
                        <Badge className="bg-purple-200 text-purple-900 hover:bg-purple-200">{billedWorkOrders.length}</Badge>
                      </div>
                    </button>
                    {billedExpanded && (
                      <div className="mt-3 space-y-4">
                        {(() => {
                          const formatBilledMonth = (wo: WorkOrder) => {
                            const d = wo.billedAt || wo.completedAt;
                            if (!d) return 'Unknown';
                            return new Date(d).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                          };
                          const byMonth: Record<string, WorkOrder[]> = {};
                          for (const wo of billedWorkOrders) {
                            const key = formatBilledMonth(wo);
                            if (!byMonth[key]) byMonth[key] = [];
                            byMonth[key].push(wo);
                          }
                          return Object.entries(byMonth).map(([month, monthWorkOrders]) => {
                            const isExpanded = billedMonthsExpanded[month] !== false;
                            return (
                              <div key={month}>
                                <button
                                  onClick={() => setBilledMonthsExpanded(prev => ({ ...prev, [month]: !isExpanded }))}
                                  className="w-full flex items-center justify-between px-3 py-2 bg-purple-50 border border-purple-100 rounded-lg hover:bg-purple-100 transition-colors mb-2"
                                >
                                  <div className="flex items-center gap-2">
                                    {isExpanded ? <ChevronDown className="w-4 h-4 text-purple-600" /> : <ChevronRight className="w-4 h-4 text-purple-600" />}
                                    <span className="text-sm font-semibold text-purple-800">{month} — Billed</span>
                                    <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100 text-xs">{monthWorkOrders.length}</Badge>
                                  </div>
                                </button>
                                {isExpanded && (
                                  <div className="space-y-3 ml-4">
                                    {monthWorkOrders.map(renderWorkOrderCard)}
                                  </div>
                                )}
                              </div>
                            );
                          });
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()
        )}

        {/* Bulk Delete Confirmation Dialog */}
        <AlertDialog open={showBulkDeleteDialog} onOpenChange={setShowBulkDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {selectedIds.size} Work Order{selectedIds.size !== 1 ? 's' : ''}?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete {selectedIds.size} work order{selectedIds.size !== 1 ? 's' : ''}. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => bulkDeleteWorkOrders.mutate(Array.from(selectedIds))}
                className="bg-red-600 hover:bg-red-700"
                disabled={bulkDeleteWorkOrders.isPending}
              >
                Delete {selectedIds.size} Work Order{selectedIds.size !== 1 ? 's' : ''}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Work Order Wizard — new work orders */}
        {showWorkOrderForm && (
          <WorkOrderWizard
            open={showWorkOrderForm}
            onClose={() => setShowWorkOrderForm(false)}
            onCreated={() => {
              queryClient.invalidateQueries({ queryKey: ['/api/work-orders'] });
            }}
          />
        )}

        {/* Work Order Detail Modal — view and inline-edit */}
        {selectedWorkOrder && (
          <CompletedWorkDetailModal
            type="work_order"
            id={selectedWorkOrder.id}
            data={selectedWorkOrder}
            open={!!selectedWorkOrder}
            onOpenChange={(open) => { if (!open) setSelectedWorkOrder(null); }}
            showPricing={true}
          />
        )}

        {/* Work Order Details Dialog - Start Work Order */}
        {selectedWorkOrderForStart && (
          <WorkOrderDetails 
            workOrder={selectedWorkOrderForStart}
            onClose={() => {
              console.log('Closing work order start details');
              setSelectedWorkOrderForStart(null);
            }}
            onUpdate={() => {
              console.log('Updating work orders');
              queryClient.invalidateQueries({ queryKey: ['/api/work-orders'] });
            }}
            showAddDetailsButton={true}
          />
        )}

        {/* Work Order Completion Dialog */}
        {selectedWorkOrderForCompletion && (
          <WorkOrderCompletion 
            workOrder={selectedWorkOrderForCompletion}
            open={!!selectedWorkOrderForCompletion}
            onClose={() => {
              console.log('Closing work order completion');
              setSelectedWorkOrderForCompletion(null);
            }}
            onComplete={() => {
              console.log('Work order completed');
              setSelectedWorkOrderForCompletion(null);
              queryClient.invalidateQueries({ queryKey: ['/api/work-orders'] });
            }}
          />
        )}
      </PageContent>

      {/* Floating Action Button for Mobile - Managers Only */}
      {currentUser?.role !== 'field_tech' && (
        <FAB
          onClick={() => setShowWorkOrderForm(true)}
          testId="fab-new-work-order"
          className="sm:hidden"
        />
      )}
    </PageContainer>
  );
}