import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { FileUpload, type UploadedFile } from "@/components/ui/file-upload";
import {
  MapPin,
  Calendar,
  Clock,
  Package,
  Camera,
  FileText,
  CheckCircle,
  DollarSign,
  Edit,
  Hash,
  X,
  ChevronLeft,
  ChevronRight,
  Trash2,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EditPartsModal, type EditPartRow } from "@/components/billing/edit-parts-modal";
import { AiExpandButton, AiSuggestionCard } from "@/components/ui/ai-expand-button";
import type { BillingSheet, BillingSheetItem } from "@shared/schema";
import { BilledIndicator } from "@/components/ui/billed-indicator";

const currency = (val: number | string | null | undefined) => {
  const n = typeof val === "string" ? parseFloat(val) : (val ?? 0);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
};

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  submitted: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  billed: "bg-blue-100 text-blue-800",
};

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

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      {children}
    </div>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-sm text-gray-900 leading-snug">{value}</p>
    </div>
  );
}

interface EditBillingSheetModalProps {
  billingSheet: BillingSheet;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditBillingSheetModal({ billingSheet, open, onClose, onSuccess }: EditBillingSheetModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isReadOnly = billingSheet.status === 'billed' || !!billingSheet.invoiceId;

  const formatDateForInput = (date: string | Date | null | undefined): string => {
    if (!date) return "";
    const d = new Date(date);
    if (isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  };

  const [workDescription, setWorkDescription] = useState(billingSheet.workDescription || "");
  const [propertyAddress, setPropertyAddress] = useState(billingSheet.propertyAddress || "");
  const [workDate, setWorkDate] = useState(formatDateForInput(billingSheet.workDate));
  const [totalHours, setTotalHours] = useState(billingSheet.totalHours?.toString() || "0");
  const [laborRate, setLaborRate] = useState(billingSheet.laborRate?.toString() || "0");
  const [notes, setNotes] = useState(billingSheet.notes || "");
  const [branchName, setBranchName] = useState((billingSheet as any).branchName || "");
  const [parts, setParts] = useState<EditPartRow[]>([]);
  const [partsLoaded, setPartsLoaded] = useState(false);
  const [showPartsEditor, setShowPartsEditor] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({}); 
  
  // Fetch the customer to get its branches
  const { data: customer } = useQuery({
    queryKey: ["/api/customers", billingSheet.customerId],
    queryFn: async () => {
      const res = await fetch(`/api/customers/${billingSheet.customerId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: open && !!billingSheet.customerId,
  });
  const customerBranches: string[] = (customer as any)?.branches || [];

  // Detect rate mismatch: stored rate on this sheet vs customer's current rate
  const storedLaborRate = parseFloat(billingSheet.laborRate || '0');
  const currentCustomerLaborRate = customer ? parseFloat((customer as any).laborRate || '0') : null;
  const hasRateMismatch = currentCustomerLaborRate !== null && Math.abs(storedLaborRate - currentCustomerLaborRate) > 0.001;

  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [editablePhotos, setEditablePhotos] = useState<UploadedFile[]>([]);

  const handleClose = () => {
    setAiSuggestion(null);
    onClose();
  };
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  // Resolve a stored photo path to a displayable URL
  const resolvePhotoUrl = (url: string): string => {
    if (!url) return url;
    if (url.startsWith('http') || url.startsWith('/api/')) return url;
    if (url.startsWith('/uploads/')) {
      const fileName = url.replace('/uploads/', '');
      return `/api/photos/${fileName}`;
    }
    return `/api/photos/${url}`;
  };

  const { data: existingItems } = useQuery<BillingSheetItem[]>({
    queryKey: ["/api/billing-sheets", billingSheet.id, "items"],
    queryFn: async () => {
      const res = await fetch(`/api/billing-sheets/${billingSheet.id}/items`);
      if (!res.ok) throw new Error("Failed to fetch items");
      return res.json();
    },
    enabled: open && !partsLoaded,
  });

  useEffect(() => {
    if (!open) {
      setPartsLoaded(false);
      setParts([]);
      setEditablePhotos([]);
      return;
    }
    setWorkDescription(billingSheet.workDescription || "");
    setPropertyAddress(billingSheet.propertyAddress || "");
    setWorkDate(formatDateForInput(billingSheet.workDate));
    setTotalHours(billingSheet.totalHours?.toString() || "0");
    setLaborRate(billingSheet.laborRate?.toString() || "0");
    setNotes(billingSheet.notes || "");
    setBranchName((billingSheet as any).branchName || "");
    setErrors({});
    // Initialize editable photos from the billing sheet
    const photosArr: string[] = billingSheet.photos ?? [];
    setEditablePhotos(photosArr.map((url) => ({
      url,
      fileName: url,
      originalName: url.split('/').pop() || 'photo',
    })));
  }, [open, billingSheet]);

  useEffect(() => {
    if (existingItems && !partsLoaded) {
      setParts(
        existingItems.map((item) => ({
          partId: null,
          partName: item.partName,
          quantity: String(item.quantity),
          unitPrice: String(item.unitPrice),
          laborHours: String(item.laborHours),
          zoneId: null,
          notes: "",
        }))
      );
      setPartsLoaded(true);
    }
  }, [existingItems, partsLoaded]);

  const hoursNum = parseFloat(totalHours) || 0;
  const rateNum = parseFloat(laborRate) || 0;
  const laborSubtotal = hoursNum * rateNum;
  const partsTotal = parts.reduce(
    (sum, p) => sum + (Number(p.quantity) || 0) * (Number(p.unitPrice) || 0),
    0
  );
  const grandTotal = laborSubtotal + partsTotal;

  const status = billingSheet.status ?? "draft";
  const isGreen = status === "approved" || status === "billed";

  const updateBillingSheet = useMutation({
    mutationFn: async () => {
      const submitData: Record<string, unknown> = {
        workDescription,
        workDate,
        totalHours,
        laborRate,
        laborSubtotal: laborSubtotal.toFixed(2),
        partsSubtotal: partsTotal.toFixed(2),
        totalAmount: grandTotal.toFixed(2),
        propertyAddress: propertyAddress || "",
        notes: notes || "",
        branchName: branchName || null,
        photos: editablePhotos.map((p) => p.url),
        items: parts
          .filter((p) => p.partName.trim())
          .map((p) => ({
            partName: p.partName,
            quantity: Number(p.quantity) || 0,
            unitPrice: Number(p.unitPrice) || 0,
            laborHours: Number(p.laborHours) || 0,
          })),
      };
      return apiRequest(`/api/billing-sheets/${billingSheet.id}`, "PATCH", submitData);
    },
    onSuccess: () => {
      toast({ title: "Billing Sheet Updated", description: "Billing sheet has been updated successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/billing-sheets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing-sheets", billingSheet.id, "items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers/billing-preview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      onSuccess();
      handleClose();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to update billing sheet", variant: "destructive" });
    },
  });

  const handleSave = () => {
    const newErrors: Record<string, string> = {};
    if (!workDescription.trim()) newErrors.workDescription = "Work description is required";
    if (!workDate) newErrors.workDate = "Work date is required";
    if (!totalHours) newErrors.totalHours = "Total hours is required";
    if (!laborRate) newErrors.laborRate = "Labor rate is required";
    if (customerBranches.length > 0 && !branchName) newErrors.branchName = "Branch is required for this customer";
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});
    updateBillingSheet.mutate();
  };

  const openLightbox = (url: string, index: number) => {
    setLightboxPhoto(url);
    setLightboxIndex(index);
  };
  const prevPhoto = () => {
    const newIdx = (lightboxIndex - 1 + editablePhotos.length) % editablePhotos.length;
    setLightboxIndex(newIdx);
    setLightboxPhoto(resolvePhotoUrl(editablePhotos[newIdx].url));
  };
  const nextPhoto = () => {
    const newIdx = (lightboxIndex + 1) % editablePhotos.length;
    setLightboxIndex(newIdx);
    setLightboxPhoto(resolvePhotoUrl(editablePhotos[newIdx].url));
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="w-[95vw] max-w-3xl max-h-[95vh] overflow-hidden p-0 flex flex-col">
          {/* Header — mirrors CompletedWorkDetailModal */}
          <DialogHeader className="flex-shrink-0 p-0">
            <div
              className={`px-5 py-4 border-b ${
                isGreen
                  ? "bg-gradient-to-r from-green-50 to-emerald-50 border-green-100"
                  : "bg-gradient-to-r from-blue-50 to-slate-50 border-gray-100"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`p-2.5 rounded-xl flex-shrink-0 ${isGreen ? "bg-green-100" : "bg-blue-100"}`}>
                    {isGreen ? (
                      <CheckCircle className="w-5 h-5 text-green-600" />
                    ) : (
                      <FileText className="w-5 h-5 text-blue-600" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <DialogTitle className="text-lg font-bold text-gray-900 leading-tight">
                      Edit Billing Sheet {billingSheet.billingNumber ?? `#${billingSheet.id}`}
                    </DialogTitle>
                    <p className="text-sm text-gray-600 mt-0.5 truncate">{billingSheet.customerName}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge className="bg-amber-100 text-amber-700 capitalize">Editing</Badge>
                  <Badge className={`capitalize ${statusColors[status] ?? "bg-gray-100 text-gray-700"}`}>
                    {status.replace(/_/g, " ")}
                  </Badge>
                </div>
              </div>
            </div>
          </DialogHeader>

          {/* Scrollable body */}
          <div className={`flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 ${isReadOnly ? 'pointer-events-none select-none opacity-80' : ''}`}>

            {/* Billed Guard — read-only notice */}
            {isReadOnly && (
              <div className="pointer-events-auto select-auto opacity-100">
                <BilledIndicator invoiceId={billingSheet.invoiceId} />
              </div>
            )}

            {/* Rate mismatch warning — flags stored rate vs customer's current rate */}
            {hasRateMismatch && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <div className="flex items-start gap-2">
                  <span className="text-amber-600 font-bold text-base leading-none mt-0.5">⚠</span>
                  <div>
                    <p className="font-semibold">Rate mismatch detected</p>
                    <p className="mt-0.5">
                      The rate on this sheet (${storedLaborRate.toFixed(2)}/hr) differs from the customer's current rate (${currentCustomerLaborRate?.toFixed(2)}/hr).
                      {isReadOnly
                        ? ' Already billed — review manually before reissuing.'
                        : ' New billing sheets will use the customer\'s current rate automatically.'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Location + Job Info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SectionCard title="Location" icon={<MapPin className="w-4 h-4" />}>
                <div className="space-y-3">
                  <ReadOnlyRow label="Customer" value={billingSheet.customerName} />
                  <FieldRow label="Property Address">
                    <Input
                      value={propertyAddress}
                      onChange={(e) => setPropertyAddress(e.target.value)}
                      placeholder="Enter address"
                      className="h-8 text-sm"
                    />
                  </FieldRow>
                </div>
              </SectionCard>

              <SectionCard title="Job Info" icon={<Calendar className="w-4 h-4" />}>
                <div className="space-y-3">
                  {billingSheet.technicianName && (
                    <ReadOnlyRow label="Technician" value={billingSheet.technicianName} />
                  )}
                  <FieldRow label="Work Date *">
                    <Input
                      type="date"
                      value={workDate}
                      onChange={(e) => setWorkDate(e.target.value)}
                      className={`h-8 text-sm ${errors.workDate ? "border-red-400" : ""}`}
                    />
                    {errors.workDate && <p className="text-xs text-red-500 mt-1">{errors.workDate}</p>}
                  </FieldRow>
                  {customerBranches.length > 0 && (
                    <FieldRow label="Branch *">
                      <Select value={branchName} onValueChange={setBranchName}>
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue placeholder="Select branch..." />
                        </SelectTrigger>
                        <SelectContent>
                          {customerBranches.map((branch) => (
                            <SelectItem key={branch} value={branch}>{branch}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {errors.branchName && <p className="text-xs text-red-500 mt-1">{errors.branchName}</p>}
                    </FieldRow>
                  )}
                </div>
              </SectionCard>
            </div>

            {/* Time & Labor — mirrors Hours × Rate = Total visual */}
            <SectionCard title="Time & Labor" icon={<Clock className="w-4 h-4" />}>
              <div className="flex items-end flex-wrap gap-3">
                <div className="min-w-[90px]">
                  <p className="text-xs text-gray-500 mb-1 text-center">Hours</p>
                  <Input
                    type="number"
                    step="0.25"
                    min="0"
                    value={totalHours}
                    onChange={(e) => setTotalHours(e.target.value)}
                    placeholder="0"
                    className={`text-center text-lg font-bold h-12 bg-gray-50 ${errors.totalHours ? "border-red-400" : ""}`}
                  />
                  {errors.totalHours && <p className="text-xs text-red-500 mt-1">{errors.totalHours}</p>}
                </div>
                <span className="text-xl font-semibold text-gray-400 pb-1.5">×</span>
                <div className="min-w-[100px]">
                  <p className="text-xs text-gray-500 mb-1 text-center">Rate / hr ($)</p>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={laborRate}
                    onChange={(e) => setLaborRate(e.target.value)}
                    placeholder="0.00"
                    className={`text-center text-lg font-bold h-12 bg-gray-50 ${errors.laborRate ? "border-red-400" : ""}`}
                  />
                  {errors.laborRate && <p className="text-xs text-red-500 mt-1">{errors.laborRate}</p>}
                </div>
                <span className="text-xl font-semibold text-gray-400 pb-1.5">=</span>
                <div className="bg-blue-50 rounded-lg px-4 py-3 text-center min-w-[100px] border border-blue-100">
                  <p className="text-xl font-bold text-blue-700">{currency(laborSubtotal)}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Labor Total</p>
                </div>
              </div>
            </SectionCard>

            {/* Parts & Materials */}
            <SectionCard
              title={`Parts & Materials (${parts.length} item${parts.length !== 1 ? "s" : ""})`}
              icon={<Package className="w-4 h-4" />}
            >
              <div className="space-y-3">
                {parts.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="text-left pb-2 font-medium text-gray-600 pr-3">Part</th>
                          <th className="text-center pb-2 font-medium text-gray-600 px-2 whitespace-nowrap">Qty</th>
                          <th className="text-right pb-2 font-medium text-gray-600 px-2 whitespace-nowrap">Unit $</th>
                          <th className="text-right pb-2 font-medium text-gray-600 pl-2 whitespace-nowrap">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {parts.map((part, idx) => {
                          const lineTotal = (Number(part.quantity) || 0) * (Number(part.unitPrice) || 0);
                          return (
                            <tr key={idx} className="hover:bg-gray-50">
                              <td className="py-2.5 pr-3 font-medium text-gray-900">{part.partName}</td>
                              <td className="py-2.5 px-2 text-center text-gray-700">{part.quantity}</td>
                              <td className="py-2.5 px-2 text-right text-gray-700">{currency(Number(part.unitPrice))}</td>
                              <td className="py-2.5 pl-2 text-right font-medium text-gray-900">{currency(lineTotal)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-gray-200">
                          <td colSpan={3} className="pt-2 text-sm text-gray-600 font-medium">
                            Parts Subtotal
                          </td>
                          <td className="pt-2 text-right font-semibold text-gray-900">{currency(partsTotal)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
                {parts.length === 0 && (
                  <p className="text-sm text-gray-400 italic">No parts added.</p>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowPartsEditor(true)}
                  className="gap-1.5 text-blue-600 border-blue-200 hover:bg-blue-50"
                >
                  <Edit className="w-3.5 h-3.5" />
                  Edit Parts List
                </Button>
              </div>
            </SectionCard>

            {/* Photos (editable — add/remove) */}
            <SectionCard title={`Photos (${editablePhotos.length})`} icon={<Camera className="w-4 h-4" />}>
              <div className="space-y-3">
                {editablePhotos.length > 0 && (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {editablePhotos.map((photo, idx) => (
                      <div key={idx} className="relative group aspect-square rounded-lg overflow-hidden border border-gray-100">
                        <button
                          type="button"
                          onClick={() => openLightbox(resolvePhotoUrl(photo.url), idx)}
                          className="w-full h-full"
                        >
                          <img
                            src={resolvePhotoUrl(photo.url)}
                            alt={`Photo ${idx + 1}`}
                            className="w-full h-full object-cover"
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditablePhotos(prev => prev.filter((_, i) => i !== idx))}
                          className="absolute top-1 right-1 bg-red-500 hover:bg-red-600 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Remove photo"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <FileUpload
                  type="photo"
                  label="Add Photos"
                  accept="image/*"
                  multiple
                  files={[]}
                  onFilesChange={(newFiles) => setEditablePhotos(prev => [...prev, ...newFiles])}
                />
              </div>
            </SectionCard>

            {/* Notes */}
            <SectionCard title="Notes & Description" icon={<FileText className="w-4 h-4" />}>
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Work Description *</p>
                    <AiExpandButton
                      getValue={() => workDescription}
                      onSuggestion={setAiSuggestion}
                    />
                  </div>
                  <Textarea
                    value={workDescription}
                    onChange={(e) => setWorkDescription(e.target.value)}
                    placeholder="Describe the work performed..."
                    className={`min-h-[80px] text-sm resize-none ${errors.workDescription ? "border-red-400" : ""}`}
                  />
                  <AiSuggestionCard
                    suggestion={aiSuggestion}
                    onAccept={() => { setWorkDescription(aiSuggestion!); setAiSuggestion(null); }}
                    onDismiss={() => setAiSuggestion(null)}
                  />
                  {errors.workDescription && (
                    <p className="text-xs text-red-500 mt-1">{errors.workDescription}</p>
                  )}
                </div>
                <FieldRow label="Additional Notes">
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Additional notes..."
                    className="min-h-[60px] text-sm resize-none"
                  />
                </FieldRow>
              </div>
            </SectionCard>

            {/* Financial Summary */}
            <SectionCard title="Financial Summary" icon={<DollarSign className="w-4 h-4" />}>
              <div className="space-y-2">
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Labor ({hoursNum} hrs × {currency(rateNum)}/hr)</span>
                  <span className="font-medium text-gray-900">{currency(laborSubtotal)}</span>
                </div>
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Parts Subtotal</span>
                  <span className="font-medium text-gray-900">{currency(partsTotal)}</span>
                </div>
                <Separator className="my-1" />
                <div className="flex justify-between items-center">
                  <span className="text-base font-semibold text-gray-900">Grand Total</span>
                  <span className="text-xl font-bold text-blue-700">{currency(grandTotal)}</span>
                </div>
              </div>
            </SectionCard>
          </div>

          {/* Footer */}
          <div className="flex-shrink-0 border-t border-gray-100 px-5 py-3 bg-gray-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Hash className="w-3.5 h-3.5" />
                <span>Billing Sheet {billingSheet.billingNumber ?? `#${billingSheet.id}`}</span>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={handleClose}>
                  <X className="w-4 h-4 mr-1.5" />
                  {isReadOnly ? "Close" : "Cancel"}
                </Button>
                {!isReadOnly && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSave}
                    disabled={updateBillingSheet.isPending}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {updateBillingSheet.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Parts editor sub-modal */}
      <EditPartsModal
        open={showPartsEditor}
        onOpenChange={setShowPartsEditor}
        initialParts={parts}
        onSave={(updated) => setParts(updated)}
        title="Edit Billing Sheet Parts"
      />

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
            {editablePhotos.length > 1 && (
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
            <img src={lightboxPhoto} alt="Full size" className="max-w-full max-h-full object-contain" />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
