import { safeGet } from "@/utils/safeStorage";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileText, Download, Mail, Loader2, AlertCircle } from "lucide-react";
import { ReviewAndSendDialog } from "@/components/email/review-and-send-dialog";
import { openAuthedPdf } from "@/lib/open-authed-pdf";
import { InvoiceReminderPanel } from "./invoice-reminder-panel";
import { InvoiceArNotesPanel } from "./invoice-ar-notes-panel";
import { PdfValidationErrorPanel, type PdfErrorDetail } from "./pdf-validation-error";
import { hasCapability, CAN_READ_AR_NOTES, CAN_SEND_INVOICE_EMAIL } from "@workspace/shared";

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

// The default query/apiRequest layer throws `new Error("<status>: <body>")`.
// Parse that back into a structured detail so a 422 reconciliation failure
// surfaces the specific drift instead of the generic "PDF Not Available".
function parsePdfFetchError(err: unknown): PdfErrorDetail | null {
  if (!err) return null;
  const raw = err instanceof Error ? err.message : String(err);
  const match = raw.match(/^(\d+):\s*([\s\S]*)$/);
  if (match) {
    const [, status, body] = match;
    try {
      const parsed = JSON.parse(body);
      return {
        message: parsed.message || `Request failed (${status})`,
        validationFailure: parsed.validationFailure,
      };
    } catch {
      return { message: body || `Request failed (${status})` };
    }
  }
  return { message: raw };
}

export function InvoicePdfPreviewModal({
  invoiceId,
  invoiceNumber,
  open,
  onOpenChange,
  onExportCsv,
  isExportingCsv,
}: InvoicePdfPreviewModalProps) {
  const queryClient = useQueryClient();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pdfError, setPdfError] = useState<PdfErrorDetail | null>(null);
  const [isViewingPdf, setIsViewingPdf] = useState(false);

  // Fetch PDF details
  const { data: pdf, isLoading, error } = useQuery<InvoicePdf>({
    queryKey: ["/api/invoices", invoiceId, "pdf"],
    enabled: open,
  });

  // A 422 from the fetch route carries the reconciliation drift details —
  // surface them instead of the generic "PDF Not Available" message.
  const queryError = parsePdfFetchError(error);

  // Task #1889 — the signed-in role, read the same way the rest of this file
  // reads it. Used only to decide whether the internal A/R note panel renders.
  const currentUserRole: string | null = (() => {
    try {
      const u = JSON.parse(safeGet("user") || "{}");
      return typeof u?.role === "string" ? u.role : null;
    } catch {
      return null;
    }
  })();
  const canSend = hasCapability(currentUserRole, CAN_SEND_INVOICE_EMAIL);

  const getAuthParams = () => {
    const user = JSON.parse(safeGet("user") || "{}");
    return new URLSearchParams({
      'x-user-id': user.id?.toString() || '',
      'x-user-role': user.role || '',
      'x-user-company-id': user.companyId?.toString() || '',
    });
  };

  const handleViewPdf = async () => {
    setPdfError(null);
    setIsViewingPdf(true);
    try {
      const result = await openAuthedPdf(`/api/invoices/${invoiceId}/pdf/download`);
      if (!result.ok) setPdfError(result);
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

  return (
    <>
      <Dialog open={open} onOpenChange={next => { if (!reviewOpen) onOpenChange(next); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
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
              queryError?.validationFailure ? (
                <PdfValidationErrorPanel detail={queryError} />
              ) : (
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
              )
            )}

            {pdfError && <PdfValidationErrorPanel detail={pdfError} />}

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
                        {canSend && <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setReviewOpen(true)}
                          data-testid="button-send-pdf-email"
                        >
                          <Mail className="w-4 h-4 mr-2" />
                          Send to Customer
                        </Button>}
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

            {/* Task #1887 — reminders live outside the `pdf &&` block on
                purpose: the missing-PDF case is exactly the one that has to
                explain itself rather than disappear. */}
            <div className="mt-6">
              <InvoiceReminderPanel
                invoiceId={invoiceId}
                invoiceNumber={invoiceNumber}
                open={open}
                onSendInvoice={canSend ? () => setReviewOpen(true) : undefined}
              />
            </div>

            {/* Task #1889 — the internal note thread, deliberately adjacent to
                the reminder history: together they are what we said to the
                customer and what the customer said back.

                CAN_READ_AR_NOTES is NARROWER than invoice read — an irrigation
                manager gets this far and must not see the panel. This check is
                a courtesy to avoid rendering a panel whose every request would
                403; the enforcement is the server's, on both endpoints. */}
            {hasCapability(currentUserRole, CAN_READ_AR_NOTES) && (
              <div className="mt-6">
                <InvoiceArNotesPanel
                  invoiceId={invoiceId}
                  invoiceNumber={invoiceNumber}
                  open={open}
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ReviewAndSendDialog
        open={open && reviewOpen}
        onOpenChange={setReviewOpen}
        kind="invoice"
        entityId={invoiceId}
        title={`Send invoice ${invoiceNumber}`}
        onSent={() => {
          // Match the list, PDF metadata, and reminder history under this prefix.
          void queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
          void queryClient.invalidateQueries({ queryKey: ["/api/invoices/reminder-eligibility"] });
        }}
      />
    </>
  );
}
