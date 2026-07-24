import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Loader2, AlertCircle, Calendar, CheckCircle2, RefreshCw, ClipboardList } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { apiRequest, queryClient, useArrayQuery } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { InvoiceAuditModal } from "./invoice-audit-modal";

interface Invoice {
  id: number;
  invoiceNumber: string;
  customerName: string;
  customerEmail: string;
  totalAmount: string;
  periodStart: string;
  periodEnd: string;
  invoiceMonth: number;
  invoiceYear: number;
  status: string;
  createdAt: string;
  quickbooksInvoiceId?: string;
  billingType?: string;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function invoiceMonthLabel(invoice: Invoice): string {
  return `${MONTH_NAMES[invoice.invoiceMonth - 1]} ${invoice.invoiceYear}`;
}

interface InvoiceListProps {
  customerId?: number;
  limit?: number;
  onOpenPdf?: (invoiceId: number, invoiceNumber: string, customerEmail: string) => void;
}

export function InvoiceList({ customerId, limit = 20, onOpenPdf }: InvoiceListProps) {
  const { toast } = useToast();
  const [auditInvoice, setAuditInvoice] = useState<{ id: number; label: string; total: string } | null>(null);

  const syncMutation = useMutation({
    mutationFn: async (invoiceId: number) => {
      return apiRequest(`/api/invoices/${invoiceId}/sync-quickbooks`, "POST");
    },
    onSuccess: () => {
      toast({ title: "Invoice synced to QuickBooks successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    },
    onError: (error: Error) => {
      toast({
        title: "QuickBooks sync failed",
        description: error.message || "Something went wrong. Please try again.",
        variant: "destructive",
      });
    },
  });

  const { data: invoices = [], isLoading, error } = useArrayQuery<Invoice>({
    queryKey: ["/api/invoices", { customerId, limit }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (customerId) {
        params.append('customerId', customerId.toString());
      }
      params.append('limit', limit.toString());
      
      const response = await fetch(`/api/invoices?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to fetch invoices');
      }
      return response.json();
    },
    enabled: !customerId || customerId > 0,
  });

  const formatMonthYear = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString();
  };

  const formatCurrency = (amount: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(parseFloat(amount));
  };

  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'generated':
        return <Badge className="bg-blue-100 text-blue-800" data-testid={`status-${status}`}>Generated</Badge>;
      case 'sent':
        return <Badge className="bg-green-100 text-green-800" data-testid={`status-${status}`}>Sent</Badge>;
      case 'paid':
        return <Badge className="bg-emerald-100 text-emerald-800" data-testid={`status-${status}`}>Paid</Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-800" data-testid={`status-${status}`}>{status}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
        <span className="ml-2 text-sm text-gray-600">Loading invoices...</span>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <AlertCircle className="w-8 h-8 mx-auto mb-2 text-red-600" />
          <p className="text-sm text-gray-600">Failed to load invoices</p>
        </CardContent>
      </Card>
    );
  }

  if (invoices.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Calendar className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="text-sm font-medium text-gray-500">No monthly invoices yet</p>
          <p className="text-xs text-gray-400 mt-1">Invoices will appear here once billing periods are completed.</p>
        </CardContent>
      </Card>
    );
  }

  // Cancelled invoices are excluded from the customer Invoices tab;
  // they are accessible on the main Invoices page in the audit drawer.
  const visibleInvoices = invoices.filter((inv) => inv.status !== "cancelled");

  if (visibleInvoices.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Calendar className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="text-sm font-medium text-gray-500">No monthly invoices yet</p>
          <p className="text-xs text-gray-400 mt-1">Invoices will appear here once billing periods are completed.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {visibleInvoices.map((invoice) => (
        <Card key={invoice.id} className="border border-gray-200 hover:shadow-md transition-shadow">
          <CardContent className="p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-blue-600" />
                <h3 className="font-semibold text-base" data-testid={`text-month-${invoice.id}`}>
                  {invoiceMonthLabel(invoice)}
                </h3>
              </div>
              <div className="flex flex-col items-end gap-1">
                {getStatusBadge(invoice.status)}
                {invoice.billingType === 'standalone' && (
                  <Badge className="bg-indigo-100 text-indigo-800 text-xs">Standalone</Badge>
                )}
                {invoice.quickbooksInvoiceId && (
                  <Badge className="bg-purple-100 text-purple-800 text-xs">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    QB Synced
                  </Badge>
                )}
              </div>
            </div>

            <div className="space-y-2 text-sm mb-4">
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Invoice #</span>
                <span className="font-medium text-gray-700" data-testid={`text-invoice-number-${invoice.id}`}>
                  {invoice.invoiceNumber}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Total</span>
                <span className="font-semibold text-lg text-gray-900" data-testid={`text-amount-${invoice.id}`}>
                  {formatCurrency(invoice.totalAmount)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Period</span>
                <span className="text-xs text-gray-600" data-testid={`text-period-${invoice.id}`}>
                  {formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500">QuickBooks</span>
                {invoice.quickbooksInvoiceId ? (
                  <span className="flex items-center gap-1 text-xs text-emerald-600">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Synced
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto py-0.5 px-2 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                    disabled={syncMutation.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      syncMutation.mutate(invoice.id);
                    }}
                    data-testid={`button-sync-qb-${invoice.id}`}
                  >
                    {syncMutation.isPending && syncMutation.variables === invoice.id ? (
                      <>
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        Syncing...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-3 h-3 mr-1" />
                        Sync to QuickBooks
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() =>
                  setAuditInvoice({
                    id: invoice.id,
                    label: `${invoiceMonthLabel(invoice)} · #${invoice.invoiceNumber}`,
                    total: formatCurrency(invoice.totalAmount),
                  })
                }
                data-testid={`button-audit-${invoice.id}`}
              >
                <ClipboardList className="w-4 h-4 mr-2" />
                Audit
              </Button>
              {onOpenPdf && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => onOpenPdf(invoice.id, invoice.invoiceNumber, invoice.customerEmail)}
                  data-testid={`button-view-pdf-${invoice.id}`}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  View Details
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}

      {auditInvoice && (
        <InvoiceAuditModal
          open={!!auditInvoice}
          onClose={() => setAuditInvoice(null)}
          invoiceId={auditInvoice.id}
          invoiceLabel={auditInvoice.label}
          invoiceTotal={auditInvoice.total}
        />
      )}
    </div>
  );
}
