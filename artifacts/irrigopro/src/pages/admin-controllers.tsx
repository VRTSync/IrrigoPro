// Admin Controllers & Zones page (task #266; per-branch breakdown added in
// task #312).
//
// This page is intentionally backed by the `property_controllers` table — not
// the geographic `controllers` table that the site-map / KML flow owns. The
// `property_controllers` row is the per-customer / per-branch / per-controller
// record that `customers.totalControllers` already drives via
// `ensurePropertyControllers` and that the wet-check capture UI iterates over
// (one row per controller letter A–Z, with `zoneCount` = number of zones /
// stations on that controller). The geographic `controllers` table requires
// lat/long, model, serial number, etc., which are explicitly out of scope for
// this page; the site-maps page still owns that data.
//
// Per-branch UX: when a customer has no entries on `customers.branches`, the
// page shows the original single-row UX (one controllers count + one
// expandable letter list). When a customer has branches, the customer row
// expands into one sub-row per branch, each with its own count input and its
// own expandable letter list. NULL branchName == "no branch / customer-level".
import * as React from "react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { safeGet } from "@/utils/safeStorage";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageContainer, PageContent, PageHeader } from "@/components/ui/page-header";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Cpu, ChevronDown, ChevronRight, Loader2, Search,
} from "lucide-react";
import type { Customer, PropertyController } from "@workspace/db/schema";

const MAX_CONTROLLERS = 26;

type BranchGroup = { branchName: string | null; controllers: PropertyController[] };
type Row = { customer: Customer; branches: BranchGroup[] };

// Stable composite key for state buckets. NULL branch -> "" so the same key
// shape works for customer-level and branch-level rows.
function rowKey(customerId: number, branchName: string | null): string {
  return `${customerId}|${branchName ?? ""}`;
}
function zoneKey(customerId: number, branchName: string | null, letter: string): string {
  return `${rowKey(customerId, branchName)}|${letter}`;
}

