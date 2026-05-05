import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, parseApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { safeGet } from "@/utils/safeStorage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, Plus, ArrowUp, ArrowDown, Save, RotateCcw, Wrench } from "lucide-react";
import type { IssueTypeConfig } from "@shared/schema";

type GroupValue = "quick_fix" | "advanced" | "zone_issue";
const GROUP_OPTIONS: ReadonlyArray<{ value: GroupValue; label: string }> = [
  { value: "quick_fix", label: "Quick Fix" },
  { value: "advanced", label: "Advanced" },
  { value: "zone_issue", label: "Zone Issue" },
];

function groupLabel(g: string): string {
  return GROUP_OPTIONS.find(o => o.value === g)?.label ?? g;
}

type EditState = {
  displayLabel: string;
  issueGroup: GroupValue;
  defaultLaborHours: string;
  partCategoryFilter: string;
};

function toEdit(row: IssueTypeConfig): EditState {
  return {
    displayLabel: row.displayLabel,
    issueGroup: row.issueGroup as GroupValue,
    defaultLaborHours: String(row.defaultLaborHours ?? "0"),
    partCategoryFilter: row.partCategoryFilter ?? "",
  };
}

export default function AdminIssueTypesPage() {
  const { toast } = useToast();
  const userRole = (() => {
    try { return JSON.parse(safeGet("user") || "{}").role as string | undefined; }
    catch { return undefined; }
  })();
  const allowed = userRole === "company_admin" || userRole === "billing_manager";

  const queryKey = ["/api/admin/issue-types"] as const;

  const { data, isLoading, isError, error } = useQuery<IssueTypeConfig[]>({
    queryKey,
    enabled: allowed,
  });

  // Local copy so reordering can be optimistic.
  const [orderedIds, setOrderedIds] = useState<number[] | null>(null);
  const [editing, setEditing] = useState<Record<number, EditState>>({});
  const [showAdd, setShowAdd] = useState(false);

  // Reset orderedIds when fresh data arrives
  useEffect(() => {
    if (data) setOrderedIds(data.map(r => r.id));
  }, [data]);

  const rowsById = useMemo(() => {
    const map = new Map<number, IssueTypeConfig>();
    for (const r of data ?? []) map.set(r.id, r);
    return map;
  }, [data]);

  const orderedRows = useMemo<IssueTypeConfig[]>(() => {
    if (!data) return [];
    if (!orderedIds) return data;
    return orderedIds.map(id => rowsById.get(id)).filter((r): r is IssueTypeConfig => !!r);
  }, [data, orderedIds, rowsById]);

  const reorderDirty = useMemo(() => {
    if (!data || !orderedIds) return false;
    if (data.length !== orderedIds.length) return true;
    return data.some((r, i) => r.id !== orderedIds[i]);
  }, [data, orderedIds]);

  const updateMut = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<EditState> & { isActive?: boolean } }) => {
      const body: Record<string, unknown> = { ...patch };
      if ("partCategoryFilter" in body) {
        const v = String(body.partCategoryFilter ?? "").trim();
        body.partCategoryFilter = v === "" ? null : v;
      }
      return apiRequest(`/api/admin/issue-types/${id}`, "PATCH", body);
    },
    onSuccess: (_d, vars) => {
      toast({ title: "Saved" });
      setEditing(prev => {
        const next = { ...prev };
        delete next[vars.id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks/issue-types"] });
    },
    onError: (err) => {
      toast({
        title: "Save failed",
        description: parseApiError(err, "Could not update issue type."),
        variant: "destructive",
      });
    },
  });

  const reorderMut = useMutation({
    mutationFn: (ids: number[]) =>
      apiRequest("/api/admin/issue-types/reorder", "POST", { orderedIds: ids }),
    onSuccess: () => {
      toast({ title: "Order saved" });
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks/issue-types"] });
    },
    onError: (err) => {
      toast({
        title: "Reorder failed",
        description: parseApiError(err, "Could not save the new order."),
        variant: "destructive",
      });
    },
  });

  const moveRow = (idx: number, dir: -1 | 1) => {
    if (!orderedIds) return;
    const target = idx + dir;
    if (target < 0 || target >= orderedIds.length) return;
    const next = [...orderedIds];
    [next[idx], next[target]] = [next[target], next[idx]];
    setOrderedIds(next);
  };

  const startEdit = (row: IssueTypeConfig) => {
    setEditing(prev => ({ ...prev, [row.id]: toEdit(row) }));
  };

  const cancelEdit = (id: number) => {
    setEditing(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const onSaveEdit = (row: IssueTypeConfig) => {
    const edit = editing[row.id];
    if (!edit) return;
    const hrs = parseFloat(edit.defaultLaborHours);
    if (!edit.displayLabel.trim()) {
      toast({ title: "Label is required", variant: "destructive" });
      return;
    }
    if (Number.isNaN(hrs) || hrs < 0) {
      toast({ title: "Labor hours must be a non-negative number", variant: "destructive" });
      return;
    }
    updateMut.mutate({ id: row.id, patch: edit });
  };

  if (!allowed) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center text-gray-500" data-testid="admin-issue-types-forbidden">
        You do not have access to this page.
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto py-6 space-y-4" data-testid="page-admin-issue-types">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Wrench className="h-6 w-6 text-blue-600" />
          <h1 className="text-2xl font-semibold">Wet Check Issue Types</h1>
        </div>
        <div className="flex items-center gap-2">
          {reorderDirty && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOrderedIds(data ? data.map(r => r.id) : null)}
                data-testid="button-reorder-cancel"
              >
                <RotateCcw className="h-3 w-3 mr-1" /> Reset order
              </Button>
              <Button
                size="sm"
                onClick={() => orderedIds && reorderMut.mutate(orderedIds)}
                disabled={reorderMut.isPending}
                data-testid="button-reorder-save"
              >
                {reorderMut.isPending ? (
                  <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Saving…</>
                ) : (<><Save className="h-3 w-3 mr-1" /> Save order</>)}
              </Button>
            </>
          )}
          <Button size="sm" onClick={() => setShowAdd(true)} data-testid="button-add-issue-type">
            <Plus className="h-3 w-3 mr-1" /> Add issue type
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Defaults applied to new wet-check findings for your company.
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-gray-500">
              <Loader2 className="animate-spin h-5 w-5 mr-2" /> Loading issue types…
            </div>
          ) : isError ? (
            <div className="py-8 text-center text-red-600">
              {parseApiError(error, "Failed to load issue types.")}
            </div>
          ) : orderedRows.length === 0 ? (
            <div className="py-12 text-center text-gray-500">
              No issue types yet. Add one to get started.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Order</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead>Group</TableHead>
                    <TableHead className="w-28">Labor hrs</TableHead>
                    <TableHead>Part filter</TableHead>
                    <TableHead className="w-24">Active</TableHead>
                    <TableHead className="w-44 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orderedRows.map((row, idx) => {
                    const edit = editing[row.id];
                    const isEditing = !!edit;
                    return (
                      <TableRow key={row.id} data-testid={`row-issue-type-${row.id}`}>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              disabled={idx === 0}
                              onClick={() => moveRow(idx, -1)}
                              data-testid={`button-move-up-${row.id}`}
                              aria-label="Move up"
                            >
                              <ArrowUp className="h-3 w-3" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              disabled={idx === orderedRows.length - 1}
                              onClick={() => moveRow(idx, 1)}
                              data-testid={`button-move-down-${row.id}`}
                              aria-label="Move down"
                            >
                              <ArrowDown className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Input
                              value={edit.displayLabel}
                              onChange={e => setEditing(prev => ({ ...prev, [row.id]: { ...edit, displayLabel: e.target.value } }))}
                              data-testid={`input-label-${row.id}`}
                            />
                          ) : (
                            <span className="font-medium">{row.displayLabel}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <code className="text-xs text-gray-500">{row.issueType}</code>
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Select
                              value={edit.issueGroup}
                              onValueChange={(v) => setEditing(prev => ({ ...prev, [row.id]: { ...edit, issueGroup: v as GroupValue } }))}
                            >
                              <SelectTrigger className="w-36" data-testid={`select-group-${row.id}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {GROUP_OPTIONS.map(opt => (
                                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant="outline">{groupLabel(row.issueGroup)}</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Input
                              type="number"
                              min={0}
                              step={0.05}
                              value={edit.defaultLaborHours}
                              onChange={e => setEditing(prev => ({ ...prev, [row.id]: { ...edit, defaultLaborHours: e.target.value } }))}
                              data-testid={`input-hours-${row.id}`}
                            />
                          ) : (
                            <span data-testid={`text-hours-${row.id}`}>{row.defaultLaborHours}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Input
                              value={edit.partCategoryFilter}
                              placeholder="(none)"
                              onChange={e => setEditing(prev => ({ ...prev, [row.id]: { ...edit, partCategoryFilter: e.target.value } }))}
                              data-testid={`input-filter-${row.id}`}
                            />
                          ) : (
                            <span className="text-sm text-gray-700">{row.partCategoryFilter || <span className="text-gray-400">—</span>}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={row.isActive}
                            onCheckedChange={(checked) =>
                              updateMut.mutate({ id: row.id, patch: { isActive: checked } })
                            }
                            disabled={updateMut.isPending}
                            data-testid={`switch-active-${row.id}`}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          {isEditing ? (
                            <div className="flex items-center gap-2 justify-end">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => cancelEdit(row.id)}
                                data-testid={`button-cancel-${row.id}`}
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => onSaveEdit(row)}
                                disabled={updateMut.isPending}
                                data-testid={`button-save-${row.id}`}
                              >
                                {updateMut.isPending ? (
                                  <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Saving</>
                                ) : "Save"}
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => startEdit(row)}
                              data-testid={`button-edit-${row.id}`}
                            >
                              Edit
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AddIssueTypeDialog
        open={showAdd}
        onOpenChange={setShowAdd}
        existingKeys={new Set((data ?? []).map(r => r.issueType))}
        nextSortOrder={((data ?? []).reduce((m, r) => Math.max(m, r.sortOrder), 0) + 10) || 10}
      />
    </div>
  );
}

function AddIssueTypeDialog({
  open, onOpenChange, existingKeys, nextSortOrder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingKeys: Set<string>;
  nextSortOrder: number;
}) {
  const { toast } = useToast();
  const [issueType, setIssueType] = useState("");
  const [displayLabel, setDisplayLabel] = useState("");
  const [issueGroup, setIssueGroup] = useState<GroupValue>("quick_fix");
  const [defaultLaborHours, setDefaultLaborHours] = useState("0.25");
  const [partCategoryFilter, setPartCategoryFilter] = useState("");

  useEffect(() => {
    if (!open) {
      setIssueType("");
      setDisplayLabel("");
      setIssueGroup("quick_fix");
      setDefaultLaborHours("0.25");
      setPartCategoryFilter("");
    }
  }, [open]);

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest("/api/admin/issue-types", "POST", body),
    onSuccess: () => {
      toast({ title: "Issue type added" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/issue-types"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks/issue-types"] });
      onOpenChange(false);
    },
    onError: (err) => {
      toast({
        title: "Could not add issue type",
        description: parseApiError(err, "Please check the form values and try again."),
        variant: "destructive",
      });
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const key = issueType.trim().toLowerCase().replace(/\s+/g, "_");
    if (!key) return toast({ title: "Issue type key is required", variant: "destructive" });
    if (!/^[a-z0-9_]+$/.test(key)) {
      return toast({ title: "Key may only contain letters, numbers, and underscores", variant: "destructive" });
    }
    if (existingKeys.has(key)) {
      return toast({ title: "That key already exists", variant: "destructive" });
    }
    if (!displayLabel.trim()) {
      return toast({ title: "Label is required", variant: "destructive" });
    }
    const hrs = parseFloat(defaultLaborHours);
    if (Number.isNaN(hrs) || hrs < 0) {
      return toast({ title: "Labor hours must be a non-negative number", variant: "destructive" });
    }
    createMut.mutate({
      issueType: key,
      displayLabel: displayLabel.trim(),
      issueGroup,
      defaultLaborHours,
      partCategoryFilter: partCategoryFilter.trim() || null,
      sortOrder: nextSortOrder,
      isActive: true,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Issue Type</DialogTitle>
          <DialogDescription>
            New issue types will appear in the wet-check picker for your company immediately.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label htmlFor="add-label">Display label</Label>
            <Input
              id="add-label"
              value={displayLabel}
              onChange={e => setDisplayLabel(e.target.value)}
              placeholder="e.g. Drip Leak"
              data-testid="input-add-label"
            />
          </div>
          <div>
            <Label htmlFor="add-key">Key</Label>
            <Input
              id="add-key"
              value={issueType}
              onChange={e => setIssueType(e.target.value)}
              placeholder="e.g. drip_leak"
              data-testid="input-add-key"
            />
            <p className="text-xs text-gray-500 mt-1">Lowercase letters, numbers, and underscores only. Cannot be changed after creation.</p>
          </div>
          <div>
            <Label>Group</Label>
            <Select value={issueGroup} onValueChange={(v) => setIssueGroup(v as GroupValue)}>
              <SelectTrigger data-testid="select-add-group"><SelectValue /></SelectTrigger>
              <SelectContent>
                {GROUP_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="add-hours">Default labor hours</Label>
              <Input
                id="add-hours"
                type="number"
                min={0}
                step={0.05}
                value={defaultLaborHours}
                onChange={e => setDefaultLaborHours(e.target.value)}
                data-testid="input-add-hours"
              />
            </div>
            <div>
              <Label htmlFor="add-filter">Part category filter</Label>
              <Input
                id="add-filter"
                value={partCategoryFilter}
                onChange={e => setPartCategoryFilter(e.target.value)}
                placeholder="(none)"
                data-testid="input-add-filter"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMut.isPending} data-testid="button-add-submit">
              {createMut.isPending ? (
                <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Adding…</>
              ) : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
