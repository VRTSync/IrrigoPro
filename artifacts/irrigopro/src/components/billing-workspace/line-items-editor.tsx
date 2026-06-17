/**
 * LineItemsEditor — Task #1093
 *
 * Inline table editor for billing sheet or work order items.
 * Renders one editable row per item (partName, qty, unitPrice, laborHrs, notes).
 * "Save" fires PATCH /api/{entityPath}/{id}/items with the full new item array.
 * On success the parent invalidates the detail query key.
 *
 * Task #1315 — also invalidates the list query key so queue row totals refresh.
 * Task #1315 — shows Parts / Labor / Total summary strip below the table,
 *              driven by live partsTotal + last-saved laborSubtotal/totalAmount.
 *
 * Task #1391 — "Add from Library" button opens PartPicker; catalog rows get
 *              a BookOpen badge and dedup-by-partId (qty increment). partId is
 *              tracked in row state and included in the PATCH payload.
 *
 * Props:
 *   entityPath     — "billing-sheets" | "work-orders"
 *   entityId       — row ID
 *   initialItems   — current items from the detail fetch
 *   detailQueryKey — react-query key to invalidate on success
 *   laborSubtotal  — last-saved labor subtotal from the detail record
 *   totalAmount    — last-saved grand total from the detail record
 *   disabled       — lock the editor (e.g. when sheet is billed)
 */

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Save, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PartPicker } from "@/components/parts/part-picker";
import type { Part } from "@workspace/db/schema";

type EntityPath = "billing-sheets" | "work-orders";

interface ItemRow {
  key: string;
  partId: number | null;
  partName: string;
  quantity: string;
  unitPrice: string;
  laborHours: string;
  notes: string;
}

export interface InlineItem {
  partId?: number | null;
  partName: string;
  quantity: number;
  unitPrice: number | string;
  laborHours?: number | string | null;
  notes?: string | null;
  totalPrice?: number | string | null;
}

interface LineItemsEditorProps {
  entityPath: EntityPath;
  entityId: number;
  initialItems: InlineItem[];
  detailQueryKey: unknown[];
  laborSubtotal?: string | number | null;
  totalAmount?: string | number | null;
  disabled?: boolean;
}

let _keySeq = 0;
const nextKey = () => `row_${++_keySeq}`;

function toRow(item: InlineItem): ItemRow {
  return {
    key: nextKey(),
    partId: item.partId ?? null,
    partName: item.partName ?? "",
    quantity: String(item.quantity ?? 1),
    unitPrice: String(item.unitPrice ?? "0"),
    laborHours: String(item.laborHours ?? "0"),
    notes: item.notes ?? "",
  };
}

function emptyRow(): ItemRow {
  return {
    key: nextKey(),
    partId: null,
    partName: "",
    quantity: "1",
    unitPrice: "0.00",
    laborHours: "0",
    notes: "",
  };
}

