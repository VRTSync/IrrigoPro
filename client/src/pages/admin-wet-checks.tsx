import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, parseApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  const [pendingDelete, setPendingDelete] = useState<AdminWetCheckRow | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

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

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest(`/api/wet-checks/${id}`, "DELETE");
    },
    onSuccess: () => {
      toast({ title: "Wet check deleted", description: "All zones, findings and photos were removed." });
      setPendingDelete(null);
      setConflictMessage(null);
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks/admin"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks/pending-review"] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      // 409 → keep dialog open and surface inline; everything else dismisses.
      if (/^409:/.test(message)) {
        setConflictMessage(parseApiError(err, "Cannot delete: one or more findings have already been routed."));
        return;
      }
      toast({
        title: "Delete failed",
        description: parseApiError(err, "Could not delete wet check."),
        variant: "destructive",
      });
      setPendingDelete(null);
      setConflictMessage(null);
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
          {filtered.map(row => (
            <Card key={row.id} data-testid={`card-wet-check-${row.id}`}>
              <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
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
                    onClick={() => { setConflictMessage(null); setPendingDelete(row); }}
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
                  and {pendingDelete.photoCount} photos. This action cannot be undone.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {conflictMessage && (
            <div
              className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              data-testid="alert-delete-conflict"
            >
              {conflictMessage}
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
    </div>
  );
}
