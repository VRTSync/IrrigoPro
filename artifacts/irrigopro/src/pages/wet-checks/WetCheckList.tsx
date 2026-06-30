import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Search, Trash2 } from "lucide-react";
import { apiRequest, queryClient, useArrayQuery, useUnauthenticatedReads, parseApiError } from "@/lib/queryClient";
import { SessionExpiredEmptyState } from "@/components/auth/session-expired-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { OfflineStrip, OfflineSyncUI } from "@/components/offline/sync-ui";
import { createWetCheck as offlineCreateWetCheck } from "@/lib/offline/api";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Customer, WorkOrder, WetCheck } from "@workspace/db/schema";
import { getCurrentUser, newClientId } from "./helpers";

type Blocker = {
  kind: "billing_sheet" | "estimate" | "work_order" | "wet_check_billing";
  id: number;
  displayNumber: string | null;
  invoiceId: number | null;
  invoiceNumber: string | null;
};

function blockerLineLabel(b: Blocker): string {
  const kindLabel =
    b.kind === "billing_sheet" ? "Billing sheet"
    : b.kind === "wet_check_billing" ? "Wet check billing"
    : b.kind === "estimate" ? "Estimate"
    : "Work order";
  const recordLabel = b.displayNumber ?? `#${b.id}`;
  const invoiceLabel = b.invoiceNumber
    ? `Invoice ${b.invoiceNumber}`
    : (b.invoiceId != null ? `Invoice #${b.invoiceId}` : "an invoice");
  return `${kindLabel} ${recordLabel} → ${invoiceLabel}`;
}

