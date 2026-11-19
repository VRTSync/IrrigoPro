import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail, RefreshCw, ShieldCheck, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, parseApiError } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export interface CompanySender {
  from: { email: string; name: string };
  replyTo: string | undefined | null;
  usingCompanyAddress: boolean;
}

export interface EmailSenderResponse {
  sendingDomain: string | null;
  domainVerifiedAt: string | null;
  domainCheckedAt: string | null;
  domainCheckError: string | null;
  fromName: string | null;
  fromAddress: string | null;
  replyTo: string | null;
  effective: CompanySender;
}

export function emailSenderQueryKey(companyId?: number | null) {
  return companyId != null
    ? ["/api/company/email-sender", companyId]
    : ["/api/company/email-sender"];
}

function formatChecked(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Status line shared by the Company Profile card and the super admin drawer. */
export function DomainStatus({ data }: { data: EmailSenderResponse }) {
  if (!data.sendingDomain) return null;
  if (data.domainVerifiedAt) {
    const checked = formatChecked(data.domainCheckedAt ?? data.domainVerifiedAt);
    return (
      <div className="flex items-start gap-2 text-sm text-green-700" data-testid="status-domain-authenticated">
        <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
        <span>Authenticated in SendGrid{checked ? <span className="text-muted-foreground"> · checked {checked}</span> : null}</span>
      </div>
    );
  }
  const checked = formatChecked(data.domainCheckedAt);
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="status-domain-unauthenticated">
      <div className="flex flex-wrap items-center gap-2 font-medium">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        Not authenticated{checked ? <span className="font-normal text-amber-700"> · checked {checked}</span> : null}
      </div>
      {data.domainCheckError && <p className="mt-1 break-words" data-testid="text-domain-check-error">{data.domainCheckError}</p>}
    </div>
  );
}

/** Check-again mutation, used by both surfaces. */
export function useCheckEmailDomain(companyId: number, onDone?: () => void) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: () => apiRequest(`/api/company/${companyId}/email-sender/check`, "POST") as Promise<EmailSenderResponse>,
    onSuccess: (data) => {
      queryClient.setQueryData(emailSenderQueryKey(companyId), data);
      queryClient.invalidateQueries({ queryKey: ["/api/company/email-sender"] });
      toast({ title: data?.domainVerifiedAt ? "Domain is authenticated" : "Domain is not authenticated yet" });
      onDone?.();
    },
    onError: (error) => toast({ title: "Couldn't check domain", description: parseApiError(error, "Try again"), variant: "destructive" }),
  });
}

