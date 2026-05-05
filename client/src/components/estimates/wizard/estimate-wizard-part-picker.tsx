import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Package, X, Check } from "lucide-react";
import type { Part } from "@shared/schema";

interface EstimateWizardPartPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "add" | "change";
  onPick: (part: Part) => void;
}

const RENDER_CAP = 200;

export function EstimateWizardPartPicker({ open, onOpenChange, mode, onPick }: EstimateWizardPartPickerProps) {
  const { data: parts = [] } = useQuery<Part[]>({
    queryKey: ["/api/parts"],
    enabled: open,
  });

  const [rawSearch, setRawSearch] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("__all__");
  const [activeIdx, setActiveIdx] = useState(0);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Reset state when picker opens.
  useEffect(() => {
    if (open) {
      setRawSearch("");
      setSearch("");
      setCategory("__all__");
      setActiveIdx(0);
      setJustAdded(null);
      // Autofocus search after the sheet animates in.
      const t = setTimeout(() => searchRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Debounce search input by 200ms.
  useEffect(() => {
    const t = setTimeout(() => setSearch(rawSearch), 200);
    return () => clearTimeout(t);
  }, [rawSearch]);

  // Auto-clear the "Added: X" confirmation after a beat.
  useEffect(() => {
    if (!justAdded) return;
    const t = setTimeout(() => setJustAdded(null), 1400);
    return () => clearTimeout(t);
  }, [justAdded]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of parts) {
      const c = (p.category ?? "").trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [parts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const words = q ? q.split(/\s+/) : [];
    return parts.filter((p) => {
      if (category !== "__all__" && (p.category ?? "") !== category) return false;
      if (words.length === 0) return true;
      return words.every((w) =>
        p.name.toLowerCase().includes(w) ||
        (p.description ?? "").toLowerCase().includes(w) ||
        (p.sku ?? "").toLowerCase().includes(w),
      );
    });
  }, [parts, search, category]);

  const visible = filtered.slice(0, RENDER_CAP);
  const overflow = filtered.length > RENDER_CAP;

  // Keep activeIdx in range when filter results shrink.
  useEffect(() => {
    setActiveIdx((i) => (visible.length === 0 ? 0 : Math.min(i, visible.length - 1)));
  }, [visible.length]);

  const handlePick = (p: Part) => {
    onPick(p);
    if (mode === "change") {
      onOpenChange(false);
    } else {
      setJustAdded(p.name);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      setActiveIdx((i) => Math.min(i + 1, visible.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const p = visible[activeIdx];
      if (p) {
        e.preventDefault();
        e.stopPropagation();
        handlePick(p);
      }
    } else if (e.key === "Escape") {
      // Let Sheet's own dismiss handle the close, but stop propagation so the
      // wizard never sees this Esc and never opens its discard dialog.
      e.stopPropagation();
    }
  };

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  const headerLabel = mode === "add" ? "Add part" : "Change part";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="p-0 w-screen sm:max-w-md md:max-w-lg sm:w-full flex flex-col h-full"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <div className="bg-blue-50 p-2 rounded-md">
              <Package className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <div className="text-base font-semibold text-gray-900" data-testid="part-picker-title">
                {headerLabel}
              </div>
              <div className="text-xs text-gray-500">From parts catalog</div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            data-testid="part-picker-close"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="px-4 py-3 border-b space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              ref={searchRef}
              placeholder="Search parts..."
              value={rawSearch}
              onChange={(e) => setRawSearch(e.target.value)}
              className="pl-10 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
              data-testid="part-picker-search"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            <button
              type="button"
              onClick={() => setCategory("__all__")}
              className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
                category === "__all__"
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
              }`}
              data-testid="part-picker-cat-all"
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
                  category === c
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                }`}
                data-testid={`part-picker-cat-${c}`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto">
          {visible.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">
              <Package className="w-10 h-10 mx-auto mb-3 text-gray-300" />
              No parts match.
            </div>
          ) : (
            <ul className="divide-y">
              {visible.map((p, idx) => {
                const active = idx === activeIdx;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => handlePick(p)}
                      onMouseEnter={() => setActiveIdx(idx)}
                      className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
                        active ? "bg-blue-50" : ""
                      }`}
                      data-testid={`part-picker-row-${p.id}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 truncate">{p.name}</div>
                        <div className="mt-0.5 flex items-center gap-2">
                          {p.category && (
                            <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                              {p.category}
                            </Badge>
                          )}
                          {p.sku && <span className="text-xs text-gray-500 truncate">{p.sku}</span>}
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-gray-900 shrink-0">
                        {formatCurrency(parseFloat(p.price ?? "0") || 0)}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {overflow && (
            <div className="p-3 text-center text-xs text-gray-500 border-t">
              Refine your search to see more
            </div>
          )}
        </div>

        {mode === "add" && (
          <div className="border-t px-4 py-3 flex items-center justify-between gap-3">
            <div className="text-xs min-h-[20px] flex items-center" aria-live="polite">
              {justAdded && (
                <span
                  className="inline-flex items-center gap-1 text-green-700 transition-opacity"
                  data-testid="part-picker-added"
                >
                  <Check className="w-3.5 h-3.5" />
                  Added: {justAdded}
                </span>
              )}
            </div>
            <Button
              type="button"
              onClick={() => onOpenChange(false)}
              className="bg-blue-600 hover:bg-blue-700 text-white"
              data-testid="part-picker-done"
            >
              Done
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
