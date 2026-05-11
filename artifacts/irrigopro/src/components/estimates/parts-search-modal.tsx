import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Package, Plus, X, Check } from "lucide-react";
import type { Part } from "@shared/schema";

export type PartsSearchPresentation = "dialog" | "sheet";
export type PartsSearchSelectMode = "single" | "multi";

interface PartsSearchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectPart: (part: Part, quantity?: number) => void;
  /**
   * "dialog" (default) — centered modal with popular parts and full part rows.
   * "sheet" — right-side slide-in used by the estimate wizard.
   */
  presentation?: PartsSearchPresentation;
  /**
   * "single" (default) — picks a part and closes immediately.
   * "multi" — keeps the picker open, shows an "Added: X" confirmation, and
   * surfaces a Done button to dismiss.
   */
  selectMode?: PartsSearchSelectMode;
  /** Show category filter chips above the list. */
  showCategoryChips?: boolean;
  /** Enable arrow-key navigation + Enter to select. */
  keyboardNav?: boolean;
  /** Show the "Frequently Used Parts" section (dialog only). */
  showPopular?: boolean;
  /** Override the modal/sheet title. */
  title?: string;
}

const RENDER_CAP = 200;

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);

export function PartsSearchModal({
  open,
  onOpenChange,
  onSelectPart,
  presentation = "dialog",
  selectMode = "single",
  showCategoryChips = false,
  keyboardNav = false,
  showPopular,
  title,
}: PartsSearchModalProps) {
  const popularEnabled = showPopular ?? presentation === "dialog";
  const resolvedTitle =
    title ?? (presentation === "sheet" ? "Add part" : "Add Parts to Billing Sheet");

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState<string>("__all__");
  const [activeIdx, setActiveIdx] = useState(0);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const { data: parts, isLoading } = useQuery<Part[]>({
    queryKey: ["/api/parts"],
    enabled: open,
  });

  const { data: popularParts } = useQuery<(Part & { usageCount: number })[]>({
    queryKey: ["/api/parts/popular"],
    enabled: open && popularEnabled,
  });

  // Reset state on open.
  useEffect(() => {
    if (open) {
      setSearchQuery("");
      setDebouncedSearch("");
      setCategory("__all__");
      setActiveIdx(0);
      setJustAdded(null);
      if (presentation === "sheet") {
        const t = setTimeout(() => searchRef.current?.focus(), 50);
        return () => clearTimeout(t);
      }
    }
    return undefined;
  }, [open, presentation]);

  // Debounce search by 200ms.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 200);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Auto-clear "Added: X" confirmation.
  useEffect(() => {
    if (!justAdded) return;
    const t = setTimeout(() => setJustAdded(null), 1400);
    return () => clearTimeout(t);
  }, [justAdded]);

  const categories = useMemo(() => {
    if (!showCategoryChips) return [];
    const set = new Set<string>();
    for (const p of parts ?? []) {
      const c = (p.category ?? "").trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [parts, showCategoryChips]);

  const filteredParts = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const words = q ? q.split(/\s+/).filter(Boolean) : [];
    return (parts ?? []).filter((part) => {
      if (showCategoryChips && category !== "__all__" && (part.category ?? "") !== category) {
        return false;
      }
      if (words.length === 0) return true;
      return words.every(
        (w) =>
          part.name.toLowerCase().includes(w) ||
          (part.description ?? "").toLowerCase().includes(w) ||
          (part.sku ?? "").toLowerCase().includes(w),
      );
    });
  }, [parts, debouncedSearch, category, showCategoryChips]);

  const visible = presentation === "sheet" ? filteredParts.slice(0, RENDER_CAP) : filteredParts;
  const overflow = presentation === "sheet" && filteredParts.length > RENDER_CAP;

  // Keep activeIdx in range.
  useEffect(() => {
    setActiveIdx((i) => (visible.length === 0 ? 0 : Math.min(i, visible.length - 1)));
  }, [visible.length]);

  // Scroll active row into view.
  useEffect(() => {
    if (!keyboardNav) return;
    rowRefs.current[activeIdx]?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, keyboardNav]);

  const handleSelectPart = (part: Part) => {
    onSelectPart(part, 1);
    if (selectMode === "multi") {
      setJustAdded(part.name);
    } else {
      onOpenChange(false);
      setSearchQuery("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!keyboardNav) return;
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
        handleSelectPart(p);
      }
    } else if (e.key === "Escape") {
      // Let Sheet/Dialog handle dismiss; stop propagation so any outer wizard
      // never sees this Esc and never opens its discard dialog.
      e.stopPropagation();
    }
  };

  // ---------- Sheet presentation (wizard-style) ----------
  if (presentation === "sheet") {
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
                <div
                  className="text-base font-semibold text-gray-900"
                  data-testid="part-picker-title"
                >
                  {resolvedTitle}
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
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                data-testid="part-picker-search"
              />
            </div>
            {showCategoryChips && (
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
            )}
            <div className="text-xs text-gray-500" data-testid="part-picker-count">
              {filteredParts.length === 0
                ? "No matches"
                : overflow
                ? `Showing first ${RENDER_CAP} of ${filteredParts.length} matches — refine your search to narrow down`
                : `Showing ${filteredParts.length} of ${(parts ?? []).length} parts`}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
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
                        ref={(el) => {
                          rowRefs.current[idx] = el;
                        }}
                        onClick={() => handleSelectPart(p)}
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
                            {p.sku && (
                              <span className="text-xs text-gray-500 truncate">{p.sku}</span>
                            )}
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
          </div>

          {selectMode === "multi" && (
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

  // ---------- Dialog presentation (default) ----------
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{resolvedTitle}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              ref={searchRef}
              placeholder="Search parts catalog..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Category chips (optional) */}
          {showCategoryChips && categories.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => setCategory("__all__")}
                className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  category === "__all__"
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                }`}
              >
                All
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    category === c
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          {/* Popular Parts Section */}
          {popularEnabled && !searchQuery && popularParts && popularParts.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-900 flex items-center gap-2">
                <Package className="w-4 h-4 text-blue-600" />
                Frequently Used Parts
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {popularParts.slice(0, 6).map((part) => (
                  <button
                    key={part.id}
                    onClick={() => handleSelectPart(part)}
                    className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-all text-left group"
                  >
                    <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center group-hover:bg-blue-200">
                      <Package className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{part.name}</div>
                      <div className="text-xs text-gray-500">Used {part.usageCount} times</div>
                    </div>
                    <Plus className="w-4 h-4 text-gray-400 group-hover:text-blue-600" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* All Parts List */}
          <div className="space-y-3">
            {!searchQuery && (
              <h3 className="text-sm font-medium text-gray-900">All Parts Catalog</h3>
            )}
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-4 border border-gray-200 rounded-lg"
                  >
                    <div className="flex items-center space-x-4">
                      <Skeleton className="h-10 w-10 rounded-lg" />
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-48" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </div>
                    <div className="text-right space-y-2">
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-8 w-12" />
                    </div>
                  </div>
                ))
              ) : (
                filteredParts.map((part) => (
                  <div
                    key={part.id}
                    className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
                  >
                    <div className="flex items-center space-x-4">
                      <div className="bg-blue-50 p-2 rounded-lg">
                        <Package className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{part.name}</p>
                        <p className="text-sm text-gray-600">{part.description}</p>
                        <p className="text-xs text-gray-500">SKU: {part.sku}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-gray-900">
                        {formatCurrency(parseFloat(part.price))}
                      </p>
                      <Button
                        onClick={() => handleSelectPart(part)}
                        className="mt-2 bg-primary text-white hover:bg-blue-700"
                        size="sm"
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        Add
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Empty State */}
            {!isLoading && filteredParts.length === 0 && (
              <div className="text-center py-8">
                <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">
                  {searchQuery ? "No parts match your search criteria." : "No parts available."}
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
