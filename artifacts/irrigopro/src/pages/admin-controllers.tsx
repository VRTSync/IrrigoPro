// Admin Controllers & Zones page — single canonical source (Task #1653).
//
// Sourced exclusively from `irrigation_controllers` (the canonical table).
// Read: GET /api/irrigation-controllers/company-rollup
// Edit zone count / name: PUT /api/irrigation-controllers/:id
// Add controller:  POST /api/customers/:customerId/controllers-profile
// Remove controller: DELETE /api/irrigation-controllers/:id
//
// Access: company_admin and super_admin only (client + server guard).
import * as React from "react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { safeGet } from "@/utils/safeStorage";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { PageContainer, PageContent, PageHeader } from "@/components/ui/page-header";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Cpu, ChevronDown, ChevronRight, Loader2, Search, Pencil, Plus, Trash2,
} from "lucide-react";

type RollupCustomer = {
  id: number;
  name: string;
  irrigoName: string | null;
  companyId: number;
};

type RollupController = {
  id: number;
  name: string;
  totalZones: number | null;
  isActive: boolean;
  branchName: string | null | undefined;
  customerId: number;
  companyId: number;
};

type RollupRow = {
  customer: RollupCustomer;
  controllers: RollupController[];
};

const ROLLUP_KEY = ["/api/irrigation-controllers/company-rollup"] as const;

