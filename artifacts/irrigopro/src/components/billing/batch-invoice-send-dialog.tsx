import { Fragment, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetInvoiceBatchQueryKey, previewInvoiceBatch, previewOutgoingEmail,
  useGetInvoiceBatch, useResumeInvoiceBatch, useStartInvoiceBatch,
  type InvoiceBatchSendRow,
} from "@workspace/api-client-react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/format-currency";

export const ACTIVE_INVOICE_BATCH_KEY = ["/api/outgoing-email/batches/active"];
const PREVIEW_KEY = "/api/outgoing-email/invoice/batch/preview";
const STATUS_LABELS = { queued: "Queued", sending: "Sending", sent: "Sent", skipped: "Skipped", failed: "Failed" };

function errorText(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "data" in error) {
    const data = error.data;
    if (data && typeof data === "object" && "message" in data && typeof data.message === "string") return data.message;
  }
  return fallback;
}

function EmailPreview({ row, note, review }: { row: InvoiceBatchSendRow; note: string; review: string }) {
  const query = useQuery({
    queryKey: [PREVIEW_KEY, "email", row.invoiceId, note, review],
    queryFn: ({ signal }) => previewOutgoingEmail("invoice", row.invoiceId, { note }, { signal }),
    retry: false, gcTime: 0,
  });
  if (query.isPending) return <p className="p-2 text-muted-foreground">Loading email…</p>;
  if (query.isError) return <p role="alert" className="p-2 text-red-700">{errorText(query.error, "Could not load the email.")}</p>;
  const email = query.data;
  return (
    <div className="space-y-2 rounded-md border bg-slate-50 p-3 text-sm [overflow-wrap:anywhere]">
      <div>
        <p><strong>To:</strong> {email.to}</p>
        <p><strong>Subject:</strong> {email.subject}</p>
        {email.attachments.map(({ viewUrl, filename }) => <p key={viewUrl}><strong>Attachment:</strong> {filename}</p>)}
      </div>
      <iframe title={`Email for ${row.invoiceNumber}`} sandbox="" srcDoc={email.html} className="h-[50vh] w-full rounded border bg-white" />
    </div>
  );
}

