import { safeGet } from "@/utils/safeStorage";
import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useArrayQuery } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft, MapPin, Phone, Mail, Building, FileText, Receipt, DollarSign,
  Bell, Droplets, Wrench, Calendar, Package, ChevronDown, ChevronRight, User,
} from "lucide-react";
import type { Customer, Estimate, WorkOrder, BillingSheetWithItems } from "@workspace/db/schema";
import { lifecycleOf, formatEstimateNumber } from "@workspace/shared";
import { InvoiceList } from "@/components/billing/invoice-list";
import { InvoicePdfPreviewModal } from "@/components/billing/invoice-pdf-preview-modal";
import { IrrigationSystemCard } from "@/components/customers/irrigation-system-card";
import { FinancialPulseWidget } from "@/components/financial-pulse/financial-pulse-widget";
import { EstimateDetailModal } from "@/components/estimates/estimate-detail-modal";
import { CompletedWorkDetailModal } from "@/components/billing/completed-work-detail-modal";
import { PropertyNotes } from "@/components/customers/property-notes";
import { PropertyBoundarySection } from "@/components/customers/property-boundary";
import { BillingNotes } from "@/components/customers/billing-notes";
import { BilledIndicator, BilledBadge } from "@/components/ui/billed-indicator";
import { displayCustomerAddress } from "@/lib/customer-address";

