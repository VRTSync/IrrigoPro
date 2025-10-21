import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FileText, Download, Mail, Loader2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface InvoicePdfPreviewModalProps {
  invoiceId: number;
  invoiceNumber: string;
  customerEmail: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface InvoicePdf {
  id: number;
  invoiceId: number;
  customerId: number;
  companyId: number;
  pdfUrl: string;
  filename: string;
  status: string;
  createdAt: string;
  sentAt?: string;
}

export function InvoicePdfPreviewModal({
  invoiceId,
  invoiceNumber,
  customerEmail,
  open,
  onOpenChange,
}: InvoicePdfPreviewModalProps) {
  const { toast } = useToast();
  const [showEmailConfirm, setShowEmailConfirm] = useState(false);

  // Fetch PDF details
  const { data: pdf, isLoading, error } = useQuery<InvoicePdf>({
    queryKey: ["/api/invoices", invoiceId, "pdf"],
    enabled: open,
  });

  // Build PDF URL with auth headers as query params for better compatibility
  const getPdfUrl = () => {
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    const params = new URLSearchParams({
      'user-id': user.id?.toString() || '',
      'user-role': user.role || '',
      'user-company-id': user.companyId?.toString() || '',
    });
    return `/api/invoices/${invoiceId}/pdf/download?${params.toString()}`;
  };

  // Send email mutation
  const sendEmailMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/invoices/${invoiceId}/pdf/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to send email");
      }
      
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Email Sent",
        description: `Invoice detail PDF has been sent to ${customerEmail}`,
      });
      setShowEmailConfirm(false);
      queryClient.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "pdf"] });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Send Email",
        description: error.message || "An error occurred while sending the email",
        variant: "destructive",
      });
    },
  });

  const handleViewPdf = () => {
    // Open PDF in new tab
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    const params = new URLSearchParams({
      'x-user-id': user.id?.toString() || '',
      'x-user-role': user.role || '',
      'x-user-company-id': user.companyId?.toString() || '',
    });
    
    window.open(`/api/invoices/${invoiceId}/pdf/download?${params.toString()}`, '_blank');
  };

  const handleDownload = () => {
    if (!pdf) return;
    
    // Trigger download using a temporary link
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    const params = new URLSearchParams({
      'x-user-id': user.id?.toString() || '',
      'x-user-role': user.role || '',
      'x-user-company-id': user.companyId?.toString() || '',
    });
    
    const link = document.createElement("a");
    link.href = `/api/invoices/${invoiceId}/pdf/download?${params.toString()}`;
    link.download = pdf.filename;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSendEmail = () => {
    setShowEmailConfirm(true);
  };

  const confirmSendEmail = () => {
    sendEmailMutation.mutate();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="bg-blue-50 p-2 rounded-lg">
                <FileText className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <DialogTitle className="text-xl font-semibold">
                  Invoice Detail Report
                </DialogTitle>
                <p className="text-sm text-gray-600 font-normal mt-1">
                  {invoiceNumber} - Work Order Breakdown
                </p>
              </div>
            </div>
          </DialogHeader>

          <div className="py-6">
            {isLoading && (
              <div className="flex items-center justify-center">
                <div className="text-center">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-blue-600" />
                  <p className="text-sm text-gray-600">Loading PDF details...</p>
                </div>
              </div>
            )}

            {error && (
              <div className="text-center max-w-md mx-auto">
                <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-600" />
                <h3 className="text-lg font-semibold mb-2">PDF Not Available</h3>
                <p className="text-sm text-gray-600 mb-4">
                  The PDF for this invoice hasn't been generated yet or there was an error loading it.
                </p>
                <p className="text-xs text-gray-500">
                  PDFs are automatically generated when invoices are created. If this invoice was just created, please wait a moment and try again.
                </p>
              </div>
            )}

            {pdf && !isLoading && !error && (
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <FileText className="w-5 h-5 text-blue-600 mt-0.5" />
                    <div className="flex-1">
                      <h4 className="font-medium text-gray-900 mb-1">PDF Ready</h4>
                      <p className="text-sm text-gray-600 mb-3">
                        Invoice detail report with complete work order breakdown, parts, labor, and costs.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={handleViewPdf}
                          size="sm"
                          data-testid="button-view-pdf"
                        >
                          <FileText className="w-4 h-4 mr-2" />
                          View PDF
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleDownload}
                          data-testid="button-download-pdf"
                        >
                          <Download className="w-4 h-4 mr-2" />
                          Download
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleSendEmail}
                          disabled={sendEmailMutation.isPending}
                          data-testid="button-send-pdf-email"
                        >
                          {sendEmailMutation.isPending ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <Mail className="w-4 h-4 mr-2" />
                          )}
                          Send to Customer
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                {pdf.sentAt && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <p className="text-sm text-gray-700">
                      <Mail className="w-4 h-4 inline mr-2 text-gray-500" />
                      Last sent on {new Date(pdf.sentAt).toLocaleString()}
                    </p>
                  </div>
                )}

                <div className="text-xs text-gray-500">
                  <p className="font-medium mb-1">Filename: {pdf.filename}</p>
                  <p>This PDF contains detailed work order information for invoice {invoiceNumber}.</p>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Email Confirmation Dialog */}
      <AlertDialog open={showEmailConfirm} onOpenChange={setShowEmailConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send Invoice Detail PDF?</AlertDialogTitle>
            <AlertDialogDescription>
              This will send the detailed work order breakdown for invoice <strong>{invoiceNumber}</strong> to:
              <br />
              <strong className="text-blue-600">{customerEmail}</strong>
              <br /><br />
              The customer will receive an email with the PDF attached showing all work orders, billing sheets, parts used, labor hours, and costs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-send">Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmSendEmail}
              disabled={sendEmailMutation.isPending}
              data-testid="button-confirm-send"
            >
              {sendEmailMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Mail className="w-4 h-4 mr-2" />
                  Send Email
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
