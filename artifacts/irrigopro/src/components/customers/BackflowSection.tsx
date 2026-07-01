import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { uploadPhotoToStorage } from "@/pages/wet-checks/helpers";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  Loader2,
  Droplets,
  AlertTriangle,
  Clock,
  CheckCircle,
  CalendarDays,
  MapPin,
  Hash,
  Building2,
  ClipboardList,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronRight,
  Image,
  Camera,
  ImageIcon,
  X,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface IrrigationBackflow {
  id: number;
  companyId: number;
  customerId: number;
  branchName: string;
  name: string;
  brand: string | null;
  model: string | null;
  size: string | null;
  deviceType: string;
  serialNumber: string | null;
  location: string | null;
  installDate: string | null;
  photoUrl: string | null;
  notes: string | null;
  lastTestedDate: string | null;
  nextTestDueDate: string | null;
  lastTestResult: string | null;
  lastTestedBy: string | null;
  isActive: boolean;
  lastUpdatedByName: string | null;
  lastUpdatedAt: string | null;
  createdAt: string;
}

type BackflowStatus = "overdue" | "due_soon" | "current" | "not_scheduled";

function computeStatus(nextTestDueDate: string | null): BackflowStatus {
  if (!nextTestDueDate) return "not_scheduled";
  const due = new Date(nextTestDueDate);
  const now = new Date();
  // Strip time — compare date-only
  now.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "overdue";
  if (diffDays <= 30) return "due_soon";
  return "current";
}

function StatusChip({ status }: { status: BackflowStatus }) {
  if (status === "overdue") {
    return (
      <Badge className="bg-red-100 text-red-700 border border-red-200 gap-1 text-xs">
        <AlertTriangle className="w-3 h-3" /> Overdue
      </Badge>
    );
  }
  if (status === "due_soon") {
    return (
      <Badge className="bg-amber-100 text-amber-700 border border-amber-200 gap-1 text-xs">
        <Clock className="w-3 h-3" /> Due soon
      </Badge>
    );
  }
  if (status === "current") {
    return (
      <Badge className="bg-green-100 text-green-700 border border-green-200 gap-1 text-xs">
        <CheckCircle className="w-3 h-3" /> Current
      </Badge>
    );
  }
  return (
    <Badge className="bg-gray-100 text-gray-500 border border-gray-200 gap-1 text-xs">
      <CalendarDays className="w-3 h-3" /> Not scheduled
    </Badge>
  );
}

const DEVICE_TYPE_LABELS: Record<string, string> = {
  rpz: "RPZ",
  double_check: "Double Check",
  pvb: "PVB",
  spill_resistant_pvb: "Spill-Resistant PVB",
  other: "Other",
};

function fmtDate(val: string | null | undefined): string {
  if (!val) return "—";
  try {
    return new Date(val).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return String(val);
  }
}

// ── BackflowCard ─────────────────────────────────────────────────────────────

