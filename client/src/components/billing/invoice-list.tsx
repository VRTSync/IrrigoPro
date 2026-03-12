import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Loader2, AlertCircle, Calendar, CheckCircle2, CloudOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface Invoice {
  id: number;
  invoiceNumber: string;
  customerName: string;
  customerEmail: string;
  totalAmount: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  createdAt: string;
  quickbooksInvoiceId?: string;
}

interface InvoiceListProps {
  customerId?: number;
  limit?: number;
  onOpenPdf?: (invoiceId: number, invoiceNumber: string, customerEmail: string) => void;
}

export function InvoiceList({ customerId, limit = 20, onOpenPdf }: InvoiceListProps) {
  const { data: invoices = [], isLoading, error } = useQuery<Invoice[]>({
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

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {invoices.map((invoice) => (
        <Card key={invoice.id} className="border border-gray-200 hover:shadow-md transition-shadow">
          <CardContent className="p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-blue-600" />
                <h3 className="font-semibold text-base" data-testid={`text-month-${invoice.id}`}>
                  {formatMonthYear(invoice.periodStart)}
                </h3>
              </div>
              {getStatusBadge(invoice.status)}
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
                  <span className="flex items-center gap-1 text-xs text-gray-400">
                    <CloudOff className="w-3.5 h-3.5" />
                    Not synced
                  </span>
                )}
              </div>
            </div>

            {onOpenPdf && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => onOpenPdf(invoice.id, invoice.invoiceNumber, invoice.customerEmail)}
                data-testid={`button-view-pdf-${invoice.id}`}
              >
                <FileText className="w-4 h-4 mr-2" />
                View Details
              </Button>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
