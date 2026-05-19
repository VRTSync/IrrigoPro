import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, authedPdfUrl } from "@/lib/queryClient";
import type { Estimate } from "@workspace/db/schema";
import {
  canDeleteEstimateAs,
  isPendingReview,
  type LifecycleStatus,
} from "@/lib/lifecycle";
import { formatEstimateNumber, buildEstimatePdfFilename } from "@/lib/estimate-number";
import { EstimateListStatusBadge } from "./estimate-list-status-badge";
import { useToast } from "@/hooks/use-toast";

// Task #634 / #658 — the role × lifecycle delete matrix lives in
// `@/lib/lifecycle` (`canDeleteEstimateAs`) so this file and the
// estimate detail modal stay in lockstep. The server is still the
// authoritative gate.

function readCurrentUserRole(): string | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem("user");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { role?: string };
    return typeof parsed?.role === "string" ? parsed.role : null;
  } catch {
    return null;
  }
}

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
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Task #634 — super_admin "Show deleted" surfaces soft-deleted rows.
  // Render them muted and disable the active-row actions so they stay
  // audit-only.
  const deletedAtRaw = (estimate as { deletedAt?: Date | string | null }).deletedAt ?? null;
  const deletedByRaw = (estimate as { deletedBy?: number | null }).deletedBy ?? null;
  const isDeleted = deletedAtRaw != null;
  const deletedTooltip = isDeleted
    ? `Deleted${deletedByRaw != null ? ` by user #${deletedByRaw}` : ""}${
        deletedAtRaw
          ? ` on ${new Date(deletedAtRaw as string | Date).toLocaleString()}`
          : ""
      }`
    : undefined;

  // Task #634 / #638 — Delete is only available for draft estimates and
  // only to roles the server will accept. The `isDraft` lifecycle
  // predicate is the canonical "still a draft" signal — never read
  // `estimate.internalStatus` directly. Soft-deleted rows shouldn't
  // reach this list at all, but we still guard on deletedAt for
  // safety.
  const currentRole = readCurrentUserRole();
  const canDelete =
    canDeleteEstimateAs(currentRole, estimate) && !isDeleted;
  const isPendingDelete = canDelete && isPendingReview(estimate);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest(`/api/estimates/${estimate.id}`, "DELETE");
    },
    onSuccess: () => {
      toast({
        title: "Estimate deleted",
        description: `Estimate ${formatEstimateNumber(estimate.estimateNumber)} was deleted.`,
      });
      setShowDeleteDialog(false);
      // Task #634 — the deleted estimate may sit in any of these query
      // caches. `predicate` catches list keys with query-string suffixes
      // (e.g. `/api/estimates?includeDeleted=1`) that exact-match misses.
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey?.[0];
          return (
            typeof k === "string" &&
            (k.startsWith("/api/estimates") ||
              k.startsWith("/api/dashboard") ||
              k.startsWith("/api/customers"))
          );
        },
      });
    },
    onError: (err) => {
      toast({
        title: "Couldn't delete estimate",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

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
      a.download = buildEstimatePdfFilename(
        estimate.estimateNumber,
        (estimate as { customerName?: string | null }).customerName ?? null,
      );
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
      role={isDeleted ? undefined : "button"}
      tabIndex={isDeleted ? -1 : 0}
      onClick={isDeleted ? undefined : () => onOpen(estimate.id)}
      onKeyDown={
        isDeleted
          ? undefined
          : (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen(estimate.id);
              }
            }
      }
      className={`grid grid-cols-[2fr_1fr_1.5fr_1fr_auto] gap-4 items-center px-4 py-3 border-b border-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 ${
        isDeleted
          ? "bg-gray-50 opacity-60 italic line-through decoration-gray-400"
          : "hover:bg-gray-50 cursor-pointer"
      }`}
      title={deletedTooltip}
      data-testid={`list-row-${estimate.id}`}
      data-deleted={isDeleted ? "true" : undefined}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-gray-900 truncate">{estimate.customerName}</div>
        <div className="text-xs text-gray-500 truncate">{formatEstimateNumber(estimate.estimateNumber)}</div>
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
            <DropdownMenuItem
              disabled={isDeleted}
              onClick={() => !isDeleted && onOpen(estimate.id)}
            >
              Open
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={isDeleted}
              onClick={() => !isDeleted && onEdit(estimate.id)}
            >
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={isDeleted}
              onClick={() => !isDeleted && handleViewPdf()}
              data-testid={`list-row-view-pdf-${estimate.id}`}
            >
              View PDF
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={isDeleted}
              onClick={() => !isDeleted && handleDownloadPdf()}
              data-testid={`list-row-download-pdf-${estimate.id}`}
            >
              Download PDF
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={isDeleted || !isExpired || !onResendClick}
              title={
                isDeleted
                  ? "Estimate is deleted"
                  : isExpired
                  ? "Resend to customer"
                  : "Only available for expired estimates"
              }
              onClick={() => {
                if (!isDeleted && isExpired && onResendClick) onResendClick(estimate);
              }}
              data-testid={`list-row-resend-${estimate.id}`}
            >
              Resend
            </DropdownMenuItem>
            {canDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-red-600 focus:text-red-700 focus:bg-red-50"
                  onClick={() => setShowDeleteDialog(true)}
                  data-testid={`list-row-delete-${estimate.id}`}
                >
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent data-testid={`list-row-delete-dialog-${estimate.id}`}>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {isPendingDelete
                  ? "Delete this pending estimate?"
                  : "Delete this draft estimate?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {isPendingDelete ? (
                  <>
                    Estimate{" "}
                    <span className="font-medium">{formatEstimateNumber(estimate.estimateNumber)}</span>{" "}
                    for <span className="font-medium">{estimate.customerName}</span>{" "}
                    has been submitted for approval. Deleting it will hide it
                    from every list; admins can still see it for audit.
                  </>
                ) : (
                  <>
                    Estimate <span className="font-medium">{formatEstimateNumber(estimate.estimateNumber)}</span> for{" "}
                    <span className="font-medium">{estimate.customerName}</span> will be removed
                    from lists and dashboards. The row is preserved for audit and can be restored
                    by a super admin if needed.
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
                disabled={deleteMutation.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  deleteMutation.mutate();
                }}
                data-testid={`list-row-delete-confirm-${estimate.id}`}
              >
                {deleteMutation.isPending ? "Deleting…" : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
