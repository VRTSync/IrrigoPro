import type { Estimate } from "@shared/schema";
import { EstimateBoardCard } from "./estimate-board-card";
import type { LifecycleStatus } from "@shared/lifecycle";

export interface ColumnTheme {
  status: LifecycleStatus;
  label: string;
  headerBg: string;
  headerText: string;
  badgeText: string;
}

export const COLUMN_THEMES: ColumnTheme[] = [
  {
    status: "draft",
    label: "Drafts",
    headerBg: "bg-gray-100",
    headerText: "text-gray-700",
    badgeText: "text-gray-700",
  },
  {
    status: "pending_review",
    label: "Pending review",
    headerBg: "bg-amber-50",
    headerText: "text-amber-700",
    badgeText: "text-amber-700",
  },
  {
    status: "sent",
    label: "Sent",
    headerBg: "bg-blue-50",
    headerText: "text-blue-700",
    badgeText: "text-blue-700",
  },
  {
    status: "approved",
    label: "Approved",
    headerBg: "bg-green-50",
    headerText: "text-green-700",
    badgeText: "text-green-700",
  },
  {
    status: "rejected",
    label: "Rejected",
    headerBg: "bg-red-50",
    headerText: "text-red-700",
    badgeText: "text-red-700",
  },
];

interface EstimateBoardColumnProps {
  theme: ColumnTheme;
  estimates: Estimate[];
  cap?: number | null;
  onCardClick: (estimateId: number) => void;
  onExpand?: () => void;
  showCap?: boolean;
}

export function EstimateBoardColumn({
  theme,
  estimates,
  cap = 6,
  onCardClick,
  onExpand,
  showCap = true,
}: EstimateBoardColumnProps) {
  const total = estimates.length;
  const effectiveCap = showCap && cap ? cap : total;
  const visible = estimates.slice(0, effectiveCap);
  const overflow = Math.max(0, total - visible.length);

  return (
    <div className="flex flex-col min-w-0" data-testid={`board-column-${theme.status}`}>
      <div
        className={`flex items-center justify-between px-3 py-2 rounded-t-md border border-b-0 border-gray-200 ${theme.headerBg}`}
      >
        <span className={`text-sm font-semibold ${theme.headerText}`}>
          {theme.label}
        </span>
        <span
          className={`inline-flex items-center justify-center min-w-6 h-5 px-1.5 rounded-full bg-white text-xs font-semibold ${theme.badgeText}`}
        >
          {total}
        </span>
      </div>
      <div className="flex flex-col gap-2 p-2 border border-gray-200 rounded-b-md bg-white min-h-[120px]">
        {visible.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-xs text-gray-400 py-6">
            No estimates
          </div>
        ) : (
          visible.map((est) => (
            <EstimateBoardCard
              key={est.id}
              estimate={est}
              onClick={onCardClick}
            />
          ))
        )}
        {overflow > 0 && onExpand && (
          <button
            type="button"
            onClick={onExpand}
            className="w-full text-xs text-blue-600 font-medium py-1.5 rounded hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
            data-testid={`board-column-${theme.status}-more`}
          >
            + {overflow} more
          </button>
        )}
      </div>
    </div>
  );
}
