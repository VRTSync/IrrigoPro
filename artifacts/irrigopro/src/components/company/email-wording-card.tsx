import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListCompanyEmailWordingQueryKey, previewCompanyEmailWording, useListCompanyEmailWording,
  useResetCompanyEmailWording, useSaveCompanyEmailWording,
  type CompanyEmailWordingEntry, type EmailWordingContent, type EmailWordingPreview,
  type EmailWordingValidationProblem,
} from "@workspace/api-client-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useWordingDiscardGuard } from "./use-wording-discard-guard";

const fields = [
  { name: "subject", label: "Subject", limit: 150, rows: 0 },
  { name: "eyebrow", label: "Short label above the headline", limit: 60, rows: 0 },
  { name: "headline", label: "Headline", limit: 120, rows: 0 },
  { name: "intro", label: "Opening paragraph", limit: 800, rows: 4 },
  { name: "closing", label: "Closing line", limit: 400, rows: 2 },
] as const;
type Field = keyof EmailWordingContent;
type Rendered = { subject: string; html: string };

export function EmailWordingCard({ companyId }: { companyId: number }) {
  const queryKey = getListCompanyEmailWordingQueryKey(companyId);
  const query = useListCompanyEmailWording(companyId, { query: { queryKey, retry: false } });
  const [selected, setSelected] = useState("invoice");
  const entry = query.data?.find(row => row.key === selected) ?? query.data?.[0];
  return (
    <Card className="min-w-0" data-testid="card-email-wording">
      <CardHeader>
        <CardTitle>Email wording</CardTitle>
        <CardDescription>Change what each customer email says. Layout, logo, amounts and attachments stay the same.</CardDescription>
      </CardHeader>
      <CardContent>
        {query.isPending && <p role="status">Loading email wording…</p>}
        {query.isError && (
          <div className="flex flex-wrap items-center gap-2">
            <p role="alert">Could not load email wording.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()} data-testid="button-retry-email-wording">Retry</Button>
          </div>
        )}
        {entry && <WordingEditor key={`${companyId}:${entry.key}`} companyId={companyId} entry={entry} entries={query.data!} onSelect={setSelected} />}
      </CardContent>
    </Card>
  );
}

