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
  workLocationLat: number | null;
  workLocationLng: number | null;
  workLocationAddress: string | null;
  controllerLetter: string | null;
  zoneNumber: number | null;
  internalStatus?: string;
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

const DRAFT_STORAGE_VERSION = 1;
const DRAFT_KEY_PREFIX = "irrigopro:estimate-wizard-draft:v1:";

function draftKey(estimateId?: number | null): string {
  return `${DRAFT_KEY_PREFIX}${estimateId ?? "new"}`;
}

interface PersistedDraft {
  version: number;
  savedAt: number;
  step: Step;
  customerStep: CustomerStepValue;
  items: WizardLineItem[];
  laborRate: number;
  photos: UploadedFile[];
  attachments: UploadedFile[];
}

function loadDraft(estimateId?: number | null): PersistedDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(draftKey(estimateId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedDraft;
    if (!parsed || parsed.version !== DRAFT_STORAGE_VERSION) return null;
    // Re-assign rowIds defensively in case of collisions on hydration.
    parsed.items = (parsed.items ?? []).map((it) => ({
      ...it,
      rowId: it.rowId || makeRowId(),
    }));
    return parsed;
  } catch {
    return null;
  }
}

function saveDraft(estimateId: number | null | undefined, draft: Omit<PersistedDraft, "version" | "savedAt">): void {
  if (typeof window === "undefined") return;
  try {
    const payload: PersistedDraft = {
      version: DRAFT_STORAGE_VERSION,
      savedAt: Date.now(),
      ...draft,
    };
    window.localStorage.setItem(draftKey(estimateId), JSON.stringify(payload));
  } catch {
    // Ignore quota / serialization errors — draft autosave is best-effort.
  }
}

function clearDraft(estimateId?: number | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(draftKey(estimateId));
  } catch {
    // ignore
  }
}

interface DraftSnapshot {
  customerId: number | null;
  customerEmail: string;
  customerPhone: string;
  projectName: string;
  projectAddress: string;
  locationNotes: string;
  accessInstructions: string;
  laborRate: number;
  items: Array<Pick<WizardLineItem, "partId" | "partName" | "partPrice" | "quantity" | "laborHours" | "description">>;
  photos: string[];
  attachments: string[];
  workLocation: { lat: number; lng: number; address?: string } | null;
  controllerLetter: string | null;
  zoneNumber: number | null;
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
    customerEmail: cs.customerEmail.trim(),
    customerPhone: cs.customerPhone.trim(),
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
    workLocation: cs.workLocation,
    controllerLetter: cs.controllerLetter,
    zoneNumber: cs.zoneNumber,
  };
}

