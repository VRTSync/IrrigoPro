// Mobile billing-sheet edit + submit screen (Task #492 / M7).
//
// Two modes, driven by `?billingSheetId=`:
//   - Create (no id): full form — total hours, work description, parts
//     list, photo strip. "Submit for review" POSTs the sheet via
//     `/api/billing-sheets`. The server marks a field_tech-created sheet
//     as `submitted` and computes labor/parts subtotals from the
//     customer's authoritative labor rate + catalog pricing, so we send
//     `laborMode: 'flat'` and the raw fields only.
//   - Edit (id set): the form is prepopulated from the existing sheet.
//     If the sheet status is editable for the current user (server-side
//     gating: `draft` for field_tech, anything not billed/approved for
//     managers) we show the same editable form plus a "Save changes"
//     button that PATCHes the full body and a "Submit for review" button
//     that PATCHes status. If the server rejects (403/409 from the
//     allow-list / billing locks) the inline error banner surfaces it
//     and the form falls back to a read-only summary + photo strip
//     where techs can still add or remove photos via the photos-only
//     PATCH allow-list.
//
// On the first save, expo-location captures the device location into
// work_location_lat/lng so the office can verify the work site. The
// permission prompt is gated behind the explicit save action; if the
// user declines we silently skip location and still create the sheet.