export default function AdminControllers() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [userRole, setUserRole] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  // Edit modal state
  const [editCtrl, setEditCtrl] = useState<RollupController | null>(null);
  const [editName, setEditName] = useState("");
  const [editZones, setEditZones] = useState<number>(0);

  // Add controller modal state
  const [addCustomer, setAddCustomer] = useState<RollupCustomer | null>(null);
  const [addName, setAddName] = useState("");
  const [addZones, setAddZones] = useState<number>(0);

  // Confirm-remove state
  const [removeCtrl, setRemoveCtrl] = useState<RollupController | null>(null);

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

  const { data, isLoading } = useQuery<RollupRow[]>({
    queryKey: ROLLUP_KEY,
    enabled: isAdmin,
  });

  const rows = (data ?? []).filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.customer.name.toLowerCase().includes(q) ||
      (r.customer.irrigoName ?? "").toLowerCase().includes(q)
    );
  });

  // Invalidate all irrigation-related queries so customer profile pages also
  // reflect name/zone-count changes made here without a full page reload.
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ROLLUP_KEY });
    qc.invalidateQueries({ queryKey: ["/api/irrigation-controllers"] });
    qc.invalidateQueries({ queryKey: ["/api/customers"] });
  };

  // ── Edit controller mutation ──────────────────────────────────────────────
  const editMutation = useMutation({
    mutationFn: async (vars: { id: number; name: string; totalZones: number }) => {
      return await apiRequest(`/api/irrigation-controllers/${vars.id}`, "PUT", {
        name: vars.name,
        totalZones: vars.totalZones,
      });
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Controller updated" });
      setEditCtrl(null);
    },
    onError: (err: any) => {
      toast({
        title: "Failed to update controller",
        description: err?.message,
        variant: "destructive",
      });
    },
  });

  // ── Add controller mutation ────────────────────────────────────────────────
  const addMutation = useMutation({
    mutationFn: async (vars: { customerId: number; name: string; totalZones: number }) => {
      return await apiRequest(
        `/api/customers/${vars.customerId}/controllers-profile`,
        "POST",
        { name: vars.name, totalZones: vars.totalZones },
      );
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Controller added" });
      setAddCustomer(null);
    },
    onError: (err: any) => {
      toast({
        title: "Failed to add controller",
        description: err?.message,
        variant: "destructive",
      });
    },
  });

  // ── Remove controller mutation ────────────────────────────────────────────
  const removeMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest(`/api/irrigation-controllers/${id}`, "DELETE");
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Controller removed" });
      setRemoveCtrl(null);
    },
    onError: (err: any) => {
      toast({
        title: "Failed to remove controller",
        description: err?.message,
        variant: "destructive",
      });
      setRemoveCtrl(null);
    },
  });

  if (!authChecked || !isAdmin) return null;

  const openEdit = (ctrl: RollupController) => {
    setEditCtrl(ctrl);
    setEditName(ctrl.name);
    setEditZones(ctrl.totalZones ?? 0);
  };

  const openAdd = (customer: RollupCustomer) => {
    setAddCustomer(customer);
    setAddName("");
    setAddZones(0);
  };

  const commitEdit = () => {
    if (!editCtrl) return;
    const name = editName.trim();
    if (!name) {
      toast({ title: "Controller name is required", variant: "destructive" });
      return;
    }
    if (editZones < 0 || editZones > 200) {
      toast({ title: "Zone count must be 0–200", variant: "destructive" });
      return;
    }
    editMutation.mutate({ id: editCtrl.id, name, totalZones: editZones });
  };

  const commitAdd = () => {
    if (!addCustomer) return;
    const name = addName.trim();
    if (!name) {
      toast({ title: "Controller name is required", variant: "destructive" });
      return;
    }
    if (addZones < 0 || addZones > 200) {
      toast({ title: "Zone count must be 0–200", variant: "destructive" });
      return;
    }
    addMutation.mutate({ customerId: addCustomer.id, name, totalZones: addZones });
  };

  return (
    <PageContainer>
      <PageHeader
        title="Controllers & Zones"
        subtitle="View and manage controller and zone configuration for each customer"
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
          <Card>
            <CardContent className="p-8 text-center text-slate-500">
              Loading customers…
            </CardContent>
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Cpu className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">No customers found</h3>
              <p className="text-slate-500">
                {search
                  ? "No customers match your search."
                  : "There are no active customers to manage."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Customer</TableHead>
                    <TableHead className="w-40">Controllers</TableHead>
                    <TableHead className="w-32 text-right pr-4">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ customer, controllers }) => {
                    const isOpen = !!expanded[customer.id];
                    const totalZonesAll = controllers.reduce(
                      (sum, c) => sum + (c.totalZones ?? 0),
                      0,
                    );
                    return (
                      <React.Fragment key={`row-${customer.id}`}>
                        <TableRow className="border-b">
                          <TableCell>
                            <button
                              type="button"
                              onClick={() =>
                                setExpanded((prev) => ({
                                  ...prev,
                                  [customer.id]: !prev[customer.id],
                                }))
                              }
                              className="p-1 rounded hover:bg-slate-100"
                              aria-label={isOpen ? "Collapse" : "Expand"}
                              data-testid={`toggle-customer-${customer.id}`}
                            >
                              {isOpen ? (
                                <ChevronDown className="w-4 h-4 text-slate-500" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-slate-500" />
                              )}
                            </button>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium text-slate-900">
                              {customer.irrigoName || customer.name}
                            </div>
                            {customer.irrigoName &&
                              customer.irrigoName !== customer.name && (
                                <div className="text-xs text-slate-500">{customer.name}</div>
                              )}
                          </TableCell>
                          <TableCell>
                            <div className="text-sm text-slate-600">
                              {controllers.length} controller
                              {controllers.length !== 1 ? "s" : ""},{" "}
                              {totalZonesAll} zone
                              {totalZonesAll !== 1 ? "s" : ""}
                            </div>
                          </TableCell>
                          <TableCell className="text-right pr-4">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openAdd(customer)}
                              data-testid={`add-ctrl-${customer.id}`}
                            >
                              <Plus className="w-4 h-4 mr-1" />
                              Add
                            </Button>
                          </TableCell>
                        </TableRow>

                        {isOpen && (
                          <TableRow className="bg-slate-50">
                            <TableCell />
                            <TableCell colSpan={3} className="py-3 pr-4">
                              {controllers.length === 0 ? (
                                <p className="text-sm text-slate-500 italic">
                                  No controllers yet — click Add to create one.
                                </p>
                              ) : (
                                <div className="space-y-2 max-w-xl">
                                  {controllers.map((ctrl) => (
                                    <div
                                      key={ctrl.id}
                                      className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2"
                                    >
                                      <div className="flex items-center gap-2 min-w-0">
                                        <Badge variant="secondary" className="shrink-0">
                                          {ctrl.name}
                                        </Badge>
                                        {ctrl.branchName ? (
                                          <span className="text-xs text-slate-400 truncate">
                                            {ctrl.branchName}
                                          </span>
                                        ) : null}
                                      </div>
                                      <div className="flex items-center gap-3 shrink-0">
                                        <span className="text-sm text-slate-600">
                                          {ctrl.totalZones ?? 0} zone
                                          {(ctrl.totalZones ?? 0) !== 1 ? "s" : ""}
                                        </span>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => openEdit(ctrl)}
                                          data-testid={`edit-ctrl-${ctrl.id}`}
                                        >
                                          <Pencil className="w-3.5 h-3.5" />
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                          onClick={() => setRemoveCtrl(ctrl)}
                                          data-testid={`remove-ctrl-${ctrl.id}`}
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </Button>
                                      </div>
                                    </div>
                                  ))}
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

      {/* ── Edit controller modal ─────────────────────────────────────────── */}
      <Dialog open={editCtrl !== null} onOpenChange={(open) => { if (!open) setEditCtrl(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Controller</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Controller name</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); }}
                placeholder="e.g. Controller A"
                data-testid="edit-ctrl-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-zones">Zone count</Label>
              <Input
                id="edit-zones"
                type="number"
                min={0}
                max={200}
                value={editZones}
                onChange={(e) =>
                  setEditZones(Math.max(0, Math.min(200, Number(e.target.value) || 0)))
                }
                onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); }}
                data-testid="edit-ctrl-zones"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditCtrl(null)}>
              Cancel
            </Button>
            <Button onClick={commitEdit} disabled={editMutation.isPending}>
              {editMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add controller modal ──────────────────────────────────────────── */}
      <Dialog open={addCustomer !== null} onOpenChange={(open) => { if (!open) setAddCustomer(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Add Controller
              {addCustomer && (
                <span className="font-normal text-slate-500 ml-2 text-base">
                  — {addCustomer.irrigoName || addCustomer.name}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="add-name">Controller name</Label>
              <Input
                id="add-name"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commitAdd(); }}
                placeholder="e.g. Controller A"
                data-testid="add-ctrl-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-zones">Zone count</Label>
              <Input
                id="add-zones"
                type="number"
                min={0}
                max={200}
                value={addZones}
                onChange={(e) =>
                  setAddZones(Math.max(0, Math.min(200, Number(e.target.value) || 0)))
                }
                onKeyDown={(e) => { if (e.key === "Enter") commitAdd(); }}
                data-testid="add-ctrl-zones"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddCustomer(null)}>
              Cancel
            </Button>
            <Button onClick={commitAdd} disabled={addMutation.isPending}>
              {addMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Add Controller
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Remove confirm dialog ─────────────────────────────────────────── */}
      <AlertDialog
        open={removeCtrl !== null}
        onOpenChange={(open) => { if (!open) setRemoveCtrl(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove controller?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeCtrl && (
                <>
                  <strong>{removeCtrl.name}</strong>
                  {(removeCtrl.totalZones ?? 0) > 0 && (
                    <> has{" "}
                      <strong>
                        {removeCtrl.totalZones} zone
                        {removeCtrl.totalZones !== 1 ? "s" : ""}
                      </strong>{" "}
                      configured.{" "}
                    </>
                  )}
                  {" "}This will permanently remove the controller from the irrigation profile
                  and cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (!removeCtrl) return;
                removeMutation.mutate(removeCtrl.id);
              }}
            >
              {removeMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
