import { safeGet } from "@/utils/safeStorage";
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
  onExportCsv?: () => void | Promise<void>;
  isExportingCsv?: boolean;
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

interface RowValidationError {
  recordType: string;
  recordId: number;
  partsSubtotal: number;
  laborSubtotal: number;
  computedTotal: number;
  storedTotal: number;
  delta: number;
  reason: string;
}

interface ValidationFailure {
  validationFailed: boolean;
  rowErrors: RowValidationError[];
  totalsError?: {
    invoiceId: number;
    computedGrandTotal: number;
    storedTotal: number;
    delta: number;
  };
}

export function InvoicePdfPreviewModal({
  invoiceId,
  invoiceNumber,
  customerEmail,
  open,
  onOpenChange,
  onExportCsv,
  isExportingCsv,
}: InvoicePdfPreviewModalProps) {
  const { toast } = useToast();
  const [showEmailConfirm, setShowEmailConfirm] = useState(false);
  const [pdfError, setPdfError] = useState<{ message: string; validationFailure?: ValidationFailure } | null>(null);
  const [isViewingPdf, setIsViewingPdf] = useState(false);

  // Fetch PDF details
  const { data: pdf, isLoading, error } = useQuery<InvoicePdf>({
    queryKey: ["/api/invoices", invoiceId, "pdf"],
    enabled: open,
  });

  const getAuthParams = () => {
    const user = JSON.parse(safeGet("user") || "{}");
    return new URLSearchParams({
      'x-user-id': user.id?.toString() || '',
      'x-user-role': user.role || '',
      'x-user-company-id': user.companyId?.toString() || '',
    });
  };

  // Send email mutation
  const sendEmailMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/invoices/${invoiceId}/pdf/send`, 'POST');
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

  const handleViewPdf = async () => {
    setPdfError(null);
    setIsViewingPdf(true);
    // Open a blank tab synchronously (within the user gesture) to avoid popup blockers
    const newTab = window.open("", "_blank");
    try {
      const params = getAuthParams();
      const url = `/api/invoices/${invoiceId}/pdf/download?${params.toString()}`;
      const response = await fetch(url);

      const contentType = response.headers.get("content-type") || "";

      if (response.ok && contentType.includes("application/pdf")) {
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        if (newTab) {
          newTab.location.href = objectUrl;
          // Revoke the object URL after a short delay to free memory
          setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
        } else {
          // Fallback if popup was blocked
          const link = document.createElement("a");
          link.href = objectUrl;
          link.target = "_blank";
          link.click();
          setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
        }
      } else {
        if (newTab) newTab.close();
        const data = await response.json().catch(() => ({ message: "Unknown error generating PDF" }));
        setPdfError({
          message: data.message || "Failed to generate PDF",
          validationFailure: data.validationFailure,
        });
      }
    } catch (err) {
      if (newTab) newTab.close();
      setPdfError({ message: "A network error occurred while loading the PDF. Please try again." });
    } finally {
      setIsViewingPdf(false);
    }
  };

  const handleDownload = () => {
    if (!pdf) return;
    
    const params = getAuthParams();
    
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
            {onExportCsv && (
              <div className="flex justify-end mb-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onExportCsv()}
                  disabled={!!isExportingCsv}
                  data-testid="button-export-invoice-csv-modal"
                >
                  {isExportingCsv ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4 mr-2" />
                  )}
                  Export CSV
                </Button>
              </div>
            )}

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

            {pdfError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <h4 className="font-medium text-red-900 mb-1">PDF Cannot Be Generated</h4>
                    <p className="text-sm text-red-700 mb-2">{pdfError.message}</p>
                    {pdfError.validationFailure && pdfError.validationFailure.rowErrors.length > 0 && (
                      <div className="mt-2">
                        <p className="text-sm font-medium text-red-800 mb-1">Data integrity issues found:</p>
                        <ul className="text-sm text-red-700 space-y-1 list-disc list-inside">
                          {pdfError.validationFailure.rowErrors.map((err, i) => (
                            <li key={i}>
                              {err.recordType === 'work_order' ? 'Work Order' : 'Billing Sheet'} #{err.recordId}: {err.reason}
                            </li>
                          ))}
                        </ul>
                        <p className="text-xs text-red-600 mt-2">
                          Please contact support to repair these records before generating the PDF.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
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
                          disabled={isViewingPdf}
                          data-testid="button-view-pdf"
                        >
                          {isViewingPdf ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <FileText className="w-4 h-4 mr-2" />
                          )}
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
