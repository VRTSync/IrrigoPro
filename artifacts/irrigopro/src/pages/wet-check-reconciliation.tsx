import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Droplets,
  Loader2,
  RefreshCw,
  UserCheck,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth-context";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReconciliationRow {
  wetCheckId: number;
  wetCheckStatus: string;
  wetCheckStartedAt: string;
  wetCheckCompanyId: number;
  customerId: number;
  customerName: string;
  propertyAddress: string | null;
  technicianId: number;
  technicianName: string;
  wcbId: number;
  billingNumber: string;
  branchName: string | null;
  wcbStatus: string;
  workDate: string;
  totalAmount: string;
  invoiceId: number | null;
}

interface CustomerOption {
  id: number;
  name: string;
  companyId: number;
  address: string | null;
  branches: string[] | null;
  hiddenFromBilling: boolean;
}

interface ReassignResult {
  wetCheckId: number;
  moved: number[];
  skipped: { id: number; billingNumber: string; reason: string }[];
  warnings: {
    message: string;
    derivedWorkOrderIds: number[];
    derivedEstimateIds: number[];
  } | null;
  targetCustomer: { id: number; name: string; companyId: number };
}

// ── Status chips ──────────────────────────────────────────────────────────────

function WetCheckStatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    in_progress: { label: "In Progress", variant: "secondary" },
    submitted: { label: "Submitted", variant: "default" },
    approved: { label: "Approved", variant: "default" },
    partially_converted: { label: "Partial", variant: "outline" },
    converted: { label: "Converted", variant: "outline" },
  };
  const cfg = map[status] ?? { label: status, variant: "secondary" as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function WcbStatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    submitted: { label: "Submitted", variant: "secondary" },
    pending_manager_review: { label: "Needs Review", variant: "default" },
    approved_passed_to_billing: { label: "Ready to Bill", variant: "default" },
    billed: { label: "Billed", variant: "outline" },
  };
  const cfg = map[status] ?? { label: status, variant: "secondary" as const };
  return <Badge variant={cfg.variant} className="text-xs">{cfg.label}</Badge>;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function toDateInputValue(d: Date): string {
  return d.toISOString().split("T")[0];
}

