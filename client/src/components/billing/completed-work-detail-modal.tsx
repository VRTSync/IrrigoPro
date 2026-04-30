import { safeGet } from "@/utils/safeStorage";
import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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
  Plus,
  Upload,
} from "lucide-react";
import type { WorkOrder, BillingSheet, WorkOrderItem, BillingSheetItem } from "@shared/schema";
import { format } from "date-fns";
import { PhotoImage, usePhotoSignedUrls } from "@/components/ui/photo-image";
import { apiRequest, parseApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { preparePhotoForUpload } from "@/lib/photo-prep";

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  try {
    const saved = safeGet("user");
    if (saved) {
      const user = JSON.parse(saved);
      if (user?.role) {
        headers["x-user-role"] = user.role;
        headers["x-user-id"] = user.id?.toString() || "";
        headers["x-user-name"] = user.name || "";
        headers["x-user-company-id"] = user.companyId?.toString() || "";
      }
    }
  } catch {
    // ignore
  }
  return headers;
}

// `preparePhotoForUpload` lives in `@/lib/photo-prep` so the same display +
// preserved-original prep is shared with the work-order upload path.

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
  work_completed: "bg-green-100 text-green-800",
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
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [photoToRemove, setPhotoToRemove] = useState<number | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Determine pricing visibility
  const savedUser = safeGet("user");
  const parsedUser = savedUser ? (() => { try { return JSON.parse(savedUser); } catch { return null; } })() : null;
  const userRole = parsedUser?.role ?? "";
  const userId = parsedUser?.id;
  const canSeePricing = showPricing !== undefined ? showPricing : userRole !== "field_tech";

  const bs = type === "billing_sheet" ? (data as BillingSheet) : null;

  // Fetch the customer to compare their current labor rate vs stored rate on billing sheet
  const { data: customerForRateCheck } = useQuery({
    queryKey: ["/api/customers", bs?.customerId],
    enabled: open && type === "billing_sheet" && !!bs?.customerId && canSeePricing,
  });

  // Detect rate mismatch for billing sheets
  const storedRate = bs ? parseFloat(bs.laborRate || '0') : null;
  const currentCustomerRate = customerForRateCheck ? parseFloat(customerForRateCheck.laborRate || '0') : null;
  const hasRateMismatch = canSeePricing && storedRate !== null && currentCustomerRate !== null && Math.abs(storedRate - currentCustomerRate) > 0.001;

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
  const sourcePhotos: string[] = (isWorkOrder ? wo?.photos : bs?.photos) ?? [];

  // Local photos state mirrors the source but allows optimistic updates so the
  // open modal reflects add/remove immediately, before the parent refetches.
  const [localPhotos, setLocalPhotos] = useState<string[]>(sourcePhotos);
  useEffect(() => {
    setLocalPhotos(sourcePhotos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(sourcePhotos), id, open]);
  const photos = localPhotos;
  const { getUrl: getPhotoSignedUrl } = usePhotoSignedUrls(photos, "thumb");

  // Photo edit access (billing sheet only — work orders use their own detail view).
  // Task #191: photos may still be added/removed even when the sheet has been
  // moved to billing (status === 'billed' or has an invoiceId), so techs can
  // backfill missing photos. The "billed lock notice" still shows below; this
  // exception applies only to the photo control.
  const canEditPhotos =
    type === 'billing_sheet' &&
    (
      userRole === 'company_admin' ||
      userRole === 'super_admin' ||
      userRole === 'irrigation_manager' ||
      userRole === 'billing_manager' ||
      (userRole === 'field_tech' && bs?.technicianId === userId)
    );

  const updatePhotos = useMutation({
    mutationFn: async (nextPhotos: string[]) => {
      try {
        await apiRequest(`/api/billing-sheets/${id}`, "PATCH", { photos: nextPhotos });
      } catch (err) {
        const detail = parseApiError(err, err instanceof Error ? err.message : "save failed");
        throw new Error(`Save to sheet failed: ${detail}`);
      }
      return nextPhotos;
    },
    onSuccess: (nextPhotos) => {
      setLocalPhotos(nextPhotos);
      queryClient.invalidateQueries({ queryKey: ["/api/billing-sheets"] });
    },
    onError: (error: any) => {
      toast({
        title: "Couldn't save photos to sheet",
        description: error?.message || "Failed to update photos",
        variant: "destructive",
      });
    },
  });

  const handlePhotoUpload = async (selectedFiles: FileList | null) => {
    if (!selectedFiles?.length) return;
    setIsUploadingPhoto(true);
    const partialWarnings: string[] = [];
    try {
      const newUrls: string[] = [];
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];

        // 1. Ask the server for signed PUT URLs (display + preserved original).
        let signedUrl: string;
        let originalSignedUrl: string | undefined;
        let canonicalUrl: string;
        try {
          const signUrlRes = await fetch(
            `/api/upload/photo?originalName=${encodeURIComponent(file.name)}`,
            { method: 'POST', headers: getAuthHeaders(), credentials: 'include' }
          );
          if (!signUrlRes.ok) {
            const body = await signUrlRes.text();
            throw new Error(`${signUrlRes.status}: ${body || signUrlRes.statusText}`);
          }
          const json = await signUrlRes.json();
          signedUrl = json.signedUrl;
          originalSignedUrl = json.originalSignedUrl;
          canonicalUrl = json.url;
        } catch (err: any) {
          throw new Error(`Get upload URL failed for ${file.name}: ${err?.message || err}`);
        }

        // 2. Prepare both bytes streams (HEIC → JPEG once, then a tight
        //    display copy + a lightly-compressed preserved original).
        const { displayFile, originalFile } = await preparePhotoForUpload(file);

        // 3. Dual-upload: lightly-compressed preserved original, tight display bytes for variants.
        let displayPut: Response;
        let originalPut: Response;
        try {
          [originalPut, displayPut] = await Promise.all([
            originalSignedUrl
              ? fetch(originalSignedUrl, {
                  method: 'PUT',
                  body: originalFile,
                  headers: { 'Content-Type': originalFile.type || 'application/octet-stream' },
                })
              : Promise.resolve({ ok: true } as Response),
            fetch(signedUrl, {
              method: 'PUT',
              body: displayFile,
              headers: { 'Content-Type': displayFile.type || 'application/octet-stream' },
            }),
          ]);
        } catch (err: any) {
          throw new Error(`Upload to storage failed for ${file.name}: ${err?.message || err}`);
        }
        if (!displayPut.ok) {
          const body = await displayPut.text().catch(() => '');
          throw new Error(`Upload to storage failed for ${file.name} (${displayPut.status}${body ? `: ${body.slice(0, 120)}` : ''})`);
        }
        if (!originalPut.ok) {
          // Display variants will still generate, but the preserved
          // untouched bytes were not saved — surface this so the user
          // knows EXIF/GPS may be missing on this photo's original.
          const body = await originalPut.text().catch(() => '');
          console.warn(`[detail-modal] preserved-original PUT failed for ${file.name}`, originalPut.status, body);
          partialWarnings.push(
            `Original bytes for ${file.name} weren't preserved (${originalPut.status}). Thumbnails will still appear.`
          );
        }

        // 4. Ask the server to generate thumb/medium variants. Variant
        //    work runs in the background server-side, so a 2xx here just
        //    means the request was accepted. A non-2xx is non-fatal (the
        //    base path still serves) but worth surfacing so users know
        //    thumbnails may be delayed.
        try {
          const finalizeRes = await fetch('/api/upload/photo/finalize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            credentials: 'include',
            body: JSON.stringify({ photoId: canonicalUrl }),
          });
          if (!finalizeRes.ok) {
            const body = await finalizeRes.text().catch(() => '');
            console.warn(`[detail-modal] finalize failed for ${file.name}`, finalizeRes.status, body);
            partialWarnings.push(
              `Finalize failed for ${file.name} (${finalizeRes.status}${body ? `: ${body.slice(0, 80)}` : ''}). Thumbnails may be delayed.`
            );
          }
        } catch (err: any) {
          console.warn('[detail-modal] finalize call failed', err);
          partialWarnings.push(
            `Finalize request for ${file.name} couldn't be sent: ${err?.message || err}. Thumbnails may be delayed.`
          );
        }

        newUrls.push(canonicalUrl);
      }

      // 5. Save to the sheet. Use localPhotos (current modal state) — not
      //    bs?.photos (server snapshot) — so rapid successive uploads
      //    don't drop just-added photos.
      const existing: string[] = Array.isArray(localPhotos) ? localPhotos : [];
      try {
        await updatePhotos.mutateAsync([...existing, ...newUrls]);
        if (partialWarnings.length > 0) {
          toast({
            title: "Photos saved with warnings",
            description: partialWarnings.join(" "),
            variant: "destructive",
          });
        } else {
          toast({
            title: "Photos Added",
            description: `${newUrls.length} photo${newUrls.length > 1 ? 's' : ''} uploaded successfully`,
          });
        }
      } catch {
        // updatePhotos.onError already toasted with a specific message.
      }
    } catch (error: any) {
      toast({
        title: "Upload Failed",
        description: error?.message || "Failed to upload photos",
        variant: "destructive",
      });
    } finally {
      setIsUploadingPhoto(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  };

  const handleConfirmRemovePhoto = () => {
    if (photoToRemove === null) return;
    const existing: string[] = Array.isArray(localPhotos) ? localPhotos : [];
    const updated = existing.filter((_, i) => i !== photoToRemove);
    updatePhotos.mutate(updated);
    setPhotoToRemove(null);
    toast({ title: "Photo Removed", description: "Photo has been removed from this billing sheet" });
  };
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
                status === "work_completed" || status === "approved" || status === "billed"
                  ? "bg-gradient-to-r from-green-50 to-emerald-50 border-green-100"
                  : "bg-gradient-to-r from-blue-50 to-slate-50 border-gray-100"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`p-2.5 rounded-xl flex-shrink-0 ${
                      status === "work_completed" || status === "approved" || status === "billed"
                        ? "bg-green-100"
                        : "bg-blue-100"
                    }`}
                  >
                    {status === "work_completed" || status === "approved" || status === "billed" ? (
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

            {/* Rate mismatch warning — flags when stored rate differs from customer's current rate */}
            {hasRateMismatch && type === 'billing_sheet' && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <div className="flex items-start gap-2">
                  <span className="text-amber-600 font-bold text-base leading-none mt-0.5">⚠</span>
                  <div>
                    <p className="font-semibold">Rate mismatch detected</p>
                    <p className="mt-0.5">
                      The rate on this sheet (${storedRate?.toFixed(2)}/hr) differs from the customer's current rate (${currentCustomerRate?.toFixed(2)}/hr).
                      {(status === 'billed' || data.invoiceId)
                        ? ' Already billed — review manually before reissuing.'
                        : ' The server will use the customer\'s current rate for any new billing sheets.'}
                    </p>
                  </div>
                </div>
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
            {(photos.length > 0 || canEditPhotos) && (
              <SectionCard
                title={`Photos (${photos.length})`}
                icon={<Camera className="w-4 h-4" />}
              >
                {canEditPhotos && (
                  <div className="flex justify-end mb-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => photoInputRef.current?.click()}
                      disabled={isUploadingPhoto || updatePhotos.isPending}
                      className="flex items-center gap-1.5"
                      data-testid="button-add-photos"
                    >
                      {isUploadingPhoto ? (
                        <>
                          <Upload className="w-4 h-4 animate-pulse" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Plus className="w-4 h-4" />
                          Add Photos
                        </>
                      )}
                    </Button>
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      multiple
                      onChange={(e) => handlePhotoUpload(e.target.files)}
                      className="hidden"
                    />
                  </div>
                )}
                {photos.length > 0 ? (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {photos.map((url, idx) => (
                      <div key={idx} className="relative group">
                        <button
                          onClick={() => openLightbox(url, idx)}
                          className="aspect-square w-full rounded-lg overflow-hidden border border-gray-100 hover:border-blue-300 hover:shadow-md transition-all focus:outline-none focus:ring-2 focus:ring-blue-400"
                        >
                          <PhotoImage
                            photoUrl={url}
                            alt={`Photo ${idx + 1}`}
                            variant="thumb"
                            batchManaged
                            signedUrlOverride={getPhotoSignedUrl(url)}
                            className="w-full h-full object-cover"
                          />
                        </button>
                        {canEditPhotos && (
                          <button
                            onClick={() => setPhotoToRemove(idx)}
                            disabled={updatePhotos.isPending}
                            className="absolute top-1 right-1 bg-red-500 hover:bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
                            title="Remove photo"
                            data-testid={`button-remove-photo-${idx}`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 text-center py-4">No photos yet. Click "Add Photos" to upload.</p>
                )}
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
            <PhotoImage
              photoUrl={lightboxPhoto}
              alt="Full size photo"
              className="max-w-full max-h-full object-contain"
            />
            {photos.length > 1 && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/70 text-sm">
                {lightboxIndex + 1} / {photos.length}
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}

      {/* Photo remove confirmation */}
      <Dialog open={photoToRemove !== null} onOpenChange={() => setPhotoToRemove(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove this photo?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">
            This photo will be removed from this billing sheet. This cannot be undone.
          </p>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setPhotoToRemove(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleConfirmRemovePhoto}
              disabled={updatePhotos.isPending}
              data-testid="button-confirm-remove-photo"
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
