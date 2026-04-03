import { safeGet } from "@/utils/safeStorage";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  MapPin,
  User,
  Calendar,
  Clock,
  Package,
  Camera,
  FileText,
  X,
  CheckCircle,
  DollarSign,
  ChevronLeft,
  ChevronRight,
  Hash,
  Edit,
} from "lucide-react";
import type { WorkOrder, BillingSheet, WorkOrderItem, BillingSheetItem } from "@shared/schema";
import { format } from "date-fns";

interface CompletedWorkDetailModalProps {
  type: "work_order" | "billing_sheet";
  id: number;
  data: WorkOrder | BillingSheet;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  showPricing?: boolean;
  onEdit?: () => void;
}

const fmt = (date: string | Date | null | undefined) => {
  if (!date) return "—";
  try {
    return format(new Date(date), "MMM d, yyyy");
  } catch {
    return "—";
  }
};

const fmtDateTime = (date: string | Date | null | undefined) => {
  if (!date) return "—";
  try {
    return format(new Date(date), "MMM d, yyyy h:mm a");
  } catch {
    return "—";
  }
};

const currency = (val: number | string | null | undefined) => {
  const n = typeof val === "string" ? parseFloat(val) : (val ?? 0);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
};

const statusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  assigned: "bg-blue-100 text-blue-800",
  in_progress: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
  draft: "bg-gray-100 text-gray-700",
  submitted: "bg-yellow-100 text-yellow-800",
  pending_manager_review: "bg-orange-100 text-orange-800",
  approved_passed_to_billing: "bg-teal-100 text-teal-800",
  approved: "bg-green-100 text-green-800",
  billed: "bg-purple-100 text-purple-800",
};

const statusLabels: Record<string, string> = {
  pending_manager_review: "Pending Manager Review",
  approved_passed_to_billing: "Approved / Passed to Billing",
  in_progress: "In Progress",
};

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-sm text-gray-900 leading-snug">{value}</p>
    </div>
  );
}

function SectionCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-100">
        <span className="text-gray-500">{icon}</span>
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function CompletedWorkDetailModal({
  type,
  id,
  data,
  open,
  onOpenChange,
  showPricing,
  onEdit,
}: CompletedWorkDetailModalProps) {
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  // Determine pricing visibility
  const savedUser = safeGet("user");
  const userRole = savedUser ? JSON.parse(savedUser)?.role : "";
  const canSeePricing = showPricing !== undefined ? showPricing : userRole !== "field_tech";

  // Fetch items
  const itemsEndpoint =
    type === "work_order"
      ? `/api/work-orders/${id}/items`
      : `/api/billing-sheets/${id}/items`;

  const { data: items = [] } = useQuery<(WorkOrderItem | BillingSheetItem)[]>({
    queryKey: [type === "work_order" ? "/api/work-orders" : "/api/billing-sheets", id, "items"],
    queryFn: () => fetch(itemsEndpoint).then((r) => r.json()),
    enabled: open && !!id,
  });

  const isWorkOrder = type === "work_order";
  const wo = isWorkOrder ? (data as WorkOrder) : null;
  const bs = !isWorkOrder ? (data as BillingSheet) : null;

  const title = isWorkOrder
    ? `Work Order ${wo?.workOrderNumber ?? `#${id}`}`
    : `Billing Sheet ${bs?.billingNumber ?? `#${id}`}`;

  const status = data.status ?? "unknown";
  const customerName = isWorkOrder ? wo?.customerName : bs?.customerName;
  const address = isWorkOrder ? wo?.projectAddress : bs?.propertyAddress;
  const techName = isWorkOrder ? wo?.assignedTechnicianName : bs?.technicianName;
  const workDate = isWorkOrder ? wo?.scheduledDate : bs?.workDate;
  const completedDate = isWorkOrder ? wo?.completedAt : null;
  const completedBy = isWorkOrder ? wo?.completedByUserName : null;
  const workDescription = isWorkOrder ? wo?.description : bs?.workDescription;
  const totalHours = isWorkOrder ? wo?.totalHours : bs?.totalHours;
  const laborRate = canSeePricing ? (isWorkOrder ? wo?.laborRate : bs?.laborRate) : null;
  const laborSubtotal = canSeePricing ? (isWorkOrder ? wo?.laborSubtotal : bs?.laborSubtotal) : null;
  const partsSubtotal = canSeePricing ? (isWorkOrder ? wo?.partsSubtotal : bs?.partsSubtotal) : null;
  const totalAmount = canSeePricing ? (isWorkOrder ? wo?.totalAmount : bs?.totalAmount) : null;
  const photos: string[] = (isWorkOrder ? wo?.photos : bs?.photos) ?? [];
  const notes = isWorkOrder ? wo?.notes : bs?.notes;
  const workSummary = isWorkOrder ? wo?.workSummary : null;
  const customerNotes = isWorkOrder ? wo?.customerNotes : null;
  const locationNotes = isWorkOrder ? wo?.locationNotes : null;
  const branchName = isWorkOrder ? (wo as any)?.branchName : (bs as any)?.branchName;

  // Approval stamp fields
  const approvedBy = (data as any)?.approvedBy;
  const approvedAt = (data as any)?.approvedAt;
  const approvedTotal = (data as any)?.approvedTotal;

  const openLightbox = (url: string, index: number) => {
    setLightboxPhoto(url);
    setLightboxIndex(index);
  };

  const prevPhoto = () => {
    const newIdx = (lightboxIndex - 1 + photos.length) % photos.length;
    setLightboxIndex(newIdx);
    setLightboxPhoto(photos[newIdx]);
  };

  const nextPhoto = () => {
    const newIdx = (lightboxIndex + 1) % photos.length;
    setLightboxIndex(newIdx);
    setLightboxPhoto(photos[newIdx]);
  };

  // Compute totals from items if financial fields missing
  const itemsPartsTotal = canSeePricing
    ? items.reduce((sum, item) => {
        const price = (item as any).totalPrice ?? (item as any).partPrice ?? 0;
        return sum + parseFloat(price || "0");
      }, 0)
    : 0;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[95vw] max-w-3xl max-h-[95vh] overflow-hidden p-0 flex flex-col">
          {/* Header */}
          <DialogHeader className="flex-shrink-0 p-0">
            <div
              className={`px-5 py-4 border-b ${
                status === "completed" || status === "approved" || status === "billed"
                  ? "bg-gradient-to-r from-green-50 to-emerald-50 border-green-100"
                  : "bg-gradient-to-r from-blue-50 to-slate-50 border-gray-100"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`p-2.5 rounded-xl flex-shrink-0 ${
                      status === "completed" || status === "approved" || status === "billed"
                        ? "bg-green-100"
                        : "bg-blue-100"
                    }`}
                  >
                    {status === "completed" || status === "approved" || status === "billed" ? (
                      <CheckCircle className="w-5 h-5 text-green-600" />
                    ) : (
                      <FileText className="w-5 h-5 text-blue-600" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <DialogTitle className="text-lg font-bold text-gray-900 leading-tight">
                      {title}
                    </DialogTitle>
                    <p className="text-sm text-gray-600 mt-0.5 truncate">{customerName}</p>
                  </div>
                </div>
                <div className="flex-shrink-0 flex items-center gap-2">
                  {data.invoiceId && status !== 'billed' && (
                    <Badge className="bg-purple-100 text-purple-800">Billed</Badge>
                  )}
                  <Badge className={`capitalize ${statusColors[status] ?? "bg-gray-100 text-gray-700"}`}>
                    {statusLabels[status] ?? status.replace(/_/g, " ")}
                  </Badge>
                </div>
              </div>
            </div>
          </DialogHeader>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">

            {/* Billed lock notice */}
            {(status === 'billed' || data.invoiceId) && (
              <div className="flex items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-800">
                <span className="font-medium">This record has been billed and cannot be edited.</span>
              </div>
            )}

            {/* Pending Manager Review notice */}
            {status === 'pending_manager_review' && (
              <div className="flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                <span className="font-medium">Awaiting irrigation manager review before passing to billing.</span>
              </div>
            )}

            {/* Approval stamp */}
            {(status === 'approved_passed_to_billing' || status === 'billed') && approvedBy && (
              <div className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle className="w-4 h-4 flex-shrink-0 text-teal-600" />
                  <span className="font-semibold">Manager Approved</span>
                </div>
                <div className="text-teal-700 space-y-0.5 pl-6">
                  <div>Approved by <strong>{approvedBy}</strong></div>
                  {approvedAt && <div>on {fmtDateTime(approvedAt)}</div>}
                  {approvedTotal && canSeePricing && (
                    <div>Approved total: <strong>{currency(approvedTotal)}</strong></div>
                  )}
                </div>
              </div>
            )}

            {/* Location & Job Info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SectionCard title="Location" icon={<MapPin className="w-4 h-4" />}>
                <div className="space-y-3">
                  <InfoRow label="Customer" value={customerName} />
                  <InfoRow label="Property Address" value={address} />
                  {locationNotes && <InfoRow label="Location Notes" value={locationNotes} />}
                </div>
              </SectionCard>

              <SectionCard title="Job Info" icon={<Calendar className="w-4 h-4" />}>
                <div className="space-y-3">
                  <InfoRow label="Technician" value={techName ?? "—"} />
                  {branchName && <InfoRow label="Branch" value={branchName} />}
                  <InfoRow
                    label={isWorkOrder ? "Scheduled Date" : "Work Date"}
                    value={fmt(workDate)}
                  />
                  {completedDate && (
                    <InfoRow
                      label="Completed"
                      value={`${fmtDateTime(completedDate)}${completedBy ? ` by ${completedBy}` : ""}`}
                    />
                  )}
                  {isWorkOrder && wo?.startedAt && (
                    <InfoRow label="Started" value={fmtDateTime(wo.startedAt)} />
                  )}
                </div>
              </SectionCard>
            </div>

            {/* Time & Labor */}
            <SectionCard title="Time & Labor" icon={<Clock className="w-4 h-4" />}>
              {canSeePricing ? (
                <div className="flex items-center flex-wrap gap-3">
                  <div className="bg-gray-50 rounded-lg px-4 py-3 text-center min-w-[80px]">
                    <p className="text-2xl font-bold text-gray-900">{totalHours ?? "0"}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Hours</p>
                  </div>
                  <span className="text-xl font-semibold text-gray-400">×</span>
                  <div className="bg-gray-50 rounded-lg px-4 py-3 text-center min-w-[80px]">
                    <p className="text-2xl font-bold text-gray-900">{currency(laborRate ?? 0)}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Rate / hr</p>
                  </div>
                  <span className="text-xl font-semibold text-gray-400">=</span>
                  <div className="bg-blue-50 rounded-lg px-4 py-3 text-center min-w-[80px] border border-blue-100">
                    <p className="text-2xl font-bold text-blue-700">{currency(laborSubtotal)}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Labor Total</p>
                  </div>
                </div>
              ) : (
                <div className="text-center">
                  <p className="text-2xl font-bold text-gray-900">{totalHours ?? "0"}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Hours Worked</p>
                </div>
              )}
            </SectionCard>

            {/* Parts & Materials */}
            {items.length > 0 && (
              <SectionCard
                title={`Parts & Materials (${items.length} item${items.length !== 1 ? "s" : ""})`}
                icon={<Package className="w-4 h-4" />}
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left pb-2 font-medium text-gray-600 pr-3">Part</th>
                        <th className="text-center pb-2 font-medium text-gray-600 px-2 whitespace-nowrap">Qty</th>
                        {canSeePricing && (
                          <>
                            <th className="text-right pb-2 font-medium text-gray-600 px-2 whitespace-nowrap">Unit $</th>
                            <th className="text-right pb-2 font-medium text-gray-600 pl-2 whitespace-nowrap">Total</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {items.map((item, idx) => {
                        const unitPrice = canSeePricing
                          ? ((item as BillingSheetItem).unitPrice ?? (item as WorkOrderItem).partPrice)
                          : null;
                        const totalPrice = canSeePricing
                          ? (item as any).totalPrice
                          : null;
                        const qty = (item as BillingSheetItem).quantity ?? (item as WorkOrderItem).quantity;
                        const desc = (item as BillingSheetItem).partDescription;
                        return (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="py-2.5 pr-3">
                              <p className="font-medium text-gray-900">{item.partName}</p>
                              {desc && <p className="text-xs text-gray-500 mt-0.5">{desc}</p>}
                              {(item as WorkOrderItem).notes && (
                                <p className="text-xs text-gray-400 mt-0.5 italic">{(item as WorkOrderItem).notes}</p>
                              )}
                            </td>
                            <td className="py-2.5 px-2 text-center text-gray-700">{qty}</td>
                            {canSeePricing && (
                              <>
                                <td className="py-2.5 px-2 text-right text-gray-700">
                                  {unitPrice ? currency(unitPrice) : "—"}
                                </td>
                                <td className="py-2.5 pl-2 text-right font-medium text-gray-900">
                                  {totalPrice ? currency(totalPrice) : "—"}
                                </td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                    {canSeePricing && (
                      <tfoot>
                        <tr className="border-t border-gray-200">
                          <td colSpan={canSeePricing ? 3 : 2} className="pt-2 text-sm text-gray-600 font-medium">
                            Parts Subtotal
                          </td>
                          <td className="pt-2 text-right font-semibold text-gray-900">
                            {currency(partsSubtotal ?? itemsPartsTotal)}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </SectionCard>
            )}

            {/* Total Bill */}
            {canSeePricing && (
              <SectionCard title="Total Bill" icon={<DollarSign className="w-4 h-4" />}>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Labor Subtotal</span>
                    <span className="font-medium text-gray-900">{currency(laborSubtotal ?? 0)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Parts Subtotal</span>
                    <span className="font-medium text-gray-900">{currency(partsSubtotal ?? itemsPartsTotal)}</span>
                  </div>
                  <Separator className="my-2" />
                  <div className="flex justify-between items-center">
                    <span className="text-base font-semibold text-gray-900">Grand Total</span>
                    <span className="text-xl font-bold text-blue-700">
                      {currency(
                        totalAmount ??
                          (parseFloat(String(laborSubtotal ?? 0)) +
                            parseFloat(String(partsSubtotal ?? itemsPartsTotal)))
                      )}
                    </span>
                  </div>
                </div>
              </SectionCard>
            )}

            {/* Photos */}
            {photos.length > 0 && (
              <SectionCard
                title={`Photos (${photos.length})`}
                icon={<Camera className="w-4 h-4" />}
              >
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {photos.map((url, idx) => (
                    <button
                      key={idx}
                      onClick={() => openLightbox(url, idx)}
                      className="aspect-square rounded-lg overflow-hidden border border-gray-100 hover:border-blue-300 hover:shadow-md transition-all focus:outline-none focus:ring-2 focus:ring-blue-400"
                    >
                      <img
                        src={url}
                        alt={`Photo ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              </SectionCard>
            )}

            {/* Notes */}
            {(workDescription || workSummary || notes || customerNotes) && (
              <SectionCard title="Notes & Description" icon={<FileText className="w-4 h-4" />}>
                <div className="space-y-3">
                  {workDescription && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Work Description</p>
                      <p className="text-sm text-gray-800 bg-gray-50 rounded-lg p-3 leading-relaxed whitespace-pre-wrap">
                        {workDescription}
                      </p>
                    </div>
                  )}
                  {workSummary && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Completion Summary</p>
                      <p className="text-sm text-gray-800 bg-green-50 rounded-lg p-3 leading-relaxed whitespace-pre-wrap border border-green-100">
                        {workSummary}
                      </p>
                    </div>
                  )}
                  {notes && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Additional Notes</p>
                      <p className="text-sm text-gray-800 bg-gray-50 rounded-lg p-3 leading-relaxed whitespace-pre-wrap">
                        {notes}
                      </p>
                    </div>
                  )}
                  {customerNotes && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Customer Notes</p>
                      <p className="text-sm text-gray-800 bg-blue-50 rounded-lg p-3 leading-relaxed whitespace-pre-wrap border border-blue-100">
                        {customerNotes}
                      </p>
                    </div>
                  )}
                </div>
              </SectionCard>
            )}

            {/* Financial Summary */}
            {canSeePricing && totalAmount && parseFloat(String(totalAmount)) > 0 && (
              <SectionCard title="Financial Summary" icon={<DollarSign className="w-4 h-4" />}>
                <div className="space-y-2">
                  {partsSubtotal && (
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-600">Parts Subtotal</span>
                      <span className="font-medium text-gray-900">{currency(partsSubtotal)}</span>
                    </div>
                  )}
                  {laborSubtotal && (
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-600">
                        Labor ({totalHours} hrs{laborRate ? ` × ${currency(laborRate)}/hr` : ""})
                      </span>
                      <span className="font-medium text-gray-900">{currency(laborSubtotal)}</span>
                    </div>
                  )}
                  {bs?.markupAmount && parseFloat(String(bs.markupAmount)) > 0 && (
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-600">Markup</span>
                      <span className="font-medium text-gray-900">{currency(bs.markupAmount)}</span>
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-between items-center">
                    <span className="text-base font-bold text-gray-900">Total</span>
                    <span className="text-xl font-bold text-green-700">{currency(totalAmount)}</span>
                  </div>
                </div>
              </SectionCard>
            )}
          </div>

          {/* Footer */}
          <div className="flex-shrink-0 border-t border-gray-100 px-5 py-3 bg-gray-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Hash className="w-3.5 h-3.5" />
                <span>{title}</span>
              </div>
              <div className="flex items-center gap-2">
                {onEdit && (
                  <Button variant="outline" size="sm" onClick={onEdit} className="text-blue-600 hover:text-blue-700">
                    <Edit className="w-4 h-4 mr-1.5" />
                    Edit
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                  <X className="w-4 h-4 mr-1.5" />
                  Close
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Lightbox */}
      {lightboxPhoto && (
        <Dialog open={!!lightboxPhoto} onOpenChange={() => setLightboxPhoto(null)}>
          <DialogContent className="w-screen h-screen max-w-none max-h-none p-0 bg-black/95 flex items-center justify-center border-0">
            <button
              onClick={() => setLightboxPhoto(null)}
              className="absolute top-4 right-4 z-50 bg-white/10 hover:bg-white/20 text-white rounded-full p-2 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            {photos.length > 1 && (
              <>
                <button
                  onClick={prevPhoto}
                  className="absolute left-4 z-50 bg-white/10 hover:bg-white/20 text-white rounded-full p-2 transition-colors"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={nextPhoto}
                  className="absolute right-14 z-50 bg-white/10 hover:bg-white/20 text-white rounded-full p-2 transition-colors"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </>
            )}
            <img
              src={lightboxPhoto}
              alt="Full size photo"
              className="max-w-full max-h-full object-contain"
              style={{ maxHeight: "90vh" }}
            />
            {photos.length > 1 && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/70 text-sm">
                {lightboxIndex + 1} / {photos.length}
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
