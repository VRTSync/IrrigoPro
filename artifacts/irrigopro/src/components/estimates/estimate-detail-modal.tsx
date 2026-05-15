import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest, authedPdfUrl } from "@/lib/queryClient";
import { CheckCircle, XCircle, FileText, Users, Calendar, DollarSign, Wrench, Edit2, Mail, MapPin, ExternalLink, Send, Eye, Download } from "lucide-react";
import { buildMapsUrl } from "@/lib/maps-url";
import type { Estimate } from "@workspace/db/schema";
import { ResendConfirmDialog } from "@/components/estimates/resend-confirm-dialog";
import { useEstimateResend } from "@/hooks/use-estimate-resend";
import {
  SendEstimateDialog,
  type SendEstimatePayload,
} from "@/components/estimates/send-estimate-dialog";
import { sendEstimateEmail } from "@/lib/email";
import {
  computeLifecycleStatus,
  type LifecycleStatus,
} from "@/lib/lifecycle";
import { EstimateListStatusBadge } from "@/components/estimates/list/estimate-list-status-badge";

interface EstimateDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  estimateId: number | null;
  onEdit?: (estimateId: number) => void;
}

// Task #630 — keep this in lockstep with the server-side
// `ESTIMATE_PDF_READ_ROLES` set in routes.ts. If a role isn't in this
// list the View/Download PDF buttons don't render at all, so the user
// never sees an action that would 403 against the PDF endpoint. The
// server still enforces the gate authoritatively — this is just
// UI hygiene.
const PDF_READ_ROLES = new Set<string>([
  "super_admin",
  "company_admin",
  "billing_manager",
  "manager",
  "irrigation_manager",
]);

function readCurrentUserRole(): string | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem("user");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { role?: string };
    return typeof parsed?.role === "string" ? parsed.role : null;
  } catch {
    return null;
  }
}