function defaultFrom(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

function fmtAmount(amount: string | null | undefined): string {
  if (!amount) return "$0.00";
  const n = parseFloat(amount);
  return isNaN(n) ? "$0.00" : `$${n.toFixed(2)}`;
}

// ── Grouped structure ─────────────────────────────────────────────────────────

interface GroupKey {
  customerId: number;
  customerName: string;
  branchName: string | null;
}

interface Group extends GroupKey {
  rows: ReconciliationRow[];
  subtotal: number;
}

function groupRows(rows: ReconciliationRow[]): Group[] {
  const map = new Map<string, Group>();
  for (const row of rows) {
    const key = `${row.customerId}||${row.branchName ?? ""}`;
    if (!map.has(key)) {
      map.set(key, {
        customerId: row.customerId,
        customerName: row.customerName,
        branchName: row.branchName,
        rows: [],
        subtotal: 0,
      });
    }
    const g = map.get(key)!;
    g.rows.push(row);
    g.subtotal += parseFloat(row.totalAmount) || 0;
  }
  return Array.from(map.values());
}

// ── Reassign Modal ─────────────────────────────────────────────────────────────

interface ReassignModalProps {
  row: ReconciliationRow | null;
  onClose: () => void;
  onSuccess: () => void;
}

function ReassignModal({ row, onClose, onSuccess }: ReassignModalProps) {
  const { toast } = useToast();
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [selectedBranch, setSelectedBranch] = useState<string>("__none__");
  const [lastResult, setLastResult] = useState<ReassignResult | null>(null);

  const { data: customers = [] } = useQuery<CustomerOption[]>({
    queryKey: ["/api/customers"],
    enabled: !!row,
  });

  const billingVisibleCustomers = useMemo(
    () => customers.filter((c) => !c.hiddenFromBilling),
    [customers],
  );

  const targetCustomer = useMemo(
    () => billingVisibleCustomers.find((c) => c.id === Number(selectedCustomerId)),
    [billingVisibleCustomers, selectedCustomerId],
  );

  const branches = useMemo(
    () => (targetCustomer?.branches ?? []).filter(Boolean),
    [targetCustomer],
  );

  const reassign = useMutation<ReassignResult, Error>({
    mutationFn: async () => {
      if (!row || !selectedCustomerId) throw new Error("No customer selected");
      const body: { customerId: number; branchName?: string } = {
        customerId: Number(selectedCustomerId),
      };
      if (selectedBranch && selectedBranch !== "__none__") {
        body.branchName = selectedBranch;
      }
      const result = await apiRequest(`/api/wet-checks/${row.wetCheckId}/reassign-customer`, "POST", body);
      return result as ReassignResult;
    },
    onSuccess: (result) => {
      setLastResult(result);
      toast({
        title: "Reassigned",
        description: `${result.moved.length} snapshot(s) moved to ${result.targetCustomer.name}.`,
      });
      onSuccess();
    },
    onError: (err) => {
      toast({ title: "Reassignment failed", description: err.message, variant: "destructive" });
    },
  });

  if (!row) return null;

  const isDifferentCompany =
    targetCustomer && targetCustomer.companyId !== row.wetCheckCompanyId;

  return (
    <Dialog open={!!row} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-blue-600" />
            Reassign Wet Check #{row.wetCheckId}
          </DialogTitle>
          <DialogDescription>
            Move this wet check and its unbilled snapshots to a different customer.
          </DialogDescription>
        </DialogHeader>

        {lastResult ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-5 w-5" />
              <span className="font-medium">Reassignment complete</span>
            </div>
            <p className="text-sm text-gray-600">
              {lastResult.moved.length} snapshot(s) moved to{" "}
              <strong>{lastResult.targetCustomer.name}</strong>.
              {lastResult.skipped.length > 0 &&
                ` ${lastResult.skipped.length} snapshot(s) were skipped (already invoiced).`}
            </p>
            {lastResult.warnings && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  {lastResult.warnings.message}
                  {lastResult.warnings.derivedWorkOrderIds.length > 0 && (
                    <div className="mt-1">
                      Work Orders:{" "}
                      {lastResult.warnings.derivedWorkOrderIds.map((id) => `#${id}`).join(", ")}
                    </div>
                  )}
                  {lastResult.warnings.derivedEstimateIds.length > 0 && (
                    <div className="mt-1">
                      Estimates:{" "}
                      {lastResult.warnings.derivedEstimateIds.map((id) => `#${id}`).join(", ")}
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            )}
            <Button onClick={onClose} className="w-full">Close</Button>
          </div>
        ) : (
          <>
            {/* Current → New diff panel */}
            <div className="rounded-md border bg-gray-50 p-3 text-sm space-y-1">
              <div className="font-medium text-gray-700 mb-2">Current assignment</div>
              <div className="flex items-start gap-2">
                <span className="text-gray-500 w-20 shrink-0">Customer</span>
                <span>{row.customerName}</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-gray-500 w-20 shrink-0">Branch</span>
                <span>{row.branchName ?? "—"}</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-gray-500 w-20 shrink-0">Address</span>
                <span>{row.propertyAddress ?? "—"}</span>
              </div>
            </div>

            {targetCustomer && (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <ArrowRight className="h-4 w-4 text-blue-500 shrink-0" />
                <div className="rounded-md border border-blue-200 bg-blue-50 p-2 flex-1 space-y-0.5">
                  <div><span className="text-gray-500">Customer: </span>{targetCustomer.name}</div>
                  {selectedBranch && selectedBranch !== "__none__" && (
                    <div><span className="text-gray-500">Branch: </span>{selectedBranch}</div>
                  )}
                  <div><span className="text-gray-500">Address: </span>{targetCustomer.address ?? "—"}</div>
                  {isDifferentCompany && (
                    <div className="text-amber-700">
                      ⚠ Different company — companyId will be corrected to match target.
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Target customer</Label>
                <Select
                  value={selectedCustomerId}
                  onValueChange={(v) => {
                    setSelectedCustomerId(v);
                    setSelectedBranch("__none__");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a billing-visible customer…" />
                  </SelectTrigger>
                  <SelectContent>
                    {billingVisibleCustomers.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {branches.length > 0 && (
                <div className="space-y-1">
                  <Label>Branch (optional)</Label>
                  <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                    <SelectTrigger>
                      <SelectValue placeholder="No branch" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— No branch —</SelectItem>
                      {branches.map((b) => (
                        <SelectItem key={b} value={b}>{b}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={reassign.isPending}>
                Cancel
              </Button>
              <Button
                disabled={!selectedCustomerId || reassign.isPending}
                onClick={() => reassign.mutate()}
              >
                {reassign.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Confirm Reassignment
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function WetCheckReconciliationPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [from, setFrom] = useState(() => toDateInputValue(defaultFrom()));
  const [to, setTo] = useState(() => toDateInputValue(new Date()));
  const [pendingFrom, setPendingFrom] = useState(from);
  const [pendingTo, setPendingTo] = useState(to);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [reassignRow, setReassignRow] = useState<ReconciliationRow | null>(null);

  // Guard: only company_admin and super_admin should reach this page.
  if (user && user.role !== "company_admin" && user.role !== "super_admin") {
    return (
      <div className="p-6">
        <Alert>
          <XCircle className="h-4 w-4" />
          <AlertDescription>Access denied — company admin or super admin required.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const queryKey = ["/api/admin/wet-check-reconciliation", from, to];

  const { data: rows = [], isLoading, isError, refetch } = useQuery<ReconciliationRow[]>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ from, to });
      return apiRequest(`/api/admin/wet-check-reconciliation?${params}`, "GET");
    },
  });

  const groups = useMemo(() => groupRows(rows), [rows]);
  const globalTotal = useMemo(
    () => groups.reduce((sum, g) => sum + g.subtotal, 0),
    [groups],
  );

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function groupKey(g: Group): string {
    return `${g.customerId}||${g.branchName ?? ""}`;
  }

  function handleApply() {
    setFrom(pendingFrom);
    setTo(pendingTo);
  }

  function handleReassignSuccess() {
    qc.invalidateQueries({ queryKey });
  }

  return (
    <div className="max-w-6xl mx-auto py-6 px-4 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
            <Droplets className="h-6 w-6 text-blue-600" />
            Wet Check Reconciliation
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Unbilled wet check snapshots grouped by customer and branch. Use Reassign to fix
            mis-assignments.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Date range picker */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-gray-500">From</Label>
              <Input
                type="date"
                value={pendingFrom}
                onChange={(e) => setPendingFrom(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-gray-500">To</Label>
              <Input
                type="date"
                value={pendingTo}
                onChange={(e) => setPendingTo(e.target.value)}
                className="w-40"
              />
            </div>
            <Button size="sm" onClick={handleApply} disabled={isLoading}>
              <CalendarDays className="h-4 w-4 mr-2" />
              Apply
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {isLoading && (
        <div className="flex items-center justify-center py-12 text-gray-500">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          Loading…
        </div>
      )}

      {isError && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>Failed to load reconciliation data. Please try again.</AlertDescription>
        </Alert>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-gray-500">
            <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
            <p>No unbilled wet check snapshots found in this date range.</p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <div className="space-y-3">
          {/* Global summary */}
          <div className="flex items-center justify-between text-sm text-gray-600 px-1">
            <span>
              {rows.length} snapshot{rows.length !== 1 ? "s" : ""} across {groups.length} group
              {groups.length !== 1 ? "s" : ""}
            </span>
            <span className="font-semibold text-gray-800">
              Global total: ${globalTotal.toFixed(2)}
            </span>
          </div>

          {/* Groups */}
          {groups.map((g) => {
            const key = groupKey(g);
            const isExpanded = expandedGroups.has(key);
            return (
              <Card key={key} className="overflow-hidden">
                {/* Group header */}
                <button
                  className="w-full text-left"
                  onClick={() => toggleGroup(key)}
                >
                  <CardHeader className="py-3 px-4 flex flex-row items-center justify-between hover:bg-gray-50 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 truncate">
                          {g.customerName}
                          {g.branchName && (
                            <span className="text-gray-500 font-normal ml-1">
                              — {g.branchName}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500">
                          {g.rows.length} snapshot{g.rows.length !== 1 ? "s" : ""}
                        </div>
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-gray-800 shrink-0">
                      ${g.subtotal.toFixed(2)}
                    </div>
                  </CardHeader>
                </button>

                {isExpanded && (
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-t bg-gray-50 text-xs text-gray-500 uppercase">
                            <th className="text-left px-4 py-2 font-medium">WC #</th>
                            <th className="text-left px-4 py-2 font-medium">Billing #</th>
                            <th className="text-left px-4 py-2 font-medium">Address</th>
                            <th className="text-left px-4 py-2 font-medium">WC Status</th>
                            <th className="text-left px-4 py-2 font-medium">Snapshot</th>
                            <th className="text-left px-4 py-2 font-medium">Date</th>
                            <th className="text-right px-4 py-2 font-medium">Amount</th>
                            <th className="text-left px-4 py-2 font-medium">Tech</th>
                            <th className="px-4 py-2" />
                          </tr>
                        </thead>
                        <tbody>
                          {g.rows.map((row) => (
                            <tr
                              key={row.wcbId}
                              className="border-t hover:bg-gray-50 transition-colors"
                            >
                              <td className="px-4 py-2 whitespace-nowrap">
                                <a
                                  href={`/wet-checks/${row.wetCheckId}`}
                                  className="text-blue-600 hover:underline font-medium"
                                >
                                  #{row.wetCheckId}
                                </a>
                              </td>
                              <td className="px-4 py-2 text-gray-600 whitespace-nowrap text-xs">
                                {row.billingNumber}
                              </td>
                              <td className="px-4 py-2 text-gray-700 max-w-[180px] truncate">
                                {row.propertyAddress ?? "—"}
                              </td>
                              <td className="px-4 py-2">
                                <WetCheckStatusChip status={row.wetCheckStatus} />
                              </td>
                              <td className="px-4 py-2">
                                <WcbStatusChip status={row.wcbStatus} />
                              </td>
                              <td className="px-4 py-2 whitespace-nowrap text-gray-600">
                                {fmtDate(row.workDate)}
                              </td>
                              <td className="px-4 py-2 text-right whitespace-nowrap font-medium">
                                {fmtAmount(row.totalAmount)}
                              </td>
                              <td className="px-4 py-2 text-gray-600 whitespace-nowrap text-xs">
                                {row.technicianName}
                              </td>
                              <td className="px-4 py-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() => setReassignRow(row)}
                                >
                                  Reassign
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <ReassignModal
        row={reassignRow}
        onClose={() => setReassignRow(null)}
        onSuccess={handleReassignSuccess}
      />
    </div>
  );
}
