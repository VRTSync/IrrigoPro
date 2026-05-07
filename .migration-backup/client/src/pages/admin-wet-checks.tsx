import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, parseApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Trash2, Eye, Search, Droplets } from "lucide-react";
import type { WetCheck } from "@shared/schema";

type AdminWetCheckRow = WetCheck & {
  zoneRecordCount: number;
  findingCount: number;
  photoCount: number;
};

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "in_progress", label: "In progress" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "partially_converted", label: "Partially converted" },
  { value: "converted", label: "Converted" },
] as const;

function statusBadgeVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "in_progress": return "secondary";
    case "submitted": return "default";
    case "approved": return "default";
    case "partially_converted": return "outline";
    case "converted": return "outline";
    default: return "secondary";
  }
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function AdminWetChecksPage() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  type Blocker = {
    kind: "billing_sheet" | "estimate" | "work_order";
    id: number;
    displayNumber: string | null;
    invoiceId: number | null;
    invoiceNumber: string | null;
  };
  const [pendingDelete, setPendingDelete] = useState<AdminWetCheckRow | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [conflictBlockers, setConflictBlockers] = useState<Blocker[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkBlockedIds, setBulkBlockedIds] = useState<Set<number>>(new Set());
  type BulkBlockedDetail = { id: number; message: string; blockers: Blocker[] };
  const [bulkBlockedDetails, setBulkBlockedDetails] = useState<BulkBlockedDetail[]>([]);

  const queryKey = useMemo(
    () => ["/api/wet-checks/admin", statusFilter] as const,
    [statusFilter],
  );

  const { data, isLoading, isError, error } = useQuery<AdminWetCheckRow[]>({
    queryKey,
    queryFn: async () => {
      const url = statusFilter === "all"
        ? "/api/wet-checks/admin"
        : `/api/wet-checks/admin?status=${encodeURIComponent(statusFilter)}`;
      return await apiRequest(url, "GET");
    },
  });

  const filtered = useMemo(() => {
    const rows = data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.customerName.toLowerCase().includes(q) ||
      r.technicianName.toLowerCase().includes(q) ||
      (r.propertyAddress ?? "").toLowerCase().includes(q) ||
      String(r.id).includes(q),
    );
  }, [data, search]);

  const visibleIds = useMemo(() => filtered.map(r => r.id), [filtered]);
  const selectedVisibleCount = useMemo(
    () => visibleIds.filter(id => selectedIds.has(id)).length,
    [visibleIds, selectedIds],
  );
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setBulkBlockedIds(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setBulkBlockedIds(new Set());
    setBulkBlockedDetails([]);
  };

  const blockerLineLabel = (b: Blocker) => {
    const kindLabel =
      b.kind === "billing_sheet" ? "Billing sheet"
      : b.kind === "estimate" ? "Estimate"
      : "Work order";
    const recordLabel = b.displayNumber ?? `#${b.id}`;
    const invoiceLabel = b.invoiceNumber
      ? `Invoice ${b.invoiceNumber}`
      : (b.invoiceId != null ? `Invoice #${b.invoiceId}` : "an invoice");
    return `${kindLabel} ${recordLabel} → ${invoiceLabel}`;
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest(`/api/wet-checks/${id}`, "DELETE");
    },
    onSuccess: () => {
      toast({
        title: "Wet check deleted",
        description: "Zones, findings, photos, and any downstream billing sheets, estimates, or work orders were removed.",
      });
      setPendingDelete(null);
      setConflictMessage(null);
      setConflictBlockers([]);
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks/admin"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks/pending-review"] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      // 409 → keep dialog open and surface inline; everything else dismisses.
      if (/^409:/.test(message)) {
        // apiRequest serializes 4xx/5xx as `${status}: ${jsonBody}`.
        // Pull the JSON portion to extract the structured blockers list.
        const jsonPart = message.replace(/^409:\s*/, "");
        let parsedMessage: string | null = null;
        let parsedBlockers: Blocker[] = [];
        try {
          const body = JSON.parse(jsonPart);
          if (body && typeof body.message === "string") parsedMessage = body.message;
          if (Array.isArray(body?.blockers)) parsedBlockers = body.blockers as Blocker[];
        } catch {
          // Fall through to parseApiError below.
        }
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

  type BulkOutcome = {
    id: number;
    status: 'deleted' | 'blocked' | 'not_found' | 'error';
    message?: string;
    blockers?: Blocker[];
  };
  type BulkResponse = {
    results: BulkOutcome[];
    summary: { requested: number; deleted: number; blocked: number; notFound: number; failed: number };
  };

  const bulkDeleteMutation = useMutation<BulkResponse, unknown, number[]>({
    mutationFn: async (ids: number[]) => {
      return await apiRequest("/api/wet-checks/bulk-delete", "DELETE", { ids });
    },
    onSuccess: (data) => {
      const { summary, results } = data;
      const blockedIds = new Set(results.filter(r => r.status === 'blocked').map(r => r.id));
      const remaining = new Set<number>();
      for (const r of results) {
        if (r.status !== 'deleted' && r.status !== 'not_found') remaining.add(r.id);
      }
      setSelectedIds(remaining);
      setBulkBlockedIds(blockedIds);
      // Capture the structured per-id blocker details from the server so we
      // can render them under the bulk toolbar (matches single-delete UX).
      setBulkBlockedDetails(
        results
          .filter(r => r.status === 'blocked')
          .map(r => ({
            id: r.id,
            message: r.message ?? "Cannot delete: a downstream record is on an invoice.",
            blockers: Array.isArray(r.blockers) ? r.blockers : [],
          })),
      );
      setShowBulkConfirm(false);

      const parts: string[] = [`${summary.deleted} deleted`];
      if (summary.blocked > 0) parts.push(`${summary.blocked} blocked (on invoice)`);
      if (summary.notFound > 0) parts.push(`${summary.notFound} not found`);
      if (summary.failed > 0) parts.push(`${summary.failed} failed`);

      const hasProblem = summary.blocked + summary.failed > 0;
      toast({
        title: hasProblem ? "Bulk delete finished with issues" : "Wet checks deleted",
        description: parts.join(" · "),
        variant: hasProblem ? "destructive" : undefined,
      });

      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks/admin"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks/pending-review"] });
    },
    onError: (err) => {
      toast({
        title: "Bulk delete failed",
        description: parseApiError(err, "Could not delete the selected wet checks."),
        variant: "destructive",
      });
      setShowBulkConfirm(false);
    },
  });

  return (
    <div className="max-w-6xl mx-auto py-6 space-y-4" data-testid="page-admin-wet-checks">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Droplets className="h-6 w-6 text-blue-600" />
          <h1 className="text-2xl font-semibold">Wet Checks</h1>
        </div>
        <Link href="/wet-checks/pending-review">
          <Button variant="outline" size="sm" data-testid="link-pending-review">Pending Review</Button>
        </Link>
      </div>

      <Card>
        <CardContent className="pt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search by customer, technician, address, or id"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8"
              data-testid="input-search-admin-wet-checks"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-56" data-testid="select-status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selectedIds.size > 0 && (
        <div
          className="flex flex-wrap items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3"
          data-testid="bulk-selection-toolbar"
        >
          <span className="text-sm font-medium text-blue-700" data-testid="text-bulk-selected-count">
            {selectedIds.size} selected
          </span>
          {bulkBlockedIds.size > 0 && (
            <span className="text-xs text-red-700" data-testid="text-bulk-conflict-count">
              {bulkBlockedIds.size} could not be deleted (downstream record on invoice)
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={clearSelection}
            className="text-blue-600 border-blue-300 hover:bg-blue-100 text-xs"
            data-testid="button-bulk-clear"
          >
            Clear
          </Button>
          <Button
            size="sm"
            onClick={() => setShowBulkConfirm(true)}
            className="bg-red-600 hover:bg-red-700 text-white ml-auto text-xs"
            disabled={bulkDeleteMutation.isPending}
            data-testid="button-bulk-delete"
          >
            <Trash2 className="w-3 h-3 mr-1" />
            Delete {selectedIds.size} Selected
          </Button>
        </div>
      )}

      {bulkBlockedDetails.length > 0 && (
        <div
          className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 space-y-2"
          data-testid="bulk-blocked-details"
        >
          <div className="font-medium">
            {bulkBlockedDetails.length} wet check{bulkBlockedDetails.length === 1 ? "" : "s"} blocked from delete
          </div>
          <ul className="space-y-2">
            {bulkBlockedDetails.map((d) => (
              <li
                key={d.id}
                className="rounded border border-red-100 bg-white px-3 py-2"
                data-testid={`bulk-blocked-${d.id}`}
              >
                <div className="text-xs font-medium text-red-700">
                  Wet check #{d.id}
                </div>
                <div className="text-xs text-gray-700" data-testid={`bulk-blocked-message-${d.id}`}>
                  {d.message}
                </div>
                {d.blockers.length > 0 && (
                  <ul
                    className="mt-1 list-disc list-inside text-xs text-gray-700"
                    data-testid={`bulk-blocked-list-${d.id}`}
                  >
                    {d.blockers.map((b, i) => (
                      <li
                        key={`${b.kind}-${b.id}-${i}`}
                        data-testid={`bulk-blocker-${d.id}-${b.kind}-${b.id}`}
                      >
                        {blockerLineLabel(b)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-gray-500">
          <Loader2 className="animate-spin h-5 w-5 mr-2" /> Loading wet checks…
        </div>
      ) : isError ? (
        <Card><CardContent className="py-8 text-center text-red-600">
          {parseApiError(error, "Failed to load wet checks.")}
        </CardContent></Card>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-gray-500">
          No wet checks match your filters.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-2 py-1 text-xs text-gray-600">
            <Checkbox
              checked={allVisibleSelected ? true : (someVisibleSelected ? "indeterminate" : false)}
              onCheckedChange={() => toggleSelectAllVisible()}
              aria-label="Select all visible wet checks"
              data-testid="checkbox-select-all"
            />
            <span>Select all {filtered.length} visible</span>
          </div>
          {filtered.map(row => (
            <Card
              key={row.id}
              data-testid={`card-wet-check-${row.id}`}
              className={bulkBlockedIds.has(row.id) ? "border-red-300" : undefined}
            >
              <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex-shrink-0 self-start sm:self-center pt-1">
                  <Checkbox
                    checked={selectedIds.has(row.id)}
                    onCheckedChange={() => toggleSelect(row.id)}
                    aria-label={`Select wet check ${row.id}`}
                    data-testid={`checkbox-select-${row.id}`}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{row.customerName}</span>
                    <Badge variant={statusBadgeVariant(row.status)} data-testid={`badge-status-${row.id}`}>
                      {row.status.replace(/_/g, " ")}
                    </Badge>
                    <span className="text-xs text-gray-500">#{row.id}</span>
                  </div>
                  <div className="text-sm text-gray-600 truncate">
                    {row.propertyAddress ?? "No address"} · Tech: {row.technicianName}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Started {fmtDate(row.startedAt)}
                    {row.submittedAt ? ` · Submitted ${fmtDate(row.submittedAt)}` : ""}
                    {row.approvedAt ? ` · Approved ${fmtDate(row.approvedAt)}` : ""}
                    {" · "}{row.zoneRecordCount} zones · {row.findingCount} findings · {row.photoCount} photos
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Link href={`/wet-checks/${row.id}/review`}>
                    <Button size="sm" variant="outline" data-testid={`button-view-${row.id}`}>
                      <Eye className="h-3 w-3 mr-1" /> View
                    </Button>
                  </Link>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={() => { setConflictMessage(null); setConflictBlockers([]); setPendingDelete(row); }}
                    data-testid={`button-delete-${row.id}`}
                  >
                    <Trash2 className="h-3 w-3 mr-1" /> Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

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
            <AlertDialogTitle>Delete this wet check?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? (
                <>
                  This permanently deletes wet check #{pendingDelete.id} for{" "}
                  <span className="font-medium">{pendingDelete.customerName}</span>{" "}
                  (started {fmtDate(pendingDelete.startedAt)}), including{" "}
                  {pendingDelete.zoneRecordCount} zone records, {pendingDelete.findingCount} findings,
                  and {pendingDelete.photoCount} photos, plus any billing sheets, estimates, or work
                  orders that were produced from its findings. This action cannot be undone.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {conflictMessage && (
            <div
              className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 space-y-1"
              data-testid="alert-delete-conflict"
            >
              <div>{conflictMessage}</div>
              {conflictBlockers.length > 0 && (
                <ul className="list-disc list-inside text-xs" data-testid="list-delete-blockers">
                  {conflictBlockers.map((b, i) => (
                    <li key={`${b.kind}-${b.id}-${i}`} data-testid={`blocker-${b.kind}-${b.id}`}>
                      {blockerLineLabel(b)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={deleteMutation.isPending || !!conflictMessage}
              onClick={(e) => {
                e.preventDefault();
                if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
              }}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? (
                <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Deleting…</>
              ) : "Delete wet check"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={showBulkConfirm}
        onOpenChange={(open) => { if (!open) setShowBulkConfirm(false); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} wet check{selectedIds.size === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the selected wet checks, including their zone records,
              findings, and photos, plus any billing sheets, estimates, or work orders that
              were produced from their findings. Wet checks whose downstream records are
              already on an invoice will be skipped and remain selected so you can review them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-bulk-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={bulkDeleteMutation.isPending || selectedIds.size === 0}
              onClick={(e) => {
                e.preventDefault();
                bulkDeleteMutation.mutate(Array.from(selectedIds));
              }}
              data-testid="button-confirm-bulk-delete"
            >
              {bulkDeleteMutation.isPending ? (
                <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Deleting…</>
              ) : `Delete ${selectedIds.size} wet check${selectedIds.size === 1 ? "" : "s"}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
