import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Loader2 } from "lucide-react";
import { previewOutgoingEmail, sendOutgoingEmail, type OutgoingEmailPreview, type OutgoingEmailSent } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PdfValidationErrorPanel, type PdfErrorDetail } from "@/components/billing/pdf-validation-error";
import { getImpersonationToken } from "@/lib/impersonation";
import { openAuthedPdf } from "@/lib/open-authed-pdf";
import { useToast } from "@/hooks/use-toast";
import { ChipList } from "./chip-list";

interface ReviewAndSendDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "invoice";
  entityId: number;
  title: string;
  onSent?: (r: OutgoingEmailSent) => void;
}

type Fields = Pick<OutgoingEmailPreview, "to" | "cc" | "bcc" | "subject" | "note" | "options">;
const emptyFields: Fields = { to: "", cc: [], bcc: [], subject: "", note: "", options: {} };
const fieldsOf = ({ to, cc, bcc, subject, note, options }: Fields): Fields => ({ to, cc, bcc, subject, note, options });

function requestOptions(signal?: AbortSignal): RequestInit {
  const token = getImpersonationToken();
  return { credentials: "include", cache: "no-store", signal, headers: token ? { "x-impersonation-token": token } : undefined };
}

function apiError(error: unknown, fallback: string): PdfErrorDetail & { status?: number } {
  const response = error as { status?: number; data?: { message?: unknown; validationFailure?: unknown } } | null;
  return {
    status: response?.status,
    message: typeof response?.data?.message === "string" ? response.data.message : fallback,
    validationFailure: response?.data?.validationFailure,
  };
}

export function ReviewAndSendDialog({ open, ...props }: ReviewAndSendDialogProps) {
  // Every opening starts a new review, even for the same invoice.
  return open ? <ReviewSession key={`${props.kind}:${props.entityId}`} {...props} /> : null;
}

