import { useRef, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Link2, RefreshCw, UserPlus, EyeOff, MapPin } from "lucide-react";
import { PageContainer, PageContent, PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiRequest, parseApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type CandidateCustomer = { id: number; name: string; irrigoName: string | null; address: string | null };
type HeldRow = {
  id: number;
  kind: "possible_duplicate" | "sub_customer";
  qbCustomerId: string;
  qbName: string | null;
  qbAddress: string | null;
  candidateCustomerId: number | null;
  candidateCustomer: CandidateCustomer | null;
};
type QbCandidate = { qbId: string; name: string; address?: string | null; score: number };
type UnlinkedCustomer = { id: number; name: string; irrigoName?: string | null; address?: string | null };
type ReviewResponse = {
  held: HeldRow[];
  unlinked: { customer: UnlinkedCustomer; candidates: QbCandidate[] }[];
  qbError?: string;
};

type PendingAction =
  | { kind: "link"; rowKey: string; customerId: number; qbCustomerId: string; customerName: string; qbName: string }
  | { kind: "create"; rowKey: string; reviewId: number; row: HeldRow }
  | { kind: "dismiss"; rowKey: string; reviewId: number; qbName: string }
  | { kind: "notInQb"; rowKey: string; customerId: number; customerName: string };

const REVIEW_KEY = ["/api/customer-review"];
const displayName = (c: { name: string; irrigoName?: string | null }) => c.irrigoName || c.name;
const qbLabel = (row: HeldRow) => row.qbName || `QuickBooks customer ${row.qbCustomerId}`;

function dialogText(a: PendingAction): { title: string; body: string; confirm: string } {
  switch (a.kind) {
    case "link":
      return {
        title: "Link to QuickBooks",
        body: `Link ${a.customerName} to QuickBooks customer "${a.qbName}"? Invoices for this customer will go to that QuickBooks customer. Its billing details will update from QuickBooks on the next sync.`,
        confirm: "Link",
      };
    case "create": {
      const qbName = qbLabel(a.row);
      if (a.row.kind === "sub_customer") {
        return {
          title: "Create as its own customer",
          body: `QuickBooks files "${qbName}" under another customer. IrrigoPro doesn't support that yet, so it will be created as its own separate customer. Continue?`,
          confirm: "Create customer",
        };
      }
      const cand = a.row.candidateCustomer;
      return {
        title: "Create as new customer",
        body: cand
          ? `Create "${qbName}" as a new IrrigoPro customer? Use this only if it is not the same customer as ${displayName(cand)}.`
          : `Create "${qbName}" as a new IrrigoPro customer? The IrrigoPro customer it was matched to no longer exists.`,
        confirm: "Create customer",
      };
    }
    case "dismiss":
      return {
        title: "Ignore QuickBooks customer",
        body: `Ignore "${a.qbName}"? The QuickBooks sync will skip this customer from now on. It will not be created in IrrigoPro.`,
        confirm: "Ignore",
      };
    case "notInQb":
      return {
        title: "Not in QuickBooks",
        body: `Mark ${a.customerName} as not in QuickBooks? It will leave this list and the sync will stop comparing it against new QuickBooks customers. It still can't be invoiced to QuickBooks.`,
        confirm: "Mark not in QuickBooks",
      };
  }
}

const failureTitle: Record<PendingAction["kind"], string> = {
  link: "Couldn't link customer",
  create: "Couldn't create customer",
  dismiss: "Couldn't ignore QuickBooks customer",
  notInQb: "Couldn't mark as not in QuickBooks",
};

const successTitle: Record<PendingAction["kind"], string> = {
  link: "Customer linked to QuickBooks",
  create: "Customer created",
  dismiss: "QuickBooks customer ignored",
  notInQb: "Marked as not in QuickBooks",
};

function ReviewSkeleton() {
  return (
    <div className="space-y-6" data-testid="skeleton-customer-review">
      {[0, 1].map((s) => (
        <Card key={s}>
          <CardHeader><Skeleton className="h-5 w-48" /></CardHeader>
          <CardContent className="space-y-3">
            {[0, 1, 2].map((r) => (
              <div key={r} className="rounded-lg border border-slate-200 p-4 space-y-2">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-3 w-72" />
                <div className="flex gap-2 pt-1"><Skeleton className="h-8 w-28" /><Skeleton className="h-8 w-20" /></div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function CustomerReviewPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<PendingAction | null>(null);
  const [pendingRows, setPendingRows] = useState<Set<string>>(new Set());
  const submittingRef = useRef(false);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<ReviewResponse | null>({
    queryKey: REVIEW_KEY,
    staleTime: 30_000,
    refetchOnMount: "always",
  });

  const mutation = useMutation({
    mutationFn: async (a: PendingAction) => {
      switch (a.kind) {
        case "link":
          return apiRequest("/api/customer-review/link", "POST", { customerId: a.customerId, qbCustomerId: a.qbCustomerId });
        case "create":
          return apiRequest(`/api/customer-review/${a.reviewId}/create`, "POST");
        case "dismiss":
          return apiRequest(`/api/customer-review/${a.reviewId}/dismiss`, "POST");
        case "notInQb":
          return apiRequest("/api/customer-review/not-in-quickbooks", "POST", { customerId: a.customerId, value: true });
      }
    },
    onSuccess: async (_res, a) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/customer-review"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/customer-review/summary"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/customers"] }),
      ]);
      toast({ title: successTitle[a.kind] });
    },
    onError: (err, a) => {
      toast({ title: failureTitle[a.kind], description: parseApiError(err, "Failed to process customer review."), variant: "destructive" });
    },
    onSettled: (_r, _e, a) => {
      setPendingRows((prev) => { const n = new Set(prev); n.delete(a.rowKey); return n; });
      submittingRef.current = false;
      setDialog(null);
    },
  });

  const submitAction = () => {
    if (!dialog || submittingRef.current) return;
    submittingRef.current = true;
    const a = dialog;
    setPendingRows((prev) => new Set(prev).add(a.rowKey));
    mutation.mutate(a);
  };
  const dialogPending = dialog !== null && pendingRows.has(dialog.rowKey);

  const text = dialog ? dialogText(dialog) : null;
  const held = data?.held ?? [];
  const unlinked = data?.unlinked ?? [];
  const qbError = data?.qbError;

  return (
    <PageContainer>
      <div className="[&_p]:whitespace-normal [&_p]:overflow-visible [&_p]:[text-overflow:clip] [&_p]:max-w-3xl">
        <PageHeader
          title="Customer review"
          subtitle="QuickBooks customers the sync held back, and IrrigoPro customers that aren't linked to QuickBooks. Nothing here changes until you confirm it."
        />
      </div>
      <PageContent className="space-y-6">
        {isLoading ? (
          <ReviewSkeleton />
        ) : isError || !data ? (
          <Card data-testid="error-customer-review">
            <CardContent className="p-10 text-center">
              <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-3" />
              <h3 className="text-base font-semibold text-slate-900 mb-1">Couldn't load customer review</h3>
              <p className="text-sm text-slate-500 mb-5">The review list didn't load. Nothing was changed.</p>
              <Button variant="outline" onClick={() => refetch()} disabled={isFetching} data-testid="button-retry-review">
                <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {qbError !== undefined && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="banner-qb-error">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>Couldn't reach QuickBooks to suggest matches: {qbError}</span>
              </div>
            )}

            <Card>
              <CardHeader className="border-b border-slate-100">
                <CardTitle className="text-lg">Held by the sync</CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                {held.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500" data-testid="empty-held">The sync hasn't held anything back.</p>
                ) : held.map((row) => {
                  const rowKey = `held-${row.id}`;
                  const busy = pendingRows.has(rowKey);
                  const cand = row.candidateCustomer;
                  return (
                    <div key={row.id} className="rounded-lg border border-slate-200 bg-white p-4" data-testid={`row-held-${row.id}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 break-words" data-testid={`text-qb-name-${row.id}`}>{qbLabel(row)}</div>
                          {row.qbAddress && (
                            <div className="flex items-center gap-1 text-sm text-slate-500 mt-0.5">
                              <MapPin className="w-3.5 h-3.5 flex-shrink-0" /><span className="break-words">{row.qbAddress}</span>
                            </div>
                          )}
                        </div>
                        <Badge variant="outline" className={row.kind === "possible_duplicate" ? "border-amber-300 bg-amber-50 text-amber-800" : "border-sky-300 bg-sky-50 text-sky-800"} data-testid={`badge-kind-${row.id}`}>
                          {row.kind === "possible_duplicate" ? "Possible duplicate" : "Filed under another customer in QuickBooks"}
                        </Badge>
                      </div>
                      {row.kind === "possible_duplicate" && (
                        <div className="mt-2 text-sm text-slate-600">
                          Matches IrrigoPro customer:{" "}
                          {cand ? (
                            <Link href={`/customers/${cand.id}/profile`} className="font-medium text-sky-700 hover:underline" data-testid={`link-candidate-${row.id}`}>
                              {displayName(cand)}
                            </Link>
                          ) : (
                            <span className="italic text-slate-500" data-testid={`text-candidate-missing-${row.id}`}>that customer no longer exists</span>
                          )}
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {row.kind === "possible_duplicate" && cand && (
                          <Button size="sm" disabled={busy} data-testid={`button-link-held-${row.id}`}
                            onClick={() => setDialog({ kind: "link", rowKey, customerId: cand.id, qbCustomerId: row.qbCustomerId, customerName: displayName(cand), qbName: qbLabel(row) })}>
                            <Link2 className="w-4 h-4 mr-1.5" />Link to {displayName(cand)}
                          </Button>
                        )}
                        <Button size="sm" variant="outline" disabled={busy} data-testid={`button-create-held-${row.id}`}
                          onClick={() => setDialog({ kind: "create", rowKey, reviewId: row.id, row })}>
                          <UserPlus className="w-4 h-4 mr-1.5" />
                          {row.kind === "possible_duplicate" ? "Create as new customer" : "Create as its own customer"}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy} data-testid={`button-ignore-held-${row.id}`}
                          onClick={() => setDialog({ kind: "dismiss", rowKey, reviewId: row.id, qbName: qbLabel(row) })}>
                          Ignore
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b border-slate-100">
                <CardTitle className="text-lg">Not linked to QuickBooks</CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                {unlinked.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500" data-testid="empty-unlinked">Every customer is linked to QuickBooks.</p>
                ) : unlinked.map(({ customer, candidates }) => {
                  const rowKey = `unlinked-${customer.id}`;
                  const busy = pendingRows.has(rowKey);
                  const shown = qbError !== undefined ? [] : candidates ?? [];
                  return (
                    <div key={customer.id} className="rounded-lg border border-slate-200 bg-white p-4" data-testid={`card-unlinked-${customer.id}`}>
                      <Link href={`/customers/${customer.id}/profile`} className="font-semibold text-sky-700 hover:underline break-words" data-testid={`link-unlinked-${customer.id}`}>
                        {displayName(customer)}
                      </Link>
                      {customer.address && <div className="text-sm text-slate-500 mt-0.5 break-words">{customer.address}</div>}
                      <div className="mt-3 space-y-2">
                        {shown.length === 0 ? (
                          <p className="text-sm text-slate-500" data-testid={`text-no-candidates-${customer.id}`}>No likely QuickBooks match. Check the customer exists in QuickBooks, then sync customers.</p>
                        ) : shown.map((c) => (
                          <div key={c.qbId} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2" data-testid={`row-candidate-${customer.id}-${c.qbId}`}>
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-slate-900 break-words">{c.name}</div>
                              {c.address && <div className="text-xs text-slate-500 break-words">{c.address}</div>}
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className={c.score >= 0.8 ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-300 text-slate-600"}>
                                {c.score >= 0.8 ? "Strong match" : "Possible match"}
                              </Badge>
                              <Button size="sm" variant="outline" disabled={busy} data-testid={`button-link-candidate-${customer.id}-${c.qbId}`}
                                onClick={() => setDialog({ kind: "link", rowKey, customerId: customer.id, qbCustomerId: c.qbId, customerName: displayName(customer), qbName: c.name })}>
                                Link
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex justify-end">
                        <Button size="sm" variant="ghost" disabled={busy} data-testid={`button-not-in-qb-${customer.id}`}
                          onClick={() => setDialog({ kind: "notInQb", rowKey, customerId: customer.id, customerName: displayName(customer) })}>
                          <EyeOff className="w-4 h-4 mr-1.5" />Not in QuickBooks
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </>
        )}
      </PageContent>

      <AlertDialog open={dialog !== null} onOpenChange={(open) => { if (!open && !submittingRef.current && !dialogPending) setDialog(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{text?.title}</AlertDialogTitle>
            <AlertDialogDescription data-testid="text-dialog-body">{text?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dialogPending} data-testid="button-dialog-cancel">Cancel</AlertDialogCancel>
            <Button onClick={submitAction} disabled={!dialog || dialogPending} data-testid="button-dialog-confirm">
              {dialogPending ? "Working..." : text?.confirm}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
