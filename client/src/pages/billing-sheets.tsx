import { safeGet } from "@/utils/safeStorage";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { MetricTile, MetricGrid } from "@/components/ui/metric-tile";
import { PageContainer, PageContent, PageHeader } from "@/components/ui/page-header";
import { FAB } from "@/components/ui/fab";
import { StandaloneBillingSheet } from "@/components/billing/standalone-billing-sheet";
import { BillingSheetViewModal } from "@/components/billing/billing-sheet-view-modal";
import { Plus, Search, FileText, Calendar, User, DollarSign, Clock, Check, X, Send, Eye, Edit, Trash2, ChevronRight, ChevronDown, MapPin, Camera, AlertTriangle } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { BillingSheet } from "@shared/schema";
import { BilledIndicator, BilledBadge } from "@/components/ui/billed-indicator";

export default function BillingSheets() {
  const [showBillingModal, setShowBillingModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewingSheet, setViewingSheet] = useState<BillingSheet | null>(null);
  const [editingDraft, setEditingDraft] = useState<BillingSheet | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
  const [activeExpanded, setActiveExpanded] = useState(true);
  const [completedExpanded, setCompletedExpanded] = useState(true);
  const [billedExpandedBS, setBilledExpandedBS] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Get current user from localStorage  
  const getCurrentUser = () => {
    const savedUser = safeGet("user");
    if (!savedUser) return null;
    try { return JSON.parse(savedUser); } catch { return null; }
  };

  const currentUser = getCurrentUser();

  // Check for create parameter in URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('create') === 'true') {
      setShowBillingModal(true);
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Deep-link support: ?openSheet=<id> opens the sheet view modal once the
  // billing sheet list is loaded. Used by the "missing photos" outreach email.
  const [pendingOpenSheetId, setPendingOpenSheetId] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const v = new URLSearchParams(window.location.search).get("openSheet");
    const id = v ? parseInt(v, 10) : NaN;
    return Number.isFinite(id) ? id : null;
  });

  // Deep-link support: ?ids=1,2,3 narrows the page to a specific subset of
  // billing sheets. Used by the missing-photos SMS outreach so a tech taps the
  // link and lands on a list of only the sheets that need photos re-attached.
  const [filterIdSet] = useState<Set<number> | null>(() => {
    if (typeof window === "undefined") return null;
    const raw = new URLSearchParams(window.location.search).get("ids");
    if (!raw) return null;
    const ids = raw
      .split(",")
      .map(s => parseInt(s.trim(), 10))
      .filter(n => Number.isFinite(n));
    return ids.length > 0 ? new Set(ids) : null;
  });

  // Get billing sheets based on role:
  // - Field techs: only their own billing sheets
  // - Managers/Admins: all billing sheets for oversight, but drafts filtered client-side
  const { data: billingSheets, isLoading } = useQuery<BillingSheet[]>({
    queryKey: currentUser?.role === 'field_tech' 
      ? ["/api/billing-sheets", "technician", currentUser?.id]
      : ["/api/billing-sheets"],
    queryFn: () => {
      if (currentUser?.role === 'field_tech' && currentUser?.id) {
        return fetch(`/api/billing-sheets?technician=${currentUser.id}`).then(res => res.json());
      } else {
        return fetch('/api/billing-sheets').then(res => res.json());
      }
    },
  });

  // Open the deep-linked sheet once the list arrives, then strip the param
  useEffect(() => {
    if (pendingOpenSheetId == null || !billingSheets) return;
    const target = billingSheets.find(s => s.id === pendingOpenSheetId);
    if (target) {
      setViewingSheet(target);
      const url = new URL(window.location.href);
      url.searchParams.delete("openSheet");
      window.history.replaceState({}, "", url.pathname + (url.search ? url.search : ""));
      setPendingOpenSheetId(null);
    }
  }, [pendingOpenSheetId, billingSheets]);

  // Apply optional ?ids=… narrowing before bucketing into sections.
  const scopedSheets = billingSheets
    ? (filterIdSet ? billingSheets.filter(s => filterIdSet.has(s.id)) : billingSheets)
    : undefined;

  // Separate drafts and submitted sheets
  // Drafts are always user-specific, submitted sheets are visible to all with role-based access
  const draftSheets = scopedSheets?.filter(sheet =>
    sheet.status === 'draft' && sheet.technicianId === currentUser?.id
  ) || [];
  const submittedSheets = scopedSheets?.filter(sheet => sheet.status !== 'draft') || [];

  const isBilledSheet = (sheet: BillingSheet) => sheet.status === 'billed' || !!sheet.invoiceId;

  // Active: draft (user's own) + submitted + pending_manager_review
  // Completed: approved_passed_to_billing + approved (not billed)
  // Billed: status === 'billed' or has invoiceId
  const activeSheets = scopedSheets?.filter(sheet => {
    if (sheet.status === 'draft') return sheet.technicianId === currentUser?.id;
    return sheet.status === 'submitted' || sheet.status === 'pending_manager_review';
  }) || [];
  const completedSheets = scopedSheets?.filter(sheet =>
    (sheet.status === 'approved_passed_to_billing' || sheet.status === 'approved') && !isBilledSheet(sheet)
  ) || [];
  const billedSheets = scopedSheets?.filter(sheet => isBilledSheet(sheet)) || [];

  const formatCurrency = (amount: number | string) => {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(numAmount);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return <Badge className="bg-gray-100 text-gray-800">Draft</Badge>;
      case 'submitted':
        return <Badge className="bg-blue-100 text-blue-800">Submitted</Badge>;
      case 'pending_manager_review':
        return <Badge className="bg-orange-100 text-orange-800">Pending Manager Review</Badge>;
      case 'approved_passed_to_billing':
        return <Badge className="bg-teal-100 text-teal-800">Approved / Passed to Billing</Badge>;
      case 'approved':
        return <Badge className="bg-green-100 text-green-800">Approved</Badge>;
      case 'billed':
        return <Badge className="bg-purple-100 text-purple-800">Billed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const matchesSearch = (sheet: BillingSheet) =>
    sheet.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    sheet.billingNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
    sheet.technicianName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (sheet.propertyAddress || "").toLowerCase().includes(searchQuery.toLowerCase());

  // Filter billing sheets based on search query
  const filteredDrafts = draftSheets.filter(matchesSearch);
  const filteredSubmitted = submittedSheets.filter(matchesSearch);
  const filteredActive = activeSheets.filter(matchesSearch);
  const filteredCompleted = completedSheets.filter(matchesSearch);
  const filteredBilled = billedSheets.filter(matchesSearch);



  // Delete billing sheet mutation
  const deleteBillingSheet = useMutation({
    mutationFn: async (billingSheetId: number) => {
      return apiRequest(`/api/billing-sheets/${billingSheetId}`, 'DELETE');
    },
    onSuccess: () => {
      toast({
        title: "Billing Sheet Deleted",
        description: "Billing sheet has been successfully deleted",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/billing-sheets"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete billing sheet",
        variant: "destructive",
      });
    },
  });

  // Bulk delete billing sheets mutation
  const bulkDeleteBillingSheets = useMutation({
    mutationFn: async (ids: number[]) => {
      return apiRequest('/api/billing-sheets/bulk', 'DELETE', { ids });
    },
    onSuccess: (data: any) => {
      toast({
        title: "Billing Sheets Deleted",
        description: `${data?.deleted ?? 0} billing sheet(s) deleted successfully`,
      });
      setSelectedIds(new Set());
      setShowBulkDeleteDialog(false);
      queryClient.invalidateQueries({ queryKey: ["/api/billing-sheets"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete billing sheets",
        variant: "destructive",
      });
      setShowBulkDeleteDialog(false);
    },
  });

  // Check if user can edit/delete billing sheets
  const canEditDelete = currentUser?.role === 'company_admin' || currentUser?.role === 'billing_manager' || currentUser?.role === 'irrigation_manager';

  // "Missing photos" detection — drives the amber banner + per-sheet badge
  // for past sheets that lost their uploaded photos before the Task #143 fix.
  // The server authoritatively decides which sheets qualify (cutoff lives on
  // the server) so the UI can't drift out of sync.
  const canSeeReport = canEditDelete || currentUser?.role === 'super_admin';
  const { data: missingPhotosData } = useQuery<{ cutoff: string; count: number; sheets: BillingSheet[] }>({
    queryKey: ["/api/billing-sheets/missing-photos"],
    enabled: !!canSeeReport,
  });
  const missingPhotoIds = new Set((missingPhotosData?.sheets ?? []).map(s => s.id));
  const isMissingPhotos = (sheet: BillingSheet) => missingPhotoIds.has(sheet.id);
  const missingPhotosCount = missingPhotosData?.count ?? 0;

  // Manager: Approve billing sheet (pending_manager_review -> approved_passed_to_billing)
  const approveBillingSheet = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest(`/api/billing-sheets/${id}/approve`, 'POST', {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/billing-sheets'] });
      toast({
        title: "Approved",
        description: "Billing sheet approved and passed to billing"
      });
    },
    onError: (err: any) => {
      toast({
        title: "Error", 
        description: err?.message || "Failed to approve billing sheet",
        variant: "destructive"
      });
    }
  });

  // Manager: Return billing sheet for correction (pending_manager_review -> draft)
  const returnForCorrection = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest(`/api/billing-sheets/${id}/return-for-correction`, 'POST', {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/billing-sheets'] });
      toast({
        title: "Returned",
        description: "Billing sheet returned for correction"
      });
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err?.message || "Failed to return billing sheet for correction", 
        variant: "destructive"
      });
    }
  });

  // Submit billing sheet for manager review (field techs only)
  const submitForApproval = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest(`/api/billing-sheets/${id}`, 'PATCH', { status: 'submitted' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/billing-sheets'] });
      toast({
        title: "Submitted",
        description: "Billing sheet submitted for manager review"
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to submit billing sheet for approval",
        variant: "destructive"
      });
    }
  });

  return (
    <PageContainer>
      <PageHeader
        title={currentUser?.role === 'field_tech' ? 'My Billing Sheets' : 'Billing Sheets'}
        subtitle={currentUser?.role === 'field_tech' 
          ? 'Create billing for your standalone work'
          : 'Manage billing for work performed without work orders'
        }
        actions={
          <Button 
            onClick={() => setShowBillingModal(true)}
            className="hidden sm:flex"
            data-testid="button-new-billing-sheet"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Billing Sheet
          </Button>
        }
      />

      <PageContent className="space-y-5">
        {/* Stats Row */}
        <MetricGrid className="grid-cols-3">
          <MetricTile
            label="Drafts"
            value={draftSheets.length}
            icon={FileText}
            variant={draftSheets.length > 0 ? "warning" : "default"}
            testId="metric-drafts"
          />
          <MetricTile
            label="Submitted"
            value={submittedSheets.filter(s => s.status === 'submitted').length}
            icon={Send}
            variant="primary"
            testId="metric-submitted"
          />
          <MetricTile
            label="Approved"
            value={submittedSheets.filter(s => s.status === 'approved' || s.status === 'billed').length}
            icon={Check}
            variant="success"
            testId="metric-approved"
          />
        </MetricGrid>

        {/* Catalog $0 price audit entry — only admins / billing managers */}
        {canSeeReport && (
          <Link href="/billing-sheets/zero-price-audit">
            <a
              className="block border border-orange-200 bg-orange-50 hover:bg-orange-100 transition-colors rounded-lg px-4 py-3 mb-2"
              data-testid="banner-zero-price-audit"
            >
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-orange-700 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-orange-900">
                    Catalog $0 price audit
                  </p>
                  <p className="text-xs text-orange-800">
                    Find and repair billing sheets and work orders saved with a $0 unit price for catalog parts.
                  </p>
                </div>
                <ChevronRight className="w-5 h-5 text-orange-700 flex-shrink-0" />
              </div>
            </a>
          </Link>
        )}

        {/* Missing photos report banner */}
        {canSeeReport && missingPhotosCount > 0 && (
          <Link href="/billing-sheets/missing-photos">
            <a
              className="block border border-amber-300 bg-amber-50 hover:bg-amber-100 transition-colors rounded-lg px-4 py-3"
              data-testid="banner-missing-photos"
            >
              <div className="flex items-center gap-3">
                <Camera className="w-5 h-5 text-amber-700 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-amber-900">
                    {missingPhotosCount} past billing sheet{missingPhotosCount === 1 ? '' : 's'} missing photos
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

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
          <Input
            placeholder="Search billing sheets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-12"
            data-testid="input-search-billing"
          />
        </div>

      {/* Billing Sheets List */}
      {isLoading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-48" />
                  </div>
                  <Skeleton className="h-8 w-20" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (filteredActive.length === 0 && filteredCompleted.length === 0 && filteredBilled.length === 0) ? (
        <Card>
          <CardContent className="text-center py-12">
            <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No billing sheets found</h3>
            <p className="text-gray-600 mb-6">
              {searchQuery 
                ? "No billing sheets match your search criteria." 
                : "Get started by creating your first billing sheet for work performed without a work order."
              }
            </p>
            <Button 
              onClick={() => setShowBillingModal(true)}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create First Billing Sheet
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
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

          {/* Active Section (draft + submitted) */}
          <div>
            <button
              onClick={() => setActiveExpanded(!activeExpanded)}
              className="w-full flex items-center justify-between px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
            >
              <div className="flex items-center gap-2">
                {activeExpanded ? <ChevronDown className="w-5 h-5 text-blue-700" /> : <ChevronRight className="w-5 h-5 text-blue-700" />}
                <span className="text-base font-semibold text-blue-900">Active</span>
                <Badge className="bg-blue-200 text-blue-900 hover:bg-blue-200">{filteredActive.length}</Badge>
              </div>
            </button>

            {activeExpanded && (
              <div className="mt-3 space-y-4">
                {filteredActive.length === 0 ? (
                  <p className="text-center text-gray-500 py-6">No active billing sheets</p>
                ) : (
                  filteredActive.map((sheet) => (
                    <Card key={sheet.id} className={`hover:shadow-md transition-shadow ${sheet.status === 'draft' ? 'border-orange-200 bg-orange-50/50' : ''}`}>
                      <CardContent className="p-4 sm:p-6">
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-start gap-2 mb-3">
                              {canEditDelete && (
                                <Checkbox
                                  checked={selectedIds.has(sheet.id)}
                                  onCheckedChange={() => toggleSelect(sheet.id)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="flex-shrink-0 mt-0.5"
                                />
                              )}
                              <FileText className={`w-5 h-5 flex-shrink-0 mt-0.5 ${sheet.status === 'draft' ? 'text-orange-600' : 'text-blue-600'}`} />
                              <div className="min-w-0 flex-1">
                                <h3 className="font-semibold text-gray-900 truncate">{sheet.billingNumber}</h3>
                                <p className="text-sm text-gray-600 truncate">{sheet.customerName}</p>
                              </div>
                              <div className="flex-shrink-0 flex flex-wrap items-center gap-2">
                                {getStatusBadge(sheet.status)}
                                {isMissingPhotos(sheet) && (
                                  <Badge
                                    className="bg-amber-100 text-amber-800 hover:bg-amber-100"
                                    title="Photos uploaded for this sheet were lost. Open the sheet and use Add Photos to re-attach."
                                    data-testid={`badge-missing-photos-${sheet.id}`}
                                  >
                                    <Camera className="w-3 h-3 mr-1" /> Missing Photos
                                  </Badge>
                                )}
                              </div>
                            </div>

                            <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-sm ${
                              currentUser?.role === 'field_tech' ? 'lg:grid-cols-2' : 'lg:grid-cols-4'
                            }`}>
                              <div className="flex items-center gap-2">
                                <Calendar className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-gray-900 truncate">{formatDate(sheet.workDate)}</p>
                                  <p className="text-gray-500 text-xs">Work Date</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <User className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-gray-900 truncate">{sheet.technicianName}</p>
                                  <p className="text-gray-500 text-xs">Technician</p>
                                </div>
                              </div>
                              {currentUser?.role !== 'field_tech' && (
                                <>
                                  <div className="flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                    <div className="min-w-0">
                                      <p className="text-gray-900 truncate">{sheet.totalHours} hours</p>
                                      <p className="text-gray-500 text-xs">Total Time</p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <DollarSign className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                    <div className="min-w-0">
                                      <p className="text-gray-900 font-semibold truncate">{formatCurrency(sheet.totalAmount)}</p>
                                      <p className="text-gray-500 text-xs">Total Amount</p>
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>

                            <div className="mt-3 space-y-1">
                              <p className="text-xs sm:text-sm text-gray-600">
                                <strong>Work:</strong> <span className="break-words">{sheet.workDescription}</span>
                              </p>
                              {sheet.propertyAddress && (
                                <p className="text-xs sm:text-sm text-gray-600">
                                  <strong>Location:</strong> <span className="break-words">{sheet.propertyAddress}</span>
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-col gap-2 flex-shrink-0 w-full sm:w-auto sm:items-end">
                            {/* Continue Draft button for field techs and irrigation managers */}
                            {(currentUser?.role === 'field_tech' || currentUser?.role === 'irrigation_manager') && sheet.status === 'draft' && sheet.technicianId === currentUser.id && (
                              <Button size="sm" onClick={() => setEditingDraft(sheet)} className="bg-orange-600 hover:bg-orange-700 text-white w-full sm:w-auto">
                                <FileText className="w-3 h-3 mr-1" />Continue Draft
                              </Button>
                            )}
                            {/* Submit for approval button for field techs and irrigation managers */}
                            {(currentUser?.role === 'field_tech' || currentUser?.role === 'irrigation_manager') && sheet.status === 'draft' && sheet.technicianId === currentUser.id && (
                              <Button size="sm" onClick={() => submitForApproval.mutate(sheet.id)} disabled={submitForApproval.isPending} className="bg-blue-600 hover:bg-blue-700 text-white w-full sm:w-auto">
                                <Send className="w-3 h-3 mr-1" />Submit for Approval
                              </Button>
                            )}
                            {/* View button for submitted/review sheets */}
                            {sheet.status !== 'draft' && (
                              <Button size="sm" variant="outline" onClick={() => setViewingSheet(sheet)} className="w-full sm:w-auto">
                                <Eye className="w-3 h-3 mr-1" />View
                              </Button>
                            )}
                            {/* Manager approval gate: Approve or Return for Correction */}
                            {(currentUser?.role === 'irrigation_manager' || currentUser?.role === 'company_admin') && sheet.status === 'pending_manager_review' && (
                              <div className="flex flex-col gap-2 w-full sm:w-auto">
                                <Button size="sm" onClick={() => approveBillingSheet.mutate(sheet.id)} disabled={approveBillingSheet.isPending} className="bg-teal-600 hover:bg-teal-700 text-white w-full sm:w-auto">
                                  <Check className="w-3 h-3 mr-1" />Approve / Pass to Billing
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => returnForCorrection.mutate(sheet.id)} disabled={returnForCorrection.isPending} className="border-orange-300 text-orange-700 hover:bg-orange-50 w-full sm:w-auto">
                                  <X className="w-3 h-3 mr-1" />Return for Correction
                                </Button>
                              </div>
                            )}
                            {/* Old submitted review for billing managers */}
                            {currentUser?.role === 'billing_manager' && sheet.status === 'submitted' && (
                              <div className="flex flex-col gap-2 w-full sm:w-auto">
                                <Button size="sm" onClick={() => approveBillingSheet.mutate(sheet.id)} disabled={approveBillingSheet.isPending} className="bg-teal-600 hover:bg-teal-700 text-white w-full sm:w-auto">
                                  <Check className="w-3 h-3 mr-1" />Approve
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => returnForCorrection.mutate(sheet.id)} disabled={returnForCorrection.isPending} className="border-orange-300 text-orange-700 hover:bg-orange-50 w-full sm:w-auto">
                                  <X className="w-3 h-3 mr-1" />Return
                                </Button>
                              </div>
                            )}
                            {/* Edit and Delete buttons for admins */}
                            {canEditDelete && (
                              <div className="flex gap-2 w-full sm:w-auto">
                                <Button size="sm" variant="outline" onClick={() => setEditingDraft(sheet)} className="border-blue-300 text-blue-600 hover:bg-blue-50 flex-1 sm:flex-none">
                                  <Edit className="w-3 h-3 mr-1" />Edit
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => { if (confirm(`Are you sure you want to delete billing sheet ${sheet.billingNumber}? This action cannot be undone.`)) { deleteBillingSheet.mutate(sheet.id); } }} className="border-red-300 text-red-600 hover:bg-red-50 flex-1 sm:flex-none">
                                  <Trash2 className="w-3 h-3 mr-1" />Delete
                                </Button>
                              </div>
                            )}
                            <div className="text-xs text-gray-500">
                              {sheet.status === 'draft' ? `Last saved: ${formatDate(sheet.updatedAt)}` : `Created: ${formatDate(sheet.createdAt)}`}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Completed Section (approved, not yet billed) */}
          <div>
            <button
              onClick={() => setCompletedExpanded(!completedExpanded)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-center gap-2">
                {completedExpanded ? <ChevronDown className="w-5 h-5 text-gray-600" /> : <ChevronRight className="w-5 h-5 text-gray-600" />}
                <span className="text-base font-semibold text-gray-700">Completed</span>
                <Badge variant="secondary">{filteredCompleted.length}</Badge>
              </div>
            </button>

            {completedExpanded && (
              <div className="mt-3 space-y-4">
                {filteredCompleted.length === 0 ? (
                  <p className="text-center text-gray-500 py-6">No completed billing sheets</p>
                ) : (
                  filteredCompleted.map((sheet) => (
                    <Card key={sheet.id} className="hover:shadow-md transition-shadow">
                      <CardContent className="p-4 sm:p-6">
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-start gap-2 mb-3">
                              {canEditDelete && (
                                <Checkbox
                                  checked={selectedIds.has(sheet.id)}
                                  onCheckedChange={() => toggleSelect(sheet.id)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="flex-shrink-0 mt-0.5"
                                />
                              )}
                              <FileText className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                              <div className="min-w-0 flex-1">
                                <h3 className="font-semibold text-gray-900 truncate">{sheet.billingNumber}</h3>
                                <p className="text-sm text-gray-600 truncate">{sheet.customerName}</p>
                              </div>
                              <div className="flex-shrink-0 flex flex-wrap items-center gap-2">
                                {getStatusBadge(sheet.status)}
                                {isMissingPhotos(sheet) && (
                                  <Badge
                                    className="bg-amber-100 text-amber-800 hover:bg-amber-100"
                                    title="Photos uploaded for this sheet were lost. Open the sheet and use Add Photos to re-attach."
                                    data-testid={`badge-missing-photos-${sheet.id}`}
                                  >
                                    <Camera className="w-3 h-3 mr-1" /> Missing Photos
                                  </Badge>
                                )}
                              </div>
                            </div>

                            <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-sm ${
                              currentUser?.role === 'field_tech' ? 'lg:grid-cols-2' : 'lg:grid-cols-4'
                            }`}>
                              <div className="flex items-center gap-2">
                                <Calendar className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-gray-900 truncate">{formatDate(sheet.workDate)}</p>
                                  <p className="text-gray-500 text-xs">Work Date</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <User className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-gray-900 truncate">{sheet.technicianName}</p>
                                  <p className="text-gray-500 text-xs">Technician</p>
                                </div>
                              </div>
                              {currentUser?.role !== 'field_tech' && (
                                <>
                                  <div className="flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                    <div className="min-w-0">
                                      <p className="text-gray-900 truncate">{sheet.totalHours} hours</p>
                                      <p className="text-gray-500 text-xs">Total Time</p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <DollarSign className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                    <div className="min-w-0">
                                      <p className="text-gray-900 font-semibold truncate">{formatCurrency(sheet.totalAmount)}</p>
                                      <p className="text-gray-500 text-xs">Total Amount</p>
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>

                            <div className="mt-3 space-y-1">
                              <p className="text-xs sm:text-sm text-gray-600">
                                <strong>Work:</strong> <span className="break-words">{sheet.workDescription}</span>
                              </p>
                              {sheet.propertyAddress && (
                                <p className="text-xs sm:text-sm text-gray-600">
                                  <strong>Location:</strong> <span className="break-words">{sheet.propertyAddress}</span>
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-col gap-2 flex-shrink-0 w-full sm:w-auto sm:items-end">
                            <Button size="sm" variant="outline" onClick={() => setViewingSheet(sheet)} className="w-full sm:w-auto">
                              <Eye className="w-3 h-3 mr-1" />View
                            </Button>
                            {canEditDelete && (
                              <div className="flex gap-2 w-full sm:w-auto">
                                <Button size="sm" variant="outline" onClick={() => setEditingDraft(sheet)} className="border-blue-300 text-blue-600 hover:bg-blue-50 flex-1 sm:flex-none">
                                  <Edit className="w-3 h-3 mr-1" />Edit
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => { if (confirm(`Are you sure you want to delete billing sheet ${sheet.billingNumber}? This action cannot be undone.`)) { deleteBillingSheet.mutate(sheet.id); } }} className="border-red-300 text-red-600 hover:bg-red-50 flex-1 sm:flex-none">
                                  <Trash2 className="w-3 h-3 mr-1" />Delete
                                </Button>
                              </div>
                            )}
                            <div className="text-xs text-gray-500">
                              Created: {formatDate(sheet.createdAt)}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Billed Section — collapsible, collapsed by default */}
          {filteredBilled.length > 0 && (
            <div>
              <button
                onClick={() => setBilledExpandedBS(!billedExpandedBS)}
                className="w-full flex items-center justify-between px-4 py-3 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {billedExpandedBS ? <ChevronDown className="w-5 h-5 text-purple-600" /> : <ChevronRight className="w-5 h-5 text-purple-600" />}
                  <span className="text-base font-semibold text-purple-900">Billed</span>
                  <Badge className="bg-purple-200 text-purple-900 hover:bg-purple-200">{filteredBilled.length}</Badge>
                </div>
              </button>

              {billedExpandedBS && (
                <div className="mt-3 space-y-4">
                  {filteredBilled.map((sheet) => (
                    <Card key={sheet.id} className="bg-purple-50/60 border border-purple-200 hover:shadow-md transition-shadow">
                      <CardContent className="p-4 sm:p-6">
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-start gap-2 mb-3">
                              <FileText className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
                              <div className="min-w-0 flex-1">
                                <h3 className="font-semibold text-gray-900 truncate">{sheet.billingNumber}</h3>
                                <p className="text-sm text-gray-600 truncate">{sheet.customerName}</p>
                              </div>
                              <div className="flex-shrink-0"><BilledBadge /></div>
                            </div>

                            <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-sm ${
                              currentUser?.role === 'field_tech' ? 'lg:grid-cols-2' : 'lg:grid-cols-4'
                            }`}>
                              <div className="flex items-center gap-2">
                                <Calendar className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-gray-900 truncate">{formatDate(sheet.workDate)}</p>
                                  <p className="text-gray-500 text-xs">Work Date</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <User className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-gray-900 truncate">{sheet.technicianName}</p>
                                  <p className="text-gray-500 text-xs">Technician</p>
                                </div>
                              </div>
                              {currentUser?.role !== 'field_tech' && (
                                <>
                                  <div className="flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                    <div className="min-w-0">
                                      <p className="text-gray-900 truncate">{sheet.totalHours} hours</p>
                                      <p className="text-gray-500 text-xs">Total Time</p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <DollarSign className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                    <div className="min-w-0">
                                      <p className="text-gray-900 font-semibold truncate">{formatCurrency(sheet.totalAmount)}</p>
                                      <p className="text-gray-500 text-xs">Total Amount</p>
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>

                            <div className="mt-3 space-y-1">
                              <p className="text-xs sm:text-sm text-gray-600">
                                <strong>Work:</strong> <span className="break-words">{sheet.workDescription}</span>
                              </p>
                              {sheet.propertyAddress && (
                                <p className="text-xs sm:text-sm text-gray-600">
                                  <strong>Location:</strong> <span className="break-words">{sheet.propertyAddress}</span>
                                </p>
                              )}
                            </div>

                            <div className="mt-3">
                              <BilledIndicator compact invoiceId={sheet.invoiceId} />
                            </div>
                          </div>

                          <div className="flex flex-col gap-2 flex-shrink-0 w-full sm:w-auto sm:items-end">
                            <Button size="sm" variant="outline" onClick={() => setViewingSheet(sheet)} className="w-full sm:w-auto">
                              <Eye className="w-3 h-3 mr-1" />View
                            </Button>
                            <div className="text-xs text-gray-500">
                              Created: {formatDate(sheet.createdAt)}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={showBulkDeleteDialog} onOpenChange={setShowBulkDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} Billing Sheet{selectedIds.size !== 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {selectedIds.size} billing sheet{selectedIds.size !== 1 ? 's' : ''}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => bulkDeleteBillingSheets.mutate(Array.from(selectedIds))}
              className="bg-red-600 hover:bg-red-700"
              disabled={bulkDeleteBillingSheets.isPending}
            >
              Delete {selectedIds.size} Billing Sheet{selectedIds.size !== 1 ? 's' : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Standalone Billing Sheet Modal */}
      <StandaloneBillingSheet
        open={showBillingModal}
        onOpenChange={setShowBillingModal}
      />

      {/* Edit Draft Modal */}
      {editingDraft && (
        <StandaloneBillingSheet
          open={!!editingDraft}
          onOpenChange={() => setEditingDraft(null)}
          draftData={editingDraft}
        />
      )}

      {/* View Billing Sheet Modal */}
      {viewingSheet && (
        <BillingSheetViewModal
          sheet={viewingSheet}
          open={!!viewingSheet}
          onOpenChange={() => setViewingSheet(null)}
        />
      )}
      </PageContent>

      {/* FAB for Mobile */}
      <FAB
        onClick={() => setShowBillingModal(true)}
        testId="fab-new-billing-sheet"
        className="sm:hidden"
      />
    </PageContainer>
  );
}