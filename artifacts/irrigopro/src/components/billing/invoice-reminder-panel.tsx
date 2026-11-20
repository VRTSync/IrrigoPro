// Task #1887 — payment reminders on the invoice detail.
//
// Two jobs, in this order of importance:
//
//   1. Let staff review the reminder and see the server's reason if it
//      cannot be sent, including an action when the invoice needs attention.
//   2. Show the reminder history as it was, not as the invoice is now. Every
//      value in the table below comes off the recorded row — the balance and
//      the address are the ones the customer actually saw.
//
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Clock, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReviewAndSendDialog } from "@/components/email/review-and-send-dialog";
import { INVOICE_EXPANSION_GC_MS, INVOICE_EXPANSION_STALE_MS } from "@/lib/queryClient";

interface ReminderRow {
  id: number;
  sentAt: string;
  sentByUserId: number | null;
  sentByName: string | null;
  recipientEmail: string;
  sequenceNumber: number | null;
  templateKey: string;
  templateLabel: string;
  balanceAtSend: string;
  daysOverdueAtSend: number;
  deliveryStatus: string;
  deliveryError: string | null;
}

interface ReminderState {
  reminders: ReminderRow[];
  refusal: {
    reason: string;
    message: string;
    action?: { kind: string; label: string };
  } | null;
  throttle: {
    windowDays: number;
    lastSentAt: string | null;
    nextAllowedAt: string | null;
    throttled: boolean;
    message: string | null;
  };
  balanceDue: string;
  daysOverdue: number;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function InvoiceReminderPanel({
  invoiceId,
  invoiceNumber,
  open,
  historyOnly = false,
  onSendInvoice,
}: {
  invoiceId: number;
  invoiceNumber: string;
  open: boolean;
  /**
   * Task #1918 — history-only mode, for the expanded row on the invoices list.
   *
   * Sending stays in the row menu and the batch flow, so there is one send
   * affordance rather than three. Everything that exists to support a send —
   * the tone select, the button, the confirmation, the refusal copy, the
   * throttle notice — is therefore absent here, along with the current-state
   * line: a history section that reconciles a recorded balance against today's
   * balance invites exactly the misreading the recorded values prevent.
   *
   * What remains is the recorded rows, rendered as stored.
   */
  historyOnly?: boolean;
  onSendInvoice?: () => void;
}) {
  const queryClient = useQueryClient();
  const [reviewOpen, setReviewOpen] = useState(false);
  const refreshHistory = () => queryClient.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "reminders"] });

  const { data, isLoading } = useQuery<ReminderState>({
    queryKey: ["/api/invoices", invoiceId, "reminders"],
    enabled: open,
    // Task #1922 — reopening a row within the window renders from cache and
    // issues no request. Review and Send invalidates this key on success and
    // on error, since a failed delivery attempt is still part of the history.
    staleTime: INVOICE_EXPANSION_STALE_MS,
    gcTime: INVOICE_EXPANSION_GC_MS,
  });

  if (!open) return null;

  if (isLoading || !data) {
    return (
      <div
        className="flex items-center gap-2 text-sm text-gray-600"
        data-testid="reminder-panel-loading"
      >
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading reminder history…
      </div>
    );
  }

  const { refusal, throttle } = data;

  return (
    <div className="border-t border-gray-200 pt-4 space-y-3" data-testid="reminder-panel">
      <div className="flex items-baseline justify-between">
        <h4 className="font-medium text-gray-900">Payment reminders</h4>
        {!historyOnly && (
          <span className="text-xs text-gray-500" data-testid="reminder-current-state">
            {`Balance $${data.balanceDue} · ${data.daysOverdue} days overdue`}
          </span>
        )}
      </div>

      {!historyOnly && refusal ? (
        <div
          className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2"
          data-testid={`reminder-refusal-${refusal.reason}`}
        >
          <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-amber-900">
            <p>{refusal.message}</p>
            {refusal.reason === "never_sent" && refusal.action && onSendInvoice ? (
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={onSendInvoice} data-testid="reminder-refusal-action">
                {refusal.action.label}
              </Button>
            ) : refusal.action && (
              <p className="mt-1 font-medium" data-testid="reminder-refusal-action">
                {refusal.action.label}
              </p>
            )}
          </div>
        </div>
      ) : !historyOnly && throttle.throttled ? (
        <div
          className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-start gap-2"
          data-testid="reminder-throttled"
        >
          <Clock className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-gray-700">{throttle.message}</p>
        </div>
      ) : null}

      {!historyOnly && onSendInvoice && (
        <Button size="sm" onClick={() => setReviewOpen(true)} data-testid="button-send-reminder">
          <Send className="w-4 h-4 mr-2" />
          Send reminder
        </Button>
      )}

      {/* History — recorded values, not today's. */}
      {data.reminders.length === 0 ? (
        <p className="text-sm text-gray-500" data-testid="reminder-history-empty">
          No reminders have been sent for this invoice.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="reminder-history">
          {data.reminders.map((r) => (
            <li
              key={r.id}
              className="text-sm border border-gray-200 rounded-md p-2"
              data-testid={`reminder-history-row-${r.id}`}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium text-gray-900">
                  {r.sequenceNumber ? `Reminder ${r.sequenceNumber}` : "Failed attempt"}
                </span>
                <span className="text-gray-500">·</span>
                <span className="text-gray-700">{r.templateLabel}</span>
                <span className="text-gray-500">·</span>
                <span className="text-gray-700">{formatWhen(r.sentAt)}</span>
                {r.deliveryStatus !== "sent" && (
                  <span
                    className="text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5"
                    data-testid={`reminder-failed-${r.id}`}
                  >
                    Not delivered
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-600 mt-1">
                {`Sent by ${r.sentByName ?? "a former user"} to ${r.recipientEmail} · balance at the time $${r.balanceAtSend} · ${r.daysOverdueAtSend} days overdue`}
              </div>
              {r.deliveryError && (
                <div className="text-xs text-red-700 mt-1">{r.deliveryError}</div>
              )}
            </li>
          ))}
        </ul>
      )}

      {!historyOnly && onSendInvoice && (
        <ReviewAndSendDialog
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          kind="invoice_reminder"
          entityId={invoiceId}
          title={`Send payment reminder for ${invoiceNumber}`}
          onAction={() => {
            // Both refusal actions go through the invoice review. Only an
            // emailed invoice creates a saved attachment for reminders.
            setReviewOpen(false);
            onSendInvoice();
          }}
          onSendError={() => void refreshHistory()}
          onSent={() => {
            // This includes both the history key and the invoice list counts.
            void queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
            void queryClient.invalidateQueries({ queryKey: ["/api/invoices/reminder-eligibility"] });
          }}
        />
      )}
    </div>
  );
}
