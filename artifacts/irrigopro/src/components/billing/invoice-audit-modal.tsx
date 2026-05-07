import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, Inbox } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

const MILESTONE_STAGES = [
  { key: "created", label: "Created" },
  { key: "approved", label: "Approved" },
  { key: "quickbooks", label: "Sent to QuickBooks" },
] as const;

type MilestoneKey = typeof MILESTONE_STAGES[number]["key"];

interface AuditItem {
  id: number;
  sourceType: string;
  sourceId: number;
  workOrderId?: number | null;
  billingSheetId?: number | null;
  description: string;
  status: string;
  laborTotal: number;
  partsTotal: number;
  ticketTotal: number;
  workDate: string;
  createdAt: string | null;
  approvedAt: string | null;
  billedAt: string | null;
  approvedLaborSnapshot: number | null;
  approvedPartsSnapshot: number | null;
}

interface AuditResponse {
  invoiceId: number;
  items: AuditItem[];
}

interface InvoiceAuditModalProps {
  open: boolean;
  onClose: () => void;
  invoiceId: number;
  invoiceLabel: string;
  invoiceTotal?: string;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function TicketCard({ item, stage }: { item: AuditItem; stage: MilestoneKey }) {
  const isWorkOrder = item.sourceType === "work_order";
  const refId = isWorkOrder
    ? `WO-${item.workOrderId ?? item.sourceId}`
    : `BS-${item.billingSheetId ?? item.sourceId}`;

  let dateLabel = "";
  let dateValue: string | null = null;
  let laborAmount: number | null = null;
  let partsAmount: number | null = null;
  let totalAmount: number | null = null;
  let noSnapshot = false;

  if (stage === "created") {
    dateLabel = "Created";
    dateValue = item.createdAt;
    laborAmount = item.laborTotal;
    partsAmount = item.partsTotal;
    totalAmount = item.ticketTotal;
  } else if (stage === "approved") {
    dateLabel = "Approved";
    dateValue = item.approvedAt;
    if (item.approvedLaborSnapshot !== null || item.approvedPartsSnapshot !== null) {
      laborAmount = item.approvedLaborSnapshot ?? 0;
      partsAmount = item.approvedPartsSnapshot ?? 0;
      totalAmount = (laborAmount) + (partsAmount);
    } else {
      noSnapshot = true;
    }
  } else if (stage === "quickbooks") {
    dateLabel = "Billed";
    dateValue = item.billedAt;
    laborAmount = item.laborTotal;
    partsAmount = item.partsTotal;
    totalAmount = item.ticketTotal;
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-mono text-gray-500">{refId}</span>
        <Badge
          className={
            isWorkOrder
              ? "bg-blue-100 text-blue-800 text-xs"
              : "bg-purple-100 text-purple-800 text-xs"
          }
        >
          {isWorkOrder ? "WO" : "BS"}
        </Badge>
      </div>
      <p className="text-sm text-gray-800 leading-snug line-clamp-3">{item.description}</p>
      <div className="text-xs text-gray-400 flex items-center gap-1">
        <span className="font-medium text-gray-500">{dateLabel}:</span>
        <span>{formatDate(dateValue)}</span>
      </div>
      {noSnapshot ? (
        <div className="text-xs text-amber-600 italic pt-1 border-t border-gray-100">
          No snapshot
        </div>
      ) : (
        <>
          <div className="flex justify-between text-xs text-gray-500 pt-1 border-t border-gray-100">
            <span>Labor: {formatCurrency(laborAmount ?? 0)}</span>
            <span>Parts: {formatCurrency(partsAmount ?? 0)}</span>
          </div>
          <div className="text-right text-sm font-semibold text-gray-900">
            {formatCurrency(totalAmount ?? 0)}
          </div>
        </>
      )}
    </div>
  );
}

function MilestoneColumn({ stage, items }: { stage: typeof MILESTONE_STAGES[number]; items: AuditItem[] }) {
  const columnTotal = items.reduce((sum, item) => {
    if (stage.key === "approved") {
      if (item.approvedLaborSnapshot !== null || item.approvedPartsSnapshot !== null) {
        return sum + (item.approvedLaborSnapshot ?? 0) + (item.approvedPartsSnapshot ?? 0);
      }
      return sum;
    }
    return sum + item.ticketTotal;
  }, 0);

  return (
    <div className="flex-shrink-0 w-72 flex flex-col bg-gray-50 rounded-lg border border-gray-200">
      <div className="px-3 py-2 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-gray-700 leading-tight">{stage.label}</h4>
          <span className="text-xs text-gray-400 ml-1">({items.length})</span>
        </div>
        {items.length > 0 && (
          <p className="text-xs text-gray-500 mt-0.5">{formatCurrency(columnTotal)}</p>
        )}
      </div>
      <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[28rem]">
        {items.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4 italic">No tickets</p>
        ) : (
          items.map((item) => (
            <TicketCard key={item.id} item={item} stage={stage.key} />
          ))
        )}
      </div>
    </div>
  );
}

export function InvoiceAuditModal({
  open,
  onClose,
  invoiceId,
  invoiceLabel,
  invoiceTotal,
}: InvoiceAuditModalProps) {
  const { data, isLoading, error } = useQuery<AuditResponse>({
    queryKey: ["/api/invoices", invoiceId, "audit"],
    queryFn: () => apiRequest(`/api/invoices/${invoiceId}/audit`),
    enabled: open && !!invoiceId,
  });

  const totalItems = data?.items?.length ?? 0;
  const items = data?.items ?? [];

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="max-w-[95vw] w-full">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            Audit — {invoiceLabel}
            {invoiceTotal && (
              <span className="ml-2 text-base font-normal text-gray-500">· {invoiceTotal}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            <span className="ml-2 text-sm text-gray-600">Loading audit data...</span>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center py-16 text-red-600 gap-2">
            <AlertCircle className="w-5 h-5" />
            <span className="text-sm">Failed to load audit data.</span>
          </div>
        )}

        {!isLoading && !error && totalItems === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
            <Inbox className="w-10 h-10" />
            <p className="text-sm">No tickets found for this invoice.</p>
          </div>
        )}

        {!isLoading && !error && totalItems > 0 && (
          <div className="overflow-x-auto pb-2">
            <div className="flex gap-3" style={{ minWidth: "max-content" }}>
              {MILESTONE_STAGES.map((stage) => (
                <MilestoneColumn key={stage.key} stage={stage} items={items} />
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