function BackflowCard({
  backflow,
  canManage,
  canLogTest,
  onEdit,
  onLogTest,
  onDelete,
}: {
  backflow: IrrigationBackflow;
  canManage: boolean;
  canLogTest: boolean;
  onEdit: (bf: IrrigationBackflow) => void;
  onLogTest: (bf: IrrigationBackflow) => void;
  onDelete: (bf: IrrigationBackflow) => void;
}) {
  const status = computeStatus(backflow.nextTestDueDate);

  return (
    <Card className="border border-gray-200 dark:border-gray-700">
      <CardContent className="pt-4 pb-3 space-y-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                {backflow.name}
              </span>
              <StatusChip status={status} />
            </div>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {backflow.deviceType && backflow.deviceType !== "other" && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 border border-indigo-200">
                  {DEVICE_TYPE_LABELS[backflow.deviceType] ?? backflow.deviceType}
                </span>
              )}
              {backflow.size && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 border border-sky-200">
                  {backflow.size}
                </span>
              )}
              {backflow.brand && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200">
                  {backflow.brand}
                  {backflow.model ? ` ${backflow.model}` : ""}
                </span>
              )}
            </div>
          </div>
          {(canManage || canLogTest) && (
            <div className="flex gap-1 shrink-0">
              {canLogTest && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                onClick={() => onLogTest(backflow)}
              >
                <ClipboardList className="w-3.5 h-3.5 mr-1" />
                Log test
              </Button>
              )}
              {canManage && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => onEdit(backflow)}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50"
                    onClick={() => onDelete(backflow)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Details grid */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
          {backflow.location && (
            <div className="flex items-center gap-1 col-span-2">
              <MapPin className="w-3 h-3 shrink-0 text-gray-400" />
              <span>{backflow.location}</span>
            </div>
          )}
          {backflow.serialNumber && (
            <div className="flex items-center gap-1">
              <Hash className="w-3 h-3 shrink-0 text-gray-400" />
              <span>S/N: {backflow.serialNumber}</span>
            </div>
          )}
          {backflow.installDate && (
            <div className="flex items-center gap-1">
              <Building2 className="w-3 h-3 shrink-0 text-gray-400" />
              <span>Installed {fmtDate(backflow.installDate)}</span>
            </div>
          )}
        </div>

        {/* Compliance row */}
        <div className="border-t pt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
          <div>
            <span className="text-gray-400">Last tested:</span>{" "}
            <span className={backflow.lastTestedDate ? "" : "italic text-gray-400"}>
              {backflow.lastTestedDate ? fmtDate(backflow.lastTestedDate) : "Never"}
            </span>
            {backflow.lastTestResult && (
              <span
                className={`ml-1 font-medium ${
                  backflow.lastTestResult === "pass"
                    ? "text-green-600"
                    : "text-red-600"
                }`}
              >
                ({backflow.lastTestResult.toUpperCase()})
              </span>
            )}
          </div>
          <div>
            <span className="text-gray-400">Next due:</span>{" "}
            <span
              className={
                status === "overdue"
                  ? "text-red-600 font-medium"
                  : status === "due_soon"
                  ? "text-amber-600 font-medium"
                  : ""
              }
            >
              {backflow.nextTestDueDate ? fmtDate(backflow.nextTestDueDate) : "—"}
            </span>
          </div>
          {backflow.lastTestedBy && (
            <div className="col-span-2 text-gray-400">
              Tested by: <span className="text-gray-600">{backflow.lastTestedBy}</span>
            </div>
          )}
        </div>

        {/* Photo thumbnail */}
        {backflow.photoUrl && (
          <div>
            <a
              href={`/api/photos/${backflow.photoUrl}?variant=medium`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"
            >
              <Image className="w-3.5 h-3.5" /> View photo
            </a>
          </div>
        )}

        {/* Notes */}
        {backflow.notes && (
          <p className="text-xs text-gray-500 dark:text-gray-400 italic">{backflow.notes}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── AddEditBackflowModal ──────────────────────────────────────────────────────

interface BackflowFormData {
  name: string;
  branchName: string;
  brand: string;
  model: string;
  size: string;
  deviceType: string;
  serialNumber: string;
  location: string;
  installDate: string;
  photoUrl: string;
  notes: string;
  lastTestedDate: string;
  nextTestDueDate: string;
  lastTestResult: string;
  lastTestedBy: string;
}

const emptyForm = (): BackflowFormData => ({
  name: "",
  branchName: "",
  brand: "",
  model: "",
  size: "",
  deviceType: "other",
  serialNumber: "",
  location: "",
  installDate: "",
  photoUrl: "",
  notes: "",
  lastTestedDate: "",
  nextTestDueDate: "",
  lastTestResult: "",
  lastTestedBy: "",
});

function backflowToForm(bf: IrrigationBackflow): BackflowFormData {
  return {
    name: bf.name ?? "",
    branchName: bf.branchName ?? "",
    brand: bf.brand ?? "",
    model: bf.model ?? "",
    size: bf.size ?? "",
    deviceType: bf.deviceType ?? "other",
    serialNumber: bf.serialNumber ?? "",
    location: bf.location ?? "",
    installDate: bf.installDate ?? "",
    photoUrl: bf.photoUrl ?? "",
    notes: bf.notes ?? "",
    lastTestedDate: bf.lastTestedDate ?? "",
    nextTestDueDate: bf.nextTestDueDate ?? "",
    lastTestResult: bf.lastTestResult ?? "",
    lastTestedBy: bf.lastTestedBy ?? "",
  };
}

function AddEditBackflowModal({
  open,
  onOpenChange,
  customerId,
  editing,
  branchNameDefault,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: number;
  editing: IrrigationBackflow | null;
  branchNameDefault?: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<BackflowFormData>(() =>
    editing ? backflowToForm(editing) : { ...emptyForm(), branchName: branchNameDefault ?? "" },
  );
  const [photoUploading, setPhotoUploading] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  // Re-hydrate form whenever the modal opens or the editing target changes.
  useEffect(() => {
    if (open) {
      setForm(
        editing
          ? backflowToForm(editing)
          : { ...emptyForm(), branchName: branchNameDefault ?? "" },
      );
      setPhotoUploading(false);
    }
  }, [open, editing?.id, branchNameDefault]); // eslint-disable-line react-hooks/exhaustive-deps

  const isEdit = !!editing;

  const onPhotoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setPhotoUploading(true);
    try {
      const url = await uploadPhotoToStorage(file);
      setForm((f) => ({ ...f, photoUrl: url }));
      toast({ title: "Photo uploaded" });
    } catch (err: any) {
      toast({
        title: "Photo upload failed",
        description: err?.message ?? "Try again",
        variant: "destructive",
      });
    } finally {
      setPhotoUploading(false);
    }
  };

  const mutation = useMutation({
    mutationFn: (data: BackflowFormData) => {
      const payload = {
        name: data.name,
        branchName: data.branchName || undefined,
        brand: data.brand || null,
        model: data.model || null,
        size: data.size || null,
        deviceType: data.deviceType || "other",
        serialNumber: data.serialNumber || null,
        location: data.location || null,
        installDate: data.installDate || null,
        photoUrl: data.photoUrl || null,
        notes: data.notes || null,
        lastTestedDate: data.lastTestedDate || null,
        nextTestDueDate: data.nextTestDueDate || null,
        lastTestResult:
          data.lastTestResult && data.lastTestResult !== "__none__"
            ? (data.lastTestResult as "pass" | "fail")
            : null,
        lastTestedBy: data.lastTestedBy || null,
        isActive: true,
      };
      if (isEdit && editing) {
        return apiRequest(`/api/backflows/${editing.id}`, "PUT", payload);
      }
      return apiRequest(`/api/customers/${customerId}/backflows`, "POST", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/customers/${customerId}/backflows`] });
      toast({ title: isEdit ? "Backflow updated" : "Backflow added" });
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({
        title: isEdit ? "Failed to update" : "Failed to add",
        description: err?.message ?? "Please try again",
        variant: "destructive",
      });
    },
  });

  function set(field: keyof BackflowFormData, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Backflow Preventer" : "Add Backflow Preventer"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* ── Device info ───────────────────────────────────────────── */}
          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 mb-3">
              Device Info
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <Label className="text-xs">Name *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  className="h-8 text-sm mt-1"
                  placeholder="e.g. Backflow A"
                  autoFocus
                />
              </div>
              <div>
                <Label className="text-xs">Location</Label>
                <Input
                  value={form.location}
                  onChange={(e) => set("location", e.target.value)}
                  className="h-8 text-sm mt-1"
                  placeholder="e.g. Near main meter"
                />
              </div>
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={form.deviceType} onValueChange={(v) => set("deviceType", v)}>
                  <SelectTrigger className="h-8 text-sm mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rpz">RPZ</SelectItem>
                    <SelectItem value="double_check">Double Check</SelectItem>
                    <SelectItem value="pvb">PVB</SelectItem>
                    <SelectItem value="spill_resistant_pvb">Spill-Resistant PVB</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Brand</Label>
                <Input
                  value={form.brand}
                  onChange={(e) => set("brand", e.target.value)}
                  className="h-8 text-sm mt-1"
                  placeholder="e.g. Febco"
                />
              </div>
              <div>
                <Label className="text-xs">Model</Label>
                <Input
                  value={form.model}
                  onChange={(e) => set("model", e.target.value)}
                  className="h-8 text-sm mt-1"
                  placeholder="e.g. 765"
                />
              </div>
              <div>
                <Label className="text-xs">Size</Label>
                <Input
                  value={form.size}
                  onChange={(e) => set("size", e.target.value)}
                  className="h-8 text-sm mt-1"
                  placeholder='e.g. 1"'
                />
              </div>
              <div>
                <Label className="text-xs">Serial Number</Label>
                <Input
                  value={form.serialNumber}
                  onChange={(e) => set("serialNumber", e.target.value)}
                  className="h-8 text-sm mt-1"
                  placeholder="Optional"
                />
              </div>
              <div>
                <Label className="text-xs">Install Date</Label>
                <Input
                  type="date"
                  value={form.installDate}
                  onChange={(e) => set("installDate", e.target.value)}
                  className="h-8 text-sm mt-1"
                />
              </div>
            </div>
          </section>

          {/* ── Test / Compliance ─────────────────────────────────────── */}
          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-600 mb-3">
              Test / Compliance
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Last Tested Date</Label>
                <Input
                  type="date"
                  value={form.lastTestedDate}
                  onChange={(e) => set("lastTestedDate", e.target.value)}
                  className="h-8 text-sm mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Next Due Date</Label>
                <Input
                  type="date"
                  value={form.nextTestDueDate}
                  onChange={(e) => set("nextTestDueDate", e.target.value)}
                  className="h-8 text-sm mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Test Result</Label>
                <Select
                  value={form.lastTestResult}
                  onValueChange={(v) => set("lastTestResult", v)}
                >
                  <SelectTrigger className="h-8 text-sm mt-1">
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Not recorded —</SelectItem>
                    <SelectItem value="pass">Pass</SelectItem>
                    <SelectItem value="fail">Fail</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Tested By</Label>
                <Input
                  value={form.lastTestedBy}
                  onChange={(e) => set("lastTestedBy", e.target.value)}
                  className="h-8 text-sm mt-1"
                  placeholder="Name of tester"
                />
              </div>
            </div>
          </section>

          {/* ── Photo & Notes ─────────────────────────────────────────── */}
          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
              Photo &amp; Notes
            </p>
            <div className="space-y-3">
              {/* Hidden file inputs for camera and library */}
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={onPhotoPick}
              />
              <input
                ref={libraryRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onPhotoPick}
              />

              {/* Photo preview + picker button */}
              <div>
                <Label className="text-xs">Device Photo</Label>
                <div className="mt-1 space-y-2">
                  {form.photoUrl ? (
                    <div className="relative inline-block">
                      <img
                        src={`/api/photos/${form.photoUrl}?variant=thumb`}
                        alt="Backflow device"
                        className="h-28 w-auto rounded-lg border object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => set("photoUrl", "")}
                        className="absolute -top-1.5 -right-1.5 bg-white border border-gray-300 rounded-full p-0.5 shadow-sm hover:bg-red-50"
                        title="Remove photo"
                      >
                        <X className="w-3 h-3 text-gray-500" />
                      </button>
                    </div>
                  ) : (
                    <div className="h-24 w-full max-w-xs flex items-center justify-center bg-gray-50 border-2 border-dashed border-gray-200 rounded-lg">
                      <p className="text-xs text-gray-400">No photo yet</p>
                    </div>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        type="button"
                        disabled={photoUploading}
                        className="gap-1.5"
                      >
                        {photoUploading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Camera className="w-4 h-4" />
                        )}
                        {form.photoUrl ? "Replace Photo" : "Add Photo"}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem
                        onSelect={(e) => {
                          e.preventDefault();
                          cameraRef.current?.click();
                        }}
                      >
                        <Camera className="w-4 h-4 mr-2" /> Take Photo
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={(e) => {
                          e.preventDefault();
                          libraryRef.current?.click();
                        }}
                      >
                        <ImageIcon className="w-4 h-4 mr-2" /> Choose from Library
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div>
                <Label className="text-xs">Notes</Label>
                <Textarea
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  className="text-sm mt-1 resize-none"
                  rows={3}
                  placeholder="Optional notes about this device…"
                />
              </div>
            </div>
          </section>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate(form)}
            disabled={mutation.isPending || photoUploading || !form.name.trim()}
            className="gap-1.5"
          >
            {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? "Save Changes" : "Add Backflow"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── LogTestModal ──────────────────────────────────────────────────────────────

function LogTestModal({
  open,
  onOpenChange,
  backflow,
  customerId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  backflow: IrrigationBackflow | null;
  customerId: number;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    lastTestedDate: today,
    lastTestResult: "pass" as "pass" | "fail",
    lastTestedBy: "",
    nextTestDueDate: "",
  });

  // Reset the form each time the modal opens for a (possibly different) device.
  useEffect(() => {
    if (open) {
      setForm({
        lastTestedDate: today,
        lastTestResult: "pass",
        lastTestedBy: "",
        nextTestDueDate: "",
      });
    }
  }, [open, backflow?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: () => {
      if (!backflow) throw new Error("No backflow selected");
      return apiRequest(`/api/backflows/${backflow.id}/log-test`, "POST", {
        lastTestedDate: form.lastTestedDate,
        lastTestResult: form.lastTestResult,
        lastTestedBy: form.lastTestedBy || null,
        nextTestDueDate: form.nextTestDueDate || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/customers/${customerId}/backflows`] });
      toast({ title: "Test logged", description: "Next due date advanced by 1 year." });
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({
        title: "Failed to log test",
        description: err?.message ?? "Please try again",
        variant: "destructive",
      });
    },
  });

  if (!backflow) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Log Test — {backflow.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs">Test Date *</Label>
            <Input
              type="date"
              value={form.lastTestedDate}
              onChange={(e) => setForm((f) => ({ ...f, lastTestedDate: e.target.value }))}
              className="h-8 text-sm mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Result *</Label>
            <Select
              value={form.lastTestResult}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, lastTestResult: v as "pass" | "fail" }))
              }
            >
              <SelectTrigger className="h-8 text-sm mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pass">Pass</SelectItem>
                <SelectItem value="fail">Fail</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Tested By</Label>
            <Input
              value={form.lastTestedBy}
              onChange={(e) => setForm((f) => ({ ...f, lastTestedBy: e.target.value }))}
              className="h-8 text-sm mt-1"
              placeholder="Name of tester (optional)"
            />
          </div>
          <div>
            <Label className="text-xs">Override Next Due Date</Label>
            <Input
              type="date"
              value={form.nextTestDueDate}
              onChange={(e) => setForm((f) => ({ ...f, nextTestDueDate: e.target.value }))}
              className="h-8 text-sm mt-1"
            />
            <p className="text-xs text-gray-400 mt-1">Leave blank to auto-advance +1 year.</p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !form.lastTestedDate}
            className="gap-1.5"
          >
            {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Log Test
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── DeleteConfirmModal ────────────────────────────────────────────────────────

function DeleteConfirmModal({
  open,
  onOpenChange,
  backflow,
  customerId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  backflow: IrrigationBackflow | null;
  customerId: number;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => {
      if (!backflow) throw new Error("No backflow selected");
      return apiRequest(`/api/backflows/${backflow.id}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/customers/${customerId}/backflows`] });
      toast({ title: "Backflow deleted" });
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({
        title: "Delete failed",
        description: err?.message ?? "Please try again",
        variant: "destructive",
      });
    },
  });

  if (!backflow) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete "{backflow.name}"?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-600">
          This will permanently remove this backflow preventer record. This action cannot be undone.
        </p>
        <DialogFooter className="gap-2 mt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="gap-1.5"
          >
            {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── BackflowSection ───────────────────────────────────────────────────────────

export function BackflowSection({
  customerId,
  canManage,
  canLogTest,
  branchName,
}: {
  customerId: number;
  /** Can create, edit, and delete devices (manager-tier roles only). */
  canManage: boolean;
  /** Can log a test result (manager-tier + field_tech). */
  canLogTest: boolean;
  branchName?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<IrrigationBackflow | null>(null);
  const [logTestTarget, setLogTestTarget] = useState<IrrigationBackflow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<IrrigationBackflow | null>(null);

  const queryKey = [`/api/customers/${customerId}/backflows`];
  const { data: backflows = [], isLoading } = useQuery<IrrigationBackflow[]>({
    queryKey,
    enabled: !!customerId,
  });

  // Compute summary stats
  const overdue = backflows.filter((b) => computeStatus(b.nextTestDueDate) === "overdue").length;
  const dueSoon = backflows.filter((b) => computeStatus(b.nextTestDueDate) === "due_soon").length;

  const summaryParts: string[] = [];
  if (backflows.length > 0) {
    summaryParts.push(`${backflows.length} ${backflows.length === 1 ? "device" : "devices"}`);
    if (overdue > 0) summaryParts.push(`${overdue} overdue`);
    if (dueSoon > 0) summaryParts.push(`${dueSoon} due soon`);
  }

  return (
    <>
      <div className="space-y-3">
        {/* Section header */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="flex items-center gap-2 text-left group"
            onClick={() => setCollapsed((c) => !c)}
          >
            <Droplets className="w-4 h-4 text-sky-500 shrink-0" />
            <span className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-indigo-600 transition-colors">
              Backflows
            </span>
            {backflows.length > 0 && (
              <Badge className="bg-sky-100 text-sky-700 border border-sky-200 text-xs">
                {backflows.length}
              </Badge>
            )}
            {(overdue > 0 || dueSoon > 0) && (
              <span className="text-xs text-gray-500">
                {summaryParts.slice(1).join(" · ")}
              </span>
            )}
            {collapsed ? (
              <ChevronRight className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-gray-400" />
            )}
          </button>
          {canManage && (
            <Button
              size="sm"
              onClick={() => {
                setEditTarget(null);
                setAddOpen(true);
              }}
              className="gap-1.5"
            >
              <Plus className="w-4 h-4" /> Add Backflow
            </Button>
          )}
        </div>

        {/* Summary line */}
        {!collapsed && summaryParts.length > 0 && (
          <p className="text-xs text-gray-500">
            {summaryParts.join(" · ")}
            {overdue > 0 && (
              <span className="ml-1 text-red-600 font-medium">— attention needed</span>
            )}
          </p>
        )}

        {/* List */}
        {!collapsed && (
          <>
            {isLoading && (
              <div className="text-center py-6 text-gray-400 text-sm">
                <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                Loading backflows…
              </div>
            )}

            {!isLoading && backflows.length === 0 && (
              <div className="text-center py-8 text-gray-500 border-2 border-dashed rounded-lg">
                <Droplets className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="font-medium text-sm">No backflow preventers recorded</p>
                {canManage && (
                  <p className="text-xs mt-1">
                    Click "Add Backflow" to start tracking devices for this property.
                  </p>
                )}
              </div>
            )}

            {!isLoading && backflows.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {backflows.map((bf) => (
                  <BackflowCard
                    key={bf.id}
                    backflow={bf}
                    canManage={canManage}
                    canLogTest={canLogTest}
                    onEdit={(b) => {
                      setEditTarget(b);
                      setAddOpen(true);
                    }}
                    onLogTest={(b) => setLogTestTarget(b)}
                    onDelete={(b) => setDeleteTarget(b)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Modals */}
      <AddEditBackflowModal
        open={addOpen}
        onOpenChange={(o) => {
          setAddOpen(o);
          if (!o) setEditTarget(null);
        }}
        customerId={customerId}
        editing={editTarget}
        branchNameDefault={branchName}
      />

      <LogTestModal
        open={!!logTestTarget}
        onOpenChange={(o) => { if (!o) setLogTestTarget(null); }}
        backflow={logTestTarget}
        customerId={customerId}
      />

      <DeleteConfirmModal
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        backflow={deleteTarget}
        customerId={customerId}
      />
    </>
  );
}