function ReviewSession({ onOpenChange, kind, entityId, title, onSent }: Omit<ReviewAndSendDialogProps, "open">) {
  const { toast } = useToast();
  const form = useForm<Fields>({ defaultValues: emptyFields });
  const fields = form.watch();
  const reset = form.reset;
  const sequence = useRef(0);
  const [request, setRequest] = useState<{ sequence: number; fields?: Fields; delay: number }>({ sequence: 0, delay: 0 });
  const [review, setReview] = useState<{ sequence: number; draft: OutgoingEmailPreview }>();
  const [previewError, setPreviewError] = useState<string>();
  const [sendError, setSendError] = useState<PdfErrorDetail>();
  const [viewError, setViewError] = useState<PdfErrorDetail>();
  const [retryRequired, setRetryRequired] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [sending, setSending] = useState(false);
  const inFlightSend = useRef(false);
  const [ccPending, setCcPending] = useState(false);
  const [bccPending, setBccPending] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const draft = await previewOutgoingEmail(kind, entityId, request.fields ?? {}, requestOptions(abort.signal));
        if (abort.signal.aborted || request.sequence !== sequence.current) return;
        reset(fieldsOf(draft));
        setReview({ sequence: request.sequence, draft });
      } catch (error) {
        if (abort.signal.aborted || request.sequence !== sequence.current) return;
        setPreviewError(apiError(error, "Could not load the email preview.").message);
      }
    }, request.delay);
    return () => {
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [kind, entityId, request, reset]);

  const schedule = (next: Fields | undefined, delay = 0) => {
    setPreviewError(undefined);
    setRetryRequired(false);
    setRequest({ sequence: ++sequence.current, fields: next, delay });
  };

  const change = <K extends keyof Fields,>(key: K, value: Fields[K]) => {
    const next = fieldsOf({ ...form.getValues(), [key]: value });
    reset(next, { keepDefaultValues: true });
    setSendError(undefined);
    schedule(next, 600);
  };

  const draft = review?.draft;
  const upToDate = review?.sequence === request.sequence;
  const pending = !upToDate && !previewError;
  const canSend = !!draft?.to && upToDate && !retryRequired && !sending && !ccPending && !bccPending;
  const close = () => { if (!inFlightSend.current) onOpenChange(false); };

  async function send() {
    if (!canSend || !draft || !upToDate || review.sequence !== sequence.current || inFlightSend.current) return;
    inFlightSend.current = true;
    setSending(true);
    setSendError(undefined);
    let result: OutgoingEmailSent;
    try {
      result = await sendOutgoingEmail(kind, entityId, { ...fieldsOf(form.getValues()), confirmationToken: draft.confirmationToken }, requestOptions());
    } catch (error) {
      const detail = apiError(error, "Could not send the email. Check delivery history before trying again.");
      setSendError(detail);
      if (detail.status === 409 || detail.status === 410) schedule(fieldsOf(form.getValues()));
      else setRetryRequired(true);
      return;
    } finally {
      inFlightSend.current = false;
      setSending(false);
    }
    toast({ title: `Sent to ${result.sentTo}` });
    onOpenChange(false);
    onSent?.(result);
  }

  async function viewAttachment(url: string) {
    setViewError(undefined);
    setViewing(true);
    try {
      const result = await openAuthedPdf(url);
      if (!result.ok) setViewError(result);
    } finally {
      setViewing(false);
    }
  }

  return (
    <Dialog open onOpenChange={close}>
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-5xl max-h-[90vh] overflow-y-auto"
        onEscapeKeyDown={e => { if (inFlightSend.current) e.preventDefault(); }}
        onInteractOutside={e => { if (inFlightSend.current) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Review the email and attachment before sending.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <fieldset disabled={!draft || sending} className="min-w-0 space-y-3">
              {draft && (
                <div className="space-y-0.5 text-sm [overflow-wrap:anywhere]">
                  <p className="font-medium">From</p>
                  <p data-testid="text-email-from">{draft.from.name} &lt;{draft.from.email}&gt;</p>
                  <p className="text-xs text-muted-foreground" data-testid="text-email-replies">Replies go to {draft.replyTo ?? draft.from.email}</p>
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="review-email-to">To</Label>
                <Input id="review-email-to" type="email" value={fields.to} onChange={e => change("to", e.target.value)} data-testid="input-review-email-to" />
              </div>
              <ChipList label="CC" values={fields.cc} onChange={value => change("cc", value)} onDraftChange={setCcPending} testIdPrefix="review-email-cc" />
              <ChipList label="BCC" values={fields.bcc} onChange={value => change("bcc", value)} onDraftChange={setBccPending} testIdPrefix="review-email-bcc" />
              <div className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <Label htmlFor="review-email-subject">Subject</Label>
                  <span id="review-subject-length" className="shrink-0 text-xs text-muted-foreground">{fields.subject.length}/200</span>
                </div>
                <Input id="review-email-subject" maxLength={200} aria-describedby="review-subject-length" value={fields.subject} onChange={e => change("subject", e.target.value)} data-testid="input-review-email-subject" />
              </div>
              <div className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <Label htmlFor="review-email-note">Note to customer</Label>
                  <span id="review-note-length" className="shrink-0 text-xs text-muted-foreground">{fields.note.length}/1,000</span>
                </div>
                <Textarea id="review-email-note" maxLength={1000} aria-describedby="review-note-length" value={fields.note} onChange={e => change("note", e.target.value)} data-testid="input-review-email-note" />
              </div>
              {draft?.optionDefs.map(option => (
                <div key={option.key} className="flex items-center gap-2">
                  <Checkbox id={`review-option-${option.key}`} checked={fields.options[option.key] ?? option.default} onCheckedChange={checked => change("options", { ...fields.options, [option.key]: checked === true })} data-testid={`checkbox-review-email-${option.key}`} />
                  <Label htmlFor={`review-option-${option.key}`}>{option.label}</Label>
                </div>
              ))}
              {!!draft?.warnings.length && (
                <ul className="list-inside list-disc space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 [overflow-wrap:anywhere]" data-testid="list-email-warnings">
                  {draft.warnings.map(warning => <li key={warning}>{warning}</li>)}
                </ul>
              )}
              {!!draft?.attachments.length && (
                <div className="space-y-1">
                  <h3 className="text-sm font-medium">Attachments</h3>
                  <ul className="space-y-1">
                    {draft.attachments.map((file, index) => (
                      <li key={index} className="flex min-w-0 items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-sm">
                        <span className="min-w-0 [overflow-wrap:anywhere]" data-testid={`text-email-attachment-${index}`}>{file.filename}</span>
                        <Button type="button" size="sm" variant="outline" className="shrink-0" disabled={viewing || !upToDate} onClick={() => viewAttachment(file.viewUrl)} data-testid={`button-view-email-attachment-${index}`}>View</Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {viewError && <PdfValidationErrorPanel detail={viewError} />}
            </fieldset>
            <section className="min-w-0 space-y-2" aria-label="Rendered email" aria-busy={pending}>
              <h3 className="text-sm font-medium">Email preview</h3>
              {pending ? (
                <div role="status" className="flex h-[60vh] items-start gap-2 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Updating preview…
                </div>
              ) : previewError ? (
                <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{previewError}</p>
              ) : draft ? (
                <iframe sandbox="" srcDoc={draft.html} title="Email preview" className="h-[60vh] w-full rounded-lg border bg-white" />
              ) : null}
            </section>
          </div>
        </Form>
        {sendError && (sendError.validationFailure
          ? <PdfValidationErrorPanel detail={sendError} />
          : <p role="alert" className="break-words text-sm text-red-700" data-testid="text-review-send-error">{sendError.message}</p>
        )}
        <DialogFooter className="mt-0">
          {(previewError || retryRequired) && <Button type="button" variant="outline" onClick={() => schedule(draft ? fieldsOf(form.getValues()) : undefined)} data-testid="button-refresh-email-preview">Refresh preview</Button>}
          <Button type="button" variant="outline" onClick={close} disabled={sending} data-testid="button-cancel-email-review">Cancel</Button>
          <Button type="button" className="h-auto min-h-10 min-w-0 whitespace-normal [overflow-wrap:anywhere]" disabled={!canSend} onClick={send} data-testid="button-send-reviewed-email">
            {sending ? "Sending…" : fields.to.trim() ? `Send to ${fields.to.trim()}` : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
