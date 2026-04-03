import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, Inbox } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

const KANBAN_STAGES = [
  { key: "pending", label: "Pending" },
  { key: "assigned", label: "Assigned" },
  { key: "in_progress", label: "In Progress" },
  { key: "completed", label: "Completed" },
  { key: "pending_manager_review", label: "Pending Manager Review" },
  { key: "approved_passed_to_billing", label: "Approved / Passed to Billing" },
  { key: "billed", label: "Billed" },
] as const;

type StageKey = typeof KANBAN_STAGES[number]["key"];

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

function normalizeStatus(status: string): StageKey {
  const map: Record<string, StageKey> = {
    draft: "pending",
    submitted: "pending",
    pending: "pending",
    assigned: "assigned",
    in_progress: "in_progress",
    completed: "completed",
    pending_manager_review: "pending_manager_review",
    approved: "approved_passed_to_billing",
    approved_passed_to_billing: "approved_passed_to_billing",
    billed: "billed",
  };
  return map[status] ?? "billed";
}

function TicketCard({ item }: { item: AuditItem }) {
  const isWorkOrder = item.sourceType === "work_order";
  const refId = isWorkOrder ? `WO-${item.workOrderId ?? item.sourceId}` : `BS-${item.billingSheetId ?? item.sourceId}`;

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
      <div className="flex justify-between text-xs text-gray-500 pt-1 border-t border-gray-100">
        <span>Labor: {formatCurrency(item.laborTotal)}</span>
        <span>Parts: {formatCurrency(item.partsTotal)}</span>
      </div>
      <div className="text-right text-sm font-semibold text-gray-900">
        {formatCurrency(item.ticketTotal)}
      </div>
    </div>
  );
}

function KanbanColumn({ stage, items }: { stage: typeof KANBAN_STAGES[number]; items: AuditItem[] }) {
  const columnTotal = items.reduce((sum, item) => sum + item.ticketTotal, 0);

  return (
    <div className="flex-shrink-0 w-64 flex flex-col bg-gray-50 rounded-lg border border-gray-200">
      <div className="px-3 py-2 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-gray-700 leading-tight">{stage.label}</h4>
          <span className="text-xs text-gray-400 ml-1">({items.length})</span>
        </div>
        {items.length > 0 && (
          <p className="text-xs text-gray-500 mt-0.5">{formatCurrency(columnTotal)}</p>
        )}
      </div>
      <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-96">
        {items.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4 italic">No tickets</p>
        ) : (
          items.map((item) => <TicketCard key={item.id} item={item} />)
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

  const columnMap: Record<StageKey, AuditItem[]> = {
    pending: [],
    assigned: [],
    in_progress: [],
    completed: [],
    pending_manager_review: [],
    approved_passed_to_billing: [],
    billed: [],
  };

  if (data?.items) {
    for (const item of data.items) {
      const stageKey = normalizeStatus(item.status);
      columnMap[stageKey].push(item);
    }
  }

  const totalItems = data?.items?.length ?? 0;

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
              {KANBAN_STAGES.map((stage) => (
                <KanbanColumn key={stage.key} stage={stage} items={columnMap[stage.key]} />
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