function WordingEditor({ companyId, entry, entries, onSelect }: {
  companyId: number;
  entry: CompanyEmailWordingEntry;
  entries: CompanyEmailWordingEntry[];
  onSelect: (key: string) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const queryKey = getListCompanyEmailWordingQueryKey(companyId);
  const form = useForm<EmailWordingContent>({ defaultValues: entry.wording });
  const [subject, eyebrow, headline, intro, closing] = form.watch(["subject", "eyebrow", "headline", "intro", "closing"]);
  const draft = useMemo(() => ({ subject, eyebrow, headline, intro, closing }), [subject, eyebrow, headline, intro, closing]);
  const initialDraft = useRef(draft);
  const { isDirty } = form.formState;
  useEffect(() => {
    if (!isDirty) form.reset(entry.wording);
  }, [entry.wording, form, isDirty]);

  const discardMessage = `Discard your changes to ${entry.label}?`;
  useWordingDiscardGuard(isDirty, discardMessage);
  const lastField = useRef<{ name: Field; element: HTMLInputElement | HTMLTextAreaElement } | null>(null);
  const [lastPreview, setLastPreview] = useState<Rendered>();
  const [validation, setValidation] = useState<{ draft: EmailWordingContent; result?: EmailWordingPreview; failed?: boolean }>();
  const [attempt, setAttempt] = useState(0);
  const currentValidation = validation?.draft === draft ? validation : undefined;
  const errors = currentValidation?.result?.fieldErrors;
  const updating = !currentValidation;

  useEffect(() => {
    const controller = new AbortController();
    const delay = draft === initialDraft.current && attempt === 0 ? 0 : 400;
    const timer = setTimeout(() => {
      void previewCompanyEmailWording(companyId, entry.key, draft, { signal: controller.signal })
        .then(result => {
          if (controller.signal.aborted) return;
          if (result.html !== undefined && result.subject !== undefined) setLastPreview({ html: result.html, subject: result.subject });
          setValidation({ draft, result });
        })
        .catch(() => {
          if (!controller.signal.aborted) setValidation({ draft, failed: true });
        });
    }, delay);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [companyId, entry.key, draft, attempt]);

  function applyEntry(next: CompanyEmailWordingEntry) {
    queryClient.setQueryData<CompanyEmailWordingEntry[]>(queryKey, rows => rows?.map(row => row.key === next.key ? next : row));
    form.reset(next.wording);
    void queryClient.invalidateQueries({ queryKey });
  }
  const save = useSaveCompanyEmailWording<{ status?: number; data?: EmailWordingValidationProblem }>({
    mutation: {
      onSuccess: next => { applyEntry(next); toast({ title: "Email wording saved" }); },
      onError: (error, variables) => {
        const problem = error.data;
        if (error.status === 422 && problem?.fieldErrors) {
          setValidation({ draft: variables.data, result: { fieldErrors: problem.fieldErrors } });
        }
        toast({ title: "Could not save email wording", description: problem?.message, variant: "destructive" });
      },
    },
  });
  const reset = useResetCompanyEmailWording({
    mutation: {
      onSuccess: () => {
        applyEntry({ ...entry, wording: entry.defaults, isCustom: false, updatedAt: null, updatedBy: null });
        toast({ title: "Default email wording restored" });
      },
      onError: () => toast({ title: "Could not reset email wording", variant: "destructive" }),
    },
  });
  const busy = save.isPending || reset.isPending;
  const canSave = isDirty && !busy && currentValidation?.result?.fieldErrors === null;

  function insertPlaceholder(name: string) {
    const field = lastField.current;
    if (!field) return;
    const value = form.getValues(field.name);
    const from = field.element.selectionStart ?? value.length;
    const to = field.element.selectionEnd ?? from;
    const token = `{${name}}`;
    form.setValue(field.name, value.slice(0, from) + token + value.slice(to), { shouldDirty: true });
    requestAnimationFrame(() => {
      field.element.focus();
      field.element.setSelectionRange(from + token.length, from + token.length);
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Select value={entry.key} disabled={busy} onValueChange={key => {
            if (key !== entry.key && (!isDirty || window.confirm(discardMessage))) onSelect(key);
          }}>
            <SelectTrigger className="min-w-0 flex-1" aria-label="Customer email" data-testid="select-customer-email">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {entries.map(row => (
                <SelectItem key={row.key} value={row.key} data-testid={`option-customer-email-${row.key}`}>
                  {row.label}{row.isCustom && <Badge variant="secondary" className="ml-2">Custom</Badge>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Form {...form}>
          <form className="space-y-4" onSubmit={event => {
            event.preventDefault();
            if (canSave) save.mutate({ companyId, key: entry.key, data: draft });
          }}>
            {fields.map(({ name, label, limit, rows }) => (
              <FormField key={name} control={form.control} name={name} render={({ field }) => {
                const InputComponent = rows ? Textarea : Input;
                const error = errors?.[name];
                return (
                  <FormItem>
                    <div className="flex justify-between gap-2">
                      <FormLabel className="leading-normal">{label}</FormLabel>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground" data-testid={`count-email-wording-${name}`}>
                        {field.value.trim().length}/{limit}
                      </span>
                    </div>
                    <FormControl>
                      <InputComponent {...field} {...(rows ? { rows } : {})} disabled={busy}
                        aria-invalid={!!error} data-testid={`input-email-wording-${name}`}
                        onFocus={event => { lastField.current = { name, element: event.currentTarget }; }} />
                    </FormControl>
                    {error && <FormDescription role="alert" className="break-words text-destructive" data-testid={`error-email-wording-${name}`}>{error}</FormDescription>}
                    <FormMessage />
                  </FormItem>
                );
              }} />
            ))}
            <div>
              <p className="mb-1.5 text-sm font-medium">Placeholders</p>
              <div className="flex flex-wrap gap-1.5">
                {entry.placeholders.map(name => (
                  <Button type="button" key={name} variant="outline" size="sm" className="h-7 px-2"
                    disabled={busy} onMouseDown={event => event.preventDefault()} onClick={() => insertPlaceholder(name)}
                    data-testid={`button-insert-wording-${name}`}>
                    {`{${name}}`}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={!canSave} data-testid="button-save-email-wording">{save.isPending ? "Saving…" : "Save"}</Button>
              {entry.isCustom && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="outline" disabled={busy} data-testid="button-reset-email-wording">Reset to default</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Reset {entry.label} to IrrigoPro's default wording?</AlertDialogTitle>
                      <AlertDialogDescription>This removes your company’s custom wording for this email.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel data-testid="button-cancel-reset-email-wording">Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => reset.mutate({ companyId, key: entry.key })} data-testid="button-confirm-reset-email-wording">
                        Reset to default
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
            {entry.isCustom && entry.updatedAt && (
              <p className="break-words text-xs text-muted-foreground" data-testid="text-email-wording-last-changed">
                Last changed {new Date(entry.updatedAt).toLocaleDateString()}{entry.updatedBy ? ` by ${entry.updatedBy}` : ""}
              </p>
            )}
          </form>
        </Form>
      </div>
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Preview <span className="font-normal text-muted-foreground">· Sample data</span></h3>
          {updating && <p className="text-sm text-muted-foreground" role="status">Updating…</p>}
        </div>
        {currentValidation?.failed && (
          <div className="flex flex-wrap items-center gap-2">
            <p role="alert" className="text-sm text-destructive">Could not update the preview.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => { setValidation(undefined); setAttempt(n => n + 1); }}
              data-testid="button-retry-email-wording-preview">Retry</Button>
          </div>
        )}
        {lastPreview && <>
          <p className="break-words text-sm" data-testid="text-email-wording-preview-subject"><strong>Subject:</strong> {lastPreview.subject}</p>
          <iframe sandbox="" srcDoc={lastPreview.html} title="Email preview" className="h-[70vh] w-full rounded-lg border bg-white" />
        </>}
      </div>
    </div>
  );
}