function BatchReviewRows({
  rows, note, review,
}: { rows: InvoiceBatchSendRow[]; note: string; review: string }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const cell = "block py-1 md:table-cell md:p-2 md:align-top";
  return (
    <table className="block w-full table-fixed text-left text-sm md:table">
      <thead className="hidden bg-slate-50 text-slate-700 md:table-header-group">
        <tr>
          <th scope="col" className="w-[20%] p-2">Customer</th>
          <th scope="col" className="w-[23%] p-2">To</th>
          <th scope="col" className="w-[32%] p-2">Subject</th>
          <th scope="col" className="w-[12%] p-2 text-right">Amount</th>
          <th scope="col" className="w-[13%]"><span className="sr-only">Preview</span></th>
        </tr>
      </thead>
      <tbody className="block md:table-row-group">
        {rows.map((row) => (
          <Fragment key={row.invoiceId}>
            <tr className="mb-2 block rounded-md border p-3 [overflow-wrap:anywhere] md:table-row md:border-x-0 md:border-t-0" data-testid={`batch-invoice-send-row-${row.invoiceId}`}>
              <td className={cell}>
                <p className="font-medium md:truncate" title={row.customerLabel}>{row.customerLabel}</p>
                <p className="text-xs text-muted-foreground">{row.invoiceNumber}</p>
              </td>
              <td className={cell}>
                <p className="md:truncate" title={row.to}><span className="font-medium md:hidden">To: </span>{row.to}</p>
              </td>
              <td className={cell}>
                <p className="md:truncate" title={row.subject}><span className="font-medium md:hidden">Subject: </span>{row.subject}</p>
              </td>
              <td className={`${cell} md:text-right`}><span className="font-medium md:hidden">Amount: </span>{formatCurrency(row.amountDue)}</td>
              <td className={cell}>
                <Button type="button" variant="outline" size="sm" className="px-2"
                  aria-expanded={expandedId === row.invoiceId}
                  onClick={() => setExpandedId(expandedId === row.invoiceId ? null : row.invoiceId)}
                  data-testid={`button-view-invoice-email-${row.invoiceId}`}>
                  {expandedId === row.invoiceId ? "Hide email" : "View email"}
                </Button>
              </td>
            </tr>
            {expandedId === row.invoiceId && (
              <tr className="mb-2 block md:table-row">
                <td colSpan={5} className="block md:table-cell md:py-2">
                  <EmailPreview row={row} note={note} review={review} />
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

export function BatchInvoiceSendDialog({
  open, onOpenChange, invoiceIds, batchId, companyId, onStarted,
}: {
  open: boolean; onOpenChange: (open: boolean) => void; invoiceIds: number[];
  batchId?: number | null; companyId?: number; onStarted?: (id: number) => void;
}) {
  const queryClient = useQueryClient();
  const [startedId, setStartedId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [reviewedNote, setReviewedNote] = useState("");
  const progressId = batchId ?? (onStarted ? null : startedId);
  const params = companyId === undefined ? undefined : { companyId };
  const idsKey = invoiceIds.join(",");

  useEffect(() => {
    if (!open) {
      setNote("");
      setReviewedNote("");
    }
  }, [open]);
  useEffect(() => {
    if (note === reviewedNote) return;
    const timer = window.setTimeout(() => setReviewedNote(note), 600);
    return () => window.clearTimeout(timer);
  }, [note, reviewedNote]);

  const preview = useQuery({
    queryKey: [PREVIEW_KEY, companyId, idsKey, reviewedNote],
    queryFn: ({ signal }) => previewInvoiceBatch({ invoiceIds, note: reviewedNote, companyId }, { signal }),
    enabled: open && progressId == null && invoiceIds.length > 0,
    gcTime: 0, retry: false, refetchOnWindowFocus: false,
  });
  const progress = useGetInvoiceBatch(progressId ?? 0, params, { query: {
    queryKey: getGetInvoiceBatchQueryKey(progressId ?? 0, params),
    enabled: progressId != null,
    refetchInterval: (query) => query.state.data?.status === "completed" ? false : 2000,
  } });
  const batch = progress.data;
  const done = batch?.status === "completed";
  useEffect(() => {
    if (!done) return;
    void queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    void queryClient.invalidateQueries({ queryKey: ACTIVE_INVOICE_BATCH_KEY });
  }, [done, queryClient]);

  const start = useStartInvoiceBatch({ mutation: {
    onSuccess: ({ batchId: id }) => {
      if (onStarted) onStarted(id);
      else setStartedId(id);
      void queryClient.invalidateQueries({ queryKey: ACTIVE_INVOICE_BATCH_KEY });
    },
    onError: (err) => {
      if (err.status === 409) {
        void preview.refetch();
        void queryClient.invalidateQueries({ queryKey: ACTIVE_INVOICE_BATCH_KEY });
      }
    },
  } });
  const resume = useResumeInvoiceBatch({ mutation: {
    onSuccess: () => {
      void progress.refetch();
      void queryClient.invalidateQueries({ queryKey: ACTIVE_INVOICE_BATCH_KEY });
    },
  } });
  // Clear mutation errors on a new dialog session, not while an accepted
  // request is still returning its batch ID.
  const resetStart = start.reset;
  const resetResume = resume.reset;
  useEffect(() => {
    if (!open) {
      resetStart();
      resetResume();
    }
  }, [open, resetStart, resetResume]);

  const review = preview.data;
  const count = review?.willSend.length ?? 0;
  const reviewing = progressId == null;
  const reviewPending = preview.isFetching || note !== reviewedNote;
  const canSend = !!review && count > 0 && !reviewPending && !start.isPending && !preview.isError;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl overflow-x-hidden transition-none" data-testid="batch-invoice-send-dialog">
        <DialogHeader>
          <DialogTitle>{reviewing ? `Send ${count} invoices` : "Invoice batch progress"}</DialogTitle>
          <DialogDescription className="[overflow-wrap:anywhere]">
            {reviewing && review
              ? `From ${review.from.name} <${review.from.email}> · Replies go to ${review.replyTo ?? review.from.email}`
              : reviewing ? "Review the selected invoices before sending." : "You can close this window without stopping the batch."}
          </DialogDescription>
          {reviewing && review?.guide && (
            <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]" data-testid="text-batch-invoice-guide">
              Each email also includes {review.guide.filename}.
            </p>
          )}
        </DialogHeader>
        {reviewing ? (
          <>
            <div className="mt-4 space-y-1">
              <label className="text-sm font-medium" htmlFor="batch-invoice-note">Note added to every email (optional)</label>
              <Textarea id="batch-invoice-note" data-testid="input-batch-invoice-note" value={note}
                maxLength={1000} onChange={(event) => setNote(event.target.value)} disabled={start.isPending} />
              <p className="text-right text-xs text-muted-foreground">{note.length}/1,000</p>
            </div>
            <div className="mt-4 max-h-[54vh] space-y-4 overflow-y-auto overflow-x-hidden">
              {reviewPending && <p role="status" className="text-sm text-muted-foreground">Checking the selected invoices…</p>}
              {preview.isError && <p role="alert" className="text-sm text-red-700">{errorText(preview.error, "Could not review the invoices. Nothing was sent.")}</p>}
              {review && !reviewPending && !preview.isError && (
                <>
                  <section>
                    <h3 className="mb-2 text-sm font-semibold">Will send ({count})</h3>
                    {count ? <BatchReviewRows rows={review.willSend} note={reviewedNote} review={review.confirmationToken} />
                      : <p className="text-sm text-muted-foreground">None of the selected invoices can be emailed.</p>}
                  </section>
                  {review.willSkip.length > 0 && (
                    <section>
                      <h3 className="mb-2 text-sm font-semibold">Will skip ({review.willSkip.length})</h3>
                      <ul className="space-y-2">
                        {review.willSkip.map((row) => (
                          <li key={row.invoiceId} className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 [overflow-wrap:anywhere]">
                            <p className="font-medium">{row.invoiceNumber} · {row.customerLabel}</p>
                            <p>{row.message}</p>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {review.notFound.length > 0 && <p className="text-sm text-muted-foreground">Unavailable invoices: {review.notFound.length}. These will not be emailed.</p>}
                </>
              )}
            </div>
            {start.isError && <p role="alert" className="mt-3 text-sm text-red-700">{errorText(start.error, "Could not start the batch. Check the active batch before trying again.")}</p>}
          </>
        ) : (
          <div className="mt-4 space-y-3">
            {progress.isPending && <p role="status" className="text-sm text-muted-foreground">Loading progress…</p>}
            {progress.isError && <p role="alert" className="text-sm text-red-700">{errorText(progress.error, "Could not refresh batch progress.")}</p>}
            {batch && (
              <>
                <p className="text-sm" role="status">{batch.sent} sent · {batch.failed} failed · {batch.skipped} skipped · {batch.queued + batch.sending} to go</p>
                {batch.status === "interrupted" && <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <strong>Interrupted.</strong> Resume to send only the invoices still queued.
                </p>}
                <ul className="max-h-[55vh] space-y-2 overflow-y-auto">
                  {batch.items.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-4 rounded-md border p-3 text-sm [overflow-wrap:anywhere]"
                      data-testid={`batch-invoice-progress-${row.invoiceId}`}>
                      <span className="min-w-0 font-medium">{row.invoiceNumber} · {row.customerLabel}</span>
                      <span className={`inline-flex items-center gap-1 ${row.status === "failed" ? "text-red-700" : row.status === "skipped" ? "text-amber-800" : ""}`}>
                        {row.status === "sending" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                        {STATUS_LABELS[row.status]}
                      </span>
                      {row.message && <p className="w-full text-muted-foreground">{row.message}</p>}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {resume.isError && <p role="alert" className="text-sm text-red-700">{errorText(resume.error, "Could not resume the batch.")}</p>}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-invoice-batch">
            {reviewing ? "Cancel" : "Close"}
          </Button>
          {reviewing && <Button type="button" disabled={!canSend}
            onClick={() => review && start.mutate({ data: { invoiceIds, note, companyId, confirmationToken: review.confirmationToken } })}
            data-testid="button-confirm-invoice-batch">
            {start.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Send {count} invoices
          </Button>}
          {batch?.status === "interrupted" && <Button type="button" disabled={resume.isPending}
            onClick={() => resume.mutate({ id: batch.id, data: { companyId } })} data-testid="button-resume-invoice-batch">
            Resume
          </Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
