import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Estimate } from "@workspace/db/schema";
import type { LifecycleStatus } from "@/lib/lifecycle";
import { EstimateListStatusBadge } from "./estimate-list-status-badge";
import { authedPdfUrl } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Props {
  estimate: Estimate;
  lifecycle: LifecycleStatus;
  onOpen: (id: number) => void;
  onEdit: (id: number) => void;
  onResendClick?: (estimate: Estimate) => void;
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

export function EstimateListRow({ estimate, lifecycle, onOpen, onEdit, onResendClick }: Props) {
  const isExpired = lifecycle === "expired";
  const { toast } = useToast();
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  const handleViewPdf = () => {
    window.open(
      authedPdfUrl(`/api/estimates/${estimate.id}/pdf`),
      "_blank",
      "noopener,noreferrer",
    );
  };

  const handleDownloadPdf = async () => {
    if (isDownloadingPdf) return;
    setIsDownloadingPdf(true);
    try {
      const res = await fetch(
        authedPdfUrl(`/api/estimates/${estimate.id}/pdf`, { download: "1" }),
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `estimate-${estimate.estimateNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toast({
        title: "Couldn't download PDF",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDownloadingPdf(false);
    }
  };
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
              onClick={handleViewPdf}
              data-testid={`list-row-view-pdf-${estimate.id}`}
            >
              View PDF
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleDownloadPdf}
              data-testid={`list-row-download-pdf-${estimate.id}`}
            >
              Download PDF
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!isExpired || !onResendClick}
              title={isExpired ? "Resend to customer" : "Only available for expired estimates"}
              onClick={() => {
                if (isExpired && onResendClick) onResendClick(estimate);
              }}
              data-testid={`list-row-resend-${estimate.id}`}
            >
              Resend
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