export default function CustomerProfile() {
  const { id } = useParams();
  const [, setLocation] = useLocation();

  const [userRole, setUserRole] = useState<string>("");

  // Invoice PDF modal
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [selectedPdfInvoice, setSelectedPdfInvoice] = useState<{
    invoiceId: number;
    invoiceNumber: string;
    customerEmail: string;
  } | null>(null);

  // Estimate / WO / BS tab state
  const [activeView, setActiveView] = useState<"estimates" | "work-orders" | "billing-sheets">("estimates");
  const [selectedEstimateId, setSelectedEstimateId] = useState<number | null>(null);
  const [estimateModalOpen, setEstimateModalOpen] = useState(false);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null);
  const [workOrderModalOpen, setWorkOrderModalOpen] = useState(false);
  const [selectedBillingSheet, setSelectedBillingSheet] = useState<BillingSheetWithItems | null>(null);
  const [billedWOExpanded, setBilledWOExpanded] = useState(false);
  const [billedBSExpanded, setBilledBSExpanded] = useState(false);

  useEffect(() => {
    const savedUser = safeGet("user");
    if (savedUser) {
      try {
        const userData = JSON.parse(savedUser);
        setUserRole(userData.role || "");
      } catch {}
    }
  }, []);

  const { data: customer, isLoading } = useQuery<Customer>({
    queryKey: [`/api/customers/${id}`],
  });

  const { data: estimates = [] } = useArrayQuery<Estimate>({
    queryKey: [`/api/customers/${id}/estimates`],
    enabled: !!id,
  });

  const { data: workOrders = [] } = useArrayQuery<WorkOrder>({
    queryKey: [`/api/customers/${id}/work-orders`],
    enabled: !!id,
  });

  const { data: billingSheets = [] } = useArrayQuery<BillingSheetWithItems>({
    queryKey: [`/api/customers/${id}/billing-sheets`],
    enabled: !!id,
  });

  const isAdmin = userRole === "company_admin" || userRole === "super_admin";
  const isBillingRole =
    userRole === "company_admin" ||
    userRole === "super_admin" ||
    userRole === "billing_manager";
  const canEditIrrigation =
    userRole === "company_admin" ||
    userRole === "super_admin" ||
    userRole === "billing_manager";

  const isWOBilled = (wo: WorkOrder) => wo.status === "billed" || !!wo.invoiceId;
  const isBSBilled = (bs: BillingSheetWithItems) => bs.status === "billed" || !!bs.invoiceId;

  const handleOpenPdf = (invoiceId: number, invoiceNumber: string, customerEmail: string) => {
    setSelectedPdfInvoice({ invoiceId, invoiceNumber, customerEmail });
    setShowPdfModal(true);
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);

  const formatDate = (date: string | Date) =>
    new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

  const totalEstimateValue = estimates.reduce((s, e) => s + Number(e.totalAmount || 0), 0);
  const totalBillingValue = billingSheets.reduce((s, b) => s + Number(b.totalAmount || 0), 0);

  const getStatusBadge = (status: string) => {
    const cfg: Record<string, { color: string; icon: string; bg: string }> = {
      pending:                { color: "text-amber-700",   icon: "⏳", bg: "bg-amber-50 border-amber-200" },
      approved:               { color: "text-emerald-700", icon: "✅", bg: "bg-emerald-50 border-emerald-200" },
      rejected:               { color: "text-red-700",     icon: "❌", bg: "bg-red-50 border-red-200" },
      converted_to_work_order:{ color: "text-blue-700",   icon: "🔄", bg: "bg-blue-50 border-blue-200" },
      sent:                   { color: "text-blue-700",    icon: "📨", bg: "bg-blue-50 border-blue-200" },
      draft:                  { color: "text-gray-700",    icon: "📝", bg: "bg-gray-50 border-gray-200" },
      assigned:               { color: "text-indigo-700",  icon: "👤", bg: "bg-indigo-50 border-indigo-200" },
      in_progress:            { color: "text-purple-700",  icon: "🔧", bg: "bg-purple-50 border-purple-200" },
      completed:              { color: "text-green-700",   icon: "✅", bg: "bg-green-50 border-green-200" },
      cancelled:              { color: "text-gray-700",    icon: "🚫", bg: "bg-gray-50 border-gray-200" },
      billed:                 { color: "text-orange-700",  icon: "💰", bg: "bg-orange-50 border-orange-200" },
    };
    const c = cfg[status] ?? { color: "text-gray-700", icon: "?", bg: "bg-gray-50 border-gray-200" };
    return (
      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-medium text-xs ${c.bg} ${c.color}`}>
        <span>{c.icon}</span>
        {status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-4">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-32 bg-gray-200 rounded" />
          <div className="h-24 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="container mx-auto p-4">
        <div className="text-center py-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Customer Not Found</h2>
          <p className="text-gray-600 mb-4">The customer you're looking for doesn't exist.</p>
          <Button onClick={() => setLocation("/customers")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Customers
          </Button>
        </div>
      </div>
    );
  }

  const displayName = customer.irrigoName || customer.name;
  const addr = displayCustomerAddress(customer);

  return (
    <div className="container mx-auto p-4 max-w-4xl space-y-4 lg:space-y-6">
      {/* ── Mobile Header ───────────────────────────────────────────── */}
      <div className="lg:hidden">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/customers")} className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Customers
        </Button>
        <div className="space-y-3">
          <h1 className="text-2xl font-bold text-gray-900 leading-tight">{displayName}</h1>
          {customer.irrigoName && customer.irrigoName !== customer.name && (
            <p className="text-sm text-gray-500">Official: {customer.name}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default">Active Customer</Badge>
            {customer.quickbooksId && <Badge variant="outline">QuickBooks Synced</Badge>}
          </div>
          <div className="flex flex-col gap-2">
            <Button onClick={() => setLocation(`/customers/${id}/site-maps`)} className="w-full bg-blue-600 hover:bg-blue-700">
              <MapPin className="w-4 h-4 mr-2" />
              View Site Map
            </Button>
            <Button onClick={() => setLocation(`/customers/${id}/irrigation-profile`)} variant="outline" className="w-full">
              <Droplets className="w-4 h-4 mr-2" />
              Controllers &amp; Zones
            </Button>
          </div>
        </div>
      </div>

      {/* ── Desktop Header ──────────────────────────────────────────── */}
      <div className="hidden lg:flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/customers")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Customers
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{displayName}</h1>
            {customer.irrigoName && customer.irrigoName !== customer.name && (
              <p className="text-sm text-gray-500 mt-0.5">Official: {customer.name}</p>
            )}
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="default">Active Customer</Badge>
              {customer.quickbooksId && <Badge variant="outline">QuickBooks Synced</Badge>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setLocation(`/customers/${id}/site-maps`)} className="bg-blue-600 hover:bg-blue-700">
            <MapPin className="w-4 h-4 mr-2" />
            View Site Map
          </Button>
          <Button onClick={() => setLocation(`/customers/${id}/irrigation-profile`)} variant="outline">
            <Droplets className="w-4 h-4 mr-2" />
            Controllers &amp; Zones
          </Button>
        </div>
      </div>

      {/* ── Contact Information ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building className="w-5 h-5" />
            Customer Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {customer.email && (
            <div className="flex items-center gap-3">
              <Mail className="w-4 h-4 text-gray-500" />
              <span className="text-sm">{customer.email}</span>
            </div>
          )}
          {customer.phone && (
            <div className="flex items-center gap-3">
              <Phone className="w-4 h-4 text-gray-500" />
              <span className="text-sm">{customer.phone}</span>
            </div>
          )}
          {addr && (
            <div className="flex items-start gap-3">
              <MapPin className="w-4 h-4 text-gray-500 mt-0.5" />
              <span className="text-sm">{addr}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── KPI Count Tiles ─────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <button
          onClick={() => setActiveView("estimates")}
          className="bg-white rounded-xl p-3 shadow-sm border border-jobtype-est/20 hover:shadow-md transition-shadow text-left"
        >
          <div className="flex flex-col items-center lg:flex-row lg:items-center lg:justify-between mb-1">
            <FileText className="w-5 h-5 text-jobtype-est mb-1 lg:mb-0" />
            <div className="text-xl lg:text-2xl font-bold text-jobtype-est">{estimates.length}</div>
          </div>
          <div className="text-xs sm:text-sm font-medium text-gray-700 text-center lg:text-left">Estimates</div>
          <div className="text-xs text-jobtype-est font-medium mt-0.5 text-center lg:text-left">
            {formatCurrency(totalEstimateValue)}
          </div>
        </button>
        <button
          onClick={() => setActiveView("work-orders")}
          className="bg-white rounded-xl p-3 shadow-sm border border-jobtype-wo/20 hover:shadow-md transition-shadow text-left"
        >
          <div className="flex flex-col items-center lg:flex-row lg:items-center lg:justify-between mb-1">
            <Wrench className="w-5 h-5 text-jobtype-wo mb-1 lg:mb-0" />
            <div className="text-xl lg:text-2xl font-bold text-jobtype-wo">{workOrders.length}</div>
          </div>
          <div className="text-xs sm:text-sm font-medium text-gray-700 text-center lg:text-left">Work Orders</div>
          <div className="text-xs text-jobtype-wo font-medium mt-0.5 text-center lg:text-left">Active Projects</div>
        </button>
        <button
          onClick={() => setActiveView("billing-sheets")}
          className="bg-white rounded-xl p-3 shadow-sm border border-jobtype-bs/20 hover:shadow-md transition-shadow text-left"
        >
          <div className="flex flex-col items-center lg:flex-row lg:items-center lg:justify-between mb-1">
            <Receipt className="w-5 h-5 text-jobtype-bs mb-1 lg:mb-0" />
            <div className="text-xl lg:text-2xl font-bold text-jobtype-bs">{billingSheets.length}</div>
          </div>
          <div className="text-xs sm:text-sm font-medium text-gray-700 text-center lg:text-left">Billing Sheets</div>
          <div className="text-xs text-jobtype-bs font-medium mt-0.5 text-center lg:text-left">
            {formatCurrency(totalBillingValue)}
          </div>
        </button>
      </div>

      {/* ── Billing Settings — billing roles only ───────────────────── */}
      {isBillingRole && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5" />
              Billing Rates
              <span className="text-xs font-normal text-gray-400 ml-1">(billing team only)</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="bg-gray-50 rounded-lg p-3 border">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Labor Rate</p>
                <p className="text-lg font-semibold text-gray-900">
                  {formatCurrency(Number(customer.laborRate || 45))}
                  <span className="text-sm font-normal text-gray-500">/hr</span>
                </p>
              </div>
              <div className="bg-orange-50 rounded-lg p-3 border border-orange-200">
                <p className="text-xs text-orange-600 uppercase tracking-wide mb-1">Emergency Labor Rate</p>
                <p className="text-lg font-semibold text-orange-700">
                  {formatCurrency(Number(customer.emergencyLaborRate || 125))}
                  <span className="text-sm font-normal text-orange-500">/hr</span>
                </p>
              </div>
              {customer.discountPercent && parseFloat(customer.discountPercent) > 0 && (
                <div className="bg-gray-50 rounded-lg p-3 border">
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Discount</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {parseFloat(customer.discountPercent).toFixed(0)}
                    <span className="text-sm font-normal text-gray-500">%</span>
                  </p>
                </div>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-3">
              These rates are applied automatically when invoices are generated. Use Edit Customer to update.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Billing Notes — billing roles only ──────────────────────── */}
      {isBillingRole && (
        <BillingNotes customer={customer} userRole={userRole} />
      )}

      {/* ── Financial Pulse + Budget & Alerts — billing roles only ─── */}
      {isBillingRole && (
        <>
          <FinancialPulseWidget variant="customer-detail" customerId={parseInt(id!, 10)} />
          <BudgetCard customerId={parseInt(id!, 10)} />
          <RecentBudgetAlertsCard customerId={parseInt(id!, 10)} />
        </>
      )}

      {/* ── Property Notes ──────────────────────────────────────────── */}
      <PropertyNotes customer={customer} userRole={userRole} />

      {/* ── Property Boundary ───────────────────────────────────────── */}
      <PropertyBoundarySection customer={customer} userRole={userRole} />

      {/* ── Irrigation System diagram ───────────────────────────────── */}
      <IrrigationSystemCard customer={customer} canEdit={canEditIrrigation} />

      {/* ── Estimates / Work Orders / Billing Sheets tabs ───────────── */}
      <div>
        {/* Tab selector */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 bg-gray-100 p-1 rounded-xl mb-4">
          {(
            [
              { key: "estimates",      label: "Estimates",      Icon: FileText, count: estimates.length,     color: "jobtype-est" },
              { key: "work-orders",    label: "Work Orders",    Icon: Wrench,   count: workOrders.length,    color: "jobtype-wo"  },
              { key: "billing-sheets", label: "Billing Sheets", Icon: Receipt,  count: billingSheets.length, color: "jobtype-bs"  },
            ] as const
          ).map(({ key, label, Icon, count, color }) => (
            <button
              key={key}
              onClick={() => setActiveView(key)}
              className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-medium transition-all duration-200 text-sm ${
                activeView === key
                  ? `bg-${color} text-white shadow-md`
                  : "text-gray-600 hover:bg-white hover:shadow-sm"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{label}</span>
              <div className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${
                activeView === key
                  ? `bg-${color}/80 text-white`
                  : `bg-${color}/15 text-${color}`
              }`}>
                {count}
              </div>
            </button>
          ))}
        </div>

        {/* Estimates view */}
        {activeView === "estimates" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Customer Estimates</h2>
              <div className="text-sm text-gray-600">
                Total: <span className="font-semibold text-green-600">{formatCurrency(totalEstimateValue)}</span>
              </div>
            </div>
            {estimates.length === 0 ? (
              <Card className="border-2 border-dashed border-gray-200">
                <CardContent className="flex items-center justify-center py-16">
                  <div className="text-center">
                    <div className="bg-jobtype-est/15 p-4 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                      <FileText className="w-10 h-10 text-jobtype-est" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">No Estimates Yet</h3>
                    <p className="text-gray-600 text-sm">This customer doesn't have any estimates created.</p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {estimates.map((estimate) => (
                  <Card
                    key={estimate.id}
                    className="group hover:shadow-lg transition-all duration-200 cursor-pointer border-l-4 border-l-jobtype-est bg-gradient-to-r from-jobtype-est/5 to-transparent"
                    onClick={() => { setSelectedEstimateId(estimate.id); setEstimateModalOpen(true); }}
                  >
                    <CardContent className="p-4 sm:p-6">
                      <div className="flex items-center gap-3">
                        <div className="bg-jobtype-est p-2.5 rounded-lg shadow-sm flex-shrink-0">
                          <FileText className="w-5 h-5 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-gray-900 group-hover:text-jobtype-est transition-colors">
                            {formatEstimateNumber(estimate.estimateNumber)}
                          </h3>
                          <p className="text-gray-600 text-sm">{estimate.projectName}</p>
                        </div>
                        <div className="flex-shrink-0">{getStatusBadge(lifecycleOf(estimate))}</div>
                      </div>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 mt-3 pt-3 border-t border-gray-100">
                        <div className="flex items-center gap-2 text-gray-500 text-sm">
                          <Calendar className="w-4 h-4" />
                          <span>Created {formatDate(estimate.createdAt)}</span>
                        </div>
                        <div className="flex items-center gap-2 text-gray-500 text-sm">
                          <DollarSign className="w-4 h-4" />
                          <span className="font-semibold text-jobtype-est">{formatCurrency(Number(estimate.totalAmount || 0))}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Work Orders view */}
        {activeView === "work-orders" && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Customer Work Orders</h2>
            {workOrders.length === 0 ? (
              <Card className="border-2 border-dashed border-gray-200">
                <CardContent className="flex items-center justify-center py-16">
                  <div className="text-center">
                    <div className="bg-jobtype-wo/15 p-4 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                      <Wrench className="w-10 h-10 text-jobtype-wo" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">No Work Orders</h3>
                    <p className="text-gray-600 text-sm">This customer doesn't have any work orders yet.</p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-4">
                  {workOrders.filter((wo) => !isWOBilled(wo)).map((workOrder) => (
                    <Card
                      key={workOrder.id}
                      className="group hover:shadow-lg transition-all duration-200 cursor-pointer border-l-4 border-l-jobtype-wo bg-gradient-to-r from-jobtype-wo/5 to-transparent"
                      onClick={() => { setSelectedWorkOrder(workOrder); setWorkOrderModalOpen(true); }}
                    >
                      <CardContent className="p-4 sm:p-6">
                        <div className="flex items-center gap-3">
                          <div className="bg-jobtype-wo p-2.5 rounded-lg shadow-sm flex-shrink-0">
                            <Wrench className="w-5 h-5 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-bold text-gray-900 group-hover:text-jobtype-wo transition-colors">
                              {workOrder.workOrderNumber}
                            </h3>
                            <p className="text-gray-600 text-sm">{workOrder.projectName}</p>
                          </div>
                          <div className="flex-shrink-0">{getStatusBadge(workOrder.status)}</div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                {workOrders.filter((wo) => isWOBilled(wo)).length > 0 && (
                  <div className="border border-green-200 rounded-xl overflow-hidden">
                    <button
                      className="w-full flex items-center justify-between px-4 py-3 bg-green-50 hover:bg-green-100 transition-colors text-left"
                      onClick={() => setBilledWOExpanded(!billedWOExpanded)}
                    >
                      <div className="flex items-center gap-2 text-sm font-medium text-green-800">
                        {billedWOExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        Billed — {workOrders.filter((wo) => isWOBilled(wo)).length} work order{workOrders.filter((wo) => isWOBilled(wo)).length !== 1 ? "s" : ""}
                      </div>
                    </button>
                    {billedWOExpanded && (
                      <div className="grid gap-3 p-3 bg-green-50/30">
                        {workOrders.filter((wo) => isWOBilled(wo)).map((workOrder) => (
                          <Card
                            key={workOrder.id}
                            className="border-l-4 border-l-green-400 bg-green-50/60 border border-green-200 cursor-pointer hover:shadow-md transition-shadow"
                            onClick={() => { setSelectedWorkOrder(workOrder); setWorkOrderModalOpen(true); }}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-center gap-3">
                                <div className="bg-green-500 p-2.5 rounded-lg flex-shrink-0">
                                  <Wrench className="w-5 h-5 text-white" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <h3 className="font-bold text-gray-900">{workOrder.workOrderNumber}</h3>
                                  <p className="text-gray-600 text-sm">{workOrder.projectName}</p>
                                </div>
                                <div className="flex-shrink-0 flex flex-col items-end gap-1">
                                  {getStatusBadge(workOrder.status)}
                                  <BilledBadge />
                                </div>
                              </div>
                              <div className="pt-2 border-t border-green-100 mt-3">
                                <BilledIndicator compact invoiceId={workOrder.invoiceId} billedAt={workOrder.billedAt} />
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Billing Sheets view */}
        {activeView === "billing-sheets" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Customer Billing Sheets</h2>
              <div className="text-sm text-gray-600">
                Total: <span className="font-semibold text-green-600">{formatCurrency(totalBillingValue)}</span>
              </div>
            </div>
            {billingSheets.length === 0 ? (
              <Card className="border-2 border-dashed border-gray-200">
                <CardContent className="flex items-center justify-center py-16">
                  <div className="text-center">
                    <div className="bg-jobtype-bs/15 p-4 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                      <Receipt className="w-10 h-10 text-jobtype-bs" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">No Billing Sheets</h3>
                    <p className="text-gray-600 text-sm">This customer doesn't have any billing sheets created.</p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-4">
                  {billingSheets.filter((bs) => !isBSBilled(bs)).map((billingSheet) => (
                    <Card
                      key={billingSheet.id}
                      className="group hover:shadow-lg transition-all duration-200 cursor-pointer border-l-4 border-l-jobtype-bs bg-gradient-to-r from-jobtype-bs/5 to-transparent"
                      onClick={() => setSelectedBillingSheet(billingSheet)}
                    >
                      <CardContent className="p-4 sm:p-6">
                        <div className="flex items-center gap-3">
                          <div className="bg-jobtype-bs p-2.5 rounded-lg flex-shrink-0">
                            <Receipt className="w-5 h-5 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-bold text-gray-900 group-hover:text-jobtype-bs transition-colors">
                              {billingSheet.billingNumber}
                            </h3>
                            <p className="text-gray-600 text-sm">{billingSheet.notes || "Billing sheet"}</p>
                          </div>
                          <div className="flex-shrink-0 text-right">
                            <div className="mb-1">{getStatusBadge(billingSheet.status)}</div>
                            <div className="text-lg font-bold text-jobtype-bs">{formatCurrency(Number(billingSheet.totalAmount || 0))}</div>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-gray-100 mt-3">
                          <div className="flex items-center gap-2 text-gray-500 text-sm">
                            <Calendar className="w-4 h-4" />
                            <span>Created {formatDate(billingSheet.createdAt)}</span>
                          </div>
                          <div className="flex items-center gap-2 text-gray-500 text-sm">
                            <User className="w-4 h-4" />
                            <span>{billingSheet.technicianName}</span>
                          </div>
                          <div className="flex items-center gap-2 text-gray-500 text-sm">
                            <Package className="w-4 h-4" />
                            <span>{billingSheet.items?.length || 0} items</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                {billingSheets.filter((bs) => isBSBilled(bs)).length > 0 && (
                  <div className="border border-purple-200 rounded-xl overflow-hidden">
                    <button
                      className="w-full flex items-center justify-between px-4 py-3 bg-purple-50 hover:bg-purple-100 transition-colors text-left"
                      onClick={() => setBilledBSExpanded(!billedBSExpanded)}
                    >
                      <div className="flex items-center gap-2 text-sm font-medium text-purple-800">
                        {billedBSExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        Billed — {billingSheets.filter((bs) => isBSBilled(bs)).length} billing sheet{billingSheets.filter((bs) => isBSBilled(bs)).length !== 1 ? "s" : ""}
                      </div>
                    </button>
                    {billedBSExpanded && (
                      <div className="grid gap-3 p-3 bg-purple-50/30">
                        {billingSheets.filter((bs) => isBSBilled(bs)).map((billingSheet) => (
                          <Card
                            key={billingSheet.id}
                            className="border-l-4 border-l-purple-400 bg-purple-50/60 border border-purple-200 cursor-pointer hover:shadow-md transition-shadow"
                            onClick={() => setSelectedBillingSheet(billingSheet)}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-center gap-3">
                                <div className="bg-purple-500 p-2.5 rounded-lg flex-shrink-0">
                                  <Receipt className="w-5 h-5 text-white" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <h3 className="font-bold text-gray-900">{billingSheet.billingNumber}</h3>
                                  <p className="text-gray-600 text-sm">{billingSheet.notes || "Billing sheet"}</p>
                                </div>
                                <div className="flex-shrink-0 text-right">
                                  <div className="mb-1"><BilledBadge /></div>
                                  <div className="text-lg font-bold text-purple-700">{formatCurrency(Number(billingSheet.totalAmount || 0))}</div>
                                </div>
                              </div>
                              <div className="pt-2 border-t border-purple-100 mt-3">
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
            )}
          </div>
        )}
      </div>

      {/* ── Invoices ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="w-5 h-5" />
            Invoices
          </CardTitle>
        </CardHeader>
        <CardContent>
          <InvoiceList customerId={parseInt(id!)} limit={10} onOpenPdf={handleOpenPdf} />
        </CardContent>
      </Card>

      {/* ── Modals ───────────────────────────────────────────────────── */}
      {estimateModalOpen && selectedEstimateId && (
        <EstimateDetailModal
          open={estimateModalOpen}
          onOpenChange={(open) => { setEstimateModalOpen(open); if (!open) setSelectedEstimateId(null); }}
          estimateId={selectedEstimateId}
        />
      )}

      {workOrderModalOpen && selectedWorkOrder && (
        <CompletedWorkDetailModal
          type="work_order"
          id={selectedWorkOrder.id}
          data={selectedWorkOrder}
          open={workOrderModalOpen}
          onOpenChange={(open) => { setWorkOrderModalOpen(open); if (!open) setSelectedWorkOrder(null); }}
          showPricing={true}
        />
      )}

      {selectedBillingSheet && (
        <CompletedWorkDetailModal
          type="billing_sheet"
          id={selectedBillingSheet.id}
          data={selectedBillingSheet}
          open={!!selectedBillingSheet}
          onOpenChange={(open) => { if (!open) setSelectedBillingSheet(null); }}
          showPricing={true}
        />
      )}

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

// ─── Budget & Alerts cards (billing roles only) ──────────────────────────────
type BudgetStatus = "unset" | "healthy" | "approaching" | "over";
interface BudgetUsage {
  customerId: number;
  softThresholdPercent: number;
  hardThresholdPercent: number;
  currentMonthKey: string;
  currentYearKey: string;
  monthlyCap: number | null;
  monthlySpend: number;
  monthlyPercent: number | null;
  monthlyStatus: BudgetStatus;
  annualCap: number | null;
  annualSpend: number;
  annualPercent: number | null;
  annualStatus: BudgetStatus;
}

function statusBadge(status: BudgetStatus) {
  switch (status) {
    case "over":       return <Badge className="bg-red-600 text-white">Over cap</Badge>;
    case "approaching":return <Badge className="bg-amber-500 text-white">Approaching cap</Badge>;
    case "healthy":    return <Badge className="bg-emerald-600 text-white">On track</Badge>;
    default:           return <Badge variant="outline">No cap set</Badge>;
  }
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

interface BudgetBucket {
  cap: number | null;
  spend: number;
  percent: number | null;
  status: BudgetStatus;
  periodKey: string;
}

const BUCKET_ACCENT: Record<BudgetStatus, string> = {
  healthy:    "border-l-4 border-emerald-400 bg-emerald-50/40",
  approaching:"border-l-4 border-amber-400 bg-amber-50/40",
  over:       "border-l-4 border-rose-400 bg-rose-50/40",
  unset:      "",
};

function BudgetBucketRow({ label, bucket }: { label: string; bucket: BudgetBucket }) {
  const pct = bucket.percent != null ? Math.min(100, Math.round(bucket.percent * 100)) : 0;
  return (
    <div className={`rounded-md border p-3 bg-white shadow-sm ${BUCKET_ACCENT[bucket.status] ?? ""}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium text-sm text-gray-700">
          {label} <span className="text-xs text-gray-400">({bucket.periodKey})</span>
        </span>
        {statusBadge(bucket.status)}
      </div>
      {bucket.cap == null ? (
        <p className="text-xs text-gray-500">Spent {fmtCurrency(bucket.spend)} — no cap configured.</p>
      ) : (
        <>
          <Progress value={pct} />
          <p className="text-xs text-gray-600 mt-1">
            {fmtCurrency(bucket.spend)} of {fmtCurrency(bucket.cap)}
            {bucket.percent != null && ` (${Math.round(bucket.percent * 100)}%)`}
          </p>
        </>
      )}
    </div>
  );
}

function BudgetCard({ customerId }: { customerId: number }) {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useQuery<BudgetUsage>({
    queryKey: [`/api/customers/${customerId}/budget-usage`],
  });
  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Bell className="w-5 h-5" /> Budget &amp; Alerts</CardTitle></CardHeader>
        <CardContent><div className="h-16 bg-gray-100 rounded animate-pulse" /></CardContent>
      </Card>
    );
  }
  if (!data) return null;
  const monthlyBucket: BudgetBucket = { cap: data.monthlyCap, spend: data.monthlySpend, percent: data.monthlyPercent, status: data.monthlyStatus, periodKey: data.currentMonthKey };
  const annualBucket: BudgetBucket  = { cap: data.annualCap,  spend: data.annualSpend,  percent: data.annualPercent,  status: data.annualStatus,  periodKey: data.currentYearKey  };
  const bothUnset = data.monthlyStatus === "unset" && data.annualStatus === "unset";
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Bell className="w-5 h-5" /> Budget &amp; Alerts</CardTitle></CardHeader>
      <CardContent>
        {bothUnset ? (
          <div className="text-sm text-gray-600">
            <p className="mb-2">No budget caps set for this customer yet.</p>
            <Button type="button" variant="outline" size="sm"
              onClick={() => setLocation(`/customers?edit=${customerId}#budget-and-alerts`)}>
              Set a budget
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <BudgetBucketRow label="This month" bucket={monthlyBucket} />
            <BudgetBucketRow label="This year"  bucket={annualBucket} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface BudgetAlertEvent {
  id: number;
  customerId: number;
  period: "monthly" | "annual";
  threshold: "soft" | "hard";
  periodKey: string;
  firedAt: string;
  triggeringInvoiceId: number | null;
  triggeringInvoiceNumber: string | null;
}

function RecentBudgetAlertsCard({ customerId }: { customerId: number }) {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useQuery<{ customerId: number; events: BudgetAlertEvent[] }>({
    queryKey: [`/api/customers/${customerId}/budget-alert-events`],
  });

  if (isLoading) {
    return (
      <Card className="shadow-md">
        <CardHeader><CardTitle className="flex items-center gap-2"><Bell className="w-5 h-5" /> Recent Budget Alerts</CardTitle></CardHeader>
        <CardContent><div className="h-12 bg-gray-100 rounded animate-pulse" /></CardContent>
      </Card>
    );
  }

  const events = Array.isArray(data?.events) ? data!.events : [];
  return (
    <Card className="shadow-md">
      <CardHeader><CardTitle className="flex items-center gap-2"><Bell className="w-5 h-5" /> Recent Budget Alerts</CardTitle></CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-gray-500">No budget alerts have fired for this customer yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {events.map((ev) => {
              const periodLabel = ev.period === "monthly" ? "Monthly" : "Annual";
              const thresholdLabel = ev.threshold === "hard" ? "Exceeded" : "Warning";
              const thresholdClass = ev.threshold === "hard" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800";
              const firedAt = new Date(ev.firedAt);
              const firedLabel = isNaN(firedAt.getTime())
                ? ev.firedAt
                : firedAt.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
              return (
                <li key={ev.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-xs px-2 py-0.5 rounded ${thresholdClass}`}>{thresholdLabel}</span>
                    <span className="text-sm font-medium text-gray-800 truncate">{periodLabel} · {ev.periodKey}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500 shrink-0">
                    {ev.triggeringInvoiceId && ev.triggeringInvoiceNumber && (
                      <button type="button" className="underline hover:text-gray-700"
                        onClick={() => setLocation(`/invoices/${ev.triggeringInvoiceId}`)}>
                        {ev.triggeringInvoiceNumber}
                      </button>
                    )}
                    <span>{firedLabel}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
