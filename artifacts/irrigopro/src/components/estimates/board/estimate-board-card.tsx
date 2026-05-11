import type { Estimate } from "@workspace/db/schema";

interface EstimateBoardCardProps {
  estimate: Estimate;
  onClick: (estimateId: number) => void;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatRelativeAge(date: string | Date): string {
  const then = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(then.getTime())) return "";
  const ms = Date.now() - then.getTime();
  const days = Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
  if (days < 1) return "today";
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

export function EstimateBoardCard({ estimate, onClick }: EstimateBoardCardProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick(estimate.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      onClick(estimate.id);
    }
  };

  const dateValue = estimate.estimateDate ?? estimate.createdAt;
  const amount = parseFloat(estimate.totalAmount);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className="block w-full text-left bg-white border border-gray-200 rounded-md px-3 py-2 cursor-pointer transition-all hover:border-gray-300 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
      data-testid={`board-card-${estimate.id}`}
    >
      <div className="font-medium text-sm text-gray-900 truncate">
        {estimate.customerName}
      </div>
      <div className="flex items-center justify-between mt-1 text-xs">
        <span className="font-medium text-gray-700">
          {formatCurrency(Number.isFinite(amount) ? amount : 0)}
        </span>
        <span className="text-gray-500">{formatRelativeAge(dateValue)}</span>
      </div>
    </div>
  );
}
