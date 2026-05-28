import { useEffect, useMemo, useRef, useState } from "react";
import { useArrayQuery } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Package, Plus, X, Check } from "lucide-react";
import type { Part } from "@workspace/db/schema";
import { normalisePart, normaliseForSearch, searchParts, type NormalisedPart } from "./part-search";

export type PartPickerPresentation = "dialog" | "sheet";
export type PartPickerSelectMode = "single" | "multi";

export interface PartPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectPart: (part: Part, quantity?: number) => void;
  /**
   * "sheet" — right-side slide-in (full-screen below sm).
   * "dialog" (default) — centered modal (max-w-2xl max-h-[85vh]).
   */
  presentation?: PartPickerPresentation;
  /**
   * "single" (default) — picks and closes immediately.
   * "multi" — stays open, shows 1400ms "Added: X" confirmation, Done button.
   */
  selectMode?: PartPickerSelectMode;
  /** Show category filter chips above the list. */
  showCategoryChips?: boolean;
  /** Enable ArrowUp/Down/Enter/Escape keyboard navigation. */
  keyboardNav?: boolean;
  /** Hard-filter results to this category (case-insensitive NFKD). */
  categoryFilter?: string | null;
  /** Show "— No part —" row at the top; calls onClear + closes. */
  allowClear?: boolean;
  /** Called when the user picks "— No part —". */
  onClear?: () => void;
  /** Override the title. Default: "Add Parts" */
  title?: string;
  /**
   * Whether to show the "Frequently Used" recents section when the query is
   * empty. Default: true.
   */
  showRecents?: boolean;
}

const RENDER_CAP = 200;
const RECENTS_LIMIT = 6;

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);

