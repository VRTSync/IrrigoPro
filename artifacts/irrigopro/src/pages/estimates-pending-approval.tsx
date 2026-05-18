import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest, queryClient, useArrayQuery } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle, ClipboardList, Eye, Mail, ShieldCheck } from "lucide-react";
import { EstimateDetailModal } from "@/components/estimates/estimate-detail-modal";
import { EstimateWizard } from "@/components/estimates/estimate-wizard";
import {
  SendEstimateDialog,
  type SendEstimatePayload,
} from "@/components/estimates/send-estimate-dialog";
import { sendEstimateEmail } from "@/lib/email";
import type { Estimate } from "@workspace/db/schema";
import { isReadyToSend } from "@/lib/lifecycle";

function formatCurrency(amount: string | number) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number.isFinite(n) ? n : 0,
  );
}

function formatDate(d: string | Date) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function EstimatesPendingApproval() {
  const { toast } = useToast();
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editEstimateId, setEditEstimateId] = useState<number | null>(null);
  const [showEstimateWizard, setShowEstimateWizard] = useState(false);
  const [sendDialogEstimate, setSendDialogEstimate] = useState<Estimate | null>(null);

  const { data: pending = [], isLoading } = useArrayQuery<Estimate>({
    queryKey: ["/api/estimates/pending-approval"],
    refetchInterval: 60000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/estimates/pending-approval"] });
    queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
  };

  const handleEditEstimate = (id: number) => {
    setEditEstimateId(id);
    setShowEstimateWizard(true);
  };

  const internalApprove = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/estimates/${id}/internal-approve`, "PATCH", {}),
    onSuccess: () => {
      toast({ title: "Estimate approved", description: "Marked as ready to send to the customer." });
      invalidate();
    },
    onError: (err: any) =>
      toast({
        title: "Failed to approve",
        description: err?.message || "Please try again.",
        variant: "destructive",
      }),
  });

  const sendToCustomer = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: SendEstimatePayload }) =>
      sendEstimateEmail(id, payload),
    onSuccess: (_data, vars) => {
      toast({
        title: "Sent to customer",
        description: `Approval email sent to ${vars.payload.to}${
          vars.payload.cc.length ? `, cc ${vars.payload.cc.join(", ")}` : ""
        }`,
      });
      setSendDialogEstimate(null);
      invalidate();
    },
    onError: (err: any) =>
      toast({
        title: "Failed to send",
        description: err?.message || "Please try again.",
        variant: "destructive",
      }),
  });

  const reject = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/estimates/${id}/reject`, "PATCH", {}),
    onSuccess: () => {
      toast({ title: "Estimate rejected" });
      invalidate();
    },
    onError: (err: any) =>
      toast({
        title: "Failed to reject",
        description: err?.message || "Please try again.",
        variant: "destructive",
      }),
  });

  const total = pending.length;

  return (
    <div className="space-y-6 p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-orange-100 rounded-xl">
          <ShieldCheck className="w-5 h-5 text-orange-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Estimates Pending Approval</h1>
          <p className="text-sm text-gray-500">
            Review estimates created by managers before they go out to customers.
          </p>
        </div>
        {total > 0 && (
          <Badge variant="destructive" className="ml-auto text-sm px-2.5 py-1">
            {total} pending
          </Badge>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-blue-600" />
            <CardTitle className="text-base">Review stage: Awaiting review</CardTitle>
            {pending.length > 0 && (
              <Badge variant="secondary" className="ml-auto">
                {pending.length}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : pending.length === 0 ? (
            <div className="text-center py-10 border-2 border-dashed border-gray-200 rounded-xl">
              <CheckCircle className="w-8 h-8 text-green-400 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No estimates waiting for review.</p>
            </div>
          ) : (
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-left">
                    <th className="px-4 py-2.5 font-medium text-gray-600">Estimate</th>
                    <th className="px-4 py-2.5 font-medium text-gray-600">Customer</th>
                    <th className="px-4 py-2.5 font-medium text-gray-600">Project</th>
                    <th className="px-4 py-2.5 font-medium text-gray-600">Total</th>
                    <th className="px-4 py-2.5 font-medium text-gray-600">Submitted</th>
                    <th className="px-4 py-2.5 font-medium text-gray-600 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {pending.map((est) => {
                    return (
                    <tr
                      key={est.id}
                      className="odd:bg-white even:bg-gray-50/60 hover:bg-blue-50/40 transition-colors"
                    >
                      <td className="px-4 py-4">
                        <div className="font-medium text-gray-900">{est.estimateNumber}</div>
                        <div className="text-xs text-gray-500">by {est.createdBy}</div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="text-gray-900">{est.customerName}</div>
                        <div className="text-xs text-gray-500">{est.customerEmail}</div>
                      </td>
                      <td className="px-4 py-4 text-gray-700">{est.projectName}</td>
                      <td className="px-4 py-4 font-medium text-gray-900">
                        {formatCurrency(est.totalAmount)}
                      </td>
                      <td className="px-4 py-4 text-gray-600">{formatDate(est.createdAt)}</td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-1.5 justify-end flex-wrap">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setDetailId(est.id);
                              setDetailOpen(true);
                            }}
                          >
                            <Eye className="w-3.5 h-3.5 mr-1" />
                            View
                          </Button>
                          {isReadyToSend(est) ? (
                            <Badge className="bg-green-100 text-green-800 border-green-200">
                              Ready to send
                            </Badge>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-blue-700 border-blue-300 hover:bg-blue-50"
                              disabled={internalApprove.isPending}
                              onClick={() => internalApprove.mutate(est.id)}
                            >
                              <CheckCircle className="w-3.5 h-3.5 mr-1" />
                              Approve
                            </Button>
                          )}
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700 text-white"
                            disabled={sendToCustomer.isPending}
                            onClick={() => setSendDialogEstimate(est)}
                            data-testid={`pending-approval-send-${est.id}`}
                          >
                            <Mail className="w-3.5 h-3.5 mr-1" />
                            Send
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-600 border-red-200 hover:bg-red-50"
                            disabled={reject.isPending}
                            onClick={() => reject.mutate(est.id)}
                          >
                            Reject
                          </Button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-gray-500">
        Looking for the full pipeline? Open the{" "}
        <Link href="/estimates" className="underline">estimates page</Link>.
      </p>

      <EstimateDetailModal
        open={detailOpen}
        onOpenChange={setDetailOpen}
        estimateId={detailId}
        onEdit={(estimateId) => {
          setDetailOpen(false);
          handleEditEstimate(estimateId);
        }}
      />

      <EstimateWizard
        open={showEstimateWizard}
        onOpenChange={(open) => {
          setShowEstimateWizard(open);
          if (!open) {
            setEditEstimateId(null);
            invalidate();
          }
        }}
        estimateId={editEstimateId}
      />

      <SendEstimateDialog
        open={sendDialogEstimate !== null}
        onOpenChange={(open) => {
          if (!open) setSendDialogEstimate(null);
        }}
        estimateNumber={sendDialogEstimate?.estimateNumber ?? null}
        customerName={sendDialogEstimate?.customerName ?? null}
        customerEmail={sendDialogEstimate?.customerEmail ?? null}
        isSending={sendToCustomer.isPending}
        onSend={(payload) => {
          if (!sendDialogEstimate) return;
          sendToCustomer.mutate({ id: sendDialogEstimate.id, payload });
        }}
      />
    </div>
  );
}
