import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { ChevronLeft, FileText, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Customer, EstimateWithItems, EstimateItem } from "@shared/schema";
import type { UploadedFile } from "@/components/ui/file-upload";
import {
  EstimateWizardCustomerStep,
  type CustomerStepValue,
} from "./wizard/estimate-wizard-customer-step";
import {
  EstimateWizardLineItemsStep,
  computeTotals,
  type WizardLineItem,
} from "./wizard/estimate-wizard-line-items-step";
import { EstimateWizardReviewStep } from "./wizard/estimate-wizard-review-step";

interface EstimateApiPayloadEstimate {
  customerId: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  projectName: string;
  projectAddress: string;
  locationNotes: string;
  accessInstructions: string;
  status: string;
  partsSubtotal: string;
  laborSubtotal: string;
  totalAmount: string;
  laborRate: string;
  photos: string[];
  attachments: string[];
}

interface EstimateApiPayloadItem {
  partId: number;
  partName: string;
  partPrice: string;
  quantity: number;
  laborHours: string;
  totalPrice: string;
  description: string;
  sortOrder: number;
}

interface EstimateApiPayload {
  estimate: EstimateApiPayloadEstimate;
  items: EstimateApiPayloadItem[];
}

interface EstimateWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  estimateId?: number | null;
}

type Step = 1 | 2 | 3;

const STEP_TITLES: Record<Step, string> = {
  1: "Customer & Project",
  2: "Line Items",
  3: "Review & Send",
};

function makeRowId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function urlToUploadedFile(url: string): UploadedFile {
  const fileName = url.split("/").pop() || url;
  return { url, fileName, originalName: fileName };
}

interface DraftSnapshot {
  customerId: number | null;
  projectName: string;
  projectAddress: string;
  locationNotes: string;
  accessInstructions: string;
  laborRate: number;
  items: Array<Pick<WizardLineItem, "partId" | "partName" | "partPrice" | "quantity" | "laborHours" | "description">>;
  photos: string[];
  attachments: string[];
}

function snapshot(
  cs: CustomerStepValue,
  items: WizardLineItem[],
  laborRate: number,
  photos: UploadedFile[],
  attachments: UploadedFile[],
): DraftSnapshot {
  return {
    customerId: cs.customer?.id ?? null,
    projectName: cs.projectName.trim(),
    projectAddress: cs.projectAddress.trim(),
    locationNotes: cs.locationNotes.trim(),
    accessInstructions: cs.accessInstructions.trim(),
    laborRate,
    items: items.map((it) => ({
      partId: it.partId,
      partName: it.partName,
      partPrice: it.partPrice,
      quantity: it.quantity,
      laborHours: it.laborHours,
      description: it.description,
    })),
    photos: photos.map((p) => p.url),
    attachments: attachments.map((a) => a.url),
  };
}

