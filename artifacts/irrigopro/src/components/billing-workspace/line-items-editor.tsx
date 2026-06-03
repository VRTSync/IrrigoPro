/**
 * LineItemsEditor — Task #1093
 *
 * Inline table editor for billing sheet or work order items.
 * Renders one editable row per item (partName, qty, unitPrice, laborHrs, notes).
 * "Save" fires PATCH /api/{entityPath}/{id}/items with the full new item array.
 * On success the parent invalidates the detail query key.
 *
 * Props:
 *   entityPath   — "billing-sheets" | "work-orders"
 *   entityId     — row ID
 *   initialItems — current items from the detail fetch
 *   detailQueryKey — react-query key to invalidate on success
 *   disabled     — lock the editor (e.g. when sheet is billed)
 */

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type EntityPath = "billing-sheets" | "work-orders";

interface ItemRow {
  key: string;
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
  disabled?: boolean;
}

let _keySeq = 0;
const nextKey = () => `row_${++_keySeq}`;

function toRow(item: InlineItem): ItemRow {
  return {
    key: nextKey(),
    partName: item.partName ?? "",
    quantity: String(item.quantity ?? 1),
    unitPrice: String(item.unitPrice ?? "0"),
    laborHours: String(item.laborHours ?? "0"),
    notes: item.notes ?? "",
  };
}

function emptyRow(): ItemRow {
  return { key: nextKey(), partName: "", quantity: "1", unitPrice: "0.00", laborHours: "0", notes: "" };
}

export function LineItemsEditor({
  entityPath,
  entityId,
  initialItems,
  detailQueryKey,
  disabled = false,
}: LineItemsEditorProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [rows, setRows] = useState<ItemRow[]>(() =>
    initialItems.length > 0 ? initialItems.map(toRow) : [emptyRow()],
  );
  const [isDirty, setIsDirty] = useState(false);

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

  function handleSave() {
    const items = rows
      .filter((r) => r.partName.trim() !== "")
      .map((r) => ({
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

  return (
    <div className="space-y-2" data-testid="line-items-editor">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-600">Parts / Items</span>
        <span className="text-xs text-gray-500 tabular-nums">
          Parts total: <strong>{fmtCurrency(partsTotal)}</strong>
        </span>
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
                    <input
                      type="text"
                      value={row.partName}
                      onChange={(e) => update(row.key, "partName", e.target.value)}
                      disabled={disabled || mutation.isPending}
                      placeholder="Part / description"
                      className="w-full px-1.5 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
                      data-testid={`item-name-${row.key}`}
                    />
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
    </div>
  );
}