export function PartPicker({
  open,
  onOpenChange,
  onSelectPart,
  presentation = "dialog",
  selectMode = "single",
  showCategoryChips = false,
  keyboardNav = false,
  categoryFilter,
  allowClear = false,
  onClear,
  title = "Add Parts",
  showRecents: showRecentsProp = true,
}: PartPickerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState<string>("__all__");
  const [activeIdx, setActiveIdx] = useState(0);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // ── Catalog fetch ──────────────────────────────────────────────────────────
  const { data: parts = [], isLoading } = useArrayQuery<Part>({
    queryKey: ["/api/parts"],
    enabled: open,
  });

  // Recents: /api/parts/popular returns { id, companyId, name, description,
  // sku, category, price, usageCount } only — no brand/material/size/etc.
  const { data: recentParts = [] } = useArrayQuery<Part & { usageCount: number }>({
    queryKey: ["/api/parts/popular"],
    enabled: open,
  });

  // ── Normalise catalog (memoised against the query result reference) ────────
  const normalisedParts = useMemo<NormalisedPart[]>(
    () => parts.map(normalisePart),
    [parts],
  );

  // ── Reset on open ─────────────────────────────────────────────────────────
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

  // ── 150ms debounce ────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 150);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // ── Auto-clear "Added" confirmation after 1400ms ──────────────────────────
  useEffect(() => {
    if (!justAdded) return;
    const t = setTimeout(() => setJustAdded(null), 1400);
    return () => clearTimeout(t);
  }, [justAdded]);

  // ── Category chips (from full catalog) ────────────────────────────────────
  const categories = useMemo(() => {
    if (!showCategoryChips) return [];
    const set = new Set<string>();
    for (const p of parts) {
      const c = (p.category ?? "").trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [parts, showCategoryChips]);

  // ── Token-ranked search ────────────────────────────────────────────────────
  const activeCategory = showCategoryChips && category !== "__all__" ? category : null;
  const effectiveCategoryFilter = categoryFilter ?? activeCategory;

  const searchResults = useMemo<Part[]>(() => {
    return searchParts(normalisedParts, debouncedSearch, {
      categoryFilter: effectiveCategoryFilter ?? undefined,
    });
  }, [normalisedParts, debouncedSearch, effectiveCategoryFilter]);

  // Recents filtered by hard category filter (chip-driven filter is not applied
  // since recents are shown on empty query only — chips filter the full list).
  const filteredRecents = useMemo(() => {
    if (!categoryFilter) return recentParts;
    const cat = normaliseForSearch(categoryFilter);
    return recentParts.filter(
      (p) => normaliseForSearch(p.category) === cat,
    );
  }, [recentParts, categoryFilter]);

  const isQueryEmpty = debouncedSearch.trim() === "";
  // showRecents: prop gate + empty query + recents available
  const showRecentsSection = showRecentsProp && isQueryEmpty && filteredRecents.length > 0;

  // Always show the full catalog list (capped at RENDER_CAP).
  // When query is empty, recents appear above it as an additional section.
  const visibleResults = searchResults.slice(0, RENDER_CAP);
  const overflow = searchResults.length > RENDER_CAP;

  // ── Keep activeIdx in range ───────────────────────────────────────────────
  useEffect(() => {
    setActiveIdx((i) => (visibleResults.length === 0 ? 0 : Math.min(i, visibleResults.length - 1)));
  }, [visibleResults.length]);

  // ── Scroll active row into view ───────────────────────────────────────────
  useEffect(() => {
    if (!keyboardNav) return;
    rowRefs.current[activeIdx]?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, keyboardNav]);

  // ── Select handler ────────────────────────────────────────────────────────
  const handleSelectPart = (part: Part) => {
    onSelectPart(part, 1);
    if (selectMode === "multi") {
      setJustAdded(part.name);
    } else {
      onOpenChange(false);
      setSearchQuery("");
    }
  };

  const handleClear = () => {
    onClear?.();
    onOpenChange(false);
  };

  // ── Keyboard nav ──────────────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!keyboardNav) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      setActiveIdx((i) => Math.min(i + 1, visibleResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const p = visibleResults[activeIdx];
      if (p) {
        e.preventDefault();
        e.stopPropagation();
        handleSelectPart(p);
      }
    } else if (e.key === "Escape") {
      e.stopPropagation();
    }
  };

  // ── Shared inner content ───────────────────────────────────────────────────

  const searchBar = (
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
  );

  const categoryChips = showCategoryChips && categories.length > 0 ? (
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
  ) : null;

  const countLine = (
    <div className="text-xs text-gray-500" data-testid="part-picker-count">
      {searchResults.length === 0
        ? "No matches"
        : overflow
        ? `Showing first ${RENDER_CAP} of ${searchResults.length} matches — refine your search to narrow down`
        : `Showing ${searchResults.length} of ${parts.length} parts`}
    </div>
  );

  const skeletons = isLoading ? (
    <div className="space-y-2 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-2">
          <Skeleton className="h-8 w-8 rounded" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-36" />
            <Skeleton className="h-2.5 w-24" />
          </div>
          <Skeleton className="h-4 w-12" />
        </div>
      ))}
    </div>
  ) : null;

  // "— No part —" clear row — shown whenever allowClear is true, regardless
  // of whether recents or results are displayed. This ensures the affordance
  // is always reachable on FindingCard where clearing is a first-class action.
  const clearRow = allowClear ? (
    <button
      type="button"
      onClick={handleClear}
      className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 border-b"
      data-testid="part-picker-clear"
    >
      <span className="text-gray-400 italic">— No part —</span>
    </button>
  ) : null;

  const recentsSection = showRecentsSection ? (
    <div className="p-4 space-y-3" data-testid="part-picker-recents">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-2">
        <Package className="w-3.5 h-3.5" />
        Frequently Used
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {filteredRecents.slice(0, RECENTS_LIMIT).map((part) => (
          <button
            key={part.id}
            type="button"
            onClick={() => handleSelectPart(part)}
            className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-all text-left group"
            data-testid={`part-picker-recent-${part.id}`}
          >
            <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center group-hover:bg-blue-200 shrink-0">
              <Package className="w-4 h-4 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate">{part.name}</div>
              <div className="text-xs text-gray-500">
                {part.usageCount != null ? `Used ${part.usageCount} times` : ""}
                {part.sku ? (part.usageCount != null ? " · " : "") + part.sku : ""}
              </div>
            </div>
            <Plus className="w-4 h-4 text-gray-400 group-hover:text-blue-600 shrink-0" />
          </button>
        ))}
      </div>
    </div>
  ) : null;

  const partRows = !isLoading ? (
    visibleResults.length === 0 ? (
      <div className="p-8 text-center text-sm text-gray-500" data-testid="part-picker-empty">
        <Package className="w-10 h-10 mx-auto mb-3 text-gray-300" />
        No parts match.
      </div>
    ) : (
      <ul className="divide-y" data-testid="part-picker-results">
        {visibleResults.map((p, idx) => {
          const active = idx === activeIdx;
          return (
            <li key={p.id}>
              <button
                type="button"
                ref={(el) => { rowRefs.current[idx] = el; }}
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
    )
  ) : null;

  const multiFooter = selectMode === "multi" ? (
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
  ) : null;

  // ══════════════════════════════════════════════════════════════════════════
  // Sheet presentation
  // ══════════════════════════════════════════════════════════════════════════
  if (presentation === "sheet") {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="p-0 w-screen sm:max-w-md md:max-w-lg sm:w-full flex flex-col h-full"
          onKeyDown={handleKeyDown}
        >
          {/* Header */}
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
                  {title}
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

          {/* Controls */}
          <div className="px-4 py-3 border-b space-y-3">
            {searchBar}
            {categoryChips}
            {countLine}
          </div>

          {/* Clear row — always visible when allowClear */}
          {clearRow}

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {skeletons}
            {recentsSection}
            {partRows}
          </div>

          {multiFooter}
        </SheetContent>
      </Sheet>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Dialog presentation (default)
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden p-0"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader className="px-5 py-4 border-b flex-shrink-0">
          <DialogTitle data-testid="part-picker-title">{title}</DialogTitle>
        </DialogHeader>

        {/* Controls */}
        <div className="px-5 py-3 border-b space-y-3 flex-shrink-0">
          {searchBar}
          {categoryChips}
          {countLine}
        </div>

        {/* Clear row — always visible when allowClear */}
        {clearRow}

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {skeletons}
          {recentsSection}
          {partRows}
        </div>

        {multiFooter}
      </DialogContent>
    </Dialog>
  );
}