export function EstimateWizard({ open, onOpenChange, estimateId }: EstimateWizardProps) {
  const isEdit = !!estimateId;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>(isEdit ? 2 : 1);
  const [customerStep, setCustomerStep] = useState<CustomerStepValue>({
    customer: null,
    projectName: "",
    projectAddress: "",
    useDifferentAddress: false,
    locationNotes: "",
    accessInstructions: "",
  });
  const [items, setItems] = useState<WizardLineItem[]>([]);
  const [laborRate, setLaborRate] = useState<number>(45);
  const [photos, setPhotos] = useState<UploadedFile[]>([]);
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const [discardOpen, setDiscardOpen] = useState(false);
  const initialSnapshotRef = useRef<DraftSnapshot | null>(null);
  const hydratedRef = useRef(false);

  // Reset state whenever the wizard opens.
  useEffect(() => {
    if (open) {
      setStep(isEdit ? 2 : 1);
      hydratedRef.current = false;
      if (!isEdit) {
        setCustomerStep({
          customer: null,
          projectName: "",
          projectAddress: "",
          useDifferentAddress: false,
          locationNotes: "",
          accessInstructions: "",
        });
        setItems([]);
        setLaborRate(45);
        setPhotos([]);
        setAttachments([]);
        initialSnapshotRef.current = snapshot(
          {
            customer: null,
            projectName: "",
            projectAddress: "",
            useDifferentAddress: false,
            locationNotes: "",
            accessInstructions: "",
          },
          [],
          45,
          [],
          [],
        );
      }
    }
  }, [open, isEdit]);

  // Load existing estimate in edit mode.
  const { data: existing, isLoading: existingLoading } = useQuery<EstimateWithItems>({
    queryKey: ["/api/estimates", estimateId],
    enabled: isEdit && open,
  });

  useEffect(() => {
    if (!isEdit || !existing || !open || hydratedRef.current) return;
    const lr = parseFloat(existing.laborRate ?? "45") || 45;
    setLaborRate(lr);
    const cust: Customer = {
      id: existing.customerId,
      name: existing.customerName,
      email: existing.customerEmail,
      phone: existing.customerPhone,
      address: existing.projectAddress,
    } as Customer;
    const usingDifferent = false;
    const cs: CustomerStepValue = {
      customer: cust,
      projectName: existing.projectName ?? "",
      projectAddress: existing.projectAddress ?? "",
      useDifferentAddress: usingDifferent,
      locationNotes: existing.locationNotes ?? "",
      accessInstructions: existing.accessInstructions ?? "",
    };
    setCustomerStep(cs);
    const loaded: WizardLineItem[] = (existing.items ?? []).map((it: EstimateItem) => {
      const qty = Math.max(Number(it.quantity ?? 1), 1);
      return {
        rowId: makeRowId(),
        partId: it.partId ?? 0,
        partName: it.partName,
        partPrice: parseFloat(String(it.partPrice ?? "0")) || 0,
        quantity: qty,
        // Stored laborHours is per-line total; editor stores per-unit.
        laborHours: (parseFloat(String(it.laborHours ?? "0")) || 0) / qty,
        description: it.description ?? "",
      };
    });
    setItems(loaded);
    const ph = (existing.photos ?? []).map(urlToUploadedFile);
    const at = (existing.attachments ?? []).map(urlToUploadedFile);
    setPhotos(ph);
    setAttachments(at);
    initialSnapshotRef.current = snapshot(cs, loaded, lr, ph, at);
    hydratedRef.current = true;
  }, [isEdit, existing, open]);

  // Re-derive labor rate from the selected customer whenever the customer
  // changes — including in edit mode, since the user can swap customers from
  // Step 2 ("Change customer" → Step 1) and the submitted labor rate must
  // stay consistent with the chosen customer.
  useEffect(() => {
    if (!customerStep.customer) return;
    if (isEdit && existing && customerStep.customer.id === existing.customerId) {
      // Original customer unchanged in edit mode — preserve the stored rate.
      return;
    }
    const lr = parseFloat(String(customerStep.customer.laborRate ?? "45")) || 45;
    setLaborRate(lr);
  }, [customerStep.customer?.id, isEdit, existing]);

  const isDirty = useMemo(() => {
    const baseline = initialSnapshotRef.current;
    if (!baseline) return false;
    const current = snapshot(customerStep, items, laborRate, photos, attachments);
    return JSON.stringify(baseline) !== JSON.stringify(current);
  }, [customerStep, items, laborRate, photos, attachments]);

  const saveMutation = useMutation<unknown, Error, EstimateApiPayload>({
    mutationFn: async (payload) => {
      if (isEdit) return await apiRequest(`/api/estimates/${estimateId}`, "PUT", payload);
      return await apiRequest("/api/estimates", "POST", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      if (isEdit && estimateId) {
        queryClient.invalidateQueries({ queryKey: ["/api/estimates", estimateId] });
      }
      toast({ title: "Estimate sent to approval queue" });
      onOpenChange(false);
    },
    onError: (err) => {
      toast({
        title: isEdit ? "Failed to update estimate" : "Failed to create estimate",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (!customerStep.customer) {
      toast({ title: "Customer required", variant: "destructive" });
      setStep(1);
      return;
    }
    if (items.length === 0) {
      toast({ title: "Add at least one line item", variant: "destructive" });
      setStep(2);
      return;
    }
    const totals = computeTotals(items, laborRate);
    const estimate: EstimateApiPayloadEstimate = {
      customerId: customerStep.customer.id,
      customerName: customerStep.customer.name,
      customerEmail: customerStep.customer.email,
      customerPhone: customerStep.customer.phone || "",
      projectName: customerStep.projectName.trim(),
      projectAddress: customerStep.projectAddress.trim() || "",
      locationNotes: customerStep.locationNotes.trim() || "",
      accessInstructions: customerStep.accessInstructions.trim() || "",
      status: existing?.status ?? "pending",
      partsSubtotal: totals.partsSubtotal.toFixed(2),
      laborSubtotal: totals.laborSubtotal.toFixed(2),
      totalAmount: totals.totalAmount.toFixed(2),
      laborRate: laborRate.toFixed(2),
      photos: photos.map((p) => p.url),
      attachments: attachments.map((a) => a.url),
    };
    const itemsPayload: EstimateApiPayloadItem[] = items.map((it, index) => ({
      partId: it.partId,
      partName: it.partName,
      partPrice: it.partPrice.toFixed(2),
      quantity: it.quantity,
      laborHours: (it.laborHours * it.quantity).toFixed(2),
      totalPrice: (it.partPrice * it.quantity).toFixed(2),
      description: it.description,
      sortOrder: index,
    }));
    saveMutation.mutate({ estimate, items: itemsPayload });
  };

  const requestClose = () => {
    if (isDirty) setDiscardOpen(true);
    else onOpenChange(false);
  };

  // Enter handling at the wizard level. Esc is delegated to Radix's
  // `onEscapeKeyDown` so a nested dismissable layer (e.g. the part picker
  // Sheet) gets to handle Esc first instead of the wizard intercepting it.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "TEXTAREA") return;
      if (target?.isContentEditable) return;
      // Don't fire while a button or link inside is focused — let it click itself.
      if (tag === "BUTTON" || tag === "A") return;
      if (step === 1 && customerStep.customer && customerStep.projectName.trim()) {
        e.preventDefault();
        setStep(2);
      } else if (step === 2 && items.length > 0) {
        e.preventDefault();
        setStep(3);
      } else if (step === 3 && !saveMutation.isPending) {
        e.preventDefault();
        handleSubmit();
      }
    }
  };

  const progressPct = Math.round((step / 3) * 100);

  const stickyMobileFooter = (
    <div className="sm:hidden sticky bottom-0 -mx-4 px-4 py-3 bg-white border-t z-10 flex items-center gap-2">
      {step === 1 && (
        <>
          <Button type="button" variant="outline" onClick={requestClose} className="flex-1">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => setStep(2)}
            disabled={!customerStep.customer || !customerStep.projectName.trim()}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
          >
            Continue
          </Button>
        </>
      )}
      {step === 2 && (
        <>
          <Button type="button" variant="outline" onClick={() => setStep(1)} className="flex-1">
            ← Back
          </Button>
          <Button
            type="button"
            onClick={() => setStep(3)}
            disabled={items.length === 0}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
            title={items.length === 0 ? "Add at least one part to continue" : undefined}
          >
            Review
          </Button>
        </>
      )}
      {step === 3 && (
        <>
          <Button type="button" variant="outline" onClick={() => setStep(2)} className="flex-1">
            ← Back
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={saveMutation.isPending}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
          >
            {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {isEdit ? "Save" : "Submit"}
          </Button>
        </>
      )}
    </div>
  );

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) requestClose();
          else onOpenChange(o);
        }}
      >
        <DialogContent
          onKeyDown={handleKeyDown}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            requestClose();
          }}
          onInteractOutside={(e) => {
            // Prevent click-outside from auto-closing while dirty; user must use Cancel/Esc.
            if (isDirty) e.preventDefault();
          }}
          className="
            p-0 overflow-hidden
            inset-0 left-0 top-0 translate-x-0 translate-y-0
            w-screen h-screen max-w-none max-h-none rounded-none
            sm:inset-auto sm:left-[50%] sm:top-[50%] sm:-translate-x-1/2 sm:-translate-y-1/2
            sm:w-[95vw] sm:max-w-3xl md:max-w-4xl lg:max-w-5xl sm:max-h-[95vh] sm:rounded-2xl
            flex flex-col
          "
          aria-describedby={undefined}
        >
          {/* Sticky header */}
          <div className="sticky top-0 z-20 bg-white border-b">
            <div className="flex items-center gap-2 px-4 py-3">
              {step > 1 && !isEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 sm:hidden"
                  onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
                  aria-label="Back"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
              )}
              <div className="bg-blue-50 p-2 rounded-md hidden sm:block">
                <FileText className="w-4 h-4 text-blue-600" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-gray-500">
                  Step {step} of 3 · {STEP_TITLES[step]}
                </div>
                <div className="text-base sm:text-lg font-semibold text-gray-900 truncate">
                  {isEdit ? `Edit Estimate #${estimateId}` : "New Estimate"}
                </div>
              </div>
            </div>
            <div className="h-1 bg-gray-100">
              <div
                className="h-1 bg-blue-600 transition-all"
                style={{ width: `${progressPct}%` }}
                role="progressbar"
                aria-valuenow={progressPct}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
            {isEdit && existingLoading && !hydratedRef.current ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              </div>
            ) : step === 1 ? (
              <EstimateWizardCustomerStep
                value={customerStep}
                onChange={setCustomerStep}
                onContinue={() => setStep(2)}
                onCancel={requestClose}
              />
            ) : step === 2 ? (
              <EstimateWizardLineItemsStep
                customerName={customerStep.customer?.name ?? ""}
                projectName={customerStep.projectName}
                laborRate={laborRate}
                items={items}
                onItemsChange={setItems}
                onBack={() => setStep(1)}
                onContinue={() => setStep(3)}
                onChangeCustomer={() => setStep(1)}
              />
            ) : (
              <EstimateWizardReviewStep
                customer={customerStep.customer}
                projectName={customerStep.projectName}
                projectAddress={customerStep.projectAddress}
                locationNotes={customerStep.locationNotes}
                accessInstructions={customerStep.accessInstructions}
                laborRate={laborRate}
                items={items}
                photos={photos}
                attachments={attachments}
                onPhotosChange={setPhotos}
                onAttachmentsChange={setAttachments}
                onBack={() => setStep(2)}
                onSubmit={handleSubmit}
                submitting={saveMutation.isPending}
                isEdit={isEdit}
              />
            )}
          </div>

          {/* Mobile sticky footer */}
          {stickyMobileFooter}
        </DialogContent>
      </Dialog>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Closing the wizard will discard them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDiscardOpen(false);
                onOpenChange(false);
              }}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