export function EstimateWizard({ open, onOpenChange, estimateId }: EstimateWizardProps) {
  const isEdit = !!estimateId;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>(isEdit ? 2 : 1);
  const [customerStep, setCustomerStep] = useState<CustomerStepValue>({
    customer: null,
    customerEmail: "",
    customerPhone: "",
    projectName: "",
    projectAddress: "",
    useDifferentAddress: false,
    locationNotes: "",
    accessInstructions: "",
    workLocation: null,
    controllerLetter: null,
    zoneNumber: null,
  });
  const [items, setItems] = useState<WizardLineItem[]>([]);
  const [laborRate, setLaborRate] = useState<number>(45);
  const [photos, setPhotos] = useState<UploadedFile[]>([]);
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<PersistedDraft | null>(null);
  const initialSnapshotRef = useRef<DraftSnapshot | null>(null);
  const hydratedRef = useRef(false);
  const restorePromptedRef = useRef(false);
  const draftReadyRef = useRef(false);

  // Reset state whenever the wizard opens.
  useEffect(() => {
    if (open) {
      setStep(isEdit ? 2 : 1);
      hydratedRef.current = false;
      restorePromptedRef.current = false;
      draftReadyRef.current = false;
      if (!isEdit) {
        const blank: CustomerStepValue = {
          customer: null,
          customerEmail: "",
          customerPhone: "",
          projectName: "",
          projectAddress: "",
          useDifferentAddress: false,
          locationNotes: "",
          accessInstructions: "",
          workLocation: null,
          controllerLetter: null,
          zoneNumber: null,
        };
        setCustomerStep(blank);
        setItems([]);
        setLaborRate(45);
        setPhotos([]);
        setAttachments([]);
        initialSnapshotRef.current = snapshot(blank, [], 45, [], []);
      }
    } else {
      // When the dialog fully closes, also dismiss any open restore prompt
      // so it doesn't reappear stale on next open.
      setRestoreOpen(false);
      setPendingDraft(null);
    }
  }, [open, isEdit]);

  // Load existing estimate in edit mode.
  const { data: existing, isLoading: existingLoading } = useQuery<EstimateWithItems>({
    queryKey: ["/api/estimates", estimateId],
    enabled: isEdit && open,
  });

  // Load the real customer record so the "Use customer address" toggle
  // reverts to the customer's stored address (not a synthesised one).
  const { data: realCustomer } = useQuery<Customer>({
    queryKey: ["/api/customers", existing?.customerId],
    enabled: isEdit && open && !!existing?.customerId,
  });

  useEffect(() => {
    if (!realCustomer) return;
    setCustomerStep((s) => {
      if (!s.customer || s.customer.id !== realCustomer.id) return s;
      if (s.customer === realCustomer) return s;
      return { ...s, customer: realCustomer };
    });
  }, [realCustomer]);

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
    // If the estimate has a recorded projectAddress, default the toggle to
    // "different address" so the field is fully editable on open. The user
    // can flip back to "Use customer address" to lock it to the customer
    // record's address.
    const usingDifferent = !!(existing.projectAddress && existing.projectAddress.trim());
    const lat = existing.workLocationLat != null ? parseFloat(String(existing.workLocationLat)) : NaN;
    const lng = existing.workLocationLng != null ? parseFloat(String(existing.workLocationLng)) : NaN;
    const wl = Number.isFinite(lat) && Number.isFinite(lng)
      ? { lat, lng, address: existing.workLocationAddress ?? undefined }
      : null;
    const cs: CustomerStepValue = {
      customer: cust,
      customerEmail: existing.customerEmail ?? "",
      customerPhone: existing.customerPhone ?? "",
      projectName: existing.projectName ?? "",
      projectAddress: existing.projectAddress ?? "",
      useDifferentAddress: usingDifferent,
      locationNotes: existing.locationNotes ?? "",
      accessInstructions: existing.accessInstructions ?? "",
      workLocation: wl,
      controllerLetter: existing.controllerLetter ?? null,
      zoneNumber: existing.zoneNumber ?? null,
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

  // Offer to restore a saved draft once the wizard is ready (immediately for
  // new estimates; after the existing estimate has hydrated for edits).
  useEffect(() => {
    if (!open) return;
    if (restorePromptedRef.current) return;
    const ready = isEdit ? hydratedRef.current : true;
    if (!ready) return;
    restorePromptedRef.current = true;
    const draft = loadDraft(estimateId ?? null);
    if (!draft) {
      // Nothing to restore — autosave can begin immediately.
      draftReadyRef.current = true;
      return;
    }
    // Only prompt if the draft actually differs from the current baseline.
    const baseline = initialSnapshotRef.current;
    const draftSnap = snapshot(
      draft.customerStep,
      draft.items,
      draft.laborRate,
      draft.photos,
      draft.attachments,
    );
    if (baseline && JSON.stringify(baseline) === JSON.stringify(draftSnap)) {
      clearDraft(estimateId ?? null);
      draftReadyRef.current = true;
      return;
    }
    setPendingDraft(draft);
    setRestoreOpen(true);
  }, [open, isEdit, estimateId, existing]);

  // Debounced autosave of the in-progress wizard state to localStorage.
  useEffect(() => {
    if (!open) return;
    if (!draftReadyRef.current) return;
    if (!isDirty) {
      // No pending changes — make sure no stale draft lingers.
      clearDraft(estimateId ?? null);
      return;
    }
    const handle = window.setTimeout(() => {
      saveDraft(estimateId ?? null, {
        step,
        customerStep,
        items,
        laborRate,
        photos,
        attachments,
      });
    }, 600);
    return () => window.clearTimeout(handle);
  }, [open, isDirty, step, customerStep, items, laborRate, photos, attachments, estimateId]);

  const applyDraft = (draft: PersistedDraft) => {
    setCustomerStep(draft.customerStep);
    setItems(draft.items);
    setLaborRate(draft.laborRate);
    setPhotos(draft.photos);
    setAttachments(draft.attachments);
    setStep(draft.step);
    setRestoreOpen(false);
    setPendingDraft(null);
    draftReadyRef.current = true;
    toast({ title: "Draft restored" });
  };

  const dismissDraft = () => {
    clearDraft(estimateId ?? null);
    setRestoreOpen(false);
    setPendingDraft(null);
    draftReadyRef.current = true;
  };

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
      clearDraft(estimateId ?? null);
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
      customerEmail: customerStep.customerEmail.trim(),
      customerPhone: customerStep.customerPhone.trim(),
      projectName: customerStep.projectName.trim(),
      projectAddress: customerStep.projectAddress.trim() || "",
      locationNotes: customerStep.locationNotes.trim() || "",
      accessInstructions: customerStep.accessInstructions.trim() || "",
      status: existing?.status ?? "pending",
      // Round-trip the manager-internal review status when editing so an
      // already-approved estimate doesn't silently bounce back to
      // "pending_approval". New estimates omit this field and the server
      // defaults to "pending_approval".
      ...(isEdit && existing?.internalStatus
        ? { internalStatus: existing.internalStatus }
        : {}),
      partsSubtotal: totals.partsSubtotal.toFixed(2),
      laborSubtotal: totals.laborSubtotal.toFixed(2),
      totalAmount: totals.totalAmount.toFixed(2),
      laborRate: laborRate.toFixed(2),
      photos: photos.map((p) => p.url),
      attachments: attachments.map((a) => a.url),
      workLocationLat: customerStep.workLocation?.lat ?? null,
      workLocationLng: customerStep.workLocation?.lng ?? null,
      workLocationAddress: customerStep.workLocation?.address ?? null,
      controllerLetter: customerStep.controllerLetter,
      zoneNumber: customerStep.zoneNumber,
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
      // Never let Enter inside a text/number/select input or textarea
      // advance the wizard — it's a foot-gun for users typing in fields.
      // Buttons/links handle their own Enter activation.
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (target?.isContentEditable) return;
      if (tag === "BUTTON" || tag === "A") return;
      if (step === 3 && !saveMutation.isPending) {
        e.preventDefault();
        handleSubmit();
      }
    }
  };

  const progressPct = Math.round((step / 3) * 100);

  const stickyMobileFooter = (
    <div className="sm:hidden sticky bottom-0 -mx-4 px-4 py-2 bg-white border-t z-10 flex flex-col gap-1.5">
      {step === 2 && items.length === 0 && (
        <p
          className="text-xs text-gray-500 text-center"
          data-testid="wizard-continue-2-helper-mobile"
        >
          Add at least one part to continue.
        </p>
      )}
      <div className="flex items-center gap-2">
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
          >
            Continue
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
                <div className="text-base sm:text-lg font-semibold text-gray-900 truncate flex items-center gap-2">
                  {isEdit ? `Edit Estimate #${estimateId}` : "New Estimate"}
                  {isEdit && existingLoading && !hydratedRef.current && (
                    <span className="inline-flex items-center gap-1 text-xs font-normal text-gray-500">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Loading estimate…
                    </span>
                  )}
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
                customerEmail={customerStep.customerEmail}
                customerPhone={customerStep.customerPhone}
                projectName={customerStep.projectName}
                projectAddress={customerStep.projectAddress}
                workLocation={customerStep.workLocation}
                controllerLetter={customerStep.controllerLetter}
                zoneNumber={customerStep.zoneNumber}
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
            <AlertDialogTitle>
              {isEdit ? "Discard your edits?" : "Discard this estimate?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isEdit
                ? "You have unsaved changes to this estimate. Closing now will discard them and keep the saved version."
                : "You have unsaved work on this new estimate. Closing now will discard it and nothing will be saved."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{isEdit ? "Keep editing" : "Keep working"}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                clearDraft(estimateId ?? null);
                setDiscardOpen(false);
                onOpenChange(false);
              }}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isEdit ? "Discard edits" : "Discard estimate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={restoreOpen}
        onOpenChange={(o) => {
          // Treat outside dismiss as "start fresh" so we don't reprompt.
          if (!o) dismissDraft();
        }}
      >
        <AlertDialogContent data-testid="estimate-wizard-restore-draft">
          <AlertDialogHeader>
            <AlertDialogTitle>Restore your unsaved draft?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDraft
                ? `We saved your in-progress ${isEdit ? "edits" : "estimate"} from ${new Date(
                    pendingDraft.savedAt,
                  ).toLocaleString()}. Restore where you left off, or start fresh.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={dismissDraft}>Start fresh</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDraft) applyDraft(pendingDraft);
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Restore draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