export function WetCheckList() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const me = useMemo(() => getCurrentUser(), []);
  // Task #556 — when any default-loaded read 401s, we want the empty
  // state copy to read "sign in again", not "No wet checks yet."
  const unauthenticated = useUnauthenticatedReads();

  const canDelete = me?.role === "company_admin" || me?.role === "super_admin";

  const [pendingDelete, setPendingDelete] = useState<WetCheck | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [conflictBlockers, setConflictBlockers] = useState<Blocker[]>([]);

  const { data: wetChecks = [], isLoading: loadingWcs } = useArrayQuery<WetCheck>({
    queryKey: ["/api/wet-checks"],
  });
  const { data: techWorkOrders = [] } = useArrayQuery<WorkOrder>({
    queryKey: ["/api/work-orders", "technician", me?.id],
    queryFn: () => apiRequest(`/api/work-orders?technician=${me!.id}`),
    enabled: !!me?.id,
  });

  const todaysScheduled = useMemo(() => {
    const today = new Date();
    const y = today.getFullYear(), m = today.getMonth(), d = today.getDate();
    const isToday = (raw: any) => {
      if (!raw) return false;
      const dt = new Date(raw);
      return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d;
    };
    const seen = new Set<number>();
    const out: { customerId: number; customerName: string; address: string | null }[] = [];
    for (const wo of techWorkOrders) {
      if (!isToday(wo.scheduledDate)) continue;
      if (seen.has(wo.customerId)) continue;
      seen.add(wo.customerId);
      out.push({
        customerId: wo.customerId,
        customerName: wo.customerName ?? `Customer #${wo.customerId}`,
        address: (wo as any).projectAddress ?? null,
      });
    }
    return out;
  }, [techWorkOrders]);

  const { data: allCustomers = [] } = useArrayQuery<Customer>({
    queryKey: ["/api/customers", { active: true }],
    queryFn: () => apiRequest("/api/customers?active=true"),
    enabled: !!search.trim(),
  });

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return allCustomers
      .filter(c => c.name.toLowerCase().includes(q) || (c.address ?? "").toLowerCase().includes(q))
      .slice(0, 20);
  }, [allCustomers, search]);

  const createMut = useMutation({
    mutationFn: async (input: { customerId: number }) =>
      offlineCreateWetCheck({ customerId: input.customerId, clientId: newClientId() }),
    onSuccess: (wc: { id?: number; clientId: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] });
      if (wc.id != null) {
        navigate(`/wet-checks/${wc.id}`);
      } else {
        // Offline: server id not assigned yet. Route into the clientId
        // detail so the tech can keep capturing zones, findings, etc.
        // The engine will rewrite the URL placeholder once the create op
        // resolves online; the user-visible URL stays stable.
        toast({
          title: "Queued offline",
          description: "Wet check will sync when you're back online.",
        });
        navigate(`/wet-checks/c/${wc.clientId}`);
      }
    },
    onError: (e: any) => toast({ title: "Failed", description: e?.message ?? "Could not start wet check", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest(`/api/wet-checks/${id}`, "DELETE");
    },
    onSuccess: () => {
      toast({ title: "Wet check deleted", description: "The wet check has been removed." });
      setPendingDelete(null);
      setConflictMessage(null);
      setConflictBlockers([]);
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      if (/^409:/.test(message)) {
        const jsonPart = message.replace(/^409:\s*/, "");
        let parsedMessage: string | null = null;
        let parsedBlockers: Blocker[] = [];
        try {
          const body = JSON.parse(jsonPart);
          if (body && typeof body.message === "string") parsedMessage = body.message;
          if (Array.isArray(body?.blockers)) parsedBlockers = body.blockers as Blocker[];
          // billingNumbers is a flat string array fallback when blockers is absent
          if (parsedBlockers.length === 0 && Array.isArray(body?.billingNumbers)) {
            parsedMessage = parsedMessage ?? "Cannot delete: linked to one or more billing records.";
          }
        } catch {
          // fall through
        }
        // Keep pendingDelete set so the dialog stays open to show conflict details.
        setConflictMessage(parsedMessage ?? parseApiError(err, "Cannot delete: a downstream record is on an invoice."));
        setConflictBlockers(parsedBlockers);
        return;
      }
      toast({
        title: "Delete failed",
        description: parseApiError(err, "Could not delete wet check."),
        variant: "destructive",
      });
      setPendingDelete(null);
      setConflictMessage(null);
      setConflictBlockers([]);
    },
  });

  return (
    <div className="max-w-3xl mx-auto py-4 space-y-4 px-3 sm:px-4 pb-nav-safe">
      <OfflineStrip />
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Wet Checks</h1>
        <OfflineSyncUI />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Start a Wet Check</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search any customer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-11 text-base"
              data-testid="input-customer-search"
            />
          </div>

          {search.trim() && (
            <div className="space-y-1" data-testid="section-search-results">
              {filteredCustomers.length === 0 ? (
                <div className="text-sm text-gray-500 py-3">No matches</div>
              ) : filteredCustomers.map(c => (
                <button
                  key={c.id}
                  className="w-full text-left p-3 border rounded hover:bg-blue-50 disabled:opacity-50"
                  onClick={() => createMut.mutate({ customerId: c.id })}
                  disabled={createMut.isPending}
                  data-testid={`pick-customer-${c.id}`}
                >
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-gray-500">{c.address ?? "—"} · {c.totalControllers ?? 1} controller(s)</div>
                </button>
              ))}
            </div>
          )}

          {!search.trim() && (
            <div data-testid="section-today">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Today's Schedule</div>
              {todaysScheduled.length === 0 ? (
                unauthenticated ? (
                  <SessionExpiredEmptyState
                    message="Your session expired — sign in again to load today's schedule."
                  />
                ) : (
                  <div className="text-sm text-gray-500 py-3">
                    No properties scheduled for you today. Search above to pick any customer.
                  </div>
                )
              ) : (
                <div className="space-y-1">
                  {todaysScheduled.map(p => (
                    <button
                      key={p.customerId}
                      className="w-full text-left p-3 border rounded hover:bg-blue-50 disabled:opacity-50"
                      onClick={() => createMut.mutate({ customerId: p.customerId })}
                      disabled={createMut.isPending}
                      data-testid={`pick-scheduled-${p.customerId}`}
                    >
                      <div className="font-medium">{p.customerName}</div>
                      <div className="text-xs text-gray-500">{p.address ?? "—"}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div>
        <h2 className="text-sm font-semibold text-gray-600 mb-2">In progress & recent</h2>
        {loadingWcs ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin" /></div>
        ) : wetChecks.length === 0 ? (
          unauthenticated ? (
            <SessionExpiredEmptyState
              message="Your session expired — sign in again to load your wet checks."
            />
          ) : (
            <Card><CardContent className="py-6 text-center text-gray-500 text-sm">
              No wet checks yet.
            </CardContent></Card>
          )
        ) : (
          <div className="space-y-2">
            {wetChecks.map(wc => (
              <Card
                key={wc.id}
                className="cursor-pointer hover:bg-gray-50"
                onClick={() => navigate(`/wet-checks/${wc.id}`)}
                data-testid={`wet-check-row-${wc.id}`}
              >
                <CardContent className="py-3 flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{wc.customerName}</div>
                    <div className="text-xs text-gray-500">{wc.propertyAddress ?? "—"}</div>
                    <div className="text-xs text-gray-500">{new Date(wc.startedAt).toLocaleString()}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge variant={wc.status === "in_progress" ? "secondary" : "default"}>{wc.status}</Badge>
                    {canDelete && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-gray-400 hover:text-red-600 hover:bg-red-50"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConflictMessage(null);
                          setConflictBlockers([]);
                          setPendingDelete(wc);
                        }}
                        data-testid={`button-delete-${wc.id}`}
                        aria-label={`Delete wet check for ${wc.customerName}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null);
            setConflictMessage(null);
            setConflictBlockers([]);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {conflictMessage
                ? "Cannot delete wet check"
                : `Delete wet check for ${pendingDelete?.customerName ?? "this customer"}?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {conflictMessage ? (
                  <>
                    <p className="text-red-600">{conflictMessage}</p>
                    {conflictBlockers.length > 0 && (
                      <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                        {conflictBlockers.map((b, i) => (
                          <li key={`${b.kind}-${b.id}-${i}`}>{blockerLineLabel(b)}</li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <p>This cannot be undone.</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {conflictMessage ? "Close" : "Cancel"}
            </AlertDialogCancel>
            {!conflictMessage && (
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={() => pendingDelete && deleteMut.mutate(pendingDelete.id)}
                disabled={deleteMut.isPending}
                data-testid="button-confirm-delete"
              >
                {deleteMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