import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LoadingScreen } from "@/components/Loading";
import { useColors } from "@/hooks/useColors";
import { API_BASE_URL, ApiError, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import {
  BillingSheetConflictError,
  billingSheetDetailQueryKey,
  billingSheetMutate,
  billingSheetMutationKey,
  fieldTechPartsQueryKey,
} from "@/lib/billing-sheet";
import { drainQueue } from "@/lib/sync/engine";
import { enqueue, removeEntry } from "@/lib/sync/queue";
import {
  useScopeConflictTick,
  useSyncStatus,
} from "@/lib/sync/use-sync-status";
import {
  captureBillingSheetPhoto,
  deleteLocalPhoto,
  ensureCameraPermission,
  ensureMediaLibraryPermission,
  pickBillingSheetPhotoFromLibrary,
} from "@/lib/photo-upload";
import { friendlyErrorMessage, showToast } from "@/lib/toast";
import { workOrderBillingSheetQueryKey } from "../[id]";

// ── Types ──────────────────────────────────────────────────────────

type WorkOrder = {
  id: number;
  workOrderNumber: string;
  customerId: number | null;
  customerName: string;
  customerEmail?: string | null;
  projectAddress: string | null;
  branchName: string | null;
  status: string;
  workLocationLat: string | null;
  workLocationLng: string | null;
  workLocationAddress: string | null;
};

type Customer = {
  id: number;
  name: string;
  email: string | null;
  branches?: string[] | null;
};

type FieldTechPart = {
  id: number;
  name: string;
  description: string | null;
  sku: string | null;
  category: string | null;
};

type BillingSheetItem = {
  id?: number;
  partId: number | null;
  partName: string;
  quantity: string;
  unitPrice?: string;
  totalPrice?: string;
  laborHours?: string;
};

type BillingSheet = {
  id: number;
  billingNumber: string;
  status: string;
  customerId: number | null;
  customerName: string;
  propertyAddress: string;
  workDate: string | null;
  technicianName: string;
  workDescription: string;
  totalHours: string;
  workLocationLat: string | null;
  workLocationLng: string | null;
  photos: string[] | null;
  branchName: string | null;
  items?: BillingSheetItem[];
};

type DraftItem = {
  rowId: string;
  itemId?: number;
  partId: number | null;
  partName: string;
  quantity: string;
};

type PendingPhoto = {
  clientId: string;
  localUri: string;
  takenAt: string;
  /**
   * `queued`  — sitting in the durable offline queue, waiting on the
   *             engine (offline, or in create mode waiting on the
   *             create POST to drain).
   * `error`   — the engine hit a non-retryable failure for this entry.
   */
  status: "queued" | "error";
  error?: string;
};

type FieldErrors = {
  totalHours?: string;
  workDescription?: string;
  items?: string;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  pending_manager_review: "Awaiting review",
  approved_passed_to_billing: "Approved",
  billed: "Billed",
  completed: "Completed",
};

// Roles allowed to fully edit a sheet field-by-field server-side. Used
// only to decide whether the form mode is offered for an existing sheet
// — the server still enforces the actual access check.
const FULL_EDIT_ROLES = new Set([
  "company_admin",
  "super_admin",
  "billing_manager",
  "irrigation_manager",
]);

function nextRowId(): string {
  return `r-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(
    36,
  )}`;
}

function photoUriFor(canonicalKey: string): string {
  if (canonicalKey.startsWith("http")) return canonicalKey;
  // Server canonical keys are e.g. "photos/<uuid>"; the existing public
  // route serves them at /api/photos/:key.
  const path = `/api/${canonicalKey.replace(/^\/+/, "")}`;
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

function parseHours(raw: string): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : NaN;
}

// ── Screen ─────────────────────────────────────────────────────────

export default function BillingSheetScreen() {
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const params = useLocalSearchParams<{
    id: string;
    billingSheetId?: string;
  }>();

  const workOrderId = useMemo(() => {
    const n = Number(params.id);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [params.id]);

  const billingSheetId = useMemo(() => {
    if (!params.billingSheetId) return null;
    const n = Number(params.billingSheetId);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [params.billingSheetId]);

  const isEdit = billingSheetId != null;
  const mutationScope: number | string = billingSheetId ?? `wo-${workOrderId ?? "x"}`;

  // ── Queries ──
  const woQuery = useQuery({
    queryKey: workOrderId != null ? ["work-order", workOrderId] : ["wo", "missing"],
    enabled: workOrderId != null,
    queryFn: () => apiRequest<WorkOrder>(`/api/work-orders/${workOrderId}`),
  });
  const wo = woQuery.data;

  const customerQuery = useQuery({
    queryKey: wo?.customerId != null ? ["customer", wo.customerId] : ["customer", "missing"],
    enabled: wo?.customerId != null,
    queryFn: () => apiRequest<Customer>(`/api/customers/${wo!.customerId}`),
  });

  const partsQuery = useQuery({
    queryKey: fieldTechPartsQueryKey,
    queryFn: () => apiRequest<FieldTechPart[]>("/api/parts/field-tech"),
    staleTime: 5 * 60_000,
  });

  const sheetQuery = useQuery({
    queryKey: billingSheetId != null
      ? billingSheetDetailQueryKey(billingSheetId)
      : ["billing-sheet", "new"],
    enabled: billingSheetId != null,
    queryFn: () => apiRequest<BillingSheet>(`/api/billing-sheets/${billingSheetId}`),
  });
  const sheet = sheetQuery.data;

  // ── Form state ──
  const [totalHours, setTotalHours] = useState("");
  const [workDescription, setWorkDescription] = useState("");
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [partPickerOpen, setPartPickerOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [hydrated, setHydrated] = useState(false);

  // Editability for an existing sheet:
  //  - field_tech: only `draft` sheets can be edited field-by-field
  //    (server gates everything else to photos-only / submit-only).
  //    Field_tech-created sheets jump straight to 'submitted', so this
  //    window only opens if a manager moved the sheet back to draft.
  //  - manager-class roles: anything not yet approved/billed.
  // The server is the source of truth; this just decides the UX.
  const sheetStatus = sheet?.status;
  const userRole = user?.role ?? "field_tech";
  const isFinalized =
    sheetStatus === "approved_passed_to_billing" || sheetStatus === "billed";
  const editableForUser = isEdit
    ? !isFinalized &&
      sheetStatus != null &&
      (FULL_EDIT_ROLES.has(userRole) || sheetStatus === "draft")
    : true;

  // Hydrate the form from the loaded sheet exactly once so user edits
  // aren't clobbered by background refetches.
  useEffect(() => {
    if (!isEdit || !sheet || hydrated) return;
    setTotalHours(String(sheet.totalHours ?? ""));
    setWorkDescription(sheet.workDescription ?? "");
    setDraftItems(
      (sheet.items ?? []).map((it) => ({
        rowId: nextRowId(),
        itemId: it.id,
        partId: it.partId,
        partName: it.partName,
        quantity: String(it.quantity ?? "1"),
      })),
    );
    setHydrated(true);
  }, [isEdit, sheet, hydrated]);

  // ── Photos (shared between create + edit) ──
  // Every captured photo is enqueued as a durable `billing-sheet-photo`
  // entry (Task #493 / M8). The engine handles sign → PUT → PATCH for
  // edit-mode sheets; for create-mode it defers until the create POST
  // drains, then resolves the new sheet id via
  // `GET /api/work-orders/:id/billing-sheet` and PATCHes the photo in.
  // Component state holds only thumbnails — the queue is the source of
  // truth and we rebuild rows from queue entries on mount, so photos
  // captured offline survive an app kill/relaunch.
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const existingPhotos = isEdit ? sheet?.photos ?? [] : [];

  const photoScopeKey = useMemo(() => {
    if (billingSheetId != null) return `bs:${billingSheetId}`;
    if (workOrderId != null) return `bs-wo-${workOrderId}`;
    return null;
  }, [billingSheetId, workOrderId]);

  // Subscribe to the offline queue:
  //  (a) Re-seed thumbnails for photos captured in a prior session.
  //  (b) Drop rows when the engine drains them (the engine deletes the
  //      local file on success).
  //  (c) Mirror engine `failed` status into the local row's `error`
  //      state so the retry/cancel UI works for relaunched rows.
  const { entries: queueEntries } = useSyncStatus();
  useEffect(() => {
    if (photoScopeKey == null) return;
    setPendingPhotos((prev) => {
      const matches = queueEntries.filter((e) => {
        if (e.kind !== "billing-sheet-photo") return false;
        const bp = e.billingPhoto;
        if (!bp) return false;
        if (billingSheetId != null && bp.billingSheetId === billingSheetId) {
          return true;
        }
        if (
          billingSheetId == null &&
          workOrderId != null &&
          bp.workOrderId === workOrderId
        ) {
          return true;
        }
        return false;
      });
      const seen = new Set(prev.map((p) => p.clientId));
      const additions: PendingPhoto[] = [];
      for (const e of matches) {
        const bp = e.billingPhoto;
        if (!bp) continue;
        if (seen.has(e.id)) continue;
        additions.push({
          clientId: e.id,
          localUri: bp.localUri,
          takenAt: bp.takenAt,
          status: e.status === "failed" ? "error" : "queued",
          error: e.status === "failed" ? e.lastError ?? undefined : undefined,
        });
      }
      const survivors = prev.flatMap<PendingPhoto>((p) => {
        const match = matches.find((e) => e.id === p.clientId);
        if (!match) return [];
        const desiredStatus: PendingPhoto["status"] =
          match.status === "failed" ? "error" : "queued";
        if (
          desiredStatus === p.status &&
          (match.lastError ?? undefined) === p.error
        ) {
          return [p];
        }
        return [
          {
            ...p,
            status: desiredStatus,
            error:
              desiredStatus === "error"
                ? match.lastError ?? undefined
                : undefined,
          },
        ];
      });
      if (additions.length === 0 && survivors.length === prev.length) {
        // Quick equality check — same length and we already mapped
        // statuses above; only return a new array if anything changed.
        const sameStatuses = survivors.every(
          (s, i) =>
            s.status === prev[i].status &&
            s.error === prev[i].error &&
            s.clientId === prev[i].clientId,
        );
        if (sameStatuses) return prev;
      }
      return [...survivors, ...additions];
    });
  }, [queueEntries, photoScopeKey, billingSheetId, workOrderId]);

  const enqueueCapturedBillingPhoto = useCallback(
    async (
      captured: NonNullable<
        Awaited<ReturnType<typeof captureBillingSheetPhoto>>
      >,
    ) => {
      await enqueue({
        id: captured.clientId,
        kind: "billing-sheet-photo",
        scopeKey: photoScopeKey ?? `bs-wo-${workOrderId!}`,
        path: "/api/billing-sheets/__photo__",
        method: "PATCH",
        body: null,
        photo: null,
        billingPhoto: {
          localUri: captured.localUri,
          takenAt: captured.takenAt,
          billingSheetId: billingSheetId,
          workOrderId: workOrderId!,
        },
        label: isEdit ? "Add billing photo" : "Add billing photo (pending sheet)",
      });
      setPendingPhotos((prev) => {
        if (prev.some((p) => p.clientId === captured.clientId)) return prev;
        return [
          ...prev,
          {
            clientId: captured.clientId,
            localUri: captured.localUri,
            takenAt: captured.takenAt,
            status: "queued" as const,
          },
        ];
      });
      Haptics.selectionAsync().catch(() => undefined);
      drainQueue().catch(() => undefined);
    },
    [workOrderId, billingSheetId, isEdit, photoScopeKey],
  );

  const onAddPhoto = useCallback(() => {
    setPhotoError(null);
    if (workOrderId == null) {
      setPhotoError("Work order is missing — cannot add photos.");
      return;
    }

    const captureFromCamera = async () => {
      const perm = await ensureCameraPermission();
      if (perm !== "granted") {
        Alert.alert(
          "Camera Access Required",
          perm === "blocked"
            ? "Camera access is blocked. Enable it in Settings to add photos."
            : "Camera permission is required to add photos.",
          perm === "blocked"
            ? [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Open Settings",
                  onPress: () => Linking.openSettings(),
                },
              ]
            : [{ text: "OK" }],
        );
        return;
      }
      let captured: Awaited<ReturnType<typeof captureBillingSheetPhoto>> = null;
      try {
        captured = await captureBillingSheetPhoto({
          scopeKey: String(mutationScope),
        });
      } catch (err) {
        setPhotoError(friendlyErrorMessage(err, "Couldn't open the camera"));
        return;
      }
      if (!captured) return;
      await enqueueCapturedBillingPhoto(captured);
    };

    const pickFromLibrary = async () => {
      const perm = await ensureMediaLibraryPermission();
      if (perm !== "granted") {
        Alert.alert(
          "Library Access Required",
          perm === "blocked"
            ? "Photo library access is blocked. Enable it in Settings."
            : "Photo library permission is required to pick photos.",
          perm === "blocked"
            ? [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Open Settings",
                  onPress: () => Linking.openSettings(),
                },
              ]
            : [{ text: "OK" }],
        );
        return;
      }
      let capturedPhotos: Awaited<
        ReturnType<typeof pickBillingSheetPhotoFromLibrary>
      > = [];
      try {
        capturedPhotos = await pickBillingSheetPhotoFromLibrary({
          scopeKey: String(mutationScope),
        });
      } catch (err) {
        setPhotoError(
          friendlyErrorMessage(err, "Couldn't open the photo library"),
        );
        return;
      }
      if (capturedPhotos.length === 0) return;
      for (const captured of capturedPhotos) {
        await enqueueCapturedBillingPhoto(captured);
      }
    };

    Alert.alert("Add Photo", undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Take Photo", onPress: captureFromCamera },
      {
        text: "Choose from Library (tap to select multiple)",
        onPress: pickFromLibrary,
      },
    ]);
  }, [
    workOrderId,
    mutationScope,
    enqueueCapturedBillingPhoto,
  ]);

  const onRetryPendingPhoto = useCallback((_clientId: string) => {
    // Engine is the source of truth for retries; just kick a drain.
    drainQueue().catch(() => undefined);
  }, []);

  const onCancelPendingPhoto = useCallback(async (pending: PendingPhoto) => {
    deleteLocalPhoto(pending.localUri);
    await removeEntry(pending.clientId);
    setPendingPhotos((prev) =>
      prev.filter((p) => p.clientId !== pending.clientId),
    );
  }, []);

  // ── Remove server photo (edit mode only) ──
  const removePhotoMutation = useMutation({
    mutationKey: billingSheetMutationKey(mutationScope, "photo-delete"),
    mutationFn: async (url: string) => {
      if (billingSheetId == null) throw new Error("Missing billing sheet id");
      const nextPhotos = (sheet?.photos ?? []).filter((p) => p !== url);
      return billingSheetMutate<BillingSheet, { photos: string[] }>({
        path: `/api/billing-sheets/${billingSheetId}`,
        method: "PATCH",
        body: { photos: nextPhotos },
        withClientId: false,
        billingSheetId,
        label: "Remove photo",
      });
    },
    onSuccess: () => {
      if (billingSheetId != null) {
        queryClient.invalidateQueries({
          queryKey: billingSheetDetailQueryKey(billingSheetId),
        });
      }
      Haptics.selectionAsync().catch(() => undefined);
    },
    onError: (err) => {
      setPhotoError(friendlyErrorMessage(err, "Couldn't remove photo"));
    },
  });

  const onRemoveServerPhoto = useCallback(
    (url: string) => {
      Alert.alert("Remove photo?", "Remove this photo from the billing sheet?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => removePhotoMutation.mutate(url),
        },
      ]);
    },
    [removePhotoMutation],
  );

  // ── Items ──
  const onAddItem = useCallback((part: FieldTechPart) => {
    setDraftItems((prev) => [
      ...prev,
      {
        rowId: nextRowId(),
        partId: part.id,
        partName: part.name,
        quantity: "1",
      },
    ]);
    setPartPickerOpen(false);
    setErrors((e) => ({ ...e, items: undefined }));
  }, []);

  const onChangeItemQty = useCallback((rowId: string, qty: string) => {
    const cleaned = qty.replace(/[^0-9.]/g, "");
    setDraftItems((prev) =>
      prev.map((it) => (it.rowId === rowId ? { ...it, quantity: cleaned } : it)),
    );
  }, []);

  const onRemoveItem = useCallback((rowId: string) => {
    setDraftItems((prev) => prev.filter((it) => it.rowId !== rowId));
  }, []);

  // ── Validation ──
  const validate = useCallback((): FieldErrors => {
    const next: FieldErrors = {};
    const hours = parseHours(totalHours);
    if (!totalHours.trim()) {
      next.totalHours = "Required";
    } else if (!Number.isFinite(hours)) {
      next.totalHours = "Enter a valid number";
    } else if (hours <= 0) {
      next.totalHours = "Hours must be greater than 0";
    } else if (hours > 24) {
      next.totalHours = "Hours can't exceed 24";
    }
    if (!workDescription.trim()) {
      next.workDescription = "Required";
    } else if (workDescription.trim().length < 5) {
      next.workDescription = "Add a little more detail (min 5 characters)";
    }
    for (const it of draftItems) {
      const qty = parseFloat(it.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        next.items = `"${it.partName}" needs a positive quantity`;
        break;
      }
    }
    return next;
  }, [totalHours, workDescription, draftItems]);

  const buildBody = useCallback((): Record<string, unknown> | null => {
    if (!wo || wo.customerId == null) return null;
    const customerEmail =
      customerQuery.data?.email ?? wo.customerEmail ?? "";
    const technicianName =
      [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
      user?.username ||
      "Technician";
    const items = draftItems
      .filter((it) => it.partName.trim() !== "")
      .map((it) => ({
        partId: it.partId,
        partName: it.partName,
        quantity: String(parseFloat(it.quantity || "0") || 0),
        // Server overrides unitPrice from the catalog for catalog parts;
        // we still send a placeholder so the row passes server-side
        // shape checks before pricing resolution.
        unitPrice: "0",
        laborHours: "0",
      }));
    return {
      workOrderId: wo.id,
      customerId: wo.customerId,
      customerName: wo.customerName,
      customerEmail,
      propertyAddress:
        wo.workLocationAddress || wo.projectAddress || wo.customerName,
      branchName: wo.branchName ?? null,
      workDate: new Date().toISOString(),
      technicianName,
      technicianId: user?.id ?? null,
      workDescription: workDescription.trim(),
      totalHours: String(parseFloat(totalHours || "0") || 0),
      laborMode: "flat",
      items,
    };
  }, [wo, customerQuery.data?.email, user, draftItems, workDescription, totalHours]);

  // ── Mutations: create, update, submit ──

  const captureLocationOnce = useCallback(async (): Promise<{
    lat: number;
    lng: number;
  } | null> => {
    try {
      const current = await Location.getForegroundPermissionsAsync();
      let granted = current.granted;
      if (!granted && current.canAskAgain) {
        const next = await Location.requestForegroundPermissionsAsync();
        granted = next.granted;
      }
      if (!granted) return null;
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch {
      return null;
    }
  }, []);

  // Surface 409s discovered by background queue drains in the same
  // submitError banner as inline-mutation conflicts.
  const conflictScope =
    billingSheetId != null
      ? `bs:${billingSheetId}`
      : workOrderId != null
        ? `bs-wo-${workOrderId}`
        : null;
  const conflictTick = useScopeConflictTick(conflictScope);
  useEffect(() => {
    if (conflictTick > 0) {
      setSubmitError(
        "This billing sheet was edited in the office. Refresh to see the latest.",
      );
    }
  }, [conflictTick]);

  const handleMutationError = useCallback((err: unknown) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
      () => undefined,
    );
    if (err instanceof BillingSheetConflictError) {
      setSubmitError(
        "This billing sheet was edited in the office. Refresh to see the latest.",
      );
      return;
    }
    setSubmitError(friendlyErrorMessage(err, "Couldn't save billing sheet"));
  }, []);

  const createMutation = useMutation({
    mutationKey: billingSheetMutationKey(mutationScope, "create"),
    mutationFn: async (location: { lat: number; lng: number } | null) => {
      const body = buildBody();
      if (!body) throw new Error("Work order is missing a customer — cannot submit.");
      return billingSheetMutate<BillingSheet, Record<string, unknown>>({
        path: "/api/billing-sheets",
        method: "POST",
        withClientId: true,
        scopeFallback: workOrderId != null ? `wo-${workOrderId}` : undefined,
        label: "Submit billing sheet",
        body: {
          ...body,
          // Photos are handled by the durable offline queue (M8): each
          // captured photo is enqueued as a `billing-sheet-photo` row
          // that the engine PATCHes onto the sheet after this create
          // POST drains. We intentionally send an empty `photos` array
          // here so create-with-photos works end-to-end offline.
          photos: [],
          workLocationLat: location ? location.lat : null,
          workLocationLng: location ? location.lng : null,
        },
      });
    },
    onSuccess: (created) => {
      setSubmitError(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      );
      showToast(`Billing sheet ${created.billingNumber} submitted`);
      if (workOrderId != null) {
        queryClient.invalidateQueries({
          queryKey: workOrderBillingSheetQueryKey(workOrderId),
        });
      }
      router.back();
    },
    onError: handleMutationError,
  });

  const updateMutation = useMutation({
    mutationKey: billingSheetMutationKey(mutationScope, "update"),
    mutationFn: async (location: { lat: number; lng: number } | null) => {
      if (billingSheetId == null) throw new Error("Missing billing sheet id");
      const body = buildBody();
      if (!body) throw new Error("Work order is missing a customer — cannot save.");
      const patch: Record<string, unknown> = { ...body };
      if (location) {
        patch.workLocationLat = location.lat;
        patch.workLocationLng = location.lng;
      }
      return billingSheetMutate<BillingSheet, Record<string, unknown>>({
        path: `/api/billing-sheets/${billingSheetId}`,
        method: "PATCH",
        withClientId: false,
        billingSheetId,
        label: "Save billing sheet",
        body: patch,
      });
    },
    onSuccess: () => {
      setSubmitError(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      );
      showToast("Saved");
      if (billingSheetId != null) {
        queryClient.invalidateQueries({
          queryKey: billingSheetDetailQueryKey(billingSheetId),
        });
      }
      if (workOrderId != null) {
        queryClient.invalidateQueries({
          queryKey: workOrderBillingSheetQueryKey(workOrderId),
        });
      }
    },
    onError: handleMutationError,
  });

  const submitExistingMutation = useMutation({
    mutationKey: billingSheetMutationKey(mutationScope, "submit"),
    mutationFn: async () => {
      if (billingSheetId == null) throw new Error("Missing billing sheet id");
      // Server allow-list for field_tech accepts a single-key
      // {status:'submitted'} PATCH.
      return billingSheetMutate<BillingSheet, { status: "submitted" }>({
        path: `/api/billing-sheets/${billingSheetId}`,
        method: "PATCH",
        withClientId: false,
        billingSheetId,
        label: "Submit billing sheet",
        body: { status: "submitted" },
      });
    },
    onMutate: async () => {
      // Best-effort: if the draft was created without lat/lng (e.g. a
      // manager spawned it from the office), backfill before flipping
      // to 'submitted'. Only attempted for manager-class roles whose
      // PATCH can carry non-status keys; field_tech submits remain
      // single-key as the server allow-list requires.
      if (
        sheet &&
        (sheet.workLocationLat == null || sheet.workLocationLng == null) &&
        FULL_EDIT_ROLES.has(userRole) &&
        billingSheetId != null
      ) {
        const loc = await captureLocationOnce();
        if (loc) {
          try {
            await billingSheetMutate<BillingSheet, Record<string, unknown>>({
              path: `/api/billing-sheets/${billingSheetId}`,
              method: "PATCH",
              withClientId: false,
              billingSheetId,
              label: "Backfill work location",
              body: { workLocationLat: loc.lat, workLocationLng: loc.lng },
            });
          } catch {
            /* best-effort; submit still proceeds */
          }
        }
      }
    },
    onSuccess: (updated) => {
      setSubmitError(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      );
      showToast(`Billing sheet ${updated.billingNumber} submitted`);
      if (billingSheetId != null) {
        queryClient.invalidateQueries({
          queryKey: billingSheetDetailQueryKey(billingSheetId),
        });
      }
      if (workOrderId != null) {
        queryClient.invalidateQueries({
          queryKey: workOrderBillingSheetQueryKey(workOrderId),
        });
      }
      router.back();
    },
    onError: handleMutationError,
  });

  // Photo uploads happen off-screen in the sync engine now (M8), so
  // the submit buttons no longer need to wait on them. Queued photos
  // safely PATCH onto the sheet after the create POST drains.
  const inFlightUpload = false;
  const anyMutationPending =
    createMutation.isPending ||
    updateMutation.isPending ||
    submitExistingMutation.isPending;

  // Form action handlers — gated behind validation + native confirm.

  const onCreatePressed = useCallback(() => {
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0 || !wo || inFlightUpload || anyMutationPending) {
      return;
    }
    Alert.alert(
      "Submit billing sheet?",
      "This sends the billing sheet to your manager for review. You won't be able to edit it after submitting.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Submit",
          style: "destructive",
          onPress: async () => {
            const location = await captureLocationOnce();
            createMutation.mutate(location);
          },
        },
      ],
    );
  }, [validate, wo, inFlightUpload, anyMutationPending, captureLocationOnce, createMutation]);

  const onSavePressed = useCallback(() => {
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0 || inFlightUpload || anyMutationPending) {
      return;
    }
    const needsLocation =
      sheet?.workLocationLat == null || sheet?.workLocationLng == null;
    void (async () => {
      const location = needsLocation ? await captureLocationOnce() : null;
      updateMutation.mutate(location);
    })();
  }, [validate, inFlightUpload, anyMutationPending, sheet?.workLocationLat, sheet?.workLocationLng, captureLocationOnce, updateMutation]);

  const onSubmitExistingPressed = useCallback(() => {
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0 || inFlightUpload || anyMutationPending) {
      return;
    }
    Alert.alert(
      "Submit billing sheet?",
      "This sends the billing sheet to your manager for review.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Submit",
          style: "destructive",
          onPress: () => submitExistingMutation.mutate(),
        },
      ],
    );
  }, [validate, inFlightUpload, anyMutationPending, submitExistingMutation]);

  // ── Render ──

  const headerTitle = isEdit
    ? sheet
      ? `BS #${sheet.billingNumber}`
      : "Billing sheet"
    : "New billing sheet";

  const loading =
    woQuery.isLoading ||
    (wo?.customerId != null && customerQuery.isLoading) ||
    (isEdit && sheetQuery.isLoading);

  const showForm = !isEdit || editableForUser;

  return (
    <>
      <Stack.Screen
        options={{
          title: headerTitle,
          headerStyle: { backgroundColor: colors.background },
          headerTitleStyle: { color: colors.foreground },
          headerTintColor: colors.primary,
        }}
      />
      <SafeAreaView
        style={[styles.safe, { backgroundColor: colors.background }]}
        edges={["left", "right", "bottom"]}
      >
        {workOrderId == null ? (
          <View style={styles.center}>
            <Text style={[styles.errorTitle, { color: colors.foreground }]}>
              Invalid work order
            </Text>
          </View>
        ) : loading ? (
          <LoadingScreen />
        ) : woQuery.isError || !wo ? (
          <View style={styles.center}>
            <Feather name="alert-circle" size={32} color={colors.destructive} />
            <Text style={[styles.errorTitle, { color: colors.foreground }]}>
              Couldn't load work order
            </Text>
            <Text style={[styles.errorBody, { color: colors.mutedForeground }]}>
              {friendlyErrorMessage(woQuery.error)}
            </Text>
          </View>
        ) : (
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <ScrollView
              contentContainerStyle={styles.scroll}
              keyboardShouldPersistTaps="handled"
            >
              <HeaderCard wo={wo} sheet={sheet ?? null} colors={colors} />

              {showForm ? (
                <EditableForm
                  totalHours={totalHours}
                  setTotalHours={(v) => {
                    setTotalHours(v);
                    if (errors.totalHours)
                      setErrors((e) => ({ ...e, totalHours: undefined }));
                  }}
                  workDescription={workDescription}
                  setWorkDescription={(v) => {
                    setWorkDescription(v);
                    if (errors.workDescription)
                      setErrors((e) => ({ ...e, workDescription: undefined }));
                  }}
                  items={draftItems}
                  onChangeItemQty={(rowId, qty) => {
                    onChangeItemQty(rowId, qty);
                    if (errors.items)
                      setErrors((e) => ({ ...e, items: undefined }));
                  }}
                  onRemoveItem={onRemoveItem}
                  onOpenPicker={() => setPartPickerOpen(true)}
                  errors={errors}
                  colors={colors}
                />
              ) : sheet ? (
                <ReadOnlySummary sheet={sheet} colors={colors} />
              ) : null}

              <PhotoStripSection
                colors={colors}
                isEdit={isEdit}
                existingPhotos={existingPhotos}
                pendingPhotos={pendingPhotos}
                onAddPhoto={onAddPhoto}
                onRetry={onRetryPendingPhoto}
                onCancelPending={onCancelPendingPhoto}
                onRemoveServer={onRemoveServerPhoto}
                photoError={photoError}
                onDismissError={() => setPhotoError(null)}
                isRemoving={removePhotoMutation.isPending}
              />

              <View style={[styles.section, { marginTop: 4 }]}>
                {submitError ? (
                  <View
                    style={[
                      styles.errorBanner,
                      {
                        backgroundColor: "#fee2e2",
                        borderColor: colors.destructive,
                        borderRadius: colors.radius - 4,
                      },
                    ]}
                  >
                    <Feather
                      name="alert-circle"
                      size={16}
                      color={colors.destructive}
                    />
                    <Text
                      style={[
                        styles.errorBannerText,
                        { color: colors.destructive },
                      ]}
                    >
                      {submitError}
                    </Text>
                  </View>
                ) : null}

                {!isEdit ? (
                  <ActionButton
                    label="Submit for review"
                    icon="check-circle"
                    onPress={onCreatePressed}
                    busy={createMutation.isPending}
                    disabled={inFlightUpload || anyMutationPending}
                    colors={colors}
                    variant="primary"
                  />
                ) : showForm ? (
                  <View style={{ gap: 8 }}>
                    <ActionButton
                      label="Save changes"
                      icon="save"
                      onPress={onSavePressed}
                      busy={updateMutation.isPending}
                      disabled={inFlightUpload || anyMutationPending}
                      colors={colors}
                      variant="secondary"
                    />
                    {sheetStatus === "draft" ? (
                      <ActionButton
                        label="Submit for review"
                        icon="check-circle"
                        onPress={onSubmitExistingPressed}
                        busy={submitExistingMutation.isPending}
                        disabled={inFlightUpload || anyMutationPending}
                        colors={colors}
                        variant="primary"
                      />
                    ) : null}
                  </View>
                ) : null}

                {inFlightUpload ? (
                  <Text
                    style={[styles.submitHint, { color: colors.mutedForeground }]}
                  >
                    Waiting for photos to upload…
                  </Text>
                ) : !showForm && isEdit && isFinalized ? (
                  <Text
                    style={[styles.submitHint, { color: colors.mutedForeground }]}
                  >
                    This billing sheet is locked. Photos can still be added or
                    removed; other edits go through the office.
                  </Text>
                ) : null}
              </View>

              <View style={{ height: 32 }} />
            </ScrollView>
          </KeyboardAvoidingView>
        )}

        {partPickerOpen ? (
          <PartPickerModal
            colors={colors}
            parts={partsQuery.data ?? []}
            isLoading={partsQuery.isLoading}
            onPick={onAddItem}
            onClose={() => setPartPickerOpen(false)}
          />
        ) : null}
      </SafeAreaView>
    </>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────

function ActionButton({
  label,
  icon,
  onPress,
  busy,
  disabled,
  colors,
  variant,
}: {
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  onPress: () => void;
  busy: boolean;
  disabled: boolean;
  colors: ReturnType<typeof useColors>;
  variant: "primary" | "secondary";
}) {
  const bg = variant === "primary" ? colors.primary : colors.secondary;
  const fg =
    variant === "primary" ? colors.primaryForeground : colors.secondaryForeground;
  const isDisabled = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy }}
      style={({ pressed }) => [
        styles.submitButton,
        {
          backgroundColor: bg,
          borderRadius: colors.radius,
          opacity: isDisabled ? 0.6 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          <Feather name={icon} size={18} color={fg} />
          <Text style={[styles.submitText, { color: fg }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

function HeaderCard({
  wo,
  sheet,
  colors,
}: {
  wo: WorkOrder;
  sheet: BillingSheet | null;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View
      style={[
        styles.headerCard,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
        },
      ]}
    >
      <View style={styles.headerTopRow}>
        <Text
          style={[styles.headerNumber, { color: colors.mutedForeground }]}
          numberOfLines={1}
        >
          WO #{wo.workOrderNumber}
        </Text>
        {sheet ? (
          <View
            style={[
              styles.statusPill,
              { backgroundColor: colors.secondary, borderRadius: 999 },
            ]}
          >
            <Text style={[styles.statusText, { color: colors.secondaryForeground }]}>
              {STATUS_LABELS[sheet.status] ?? sheet.status}
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.headerCustomer, { color: colors.foreground }]}>
        {wo.customerName}
      </Text>
      {wo.workLocationAddress || wo.projectAddress ? (
        <Text
          style={[styles.headerAddress, { color: colors.mutedForeground }]}
          numberOfLines={2}
        >
          {wo.workLocationAddress || wo.projectAddress}
        </Text>
      ) : null}
    </View>
  );
}

function EditableForm({
  totalHours,
  setTotalHours,
  workDescription,
  setWorkDescription,
  items,
  onChangeItemQty,
  onRemoveItem,
  onOpenPicker,
  errors,
  colors,
}: {
  totalHours: string;
  setTotalHours: (v: string) => void;
  workDescription: string;
  setWorkDescription: (v: string) => void;
  items: DraftItem[];
  onChangeItemQty: (rowId: string, qty: string) => void;
  onRemoveItem: (rowId: string) => void;
  onOpenPicker: () => void;
  errors: FieldErrors;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <>
      <Section title="Total hours" colors={colors}>
        <TextInput
          value={totalHours}
          onChangeText={(v) => setTotalHours(v.replace(/[^0-9.]/g, ""))}
          placeholder="0.0"
          placeholderTextColor={colors.mutedForeground}
          keyboardType="decimal-pad"
          inputMode="decimal"
          accessibilityLabel="Total hours"
          accessibilityHint="Enter the total hours worked, up to 24"
          style={[
            styles.input,
            {
              color: colors.foreground,
              backgroundColor: colors.background,
              borderColor: errors.totalHours ? colors.destructive : colors.border,
              borderRadius: colors.radius - 4,
            },
          ]}
        />
        {errors.totalHours ? (
          <Text style={[styles.fieldError, { color: colors.destructive }]}>
            {errors.totalHours}
          </Text>
        ) : null}
      </Section>

      <Section title="Work description" colors={colors}>
        <TextInput
          value={workDescription}
          onChangeText={setWorkDescription}
          placeholder="What did you do on this visit?"
          placeholderTextColor={colors.mutedForeground}
          multiline
          numberOfLines={5}
          textAlignVertical="top"
          accessibilityLabel="Work description"
          style={[
            styles.input,
            styles.multiline,
            {
              color: colors.foreground,
              backgroundColor: colors.background,
              borderColor: errors.workDescription
                ? colors.destructive
                : colors.border,
              borderRadius: colors.radius - 4,
            },
          ]}
        />
        {errors.workDescription ? (
          <Text style={[styles.fieldError, { color: colors.destructive }]}>
            {errors.workDescription}
          </Text>
        ) : null}
      </Section>

      <Section title={`Parts (${items.length})`} colors={colors}>
        {items.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            No parts added yet.
          </Text>
        ) : (
          items.map((it, idx) => (
            <View
              key={it.rowId}
              style={[
                styles.itemRow,
                idx > 0 && {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: colors.border,
                  paddingTop: 10,
                },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemName, { color: colors.foreground }]}>
                  {it.partName}
                </Text>
              </View>
              <TextInput
                value={it.quantity}
                onChangeText={(v) => onChangeItemQty(it.rowId, v)}
                placeholder="Qty"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="decimal-pad"
                inputMode="decimal"
                accessibilityLabel={`Quantity for ${it.partName}`}
                style={[
                  styles.qtyInput,
                  {
                    color: colors.foreground,
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    borderRadius: colors.radius - 4,
                  },
                ]}
              />
              <Pressable
                onPress={() => onRemoveItem(it.rowId)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${it.partName}`}
                hitSlop={6}
                style={({ pressed }) => [
                  styles.removeIcon,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Feather name="trash-2" size={16} color={colors.destructive} />
              </Pressable>
            </View>
          ))
        )}
        {errors.items ? (
          <Text style={[styles.fieldError, { color: colors.destructive }]}>
            {errors.items}
          </Text>
        ) : null}
        <Pressable
          onPress={onOpenPicker}
          accessibilityRole="button"
          accessibilityLabel="Add part"
          style={({ pressed }) => [
            styles.addItemButton,
            {
              borderColor: colors.primary,
              borderRadius: colors.radius - 4,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Feather name="plus" size={16} color={colors.primary} />
          <Text style={[styles.addItemText, { color: colors.primary }]}>
            Add part
          </Text>
        </Pressable>
      </Section>
    </>
  );
}

function ReadOnlySummary({
  sheet,
  colors,
}: {
  sheet: BillingSheet;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <>
      <Section title="Summary" colors={colors}>
        <DetailRow
          label="Status"
          value={STATUS_LABELS[sheet.status] ?? sheet.status}
          colors={colors}
        />
        <DetailRow
          label="Total hours"
          value={String(sheet.totalHours ?? "0")}
          colors={colors}
        />
        {sheet.workDate ? (
          <DetailRow
            label="Work date"
            value={new Date(sheet.workDate).toLocaleDateString()}
            colors={colors}
          />
        ) : null}
        {sheet.technicianName ? (
          <DetailRow
            label="Technician"
            value={sheet.technicianName}
            colors={colors}
          />
        ) : null}
      </Section>

      {sheet.workDescription ? (
        <Section title="Description" colors={colors}>
          <Text style={[styles.bodyText, { color: colors.foreground }]}>
            {sheet.workDescription}
          </Text>
        </Section>
      ) : null}

      {sheet.items && sheet.items.length > 0 ? (
        <Section title={`Parts (${sheet.items.length})`} colors={colors}>
          {sheet.items.map((it, idx) => (
            <View
              key={it.id ?? idx}
              style={[
                styles.itemRow,
                idx > 0 && {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: colors.border,
                  paddingTop: 10,
                },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemName, { color: colors.foreground }]}>
                  {it.partName}
                </Text>
              </View>
              <Text
                style={[styles.itemMeta, { color: colors.mutedForeground }]}
              >
                × {String(it.quantity)}
              </Text>
            </View>
          ))}
        </Section>
      ) : null}
    </>
  );
}

function PhotoStripSection({
  colors,
  isEdit,
  existingPhotos,
  pendingPhotos,
  onAddPhoto,
  onRetry,
  onCancelPending,
  onRemoveServer,
  photoError,
  onDismissError,
  isRemoving,
}: {
  colors: ReturnType<typeof useColors>;
  isEdit: boolean;
  existingPhotos: string[];
  pendingPhotos: PendingPhoto[];
  onAddPhoto: () => void;
  onRetry: (clientId: string) => void;
  onCancelPending: (p: PendingPhoto) => void;
  onRemoveServer: (url: string) => void;
  photoError: string | null;
  onDismissError: () => void;
  isRemoving: boolean;
}) {
  const totalCount =
    pendingPhotos.length + (isEdit ? existingPhotos.length : 0);
  return (
    <Section title={`Photos (${totalCount})`} colors={colors}>
      {photoError ? (
        <View
          style={[
            styles.errorBanner,
            {
              backgroundColor: "#fee2e2",
              borderColor: colors.destructive,
              borderRadius: colors.radius - 4,
            },
          ]}
        >
          <Feather name="alert-circle" size={16} color={colors.destructive} />
          <Text style={[styles.errorBannerText, { color: colors.destructive }]}>
            {photoError}
          </Text>
          <Pressable onPress={onDismissError} hitSlop={6}>
            <Feather name="x" size={16} color={colors.destructive} />
          </Pressable>
        </View>
      ) : null}
      {totalCount === 0 ? (
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
          No photos yet.
        </Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.photoStrip}
        >
          {pendingPhotos.map((p) => (
            <View
              key={`pending-${p.clientId}`}
              style={[
                styles.photoFrame,
                {
                  borderColor:
                    p.status === "error" ? colors.destructive : colors.border,
                  borderRadius: colors.radius - 4,
                  backgroundColor: colors.secondary,
                },
              ]}
            >
              <Image
                source={{ uri: p.localUri }}
                style={styles.photoImage}
                contentFit="cover"
                transition={120}
                cachePolicy="memory"
                accessibilityLabel="Pending billing sheet photo"
              />
              <View style={styles.photoOverlay} pointerEvents="box-none">
                {p.status === "queued" ? (
                  <View style={styles.photoOverlayCenter} pointerEvents="none">
                    <ActivityIndicator color="#ffffff" />
                  </View>
                ) : (
                  <View style={styles.photoErrorOverlay}>
                    <Pressable
                      onPress={() => onRetry(p.clientId)}
                      accessibilityRole="button"
                      accessibilityLabel="Retry photo upload"
                      style={({ pressed }) => [
                        styles.photoOverlayButton,
                        { opacity: pressed ? 0.85 : 1 },
                      ]}
                    >
                      <Feather name="refresh-cw" size={14} color="#ffffff" />
                      <Text style={styles.photoOverlayButtonText}>Retry</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => onCancelPending(p)}
                      accessibilityRole="button"
                      accessibilityLabel="Discard photo"
                      hitSlop={6}
                      style={({ pressed }) => [
                        styles.photoOverlayDismiss,
                        { opacity: pressed ? 0.7 : 1 },
                      ]}
                    >
                      <Feather name="x" size={14} color="#ffffff" />
                    </Pressable>
                  </View>
                )}
              </View>
            </View>
          ))}
          {(isEdit ? existingPhotos : []).map((url) => (
            <View
              key={url}
              style={[
                styles.photoFrame,
                {
                  borderColor: colors.border,
                  borderRadius: colors.radius - 4,
                  backgroundColor: colors.secondary,
                },
              ]}
            >
              <Image
                source={{ uri: photoUriFor(url) }}
                style={styles.photoImage}
                contentFit="cover"
                transition={120}
                cachePolicy="memory-disk"
                accessibilityLabel="Billing sheet photo"
              />
              {isEdit ? (
                <Pressable
                  onPress={() => onRemoveServer(url)}
                  disabled={isRemoving}
                  accessibilityRole="button"
                  accessibilityLabel="Remove photo"
                  hitSlop={6}
                  style={({ pressed }) => [
                    styles.photoOverlayDismiss,
                    {
                      position: "absolute",
                      top: 4,
                      right: 4,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Feather name="x" size={14} color="#ffffff" />
                </Pressable>
              ) : null}
            </View>
          ))}
        </ScrollView>
      )}
      <Pressable
        onPress={onAddPhoto}
        accessibilityRole="button"
        accessibilityLabel="Add Photos"
        style={({ pressed }) => [
          styles.addPhotoButton,
          {
            backgroundColor: colors.primary,
            borderRadius: colors.radius,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Feather name="camera" size={20} color={colors.primaryForeground} />
        <Text style={[styles.addPhotoText, { color: colors.primaryForeground }]}>
          Add Photos
        </Text>
      </Pressable>
    </Section>
  );
}

function PartPickerModal({
  colors,
  parts,
  isLoading,
  onPick,
  onClose,
}: {
  colors: ReturnType<typeof useColors>;
  parts: FieldTechPart[];
  isLoading: boolean;
  onPick: (part: FieldTechPart) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return parts;
    return parts.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q) ||
        (p.category ?? "").toLowerCase().includes(q),
    );
  }, [parts, search]);
  return (
    <View style={styles.modalOverlay}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <SafeAreaView
        style={[
          styles.modalSheet,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
        edges={["bottom"]}
      >
        <View style={styles.modalHeader}>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>
            Choose a part
          </Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Feather name="x" size={20} color={colors.mutedForeground} />
          </Pressable>
        </View>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search parts"
          placeholderTextColor={colors.mutedForeground}
          autoCorrect={false}
          autoCapitalize="none"
          style={[
            styles.input,
            {
              color: colors.foreground,
              backgroundColor: colors.background,
              borderColor: colors.border,
              borderRadius: colors.radius - 4,
              marginBottom: 8,
            },
          ]}
        />
        {isLoading ? (
          <View style={styles.modalLoading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }}>
            {filtered.length === 0 ? (
              <Text
                style={[styles.emptyText, { color: colors.mutedForeground, padding: 12 }]}
              >
                No parts match.
              </Text>
            ) : (
              filtered.map((part, idx) => (
                <Pressable
                  key={part.id}
                  onPress={() => onPick(part)}
                  style={({ pressed }) => [
                    styles.partRow,
                    {
                      borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth,
                      borderTopColor: colors.border,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.partName, { color: colors.foreground }]}>
                      {part.name}
                    </Text>
                    {part.sku || part.category ? (
                      <Text
                        style={[styles.partMeta, { color: colors.mutedForeground }]}
                        numberOfLines={1}
                      >
                        {[part.sku, part.category].filter(Boolean).join(" · ")}
                      </Text>
                    ) : null}
                  </View>
                  <Feather name="plus-circle" size={18} color={colors.primary} />
                </Pressable>
              ))
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

function Section({
  title,
  children,
  colors,
}: {
  title: string;
  children: React.ReactNode;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
        {title.toUpperCase()}
      </Text>
      <View
        style={[
          styles.sectionCard,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: colors.radius,
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

function DetailRow({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <Text style={[styles.detailValue, { color: colors.foreground }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16, gap: 16 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 32,
  },
  errorTitle: { fontSize: 18, fontWeight: "600", marginTop: 8 },
  errorBody: { fontSize: 14, textAlign: "center", maxWidth: 280 },

  headerCard: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 6,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerNumber: { fontSize: 12, fontWeight: "600", letterSpacing: 0.4 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 12, fontWeight: "600" },
  headerCustomer: { fontSize: 18, fontWeight: "700" },
  headerAddress: { fontSize: 13 },

  section: { gap: 6 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    paddingHorizontal: 4,
  },
  sectionCard: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 10,
  },

  input: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  multiline: { minHeight: 100, paddingTop: 10 },
  fieldError: { fontSize: 12, fontWeight: "500", paddingHorizontal: 2 },

  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  itemName: { fontSize: 14, fontWeight: "600" },
  itemMeta: { fontSize: 13 },
  qtyInput: {
    width: 64,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    textAlign: "center",
  },
  removeIcon: { padding: 4 },
  addItemButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
  addItemText: { fontSize: 14, fontWeight: "600" },
  addPhotoButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    marginTop: 4,
  },
  addPhotoText: { fontSize: 16, fontWeight: "700" },

  emptyText: { fontSize: 13, fontStyle: "italic" },
  bodyText: { fontSize: 14, lineHeight: 20 },

  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  detailLabel: { fontSize: 13, fontWeight: "500" },
  detailValue: { fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right" },

  photoStrip: { gap: 8, paddingVertical: 4 },
  photoFrame: {
    width: 96,
    height: 96,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    position: "relative",
  },
  photoImage: { width: "100%", height: "100%" },
  photoOverlay: { ...StyleSheet.absoluteFillObject },
  photoOverlayCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  photoErrorOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  photoOverlayButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: 6,
  },
  photoOverlayButtonText: { color: "#ffffff", fontSize: 11, fontWeight: "600" },
  photoOverlayDismiss: {
    padding: 4,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 999,
  },

  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  errorBannerText: { flex: 1, fontSize: 13 },

  submitButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
  },
  submitText: { fontSize: 16, fontWeight: "600" },
  submitHint: {
    fontSize: 12,
    marginTop: 6,
    textAlign: "center",
  },

  modalOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: "flex-end" },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  modalSheet: {
    maxHeight: "80%",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    gap: 4,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 8,
  },
  modalTitle: { fontSize: 16, fontWeight: "700" },
  modalLoading: { padding: 24, alignItems: "center" },
  partRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  partName: { fontSize: 14, fontWeight: "600" },
  partMeta: { fontSize: 12, marginTop: 2 },
});
