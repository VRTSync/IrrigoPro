// Task #683 — All-estimates table for the Estimate Command Center.
//
// Columns: Estimate #, Customer, Project, Owner, Lifecycle, Total,
// Age, Last update, Actions.
//
// Filters: search, lifecycle multi-select chips, owner multi-select,
// $ min / max, "Reset filters". Sort modes are
// `total_desc | age_desc | lifecycle` (default `total_desc`). The
// selected lifecycle, attention reason, and sort key are mirrored
// into the URL via the `lifecycle`, `attention`, and `sort` query
// params.
//
// Row actions are lifecycle-aware: View, Edit, Approve & Send,
// Convert to WO — wired through callbacks provided by the page.

import { useEffect, useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, ArrowUpDown, RefreshCw } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import {
  LIFECYCLE_ORDER,
  LIFECYCLE_TINTS,
  isConvertedToWorkOrder,
  isReadyToSend,
  lifecycleOf,
  type LifecycleStatus,
} from "@workspace/shared";
import { formatEstimateNumber } from "@workspace/shared";
import type { Estimate } from "@workspace/db/schema";

function formatCurrency(amount: string | number) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

function totalNum(e: Estimate): number {
  const n = parseFloat(String(e.totalAmount ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

function ageInDays(d: string | Date | null | undefined): number {
  if (!d) return 0;
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24)));
}

