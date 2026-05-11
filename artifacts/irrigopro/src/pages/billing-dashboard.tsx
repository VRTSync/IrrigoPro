import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DollarSign,
  CheckCircle,
  Clock,
  AlertTriangle,
  ChevronRight,
  Package,
  Camera,
  Wrench,
  FileWarning,
  TrendingUp,
  Users,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { Part, ManualPartReview } from "@workspace/db/schema";

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
}

interface WorkOrderItem {
  id: number;
  status: string;
  photos?: string[] | null;
  partsSubtotal?: string | null;
  totalAmount?: string | null;
  customerId?: number;
}

interface BillingSheetItem {
  id: number;
  status: string;
  photos?: string[] | null;
  partsSubtotal?: string | null;
  totalAmount?: string | null;
  customerId?: number;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function BillingDashboard() {
  const { data: customerPreviews = [], isLoading: loadingPreviews } = useQuery<CustomerPreview[]>({
    queryKey: ["/api/customers/billing-preview", "all"],
    queryFn: async () => {
      try {
        const response = await fetch("/api/customers/billing-preview?dateFilter=all");
        if (!response.ok) return [];
        const data = await response.json();
        return Array.isArray(data) ? data : [];
      } catch {
        return [];
      }
    },
  });

  const { data: pendingParts = [] } = useQuery<Part[]>({
    queryKey: ["/api/parts/pending-approval"],
    refetchInterval: 60000,
  });

  const { data: manualReviews = [] } = useQuery<ManualPartReview[]>({
    queryKey: ["/api/manual-part-reviews"],
    refetchInterval: 60000,
  });

  const { data: allWorkOrders = [] } = useQuery<WorkOrderItem[]>({
    queryKey: ["/api/work-orders"],
    queryFn: () => apiRequest("/api/work-orders"),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: allBillingSheets = [] } = useQuery<BillingSheetItem[]>({
    queryKey: ["/api/billing-sheets"],
    queryFn: () => apiRequest("/api/billing-sheets"),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const isLoading = loadingPreviews;

  // ── Row 1: Financial Exposure ──────────────────────────────────────────
  const totalApproved = customerPreviews.reduce((sum, c) => sum + (Number(c.approvedTotal) || 0), 0);
  const totalUnapproved = customerPreviews.reduce((sum, c) => sum + (Number(c.unapprovedTotal) || 0), 0);
  // "Total Unbilled" = every approved + unapproved ticket, regardless of date.
  // The dashboard already pulls dateFilter=all, so this matches approved+unapproved
  // here, but we still source it from the dedicated backend field so Customer Billing
  // (which may have a narrower date filter on) reads the same number.
  const totalUnbilled = customerPreviews.reduce((sum, c) => sum + (Number(c.totalUnbilled) || 0), 0);
  const totalThisMonth = customerPreviews.reduce((sum, c) => sum + (Number(c.currentMonthUnbilled) || 0), 0);

  // ── Row 2: Action Trigger Panel ────────────────────────────────────────
  const customersReadyToBill = customerPreviews.filter((c) => c.approvedTotal > 0).length;
  const customersPendingApproval = customerPreviews.filter(
    (c) => c.unapprovedTotal > 0 && c.approvedTotal === 0
  ).length;

  // ── Row 3: Bottlenecks — Top customers by unapproved ──────────────────
  const topUnapproved = [...customerPreviews]
    .filter((c) => c.unapprovedTotal > 0)
    .sort((a, b) => b.unapprovedTotal - a.unapprovedTotal)
    .slice(0, 5);

  // Parts Pending Pricing: total count of parts + impacted tickets
  const partsPendingCount = (pendingParts?.length || 0) + (manualReviews?.length || 0);
  const impactedTickets = new Set(
    (manualReviews || []).map((r: ManualPartReview) => r.billingSheetId).filter(Boolean)
  ).size;

  // ── Row 4: System Flags ────────────────────────────────────────────────
  // These use the same status-based predicates as the existing approval/billing workflow.

  // Active statuses: tickets that are in-flight and may need attention before billing
  const billingActiveStatuses = new Set([
    "work_completed",          // legacy alias for pending_manager_review
    "pending_manager_review",  // awaiting manager approval
    "approved_passed_to_billing", // approved, not yet invoiced
    "submitted",               // field-tech submitted, pending review
  ]);

  const activeWOs = allWorkOrders.filter((wo) => billingActiveStatuses.has(wo.status));
  const activeBSs = allBillingSheets.filter((bs) => billingActiveStatuses.has(bs.status));

  // Missing photos: tickets that have no photos attached (same check used in PDF generation)
  const missingPhotosWO = activeWOs.filter(
    (wo) => !wo.photos || (Array.isArray(wo.photos) && wo.photos.length === 0)
  ).length;
  const missingPhotosBSs = activeBSs.filter(
    (bs) => !bs.photos || (Array.isArray(bs.photos) && bs.photos.length === 0)
  ).length;
  const missingPhotosCount = missingPhotosWO + missingPhotosBSs;

  // Missing parts: tickets associated with pending manual-part-reviews (unpriced parts from billing sheets)
  // This is the canonical "parts with pricing issues" count the app already tracks via /api/manual-part-reviews
  const missingPartsCount = impactedTickets;

  // Incomplete tickets: work done but manager review/approval not yet completed.
  // Statuses mirror the unapproved filter in /api/customers/billing-preview (server/routes.ts):
  //   WOs:  pending_manager_review | work_completed
  //   BSs:  pending_manager_review | completed | submitted
  const incompleteWOStatuses = new Set(["pending_manager_review", "work_completed"]);
  const incompleteBSStatuses = new Set(["pending_manager_review", "completed", "submitted"]);
  const incompleteWO = allWorkOrders.filter((wo) => incompleteWOStatuses.has(wo.status)).length;
  const incompleteBSs = allBillingSheets.filter((bs) => incompleteBSStatuses.has(bs.status)).length;
  const incompleteCount = incompleteWO + incompleteBSs;

  const showSystemFlags = missingPhotosCount > 0 || missingPartsCount > 0 || incompleteCount > 0;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading billing dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto py-6 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Billing Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Financial overview — read only</p>
        </div>
        <Link href="/billing/command-center">
          <Button variant="outline" className="gap-2">
            Command Center <ChevronRight className="w-4 h-4" />
          </Button>
        </Link>
      </div>

      {/* ── Row 1: Financial Exposure ─────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
          <TrendingUp className="w-4 h-4" /> Financial Exposure
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="border-l-4 border-l-green-500">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-gray-500 font-medium">Approved</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">
                    {formatCurrency(totalApproved)}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">Ready to invoice</p>
                </div>
                <div className="bg-green-100 p-2 rounded-lg">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-amber-500">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-gray-500 font-medium">Unapproved</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">
                    {formatCurrency(totalUnapproved)}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">Awaiting approval</p>
                </div>
                <div className="bg-amber-100 p-2 rounded-lg">
                  <Clock className="w-5 h-5 text-amber-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-blue-500">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-gray-500 font-medium">Total Unbilled</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1" data-testid="text-dashboard-total-unbilled">
                    {formatCurrency(totalUnbilled)}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">All unbilled work</p>
                </div>
                <div className="bg-blue-100 p-2 rounded-lg">
                  <DollarSign className="w-5 h-5 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-purple-500">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-gray-500 font-medium">This Month</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1" data-testid="text-dashboard-this-month">
                    {formatCurrency(totalThisMonth)}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">Current calendar month</p>
                </div>
                <div className="bg-purple-100 p-2 rounded-lg">
                  <TrendingUp className="w-5 h-5 text-purple-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── Row 2: Action Trigger Panel ───────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
          <Users className="w-4 h-4" /> Action Trigger Panel
        </h2>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
              <div className="flex items-center gap-3">
                <div className="bg-green-100 p-2.5 rounded-xl">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">{customersReadyToBill}</p>
                  <p className="text-sm text-gray-500">
                    {customersReadyToBill === 1 ? "Customer" : "Customers"} ready to bill
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="bg-amber-100 p-2.5 rounded-xl">
                  <Clock className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">{customersPendingApproval}</p>
                  <p className="text-sm text-gray-500">
                    {customersPendingApproval === 1 ? "Customer" : "Customers"} pending approval
                  </p>
                </div>
              </div>

              <div className="sm:ml-auto">
                <Link href="/billing/command-center">
                  <Button className="gap-2 bg-blue-600 hover:bg-blue-700 text-white">
                    Go to Billing Command Center
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ── Row 3: Bottlenecks ────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> Bottlenecks
        </h2>
        <div className={`grid grid-cols-1 gap-4 ${partsPendingCount > 0 ? "lg:grid-cols-2" : ""}`}>
          {/* Top customers by unapproved */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-800">
                Top Customers by Unapproved Balance
              </CardTitle>
            </CardHeader>
            <CardContent>
              {topUnapproved.length === 0 ? (
                <div className="text-center py-6 text-gray-400">
                  <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-400" />
                  <p className="text-sm">No unapproved balances</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {topUnapproved.map((customer, idx) => (
                    <div
                      key={customer.id}
                      className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-bold text-gray-400 w-4 shrink-0">
                          {idx + 1}
                        </span>
                        <span className="text-sm font-medium text-gray-800 truncate">
                          {customer.name}
                        </span>
                      </div>
                      <Badge
                        variant="outline"
                        className="ml-2 shrink-0 text-amber-700 border-amber-300 bg-amber-50 font-semibold"
                      >
                        {formatCurrency(customer.unapprovedTotal)}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Parts Pending Pricing sub-panel — only if count > 0 */}
          {partsPendingCount > 0 && (
            <Card className="border-orange-200 bg-orange-50/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
                  <Package className="w-4 h-4 text-orange-500" />
                  Parts Pending Pricing
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2.5">
                  {(pendingParts?.length || 0) > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Catalog parts unpriced</span>
                      <Badge className="bg-orange-100 text-orange-800 border-orange-200">
                        {pendingParts.length}
                      </Badge>
                    </div>
                  )}
                  {(manualReviews?.length || 0) > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Manual parts on tickets</span>
                      <Badge className="bg-orange-100 text-orange-800 border-orange-200">
                        {manualReviews.length}
                      </Badge>
                    </div>
                  )}
                  {impactedTickets > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Impacted tickets</span>
                      <Badge variant="outline" className="text-gray-700">
                        {impactedTickets}
                      </Badge>
                    </div>
                  )}
                  <div className="pt-1">
                    <Link href="/parts-pending-approval">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full gap-2 border-orange-300 text-orange-700 hover:bg-orange-100"
                      >
                        Review Pending Parts <ChevronRight className="w-3.5 h-3.5" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

        </div>
      </section>

      {/* ── Row 4: System Flags (conditional) ────────────────────────── */}
      {showSystemFlags && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
            <FileWarning className="w-4 h-4" /> System Flags
          </h2>
          <Card className="border-red-200 bg-red-50/20">
            <CardContent className="pt-5 pb-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {missingPhotosCount > 0 && (
                  <div className="flex items-start gap-3 p-3 bg-white rounded-lg border border-red-100">
                    <div className="bg-red-100 p-2 rounded-lg shrink-0">
                      <Camera className="w-4 h-4 text-red-600" />
                    </div>
                    <div>
                      <p className="text-lg font-bold text-gray-900">{missingPhotosCount}</p>
                      <p className="text-xs text-gray-500 leading-tight">
                        Tickets missing photos
                      </p>
                    </div>
                  </div>
                )}

                {missingPartsCount > 0 && (
                  <div className="flex items-start gap-3 p-3 bg-white rounded-lg border border-amber-100">
                    <div className="bg-amber-100 p-2 rounded-lg shrink-0">
                      <Wrench className="w-4 h-4 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-lg font-bold text-gray-900">{missingPartsCount}</p>
                      <p className="text-xs text-gray-500 leading-tight">
                        Tickets missing parts data
                      </p>
                    </div>
                  </div>
                )}

                {incompleteCount > 0 && (
                  <div className="flex items-start gap-3 p-3 bg-white rounded-lg border border-blue-100">
                    <div className="bg-blue-100 p-2 rounded-lg shrink-0">
                      <Clock className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-lg font-bold text-gray-900">{incompleteCount}</p>
                      <p className="text-xs text-gray-500 leading-tight">
                        Tickets pending review
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
