import { safeGet } from "@/utils/safeStorage";
import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, MapPin, Phone, Mail, Building, FileText, Receipt, DollarSign, Bell, Droplets } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Customer } from "@workspace/db/schema";
import { InvoiceList } from "@/components/billing/invoice-list";
import { InvoicePdfPreviewModal } from "@/components/billing/invoice-pdf-preview-modal";
import { IrrigationSystemCard } from "@/components/customers/irrigation-system-card";
import { FinancialPulseWidget } from "@/components/financial-pulse/financial-pulse-widget";

export default function CustomerProfile() {
  const { id } = useParams();
  const [, setLocation] = useLocation();

  const [showPdfModal, setShowPdfModal] = useState(false);
  const [selectedPdfInvoice, setSelectedPdfInvoice] = useState<{
    invoiceId: number;
    invoiceNumber: string;
    customerEmail: string;
  } | null>(null);
  const [userRole, setUserRole] = useState<string>("");

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

  const isAdmin = userRole === "company_admin" || userRole === "super_admin";
  // Irrigation diagram editing follows the same admin/manager gate that the
  // server uses for customer edits (requireCustomerEditAccess), which includes
  // billing managers in addition to admins.
  const canEditIrrigation =
    userRole === "company_admin" ||
    userRole === "super_admin" ||
    userRole === "billing_manager";

  const handleOpenPdf = (invoiceId: number, invoiceNumber: string, customerEmail: string) => {
    setSelectedPdfInvoice({ invoiceId, invoiceNumber, customerEmail });
    setShowPdfModal(true);
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-4">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
          <div className="h-24 bg-gray-200 rounded"></div>
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

  return (
    <div className="container mx-auto p-4 max-w-4xl space-y-4 lg:space-y-6">
      {/* Mobile Header */}
      <div className="lg:hidden">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/customers")}
          className="mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Customers
        </Button>
        <div className="space-y-3">
          <h1 className="text-2xl font-bold text-gray-900 leading-tight">{customer.name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default">Active Customer</Badge>
            {customer.quickbooksId && (
              <Badge variant="outline">QuickBooks Synced</Badge>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Button
              onClick={() => setLocation(`/customers/${id}/site-maps`)}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              <MapPin className="w-4 h-4 mr-2" />
              View Site Map
            </Button>
            <Button
              onClick={() => setLocation(`/customers/${id}/irrigation-profile`)}
              variant="outline"
              className="w-full"
            >
              <Droplets className="w-4 h-4 mr-2" />
              Controllers &amp; Zones
            </Button>
          </div>
        </div>
      </div>

      {/* Desktop Header */}
      <div className="hidden lg:flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/customers")}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Customers
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{customer.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="default">Active Customer</Badge>
              {customer.quickbooksId && (
                <Badge variant="outline">QuickBooks Synced</Badge>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => setLocation(`/customers/${id}/site-maps`)}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <MapPin className="w-4 h-4 mr-2" />
            View Site Map
          </Button>
          <Button
            onClick={() => setLocation(`/customers/${id}/irrigation-profile`)}
            variant="outline"
          >
            <Droplets className="w-4 h-4 mr-2" />
            Controllers &amp; Zones
          </Button>
        </div>
      </div>

      {/* Customer Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building className="w-5 h-5" />
            Customer Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Mobile Layout */}
          <div className="lg:hidden space-y-4">
            <h3 className="font-semibold text-gray-900 text-lg">Contact Details</h3>
            {customer.email && (
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <Mail className="w-5 h-5 text-blue-600" />
                <span className="text-sm font-medium">{customer.email}</span>
              </div>
            )}
            {customer.phone && (
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <Phone className="w-5 h-5 text-blue-600" />
                <span className="text-sm font-medium">{customer.phone}</span>
              </div>
            )}
            {customer.address && (
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <MapPin className="w-5 h-5 text-blue-600 mt-0.5" />
                <span className="text-sm font-medium leading-relaxed">{customer.address}</span>
              </div>
            )}
          </div>

          {/* Desktop Layout */}
          <div className="hidden lg:block space-y-3">
            <h3 className="font-semibold text-gray-900">Contact Details</h3>
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
            {customer.address && (
              <div className="flex items-start gap-3">
                <MapPin className="w-4 h-4 text-gray-500 mt-1" />
                <span className="text-sm">{customer.address}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Billing Settings — admin only */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5" />
              Billing Settings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Labor Rate</p>
                <p className="text-lg font-semibold text-gray-900">
                  ${parseFloat(customer.laborRate || "45").toFixed(2)}
                  <span className="text-sm font-normal text-gray-500">/hr</span>
                </p>
              </div>
              {customer.discountPercent && parseFloat(customer.discountPercent) > 0 && (
                <div className="bg-gray-50 rounded-lg p-3">
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

      {/* Budget & Alerts — Task #687 (Slice 1). Visibility limited to
          super_admin / company_admin / billing_manager. irrigation_manager
          and field_tech do NOT see budget signals in Slice 1. */}
      {(userRole === "company_admin" ||
        userRole === "super_admin" ||
        userRole === "billing_manager") && (
        <>
          {/* Task #708 — FP widget rendered above BudgetCard. The
              widget's monthly meter agrees with BudgetCard exactly
              (both read the same underlying customer + invoice data). */}
          <FinancialPulseWidget
            variant="customer-detail"
            customerId={parseInt(id!, 10)}
          />
          <BudgetCard customerId={parseInt(id!, 10)} />
          <RecentBudgetAlertsCard customerId={parseInt(id!, 10)} />
        </>
      )}

      {/* Property Notes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Property Notes
          </CardTitle>
        </CardHeader>
        <CardContent>
          {customer.propertyNotes ? (
            <div className="lg:prose lg:prose-sm max-w-none">
              <div
                className="whitespace-pre-wrap text-gray-700 leading-relaxed text-sm lg:text-base p-4 lg:p-0 bg-gray-50 lg:bg-transparent rounded-lg lg:rounded-none"
                style={{ wordBreak: "break-word" }}
              >
                {customer.propertyNotes}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 lg:py-12 text-gray-500">
              <FileText className="w-10 h-10 lg:w-12 lg:h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm lg:text-base">No property notes available for this customer.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Irrigation System diagram */}
      <IrrigationSystemCard customer={customer} canEdit={canEditIrrigation} />

      {/* Invoices */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="w-5 h-5" />
            Invoices
          </CardTitle>
        </CardHeader>
        <CardContent>
          <InvoiceList
            customerId={parseInt(id!)}
            limit={10}
            onOpenPdf={handleOpenPdf}
          />
        </CardContent>
      </Card>

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

// ─── Task #687 — Budget & Alerts visibility card ────────────────────────────
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
    case "over":
      return <Badge className="bg-red-600 text-white">Over cap</Badge>;
    case "approaching":
      return <Badge className="bg-amber-500 text-white">Approaching cap</Badge>;
    case "healthy":
      return <Badge className="bg-emerald-600 text-white">On track</Badge>;
    default:
      return <Badge variant="outline">No cap set</Badge>;
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
  approaching: "border-l-4 border-amber-400 bg-amber-50/40",
  over:       "border-l-4 border-rose-400 bg-rose-50/40",
  unset:      "",
};

function BudgetBucketRow({ label, bucket }: { label: string; bucket: BudgetBucket }) {
  const pct = bucket.percent != null ? Math.min(100, Math.round(bucket.percent * 100)) : 0;
  const accentClass = BUCKET_ACCENT[bucket.status] ?? "";
  return (
    <div className={`rounded-md border p-3 bg-white shadow-sm ${accentClass}`} data-testid={`budget-bucket-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium text-sm text-gray-700">
          {label} <span className="text-xs text-gray-400">({bucket.periodKey})</span>
        </span>
        {statusBadge(bucket.status)}
      </div>
      {bucket.cap == null ? (
        <p className="text-xs text-gray-500">
          Spent {fmtCurrency(bucket.spend)} — no cap configured.
        </p>
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

// Task #693 — Financial Pulse Slice 4. "Recent Budget Alerts" feed,
// rendered beneath BudgetCard on the customer profile. Same visibility
// gate as BudgetCard (super_admin / company_admin / billing_manager).
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
  const { data, isLoading } = useQuery<{
    customerId: number;
    events: BudgetAlertEvent[];
  }>({
    queryKey: [`/api/customers/${customerId}/budget-alert-events`],
  });

  if (isLoading) {
    return (
      <Card className="shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5" /> Recent Budget Alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-12 bg-gray-100 rounded animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  const events = Array.isArray(data?.events) ? data!.events : [];
  if (events.length === 0) {
    return (
      <Card className="shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5" /> Recent Budget Alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500" data-testid="budget-alerts-empty">
            No budget alerts have fired for this customer yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="w-5 h-5" /> Recent Budget Alerts
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul
          className="divide-y divide-gray-100"
          data-testid="budget-alerts-list"
        >
          {events.map((ev) => {
            const periodLabel = ev.period === "monthly" ? "Monthly" : "Annual";
            const thresholdLabel =
              ev.threshold === "hard" ? "Exceeded" : "Warning";
            const thresholdClass =
              ev.threshold === "hard"
                ? "bg-red-100 text-red-800"
                : "bg-amber-100 text-amber-800";
            const firedAt = new Date(ev.firedAt);
            const firedLabel = isNaN(firedAt.getTime())
              ? ev.firedAt
              : firedAt.toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                });
            return (
              <li
                key={ev.id}
                className="py-2 flex items-center justify-between gap-3"
                data-testid={`budget-alert-row-${ev.id}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${thresholdClass}`}
                  >
                    {thresholdLabel}
                  </span>
                  <span className="text-sm font-medium text-gray-800 truncate">
                    {periodLabel} · {ev.periodKey}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500 shrink-0">
                  {ev.triggeringInvoiceId && ev.triggeringInvoiceNumber ? (
                    <button
                      type="button"
                      className="underline hover:text-gray-700"
                      onClick={() =>
                        setLocation(`/invoices/${ev.triggeringInvoiceId}`)
                      }
                      data-testid={`budget-alert-invoice-${ev.id}`}
                    >
                      {ev.triggeringInvoiceNumber}
                    </button>
                  ) : null}
                  <span>{firedLabel}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
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
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5" /> Budget &amp; Alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-16 bg-gray-100 rounded animate-pulse" />
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;
  const monthlyBucket: BudgetBucket = {
    cap: data.monthlyCap, spend: data.monthlySpend, percent: data.monthlyPercent,
    status: data.monthlyStatus, periodKey: data.currentMonthKey,
  };
  const annualBucket: BudgetBucket = {
    cap: data.annualCap, spend: data.annualSpend, percent: data.annualPercent,
    status: data.annualStatus, periodKey: data.currentYearKey,
  };
  const bothUnset = data.monthlyStatus === "unset" && data.annualStatus === "unset";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="w-5 h-5" /> Budget &amp; Alerts
        </CardTitle>
      </CardHeader>
      <CardContent>
        {bothUnset ? (
          <div className="text-sm text-gray-600" data-testid="budget-card-unset">
            <p className="mb-2">No budget caps set for this customer yet.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLocation(`/customers?edit=${customerId}#budget-and-alerts`)}
              data-testid="budget-card-set-cta"
            >
              Set a budget
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <BudgetBucketRow label="This month" bucket={monthlyBucket} />
            <BudgetBucketRow label="This year" bucket={annualBucket} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

