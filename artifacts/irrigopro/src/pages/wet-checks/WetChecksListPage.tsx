import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Droplets, Trash2, Search } from "lucide-react";
import {
  apiRequest,
  queryClient,
  parseApiError,
  useArrayQuery,
  asArray,
} from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DismissibleHelp } from "@/components/shared/dismissible-help";
import { getCurrentUser } from "./helpers";
import { WetCheckFilterBar } from "@/components/wet-checks/wet-check-filter-bar";
import {
  WetCheckRow,
  type WetCheckListRow,
} from "@/components/wet-checks/wet-check-row";

type UserRole =
  | "super_admin"
  | "company_admin"
  | "irrigation_manager"
  | "billing_manager"
  | "field_tech";

function getDefaultStatus(role: UserRole): string {
  if (role === "irrigation_manager") return "submitted,pending_manager_review";
  if (role === "billing_manager") return "approved_passed_to_billing,billed";
  return "all";
}

function buildQueryUrl(statusFilter: string): string {
  if (statusFilter === "all") return "/api/wet-checks/admin";
  const statuses = statusFilter.split(",").filter(Boolean);
  if (statuses.length === 1) {
    return `/api/wet-checks/admin?status=${encodeURIComponent(statuses[0])}`;
  }
  return `/api/wet-checks/admin?${statuses.map((s) => `status=${encodeURIComponent(s)}`).join("&")}`;
}

function canBulkSelect(role: UserRole): boolean {
  return role === "company_admin" || role === "super_admin";
}

function canAdminActions(role: UserRole): boolean {
  return role === "company_admin" || role === "super_admin";
}

function showCompanyColumn(role: UserRole): boolean {
  return role === "super_admin";
}

type Blocker = {
  kind: "billing_sheet" | "estimate" | "work_order";
  id: number;
  displayNumber: string | null;
  invoiceId: number | null;
  invoiceNumber: string | null;
};

function blockerLineLabel(b: Blocker): string {
  const kindLabel =
    b.kind === "billing_sheet"
      ? "Billing sheet"
      : b.kind === "estimate"
        ? "Estimate"
        : "Work order";
  const recordLabel = b.displayNumber ?? `#${b.id}`;
  const invoiceLabel = b.invoiceNumber
    ? `Invoice ${b.invoiceNumber}`
    : b.invoiceId != null
      ? `Invoice #${b.invoiceId}`
      : "an invoice";
  return `${kindLabel} ${recordLabel} → ${invoiceLabel}`;
}

type BulkOutcome = {
  id: number;
  status: "deleted" | "blocked" | "not_found" | "error";
  message?: string;
  blockers?: Blocker[];
};

type BulkResponse = {
  results: BulkOutcome[];
  summary: {
    requested: number;
    deleted: number;
    blocked: number;
    notFound: number;
    failed: number;
  };
};

function hasActiveFilters(
  status: string,
  defaultStatus: string,
  customer: string,
  tech: string,
  company: string,
): boolean {
  return (
    status !== defaultStatus ||
    customer.trim() !== "" ||
    tech.trim() !== "" ||
    company !== "all"
  );
}

