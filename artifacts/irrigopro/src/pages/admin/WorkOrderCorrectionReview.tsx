import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  AlertTriangle,
  ChevronLeft,
  CheckCircle2,
  XCircle,
  Info,
  ExternalLink,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

type WorklistItem = {
  woId: number;
  workOrderNumber: string | null;
  companyId: number;
  estimateId: number;
  isBilled: boolean;
  invoiceId: number | null;
  woItemCount: number;
  estItemCount: number;
  canAutoRepair: boolean;
  reviewReason: string | null;
  currentTotal: number;
  estimateTotal: number;
  strippedCount: number;
};

type DedupRow = {
  partKey: string;
  partId: number | null;
  partName: string;
  unitPrice: number;
  estimateQty: number;
  dedupedActualQty: number;
  source: "pureKept" | "fieldAdd" | "drifted";
};

type WoDetail = {
  woId: number;
  workOrderNumber: string | null;
  companyId: number;
  estimateId: number;
  isBilled: boolean;
  invoiceId: number | null;
  currentTotal: number;
  estimateTotal: number;
  dedupTotal: number;
  rows: DedupRow[];
  currentItems: Array<{ id: number; partId: number | null; partName: string; partPrice: number; quantity: number; totalPrice: number }>;
  estimateItems: Array<{ id: number; partId: number | null; partName: string; partPrice: number; quantity: number }>;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

function sourceBadge(source: DedupRow["source"]) {
  if (source === "pureKept") return <Badge variant="secondary" className="text-xs font-normal">kept</Badge>;
  if (source === "fieldAdd") return <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-xs font-normal hover:bg-blue-100">field-add</Badge>;
  return <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs font-normal hover:bg-amber-100">drifted</Badge>;
}

// ── Editor row state ──────────────────────────────────────────────────────────

type EditorRow = {
  partKey: string;
  partId: number | null;
  partName: string;
  unitPrice: number;
  estimateQty: number;
  dedupedActualQty: number;
  source: DedupRow["source"];
  finalQty: number;
  keep: boolean;
};

function initEditorRows(rows: DedupRow[]): EditorRow[] {
  return rows.map((r) => ({
    ...r,
    finalQty: r.dedupedActualQty,
    // Field-adds are kept by default; operator can remove
    keep: true,
  }));
}

// ── Worklist view ────────────────────────────────────────────────────────────

function WorklistView({ onSelect }: { onSelect: (woId: number) => void }) {
  const { data: items = [], isLoading, error } = useQuery<WorklistItem[]>({
    queryKey: ["/api/admin/wo-corrections"],
    queryFn: () => apiRequest("/api/admin/wo-corrections", "GET"),
  });

  if (isLoading) return <div className="py-12 text-center text-gray-500 text-sm">Loading flagged work orders…</div>;
  if (error) return <div className="py-12 text-center text-red-500 text-sm">Failed to load worklist.</div>;
  if (items.length === 0) return (
    <div className="py-12 text-center text-gray-500 text-sm">
      <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
      No work orders require correction review.
    </div>
  );

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <Card
          key={item.woId}
          className={`cursor-pointer hover:border-blue-400 transition-colors ${item.isBilled ? "opacity-75" : ""}`}
          onClick={() => !item.isBilled && onSelect(item.woId)}
        >
          <CardContent className="py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">
                    {item.workOrderNumber ?? `WO #${item.woId}`}
                  </span>
                  {item.isBilled && (
                    <Badge className="bg-red-100 text-red-800 border-red-200 text-xs hover:bg-red-100">
                      Billed — route to invoice correction
                    </Badge>
                  )}
                  {item.strippedCount > 0 && !item.isBilled && (
                    <Badge variant="outline" className="text-xs">
                      {item.strippedCount} dup row{item.strippedCount !== 1 ? "s" : ""} stripped
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-gray-600">{item.reviewReason}</p>
              </div>
              <div className="text-right shrink-0 space-y-1">
                <p className="text-xs text-gray-500">
                  Current: <span className="font-medium">{fmtMoney(item.currentTotal)}</span>
                </p>
                <p className="text-xs text-gray-500">
                  Estimate: <span className="font-medium">{fmtMoney(item.estimateTotal)}</span>
                </p>
                {!item.isBilled && (
                  <Button size="sm" variant="outline" className="text-xs h-7 mt-1" onClick={(e) => { e.stopPropagation(); onSelect(item.woId); }}>
                    Review →
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Editor view ───────────────────────────────────────────────────────────────

function EditorView({
  woId,
  onBack,
  onApplied,
}: {
  woId: number;
  onBack: () => void;
  onApplied: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: detail, isLoading, error } = useQuery<WoDetail>({
    queryKey: ["/api/admin/wo-corrections", woId],
    queryFn: () => apiRequest(`/api/admin/wo-corrections/${woId}`, "GET"),
  });

  const [editorRows, setEditorRows] = useState<EditorRow[] | null>(null);
  const [reason, setReason] = useState("");
  const [underQtyAcknowledged, setUnderQtyAcknowledged] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // Initialise editor rows from API response (only once)
  const rows = useMemo(() => {
    if (!detail) return null;
    if (editorRows !== null) return editorRows;
    const init = initEditorRows(detail.rows);
    return init;
  }, [detail, editorRows]);

  function updateRow(partKey: string, patch: Partial<EditorRow>) {
    setEditorRows((prev) => {
      const base = prev ?? (detail ? initEditorRows(detail.rows) : []);
      return base.map((r) => r.partKey === partKey ? { ...r, ...patch } : r);
    });
  }

  const activeRows = (rows ?? []).filter((r) => r.keep && r.finalQty > 0);
  const runningTotal = activeRows.reduce((s, r) => s + r.unitPrice * r.finalQty, 0);

  const underQtyRows = (rows ?? []).filter(
    (r) => r.keep && r.estimateQty > 0 && r.finalQty < r.estimateQty,
  );
  const hasUnderQty = underQtyRows.length > 0;

  const canConfirm =
    reason.trim().length > 0 &&
    activeRows.length > 0 &&
    (!hasUnderQty || underQtyAcknowledged);

  const applyMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/admin/wo-corrections/${woId}/apply`, "POST", {
        reason: reason.trim(),
        rows: (rows ?? []).map((r) => ({
          partKey: r.partKey,
          finalQty: r.finalQty,
          keep: r.keep,
        })),
        underQtyAcknowledged,
      });
    },
    onSuccess: () => {
      toast({ title: "Correction applied", description: `WO corrected. New total: ${fmtMoney(runningTotal)}` });
      qc.invalidateQueries({ queryKey: ["/api/admin/wo-corrections"] });
      onApplied();
    },
    onError: (err: any) => {
      const msg = err?.message ?? "Failed to apply correction";
      toast({ title: "Apply failed", description: msg, variant: "destructive" });
    },
  });

  if (isLoading) return <div className="py-12 text-center text-gray-500 text-sm">Loading work order detail…</div>;
  if (error || !detail) return <div className="py-12 text-center text-red-500 text-sm">Failed to load work order detail.</div>;

  if (detail.isBilled) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ChevronLeft className="h-4 w-4" /> Back
        </Button>
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-6 flex gap-3">
            <XCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm text-red-800">
                {detail.workOrderNumber ?? `WO #${woId}`} is already billed (Invoice #{detail.invoiceId})
              </p>
              <p className="text-xs text-red-700 mt-1">
                In-place correction is blocked. Use the invoice correction / reissue flow to adjust this work order's billing.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const displayRows = rows ?? initEditorRows(detail.rows);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ChevronLeft className="h-4 w-4" /> Back
        </Button>
        <div>
          <h2 className="text-base font-semibold">
            {detail.workOrderNumber ?? `WO #${woId}`}
          </h2>
          <p className="text-xs text-gray-500">
            Review and set final quantities · Estimate #{detail.estimateId}
          </p>
        </div>
      </div>

      {/* Totals summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="py-3">
            <p className="text-xs text-gray-500">Current (inflated)</p>
            <p className="text-lg font-semibold text-red-600">{fmtMoney(detail.currentTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <p className="text-xs text-gray-500">De-duped estimate</p>
            <p className="text-lg font-semibold text-gray-700">{fmtMoney(detail.dedupTotal)}</p>
          </CardContent>
        </Card>
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="py-3">
            <p className="text-xs text-blue-600">Running total (your edits)</p>
            <p className="text-lg font-semibold text-blue-700">{fmtMoney(runningTotal)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Main editor */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Part Quantities</CardTitle>
          <CardDescription className="text-xs">
            Estimate qty · De-duped actual qty · Final qty (editable). Confirm below when ready.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {/* Column headers */}
            <div className="grid grid-cols-[1fr_80px_80px_100px_28px] gap-2 px-2 py-1 text-xs text-gray-500 font-medium border-b">
              <span>Part</span>
              <span className="text-center">Est qty</span>
              <span className="text-center">De-dup actual</span>
              <span className="text-center">Final qty</span>
              <span />
            </div>

            {displayRows.map((row) => {
              const isUnderEst = row.keep && row.estimateQty > 0 && row.finalQty < row.estimateQty;
              return (
                <div
                  key={row.partKey}
                  className={`grid grid-cols-[1fr_80px_80px_100px_28px] gap-2 items-center px-2 py-2 rounded-md text-sm ${
                    !row.keep ? "opacity-40" : isUnderEst ? "bg-amber-50 border border-amber-200" : ""
                  }`}
                >
                  {/* Part name + source badge */}
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className={`truncate font-medium text-xs ${!row.keep ? "line-through text-gray-400" : ""}`}>
                      {row.partName || "(unlabeled)"}
                    </span>
                    <div className="flex items-center gap-1">
                      {sourceBadge(row.source)}
                      {isUnderEst && (
                        <span className="flex items-center gap-0.5 text-xs text-amber-700">
                          <AlertTriangle className="h-3 w-3" />
                          under est
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Estimate qty */}
                  <span className="text-center text-xs text-gray-600">
                    {row.estimateQty > 0 ? row.estimateQty : "—"}
                  </span>

                  {/* De-duped actual qty */}
                  <span className="text-center text-xs text-gray-700 font-medium">
                    {row.dedupedActualQty}
                  </span>

                  {/* Final qty input */}
                  <Input
                    type="number"
                    min={0}
                    value={row.keep ? row.finalQty : 0}
                    disabled={!row.keep}
                    className="h-7 text-xs text-center px-2"
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (Number.isFinite(v) && v >= 0) {
                        updateRow(row.partKey, { finalQty: v });
                      }
                    }}
                  />

                  {/* Keep/remove toggle for field-adds */}
                  {row.source === "fieldAdd" ? (
                    <Checkbox
                      checked={row.keep}
                      onCheckedChange={(v) => updateRow(row.partKey, { keep: !!v })}
                      title={row.keep ? "Remove this field-add" : "Keep this field-add"}
                    />
                  ) : (
                    <span />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Reference panel */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-gray-600">Estimate items (source)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {detail.estimateItems.map((ei) => (
              <div key={ei.id} className="flex justify-between text-xs text-gray-600">
                <span className="truncate">{ei.partName}</span>
                <span className="shrink-0 ml-2">{ei.quantity} × {fmtMoney(ei.partPrice)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-gray-600">Current WO items (inflated)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {detail.currentItems.map((ci) => (
              <div key={ci.id} className="flex justify-between text-xs text-gray-600">
                <span className="truncate">{ci.partName}</span>
                <span className="shrink-0 ml-2">{ci.quantity} × {fmtMoney(ci.partPrice)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Under-estimate acknowledgement */}
      {hasUnderQty && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-4">
            <div className="flex gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-amber-800">
                  {underQtyRows.length} part{underQtyRows.length !== 1 ? "s" : ""} below estimate qty — possible under-billing
                </p>
                <ul className="text-xs text-amber-700 space-y-0.5">
                  {underQtyRows.map((r) => (
                    <li key={r.partKey}>
                      {r.partName}: est {r.estimateQty} → final {r.finalQty}
                    </li>
                  ))}
                </ul>
                <div className="flex items-center gap-2 pt-1">
                  <Checkbox
                    id="underQtyAck"
                    checked={underQtyAcknowledged}
                    onCheckedChange={(v) => setUnderQtyAcknowledged(!!v)}
                  />
                  <Label htmlFor="underQtyAck" className="text-xs text-amber-800 cursor-pointer">
                    I acknowledge this deliberate reduction and confirm it will not cause under-billing
                  </Label>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Reason + confirm */}
      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="space-y-1">
            <Label className="text-xs font-medium">Reason / note for this correction</Label>
            <Textarea
              placeholder="Describe why these quantities are correct (e.g., 'Field-added nozzles confirmed by tech, removed append-bug duplicates')…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="text-sm min-h-[80px]"
            />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              {activeRows.length} part{activeRows.length !== 1 ? "s" : ""} · New total: <span className="font-semibold">{fmtMoney(runningTotal)}</span>
              {" "}(was {fmtMoney(detail.currentTotal)})
            </p>
            <Button
              onClick={() => setShowConfirmDialog(true)}
              disabled={!canConfirm || applyMutation.isPending}
              className="gap-1"
            >
              <CheckCircle2 className="h-4 w-4" />
              Confirm &amp; Apply
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Confirm dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply WO Correction?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>This will replace all items on <strong>{detail.workOrderNumber ?? `WO #${woId}`}</strong> with the corrected set and update totals.</p>
                <p className="text-sm">Before: <strong>{fmtMoney(detail.currentTotal)}</strong> → After: <strong>{fmtMoney(runningTotal)}</strong></p>
                <p className="text-xs text-gray-500 italic">"{reason}"</p>
                <p className="text-xs text-gray-500">A full audit record will be written. This cannot be undone without another correction.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowConfirmDialog(false);
                applyMutation.mutate();
              }}
            >
              Apply Correction
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Page root ─────────────────────────────────────────────────────────────────

export default function WorkOrderCorrectionReview() {
  const [selectedWoId, setSelectedWoId] = useState<number | null>(null);
  const [, navigate] = useLocation();

  function handleBack() {
    setSelectedWoId(null);
  }

  function handleApplied() {
    setSelectedWoId(null);
  }

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 space-y-5">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold">Work Order Correction Review</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Human-confirmed de-dup correction for flagged work orders with field-added or drifted parts.
          </p>
        </div>
        {!selectedWoId && (
          <Button variant="outline" size="sm" onClick={() => navigate("/admin/migrations")}>
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
            Migrations
          </Button>
        )}
      </div>

      <div className="flex items-start gap-2 p-3 rounded-md bg-blue-50 border border-blue-200 text-xs text-blue-800">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          This worklist shows work orders flagged by the de-dup migration that require human sign-off.
          Set final quantities per part, acknowledge any reductions below estimate qty, add a reason, and apply.
          Billed WOs are shown but blocked — route them to the invoice correction flow.
        </span>
      </div>

      {selectedWoId != null ? (
        <EditorView
          woId={selectedWoId}
          onBack={handleBack}
          onApplied={handleApplied}
        />
      ) : (
        <WorklistView onSelect={setSelectedWoId} />
      )}
    </div>
  );
}
