import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Package, Plus, Trash2, BookOpen } from "lucide-react";
import { PartsSearchModal } from "@/components/estimates/parts-search-modal";
import type { Part } from "@shared/schema";

export interface EditPartRow {
  partId?: number | null;
  partName: string;
  quantity: string;
  unitPrice: string;
  laborHours?: string;
  zoneId?: number | null;
  notes?: string;
}

interface EditPartsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialParts: EditPartRow[];
  onSave: (parts: EditPartRow[]) => void;
  title?: string;
}

export function EditPartsModal({
  open,
  onOpenChange,
  initialParts,
  onSave,
  title = "Edit Parts List",
}: EditPartsModalProps) {
  const [parts, setParts] = useState<EditPartRow[]>(initialParts);
  const [showLibrary, setShowLibrary] = useState(false);

  useEffect(() => {
    if (open) setParts(initialParts);
  }, [open]);

  const partsTotal = parts.reduce(
    (sum, p) => sum + (Number(p.quantity) || 0) * (Number(p.unitPrice) || 0),
    0
  );

  const handleSelectFromLibrary = (part: Part, qty?: number) => {
    setParts((prev) => {
      const existing = prev.findIndex((p) => p.partId === part.id);
      if (existing >= 0) {
        return prev.map((p, i) =>
          i === existing
            ? { ...p, quantity: String((Number(p.quantity) || 0) + (qty || 1)) }
            : p
        );
      }
      return [
        ...prev,
        {
          partId: part.id,
          partName: part.name,
          quantity: String(qty || 1),
          unitPrice: String(parseFloat(part.price) || 0),
          laborHours: String(part.laborHours || 0),
          zoneId: null,
          notes: "",
        },
      ];
    });
  };

  const addManualPart = () => {
    setParts((prev) => [
      ...prev,
      { partId: null, partName: "", quantity: "1", unitPrice: "0", laborHours: "0", zoneId: null, notes: "" },
    ]);
  };

  const removePart = (index: number) => {
    setParts((prev) => prev.filter((_, i) => i !== index));
  };

  const updatePart = (index: number, field: keyof EditPartRow, value: string) => {
    setParts((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p))
    );
  };

  const handleDone = () => {
    onSave(parts.filter((p) => p.partName.trim()));
    onOpenChange(false);
  };

  const handleCancel = () => {
    setParts(initialParts);
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleCancel}>
        <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-hidden p-0 flex flex-col">
          <DialogHeader className="flex-shrink-0 px-5 py-4 border-b border-gray-100 bg-gray-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Package className="w-4 h-4 text-blue-600" />
                </div>
                <DialogTitle className="text-base font-bold text-gray-900">{title}</DialogTitle>
              </div>
              {parts.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {parts.length} part{parts.length !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Action buttons */}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowLibrary(true)}
                className="gap-1.5 text-blue-600 border-blue-200 hover:bg-blue-50 hover:border-blue-300"
              >
                <BookOpen className="w-4 h-4" />
                Add from Library
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addManualPart}
                className="gap-1.5"
              >
                <Plus className="w-4 h-4" />
                Add Manual Part
              </Button>
            </div>

            {/* Parts table */}
            {parts.length > 0 ? (
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-3 py-2.5 font-medium text-gray-600">Part Name</th>
                      <th className="text-left px-3 py-2.5 font-medium text-gray-600 w-20">Qty</th>
                      <th className="text-left px-3 py-2.5 font-medium text-gray-600 w-28">Unit Price</th>
                      <th className="text-right px-3 py-2.5 font-medium text-gray-600 w-24">Total</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {parts.map((part, index) => {
                      const lineTotal =
                        (Number(part.quantity) || 0) * (Number(part.unitPrice) || 0);
                      return (
                        <tr key={index} className="bg-white hover:bg-gray-50/50">
                          <td className="px-3 py-2">
                            <Input
                              value={part.partName}
                              onChange={(e) => updatePart(index, "partName", e.target.value)}
                              placeholder="Part name"
                              className="h-8 text-sm border-gray-200"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              type="number"
                              min="0"
                              step="1"
                              value={part.quantity}
                              onChange={(e) => updatePart(index, "quantity", e.target.value)}
                              className="h-8 text-sm border-gray-200"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={part.unitPrice}
                              onChange={(e) => updatePart(index, "unitPrice", e.target.value)}
                              placeholder="0.00"
                              className="h-8 text-sm border-gray-200"
                            />
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-gray-800">
                            ${lineTotal.toFixed(2)}
                          </td>
                          <td className="px-2 py-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removePart(index)}
                              className="h-8 w-8 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 border-t border-gray-200">
                      <td colSpan={3} className="px-3 py-2.5 text-right text-sm font-semibold text-gray-700">
                        Parts Total:
                      </td>
                      <td className="px-3 py-2.5 text-right text-sm font-bold text-gray-900">
                        ${partsTotal.toFixed(2)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="text-center py-10 border-2 border-dashed border-gray-200 rounded-xl">
                <Package className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500 font-medium">No parts added yet</p>
                <p className="text-xs text-gray-400 mt-1">
                  Use "Add from Library" to pick from your parts catalog, or "Add Manual Part" for custom items.
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex-shrink-0 border-t border-gray-100 px-5 py-3 bg-gray-50">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">
                {parts.length} part{parts.length !== 1 ? "s" : ""} · ${partsTotal.toFixed(2)} total
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={handleCancel}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleDone}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  Done
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <PartsSearchModal
        open={showLibrary}
        onOpenChange={setShowLibrary}
        onSelectPart={handleSelectFromLibrary}
      />
    </>
  );
}