export function LineItemsEditor({
  entityPath,
  entityId,
  initialItems,
  detailQueryKey,
  laborSubtotal,
  totalAmount,
  disabled = false,
}: LineItemsEditorProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [rows, setRows] = useState<ItemRow[]>(() =>
    initialItems.length > 0 ? initialItems.map(toRow) : [emptyRow()],
  );
  const [isDirty, setIsDirty] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    setRows(initialItems.length > 0 ? initialItems.map(toRow) : [emptyRow()]);
    setIsDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  const mutation = useMutation({
    mutationFn: (items: object[]) =>
      apiRequest(`/api/${entityPath}/${entityId}/items`, "PATCH", { items }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: detailQueryKey });
      // Invalidate the list query so queue row totals update immediately.
      queryClient.invalidateQueries({ queryKey: [`/api/${entityPath}`], exact: false });
      setIsDirty(false);
      toast({ title: "Items saved", description: "Line items updated successfully." });
    },
    onError: (e: any) => {
      toast({
        title: "Couldn't save items",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  function update(key: string, field: keyof ItemRow, value: string) {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)),
    );
    setIsDirty(true);
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
    setIsDirty(true);
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
    setIsDirty(true);
  }

  function handleSelectFromLibrary(part: Part, qty?: number) {
    setRows((prev) => {
      const existingIdx = prev.findIndex((r) => r.partId === part.id);
      if (existingIdx >= 0) {
        return prev.map((r, i) =>
          i === existingIdx
            ? { ...r, quantity: String((parseFloat(r.quantity) || 0) + (qty || 1)) }
            : r,
        );
      }
      const newRow: ItemRow = {
        key: nextKey(),
        partId: part.id,
        partName: part.name,
        quantity: String(qty || 1),
        unitPrice: String(parseFloat(part.price ?? "0") || 0),
        laborHours: String((part as Part & { laborHours?: string | number }).laborHours ?? "0"),
        notes: "",
      };
      return [...prev, newRow];
    });
    setIsDirty(true);
  }

  function handleSave() {
    const items = rows
      .filter((r) => r.partName.trim() !== "")
      .map((r) => ({
        partId: r.partId ?? undefined,
        partName: r.partName.trim(),
        quantity: parseFloat(r.quantity) || 0,
        unitPrice: parseFloat(r.unitPrice) || 0,
        laborHours: parseFloat(r.laborHours) || 0,
        notes: r.notes.trim() || null,
      }));
    mutation.mutate(items);
  }

  const partsTotal = rows.reduce(
    (s, r) => s + (parseFloat(r.quantity) || 0) * (parseFloat(r.unitPrice) || 0),
    0,
  );

  const fmtCurrency = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  const savedLabor = parseFloat(String(laborSubtotal ?? "0")) || 0;
  const grandTotal = partsTotal + savedLabor;

  return (
    <>
      <div className="space-y-2" data-testid="line-items-editor">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-600">Parts / Items</span>
        </div>

        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-xs" data-testid="items-table">
            <thead className="bg-gray-50 text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium min-w-[140px]">Name</th>
                <th className="px-2 py-1.5 text-right font-medium w-16">Qty</th>
                <th className="px-2 py-1.5 text-right font-medium w-20">Unit $</th>
                <th className="px-2 py-1.5 text-right font-medium w-20">Labor hrs</th>
                <th className="px-2 py-1.5 text-right font-medium w-20">Subtotal</th>
                <th className="px-2 py-1.5 text-left font-medium min-w-[100px]">Notes</th>
                <th className="px-1 py-1.5 w-7" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => {
                const lineTotal =
                  (parseFloat(row.quantity) || 0) * (parseFloat(row.unitPrice) || 0);
                return (
                  <tr key={row.key} className="hover:bg-gray-50">
                    <td className="px-1 py-1">
                      <div className="flex items-center gap-1">
                        {row.partId != null && (
                          <BookOpen
                            className="w-3 h-3 text-blue-400 shrink-0"
                            aria-label="From catalog"
                            title="From parts catalog"
                          />
                        )}
                        <input
                          type="text"
                          value={row.partName}
                          onChange={(e) => update(row.key, "partName", e.target.value)}
                          disabled={disabled || mutation.isPending}
                          placeholder="Part / description"
                          className="w-full px-1.5 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
                          data-testid={`item-name-${row.key}`}
                        />
                      </div>
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={row.quantity}
                        onChange={(e) => update(row.key, "quantity", e.target.value)}
                        disabled={disabled || mutation.isPending}
                        className="w-full px-1.5 py-1 border border-gray-200 rounded text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
                        data-testid={`item-qty-${row.key}`}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.unitPrice}
                        onChange={(e) => update(row.key, "unitPrice", e.target.value)}
                        disabled={disabled || mutation.isPending}
                        className="w-full px-1.5 py-1 border border-gray-200 rounded text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
                        data-testid={`item-price-${row.key}`}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        min="0"
                        step="0.25"
                        value={row.laborHours}
                        onChange={(e) => update(row.key, "laborHours", e.target.value)}
                        disabled={disabled || mutation.isPending}
                        className="w-full px-1.5 py-1 border border-gray-200 rounded text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
                        data-testid={`item-labor-${row.key}`}
                      />
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-gray-600">
                      {fmtCurrency(lineTotal)}
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="text"
                        value={row.notes}
                        onChange={(e) => update(row.key, "notes", e.target.value)}
                        disabled={disabled || mutation.isPending}
                        placeholder="Notes"
                        className="w-full px-1.5 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
                        data-testid={`item-notes-${row.key}`}
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <button
                        type="button"
                        onClick={() => removeRow(row.key)}
                        disabled={disabled || mutation.isPending || rows.length <= 1}
                        className="p-1 text-gray-400 hover:text-red-500 disabled:opacity-30 transition-colors"
                        aria-label="Remove row"
                        data-testid={`item-remove-${row.key}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            disabled={disabled || mutation.isPending}
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 disabled:opacity-40 transition-colors"
            data-testid="items-add-from-library"
          >
            <BookOpen className="w-3 h-3" /> Add from Library
          </button>
          <button
            type="button"
            onClick={addRow}
            disabled={disabled || mutation.isPending}
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 disabled:opacity-40 transition-colors"
            data-testid="items-add-row"
          >
            <Plus className="w-3 h-3" /> Add row
          </button>
          <div className="ml-auto">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={disabled || mutation.isPending || !isDirty}
              data-testid="items-save"
            >
              {mutation.isPending ? (
                "Saving…"
              ) : (
                <>
                  <Save className="w-3 h-3 mr-1" /> Save items
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Summary strip — Parts live, Labor/Total from last-saved detail record */}
        <div
          className="flex items-center gap-3 px-2 py-1.5 rounded bg-gray-50 border border-gray-100 text-xs tabular-nums"
          data-testid="billing-summary-strip"
        >
          <span className="text-gray-500">
            Parts: <strong className="text-gray-800">{fmtCurrency(partsTotal)}</strong>
          </span>
          <span className="text-gray-300">·</span>
          <span className="text-gray-500">
            Labor: <strong className="text-gray-800">{fmtCurrency(savedLabor)}</strong>
          </span>
          <span className="text-gray-300">·</span>
          <span className="text-gray-500">
            Total: <strong className="text-gray-900">{fmtCurrency(grandTotal)}</strong>
          </span>
          {isDirty && (
            <span className="ml-auto text-amber-600 font-medium">unsaved changes</span>
          )}
        </div>
      </div>

      <PartPicker
        open={showPicker}
        onOpenChange={setShowPicker}
        onSelectPart={handleSelectFromLibrary}
        title="Add from Library"
      />
    </>
  );
}
