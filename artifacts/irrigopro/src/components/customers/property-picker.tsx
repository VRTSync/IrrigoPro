import type { ReactNode } from "react";
import { Droplets, GitBranch, ArrowLeft } from "lucide-react";

// Shared property-picking pieces. Used by the wet-check customer picker and
// the Document System location step (and later the documenter picker).

export interface CustomerCardProps {
  name: string;
  address: string | null | undefined;
  branchCount: number;
  /** Shown beside the name (e.g. the wet-check "Resume" badge). */
  badge?: ReactNode;
  /** Gives the in-progress ring. */
  highlighted?: boolean;
  onClick: () => void;
  testId?: string;
  /** Optional right-hand status element. */
  trailing?: ReactNode;
  /** Optional footer line under the card body. */
  footer?: ReactNode;
}

export function CustomerCard({
  name, address, branchCount, badge, highlighted, onClick, testId, trailing, footer,
}: CustomerCardProps) {
  return (
    <button
      onClick={onClick}
      className={[
        "w-full max-w-full text-left rounded-xl border bg-white p-4 shadow-sm transition-all",
        "hover:shadow-md hover:-translate-y-px active:translate-y-0 active:shadow-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
        highlighted ? "border-blue-400 ring-2 ring-blue-200" : "border-gray-200",
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 truncate">{name}</span>
            {badge}
          </div>
          <p className="text-sm text-gray-500 mt-0.5 truncate">
            {address ?? "No address on file"}
          </p>
          {branchCount > 0 && (
            <p className="text-xs text-indigo-600 mt-0.5 flex items-center gap-1">
              <GitBranch className="h-3 w-3" />
              {branchCount} branch{branchCount !== 1 ? "es" : ""}
            </p>
          )}
        </div>
        {trailing}
      </div>
      {footer}
    </button>
  );
}

export interface BranchPickerProps {
  title: string;
  intro: ReactNode;
  branches: string[];
  badgeFor?: (branch: string) => ReactNode;
  /** Branches that get the highlighted ring. */
  highlightFor?: (branch: string) => boolean;
  onSelect: (branchName: string) => void;
  onBack: () => void;
  backLabel?: string;
  /** Optional customer header card. */
  customerName?: string;
  customerAddress?: string | null;
}

export function BranchPicker({
  title, intro, branches, badgeFor, highlightFor, onSelect, onBack,
  backLabel = "Back to Customers", customerName, customerAddress,
}: BranchPickerProps) {
  return (
    <div className="max-w-4xl mx-auto py-4 space-y-4 px-4 sm:px-4 pb-nav-safe overflow-x-hidden w-full">
      <div className="flex items-center gap-3">
        <Droplets className="h-6 w-6 text-blue-600 shrink-0" />
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
      </div>

      <button
        className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800"
        onClick={onBack}
        data-testid="branch-picker-back"
      >
        <ArrowLeft className="h-4 w-4" />
        {backLabel}
      </button>

      {customerName !== undefined && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm font-semibold text-gray-900">{customerName}</p>
          <p className="text-xs text-gray-500 mt-0.5">{customerAddress ?? "No address"}</p>
        </div>
      )}

      <p className="text-sm text-gray-600">{intro}</p>

      <div className="space-y-2" data-testid="branch-list">
        {branches.map((branch) => {
          const highlighted = highlightFor?.(branch) === true;
          return (
            <button
              key={branch}
              onClick={() => onSelect(branch)}
              className={[
                "w-full text-left rounded-xl border-2 bg-white p-4 shadow-sm transition-all",
                "hover:border-blue-400 hover:bg-blue-50",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                highlighted ? "border-blue-400 ring-2 ring-blue-200" : "border-gray-200",
              ].join(" ")}
              data-testid={`branch-option-${branch}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center">
                    <GitBranch className="h-4 w-4 text-indigo-600" />
                  </div>
                  <span className="font-semibold text-gray-900 truncate">{branch}</span>
                </div>
                {badgeFor?.(branch)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