export default function AdminControllers() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [userRole, setUserRole] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [search, setSearch] = useState("");
  // Customer-level expand toggle (shows the per-branch sub-rows or, for
  // non-branch customers, the single controller-letter list).
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  // Branch-level expand toggle (shows the controller-letter list inside a
  // specific branch sub-row). Keyed by `${customerId}|${branchName ?? ""}`.
  const [branchExpanded, setBranchExpanded] = useState<Record<string, boolean>>({});
  const [draftCounts, setDraftCounts] = useState<Record<string, number>>({});
  const [draftZones, setDraftZones] = useState<Record<string, number>>({});
  const [pendingCount, setPendingCount] = useState<{
    customerId: number;
    branchName: string | null;
    count: number;
    letters: string[];
  } | null>(null);

  // Resolve role once on mount, then redirect non-admins. Server enforces too.
  useEffect(() => {
    const u = safeGet("user");
    let role: string | null = null;
    if (u) {
      try { role = JSON.parse(u).role ?? null; } catch {}
    }
    setUserRole(role);
    setAuthChecked(true);
    if (role !== "company_admin" && role !== "super_admin") {
      navigate("/", { replace: true });
    }
  }, [navigate]);

  const isAdmin = userRole === "company_admin" || userRole === "super_admin";

  const { data, isLoading } = useQuery<Row[]>({
    queryKey: ["/api/admin/customer-controllers"],
    enabled: isAdmin,
  });

  const setCount = useMutation({
    mutationFn: async (vars: {
      customerId: number;
      branchName: string | null;
      count: number;
      confirm?: boolean;
    }) => {
      return await apiRequest(
        `/api/admin/customers/${vars.customerId}/controllers`,
        "PUT",
        {
          count: vars.count,
          confirmDeleteWithZones: vars.confirm ?? false,
          branchName: vars.branchName,
        },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/customer-controllers"] });
      qc.invalidateQueries({ queryKey: ["/api/customers"] });
      toast({ title: "Controllers updated" });
      setPendingCount(null);
    },
    onError: async (err: any, vars) => {
      // 409 -> requires confirmation
      const msg = err?.message ?? "";
      const m = msg.match(/^409:\s*(\{[\s\S]*\})$/);
      if (m) {
        try {
          const body = JSON.parse(m[1]);
          if (body?.requiresConfirmation && Array.isArray(body.letters)) {
            setPendingCount({
              customerId: vars.customerId,
              branchName: vars.branchName,
              count: vars.count,
              letters: body.letters,
            });
            return;
          }
        } catch {}
      }
      // Reset draft on failure so the displayed value matches reality
      setDraftCounts(prev => {
        const next = { ...prev };
        delete next[rowKey(vars.customerId, vars.branchName)];
        return next;
      });
      toast({ title: "Failed to update controllers", description: msg, variant: "destructive" });
    },
  });

  const setZones = useMutation({
    mutationFn: async (vars: {
      customerId: number;
      branchName: string | null;
      letter: string;
      zoneCount: number;
    }) => {
      return await apiRequest(
        `/api/admin/customers/${vars.customerId}/controllers/${vars.letter}/zones`,
        "PUT",
        { zoneCount: vars.zoneCount, branchName: vars.branchName },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/customer-controllers"] });
      toast({ title: "Zones updated" });
    },
    onError: (err: any, vars) => {
      setDraftZones(prev => {
        const next = { ...prev };
        delete next[zoneKey(vars.customerId, vars.branchName, vars.letter)];
        return next;
      });
      toast({ title: "Failed to update zones", description: err?.message, variant: "destructive" });
    },
  });

  // Non-admins are redirected away in the effect above; render nothing in
  // the meantime so no admin chrome flashes. Server enforces auth too.
  if (!authChecked || !isAdmin) {
    return null;
  }

  const rows = (data ?? []).filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.customer.name.toLowerCase().includes(q) ||
      (r.customer.irrigoName ?? "").toLowerCase().includes(q)
    );
  });

  const commitCount = (
    customerId: number,
    branchName: string | null,
    current: number,
  ) => {
    const k = rowKey(customerId, branchName);
    const draft = draftCounts[k];
    if (draft == null || draft === current) return;
    if (draft < 1 || draft > MAX_CONTROLLERS) {
      toast({ title: `Controllers must be 1–${MAX_CONTROLLERS}`, variant: "destructive" });
      setDraftCounts(prev => {
        const next = { ...prev }; delete next[k]; return next;
      });
      return;
    }
    setCount.mutate({ customerId, branchName, count: draft });
  };

  const commitZones = (
    customerId: number,
    branchName: string | null,
    letter: string,
    current: number,
  ) => {
    const key = zoneKey(customerId, branchName, letter);
    const draft = draftZones[key];
    if (draft == null || draft === current) return;
    if (draft < 0 || draft > 200) {
      toast({ title: "Zones must be 0–200", variant: "destructive" });
      setDraftZones(prev => {
        const next = { ...prev }; delete next[key]; return next;
      });
      return;
    }
    setZones.mutate({ customerId, branchName, letter, zoneCount: draft });
  };

  const isCountPending = (customerId: number, branchName: string | null) =>
    setCount.isPending &&
    setCount.variables?.customerId === customerId &&
    (setCount.variables?.branchName ?? null) === branchName;
  const isZonePending = (customerId: number, branchName: string | null, letter: string) =>
    setZones.isPending &&
    setZones.variables?.customerId === customerId &&
    (setZones.variables?.branchName ?? null) === branchName &&
    setZones.variables?.letter === letter;

  // Renders the controllers count input + the expandable letter-list block
  // for a single (customer, branch) bucket. Used both for the customer-level
  // single-row layout (no-branch customers) and for each branch sub-row.
  const renderCountAndZones = (
    customer: Customer,
    branch: BranchGroup,
    childExpanded: boolean,
    onToggleChild: () => void,
  ) => {
    const controllers = branch.controllers;
    const k = rowKey(customer.id, branch.branchName);
    // For sub-rows we don't have a customer.totalControllers signal — fall
    // back to the row count itself so the displayed value matches what is
    // persisted for that branch.
    const currentCount = branch.branchName === null
      ? (customer.totalControllers ?? controllers.length ?? 1)
      : (controllers.length || 1);
    const draftCount = draftCounts[k] ?? currentCount;
    return (
      <>
        <Input
          type="number"
          min={1}
          max={MAX_CONTROLLERS}
          value={draftCount}
          onChange={(e) => setDraftCounts(prev => ({
            ...prev,
            [k]: Math.max(1, Math.min(MAX_CONTROLLERS, Number(e.target.value) || 1)),
          }))}
          onBlur={() => commitCount(customer.id, branch.branchName, currentCount)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="w-20"
          disabled={isCountPending(customer.id, branch.branchName)}
          data-testid={
            branch.branchName === null
              ? `count-${customer.id}`
              : `count-${customer.id}-${branch.branchName}`
          }
        />
        {isCountPending(customer.id, branch.branchName) && (
          <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
        )}
      </>
    );
  };

  const renderZonesPanel = (customer: Customer, branch: BranchGroup) => {
    if (branch.controllers.length === 0) {
      return (
        <p className="text-sm text-slate-500">
          No controllers yet — set the controller count above to add them.
        </p>
      );
    }
    return (
      <div className="space-y-2 max-w-md">
        {branch.controllers.map(ctrl => {
          const key = zoneKey(customer.id, branch.branchName, ctrl.controllerLetter);
          const currentZones = ctrl.zoneCount ?? 0;
          const draftZ = draftZones[key] ?? currentZones;
          const testKey = branch.branchName === null
            ? `${customer.id}-${ctrl.controllerLetter}`
            : `${customer.id}-${branch.branchName}-${ctrl.controllerLetter}`;
          return (
            <div key={ctrl.id} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Controller {ctrl.controllerLetter}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Zones</span>
                <Input
                  type="number"
                  min={0}
                  max={200}
                  value={draftZ}
                  onChange={(e) => setDraftZones(prev => ({
                    ...prev,
                    [key]: Math.max(0, Math.min(200, Number(e.target.value) || 0)),
                  }))}
                  onBlur={() => commitZones(customer.id, branch.branchName, ctrl.controllerLetter, currentZones)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  className="w-20"
                  disabled={isZonePending(customer.id, branch.branchName, ctrl.controllerLetter)}
                  data-testid={`zones-${testKey}`}
                />
                {isZonePending(customer.id, branch.branchName, ctrl.controllerLetter) && (
                  <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <PageContainer>
      <PageHeader
        title="Controllers & Zones"
        subtitle="Set how many controllers each customer has and how many zones each controller covers"
      />
      <PageContent className="space-y-4">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
          <Input
            placeholder="Search customers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-12"
          />
        </div>

        {isLoading ? (
          <Card><CardContent className="p-8 text-center text-slate-500">Loading customers…</CardContent></Card>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Cpu className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">No customers found</h3>
              <p className="text-slate-500">
                {search ? "No customers match your search." : "There are no active customers to manage."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="w-44">Controllers</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ customer, branches }) => {
                    const isOpen = !!expanded[customer.id];
                    // A customer is treated as "branched" when the API
                    // returned a real branch entry (anything other than the
                    // single NULL bucket). For branched customers we show
                    // sub-rows; for non-branched we show the original
                    // inline single-row UX.
                    const hasBranches = branches.some(b => b.branchName !== null);
                    const customerLevel = branches.find(b => b.branchName === null);
                    return (
                      <React.Fragment key={`row-${customer.id}`}>
                        <TableRow className="border-b">
                          <TableCell>
                            <button
                              type="button"
                              onClick={() => setExpanded(prev => ({ ...prev, [customer.id]: !prev[customer.id] }))}
                              className="p-1 rounded hover:bg-slate-100"
                              aria-label={isOpen ? "Collapse" : "Expand"}
                              data-testid={`toggle-customer-${customer.id}`}
                            >
                              {isOpen
                                ? <ChevronDown className="w-4 h-4 text-slate-500" />
                                : <ChevronRight className="w-4 h-4 text-slate-500" />}
                            </button>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium text-slate-900">
                              {customer.irrigoName || customer.name}
                            </div>
                            {customer.irrigoName && customer.irrigoName !== customer.name && (
                              <div className="text-xs text-slate-500">{customer.name}</div>
                            )}
                            {hasBranches && (
                              <div className="text-xs text-slate-500 mt-0.5">
                                {branches.filter(b => b.branchName !== null).length} branch{branches.filter(b => b.branchName !== null).length === 1 ? "" : "es"}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            {hasBranches ? (
                              <span className="text-xs text-slate-500">Per-branch ↓</span>
                            ) : customerLevel ? (
                              <div className="flex items-center gap-2">
                                {renderCountAndZones(customer, customerLevel, isOpen, () => {})}
                              </div>
                            ) : null}
                          </TableCell>
                        </TableRow>
                        {isOpen && !hasBranches && customerLevel && (
                          <TableRow className="bg-slate-50">
                            <TableCell></TableCell>
                            <TableCell colSpan={2} className="py-3">
                              {renderZonesPanel(customer, customerLevel)}
                            </TableCell>
                          </TableRow>
                        )}
                        {isOpen && hasBranches && branches.map(branch => {
                          const bk = rowKey(customer.id, branch.branchName);
                          const branchOpen = !!branchExpanded[bk];
                          const label = branch.branchName === null
                            ? "Branch — (unassigned)"
                            : `Branch — ${branch.branchName}`;
                          return (
                            <React.Fragment key={`branch-${bk}`}>
                              <TableRow className="bg-slate-50 border-b border-slate-200">
                                <TableCell>
                                  <button
                                    type="button"
                                    onClick={() => setBranchExpanded(prev => ({ ...prev, [bk]: !prev[bk] }))}
                                    className="p-1 rounded hover:bg-slate-200 ml-3"
                                    aria-label={branchOpen ? "Collapse branch" : "Expand branch"}
                                    data-testid={`toggle-branch-${customer.id}-${branch.branchName ?? "unassigned"}`}
                                  >
                                    {branchOpen
                                      ? <ChevronDown className="w-4 h-4 text-slate-500" />
                                      : <ChevronRight className="w-4 h-4 text-slate-500" />}
                                  </button>
                                </TableCell>
                                <TableCell className="pl-6">
                                  <div className="text-sm font-medium text-slate-700">{label}</div>
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-2">
                                    {renderCountAndZones(customer, branch, branchOpen, () => {
                                      setBranchExpanded(prev => ({ ...prev, [bk]: !prev[bk] }));
                                    })}
                                  </div>
                                </TableCell>
                              </TableRow>
                              {branchOpen && (
                                <TableRow className="bg-slate-100/60">
                                  <TableCell></TableCell>
                                  <TableCell colSpan={2} className="py-3 pl-6">
                                    {renderZonesPanel(customer, branch)}
                                  </TableCell>
                                </TableRow>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </PageContent>

      <AlertDialog
        open={pendingCount !== null}
        onOpenChange={(open) => {
          if (!open) {
            // Cancel: reset the draft for that bucket
            if (pendingCount) {
              setDraftCounts(prev => {
                const next = { ...prev };
                delete next[rowKey(pendingCount.customerId, pendingCount.branchName)];
                return next;
              });
            }
            setPendingCount(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove controllers with zones?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingCount && (
                <>
                  Lowering the count
                  {pendingCount.branchName !== null && (
                    <> on <strong>{pendingCount.branchName}</strong></>
                  )}
                  {" "}will remove controller{pendingCount.letters.length > 1 ? "s" : ""}{" "}
                  <strong>{pendingCount.letters.join(", ")}</strong>, which still
                  {pendingCount.letters.length > 1 ? " have" : " has"} zones configured.
                  This cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingCount) return;
                setCount.mutate({
                  customerId: pendingCount.customerId,
                  branchName: pendingCount.branchName,
                  count: pendingCount.count,
                  confirm: true,
                });
              }}
            >
              Remove anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
