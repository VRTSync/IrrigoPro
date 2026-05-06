import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Plus,
  Trash2,
  Pencil,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Package,
  Minus,
  ChevronLeft,
} from "lucide-react";
import type { Part } from "@shared/schema";
import { EstimateWizardPartPicker } from "./estimate-wizard-part-picker";

export interface WizardLineItem {
  rowId: string;
  partId: number;
  partName: string;
  partPrice: number;
  quantity: number;
  // per-unit labor hours
  laborHours: number;
  description: string;
}

export interface RunningTotals {
  partsSubtotal: number;
  laborSubtotal: number;
  totalAmount: number;
  totalLaborHours: number;
}

interface EstimateWizardLineItemsStepProps {
  customerName: string;
  projectName: string;
  laborRate: number;
  items: WizardLineItem[];
  onItemsChange: (next: WizardLineItem[]) => void;
  onBack: () => void;
  onContinue: () => void;
  onChangeCustomer?: () => void;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

export function computeTotals(items: WizardLineItem[], laborRate: number): RunningTotals {
  const partsSubtotal = items.reduce((s, it) => s + it.partPrice * it.quantity, 0);
  const totalLaborHours = items.reduce((s, it) => s + it.laborHours * it.quantity, 0);
  const laborSubtotal = totalLaborHours * laborRate;
  return {
    partsSubtotal,
    laborSubtotal,
    totalAmount: partsSubtotal + laborSubtotal,
    totalLaborHours,
  };
}

function makeRowId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function EstimateWizardLineItemsStep({
  customerName,
  projectName,
  laborRate,
  items,
  onItemsChange,
  onBack,
  onContinue,
  onChangeCustomer,
}: EstimateWizardLineItemsStepProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<"add" | "change">("add");
  const [changeRowId, setChangeRowId] = useState<string | null>(null);
  const [dragRowId, setDragRowId] = useState<string | null>(null);

  const totals = computeTotals(items, laborRate);

  const updateItem = (rowId: string, patch: Partial<WizardLineItem>) =>
    onItemsChange(items.map((it) => (it.rowId === rowId ? { ...it, ...patch } : it)));

  const removeItem = (rowId: string) => onItemsChange(items.filter((it) => it.rowId !== rowId));

  const moveItem = (rowId: string, dir: -1 | 1) => {
    const idx = items.findIndex((it) => it.rowId === rowId);
    if (idx < 0) return;
    const next = [...items];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    onItemsChange(next);
  };

  const handlePartPicked = (part: Part) => {
    if (pickerMode === "change" && changeRowId) {
      updateItem(changeRowId, {
        partId: part.id,
        partName: part.name,
        partPrice: parseFloat(String(part.price ?? "0")) || 0,
      });
      setChangeRowId(null);
    } else {
      onItemsChange([
        ...items,
        {
          rowId: makeRowId(),
          partId: part.id,
          partName: part.name,
          partPrice: parseFloat(String(part.price ?? "0")) || 0,
          quantity: 1,
          // Parts catalog has no per-part labor hours; tech enters labor inline.
          laborHours: 0,
          description: "",
        },
      ]);
    }
  };

  const openAdd = () => {
    setPickerMode("add");
    setChangeRowId(null);
    setPickerOpen(true);
  };

  const openChange = (rowId: string) => {
    setPickerMode("change");
    setChangeRowId(rowId);
    setPickerOpen(true);
  };

  // Native HTML5 drag-and-drop reorder on desktop. We keep `onDragOver` as a
  // no-op preventDefault (required for drop targets) and only commit the
  // splice on `onDrop`, so hovering between rows never thrashes the list.
  const onDragStart = (rowId: string) => () => setDragRowId(rowId);
  const onDragOver = () => (e: React.DragEvent) => {
    e.preventDefault();
  };
  const onDrop = (rowId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragRowId || dragRowId === rowId) return;
    const fromIdx = items.findIndex((i) => i.rowId === dragRowId);
    const toIdx = items.findIndex((i) => i.rowId === rowId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...items];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    onItemsChange(next);
  };
  const onDragEnd = () => setDragRowId(null);

  const empty = items.length === 0;

