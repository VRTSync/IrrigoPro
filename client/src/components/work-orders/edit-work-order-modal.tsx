import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
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
} from "lucide-react";
import { EditPartsModal, type EditPartRow } from "@/components/billing/edit-parts-modal";
import type { WorkOrder, WorkOrderItem, User as UserType } from "@shared/schema";

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

interface EditWorkOrderModalProps {
  workOrder: WorkOrder;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditWorkOrderModal({ workOrder, open, onClose, onSuccess }: EditWorkOrderModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const formatDateForInput = (date: string | Date | null | undefined): string => {
    if (!date) return "";
    const d = new Date(date);
    if (isNaN(d.getTime())) return "";
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const [projectName, setProjectName] = useState(workOrder.projectName || "");
  const [description, setDescription] = useState(workOrder.description || "");
  const [projectAddress, setProjectAddress] = useState(workOrder.projectAddress || "");
  const [locationNotes, setLocationNotes] = useState(workOrder.locationNotes || "");
  const [scheduledDate, setScheduledDate] = useState(formatDateForInput(workOrder.scheduledDate));
  const [priority, setPriority] = useState(workOrder.priority || "medium");
  const [totalHours, setTotalHours] = useState(workOrder.totalHours?.toString() || "");
  const [laborRate, setLaborRate] = useState(workOrder.laborRate?.toString() || "");
  const [specialInstructions, setSpecialInstructions] = useState(workOrder.specialInstructions || "");
  const [notes, setNotes] = useState(workOrder.notes || "");
  const [assignedTechnicianId, setAssignedTechnicianId] = useState<number | null>(
    workOrder.assignedTechnicianId || null
  );
  const [assignedTechnicianName, setAssignedTechnicianName] = useState(
    workOrder.assignedTechnicianName || ""
  );
  const [branchName, setBranchName] = useState((workOrder as any).branchName || "");
  const [parts, setParts] = useState<EditPartRow[]>([]);
  const [partsLoaded, setPartsLoaded] = useState(false);
  const [showPartsEditor, setShowPartsEditor] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Fetch the customer to get its branches
  const { data: customer } = useQuery({
    queryKey: ["/api/customers", workOrder.customerId],
    queryFn: async () => {
      const res = await fetch(`/api/customers/${workOrder.customerId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: open && !!workOrder.customerId,
  });
  const customerBranches: string[] = (customer as any)?.branches || [];

  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const photos: string[] = workOrder.photos ?? [];

  const { data: fieldTechs } = useQuery<UserType[]>({
    queryKey: ["/api/users/field-techs"],
  });

  const { data: existingItems } = useQuery<WorkOrderItem[]>({
    queryKey: ["/api/work-orders", workOrder.id, "items"],
    queryFn: async () => {
      const res = await fetch(`/api/work-orders/${workOrder.id}/items`);
      if (!res.ok) throw new Error("Failed to fetch items");
      return res.json();
    },
    enabled: open && !partsLoaded,
  });

  useEffect(() => {
    if (!open) {
      setPartsLoaded(false);
      setParts([]);
      return;
    }
    setProjectName(workOrder.projectName || "");
    setDescription(workOrder.description || "");
    setProjectAddress(workOrder.projectAddress || "");
    setLocationNotes(workOrder.locationNotes || "");
    setScheduledDate(formatDateForInput(workOrder.scheduledDate));
    setPriority(workOrder.priority || "medium");
    setTotalHours(workOrder.totalHours?.toString() || "");
    setLaborRate(workOrder.laborRate?.toString() || "");
    setSpecialInstructions(workOrder.specialInstructions || "");
    setNotes(workOrder.notes || "");
    setAssignedTechnicianId(workOrder.assignedTechnicianId || null);
    setAssignedTechnicianName(workOrder.assignedTechnicianName || "");
    setBranchName((workOrder as any).branchName || "");
    setErrors({});
  }, [open, workOrder]);

  useEffect(() => {
    if (existingItems && !partsLoaded) {
      setParts(
        existingItems.map((item) => ({
          partId: item.partId ?? null,
          partName: item.partName,
          quantity: String(item.quantity),
          unitPrice: String(item.partPrice),
          laborHours: String(item.laborHours),
          zoneId: item.zoneId ?? null,
          notes: item.notes ?? "",
        }))
      );
      setPartsLoaded(true);
    }
  }, [existingItems, partsLoaded]);

  const managers = fieldTechs?.filter((u) => u.role === "irrigation_manager") || [];
  const techs = fieldTechs?.filter((u) => u.role === "field_tech") || [];

  const hoursNum = parseFloat(totalHours) || 0;
  const rateNum = parseFloat(laborRate) || 0;
  const laborSubtotal = hoursNum * rateNum;
  const partsTotal = parts.reduce(
    (sum, p) => sum + (Number(p.quantity) || 0) * (Number(p.unitPrice) || 0),
    0
  );
  const grandTotal = laborSubtotal + partsTotal;

  const status = workOrder.status ?? "pending";
  const isGreen = status === "completed" || status === "approved" || status === "billed";

  const updateWorkOrder = useMutation({
    mutationFn: async () => {
      const submitData: Record<string, unknown> = {
        projectName,
        description: description || "",
        projectAddress: projectAddress || "",
        locationNotes: locationNotes || "",
        scheduledDate: scheduledDate ? new Date(scheduledDate + 'T00:00:00').toISOString() : null,
        priority,
        totalHours: totalHours || null,
        laborRate: laborRate || null,
        specialInstructions: specialInstructions || "",
        notes: notes || "",
        branchName: branchName || null,
        assignedTechnicianId: assignedTechnicianId ? Number(assignedTechnicianId) : null,
        assignedTechnicianName: assignedTechnicianId ? assignedTechnicianName : "",
        items: parts
          .filter((p) => p.partName.trim())
          .map((p) => ({
            partId: p.partId,
            partName: p.partName,
            quantity: Number(p.quantity) || 0,
            unitPrice: Number(p.unitPrice) || 0,
            laborHours: Number(p.laborHours) || 0,
            zoneId: p.zoneId,
            notes: p.notes || null,
          })),
        totalPartsCost: partsTotal.toFixed(2),
      };
      return apiRequest(`/api/work-orders/${workOrder.id}`, "PATCH", submitData);
    },
    onSuccess: () => {
      toast({ title: "Work Order Updated", description: "Work order has been updated successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders", workOrder.id, "items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers/billing-preview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      onSuccess();
      onClose();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to update work order", variant: "destructive" });
    },
  });

  const handleSave = () => {
    const newErrors: Record<string, string> = {};
    if (!projectName.trim()) newErrors.projectName = "Project name is required";
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});
    updateWorkOrder.mutate();
  };

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

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
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
                      Edit Work Order {workOrder.workOrderNumber ?? `#${workOrder.id}`}
                    </DialogTitle>
                    <p className="text-sm text-gray-600 mt-0.5 truncate">{workOrder.customerName}</p>
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
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">

            {/* Location + Job Info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SectionCard title="Location" icon={<MapPin className="w-4 h-4" />}>
                <div className="space-y-3">
                  <ReadOnlyRow label="Customer" value={workOrder.customerName} />
                  <FieldRow label="Property Address">
                    <Input
                      value={projectAddress}
                      onChange={(e) => setProjectAddress(e.target.value)}
                      placeholder="Enter address"
                      className="h-8 text-sm"
                    />
                  </FieldRow>
                  <FieldRow label="Location Notes">
                    <Textarea
                      value={locationNotes}
                      onChange={(e) => setLocationNotes(e.target.value)}
                      placeholder="Access notes, gate codes..."
                      className="min-h-[60px] text-sm resize-none"
                    />
                  </FieldRow>
                </div>
              </SectionCard>

              <SectionCard title="Job Info" icon={<Calendar className="w-4 h-4" />}>
                <div className="space-y-3">
                  <FieldRow label="Assign To">
                    <Select
                      value={assignedTechnicianId?.toString() || "__unassign__"}
                      onValueChange={(val) => {
                        if (val === "__unassign__") {
                          setAssignedTechnicianId(null);
                          setAssignedTechnicianName("");
                        } else {
                          const id = parseInt(val);
                          setAssignedTechnicianId(id);
                          const tech = fieldTechs?.find((t) => t.id === id);
                          setAssignedTechnicianName(tech?.name || "");
                        }
                      }}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select person" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__unassign__">Unassigned</SelectItem>
                        {managers.length > 0 && (
                          <>
                            <div className="px-2 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                              Managers
                            </div>
                            {managers.map((u) => (
                              <SelectItem key={u.id} value={u.id.toString()}>
                                {u.name}
                              </SelectItem>
                            ))}
                          </>
                        )}
                        {techs.length > 0 && (
                          <>
                            <div className="px-2 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider border-t mt-1 pt-1">
                              Field Techs
                            </div>
                            {techs.map((u) => (
                              <SelectItem key={u.id} value={u.id.toString()}>
                                {u.name}
                              </SelectItem>
                            ))}
                          </>
                        )}
                      </SelectContent>
                    </Select>
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
                  <FieldRow label="Scheduled Date">
                    <Input
                      type="date"
                      value={scheduledDate}
                      onChange={(e) => setScheduledDate(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </FieldRow>
                  <FieldRow label="Priority">
                    <Select value={priority} onValueChange={setPriority}>
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="urgent">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                  </FieldRow>
                </div>
              </SectionCard>
            </div>

            {/* Time & Labor — mirrors the Hours × Rate = Total visual */}
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
                    className="text-center text-lg font-bold h-12 bg-gray-50"
                  />
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
                    className="text-center text-lg font-bold h-12 bg-gray-50"
                  />
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

            {/* Photos (read-only) */}
            {photos.length > 0 && (
              <SectionCard title={`Photos (${photos.length})`} icon={<Camera className="w-4 h-4" />}>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {photos.map((url, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => openLightbox(url, idx)}
                      className="aspect-square rounded-lg overflow-hidden border border-gray-100 hover:border-blue-300 hover:shadow-md transition-all"
                    >
                      <img src={url} alt={`Photo ${idx + 1}`} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              </SectionCard>
            )}

            {/* Notes */}
            <SectionCard title="Notes & Description" icon={<FileText className="w-4 h-4" />}>
              <div className="space-y-3">
                <FieldRow label="Project Name *">
                  <Input
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="Enter project name"
                    className={`h-9 text-sm ${errors.projectName ? "border-red-400" : ""}`}
                  />
                  {errors.projectName && <p className="text-xs text-red-500 mt-1">{errors.projectName}</p>}
                </FieldRow>
                <FieldRow label="Work Description">
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe the work..."
                    className="min-h-[80px] text-sm resize-none"
                  />
                </FieldRow>
                <FieldRow label="Special Instructions">
                  <Textarea
                    value={specialInstructions}
                    onChange={(e) => setSpecialInstructions(e.target.value)}
                    placeholder="Special instructions for the technician..."
                    className="min-h-[60px] text-sm resize-none"
                  />
                </FieldRow>
                <FieldRow label="Internal Notes">
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Internal notes (not visible to customer)..."
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
                <span>Work Order {workOrder.workOrderNumber ?? `#${workOrder.id}`}</span>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={onClose}>
                  <X className="w-4 h-4 mr-1.5" />
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSave}
                  disabled={updateWorkOrder.isPending}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {updateWorkOrder.isPending ? "Saving..." : "Save Changes"}
                </Button>
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
        title="Edit Work Order Parts"
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
            <img src={lightboxPhoto} alt="Full size" className="max-w-full max-h-full object-contain" />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
