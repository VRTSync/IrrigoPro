import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Estimate } from "@shared/schema";
import type { LifecycleStatus } from "@shared/lifecycle";
import { EstimateListStatusBadge } from "./estimate-list-status-badge";

interface Props {
  estimate: Estimate;
  lifecycle: LifecycleStatus;
  onOpen: (id: number) => void;
  onEdit: (id: number) => void;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

function ageLabel(date: string | Date | null | undefined): string {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
  if (days < 1) return "today";
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}

export function EstimateListRow({ estimate, lifecycle, onOpen, onEdit }: Props) {
  const isExpired = lifecycle === "expired";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(estimate.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(estimate.id);
        }
      }}
      className="grid grid-cols-[2fr_1fr_1.5fr_1fr_auto] gap-4 items-center px-4 py-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
      data-testid={`list-row-${estimate.id}`}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-gray-900 truncate">{estimate.customerName}</div>
        <div className="text-xs text-gray-500 truncate">{estimate.estimateNumber}</div>
      </div>
      <div className="text-sm font-semibold text-gray-900">
        {fmt(parseFloat(estimate.totalAmount))}
      </div>
      <div>
        <EstimateListStatusBadge status={lifecycle} />
      </div>
      <div className="text-sm text-gray-500">
        {ageLabel(estimate.estimateDate ?? estimate.createdAt)}
      </div>
      <div className="text-right" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onOpen(estimate.id)}>Open</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEdit(estimate.id)}>Edit</DropdownMenuItem>
            <DropdownMenuItem
              disabled
              title={isExpired ? "Resend coming next" : "Only available for expired estimates"}
            >
              Resend
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