  return (
    <div className="space-y-4">
      {/* Sticky strip: customer/project + running total */}
      <div className="sticky top-0 z-10 -mx-4 px-4 py-3 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85 border-b sm:mx-0 sm:px-0 sm:border-0 sm:bg-transparent sm:backdrop-blur-0 sm:static">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-stretch">
          <Card className="sm:col-span-2 border-l-4 border-l-blue-500">
            <CardContent className="p-3 sm:p-4 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-xs uppercase tracking-wide text-gray-500">For</div>
                <div className="text-sm font-semibold text-gray-900 truncate" data-testid="wizard-strip-customer">
                  {customerName || "—"}
                </div>
                <div className="text-xs text-gray-600 truncate">{projectName || "Untitled project"}</div>
              </div>
              {onChangeCustomer && (
                <button
                  type="button"
                  onClick={onChangeCustomer}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium inline-flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 rounded shrink-0"
                  data-testid="wizard-strip-change-customer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Change customer
                </button>
              )}
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-green-500">
            <CardContent className="p-3 sm:p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Running total</div>
              <div className="grid grid-cols-3 gap-2 mt-1 items-end">
                <div>
                  <div className="text-[10px] text-gray-500 uppercase">Parts</div>
                  <div className="text-sm font-semibold text-gray-900" data-testid="wizard-total-parts">
                    {fmt(totals.partsSubtotal)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 uppercase">Labor</div>
                  <div className="text-sm font-semibold text-gray-900" data-testid="wizard-total-labor">
                    {fmt(totals.laborSubtotal)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-green-700 uppercase font-semibold">Total</div>
                  <div className="text-base font-bold text-green-700" data-testid="wizard-total-amount">
                    {fmt(totals.totalAmount)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Add Part button */}
      <div className="flex items-center justify-between">
        <Button
          type="button"
          onClick={openAdd}
          className="bg-blue-600 hover:bg-blue-700 text-white focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
          data-testid="wizard-add-part"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Part
        </Button>
        {!empty && (
          <div className="text-xs text-gray-500">
            {items.length} item{items.length === 1 ? "" : "s"}
          </div>
        )}
      </div>

      {/* Empty state */}
      {empty && (
        <Card>
          <CardContent className="py-12 flex flex-col items-center text-center gap-3">
            <div className="bg-blue-50 p-4 rounded-full">
              <Package className="w-8 h-8 text-blue-600" />
            </div>
            <div>
              <div className="text-base font-semibold text-gray-900">No parts yet</div>
              <p className="text-sm text-gray-500 mt-1">Add a part from the catalog to start the estimate.</p>
            </div>
            <Button
              type="button"
              onClick={openAdd}
              className="bg-blue-600 hover:bg-blue-700 text-white"
              data-testid="wizard-add-part-empty"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Part
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Desktop table */}
      {!empty && (
        <div className="hidden md:block">
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="w-8 py-2"></th>
                    <th className="py-2 pl-2">Part</th>
                    <th className="py-2 px-2 w-28">Qty</th>
                    <th className="py-2 px-2 w-28 text-right">Unit Price</th>
                    <th className="py-2 px-2 w-32">Labor Hrs</th>
                    <th className="py-2 px-2 w-28 text-right">Line Total</th>
                    <th className="py-2 pr-2 w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => {
                    const lineTotal = it.partPrice * it.quantity + it.laborHours * it.quantity * laborRate;
                    return (
                      <tr
                        key={it.rowId}
                        className="border-b last:border-b-0 align-top"
                        draggable
                        onDragStart={onDragStart(it.rowId)}
                        onDragOver={onDragOver()}
                        onDrop={onDrop(it.rowId)}
                        onDragEnd={onDragEnd}
                        data-testid={`wizard-row-${it.rowId}`}
                      >
                        <td className="py-3 pl-2 text-gray-400 align-middle cursor-move">
                          <GripVertical className="w-4 h-4" />
                        </td>
                        <td className="py-3 pl-2 pr-2">
                          <button
                            type="button"
                            onClick={() => openChange(it.rowId)}
                            className="font-medium text-gray-900 hover:text-blue-700 inline-flex items-center gap-1 group focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 rounded"
                            data-testid={`wizard-row-change-${it.rowId}`}
                          >
                            {it.partName}
                            <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-100 text-gray-400" />
                          </button>
                          <Input
                            value={it.description}
                            onChange={(e) => updateItem(it.rowId, { description: e.target.value })}
                            placeholder="Description (optional)"
                            className="mt-1 h-8 text-xs focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                          />
                        </td>
                        <td className="py-3 px-2">
                          <div className="inline-flex items-center border rounded-md">
                            <button
                              type="button"
                              className="p-1 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 rounded-l"
                              onClick={() => updateItem(it.rowId, { quantity: Math.max(1, it.quantity - 1) })}
                              aria-label="Decrease quantity"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <Input
                              type="number"
                              min={1}
                              value={it.quantity}
                              onChange={(e) =>
                                updateItem(it.rowId, { quantity: Math.max(1, parseInt(e.target.value || "1") || 1) })
                              }
                              className="h-7 w-12 text-center border-0 px-0 focus-visible:ring-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                              data-testid={`wizard-row-qty-${it.rowId}`}
                            />
                            <button
                              type="button"
                              className="p-1 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 rounded-r"
                              onClick={() => updateItem(it.rowId, { quantity: it.quantity + 1 })}
                              aria-label="Increase quantity"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </td>
                        <td className="py-3 px-2 text-right text-gray-700">{fmt(it.partPrice)}</td>
                        <td className="py-3 px-2">
                          <Input
                            type="number"
                            min={0}
                            step={0.25}
                            value={it.laborHours}
                            onChange={(e) =>
                              updateItem(it.rowId, { laborHours: Math.max(0, parseFloat(e.target.value || "0") || 0) })
                            }
                            className="h-8 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            data-testid={`wizard-row-labor-${it.rowId}`}
                          />
                          <div className="text-[10px] text-gray-500 mt-1">
                            × {fmt(laborRate)}/hr = {fmt(it.laborHours * it.quantity * laborRate)}
                          </div>
                        </td>
                        <td
                          className="py-3 px-2 text-right font-semibold text-gray-900"
                          data-testid={`wizard-row-total-${it.rowId}`}
                        >
                          {fmt(lineTotal)}
                        </td>
                        <td className="py-3 pr-2 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeItem(it.rowId)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            data-testid={`wizard-row-delete-${it.rowId}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Mobile cards */}
      {!empty && (
        <div className="md:hidden space-y-3">
          {items.map((it, idx) => {
            const lineTotal = it.partPrice * it.quantity + it.laborHours * it.quantity * laborRate;
            return (
              <Card key={it.rowId} data-testid={`wizard-card-${it.rowId}`}>
                <CardContent className="p-3 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => openChange(it.rowId)}
                      className="text-left font-semibold text-gray-900 hover:text-blue-700 inline-flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 rounded"
                    >
                      {it.partName}
                      <Pencil className="w-3 h-3 text-gray-400" />
                    </button>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => moveItem(it.rowId, -1)}
                        disabled={idx === 0}
                        aria-label="Move up"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => moveItem(it.rowId, 1)}
                        disabled={idx === items.length - 1}
                        aria-label="Move down"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  <Input
                    value={it.description}
                    onChange={(e) => updateItem(it.rowId, { description: e.target.value })}
                    placeholder="Description (optional)"
                    className="h-9 text-sm focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                  />
                  <div className="grid grid-cols-2 max-[400px]:grid-cols-1 gap-2">
                    <div>
                      <div className="text-[10px] text-gray-500 uppercase mb-1">Qty</div>
                      <div className="inline-flex items-center border rounded-md">
                        <button
                          type="button"
                          className="p-2 hover:bg-gray-50"
                          onClick={() => updateItem(it.rowId, { quantity: Math.max(1, it.quantity - 1) })}
                          aria-label="Decrease quantity"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <Input
                          type="number"
                          min={1}
                          value={it.quantity}
                          onChange={(e) =>
                            updateItem(it.rowId, { quantity: Math.max(1, parseInt(e.target.value || "1") || 1) })
                          }
                          className="h-8 w-12 text-center border-0 px-0 focus-visible:ring-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        />
                        <button
                          type="button"
                          className="p-2 hover:bg-gray-50"
                          onClick={() => updateItem(it.rowId, { quantity: it.quantity + 1 })}
                          aria-label="Increase quantity"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-gray-500 uppercase mb-1">Unit price</div>
                      <div className="h-9 px-3 flex items-center text-sm text-gray-700 bg-gray-50 border rounded-md">
                        {fmt(it.partPrice)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-gray-500 uppercase mb-1">Labor hrs</div>
                      <Input
                        type="number"
                        min={0}
                        step={0.25}
                        value={it.laborHours}
                        onChange={(e) =>
                          updateItem(it.rowId, { laborHours: Math.max(0, parseFloat(e.target.value || "0") || 0) })
                        }
                        className="h-9 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <div className="text-[10px] text-gray-500 mt-1">
                        × {fmt(laborRate)}/hr = {fmt(it.laborHours * it.quantity * laborRate)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-gray-500 uppercase mb-1">Line total</div>
                      <div className="h-9 px-3 flex items-center text-sm font-semibold text-gray-900 bg-gray-50 border rounded-md">
                        {fmt(lineTotal)}
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeItem(it.rowId)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      Remove
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Desktop footer (mobile uses sheet footer) */}
      <div className="hidden sm:flex justify-between items-center gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onBack} data-testid="wizard-back-2">
          ← Back
        </Button>
        <div className="flex items-center gap-3">
          {empty && (
            <span className="text-xs text-gray-500" data-testid="wizard-continue-2-helper">
              Add at least one part to continue.
            </span>
          )}
          <Button
            type="button"
            onClick={onContinue}
            disabled={empty}
            className="bg-blue-600 hover:bg-blue-700 text-white"
            data-testid="wizard-continue-2"
          >
            Continue to Review
          </Button>
        </div>
      </div>

      <EstimateWizardPartPicker
        open={pickerOpen}
        onOpenChange={(open) => {
          setPickerOpen(open);
          if (!open) setChangeRowId(null);
        }}
        mode={pickerMode}
        onPick={handlePartPicked}
      />
    </div>
  );
}