function WcEmptyStatePicker({ onPick }: { onPick: (customerId: number) => void }) {
  const [search, setSearch] = useState("");
  const { data: customers = [], isLoading } = useArrayQuery<{
    id: number;
    name: string;
    address: string | null;
  }>({
    queryKey: ["/api/customers", { active: true }],
    queryFn: () => apiRequest("/api/customers?active=true"),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.address ?? "").toLowerCase().includes(q),
    );
  }, [customers, search]);

  return (
    <div
      className="space-y-4 max-w-lg mx-auto py-8"
      data-testid="wc-empty-state-picker"
    >
      <div className="text-center space-y-2">
        <Droplets className="w-12 h-12 text-blue-200 mx-auto" />
        <h3 className="text-lg font-semibold text-gray-700">No wet checks yet</h3>
        <p className="text-sm text-gray-500">
          Select a customer below to start a new wet check.
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Search customers…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          data-testid="wc-empty-state-customer-search"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-4 text-gray-400">
          <Loader2 className="animate-spin h-5 w-5" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-sm text-gray-400">
          {search.trim() ? `No customers match "${search}"` : "No customers found."}
        </p>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto" data-testid="wc-empty-state-customer-list">
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => onPick(c.id)}
              className="w-full text-left rounded-lg border border-gray-200 bg-white px-4 py-3 hover:border-blue-400 hover:bg-blue-50 transition-colors"
              data-testid={`wc-empty-customer-${c.id}`}
            >
              <div className="font-medium text-gray-900 text-sm">{c.name}</div>
              {c.address && (
                <div className="text-xs text-gray-500 truncate">{c.address}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function WetChecksListPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const me = useMemo(() => getCurrentUser(), []);
  const role = (me?.role ?? "irrigation_manager") as UserRole;
  const defaultStatus = getDefaultStatus(role);

  const [statusFilter, setStatusFilter] = useState(defaultStatus);
  const [customerFilter, setCustomerFilter] = useState("");
  const [techFilter, setTechFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState("all");

  const [pendingDelete, setPendingDelete] = useState<WetCheckListRow | null>(null);
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

  const { data: rawData, isLoading, isError, error } = useQuery<WetCheckListRow[] | null>({
    queryKey,
    queryFn: async () => {
      const url = buildQueryUrl(statusFilter);
      try {
        return (await apiRequest(url, "GET")) as WetCheckListRow[];
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "";
        if (/^401:/.test(message)) return null;
        throw e;
      }
    },
  });

  const { data: companies = [] } = useArrayQuery<{ id: number; name: string }>({
    queryKey: ["/api/companies"],
    enabled: role === "super_admin",
    queryFn: async () => {
      try {
        return (await apiRequest("/api/companies", "GET")) as { id: number; name: string }[];
      } catch {
        return [];
      }
    },
  });

  const reloginNotifiedRef = useRef(false);
  useEffect(() => {
    if (rawData === null && !reloginNotifiedRef.current) {
      reloginNotifiedRef.current = true;
      toast({
        title: "Please sign in again",
        description: "Your session has expired.",
        variant: "destructive",
      });
      window.location.href = "/login";
    }
  }, [rawData, toast]);

  const rows = asArray<WetCheckListRow>(rawData);

  const filtered = useMemo(() => {
    const cq = customerFilter.trim().toLowerCase();
    const tq = techFilter.trim().toLowerCase();
    let out = rows;
    if (cq) {
      out = out.filter(
        (r) =>
          r.customerName.toLowerCase().includes(cq) ||
          (r.propertyAddress ?? "").toLowerCase().includes(cq) ||
          String(r.id).includes(cq),
      );
    }
    if (tq) {
      out = out.filter((r) => r.technicianName.toLowerCase().includes(tq));
    }
    if (companyFilter !== "all" && showCompanyColumn(role)) {
      out = out.filter((r) => (r.companyName ?? "") === companyFilter);
    }
    return out;
  }, [rows, customerFilter, techFilter, companyFilter, role]);

  const filtersActive = hasActiveFilters(
    statusFilter,
    defaultStatus,
    customerFilter,
    techFilter,
    companyFilter,
  );

  const visibleIds = useMemo(() => filtered.map((r) => r.id), [filtered]);
  const selectedVisibleCount = useMemo(
    () => visibleIds.filter((id) => selectedIds.has(id)).length,
    [visibleIds, selectedIds],
  );
  const allVisibleSelected =
    visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setBulkBlockedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
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

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["/api/wet-checks/admin"] });
    queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] });
    queryClient.invalidateQueries({ queryKey: ["/api/wet-checks/pending-review"] });
  }

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/wet-checks/${id}`, "DELETE"),
    onSuccess: () => {
      toast({ title: "Wet check deleted" });
      setPendingDelete(null);
      setConflictMessage(null);
      setConflictBlockers([]);
      invalidateAll();
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
        } catch { /* fall through */ }
        setConflictMessage(
          parsedMessage ?? parseApiError(err, "Cannot delete: a downstream record is on an invoice."),
        );
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

  const bulkDeleteMutation = useMutation<BulkResponse, unknown, number[]>({
    mutationFn: (ids: number[]) =>
      apiRequest("/api/wet-checks/bulk-delete", "DELETE", { ids }),
    onSuccess: (data) => {
      const { summary, results } = data;
      const blockedIds = new Set(
        results.filter((r) => r.status === "blocked").map((r) => r.id),
      );
      const remaining = new Set<number>();
      for (const r of results) {
        if (r.status !== "deleted" && r.status !== "not_found") remaining.add(r.id);
      }
      setSelectedIds(remaining);
      setBulkBlockedIds(blockedIds);
      setBulkBlockedDetails(
        results
          .filter((r) => r.status === "blocked")
          .map((r) => ({
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
      invalidateAll();
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

  const bulkEnabled = canBulkSelect(role);
  const adminActionsEnabled = canAdminActions(role);
  const companyColVisible = showCompanyColumn(role);

  const isEmptyNoFilters = !isLoading && !isError && rows.length === 0 && !filtersActive;
  const isEmptyWithFilters = !isLoading && !isError && filtered.length === 0 && filtersActive;

  return (
    <div className="max-w-6xl mx-auto py-6 space-y-4 px-4" data-testid="page-wet-checks-list">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Droplets className="h-6 w-6 text-blue-600" />
          <h1 className="text-2xl font-semibold">Wet Checks</h1>
        </div>
      </div>

      <DismissibleHelp guideId="wc-list-first-time">
        Use the filters below to find wet checks. For irrigation managers: submitted wet
        checks are awaiting your review. For billing: approved checks are ready to bill.
      </DismissibleHelp>

      <WetCheckFilterBar
        status={statusFilter}
        onStatusChange={setStatusFilter}
        customer={customerFilter}
        onCustomerChange={setCustomerFilter}
        tech={techFilter}
        onTechChange={setTechFilter}
        company={companyFilter}
        onCompanyChange={companyColVisible ? setCompanyFilter : undefined}
        companies={companies}
      />

      {selectedIds.size > 0 && bulkEnabled && (
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
              <li key={d.id} className="rounded border border-red-100 bg-white px-3 py-2">
                <div className="text-xs font-medium text-red-700">Wet check #{d.id}</div>
                <div className="text-xs text-gray-700">{d.message}</div>
                {d.blockers.length > 0 && (
                  <ul className="mt-1 list-disc list-inside text-xs text-gray-700">
                    {d.blockers.map((b, i) => (
                      <li key={`${b.kind}-${b.id}-${i}`}>{blockerLineLabel(b)}</li>
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
        <Card>
          <CardContent className="py-8 text-center text-red-600">
            {parseApiError(error, "Failed to load wet checks.")}
          </CardContent>
        </Card>
      ) : isEmptyNoFilters ? (
        <WcEmptyStatePicker onPick={(customerId) => navigate(`/wet-checks/c/${customerId}`)} />
      ) : isEmptyWithFilters ? (
        <Card>
          <CardContent className="py-12 text-center text-gray-500">
            No wet checks match your filters.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {bulkEnabled && filtered.length > 0 && (
            <div
              className="flex items-center gap-2 px-2 py-1 text-xs text-gray-600"
              data-testid="select-all-row"
            >
              <Checkbox
                checked={
                  allVisibleSelected
                    ? true
                    : someVisibleSelected
                      ? "indeterminate"
                      : false
                }
                onCheckedChange={() => toggleSelectAllVisible()}
                aria-label="Select all visible wet checks"
                data-testid="checkbox-wc-select-all"
              />
              <span>Select all {filtered.length} visible</span>
            </div>
          )}
          {companyColVisible && (
            <div
              className="hidden sm:flex items-center gap-4 px-2 py-1 text-xs font-medium text-gray-500 uppercase tracking-wide"
              data-testid="wc-list-company-col"
            >
              <span>Company</span>
            </div>
          )}
          {filtered.map((row) => (
            <WetCheckRow
              key={row.id}
              row={row}
              canSelect={bulkEnabled}
              selected={selectedIds.has(row.id)}
              onToggleSelect={() => toggleSelect(row.id)}
              onDelete={() => {
                setConflictMessage(null);
                setConflictBlockers([]);
                setPendingDelete(row);
              }}
              onReassign={() => {
                toast({
                  title: "Reassign technician",
                  description: "Select a technician from the wet check detail page.",
                });
              }}
              showCompanyCol={companyColVisible}
              canAdminActions={adminActionsEnabled}
              bulkBlocked={bulkBlockedIds.has(row.id)}
            />
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
            <AlertDialogCancel data-testid="button-cancel-wc-delete">
              {conflictMessage ? "Close" : "Cancel"}
            </AlertDialogCancel>
            {!conflictMessage && (
              <AlertDialogAction
                className="bg-red-600 hover:bg-red-700"
                disabled={deleteMutation.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
                }}
                data-testid="button-confirm-wc-delete"
              >
                {deleteMutation.isPending ? (
                  <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Deleting…</>
                ) : (
                  "Delete wet check"
                )}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={showBulkConfirm}
        onOpenChange={(open) => {
          if (!open) setShowBulkConfirm(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedIds.size} wet check{selectedIds.size === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the selected wet checks, including their zone records,
              findings, and photos, plus any billing sheets, estimates, or work orders produced
              from their findings. Wet checks whose downstream records are already on an invoice
              will be skipped and remain selected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-bulk-wc-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={bulkDeleteMutation.isPending || selectedIds.size === 0}
              onClick={(e) => {
                e.preventDefault();
                bulkDeleteMutation.mutate(Array.from(selectedIds));
              }}
              data-testid="button-confirm-bulk-wc-delete"
            >
              {bulkDeleteMutation.isPending ? (
                <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Deleting…</>
              ) : (
                `Delete ${selectedIds.size} wet check${selectedIds.size === 1 ? "" : "s"}`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
