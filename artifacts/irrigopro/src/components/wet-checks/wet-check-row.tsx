import { Link } from "wouter";
import { Eye, Trash2, UserCog, FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ListRowOverflowMenu,
  type ListRowAction,
} from "@/components/shared/list-row-overflow-menu";

export interface WetCheckListRow {
  id: number;
  customerName: string;
  propertyAddress: string | null;
  technicianName: string;
  status: string;
  startedAt: string | Date | null;
  submittedAt: string | Date | null;
  approvedAt: string | Date | null;
  zoneRecordCount?: number;
  findingCount?: number;
  photoCount?: number;
  companyName?: string | null;
}

export interface WetCheckRowProps {
  row: WetCheckListRow;
  canSelect: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onDelete: () => void;
  onReassign?: () => void;
  showCompanyCol: boolean;
  canAdminActions: boolean;
  bulkBlocked?: boolean;
  snapshotChip?: React.ReactNode;
  actionButton?: React.ReactNode;
}

const STATUS_BADGE: Record<string, string> = {
  in_progress: "bg-gray-100 text-gray-700 border border-gray-300",
  submitted: "bg-blue-100 text-blue-800 border border-blue-300",
  approved: "bg-emerald-100 text-emerald-800 border border-emerald-300",
  partially_converted: "bg-amber-100 text-amber-800 border border-amber-300",
  converted: "bg-emerald-100 text-emerald-800 border border-emerald-300",
};

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function WetCheckStatusBadge({ status }: { status: string }) {
  const cls = STATUS_BADGE[status] ?? "bg-gray-100 text-gray-600 border border-gray-300";
  return (
    <Badge
      className={`text-xs border ${cls}`}
      variant="outline"
      data-testid={`badge-wc-status-${status}`}
    >
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

export function WetCheckRow({
  row,
  canSelect,
  selected,
  onToggleSelect,
  onDelete,
  onReassign,
  showCompanyCol,
  canAdminActions,
  bulkBlocked = false,
  snapshotChip,
  actionButton,
}: WetCheckRowProps) {
  const actions: ListRowAction[] = [
    {
      label: "Open Review",
      icon: <Eye className="h-4 w-4" />,
      onClick: () => {
        window.location.href = `/wet-checks/${row.id}/review`;
      },
    },
    {
      label: "View PDF",
      icon: <FileText className="h-4 w-4" />,
      onClick: () => {
        window.open(`/api/wet-checks/${row.id}/pdf`, "_blank");
      },
    },
    {
      label: "Reassign Technician",
      icon: <UserCog className="h-4 w-4" />,
      hidden: !canAdminActions,
      onClick: () => onReassign?.(),
      separator: true,
    },
    {
      label: "Delete",
      icon: <Trash2 className="h-4 w-4" />,
      hidden: !canAdminActions,
      destructive: true,
      onClick: onDelete,
    },
  ];

  return (
    <Card
      data-testid={`card-wc-row-${row.id}`}
      className={bulkBlocked ? "border-red-300" : undefined}
    >
      <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        {canSelect && (
          <div className="flex-shrink-0 self-start sm:self-center pt-0.5">
            <Checkbox
              checked={selected}
              onCheckedChange={onToggleSelect}
              aria-label={`Select wet check ${row.id}`}
              data-testid={`checkbox-wc-select-${row.id}`}
            />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">{row.customerName}</span>
            <WetCheckStatusBadge status={row.status} />
            {snapshotChip}
            <span className="text-xs text-gray-500">#{row.id}</span>
            {showCompanyCol && row.companyName && (
              <span
                className="text-xs text-gray-500 bg-gray-100 rounded px-1.5 py-0.5"
                data-testid={`wc-company-name-${row.id}`}
              >
                {row.companyName}
              </span>
            )}
          </div>
          <div className="text-sm text-gray-600 truncate mt-0.5">
            {row.propertyAddress ?? "No address"} · Tech: {row.technicianName}
          </div>
          <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-2">
            <span>Started {fmtDate(row.startedAt)}</span>
            {row.submittedAt && <span>· Submitted {fmtDate(row.submittedAt)}</span>}
            {row.approvedAt && <span>· Approved {fmtDate(row.approvedAt)}</span>}
            {row.zoneRecordCount != null && (
              <span>
                · {row.zoneRecordCount} zones · {row.findingCount ?? 0} findings ·{" "}
                {row.photoCount ?? 0} photos
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {actionButton ?? (
            <Link href={`/wet-checks/${row.id}/review`}>
              <button
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-medium"
                data-testid={`button-wc-view-${row.id}`}
              >
                <Eye className="h-3 w-3" />
                View
              </button>
            </Link>
          )}
          <ListRowOverflowMenu
            actions={actions}
            triggerTestId={`overflow-menu-wc-${row.id}`}
          />
        </div>
      </CardContent>
    </Card>
  );
}
