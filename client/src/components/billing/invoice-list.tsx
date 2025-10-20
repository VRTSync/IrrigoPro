import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Loader2, AlertCircle } from "lucide-react";
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
  // Fetch invoices with optional customer filter
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
        <CardContent className="p-6 text-center">
          <FileText className="w-8 h-8 mx-auto mb-2 text-gray-400" />
          <p className="text-sm text-gray-600">No invoices found</p>
        </CardContent>
      </Card>
    );
  }

  // Mobile view (cards)
  const mobileView = (
    <div className="block sm:hidden space-y-3">
      {invoices.map((invoice) => (
        <Card key={invoice.id} className="border border-gray-200">
          <CardContent className="p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <FileText className="w-4 h-4 text-blue-600" />
                  <span className="font-semibold text-sm" data-testid={`text-invoice-number-${invoice.id}`}>
                    {invoice.invoiceNumber}
                  </span>
                </div>
                <div className="text-xs text-gray-600" data-testid={`text-customer-name-${invoice.id}`}>
                  {invoice.customerName}
                </div>
              </div>
              {getStatusBadge(invoice.status)}
            </div>
            
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Amount:</span>
                <span className="font-semibold" data-testid={`text-amount-${invoice.id}`}>
                  {formatCurrency(invoice.totalAmount)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Period:</span>
                <span className="text-xs" data-testid={`text-period-${invoice.id}`}>
                  {formatDate(invoice.periodStart)} - {formatDate(invoice.periodEnd)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Created:</span>
                <span className="text-xs" data-testid={`text-created-${invoice.id}`}>
                  {formatDate(invoice.createdAt)}
                </span>
              </div>
            </div>

            {onOpenPdf && (
              <Button
                variant="outline"
                size="sm"
                className="w-full mt-3"
                onClick={() => onOpenPdf(invoice.id, invoice.invoiceNumber, invoice.customerEmail)}
                data-testid={`button-view-pdf-${invoice.id}`}
              >
                <FileText className="w-4 h-4 mr-2" />
                View Detail PDF
              </Button>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );

  // Desktop view (table)
  const desktopView = (
    <div className="hidden sm:block border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Invoice #</TableHead>
            {!customerId && <TableHead>Customer</TableHead>}
            <TableHead>Period</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
            {onOpenPdf && <TableHead className="text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((invoice) => (
            <TableRow key={invoice.id}>
              <TableCell className="font-medium" data-testid={`text-invoice-number-${invoice.id}`}>
                {invoice.invoiceNumber}
              </TableCell>
              {!customerId && (
                <TableCell data-testid={`text-customer-name-${invoice.id}`}>
                  {invoice.customerName}
                </TableCell>
              )}
              <TableCell className="text-sm" data-testid={`text-period-${invoice.id}`}>
                {formatDate(invoice.periodStart)} - {formatDate(invoice.periodEnd)}
              </TableCell>
              <TableCell className="font-semibold" data-testid={`text-amount-${invoice.id}`}>
                {formatCurrency(invoice.totalAmount)}
              </TableCell>
              <TableCell>{getStatusBadge(invoice.status)}</TableCell>
              <TableCell className="text-sm" data-testid={`text-created-${invoice.id}`}>
                {formatDate(invoice.createdAt)}
              </TableCell>
              {onOpenPdf && (
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onOpenPdf(invoice.id, invoice.invoiceNumber, invoice.customerEmail)}
                    data-testid={`button-view-pdf-${invoice.id}`}
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    View PDF
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <>
      {mobileView}
      {desktopView}
    </>
  );
}