export function OutgoingEmailCard({ companyId, canEdit }: { companyId: number; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const query = useQuery<EmailSenderResponse>({
    queryKey: emailSenderQueryKey(),
    queryFn: () => apiRequest("/api/company/email-sender", "GET"),
    enabled: !!companyId,
  });
  const data = query.data;
  const domain = data?.sendingDomain ?? null;
  const savedLocal = data?.fromAddress ? data.fromAddress.split("@")[0] : "";

  const [fromName, setFromName] = useState("");
  const [localPart, setLocalPart] = useState("");
  const [replyTo, setReplyTo] = useState("");

  useEffect(() => {
    if (data) {
      setFromName(data.fromName ?? "");
      setLocalPart(data.fromAddress ? data.fromAddress.split("@")[0] : "");
      setReplyTo(data.replyTo ?? "");
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => apiRequest(`/api/company/${companyId}/email-sender`, "PUT", {
      fromName: fromName.trim(),
      fromLocalPart: localPart.trim(),
      replyTo: replyTo.trim(),
    }) as Promise<EmailSenderResponse>,
    onSuccess: (res) => {
      queryClient.setQueryData(emailSenderQueryKey(), res);
      queryClient.invalidateQueries({ queryKey: ["/api/company/email-sender"] });
      toast({ title: "Outgoing email saved" });
    },
    onError: (error) => toast({ title: "Error", description: parseApiError(error, "Failed to save outgoing email"), variant: "destructive" }),
  });
  const check = useCheckEmailDomain(companyId, () => query.refetch());

  const localValid = localPart.trim() === "" || /^[a-z0-9._%+-]{1,64}$/i.test(localPart.trim());
  const changed = !!data && (fromName !== (data.fromName ?? "") || localPart !== savedLocal || replyTo !== (data.replyTo ?? ""));
  const busy = save.isPending || check.isPending;
  const readOnly = !canEdit || busy;
  const fromPreview = domain && localPart.trim() ? `${localPart.trim().toLowerCase()}@${domain}` : data?.effective.from.email ?? "";

  return (
    <Card className="min-w-0 max-w-full" data-testid="card-outgoing-email">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Mail className="h-5 w-5" />Outgoing email</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">Estimates, invoices, reminders and reports go to your customers under this sender. Staff notices like password resets still come from IrrigoPro.</p>

        {query.isLoading ? (
          <div className="space-y-3" data-testid="status-outgoing-email-loading">
            <div className="skeleton-shimmer h-5 w-1/2" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="skeleton-shimmer h-10" /><div className="skeleton-shimmer h-10" />
            </div>
            <div className="skeleton-shimmer h-10 md:w-1/2" />
          </div>
        ) : query.isError || !data ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 flex flex-wrap items-center justify-between gap-2" data-testid="status-outgoing-email-error">
            <span>{parseApiError(query.error, "Couldn't load outgoing email settings.")}</span>
            {canEdit && <Button size="sm" variant="outline" onClick={() => query.refetch()} data-testid="button-outgoing-email-retry">Retry</Button>}
          </div>
        ) : (
          <>
            <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Sending domain</div>
                  {domain ? (
                    <div className="font-mono text-sm font-medium break-all" data-testid="text-sending-domain">{domain}</div>
                  ) : (
                    <div className="text-sm text-muted-foreground" data-testid="text-sending-domain-none">No sending domain assigned yet. Ask IrrigoPro support to set one up.</div>
                  )}
                </div>
                {canEdit && domain && (
                  <Button size="sm" variant="outline" onClick={() => check.mutate()} disabled={busy} data-testid="button-check-domain">
                    {check.isPending ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-2" />}
                    Check again
                  </Button>
                )}
              </div>
              <DomainStatus data={data} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2 min-w-0">
                <Label htmlFor="email-from-name">From name</Label>
                <Input id="email-from-name" maxLength={100} placeholder={data.effective.from.name} value={fromName} onChange={(e) => setFromName(e.target.value)} disabled={readOnly} data-testid="input-from-name" />
              </div>
              <div className="space-y-2 min-w-0">
                <Label htmlFor="email-from-local">From address</Label>
                <div className="flex max-w-full items-stretch">
                  <Input id="email-from-local" className="rounded-r-none min-w-0" maxLength={64} placeholder="billing" value={localPart} onChange={(e) => setLocalPart(e.target.value)} disabled={readOnly || !domain} data-testid="input-from-local-part" />
                  <span className="inline-flex items-center rounded-r-md border border-l-0 bg-muted px-3 text-sm text-muted-foreground font-mono truncate max-w-[55%]" title={domain ? `@${domain}` : undefined} data-testid="text-from-domain-suffix">@{domain ?? "no-domain"}</span>
                </div>
                {!localValid && <p className="text-sm text-destructive">Use letters, numbers and . _ % + - only.</p>}
              </div>
              <div className="space-y-2 min-w-0 md:col-span-1">
                <Label htmlFor="email-reply-to">Reply-To</Label>
                <Input id="email-reply-to" type="email" placeholder={fromPreview || "office@yourcompany.com"} value={replyTo} onChange={(e) => setReplyTo(e.target.value)} disabled={readOnly} data-testid="input-reply-to" />
              </div>
            </div>

            <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 break-words" data-testid="text-effective-sender">
              Customers see: <span className="font-medium">{data.effective.from.name} &lt;{data.effective.from.email}&gt;</span>. Replies go to <span className="font-medium">{data.effective.replyTo ?? data.effective.from.email}</span>.
              {!data.effective.usingCompanyAddress && data.fromAddress && (
                <> Your address isn't authenticated yet, so mail is sent from {data.effective.from.email} on your behalf.</>
              )}
            </div>

            {canEdit && (
              <Button onClick={() => save.mutate()} disabled={busy || !changed || !localValid} data-testid="button-save-outgoing-email">
                {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