function lastUpdate(e: Estimate): Date | null {
  const v = e.updatedAt ?? e.createdAt ?? null;
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const LIFECYCLES: LifecycleStatus[] = [
  "draft",
  "pending_review",
  "sent",
  "approved",
  "rejected",
  "expired",
];

export type EstimateTableSort = "total_desc" | "age_desc" | "lifecycle";

interface EstimateTableProps {
  estimates: Estimate[];
  lifecycleFilter: LifecycleStatus[];
  onLifecycleFilterChange: (next: LifecycleStatus[]) => void;
  attentionEstimateIds: number[] | null;
  onClearAttention: () => void;
  sort: EstimateTableSort;
  onSortChange: (next: EstimateTableSort) => void;
  onOpenEstimate: (id: number) => void;
  onEditEstimate?: (id: number) => void;
  onApproveAndSend?: (id: number) => void;
  onConvertToWorkOrder?: (id: number) => void;
}

export function EstimateTable({
  estimates,
  lifecycleFilter,
  onLifecycleFilterChange,
  attentionEstimateIds,
  onClearAttention,
  sort,
  onSortChange,
  onOpenEstimate,
  onEditEstimate,
  onApproveAndSend,
  onConvertToWorkOrder,
}: EstimateTableProps) {
  const [search, setSearch] = useState("");
  const [owners, setOwners] = useState<string[]>([]);
  const [minDollar, setMinDollar] = useState("");
  const [maxDollar, setMaxDollar] = useState("");

  const ownerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of estimates) {
      const o = e.createdBy?.trim();
      if (o) set.add(o);
    }
    return Array.from(set).sort();
  }, [estimates]);

  useEffect(() => {
    setOwners((prev) => prev.filter((o) => ownerOptions.includes(o)));
  }, [ownerOptions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const min = minDollar === "" ? null : parseFloat(minDollar);
    const max = maxDollar === "" ? null : parseFloat(maxDollar);
    const lcSet = new Set(lifecycleFilter);
    const attnSet = attentionEstimateIds ? new Set(attentionEstimateIds) : null;

    const rows = estimates.filter((e) => {
      if (attnSet && !attnSet.has(e.id)) return false;
      if (lcSet.size > 0 && !lcSet.has(lifecycleOf(e))) return false;
      if (owners.length > 0 && !owners.includes(e.createdBy ?? "")) return false;
      const t = totalNum(e);
      if (min !== null && Number.isFinite(min) && t < min) return false;
      if (max !== null && Number.isFinite(max) && t > max) return false;
      if (!q) return true;
      const hay = [
        e.estimateNumber ?? "",
        e.customerName ?? "",
        e.projectName ?? "",
        e.createdBy ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });

    rows.sort((a, b) => {
      switch (sort) {
        case "total_desc":
          return totalNum(b) - totalNum(a);
        case "lifecycle": {
          const la = LIFECYCLE_ORDER[lifecycleOf(a)];
          const lb = LIFECYCLE_ORDER[lifecycleOf(b)];
          if (la !== lb) return la - lb;
          return ageInDays(b.createdAt) - ageInDays(a.createdAt);
        }
        case "age_desc":
        default:
          return ageInDays(b.createdAt) - ageInDays(a.createdAt);
      }
    });
    return rows;
  }, [estimates, search, lifecycleFilter, owners, minDollar, maxDollar, sort, attentionEstimateIds]);

  const filtersActive =
    lifecycleFilter.length > 0 ||
    owners.length > 0 ||
    !!attentionEstimateIds ||
    minDollar !== "" ||
    maxDollar !== "" ||
    search !== "";

  function toggleLifecycle(lc: LifecycleStatus) {
    const set = new Set(lifecycleFilter);
    if (set.has(lc)) set.delete(lc);
    else set.add(lc);
    onLifecycleFilterChange(Array.from(set));
  }

  function toggleOwner(o: string) {
    setOwners((prev) =>
      prev.includes(o) ? prev.filter((x) => x !== o) : [...prev, o],
    );
  }

  function resetFilters() {
    setSearch("");
    setOwners([]);
    setMinDollar("");
    setMaxDollar("");
    onLifecycleFilterChange([]);
    onClearAttention();
    onSortChange("total_desc");
  }

  return (
    <div className="space-y-3" data-testid="estimate-table">
      <div className="flex gap-2 flex-wrap items-center">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search #, customer, project, owner"
          className="max-w-xs"
          data-testid="estimate-table-search"
        />
        <Input
          value={minDollar}
          onChange={(e) => setMinDollar(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="Min $"
          className="w-24"
          inputMode="numeric"
          data-testid="estimate-table-min"
        />
        <Input
          value={maxDollar}
          onChange={(e) => setMaxDollar(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="Max $"
          className="w-24"
          inputMode="numeric"
          data-testid="estimate-table-max"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" data-testid="estimate-table-owner-filter">
              Owner{owners.length > 0 ? ` (${owners.length})` : ""}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
            {ownerOptions.length === 0 ? (
              <DropdownMenuItem disabled>No owners</DropdownMenuItem>
            ) : (
              ownerOptions.map((o) => (
                <DropdownMenuItem
                  key={o}
                  onSelect={(e) => {
                    e.preventDefault();
                    toggleOwner(o);
                  }}
                  data-testid={`owner-option-${o}`}
                >
                  <input
                    type="checkbox"
                    readOnly
                    checked={owners.includes(o)}
                    className="mr-2"
                  />
                  {o}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {filtersActive && (
          <Button
            variant="ghost"
            size="sm"
            onClick={resetFilters}
            data-testid="estimate-table-reset"
            className="gap-1"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Reset
          </Button>
        )}
        <span className="text-xs text-gray-500 ml-auto">{filtered.length} estimates</span>
      </div>

      <div className="flex flex-wrap gap-1 items-center" data-testid="lifecycle-chips">
        {LIFECYCLES.map((lc) => {
          const tint = LIFECYCLE_TINTS[lc];
          const active = lifecycleFilter.includes(lc);
          return (
            <button
              key={lc}
              type="button"
              onClick={() => toggleLifecycle(lc)}
              className={`text-[11px] px-2 py-1 rounded-full border ${
                active
                  ? `${tint.bg} ${tint.text} ${tint.border}`
                  : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
              }`}
              data-testid={`lifecycle-chip-${lc}`}
            >
              {tint.label}
            </button>
          );
        })}
        {attentionEstimateIds && (
          <button
            type="button"
            onClick={onClearAttention}
            className="text-[11px] px-2 py-1 rounded-full border bg-amber-50 text-amber-700 border-amber-200"
            data-testid="attention-filter-pill"
          >
            Attention only ×
          </button>
        )}
      </div>

      <div className="border border-gray-200 rounded-lg bg-white overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Estimate #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>
                <button
                  type="button"
                  onClick={() => onSortChange("lifecycle")}
                  className="inline-flex items-center gap-1"
                  data-testid="sort-lifecycle"
                >
                  Lifecycle <ArrowUpDown className="h-3 w-3" />
                </button>
              </TableHead>
              <TableHead className="text-right">
                <button
                  type="button"
                  onClick={() => onSortChange("total_desc")}
                  className="inline-flex items-center gap-1"
                  data-testid="sort-total"
                >
                  Total <ArrowUpDown className="h-3 w-3" />
                </button>
              </TableHead>
              <TableHead className="text-right">
                <button
                  type="button"
                  onClick={() => onSortChange("age_desc")}
                  className="inline-flex items-center gap-1"
                  data-testid="sort-age"
                >
                  Age <ArrowUpDown className="h-3 w-3" />
                </button>
              </TableHead>
              <TableHead>Last update</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-sm text-gray-500 py-8">
                  No estimates match
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((e) => {
                const lc = lifecycleOf(e);
                const tint = LIFECYCLE_TINTS[lc];
                const converted = isConvertedToWorkOrder(e);
                const readyToSend = isReadyToSend(e);
                const upd = lastUpdate(e);
                return (
                  <TableRow
                    key={e.id}
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => onOpenEstimate(e.id)}
                    data-testid={`estimate-row-${e.id}`}
                  >
                    <TableCell className="font-medium">
                      {formatEstimateNumber(e.estimateNumber)}
                    </TableCell>
                    <TableCell>{e.customerName ?? "—"}</TableCell>
                    <TableCell className="text-sm text-gray-600">
                      {e.projectName ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-gray-600">
                      {e.createdBy ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`${tint.bg} ${tint.text} ${tint.border} text-[10px]`}
                      >
                        {tint.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(e.totalAmount)}
                    </TableCell>
                    <TableCell className="text-right text-gray-500">
                      {ageInDays(e.createdAt)}d
                    </TableCell>
                    <TableCell
                      className="text-sm text-gray-500"
                      title={upd ? format(upd, "PPpp") : ""}
                    >
                      {upd ? `${formatDistanceToNow(upd, { addSuffix: true })}` : "—"}
                    </TableCell>
                    <TableCell onClick={(ev) => ev.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            data-testid={`estimate-row-actions-${e.id}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => onOpenEstimate(e.id)}>
                            View
                          </DropdownMenuItem>
                          {(lc === "draft" || lc === "pending_review") && onEditEstimate && (
                            <DropdownMenuItem onSelect={() => onEditEstimate(e.id)}>
                              Edit
                            </DropdownMenuItem>
                          )}
                          {(lc === "pending_review" || readyToSend) && onApproveAndSend && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onSelect={() => onApproveAndSend(e.id)}
                                data-testid={`row-approve-${e.id}`}
                              >
                                Approve &amp; send
                              </DropdownMenuItem>
                            </>
                          )}
                          {lc === "approved" && !converted && onConvertToWorkOrder && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onSelect={() => onConvertToWorkOrder(e.id)}
                                data-testid={`row-convert-${e.id}`}
                              >
                                Convert to work order
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
