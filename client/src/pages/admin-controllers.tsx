// Admin Controllers & Zones page (task #266).
//
// This page is intentionally backed by the `property_controllers` table — not
// the geographic `controllers` table that the site-map / KML flow owns. The
// `property_controllers` row is the per-customer / per-controller record that
// `customers.totalControllers` already drives via `ensurePropertyControllers`
// and that the wet-check capture UI iterates over (one row per controller
// letter A–J, with `zoneCount` = number of zones / stations on that
// controller). The geographic `controllers` table requires lat/long, model,
// serial number, etc., which are explicitly out of scope for this page; the
// site-maps page still owns that data.
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
import type { Customer, PropertyController } from "@shared/schema";

type Row = { customer: Customer; controllers: PropertyController[] };

export default function AdminControllers() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [userRole, setUserRole] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [draftCounts, setDraftCounts] = useState<Record<number, number>>({});
  const [draftZones, setDraftZones] = useState<Record<string, number>>({});
  const [pendingCount, setPendingCount] = useState<{ customerId: number; count: number; letters: string[] } | null>(null);

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
    mutationFn: async (vars: { customerId: number; count: number; confirm?: boolean }) => {
      return await apiRequest(
        `/api/admin/customers/${vars.customerId}/controllers`,
        "PUT",
        { count: vars.count, confirmDeleteWithZones: vars.confirm ?? false },
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
            setPendingCount({ customerId: vars.customerId, count: vars.count, letters: body.letters });
            return;
          }
        } catch {}
      }
      // Reset draft on failure so the displayed value matches reality
      setDraftCounts(prev => {
        const next = { ...prev };
        delete next[vars.customerId];
        return next;
      });
      toast({ title: "Failed to update controllers", description: msg, variant: "destructive" });
    },
  });

  const setZones = useMutation({
    mutationFn: async (vars: { customerId: number; letter: string; zoneCount: number }) => {
      return await apiRequest(
        `/api/admin/customers/${vars.customerId}/controllers/${vars.letter}/zones`,
        "PUT",
        { zoneCount: vars.zoneCount },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/customer-controllers"] });
      toast({ title: "Zones updated" });
    },
    onError: (err: any, vars) => {
      setDraftZones(prev => {
        const next = { ...prev };
        delete next[`${vars.customerId}:${vars.letter}`];
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

  const commitCount = (customerId: number, current: number) => {
    const draft = draftCounts[customerId];
    if (draft == null || draft === current) return;
    if (draft < 1 || draft > 10) {
      toast({ title: "Controllers must be 1–10", variant: "destructive" });
      setDraftCounts(prev => {
        const next = { ...prev }; delete next[customerId]; return next;
      });
      return;
    }
    setCount.mutate({ customerId, count: draft });
  };

  const commitZones = (customerId: number, letter: string, current: number) => {
    const key = `${customerId}:${letter}`;
    const draft = draftZones[key];
    if (draft == null || draft === current) return;
    if (draft < 0 || draft > 200) {
      toast({ title: "Zones must be 0–200", variant: "destructive" });
      setDraftZones(prev => {
        const next = { ...prev }; delete next[key]; return next;
      });
      return;
    }
    setZones.mutate({ customerId, letter, zoneCount: draft });
  };

  const isCountPending = (customerId: number) =>
    setCount.isPending && setCount.variables?.customerId === customerId;
  const isZonePending = (customerId: number, letter: string) =>
    setZones.isPending && setZones.variables?.customerId === customerId &&
    setZones.variables?.letter === letter;

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
                  {rows.map(({ customer, controllers }) => {
                    const isOpen = !!expanded[customer.id];
                    const currentCount = customer.totalControllers ?? controllers.length ?? 1;
                    const draftCount = draftCounts[customer.id] ?? currentCount;
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
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Input
                                type="number"
                                min={1}
                                max={10}
                                value={draftCount}
                                onChange={(e) => setDraftCounts(prev => ({
                                  ...prev,
                                  [customer.id]: Math.max(1, Math.min(10, Number(e.target.value) || 1)),
                                }))}
                                onBlur={() => commitCount(customer.id, currentCount)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                }}
                                className="w-20"
                                disabled={isCountPending(customer.id)}
                                data-testid={`count-${customer.id}`}
                              />
                              {isCountPending(customer.id) && (
                                <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow className="bg-slate-50">
                            <TableCell></TableCell>
                            <TableCell colSpan={2} className="py-3">
                              {controllers.length === 0 ? (
                                <p className="text-sm text-slate-500">
                                  No controllers yet — set the controller count above to add them.
                                </p>
                              ) : (
                                <div className="space-y-2 max-w-md">
                                  {controllers.map(ctrl => {
                                    const key = `${customer.id}:${ctrl.controllerLetter}`;
                                    const currentZones = ctrl.zoneCount ?? 0;
                                    const draftZ = draftZones[key] ?? currentZones;
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
                                            onBlur={() => commitZones(customer.id, ctrl.controllerLetter, currentZones)}
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                            }}
                                            className="w-20"
                                            disabled={isZonePending(customer.id, ctrl.controllerLetter)}
                                            data-testid={`zones-${customer.id}-${ctrl.controllerLetter}`}
                                          />
                                          {isZonePending(customer.id, ctrl.controllerLetter) && (
                                            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
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
            // Cancel: reset the draft for that customer
            if (pendingCount) {
              setDraftCounts(prev => {
                const next = { ...prev }; delete next[pendingCount.customerId]; return next;
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
                  Lowering the count will remove controller{pendingCount.letters.length > 1 ? "s" : ""}{" "}
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