export function EstimateDetailModal({ open, onOpenChange, estimateId, onEdit }: EstimateDetailModalProps) {
  const { toast } = useToast();
  const [isConverting, setIsConverting] = useState(false);
  const [showResendDialog, setShowResendDialog] = useState(false);
  const { resendEstimate, isResending } = useEstimateResend();
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [isViewingPdf, setIsViewingPdf] = useState(false);
  const [showSendDialog, setShowSendDialog] = useState(false);

  // Compute once per mount — the user's role rarely changes during a
  // session and we don't want this gate to flicker as React re-renders.
  const currentRole = readCurrentUserRole();
  const canSeeEstimatePdf = currentRole != null && PDF_READ_ROLES.has(currentRole);

  const { data: estimate, isLoading } = useQuery<any>({
    queryKey: ["/api/estimates", estimateId],
    enabled: !!estimateId && open,
  });

  // Open the PDF as a blob URL in a new tab so we can surface a loading
  // state while puppeteer renders, and so we can show a toast if the
  // server returns an error (a direct anchor would silently render an
  // error page in the new tab).
  // Task #630 — extract the server's `{ message }` when the PDF
  // endpoint returns a JSON error. Previously this only surfaced
  // "Failed (403)" style strings, which hid the real cause (typically
  // "Access denied. Estimate approval and customer delivery are
  // restricted to billing managers and administrators.") from the user.
  const extractPdfError = async (res: Response): Promise<string> => {
    try {
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const body = (await res.json()) as { message?: string };
        if (body?.message) return body.message;
      } else {
        const text = await res.text();
        if (text) return text;
      }
    } catch {
      // fall through to status-only message
    }
    return `Failed (${res.status})`;
  };

  const handleViewPdf = async () => {
    if (!estimateId || isViewingPdf) return;
    setIsViewingPdf(true);
    try {
      const url = authedPdfUrl(`/api/estimates/${estimateId}/pdf`);
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(await extractPdfError(res));
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const win = window.open(objUrl, "_blank", "noopener,noreferrer");
      if (!win) {
        toast({
          title: "Pop-up blocked",
          description: "Allow pop-ups for this site or use Download PDF instead.",
          variant: "destructive",
        });
      }
      setTimeout(() => URL.revokeObjectURL(objUrl), 60_000);
    } catch (err) {
      toast({
        title: "Couldn't open PDF",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsViewingPdf(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!estimateId || isDownloadingPdf) return;
    setIsDownloadingPdf(true);
    try {
      const url = authedPdfUrl(`/api/estimates/${estimateId}/pdf`, { download: "1" });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(await extractPdfError(res));
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      const num = estimate?.estimateNumber as string | undefined;
      a.download = num ? `estimate-${num}.pdf` : "estimate.pdf";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
    } catch (err) {
      toast({
        title: "Couldn't download PDF",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const handleConfirmResend = async () => {
    if (!estimate || !estimateId) return;
    try {
      await resendEstimate(estimateId, estimate.customerEmail ?? "");
      setShowResendDialog(false);
      queryClient.invalidateQueries({ queryKey: ["/api/estimates", estimateId] });
    } catch {
      // Error toast surfaced by hook; keep dialog open for retry.
    }
  };

  const approveEstimateMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/estimates/${estimateId}/approve`, 'PATCH');
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Estimate approved successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates", estimateId] });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
    },
    onError: (error) => {
      toast({
        title: "Error", 
        description: "Failed to approve estimate",
        variant: "destructive",
      });
    },
  });

  const sendApprovalEmailMutation = useMutation({
    mutationFn: async (payload: SendEstimatePayload) => {
      if (!estimateId) throw new Error("Missing estimate id");
      return sendEstimateEmail(estimateId, payload);
    },
    onSuccess: (_data, vars) => {
      toast({
        title: "Estimate sent",
        description: `Sent to ${vars.to}${vars.cc.length ? `, cc ${vars.cc.join(", ")}` : ""}`,
      });
      setShowSendDialog(false);
      queryClient.invalidateQueries({ queryKey: ["/api/estimates", estimateId] });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
    },
    onError: (error: any) => {
      toast({
        title: "Couldn't send estimate",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const rejectEstimateMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/estimates/${estimateId}/reject`, 'PATCH');
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Estimate rejected",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates", estimateId] });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to reject estimate", 
        variant: "destructive",
      });
    },
  });

  const convertToWorkOrderMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/estimates/${estimateId}/convert-to-work-order`, 'POST');
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Estimate converted to work order successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      onOpenChange(false);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to convert estimate to work order",
        variant: "destructive",
      });
    },
  });

  const handleConvertToWorkOrder = async () => {
    if (!estimateId) return;
    setIsConverting(true);
    try {
      await convertToWorkOrderMutation.mutateAsync();
    } finally {
      setIsConverting(false);
    }
  };

  const formatCurrency = (amount: number | string) => {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(numAmount);
  };

  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  // Task #637 — these two helpers split the raw `status` /
  // `internalStatus` enums into the user-facing "Review stage" and
  // "Customer response" axes. The headline badge is always the
  // computed `lifecycleStatus` (rendered via EstimateListStatusBadge);
  // these labels are the secondary detail row below it. Raw enum
  // values never reach the screen — unknown values fall through to
  // "—". See docs/estimate-system.md §1.
  const reviewStageLabel = (internalStatus: string | null | undefined): string => {
    switch (internalStatus) {
      case 'draft':
        return 'Draft';
      case 'pending_approval':
        return 'Awaiting review';
      case 'approved_internal':
        return 'Ready to send';
      case 'sent_to_customer':
        return 'Sent';
      default:
        return '—';
    }
  };

  const customerResponseLabel = (status: string | null | undefined): string => {
    switch (status) {
      case 'pending':
        return 'Awaiting reply';
      case 'approved':
        return 'Approved';
      case 'rejected':
        return 'Rejected';
      case 'expired':
        return 'Expired';
      case 'converted_to_work_order':
        return 'Approved (converted)';
      default:
        return '—';
    }
  };

  if (!estimateId) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-4xl max-h-[95vh] overflow-hidden p-0 flex flex-col sm:max-w-3xl md:max-w-4xl">
        <DialogHeader className="p-4 sm:p-6 border-b border-gray-200 flex-shrink-0">
          <DialogTitle className="flex items-center space-x-2 text-lg sm:text-xl">
            <FileText className="w-5 h-5" />
            <span>Estimate Details</span>
            {/* Task #637 — headline lifecycle badge in the modal
                header, matching the list rows and board columns so
                all three surfaces agree on the single status. */}
            {estimate ? (
              <span className="ml-2">
                <EstimateListStatusBadge
                  status={
                    (estimate.lifecycleStatus as LifecycleStatus | undefined) ??
                    computeLifecycleStatus({
                      status: estimate.status,
                      internalStatus: estimate.internalStatus,
                      estimateDate: estimate.estimateDate ?? null,
                    })
                  }
                />
              </span>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="p-4 sm:p-6 space-y-4">
            <div className="animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            </div>
          </div>
        ) : estimate ? (
          <>
            {/* Prominent Status Banner for Approved Estimates */}
            {estimate.status === 'approved' && (
              <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white p-4 sm:p-6 flex-shrink-0 border-b">
                <div className="flex items-center justify-center space-x-3">
                  <CheckCircle className="w-8 h-8 flex-shrink-0" />
                  <div className="text-center">
                    <h3 className="text-xl sm:text-2xl font-bold">✓ ESTIMATE APPROVED</h3>
                    <p className="text-green-100 text-sm sm:text-base mt-1">
                      Customer approved this estimate • Ready to convert to work order
                    </p>
                  </div>
                  <CheckCircle className="w-8 h-8 flex-shrink-0" />
                </div>
              </div>
            )}

            {/* Prominent Status Banner for Converted to Work Order */}
            {estimate.status === 'converted_to_work_order' && (
              <div className="bg-gradient-to-r from-purple-500 to-indigo-600 text-white p-4 sm:p-6 flex-shrink-0 border-b">
                <div className="flex items-center justify-center space-x-3">
                  <Wrench className="w-8 h-8 flex-shrink-0" />
                  <div className="text-center">
                    <h3 className="text-xl sm:text-2xl font-bold">⚡ CONVERTED TO WORK ORDER</h3>
                    <p className="text-purple-100 text-sm sm:text-base mt-1">
                      This estimate has been converted • Work order is now active
                    </p>
                  </div>
                  <Wrench className="w-8 h-8 flex-shrink-0" />
                </div>
              </div>
            )}

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              <div className="space-y-4 sm:space-y-6">
            {/* Header Information */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center space-x-2">
                    <FileText className="w-5 h-5" />
                    <span>Estimate Information</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <span className="font-medium text-gray-700">Estimate Number:</span>
                    <p className="text-lg font-semibold text-gray-900">{estimate.estimateNumber}</p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Project Name:</span>
                    <p className="text-gray-900">{estimate.projectName}</p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Status:</span>
                    {/* Task #637 — the headline badge is now the
                        computed lifecycle bucket, matching the list
                        rows and board columns so all three surfaces
                        agree. The accent line under it (Customer
                        Approved! / Work Order Active!) is kept for
                        the two terminal-success cases so the screen
                        still reads as celebratory. The two axes
                        below expose what moved last. */}
                    <div className="mt-1 flex items-center space-x-2">
                      <EstimateListStatusBadge
                        status={
                          (estimate.lifecycleStatus as LifecycleStatus | undefined) ??
                          computeLifecycleStatus({
                            status: estimate.status,
                            internalStatus: estimate.internalStatus,
                            estimateDate: estimate.estimateDate ?? null,
                          })
                        }
                      />
                      {estimate.status === 'approved' && (
                        <span className="text-green-600 text-sm font-medium">Customer Approved!</span>
                      )}
                      {estimate.status === 'converted_to_work_order' && (
                        <span className="text-purple-600 text-sm font-medium">Work Order Active!</span>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs text-gray-600">
                      <div>
                        <span className="font-medium text-gray-500">Review stage:</span>{' '}
                        <span data-testid="status-review-stage">
                          {reviewStageLabel(estimate.internalStatus)}
                        </span>
                      </div>
                      <div>
                        <span className="font-medium text-gray-500">Customer response:</span>{' '}
                        <span data-testid="status-customer-response">
                          {customerResponseLabel(estimate.status)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Created Date:</span>
                    <p className="text-gray-900">{formatDate(estimate.createdAt)}</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center space-x-2">
                    <Users className="w-5 h-5" />
                    <span>Customer Information</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <span className="font-medium text-gray-700">Customer Name:</span>
                    <p className="text-gray-900">{estimate.customerName}</p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Email:</span>
                    <p className="text-gray-900">{estimate.customerEmail}</p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Phone:</span>
                    <p className="text-gray-900">{estimate.customerPhone || 'Not provided'}</p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Address:</span>
                    <p className="text-gray-900">{estimate.customerAddress || 'Not provided'}</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Pinned Work Location (Task #348) */}
            {estimate.workLocationLat != null && estimate.workLocationLng != null && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center space-x-2">
                    <MapPin className="w-5 h-5 text-blue-600" />
                    <span>Pinned Work Location</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {estimate.workLocationAddress && (
                    <div>
                      <span className="font-medium text-gray-700">Address:</span>
                      <p className="text-gray-900">{estimate.workLocationAddress}</p>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm text-gray-600 font-mono">
                      {parseFloat(estimate.workLocationLat).toFixed(6)}, {parseFloat(estimate.workLocationLng).toFixed(6)}
                    </span>
                    {(() => {
                      const mapsUrl = buildMapsUrl({
                        lat: estimate.workLocationLat,
                        lng: estimate.workLocationLng,
                        address: estimate.workLocationAddress,
                        label:
                          estimate.workLocationAddress ||
                          estimate.customerAddress ||
                          estimate.customerName,
                      });
                      if (!mapsUrl) return null;
                      return (
                        <a
                          href={mapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 underline"
                          data-testid="link-view-on-map"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          View on map
                        </a>
                      );
                    })()}
                  </div>
                  {(estimate.controllerLetter || estimate.zoneNumber) && (
                    <div>
                      <span className="font-medium text-gray-700">Controller / Zone:</span>
                      <p className="text-gray-900">
                        {estimate.controllerLetter ? `Controller ${estimate.controllerLetter}` : ''}
                        {estimate.controllerLetter && estimate.zoneNumber ? ' · ' : ''}
                        {estimate.zoneNumber ? `Zone ${estimate.zoneNumber}` : ''}
                      </p>
                    </div>
                  )}
                  <div className="rounded-lg overflow-hidden border border-gray-200">
                    <iframe
                      title="Pinned work location"
                      width="100%"
                      height="220"
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                      src={`https://www.openstreetmap.org/export/embed.html?bbox=${parseFloat(estimate.workLocationLng) - 0.003}%2C${parseFloat(estimate.workLocationLat) - 0.002}%2C${parseFloat(estimate.workLocationLng) + 0.003}%2C${parseFloat(estimate.workLocationLat) + 0.002}&layer=mapnik&marker=${estimate.workLocationLat}%2C${estimate.workLocationLng}`}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Scope of Work (Task #603) — display the saved scope so
                managers/admins can read it without exporting the PDF. */}
            {estimate.workDescription && estimate.workDescription.trim() && (
              <Card data-testid="estimate-detail-scope-of-work">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Scope of Work</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-gray-900 whitespace-pre-wrap">
                    {estimate.workDescription}
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Project Details */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Project Details</CardTitle>
              </CardHeader>
              <CardContent>
                {estimate.projectDescription && (
                  <div className="mb-4">
                    <span className="font-medium text-gray-700">Description:</span>
                    <p className="text-gray-900 mt-1">{estimate.projectDescription}</p>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <div className="flex items-center space-x-2">
                      <DollarSign className="w-5 h-5 text-blue-600" />
                      <span className="font-medium text-blue-900">Total Amount</span>
                    </div>
                    <p className="text-2xl font-bold text-blue-900 mt-1">
                      {formatCurrency(estimate.totalAmount)}
                    </p>
                  </div>
                  <div className="bg-green-50 p-4 rounded-lg">
                    <div className="flex items-center space-x-2">
                      <Wrench className="w-5 h-5 text-green-600" />
                      <span className="font-medium text-green-900">Labor Hours</span>
                    </div>
                    <p className="text-2xl font-bold text-green-900 mt-1">
                      {estimate.totalLaborHours || 0}h
                    </p>
                  </div>
                  <div className="bg-purple-50 p-4 rounded-lg">
                    <div className="flex items-center space-x-2">
                      <Calendar className="w-5 h-5 text-purple-600" />
                      <span className="font-medium text-purple-900">Line Items</span>
                    </div>
                    <p className="text-2xl font-bold text-purple-900 mt-1">
                      {estimate.items?.length || 0}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Line Items */}
            {estimate.items && estimate.items.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Line Items</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-gray-700">
                          <th className="py-2 pr-2">Part</th>
                          <th className="py-2 pr-2 text-right">Qty</th>
                          <th className="py-2 pr-2 text-right">Unit $</th>
                          <th className="py-2 pr-2 text-right">Labor h</th>
                          <th className="py-2 pr-2 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {estimate.items.map((item: any) => (
                          <tr key={item.id} className="border-b last:border-b-0 align-top">
                            <td className="py-2 pr-2">
                              <div className="font-medium text-gray-900">{item.partName}</div>
                              {item.description && (
                                <div className="text-xs text-gray-600 mt-0.5">{item.description}</div>
                              )}
                            </td>
                            <td className="py-2 pr-2 text-right">{item.quantity}</td>
                            <td className="py-2 pr-2 text-right">{formatCurrency(item.partPrice)}</td>
                            <td className="py-2 pr-2 text-right">{item.laborHours}</td>
                            <td className="py-2 pr-2 text-right font-semibold">{formatCurrency(item.totalPrice)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
              </div>
            </div>

            {/* Fixed Footer with Actions — Task #630.
                Wraps cleanly on small viewports (375px phone, 768px
                tablet, 1024×600 laptop). Secondary actions (Close,
                View, Download, Resend, Edit) live in a wrap-capable
                group on the left; primary actions (Email, Approve,
                Reject, Convert to Work Order) stay anchored to the
                right and also wrap if necessary. The footer itself
                is flex-shrink-0 so the scrollable body above it
                takes the overflow instead of pushing the footer off
                screen. */}
            <div
              className="flex-shrink-0 p-4 sm:p-6 border-t border-gray-200 bg-gray-50"
              data-testid="detail-modal-footer"
            >
              <div className="flex flex-col-reverse sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3">
                <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-3">
                  <Button
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                    className="w-full sm:w-auto"
                    data-testid="detail-modal-close"
                  >
                    Close
                  </Button>
                  {canSeeEstimatePdf && (
                    <>
                      <Button
                        variant="outline"
                        onClick={handleViewPdf}
                        disabled={isViewingPdf}
                        className="w-full sm:w-auto"
                        data-testid="detail-modal-view-pdf"
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        {isViewingPdf ? "Opening..." : "View PDF"}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleDownloadPdf}
                        disabled={isDownloadingPdf}
                        className="w-full sm:w-auto"
                        data-testid="detail-modal-download-pdf"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        {isDownloadingPdf ? "Preparing..." : "Download PDF"}
                      </Button>
                    </>
                  )}
                  {estimate.lifecycleStatus === 'expired' && (
                    <Button
                      onClick={() => setShowResendDialog(true)}
                      variant="outline"
                      className="border-orange-200 text-orange-700 hover:bg-orange-50 w-full sm:w-auto"
                      data-testid="detail-modal-resend"
                    >
                      <Send className="w-4 h-4 mr-2" />
                      Resend
                    </Button>
                  )}
                  {estimate.status !== 'converted_to_work_order' && onEdit && (
                    <Button
                      onClick={() => {
                        onEdit(estimateId!);
                        onOpenChange(false);
                      }}
                      variant="outline"
                      className="border-blue-200 text-blue-600 hover:bg-blue-50 w-full sm:w-auto"
                      data-testid="detail-modal-edit"
                    >
                      <Edit2 className="w-4 h-4 mr-2" />
                      {estimate.lifecycleStatus === 'draft' || estimate.internalStatus === 'draft'
                        ? 'Continue editing'
                        : 'Edit Estimate'}
                    </Button>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-3 sm:justify-end">
                  {/* Approval Actions for Pending Estimates */}
                  {estimate.status === 'pending' && (
                    <>
                      <Button
                        onClick={() => setShowSendDialog(true)}
                        disabled={sendApprovalEmailMutation?.isPending}
                        className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto"
                        data-testid="detail-modal-send-email"
                      >
                        <Mail className="w-4 h-4 mr-2" />
                        {sendApprovalEmailMutation?.isPending ? 'Sending...' : 'Email Customer'}
                      </Button>
                      <Button
                        onClick={() => approveEstimateMutation.mutate()}
                        disabled={approveEstimateMutation.isPending}
                        className="bg-green-600 hover:bg-green-700 w-full sm:w-auto"
                        data-testid="detail-modal-approve"
                      >
                        <CheckCircle className="w-4 h-4 mr-2" />
                        {approveEstimateMutation.isPending ? 'Approving...' : 'Approve'}
                      </Button>
                      <Button
                        onClick={() => rejectEstimateMutation.mutate()}
                        disabled={rejectEstimateMutation.isPending}
                        variant="destructive"
                        className="w-full sm:w-auto"
                        data-testid="detail-modal-reject"
                      >
                        <XCircle className="w-4 h-4 mr-2" />
                        {rejectEstimateMutation.isPending ? 'Rejecting...' : 'Reject'}
                      </Button>
                    </>
                  )}

                  {/* Convert to Work Order for Approved Estimates */}
                  {estimate.status === 'approved' && (
                    <Button
                      onClick={handleConvertToWorkOrder}
                      disabled={isConverting}
                      className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto"
                      data-testid="detail-modal-convert"
                    >
                      <Wrench className="w-4 h-4 mr-2" />
                      {isConverting ? 'Converting...' : 'Convert to Work Order'}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-8">
            <p className="text-gray-500">Estimate not found</p>
          </div>
        )}
      </DialogContent>
      <ResendConfirmDialog
        estimate={estimate ?? null}
        open={showResendDialog}
        onOpenChange={setShowResendDialog}
        onConfirm={handleConfirmResend}
        isResending={isResending}
      />
      <SendEstimateDialog
        open={showSendDialog}
        onOpenChange={setShowSendDialog}
        estimateNumber={estimate?.estimateNumber ?? null}
        customerName={estimate?.customerName ?? null}
        customerEmail={estimate?.customerEmail ?? null}
        isSending={sendApprovalEmailMutation.isPending}
        onSend={(payload) => sendApprovalEmailMutation.mutate(payload)}
      />
    </Dialog>
  );
}