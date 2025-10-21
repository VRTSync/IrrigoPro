import { useState, useEffect } from "react";
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
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // Fetch PDF details
  const { data: pdf, isLoading, error } = useQuery<InvoicePdf>({
    queryKey: ["/api/invoices", invoiceId, "pdf"],
    enabled: open,
  });

  // Fetch PDF as blob when PDF metadata is available
  useEffect(() => {
    if (!pdf || !open) {
      return;
    }

    const fetchPdfBlob = async () => {
      setPdfLoading(true);
      setPdfError(null);
      
      try {
        const response = await fetch(`/api/invoices/${invoiceId}/pdf/download`, {
          credentials: 'include',
        });
        
        if (!response.ok) {
          throw new Error('Failed to load PDF');
        }
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        setPdfBlobUrl(url);
      } catch (err) {
        console.error('Error fetching PDF blob:', err);
        setPdfError(err instanceof Error ? err.message : 'Failed to load PDF');
      } finally {
        setPdfLoading(false);
      }
    };

    fetchPdfBlob();
  }, [pdf, open, invoiceId]);

  // Cleanup blob URL when modal closes
  useEffect(() => {
    return () => {
      if (pdfBlobUrl) {
        URL.revokeObjectURL(pdfBlobUrl);
      }
    };
  }, [pdfBlobUrl]);

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

  const handleDownload = () => {
    if (!pdf || !pdfBlobUrl) return;
    
    // Create a download link using the blob URL
    const link = document.createElement("a");
    link.href = pdfBlobUrl;
    link.download = pdf.filename;
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
        <DialogContent className="w-[95vw] max-w-6xl h-[95vh] max-h-[95vh] overflow-hidden p-0 flex flex-col">
          <DialogHeader className="p-4 sm:p-6 border-b border-gray-200 flex-shrink-0">
            <div className="flex items-start justify-between">
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
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownload}
                  disabled={!pdf || !pdfBlobUrl || pdfLoading}
                  data-testid="button-download-pdf"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </Button>
                <Button
                  size="sm"
                  onClick={handleSendEmail}
                  disabled={!pdf || !pdfBlobUrl || pdfLoading || sendEmailMutation.isPending}
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
          </DialogHeader>

          <div className="flex-1 overflow-hidden bg-gray-100">
            {(isLoading || pdfLoading) && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-blue-600" />
                  <p className="text-sm text-gray-600">
                    {isLoading ? 'Loading PDF details...' : 'Loading PDF document...'}
                  </p>
                </div>
              </div>
            )}

            {(error || pdfError) && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center max-w-md p-6">
                  <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-600" />
                  <h3 className="text-lg font-semibold mb-2">PDF Not Available</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    {pdfError || 'The PDF for this invoice hasn\'t been generated yet or there was an error loading it.'}
                  </p>
                  <p className="text-xs text-gray-500">
                    PDFs are automatically generated when invoices are created. If this invoice was just created, please wait a moment and try again.
                  </p>
                </div>
              </div>
            )}

            {pdf && pdfBlobUrl && !pdfLoading && !pdfError && (
              <iframe
                src={pdfBlobUrl}
                className="w-full h-full border-0"
                title="Invoice Detail PDF"
                data-testid="iframe-pdf-preview"
              />
            )}
          </div>

          {pdf?.sentAt && (
            <div className="p-3 bg-blue-50 border-t border-blue-100 flex-shrink-0">
              <p className="text-sm text-blue-800">
                <Mail className="w-4 h-4 inline mr-2" />
                Last sent to customer on {new Date(pdf.sentAt).toLocaleString()}
              </p>
            </div>
          )}
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
