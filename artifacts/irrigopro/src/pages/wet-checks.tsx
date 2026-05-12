import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, authedPhotoSrc, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { safeGet } from "@/utils/safeStorage";
import { Loader2, ChevronLeft, Search, CheckCircle2, Wrench, MinusCircle, Trash2, Camera, Pencil, AlertTriangle, ImageIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { preparePhotoForUpload } from "@/lib/photo-prep";
import { buildFindingSavePayload } from "@/lib/finding-save-payload";
import {
  PHOTO_OFFLINE_MESSAGE,
  isProbablyOffline,
  isOfflinePhotosEnabled,
  ensurePersistentStorage,
  queuePhotoUpload,
  createWetCheck as offlineCreateWetCheck,
  submitWetCheck as offlineSubmitWetCheck,
  upsertZoneRecord as offlineUpsertZoneRecord,
  createFinding as offlineCreateFinding,
  updateFinding as offlineUpdateFinding,
  deleteFinding as offlineDeleteFinding,
  enqueueZoneRevertCascade as offlineEnqueueZoneRevertCascade,
  linkPhotoToFinding as offlineLinkPhotoToFinding,
  warmWetCheckMirror,
  readWetCheckFromMirror,
  readWetCheckByClientId,
  cachedApiRequest,
  hasPendingMutationsForWetCheck,
} from "@/lib/offline/api";
import { tintForControllerLetter } from "@/lib/lifecycle";
import { isOfflineQueueEnabled } from "@/lib/offline/engine";
import { openOfflineDB, putFindingMirror } from "@/lib/offline/db";
import { OfflineStrip, OfflineSyncUI, useSyncEngineState } from "@/components/offline/sync-ui";
import type {
  Customer,
  WorkOrder,
  WetCheck,
  WetCheckWithDetails,
  WetCheckZoneRecord,
  WetCheckFinding,
  WetCheckPhoto,
  PropertyController,
  IssueTypeConfig,
  Part,
} from "@workspace/db/schema";

// UUIDv4 strict — server validators (z.string().uuid()) reject anything else,
// so the fallback path also emits a v4-shaped string when crypto.randomUUID
// is unavailable (older Safari, insecure contexts).
const newClientId = (): string => {
  const cryptoObj: Crypto | undefined =
    typeof crypto !== "undefined" ? (crypto as Crypto) : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

function getCurrentUser(): { id: number; role: string; name?: string } | null {
  const raw = safeGet("user");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const u = getCurrentUser();
  if (u) {
    headers["x-user-role"] = u.role;
    headers["x-user-id"] = String(u.id);
    if (u.name) headers["x-user-name"] = u.name;
  }
  return headers;
}

// ─── Property context header (Task #428) ──────────────────────────────────────
// Sticky banner shown on every wet-check screen so the tech is never one tap
// away from forgetting which property they're standing on. Drilling into a
// controller / zone appends those breadcrumbs without losing the customer
// + address line.
function PropertyContextHeader({
  customerName,
  propertyAddress,
  controllerLetter,
  zoneNumber,
}: {
  customerName: string;
  propertyAddress: string | null | undefined;
  controllerLetter?: string | null;
  zoneNumber?: number | null;
}) {
  const breadcrumb: string[] = [];
  if (controllerLetter) breadcrumb.push(`Controller ${controllerLetter}`);
  if (zoneNumber != null) breadcrumb.push(`Zone ${zoneNumber}`);
  return (
    <div
      className="sticky top-0 z-30 -mx-3 sm:-mx-4 px-3 sm:px-4 py-2 bg-white/95 backdrop-blur border-b shadow-sm"
      data-testid="property-context-header"
    >
      <div className="max-w-3xl mx-auto">
        <div
          className="text-sm font-semibold text-gray-900 truncate"
          data-testid="property-context-customer"
        >
          {customerName}
        </div>
        <div
          className="text-xs text-gray-600 truncate"
          data-testid="property-context-address"
        >
          {propertyAddress ?? "—"}
          {breadcrumb.length > 0 && (
            <>
              <span className="mx-1.5 text-gray-300">·</span>
              <span data-testid="property-context-breadcrumb">{breadcrumb.join(" · ")}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Direct-to-storage photo upload (prep → sign → PUT → finalize) ───────────
// Mirrors the billing-sheet upload path: shared `preparePhotoForUpload`
// (HEIC→JPEG, ~1600px / ~0.35MB / q=0.80) + mandatory finalize so the
// server generates `thumb` / `medium` variants for galleries / lightbox.
async function uploadPhotoToStorage(file: File): Promise<string> {
  const signRes = await fetch(`/api/upload/photo?originalName=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: getAuthHeaders(),
    credentials: "include",
  });
  if (!signRes.ok) throw new Error(`Failed to get upload URL (${signRes.status})`);
  const { signedUrl, url } = await signRes.json();

  const { displayFile } = await preparePhotoForUpload(file);

  const putRes = await fetch(signedUrl, {
    method: "PUT",
    body: displayFile,
    headers: { "Content-Type": displayFile.type || "application/octet-stream" },
  });
  if (!putRes.ok) throw new Error(`Upload to storage failed (${putRes.status})`);

  const finalizeRes = await fetch("/api/upload/photo/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    credentials: "include",
    body: JSON.stringify({ photoId: url }),
  });
  if (!finalizeRes.ok) {
    let detail = `${finalizeRes.status}`;
    try { const body = await finalizeRes.json(); if (body?.message) detail = body.message; } catch {}
    throw new Error(`Photo finalize failed (${detail})`);
  }
  return url as string;
}

// Compact photo capture button. Wraps a file input with camera capture and
// posts the resulting URL to /api/wet-checks/:id/photos with a client-side
// takenAt so true camera time survives offline-then-sync.
function PhotoCaptureButton({
  wetCheckId,
  wetCheckClientId,
  zoneRecordId,
  zoneRecordClientId,
  findingId,
  findingClientId,
  onUploaded,
  skipInvalidate,
  testIdSuffix,
}: {
  wetCheckId: number;
  // 4C — when the OFFLINE_PHOTOS flag is on, the captured Blob is queued
  // through the offline engine using these clientIds as parents. The
  // wet-check clientId is required to take the offline path; without it
  // we fall back to the direct online sign→PUT→finalize flow.
  wetCheckClientId?: string | null;
  zoneRecordId?: number | null;
  zoneRecordClientId?: string | null;
  findingId?: number | null;
  findingClientId?: string | null;
  onUploaded?: (photo: WetCheckPhoto) => void;
  skipInvalidate?: boolean;
  testIdSuffix?: string;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const libraryInputRef = useRef<HTMLInputElement | null>(null);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    // 4C path — offline-photos flag on AND we have a wet-check clientId
    // to anchor the queued mutation. Compresses + persists the Blob in
    // IndexedDB and enqueues the upload; engine drains it now (online)
    // or on reconnect (offline). Optimistic thumbnail comes from a
    // local object URL.
    if (isOfflinePhotosEnabled() && wetCheckClientId) {
      setBusy(true);
      try {
        // Best-effort persistent-storage request + tight-quota guard.
        // Fire-and-forget: never blocks capture.
        void ensurePersistentStorage().then((s) => {
          if (s.quotaTight) {
            toast({
              title: "Storage almost full",
              description: "Free up space on your device — queued photos may not save.",
              variant: "destructive",
            });
          }
        });
        const queued = await queuePhotoUpload({
          file,
          wetCheckClientId,
          wetCheckId,
          zoneRecordClientId: zoneRecordClientId ?? null,
          zoneRecordId: zoneRecordId ?? null,
          findingClientId: findingClientId ?? null,
          findingId: findingId ?? null,
        });
        // The compression spec says: silent fallback for ≤10MB originals,
        // toast only when the original was huge AND we couldn't compress.
        if (queued.usedFallback && queued.originalSize > 10 * 1024 * 1024) {
          toast({
            title: "Photo couldn't be compressed",
            description: "Uploading the original — this may be slow on weak signal.",
          });
        }
        if (!skipInvalidate) {
          queryClient.invalidateQueries({ queryKey: ["/api/wet-checks", wetCheckId] });
        }
        // Synthesize an optimistic photo for callers (FindingSheet
        // pre-save) that need a stable id to display the thumbnail.
        // The negative id is replaced by the real server id once the
        // metadata POST resolves and React Query refetches.
        const optimistic: WetCheckPhoto = {
          id: -Date.now(),
          wetCheckId,
          url: queued.localUrl || "",
          takenAt: new Date().toISOString(),
          zoneRecordId: zoneRecordId ?? null,
          findingId: findingId ?? null,
          clientId: queued.clientId,
        } as unknown as WetCheckPhoto;
        onUploaded?.(optimistic);
        toast({
          title: isProbablyOffline() ? "Photo queued offline" : "Photo queued",
          description: isProbablyOffline() ? "Will upload when you're back online." : undefined,
        });
      } catch (err: any) {
        toast({ title: "Photo capture failed", description: err?.message ?? "Try again", variant: "destructive" });
      } finally {
        setBusy(false);
      }
      return;
    }
    // Legacy direct-upload path. With the flag off, photos remain
    // online-only and we surface the Slice 4B message offline.
    if (isProbablyOffline()) {
      toast({ title: "Photo not captured", description: PHOTO_OFFLINE_MESSAGE, variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const takenAt = file.lastModified ? new Date(file.lastModified).toISOString() : new Date().toISOString();
      const url = await uploadPhotoToStorage(file);
      const created: WetCheckPhoto = await apiRequest(`/api/wet-checks/${wetCheckId}/photos`, "POST", {
        url,
        takenAt,
        zoneRecordId: zoneRecordId ?? null,
        findingId: findingId ?? null,
        clientId: newClientId(),
      });
      if (!skipInvalidate) {
        queryClient.invalidateQueries({ queryKey: ["/api/wet-checks", wetCheckId] });
      }
      onUploaded?.(created);
      toast({ title: "Photo added" });
    } catch (err: any) {
      toast({ title: "Photo upload failed", description: err?.message ?? "Try again", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const suffix = testIdSuffix ?? `${zoneRecordId ?? findingId ?? "wc"}`;
  return (
    <>
      {/* Camera input — `capture="environment"` opens the rear camera live.
          Library input omits `capture` so the OS shows the photo picker. Both
          paths share `onPick` so offline queueing, compression, EXIF
          handling, and thumbnails behave identically. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPick}
        data-testid={`photo-input-${suffix}`}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPick}
        data-testid={`photo-input-library-${suffix}`}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            type="button"
            disabled={busy}
            className="min-h-[44px]"
            data-testid={`btn-photo-${suffix}`}
          >
            {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Camera className="w-4 h-4 mr-1" />}
            Photo
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={(e) => { e.preventDefault(); cameraInputRef.current?.click(); }}
            data-testid={`btn-photo-${suffix}-camera`}
          >
            <Camera className="w-4 h-4 mr-2" />
            Take Photo
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => { e.preventDefault(); libraryInputRef.current?.click(); }}
            data-testid={`btn-photo-${suffix}-library`}
          >
            <ImageIcon className="w-4 h-4 mr-2" />
            Choose from Library
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function PhotoThumb({ photo, canDelete }: { photo: WetCheckPhoto; canDelete: boolean }) {
  const { toast } = useToast();
  // Task #510 — split "bytes still uploading" from "no server row yet"
  // so the lightbox tap target is available the moment the upload
  // finalize POST returns, even if a follow-up `photo.link` PATCH is
  // still queued. We read the engine's view of the queue (the same
  // source the Sync queue UI uses) so we don't duplicate state.
  const photoClientId = (photo as { clientId?: string | null }).clientId ?? null;
  const snap = useSyncEngineState(isOfflineQueueEnabled());
  const uploadMut = photoClientId
    ? snap.mutations.find(
        (m) => m.kind === "photo.upload" && m.clientId === photoClientId,
      )
    : undefined;
  const uploading =
    !!uploadMut && (uploadMut.status === "pending" || uploadMut.status === "syncing");

  const isLocalUrl =
    typeof photo.url === "string" &&
    (photo.url.startsWith("blob:") || photo.url.startsWith("data:"));
  const hasServerUrl =
    !isLocalUrl && typeof photo.url === "string" && photo.url.length > 0;
  const hasServerId = photo.id > 0;

  const src = isLocalUrl ? photo.url : authedPhotoSrc(photo.url, "thumb");
  // Lightbox: tap a thumb to open the medium variant in a new tab. As
  // soon as the photo has a server URL and its upload mutation has
  // drained, we open it — the link PATCH being stuck no longer blocks
  // the tap target.
  const fullSrc =
    hasServerUrl && !uploading ? authedPhotoSrc(photo.url, "medium") : null;
  const delMut = useMutation({
    mutationFn: () => apiRequest(`/api/wet-checks/photos/${photo.id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks", photo.wetCheckId] });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e?.message, variant: "destructive" }),
  });
  return (
    <div className="relative inline-block w-20 h-20 rounded overflow-hidden border" data-testid={`photo-thumb-${photo.id}`}>
      {fullSrc ? (
        <a href={fullSrc} target="_blank" rel="noreferrer" className="block w-full h-full">
          <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" />
        </a>
      ) : (
        <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" />
      )}
      {uploading && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/30"
          data-testid={`photo-thumb-${photo.id}-uploading`}
        >
          <Loader2 className="w-5 h-5 text-white animate-spin" />
        </div>
      )}
      {canDelete && hasServerId && (
        <button
          type="button"
          onClick={() => delMut.mutate()}
          className="absolute top-0 right-0 bg-black/60 text-white p-0.5 rounded-bl"
          aria-label="Delete photo"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// Pre-save pending photos grid for the FindingSheet. Mirrors PhotoThumb's
// Task #510 logic: open the lightbox as soon as the upload finalizes,
// keep the spinner overlay until then, and only allow remove once we
// have a real server id (or no offline-queue clientId at all).
function PendingPhotosGrid({
  pendingPhotos,
  onRemove,
}: {
  pendingPhotos: WetCheckPhoto[];
  onRemove: (id: number) => void;
}) {
  const snap = useSyncEngineState(isOfflineQueueEnabled());
  return (
    <div className="flex flex-wrap gap-2" data-testid="pending-photos">
      {pendingPhotos.map((p) => {
        const photoClientId = (p as { clientId?: string | null }).clientId ?? null;
        const uploadMut = photoClientId
          ? snap.mutations.find(
              (m) => m.kind === "photo.upload" && m.clientId === photoClientId,
            )
          : undefined;
        const uploading =
          !!uploadMut &&
          (uploadMut.status === "pending" || uploadMut.status === "syncing");
        const isLocal =
          typeof p.url === "string" &&
          (p.url.startsWith("blob:") || p.url.startsWith("data:"));
        const hasServerUrl =
          !isLocal && typeof p.url === "string" && p.url.length > 0;
        const hasServerId = p.id > 0;
        const src = isLocal ? p.url : authedPhotoSrc(p.url, "thumb");
        const fullSrc =
          hasServerUrl && !uploading ? authedPhotoSrc(p.url, "medium") : null;
        return (
          <div
            key={p.id}
            className="relative inline-block w-20 h-20 rounded overflow-hidden border"
            data-testid={`pending-photo-${p.id}`}
          >
            {fullSrc ? (
              <a
                href={fullSrc}
                target="_blank"
                rel="noreferrer"
                className="block w-full h-full"
              >
                <img
                  src={src}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </a>
            ) : (
              <img
                src={src}
                alt=""
                className="w-full h-full object-cover"
                loading="lazy"
              />
            )}
            {uploading && (
              <div
                className="absolute inset-0 flex items-center justify-center bg-black/30"
                data-testid={`pending-photo-${p.id}-uploading`}
              >
                <Loader2 className="w-5 h-5 text-white animate-spin" />
              </div>
            )}
            {hasServerId && (
              <button
                type="button"
                onClick={() => onRemove(p.id)}
                className="absolute top-0 right-0 bg-black/60 text-white p-0.5 rounded-bl"
                aria-label="Remove queued photo"
                data-testid={`remove-pending-photo-${p.id}`}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── List page ────────────────────────────────────────────────────────────────

function WetCheckList() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const me = useMemo(() => getCurrentUser(), []);

  const { data: wetChecks = [], isLoading: loadingWcs } = useQuery<WetCheck[]>({
    queryKey: ["/api/wet-checks"],
  });
  const { data: techWorkOrders = [] } = useQuery<WorkOrder[]>({
    queryKey: ["/api/work-orders", "technician", me?.id],
    queryFn: () => apiRequest(`/api/work-orders?technician=${me!.id}`),
    enabled: !!me?.id,
  });

  const todaysScheduled = useMemo(() => {
    const today = new Date();
    const y = today.getFullYear(), m = today.getMonth(), d = today.getDate();
    const isToday = (raw: any) => {
      if (!raw) return false;
      const dt = new Date(raw);
      return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d;
    };
    const seen = new Set<number>();
    const out: { customerId: number; customerName: string; address: string | null }[] = [];
    for (const wo of techWorkOrders) {
      if (!isToday(wo.scheduledDate)) continue;
      if (seen.has(wo.customerId)) continue;
      seen.add(wo.customerId);
      out.push({
        customerId: wo.customerId,
        customerName: wo.customerName ?? `Customer #${wo.customerId}`,
        address: (wo as any).projectAddress ?? null,
      });
    }
    return out;
  }, [techWorkOrders]);

  const { data: allCustomers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
    enabled: !!search.trim(),
  });

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return allCustomers
      .filter(c => c.name.toLowerCase().includes(q) || (c.address ?? "").toLowerCase().includes(q))
      .slice(0, 20);
  }, [allCustomers, search]);

  const createMut = useMutation({
    mutationFn: async (input: { customerId: number }) =>
      offlineCreateWetCheck({ customerId: input.customerId, clientId: newClientId() }),
    onSuccess: (wc: { id?: number; clientId: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] });
      if (wc.id != null) {
        navigate(`/wet-checks/${wc.id}`);
      } else {
        // Offline: server id not assigned yet. Route into the clientId
        // detail so the tech can keep capturing zones, findings, etc.
        // The engine will rewrite the URL placeholder once the create op
        // resolves online; the user-visible URL stays stable.
        toast({
          title: "Queued offline",
          description: "Wet check will sync when you're back online.",
        });
        navigate(`/wet-checks/c/${wc.clientId}`);
      }
    },
    onError: (e: any) => toast({ title: "Failed", description: e?.message ?? "Could not start wet check", variant: "destructive" }),
  });

  return (
    <div className="max-w-3xl mx-auto py-4 space-y-4 px-3 sm:px-4 pb-safe">
      <OfflineStrip />
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Wet Checks</h1>
        <OfflineSyncUI />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Start a Wet Check</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search any customer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-11 text-base"
              data-testid="input-customer-search"
            />
          </div>

          {search.trim() && (
            <div className="space-y-1" data-testid="section-search-results">
              {filteredCustomers.length === 0 ? (
                <div className="text-sm text-gray-500 py-3">No matches</div>
              ) : filteredCustomers.map(c => (
                <button
                  key={c.id}
                  className="w-full text-left p-3 border rounded hover:bg-blue-50 disabled:opacity-50"
                  onClick={() => createMut.mutate({ customerId: c.id })}
                  disabled={createMut.isPending}
                  data-testid={`pick-customer-${c.id}`}
                >
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-gray-500">{c.address ?? "—"} · {c.totalControllers ?? 1} controller(s)</div>
                </button>
              ))}
            </div>
          )}

          {!search.trim() && (
            <div data-testid="section-today">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Today's Schedule</div>
              {todaysScheduled.length === 0 ? (
                <div className="text-sm text-gray-500 py-3">
                  No properties scheduled for you today. Search above to pick any customer.
                </div>
              ) : (
                <div className="space-y-1">
                  {todaysScheduled.map(p => (
                    <button
                      key={p.customerId}
                      className="w-full text-left p-3 border rounded hover:bg-blue-50 disabled:opacity-50"
                      onClick={() => createMut.mutate({ customerId: p.customerId })}
                      disabled={createMut.isPending}
                      data-testid={`pick-scheduled-${p.customerId}`}
                    >
                      <div className="font-medium">{p.customerName}</div>
                      <div className="text-xs text-gray-500">{p.address ?? "—"}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div>
        <h2 className="text-sm font-semibold text-gray-600 mb-2">In progress & recent</h2>
        {loadingWcs ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin" /></div>
        ) : wetChecks.length === 0 ? (
          <Card><CardContent className="py-6 text-center text-gray-500 text-sm">
            No wet checks yet.
          </CardContent></Card>
        ) : (
          <div className="space-y-2">
            {wetChecks.map(wc => (
              <Card
                key={wc.id}
                className="cursor-pointer hover:bg-gray-50"
                onClick={() => navigate(`/wet-checks/${wc.id}`)}
                data-testid={`wet-check-row-${wc.id}`}
              >
                <CardContent className="py-3 flex items-center justify-between">
                  <div>
                    <div className="font-medium">{wc.customerName}</div>
                    <div className="text-xs text-gray-500">{wc.propertyAddress ?? "—"}</div>
                    <div className="text-xs text-gray-500">{new Date(wc.startedAt).toLocaleString()}</div>
                  </div>
                  <Badge variant={wc.status === "in_progress" ? "secondary" : "default"}>{wc.status}</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Detail page ──────────────────────────────────────────────────────────────

function WetCheckDetail({ id, clientId: routeClientId }: { id?: number; clientId?: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [activeLetter, setActiveLetter] = useState<string | null>(null);
  const [activeZone, setActiveZone] = useState<number | null>(null);

  const { data: wc, isLoading } = useQuery<WetCheckWithDetails>({
    queryKey: id != null ? ["/api/wet-checks", id] : ["/api/wet-checks", "c", routeClientId],
    // Mirror-first when offline (or when only clientId is known, i.e. a
    // wet check that was created offline and has no server id yet) so a
    // tech who reloads the page mid-capture still sees their queued state.
    // Online path warms the mirror so the next offline reload has fresh data.
    queryFn: async () => {
      // Pure-offline (no server id yet) path: read from mirror by clientId.
      if (id == null && routeClientId) {
        const cached = await readWetCheckByClientId(routeClientId);
        if (!cached) throw new Error("Wet check not yet synced — open it from the list when you're back online.");
        return cached as WetCheckWithDetails;
      }
      // IDB-first: when the offline queue is enabled, return the mirror
      // immediately if we have one and refresh from the network in the
      // background. The background refresh re-warms the mirror and triggers
      // a query invalidation so the UI updates without blocking the tech.
      if (isOfflineQueueEnabled()) {
        const cached = await readWetCheckFromMirror(id!);
        if (cached) {
          if (!isProbablyOffline()) {
            // Task #512 — skip the background refresh while local edits
            // for this wet check are still queued. Otherwise a stale
            // server snapshot (e.g. zone still `checked_with_issues`)
            // can clobber an optimistic Needs Work → Ran OK flip the
            // tech just made, leaving the controller-grid tile red even
            // though the local mirror + queue already say `checked_ok`.
            void hasPendingMutationsForWetCheck(cached?.clientId ?? "")
              .then((pending) => {
                if (pending) return;
                return apiRequest(`/api/wet-checks/${id}`)
                  .then((fresh) => warmWetCheckMirror(null, id!, fresh).then(() => {
                    queryClient.invalidateQueries({ queryKey: ["/api/wet-checks", id] });
                  }));
              })
              .catch(() => { /* ignore — heartbeat will recover */ });
          }
          return cached as WetCheckWithDetails;
        }
        // No mirror row yet — fall through to a blocking fetch and warm.
        if (isProbablyOffline()) {
          throw new Error("Wet check not cached locally — reconnect to load it.");
        }
      }
      const fresh = await apiRequest(`/api/wet-checks/${id}`);
      if (isOfflineQueueEnabled()) {
        try { await warmWetCheckMirror(null, id!, fresh); } catch {}
      }
      return fresh;
    },
  });

  const { data: controllers = [] } = useQuery<PropertyController[]>({
    queryKey: ["/api/properties", wc?.customerId, "controllers"],
    queryFn: () => cachedApiRequest(`/api/properties/${wc!.customerId}/controllers`),
    enabled: !!wc?.customerId,
  });

  // Submit-confirm modal pulls a server-computed preview of what will be
  // auto-billed vs. left for the manager queue, so the tech sees exact
  // dollars before committing. The same preview shape is returned by
  // /submit so the success toast can echo what actually happened.
  type SubmitPreview = {
    autoBillEnabled: boolean;
    autoBilledCount: number;
    autoBilledPartsTotal: string;
    autoBilledLaborTotal: string;
    autoBilledGrandTotal: string;
    pendingCount: number;
    pendingByGroup: { quick_fix: number; advanced: number; zone_issue: number };
  };
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [preview, setPreview] = useState<SubmitPreview | null>(null);

  // Slice 3 — server-authoritative WET_CHECK_AUTO_BILL flag. When OFF,
  // the field UI must fall back to the Slice 2 plain-submit flow (no
  // preview modal, no chip rail, no auto-bill messaging).
  const { data: autoBillCfg } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/config/wet-check-auto-bill"],
    staleTime: 5 * 60 * 1000,
  });
  const autoBillEnabled = autoBillCfg?.enabled ?? true;

  const previewMut = useMutation({
    mutationFn: (): Promise<SubmitPreview> =>
      apiRequest(`/api/wet-checks/${id}/submit-preview`, "POST", {}),
    onSuccess: (p) => {
      setPreview(p);
      setConfirmOpen(true);
    },
    onError: (e: any) =>
      toast({ title: "Could not preview submit", description: e?.message, variant: "destructive" }),
  });

  const submitMut = useMutation({
    mutationFn: async (): Promise<{ status?: string; billingSheetId?: number | null; autoBilledCount?: number; pendingCount?: number; queued?: boolean }> => {
      // Online path: hit the server directly so we get the auto-bill summary.
      // Offline path: queue the submit linked to this wet check by clientId
      // so the engine can dispatch it with the real id once create resolves.
      const serverId = wc?.id ?? id;
      // If we have no server id yet (e.g. opened by /c/:clientId before
      // the create has dispatched), the only safe path is to queue.
      const mustQueue = serverId == null;
      if ((mustQueue || (isOfflineQueueEnabled() && isProbablyOffline())) && wc?.clientId) {
        await offlineSubmitWetCheck(wc.clientId, serverId ?? undefined);
        return { queued: true };
      }
      return apiRequest(`/api/wet-checks/${serverId}/submit`, "POST", {});
    },
    onSuccess: (res) => {
      if (res.queued) {
        toast({
          title: "Queued offline",
          description: "Submit will run as soon as you're back online.",
        });
        setConfirmOpen(false);
        navigate("/wet-checks");
        return;
      }
      const parts: string[] = [];
      if ((res.autoBilledCount ?? 0) > 0) {
        parts.push(`${res.autoBilledCount} finding(s) auto-billed${res.billingSheetId ? ` (BS #${res.billingSheetId})` : ""}`);
      }
      if ((res.pendingCount ?? 0) > 0) parts.push(`${res.pendingCount} pending → manager`);
      if ((res.pendingCount ?? 0) === 0 && (res.autoBilledCount ?? 0) === 0) parts.push("No findings to bill");
      toast({ title: "Submitted", description: parts.join(" · ") });
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] });
      setConfirmOpen(false);
      navigate("/wet-checks");
    },
    onError: (e: any) => toast({ title: "Failed to submit", description: e?.message, variant: "destructive" }),
  });

  if (isLoading || !wc) {
    return <div className="flex justify-center py-10"><Loader2 className="animate-spin" /></div>;
  }

  const zonesByLetter = (letter: string) =>
    wc.zoneRecords.filter(z => z.controllerLetter === letter);

  const isReadOnly = wc.status !== "in_progress";

  // Drill-down: a specific zone
  if (activeLetter && activeZone) {
    const ctrl = controllers.find(c => c.controllerLetter === activeLetter);
    const zoneCount = ctrl?.zoneCount ?? 100;
    const records = zonesByLetter(activeLetter);
    const zoneRecord = records.find(z => z.zoneNumber === activeZone);
    return (
      // Task #511 — `key` forces a fresh mount whenever the tech advances
      // to a different zone. Without it, ZoneScreen (and the FindingSheet
      // it owns) is the same React instance across zones, so per-zone
      // local state — the Needs Work form (selected part, qty, labor
      // hours, notes, mark-complete toggle, no-part-needed toggle,
      // pending photos), the open finding sheet, the pending revert
      // dialog, and the inline Mark Zone Complete confirm — would leak
      // onto the next zone after `onAdvance()` flipped only the
      // `activeZone` prop. Remounting on `${letter}-${zone}` resets all
      // that state to defaults so each zone opens as a clean slate.
      <ZoneScreen
        key={`zone-${activeLetter}-${activeZone}`}
        wetCheckId={wc.id ?? id ?? 0}
        wetCheckClientId={wc.clientId ?? null}
        customerId={wc.customerId}
        customerName={wc.customerName}
        propertyAddress={wc.propertyAddress}
        letter={activeLetter}
        zoneNumber={activeZone}
        zoneCount={zoneCount}
        zoneRecord={zoneRecord}
        photos={wc.photos.filter(p => p.zoneRecordId === zoneRecord?.id)}
        readOnly={isReadOnly}
        onBack={() => setActiveZone(null)}
        onAdvance={() => {
          if (activeZone < zoneCount) setActiveZone(activeZone + 1);
          else setActiveZone(null);
        }}
      />
    );
  }

  // Drill-down: a specific controller's zone grid
  if (activeLetter) {
    const ctrl = controllers.find(c => c.controllerLetter === activeLetter);
    const records = zonesByLetter(activeLetter);
    const recordsByZone = new Map(records.map(r => [r.zoneNumber, r]));
    return (
      <div className="max-w-3xl mx-auto py-4 space-y-3 px-3 sm:px-4 pb-safe">
        <PropertyContextHeader
          customerName={wc.customerName}
          propertyAddress={wc.propertyAddress}
          controllerLetter={activeLetter}
        />
        <Button variant="ghost" onClick={() => setActiveLetter(null)} data-testid="btn-back">
          <ChevronLeft className="w-4 h-4 mr-1" /> Back to Controllers
        </Button>
        <ControllerHeader controller={ctrl} customerId={wc.customerId} readOnly={isReadOnly} />
        <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 gap-1.5 sm:gap-1">
          {Array.from({ length: ctrl?.zoneCount ?? 100 }, (_, i) => i + 1).map(n => {
            const r = recordsByZone.get(n);
            const cls = r?.status === "checked_ok"
              ? "bg-green-500 text-white"
              : r?.status === "checked_with_issues"
              ? "bg-red-500 text-white"
              : r?.status === "not_applicable"
              ? "bg-gray-400 text-white"
              : "bg-white border border-gray-300";
            // Task #458 — overlay a check-mark on Needs Work tiles the tech
            // has explicitly marked complete, so the controller grid reads
            // as a true progress map (red = still mid-edit, red-with-check
            // = reviewed-and-confirmed).
            const isMarkedComplete =
              r?.status === "checked_with_issues" && r?.markedCompleteAt != null;
            return (
              <button
                key={n}
                onClick={() => setActiveZone(n)}
                className={`relative aspect-square min-h-[44px] text-sm sm:text-xs font-medium rounded active:scale-95 transition-transform ${cls}`}
                data-testid={`zone-${activeLetter}-${n}`}
                data-marked-complete={isMarkedComplete ? "true" : undefined}
                aria-label={isMarkedComplete ? `Zone ${n} — Needs Work, marked complete` : `Zone ${n}`}
              >
                {n}
                {isMarkedComplete && (
                  <span
                    className="absolute -top-1 -right-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-white text-green-600 shadow ring-1 ring-green-600"
                    data-testid={`zone-${activeLetter}-${n}-marked-complete`}
                  >
                    <CheckCircle2 className="w-3 h-3" strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Top-level: controllers grid + wet-check level photos
  const wetCheckLevelPhotos = wc.photos.filter(p => !p.zoneRecordId && !p.findingId);
  // Status chip counts so the tech sees at-a-glance what they're about to
  // submit: how many findings are already complete (will auto-bill) vs.
  // still pending a manager decision, plus skipped zones.
  const allFindings = wc.zoneRecords.flatMap(z => z.findings);
  const completeCount = allFindings.filter(f => f.resolution === "repaired_in_field").length;
  const pendingFindingCount = allFindings.filter(f => f.resolution === "pending").length;
  // Task #464 — Complete findings that have neither a part nor the
  // labor-only confirmation block submit. Surface them inline on the CTA
  // so the tech knows exactly what to fix before tapping Submit.
  const completeNeedingDecision = allFindings.filter(f =>
    f.resolution === "repaired_in_field" &&
    f.partId == null &&
    !f.noPartNeeded,
  );
  const naCount = wc.zoneRecords.filter(z => z.status === "not_applicable").length;
  // Task #428 — submit CTA copy + intent counts. Disposition is the tech's
  // self-reported intent and is decoupled from `resolution` (which carries
  // billing/routing semantics).
  const dispositionCompleted = allFindings.filter(f => f.techDisposition === "completed_in_field").length;
  const dispositionNeedsReview = allFindings.filter(f => f.techDisposition !== "completed_in_field").length;
  const submitCtaLabel =
    allFindings.length === 0
      ? "Submit — no issues found"
      : dispositionNeedsReview === 0
        ? "Submit — all work completed"
        : "Submit for manager review";
  return (
    <div className="max-w-3xl mx-auto py-4 space-y-4 px-3 sm:px-4 pb-safe">
      <PropertyContextHeader
        customerName={wc.customerName}
        propertyAddress={wc.propertyAddress}
      />
      <OfflineStrip />
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={() => navigate("/wet-checks")}>
          <ChevronLeft className="w-4 h-4 mr-1" /> All Wet Checks
        </Button>
        <OfflineSyncUI />
      </div>
      {/* Sticky chip — keeps the complete / pending / skipped tally
          visible while the tech scrolls through controllers, so they
          always know what the submit-confirm modal will say. Tapping a
          chip scrolls to the matching findings group below the
          controllers grid. Hidden entirely when auto-billing is off so
          the Slice 2 submit experience is restored verbatim. */}
      {!isReadOnly && autoBillEnabled && (
        <div
          className="sticky top-2 z-20 -mx-3 sm:mx-0 px-3 sm:px-0 overflow-x-auto scrollbar-hide bg-white/90 backdrop-blur border-y sm:border sm:rounded py-1.5"
          data-testid="status-chip-row"
        >
          <div className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <button
              type="button"
              onClick={() => document.getElementById("findings-group-complete")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="min-h-[36px] inline-flex items-center"
              data-testid="chip-complete"
            >
              <Badge variant="default">✓ Complete · {completeCount}</Badge>
            </button>
            <button
              type="button"
              onClick={() => document.getElementById("findings-group-pending")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="min-h-[36px] inline-flex items-center"
              data-testid="chip-pending"
            >
              <Badge variant="secondary">Needs decision · {pendingFindingCount}</Badge>
            </button>
            <button
              type="button"
              onClick={() => document.getElementById("findings-group-na")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="min-h-[36px] inline-flex items-center"
              data-testid="chip-na"
            >
              <Badge variant="outline">N/A · {naCount}</Badge>
            </button>
          </div>
        </div>
      )}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <CardTitle>{wc.customerName}</CardTitle>
            {!isReadOnly && (
              <PhotoCaptureButton
                wetCheckId={wc.id ?? id ?? 0}
                wetCheckClientId={wc.clientId ?? null}
              />
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>{wc.propertyAddress ?? "—"}</div>
          <div>Status: <Badge>{wc.status}</Badge></div>
          {wetCheckLevelPhotos.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2" data-testid="wc-photos">
              {wetCheckLevelPhotos.map(p => (
                <PhotoThumb key={p.id} photo={p} canDelete={!isReadOnly} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <h2 className="text-lg font-semibold">Controllers</h2>
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        {controllers.map(c => {
          const recs = zonesByLetter(c.controllerLetter);
          const ok = recs.filter(r => r.status === "checked_ok").length;
          const issues = recs.filter(r => r.status === "checked_with_issues").length;
          const na = recs.filter(r => r.status === "not_applicable").length;
          return (
            <Card
              key={c.controllerLetter}
              className="cursor-pointer hover:bg-blue-50 active:bg-blue-100 transition-colors"
              onClick={() => setActiveLetter(c.controllerLetter)}
              data-testid={`controller-${c.controllerLetter}`}
            >
              <CardContent className="py-3 px-3 sm:py-4 sm:px-6">
                <div className="text-xl sm:text-2xl font-bold">
                  <span className="sm:hidden">Ctrl {c.controllerLetter}</span>
                  <span className="hidden sm:inline">Controller {c.controllerLetter}</span>
                </div>
                <div className="text-xs text-gray-600">{c.zoneCount} zones</div>
                <div className="mt-2 text-xs flex gap-2 sm:gap-3 flex-wrap">
                  <span className="text-green-700">✓ {ok}</span>
                  <span className="text-red-700">! {issues}</span>
                  <span className="text-gray-500">N/A {na}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {!isReadOnly && autoBillEnabled && (
        <FindingsByResolution
          findings={allFindings}
          zoneRecords={wc.zoneRecords}
        />
      )}

      {!isReadOnly && completeNeedingDecision.length > 0 && (
        <div
          className="text-sm rounded border border-amber-300 bg-amber-50 p-3 text-amber-900"
          data-testid="submit-needs-part-or-no-part-hint"
        >
          {completeNeedingDecision.length} finding{completeNeedingDecision.length === 1 ? " is" : "s are"} marked complete without a part.
          Open {completeNeedingDecision.length === 1 ? "it" : "them"} and either pick a part or tick
          {" "}<span className="font-medium">No part needed (labor only)</span> before submitting.
        </div>
      )}

      {!isReadOnly && (
        <Button
          className="w-full min-h-[48px]"
          size="lg"
          onClick={() => {
            // Flag-off → restore Slice 2 plain-submit (no preview, no
            // confirm modal). The server enforces the same gate, so
            // this is purely a UX fallback for the tech.
            if (!autoBillEnabled) {
              submitMut.mutate();
              return;
            }
            // Submit-preview is a server-only call. Skip it when offline,
            // when the offline queue flag is on without an in-band probe,
            // or when we don't yet have a server id (clientId-only route);
            // queue the submit directly so the tech can complete the
            // capture flow without connectivity.
            const noServerId = (wc?.id ?? id) == null;
            if (noServerId || isProbablyOffline()) {
              submitMut.mutate();
              return;
            }
            previewMut.mutate();
          }}
          disabled={previewMut.isPending || submitMut.isPending || completeNeedingDecision.length > 0}
          data-testid="btn-submit-wet-check"
        >
          {(previewMut.isPending || submitMut.isPending) ? <Loader2 className="animate-spin" /> : submitCtaLabel}
        </Button>
      )}

      {/* Submit-confirm modal — surfaces the server's preview of what
          will be auto-billed and what will land in the manager queue
          before the tech commits. */}
      <Dialog open={confirmOpen} onOpenChange={(o) => { if (!o && !submitMut.isPending) setConfirmOpen(false); }}>
        <DialogContent data-testid="submit-confirm-dialog">
          <DialogHeader>
            <DialogTitle>
              {allFindings.length === 0
                ? "Submit — no issues found?"
                : dispositionNeedsReview === 0
                  ? "Submit — all work completed?"
                  : "Submit for manager review?"}
            </DialogTitle>
            <DialogDescription data-testid="submit-confirm-intent">
              {allFindings.length === 0
                ? "No findings recorded — this wet check will be marked complete."
                : dispositionNeedsReview === 0
                  ? `${dispositionCompleted} finding(s) marked completed in field.`
                  : `${dispositionNeedsReview} finding(s) flagged for manager review${dispositionCompleted > 0 ? `, ${dispositionCompleted} completed in field` : ""}.`}
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="space-y-3 text-sm">
              {preview.autoBillEnabled ? (
                <div className="border rounded p-3" data-testid="preview-auto-billed">
                  <div className="font-medium flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    Auto-billed now
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    {preview.autoBilledCount} finding(s) marked complete · Parts ${preview.autoBilledPartsTotal} · Labor ${preview.autoBilledLaborTotal}
                  </div>
                  <div className="font-semibold mt-1" data-testid="preview-grand-total">
                    Total: ${preview.autoBilledGrandTotal}
                  </div>
                </div>
              ) : (
                <div className="border rounded p-3 bg-amber-50 border-amber-200" data-testid="preview-auto-bill-disabled">
                  <div className="font-medium flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    Auto-billing disabled
                  </div>
                  <div className="text-xs text-gray-700 mt-1">
                    All findings (including ones marked complete) will be sent to the manager queue for routing.
                  </div>
                </div>
              )}
              {preview.pendingCount > 0 && (
                <div className="border rounded p-3" data-testid="preview-pending">
                  <div className="font-medium flex items-center gap-2">
                    <Wrench className="w-4 h-4 text-amber-600" />
                    Pending — sent to manager
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    {preview.pendingCount} finding(s) need a routing decision
                  </div>
                  <div className="text-xs text-gray-600 mt-1 flex gap-3">
                    <span>Quick fix · {preview.pendingByGroup.quick_fix}</span>
                    <span>Advanced · {preview.pendingByGroup.advanced}</span>
                    <span>Zone · {preview.pendingByGroup.zone_issue}</span>
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={submitMut.isPending}
              data-testid="btn-submit-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={() => submitMut.mutate()}
              disabled={submitMut.isPending}
              data-testid="btn-submit-confirm"
            >
              {submitMut.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              {preview && preview.autoBillEnabled && preview.autoBilledCount > 0
                ? "Submit & Bill"
                : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Slice 3 — Per-resolution findings summary the sticky chips scroll to.
// Groups findings into Complete (auto-billed on submit), Pending (need a
// manager decision), and lists N/A zones, so the tech can audit what
// each chip count represents before committing the submit.
function FindingsByResolution({
  findings,
  zoneRecords,
}: {
  findings: WetCheckFinding[];
  zoneRecords: WetCheckZoneRecord[];
}) {
  const complete = findings.filter(f => f.resolution === "repaired_in_field");
  const pending = findings.filter(f => f.resolution === "pending");
  const naZones = zoneRecords.filter(z => z.status === "not_applicable");
  const zoneById = new Map(zoneRecords.map(z => [z.id, z]));
  const label = (f: WetCheckFinding) => {
    const zr = zoneById.get(f.zoneRecordId);
    const loc = zr ? `Zone ${zr.controllerLetter}${zr.zoneNumber}` : `Finding #${f.id}`;
    return `${loc} · ${f.partName ?? f.issueType} × ${Number(f.quantity ?? 0)}`;
  };
  return (
    <div className="space-y-3" data-testid="findings-by-resolution">
      <Card id="findings-group-complete">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            Complete · {complete.length}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs">
          {complete.length === 0
            ? <div className="text-gray-500">Nothing marked complete yet.</div>
            : <ul className="space-y-1" data-testid="group-complete-list">
                {complete.map(f => <li key={f.id} data-testid={`group-complete-row-${f.id}`}>{label(f)}</li>)}
              </ul>}
        </CardContent>
      </Card>
      <Card id="findings-group-pending">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Wrench className="w-4 h-4 text-amber-600" />
            Needs decision · {pending.length}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs">
          {pending.length === 0
            ? <div className="text-gray-500">No pending findings.</div>
            : <ul className="space-y-1" data-testid="group-pending-list">
                {pending.map(f => <li key={f.id} data-testid={`group-pending-row-${f.id}`}>{label(f)}</li>)}
              </ul>}
        </CardContent>
      </Card>
      <Card id="findings-group-na">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <MinusCircle className="w-4 h-4 text-gray-500" />
            N/A · {naZones.length}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs">
          {naZones.length === 0
            ? <div className="text-gray-500">No N/A zones.</div>
            : <div className="flex flex-wrap gap-1" data-testid="group-na-list">
                {naZones.map(z => (
                  <Badge key={z.id} variant="outline" data-testid={`group-na-zone-${z.controllerLetter}${z.zoneNumber}`}>
                    {z.controllerLetter}{z.zoneNumber}
                  </Badge>
                ))}
              </div>}
        </CardContent>
      </Card>
    </div>
  );
}

function ControllerHeader({
  controller,
  customerId,
  readOnly,
}: {
  controller: PropertyController | undefined;
  customerId: number;
  readOnly: boolean;
}) {
  const { toast } = useToast();
  const [zc, setZc] = useState<string>(String(controller?.zoneCount ?? 100));
  useEffect(() => { setZc(String(controller?.zoneCount ?? 100)); }, [controller?.zoneCount]);

  const updateMut = useMutation({
    mutationFn: (n: number) =>
      apiRequest(`/api/properties/${customerId}/controllers`, "PATCH", { controllerLetter: controller!.controllerLetter, zoneCount: n }),
    onSuccess: () => {
      toast({ title: "Saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/properties", customerId, "controllers"] });
    },
    onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }),
  });

  if (!controller) return null;
  return (
    <Card>
      <CardContent className="py-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xl font-semibold">Controller {controller.controllerLetter}</div>
          <div className="text-xs text-gray-500">Adjust zone count if wrong</div>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            value={zc}
            onChange={(e) => setZc(e.target.value)}
            className="w-20 h-10 text-base"
            disabled={readOnly}
            data-testid="input-zone-count"
          />
          <Button
            size="sm"
            disabled={readOnly || updateMut.isPending}
            onClick={() => {
              const n = parseInt(zc);
              if (!Number.isFinite(n) || n < 1 || n > 100) return;
              updateMut.mutate(n);
            }}
            data-testid="btn-save-zone-count"
          >
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Zone screen (YES/NO/N-A + findings + photos) ────────────────────────────

type FindingSheetState =
  | { open: false }
  | { open: true; mode: "create"; issueType: string }
  | { open: true; mode: "edit"; finding: WetCheckFinding };

// Exported for tests (Task #511 regression). Production callers use this
// via the parent's render branch in WetCheckDetail; the parent always
// keys it by `${activeLetter}-${activeZone}` so each zone gets a fresh
// mount.
export function ZoneScreen({
  wetCheckId,
  wetCheckClientId,
  customerId,
  customerName,
  propertyAddress,
  letter,
  zoneNumber,
  zoneCount,
  zoneRecord,
  photos,
  readOnly,
  onBack,
  onAdvance,
}: {
  wetCheckId: number;
  wetCheckClientId: string | null;
  customerId: number;
  customerName: string;
  propertyAddress: string | null;
  letter: string;
  zoneNumber: number;
  zoneCount: number;
  zoneRecord: (WetCheckZoneRecord & { findings: WetCheckFinding[] }) | undefined;
  photos: WetCheckPhoto[];
  readOnly: boolean;
  onBack: () => void;
  onAdvance: () => void;
}) {
  const { toast } = useToast();
  const [findingSheet, setFindingSheet] = useState<FindingSheetState>({ open: false });
  // Task #455 — revert from "Needs Work" back to "Ran OK" / "Skip" requires
  // an explicit confirm + cascade of finding + finding-photo deletes when
  // the zone has work attached. Tracks the pending target status until the
  // tech confirms.
  const [pendingRevert, setPendingRevert] = useState<
    null | { targetStatus: "checked_ok" | "not_applicable" }
  >(null);
  const [reverting, setReverting] = useState(false);
  // Slice 3 — flag-gated copy. With auto-bill OFF, we drop the
  // "auto-bills on submit" badge so the field UX matches Slice 2.
  const { data: autoBillCfg } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/config/wet-check-auto-bill"],
    staleTime: 5 * 60 * 1000,
  });
  const autoBillEnabled = autoBillCfg?.enabled ?? true;

  // Task #512 — every revert path (setStatus + performRevert cascade) has
  // to update the same query rows the controller grid subscribes to, so a
  // Needs Work → Ran OK flip flips the tile color immediately and isn't
  // overwritten by a stale background refetch. The detail query lives
  // under TWO possible keys depending on whether the page was opened by
  // server id or by client id (`/c/:clientId` route), so both must be
  // invalidated and patched.
  const detailQueryKeys: ReadonlyArray<readonly unknown[]> = [
    ...(wetCheckId ? [["/api/wet-checks", wetCheckId] as const] : []),
    ...(wetCheckClientId ? [["/api/wet-checks", "c", wetCheckClientId] as const] : []),
  ];
  function applyOptimisticZoneStatus(
    nextStatus: "checked_ok" | "checked_with_issues" | "not_applicable",
  ): Array<{ key: readonly unknown[]; previous: WetCheckWithDetails | undefined }> {
    const snapshots: Array<{ key: readonly unknown[]; previous: WetCheckWithDetails | undefined }> = [];
    for (const key of detailQueryKeys) {
      const previous = queryClient.getQueryData<WetCheckWithDetails>(key);
      snapshots.push({ key, previous });
      if (!previous) continue;
      const matches = (zr: WetCheckZoneRecord) =>
        zr.controllerLetter === letter && zr.zoneNumber === zoneNumber;
      queryClient.setQueryData<WetCheckWithDetails>(key, {
        ...previous,
        zoneRecords: previous.zoneRecords.map((zr) =>
          matches(zr)
            ? {
                ...zr,
                status: nextStatus,
                ranSuccessfully:
                  nextStatus === "checked_ok"
                    ? true
                    : nextStatus === "checked_with_issues"
                    ? false
                    : null,
                // Mirror the server's force-clear rule so a tile that was
                // both red AND green-checked (Needs Work + Mark Complete)
                // never carries the overlay over to a reverted Ran OK /
                // Skip tile.
                markedCompleteAt: nextStatus === "checked_with_issues" ? zr.markedCompleteAt : null,
              }
            : zr,
        ),
      });
    }
    return snapshots;
  }
  function rollbackOptimisticZoneStatus(
    snapshots: ReadonlyArray<{ key: readonly unknown[]; previous: WetCheckWithDetails | undefined }>,
  ) {
    for (const { key, previous } of snapshots) {
      if (previous) queryClient.setQueryData(key, previous);
    }
  }
  function invalidateDetailQueries() {
    for (const key of detailQueryKeys) {
      queryClient.invalidateQueries({ queryKey: key });
    }
    queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] });
  }

  const setStatus = useMutation({
    mutationFn: (status: "checked_ok" | "checked_with_issues" | "not_applicable") => {
      const clientId = zoneRecord?.clientId ?? newClientId();
      const checkedAt = new Date().toISOString();
      // Online: behaves identically to before. Offline: queues the write
      // through the offline engine and updates the IndexedDB mirror so the
      // page survives a refresh while the tech is still in airplane mode.
      if (isOfflineQueueEnabled() && wetCheckClientId) {
        return offlineUpsertZoneRecord({
          wetCheckClientId,
          wetCheckId,
          controllerLetter: letter,
          zoneNumber,
          status,
          ranSuccessfully: status === "checked_ok" ? true : status === "checked_with_issues" ? false : null,
          notes: null,
          checkedAt,
          clientId,
        });
      }
      return apiRequest(`/api/wet-checks/${wetCheckId}/zone-records`, "POST", {
        controllerLetter: letter,
        zoneNumber,
        status,
        ranSuccessfully: status === "checked_ok" ? true : status === "checked_with_issues" ? false : null,
        checkedAt,
        clientId,
      });
    },
    onMutate: async (status) => {
      // Task #512 — optimistically flip the zone in the cached detail
      // payload BEFORE any await. The controller-grid tile reads
      // `wc.zoneRecords[i].status` from this same query, so this makes
      // a Needs Work → Ran OK / Skip flip turn the tile green/gray
      // immediately and survive the offline mirror writeback.
      await Promise.all(
        detailQueryKeys.map((k) => queryClient.cancelQueries({ queryKey: k })),
      );
      const snapshots = applyOptimisticZoneStatus(status);
      return { snapshots };
    },
    onError: (e: any, _status, ctx) => {
      if (ctx?.snapshots) rollbackOptimisticZoneStatus(ctx.snapshots);
      toast({ title: "Failed", description: e?.message, variant: "destructive" });
    },
    onSuccess: (_data, status) => {
      // Auto-advance to the next zone unless the tech needs to add findings.
      if (status === "checked_ok" || status === "not_applicable") {
        setTimeout(() => onAdvance(), 250);
      }
    },
    onSettled: () => {
      invalidateDetailQueries();
    },
  });

  const { data: issueTypes = [] } = useQuery<IssueTypeConfig[]>({
    queryKey: ["/api/wet-checks/issue-types"],
    queryFn: () => cachedApiRequest(`/api/wet-checks/issue-types`),
  });

  const deleteFindingMut = useMutation({
    mutationFn: (f: { id: number; clientId: string | null }) => {
      if (isOfflineQueueEnabled() && f.clientId) {
        return offlineDeleteFinding(f.clientId, f.id);
      }
      return apiRequest(`/api/wet-checks/findings/${f.id}`, "DELETE");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] }),
  });

  // Task #455 — counts of findings + finding-level photos used by both the
  // "is revert destructive?" gate on the status buttons and the body copy
  // of the confirmation dialog.
  const findings = zoneRecord?.findings ?? [];
  const findingIds = new Set(findings.map((f) => f.id));
  const findingPhotos = photos.filter(
    (p) => p.findingId != null && findingIds.has(p.findingId),
  );
  const hasAttachedWork = findings.length > 0 || findingPhotos.length > 0;

  // Cascade: delete each finding's photos, reset any non-pending findings
  // back to pending so the server's deleteWetCheckFinding allows the row
  // through, delete every finding, then flip the zone status. Order matters
  // — flipping status first would leave the zone briefly readable as
  // "Ran OK with findings" (the inconsistent state the spec calls out).
  //
  // Online path: sequential awaits enforce order naturally.
  // Offline path: a single `enqueueZoneRevertCascade` queues every step
  // with explicit `parentClientIds` chaining so the sync engine (which
  // dispatches up to 2 mutations concurrently) cannot reorder photo
  // deletes / finding patches / finding deletes / status flip during
  // replay.
  async function performRevert(target: "checked_ok" | "not_applicable") {
    setReverting(true);
    // Task #512 — flip the cached zone status before kicking off the
    // cascade so the controller grid re-renders the new color (green /
    // gray) immediately, even while the photo-delete / finding-delete /
    // status-flip mutations are still draining in the background. The
    // offline mirror is updated transitively by `enqueueZoneRevertCascade`
    // (the synchronous `putZoneRecordMirror` near the end of the cascade);
    // optimistic snapshots cover the online cascade path too.
    await Promise.all(
      detailQueryKeys.map((k) => queryClient.cancelQueries({ queryKey: k })),
    );
    const optimisticSnapshots = applyOptimisticZoneStatus(target);
    try {
      if (isOfflineQueueEnabled() && wetCheckClientId && zoneRecord?.clientId) {
        // Bucket photos by finding server id (works for both
        // clientId-having and legacy clientId-less findings).
        const photosByFindingId = new Map<number, number[]>();
        for (const p of findingPhotos) {
          if (!p.findingId) continue;
          const arr = photosByFindingId.get(p.findingId) ?? [];
          arr.push(p.id);
          photosByFindingId.set(p.findingId, arr);
        }
        await offlineEnqueueZoneRevertCascade({
          wetCheckClientId,
          wetCheckId,
          zoneRecordClientId: zoneRecord.clientId,
          zoneRecordId: zoneRecord.id,
          controllerLetter: letter,
          zoneNumber,
          targetStatus: target,
          findings: findings.map((f) => ({
            id: f.id,
            clientId: f.clientId ?? null,
            needsResetToPending: f.resolution !== "pending",
            photoIds: photosByFindingId.get(f.id) ?? [],
          })),
        });
      } else {
        // Online cascade — sequential awaits.
        for (const p of findingPhotos) {
          await apiRequest(`/api/wet-checks/photos/${p.id}`, "DELETE");
        }
        for (const f of findings) {
          if (f.resolution === "pending") continue;
          await apiRequest(`/api/wet-checks/findings/${f.id}`, "PATCH", { repairedInField: false });
        }
        for (const f of findings) {
          await apiRequest(`/api/wet-checks/findings/${f.id}`, "DELETE");
        }
        await new Promise<void>((resolve, reject) => {
          setStatus.mutate(target, {
            onSuccess: () => resolve(),
            onError: (e) => reject(e),
          });
        });
      }
      setPendingRevert(null);
    } catch (e: any) {
      // Roll back the optimistic green/gray flip so the tile returns to
      // its prior red state instead of misleading the tech that the
      // revert succeeded.
      rollbackOptimisticZoneStatus(optimisticSnapshots);
      toast({ title: "Couldn't reset zone", description: e?.message, variant: "destructive" });
    } finally {
      setReverting(false);
      // Invalidate the specific detail keys (server id + clientId) so the
      // grid re-reads the just-updated mirror / server snapshot. On
      // failure we still invalidate so any partially-applied state is
      // pulled fresh from the server.
      invalidateDetailQueries();
    }
  }

  // Decide whether to show the confirm dialog before flipping status.
  function handleStatusClick(next: "checked_ok" | "checked_with_issues" | "not_applicable") {
    const current = zoneRecord?.status;
    const isLeavingNeedsWork = current === "checked_with_issues" && next !== "checked_with_issues";
    if (isLeavingNeedsWork && hasAttachedWork) {
      setPendingRevert({ targetStatus: next as "checked_ok" | "not_applicable" });
      return;
    }
    setStatus.mutate(next);
  }

  // Task #428 — per-finding tech disposition (always visible regardless of
  // WET_CHECK_AUTO_BILL). Patches `techDisposition` on the finding so the
  // tech's intent survives manager rerouting downstream.
  // Task #454 — added optimistic update so the toggle visibly flips on tap
  // even before the PATCH (or queued mutation) finishes draining, plus a
  // proper revert + toast when the request fails so a silent failure
  // can no longer make the button look broken.
  const dispositionQueryKey: readonly unknown[] = ["/api/wet-checks", wetCheckId];
  const dispositionMut = useMutation({
    mutationFn: async (vars: {
      id: number;
      clientId: string | null;
      disposition: "completed_in_field" | "needs_review";
    }) => {
      const patch = { techDisposition: vars.disposition };
      if (isOfflineQueueEnabled() && vars.clientId) {
        await offlineUpdateFinding(vars.clientId, vars.id, patch);
        return;
      }
      await apiRequest(`/api/wet-checks/findings/${vars.id}`, "PATCH", patch);
    },
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: dispositionQueryKey });
      const previous = queryClient.getQueryData<WetCheckWithDetails>(dispositionQueryKey);
      if (previous) {
        queryClient.setQueryData<WetCheckWithDetails>(dispositionQueryKey, {
          ...previous,
          zoneRecords: previous.zoneRecords.map((zr) => ({
            ...zr,
            findings: zr.findings.map((f) =>
              f.id === vars.id ? { ...f, techDisposition: vars.disposition } : f,
            ),
          })),
        });
      }
      return { previous };
    },
    onError: (e: any, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(dispositionQueryKey, ctx.previous);
      }
      toast({
        title: "Couldn't update disposition",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] }),
  });

  // Task #454 — Mark Zone Complete from the Needs Work flow. The zone has
  // already been moved to `checked_with_issues` by tapping Needs Work, so
  // this is purely a wizard-advance: it reuses the same `onAdvance()` path
  // as Ran OK / Skip without touching the zone status. If the tech hasn't
  // logged any findings yet, we surface a tiny inline confirm so a stray
  // tap doesn't lose context.
  // Task #458 — also persist a `markedCompleteAt` timestamp on the zone so
  // the controller grid can render a check-mark overlay on Needs Work tiles
  // the tech has already reviewed-and-confirmed (vs. ones still mid-edit).
  // The state survives refresh because it lives on the zone record row.
  const [confirmMarkComplete, setConfirmMarkComplete] = useState(false);
  const findingsCount = zoneRecord?.findings.length ?? 0;
  const markCompleteMut = useMutation({
    mutationFn: async () => {
      const markedAt = new Date().toISOString();
      // Online + offline both share the upsert path, which dedupes by
      // (wetCheckId, controllerLetter, zoneNumber) so this re-stamps the
      // existing row without creating a duplicate.
      if (isOfflineQueueEnabled() && wetCheckClientId) {
        await offlineUpsertZoneRecord({
          wetCheckClientId,
          wetCheckId,
          controllerLetter: letter,
          zoneNumber,
          status: "checked_with_issues",
          ranSuccessfully: false,
          notes: zoneRecord?.notes ?? null,
          checkedAt: zoneRecord?.checkedAt
            ? new Date(zoneRecord.checkedAt).toISOString()
            : markedAt,
          markedCompleteAt: markedAt,
          clientId: zoneRecord?.clientId ?? undefined,
        });
        return;
      }
      if (zoneRecord?.id) {
        await apiRequest(`/api/wet-checks/zone-records/${zoneRecord.id}`, "PATCH", {
          markedCompleteAt: markedAt,
        });
      }
    },
    onMutate: async () => {
      // Optimistic flip so the badge appears immediately on advance.
      const key = ["/api/wet-checks", wetCheckId];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<WetCheckWithDetails>(key);
      const stamp = new Date();
      if (previous && zoneRecord) {
        // Match by server id when present, otherwise by clientId — avoids
        // false-positive flips on unsynced offline rows whose id is still
        // undefined.
        const matches = (zr: WetCheckZoneRecord) =>
          zoneRecord.id != null
            ? zr.id === zoneRecord.id
            : zr.clientId != null && zr.clientId === zoneRecord.clientId;
        queryClient.setQueryData<WetCheckWithDetails>(key, {
          ...previous,
          zoneRecords: previous.zoneRecords.map((zr) =>
            matches(zr) ? { ...zr, markedCompleteAt: stamp } : zr,
          ),
        });
      }
      return { previous };
    },
    onError: (e: any, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(["/api/wet-checks", wetCheckId], ctx.previous);
      }
      toast({
        title: "Couldn't mark zone complete",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] }),
  });
  const handleMarkZoneComplete = () => {
    if (findingsCount === 0 && !confirmMarkComplete) {
      setConfirmMarkComplete(true);
      return;
    }
    setConfirmMarkComplete(false);
    markCompleteMut.mutate();
    onAdvance();
  };
  // Reset the inline confirm when the tech navigates to a different zone
  // (ZoneScreen is reused across zone numbers, so local state otherwise
  // leaks between visits).
  useEffect(() => {
    setConfirmMarkComplete(false);
  }, [zoneRecord?.id, zoneNumber, letter]);

  return (
    <div className="max-w-2xl mx-auto py-4 space-y-4 px-3 sm:px-4 pb-safe">
      <PropertyContextHeader
        customerName={customerName}
        propertyAddress={propertyAddress}
        controllerLetter={letter}
        zoneNumber={zoneNumber}
      />
      <Button variant="ghost" onClick={onBack}>
        <ChevronLeft className="w-4 h-4 mr-1" /> Back to Zone Grid
      </Button>
      <Card className="overflow-hidden">
        {(() => {
          const tint = tintForControllerLetter(letter);
          const statusLabel =
            zoneRecord?.status === "checked_ok" ? "Ran OK" :
            zoneRecord?.status === "checked_with_issues" ? "Needs Work" :
            zoneRecord?.status === "not_applicable" ? "Skipped" :
            "Not Checked";
          const statusPillCls =
            zoneRecord?.status === "checked_ok" ? "bg-green-100 text-green-900 border-green-300" :
            zoneRecord?.status === "checked_with_issues" ? "bg-red-100 text-red-900 border-red-300" :
            zoneRecord?.status === "not_applicable" ? "bg-gray-100 text-gray-800 border-gray-300" :
            "bg-white text-gray-700 border-gray-300";
          return (
            <div
              className={`${tint.band} border-b-4 ${tint.border} px-4 py-3 sm:py-4`}
              data-testid="zone-identity-band"
              data-controller-letter={letter}
              data-zone-number={zoneNumber}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`${tint.letterBg} ${tint.letterText} rounded-lg px-3 py-2 text-3xl sm:text-4xl font-extrabold leading-none shrink-0 shadow-sm`}
                    aria-label={`Controller ${letter}`}
                    data-testid="zone-identity-controller"
                  >
                    {letter}
                  </div>
                  <div className="min-w-0">
                    <div className={`text-[11px] uppercase tracking-wider font-semibold ${tint.label}`}>
                      Controller {letter} · Zone
                    </div>
                    <div
                      className={`${tint.zoneText} text-4xl sm:text-5xl font-black leading-none tabular-nums`}
                      data-testid="zone-identity-number"
                    >
                      {zoneNumber}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <Badge
                    className={`${statusPillCls} text-xs font-semibold border`}
                    data-testid="zone-identity-status"
                  >
                    {statusLabel}
                  </Badge>
                  {!readOnly && zoneRecord && (
                    <PhotoCaptureButton
                      wetCheckId={wetCheckId}
                      wetCheckClientId={wetCheckClientId}
                      zoneRecordId={zoneRecord.id}
                      zoneRecordClientId={zoneRecord.clientId ?? null}
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })()}
        <CardContent className="space-y-4 pt-4">
          {!readOnly && (
            <>
              <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                <Button
                  variant={zoneRecord?.status === "checked_ok" ? "default" : "outline"}
                  className={`min-h-[48px] px-2 text-xs sm:text-sm ${zoneRecord?.status === "checked_ok" ? "bg-green-600" : ""}`}
                  onClick={() => handleStatusClick("checked_ok")}
                  disabled={setStatus.isPending || reverting}
                  data-testid="btn-zone-yes"
                >
                  <CheckCircle2 className="w-4 h-4 mr-1 shrink-0" />
                  <span className="sm:hidden">OK</span>
                  <span className="hidden sm:inline">Ran OK</span>
                </Button>
                <Button
                  variant={zoneRecord?.status === "checked_with_issues" ? "default" : "outline"}
                  className={`min-h-[48px] px-2 text-xs sm:text-sm ${zoneRecord?.status === "checked_with_issues" ? "bg-red-600" : ""}`}
                  onClick={() => handleStatusClick("checked_with_issues")}
                  disabled={setStatus.isPending || reverting}
                  data-testid="btn-zone-no"
                >
                  <Wrench className="w-4 h-4 mr-1 shrink-0" />
                  <span className="sm:hidden">Issue</span>
                  <span className="hidden sm:inline">Needs Work</span>
                </Button>
                <Button
                  variant={zoneRecord?.status === "not_applicable" ? "default" : "outline"}
                  className={`min-h-[48px] px-2 text-xs sm:text-sm ${zoneRecord?.status === "not_applicable" ? "bg-gray-500" : ""}`}
                  onClick={() => handleStatusClick("not_applicable")}
                  disabled={setStatus.isPending || reverting}
                  data-testid="btn-zone-na"
                >
                  <MinusCircle className="w-4 h-4 mr-1 shrink-0" />
                  <span className="sm:hidden">N/A</span>
                  <span className="hidden sm:inline">Skip / Not Applicable</span>
                </Button>
              </div>
              {(!zoneRecord || zoneRecord.status === "not_checked") && (
                <div className="text-xs text-gray-500" data-testid="needs-work-helper">
                  Tap <span className="font-semibold">Needs Work</span> to add parts, labor, and notes for this zone.
                </div>
              )}
              {zoneRecord?.status === "checked_with_issues" && (
                <div className="space-y-2" data-testid="mark-zone-complete-row">
                  {confirmMarkComplete && (
                    <div
                      className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2"
                      data-testid="mark-zone-complete-confirm"
                    >
                      No work added — mark this zone complete anyway? Tap again to confirm.
                    </div>
                  )}
                  <Button
                    type="button"
                    className="w-full min-h-[48px] bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={handleMarkZoneComplete}
                    disabled={setStatus.isPending}
                    data-testid="btn-mark-zone-complete"
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2 shrink-0" />
                    {confirmMarkComplete ? "Confirm — Mark Zone Complete" : "Mark Zone Complete"}
                  </Button>
                </div>
              )}
            </>
          )}
          {photos.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1" data-testid="zone-photos">
              {photos.map(p => <PhotoThumb key={p.id} photo={p} canDelete={!readOnly} />)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Issue presets — grouped by Quick Fixes / Advanced / Zone Issues */}
      {zoneRecord && !readOnly && zoneRecord.status === "checked_with_issues" && (
        <Card>
          <CardHeader><CardTitle className="text-base">Add work for this zone</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {(["quick_fix", "advanced", "zone_issue"] as const).map(group => {
              const groupItems = issueTypes.filter(i => i.issueGroup === group);
              if (groupItems.length === 0) return null;
              const heading =
                group === "quick_fix" ? "Quick Fixes" :
                group === "advanced" ? "Advanced" : "Zone Issues";
              return (
                <div key={group} data-testid={`preset-group-${group}`}>
                  <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">{heading}</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {groupItems.map(it => (
                      <Button
                        key={it.issueType}
                        variant="outline"
                        size="sm"
                        onClick={() => setFindingSheet({ open: true, mode: "create", issueType: it.issueType })}
                        data-testid={`preset-${it.issueType}`}
                      >
                        {it.displayLabel}
                      </Button>
                    ))}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Existing findings */}
      {zoneRecord && zoneRecord.findings.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Work added to this zone</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {zoneRecord.findings.map(f => (
              <div key={f.id} className="border rounded p-2" data-testid={`finding-${f.id}`}>
                <div className="flex items-start justify-between">
                  <div className="text-sm">
                    <div className="font-medium">{f.issueType.replace(/_/g, " ")}</div>
                    <div className="text-xs text-gray-500">
                      {f.partName ?? "no part"} · qty {f.quantity} · {f.laborHours}h
                      {f.partPrice ? ` · $${f.partPrice}` : ""}
                    </div>
                    {f.notes && <div className="text-xs italic">{f.notes}</div>}
                    {f.resolution === "repaired_in_field" && (
                      <Badge variant="secondary" className="mt-1" data-testid={`finding-complete-badge-${f.id}`}>
                        {autoBillEnabled
                          ? "Wet check work completed in field · auto-bills on submit"
                          : "Wet check work completed in field"}
                      </Badge>
                    )}
                    {/* Task #428 — always-visible tech disposition. Decoupled
                        from WET_CHECK_AUTO_BILL and from `resolution`: this
                        captures intent only, with no billing side-effects.
                        Shown for every editable finding regardless of whether
                        Mark Complete (repaired_in_field) is on. */}
                    {!readOnly && (
                      <div
                        className="mt-2 inline-flex rounded-md border overflow-hidden"
                        role="group"
                        aria-label="Tech disposition"
                        data-testid={`finding-disposition-${f.id}`}
                      >
                        <button
                          type="button"
                          className={`px-2 py-1 text-xs ${
                            f.techDisposition === "completed_in_field"
                              ? "bg-green-600 text-white"
                              : "bg-white text-gray-700 hover:bg-gray-50"
                          }`}
                          onClick={() => dispositionMut.mutate({
                            id: f.id,
                            clientId: f.clientId ?? null,
                            disposition: "completed_in_field",
                          })}
                          disabled={dispositionMut.isPending}
                          data-testid={`finding-disposition-${f.id}-completed`}
                        >
                          Completed in field
                        </button>
                        <button
                          type="button"
                          className={`px-2 py-1 text-xs border-l ${
                            f.techDisposition !== "completed_in_field"
                              ? "bg-amber-500 text-white"
                              : "bg-white text-gray-700 hover:bg-gray-50"
                          }`}
                          onClick={() => dispositionMut.mutate({
                            id: f.id,
                            clientId: f.clientId ?? null,
                            disposition: "needs_review",
                          })}
                          disabled={dispositionMut.isPending}
                          data-testid={`finding-disposition-${f.id}-review`}
                        >
                          Needs manager review
                        </button>
                      </div>
                    )}
                    {readOnly && f.techDisposition && (
                      <Badge
                        variant="outline"
                        className={`mt-1 ${
                          f.techDisposition === "completed_in_field"
                            ? "border-green-300 text-green-700 bg-green-50"
                            : "border-amber-300 text-amber-700 bg-amber-50"
                        }`}
                        data-testid={`finding-disposition-badge-${f.id}`}
                      >
                        {f.techDisposition === "completed_in_field"
                          ? "Completed in field"
                          : "Needs manager review"}
                      </Badge>
                    )}
                  </div>
                  {!readOnly && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 w-9 p-0"
                        onClick={() => setFindingSheet({ open: true, mode: "edit", finding: f })}
                        data-testid={`edit-finding-${f.id}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <PhotoCaptureButton
                        wetCheckId={wetCheckId}
                        wetCheckClientId={wetCheckClientId}
                        zoneRecordId={zoneRecord.id}
                        zoneRecordClientId={zoneRecord.clientId ?? null}
                        findingId={f.id}
                        findingClientId={f.clientId ?? null}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 w-9 p-0"
                        onClick={() => deleteFindingMut.mutate({ id: f.id, clientId: f.clientId ?? null })}
                        data-testid={`delete-finding-${f.id}`}
                      >
                        <Trash2 className="w-4 h-4 text-red-600" />
                      </Button>
                    </div>
                  )}
                </div>
                {(() => {
                  const fp = photos.filter(p => p.findingId === f.id);
                  if (fp.length === 0) return null;
                  return (
                    <div className="flex flex-wrap gap-2 pt-2" data-testid={`finding-photos-${f.id}`}>
                      {fp.map(p => <PhotoThumb key={p.id} photo={p} canDelete={!readOnly} />)}
                    </div>
                  );
                })()}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <FindingSheet
        state={findingSheet}
        onClose={() => setFindingSheet({ open: false })}
        zoneRecordId={zoneRecord?.id ?? null}
        zoneRecordClientId={zoneRecord?.clientId ?? null}
        wetCheckId={wetCheckId}
        wetCheckClientId={wetCheckClientId}
        customerId={customerId}
        photos={photos}
        readOnly={readOnly}
      />

      {/* Task #455 — confirm before reverting Needs Work → Ran OK / Skip
          when the zone has work attached. Cancel = no changes. */}
      <Dialog
        open={pendingRevert !== null}
        onOpenChange={(open) => { if (!open && !reverting) setPendingRevert(null); }}
      >
        <DialogContent data-testid="revert-confirm-dialog">
          <DialogHeader>
            <DialogTitle>Clear work for this zone?</DialogTitle>
            <DialogDescription>
              Switching this zone to{" "}
              <span className="font-semibold">
                {pendingRevert?.targetStatus === "checked_ok" ? "Ran OK" : "Skip / Not Applicable"}
              </span>{" "}
              will remove {findings.length} work item{findings.length === 1 ? "" : "s"}
              {findingPhotos.length > 0
                ? ` and ${findingPhotos.length} photo${findingPhotos.length === 1 ? "" : "s"}`
                : ""}{" "}
              attached to this zone. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingRevert(null)}
              disabled={reverting}
              data-testid="revert-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => { if (pendingRevert) performRevert(pendingRevert.targetStatus); }}
              disabled={reverting}
              data-testid="revert-confirm"
            >
              {reverting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Remove work and switch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Finding sheet (create or edit; with part picker + qty + hours) ──────────

function FindingSheet({
  state,
  onClose,
  zoneRecordId,
  zoneRecordClientId,
  wetCheckId,
  wetCheckClientId,
  customerId,
  photos,
  readOnly,
}: {
  state: FindingSheetState;
  onClose: () => void;
  zoneRecordId: number | null;
  zoneRecordClientId: string | null;
  wetCheckId: number;
  wetCheckClientId: string | null;
  customerId: number;
  photos: WetCheckPhoto[];
  readOnly: boolean;
}) {
  const { toast } = useToast();
  const open = state.open;
  const mode = open ? state.mode : "create";
  const editing = open && state.mode === "edit" ? state.finding : null;
  const issueType = open
    ? (state.mode === "create" ? state.issueType : state.finding.issueType)
    : "";

  const [selectedPart, setSelectedPart] = useState<Part | null>(null);
  const [partFromEdit, setPartFromEdit] = useState<{ id: number | null; name: string | null; price: string | null } | null>(null);
  const [quantity, setQuantity] = useState<string>("1");
  const [laborHours, setLaborHours] = useState<string>("0");
  const [notes, setNotes] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [repairedInField, setRepairedInField] = useState<boolean>(false);
  // Task #464 — labor-only Mark Complete confirmation. Visible only while
  // Mark Complete is on AND no part is selected. Picking a part clears it.
  const [noPartNeeded, setNoPartNeeded] = useState<boolean>(false);
  // Photos picked while creating a finding (before save). Uploaded immediately
  // with findingId=null and linked to the new finding once saveMut succeeds.
  const [pendingPhotos, setPendingPhotos] = useState<WetCheckPhoto[]>([]);

  const { data: configs = [] } = useQuery<IssueTypeConfig[]>({ queryKey: ["/api/wet-checks/issue-types"], queryFn: () => cachedApiRequest(`/api/wet-checks/issue-types`), enabled: open });
  const cfg = configs.find(c => c.issueType === issueType);
  // Slice 3 — flag-gated helper text on the Mark Complete toggle. With
  // auto-bill OFF, we restore the Slice 2 wording so the tech isn't
  // told an auto-bill will happen when none will.
  const { data: autoBillCfg } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/config/wet-check-auto-bill"],
    staleTime: 5 * 60 * 1000,
  });
  const autoBillEnabled = autoBillCfg?.enabled ?? true;

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setSelectedPart(null);
      setPartFromEdit({
        id: editing.partId ?? null,
        name: editing.partName ?? null,
        price: editing.partPrice ?? null,
      });
      setQuantity(String(editing.quantity ?? 1));
      setLaborHours(editing.laborHours ?? "0");
      setNotes(editing.notes ?? "");
      setRepairedInField(editing.resolution === "repaired_in_field");
      setNoPartNeeded(Boolean(editing.noPartNeeded));
    } else {
      setSelectedPart(null);
      setPartFromEdit(null);
      setQuantity("1");
      setLaborHours(cfg?.defaultLaborHours ?? "0");
      setNotes("");
      setRepairedInField(false);
      setNoPartNeeded(false);
      setPendingPhotos([]);
    }
    setSearch("");
  }, [open, editing?.id, cfg?.defaultLaborHours]);

  const { data: partsResp } = useQuery<{ parts: Part[]; recentPartIds: number[] }>({
    queryKey: ["/api/wet-checks/parts/by-issue", issueType, customerId],
    queryFn: () => cachedApiRequest(`/api/wet-checks/parts/by-issue?issueType=${encodeURIComponent(issueType)}&customerId=${customerId}`),
    enabled: open && !!issueType,
  });
  const partsList = partsResp?.parts ?? [];
  const recentSet = useMemo(() => new Set(partsResp?.recentPartIds ?? []), [partsResp?.recentPartIds]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return partsList.filter(p =>
      !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q),
    );
  }, [partsList, search]);

  const recentParts = filtered.filter(p => recentSet.has(p.id)).slice(0, 12);
  const otherParts = filtered.filter(p => !recentSet.has(p.id)).slice(0, 60);

  // Task #464 — picking a part always wins over the labor-only flag, so
  // they can never both be true. Mirrors the server-side guard in
  // updateWetCheckFinding.
  const hasPartSelected = (selectedPart?.id ?? partFromEdit?.id ?? null) != null;
  useEffect(() => {
    if (hasPartSelected && noPartNeeded) setNoPartNeeded(false);
  }, [hasPartSelected, noPartNeeded]);

  type SaveResult = { id: number; clientId: string };
  const saveMut = useMutation<SaveResult, Error, void>({
    mutationFn: async () => {
      const payload = buildFindingSavePayload({
        selectedPart,
        partFromEdit,
        quantity,
        laborHours,
        notes,
        repairedInField,
        noPartNeeded,
      });
      if (mode === "edit" && editing) {
        // Edit path goes through the offline wrapper so the patch is
        // queued + mirror-updated when the tech is offline.
        if (isOfflineQueueEnabled() && editing.clientId) {
          await offlineUpdateFinding(editing.clientId, editing.id, payload);
          return { id: editing.id, clientId: editing.clientId };
        }
        const updated = await apiRequest(`/api/wet-checks/findings/${editing.id}`, "PATCH", payload);
        return { id: updated.id ?? editing.id, clientId: updated.clientId ?? editing.clientId ?? "" };
      }
      const findingClientId = newClientId();
      let createdId: number | null = null;
      // When the offline flag is enabled, always route create through the
      // offline wrapper so dependency-order replay holds even on flaky
      // connections. Photo linking is queued through `photo.link` whose
      // `{{f}}` placeholder resolves once the create drains.
      if (isOfflineQueueEnabled() && zoneRecordClientId) {
        const res = await offlineCreateFinding({
          zoneRecordClientId,
          zoneRecordId: zoneRecordId ?? undefined,
          wetCheckId,
          payload: { ...payload, issueType },
          clientId: findingClientId,
        });
        createdId = res.id ?? null;
        if (pendingPhotos.length > 0) {
          // Task #510 — address each photo by its own clientId so the
          // queued PATCH carries the {{p}} placeholder, not the
          // optimistic negative numeric id. The engine waits for the
          // upload to complete and then dispatches against the real
          // server photo id.
          await Promise.all(
            pendingPhotos
              .filter((p) => p.clientId)
              .map((p) =>
                offlineLinkPhotoToFinding({
                  photoClientId: p.clientId!,
                  photoId: p.id > 0 ? p.id : undefined,
                  findingClientId,
                }),
              ),
          );
        }
      } else {
        const created = await apiRequest(
          `/api/wet-checks/zone-records/${zoneRecordId}/findings`,
          "POST",
          { ...payload, issueType, clientId: findingClientId },
        );
        createdId = created?.id ?? null;
        if (pendingPhotos.length > 0 && createdId != null) {
          if (isOfflineQueueEnabled()) {
            // Photos may have been captured via the offline-photos
            // pipeline (negative id, blob URL, queued upload). Route
            // the link through the engine so it waits for each upload
            // to complete before dispatching the PATCH against the
            // real server id. Seed the finding mirror with the id we
            // just got back so the {{f}} placeholder resolves
            // immediately for queued links.
            const db = await openOfflineDB();
            await putFindingMirror(db, {
              clientId: findingClientId,
              id: createdId,
              zoneRecordClientId:
                zoneRecordClientId ?? `server-zr-${zoneRecordId}`,
              zoneRecordId: zoneRecordId ?? undefined,
              wetCheckId,
              data: { ...payload, id: createdId, clientId: findingClientId, issueType },
              updatedAt: Date.now(),
            });
            await Promise.all(
              pendingPhotos
                .filter((p) => p.clientId)
                .map((p) =>
                  offlineLinkPhotoToFinding({
                    photoClientId: p.clientId!,
                    photoId: p.id > 0 ? p.id : undefined,
                    findingClientId,
                    findingId: createdId,
                  }),
                ),
            );
          } else {
            const results = await Promise.allSettled(
              pendingPhotos.map((p) =>
                apiRequest(`/api/wet-checks/photos/${p.id}`, "PATCH", { findingId: createdId }),
              ),
            );
            const failed = results.filter((r) => r.status === "rejected").length;
            if (failed > 0) {
              toast({
                title: "Some photos didn't attach",
                description: `${failed} photo(s) couldn't be linked to the finding. You can re-add them by editing it.`,
                variant: "destructive",
              });
            }
          }
        }
      }
      return { id: createdId ?? 0, clientId: findingClientId };
    },
    onSuccess: () => {
      toast({ title: mode === "edit" ? "Finding updated" : "Finding added" });
      // Invalidate the prefix so both id-keyed and clientId-keyed detail
      // queries (`["/api/wet-checks", id]` and `["/api/wet-checks", "c", clientId]`)
      // are refreshed. Important for offline-created wet checks that have no
      // server id yet.
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] });
      setPendingPhotos([]);
      onClose();
    },
    onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }),
  });

  const removePendingPhoto = async (photoId: number) => {
    try {
      await apiRequest(`/api/wet-checks/photos/${photoId}`, "DELETE");
      setPendingPhotos(prev => prev.filter(p => p.id !== photoId));
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message, variant: "destructive" });
    }
  };

  const renderPartButton = (p: Part) => {
    const effId = selectedPart?.id ?? partFromEdit?.id ?? null;
    const isSel = effId === p.id;
    return (
      <button
        key={p.id}
        type="button"
        className={`w-full text-left p-2 rounded text-sm ${isSel ? "bg-blue-100" : "hover:bg-gray-100"}`}
        onClick={() => setSelectedPart(p)}
        data-testid={`part-${p.id}`}
      >
        <div className="font-medium">{p.name}</div>
        <div className="text-xs text-gray-500">{p.sku} · ${p.price}</div>
      </button>
    );
  };

  return (
    <Sheet open={open} onOpenChange={(b) => { if (!b) onClose(); }}>
      <SheetContent side="bottom" className="h-[90vh] sm:h-[85vh] overflow-y-auto pb-safe">
        <SheetHeader>
          <SheetTitle>
            {mode === "edit" ? "Edit finding · " : ""}
            {cfg?.displayLabel ?? issueType.replace(/_/g, " ")}
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-4 py-4">
          <div>
            <div className="text-sm font-medium mb-1">Part {cfg?.partCategoryFilter ? `(${cfg.partCategoryFilter})` : ""}</div>
            <Input placeholder="Search parts..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-11 text-base" data-testid="finding-part-search" />
            <div className="max-h-48 sm:max-h-64 overflow-y-auto mt-2 space-y-2 border rounded p-1">
              {filtered.length === 0 && <div className="text-center text-xs text-gray-500 py-4">No parts</div>}
              {recentParts.length > 0 && (
                <div data-testid="parts-recent-section">
                  <div className="text-[10px] uppercase tracking-wide text-gray-500 px-1 pt-1">Recent at this property</div>
                  {recentParts.map(renderPartButton)}
                </div>
              )}
              {otherParts.length > 0 && (
                <div>
                  {recentParts.length > 0 && (
                    <div className="text-[10px] uppercase tracking-wide text-gray-500 px-1 pt-2 border-t mt-1">All parts</div>
                  )}
                  {otherParts.map(renderPartButton)}
                </div>
              )}
            </div>
            {partFromEdit && !selectedPart && partFromEdit.id && (
              <div className="text-xs text-gray-500 mt-1">Currently: {partFromEdit.name}</div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-sm font-medium mb-1">Quantity</div>
              <Input type="number" inputMode="numeric" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} className="h-11 text-base" data-testid="finding-qty" />
            </div>
            <div>
              <div className="text-sm font-medium mb-1">Labor hours</div>
              <Input type="number" inputMode="decimal" step="0.05" min={0} value={laborHours} onChange={(e) => setLaborHours(e.target.value)} className="h-11 text-base" data-testid="finding-hours" />
            </div>
          </div>

          <div>
            <div className="text-sm font-medium mb-1">Notes</div>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="text-base" data-testid="finding-notes" />
          </div>

          {editing ? (
            <div data-testid="finding-sheet-photos">
              <div className="flex items-center justify-between mb-1">
                <div className="text-sm font-medium">Photos</div>
                {!readOnly && (
                  <PhotoCaptureButton
                    wetCheckId={wetCheckId}
                    wetCheckClientId={wetCheckClientId}
                    zoneRecordId={zoneRecordId}
                    zoneRecordClientId={zoneRecordClientId}
                    findingId={editing.id}
                    findingClientId={editing.clientId ?? null}
                  />
                )}
              </div>
              {(() => {
                const fp = photos.filter(p => p.findingId === editing.id);
                if (fp.length === 0) {
                  return <div className="text-xs text-gray-500">No photos yet.</div>;
                }
                return (
                  <div className="flex flex-wrap gap-2">
                    {fp.map(p => (
                      <PhotoThumb
                        key={p.id}
                        photo={p}
                        canDelete={!readOnly}
                      />
                    ))}
                  </div>
                );
              })()}
            </div>
          ) : (
            !readOnly && (
              <div data-testid="finding-sheet-photos">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-sm font-medium">Photos</div>
                  {(zoneRecordId || (isOfflineQueueEnabled() && zoneRecordClientId)) && (
                    <PhotoCaptureButton
                      wetCheckId={wetCheckId}
                      wetCheckClientId={wetCheckClientId}
                      zoneRecordId={zoneRecordId}
                      zoneRecordClientId={zoneRecordClientId}
                      findingId={null}
                      findingClientId={null}
                      skipInvalidate
                      testIdSuffix="pending"
                      onUploaded={(photo) => setPendingPhotos(prev => [...prev, photo])}
                    />
                  )}
                </div>
                {pendingPhotos.length === 0 ? (
                  <div className="text-xs text-gray-500">
                    {(zoneRecordId || (isOfflineQueueEnabled() && zoneRecordClientId))
                      ? "No photos yet. Photos picked here attach automatically when you save."
                      : "Pick a zone before adding photos."}
                  </div>
                ) : (
                  <PendingPhotosGrid
                    pendingPhotos={pendingPhotos}
                    onRemove={removePendingPhoto}
                  />
                )}
              </div>
            )
          )}

          <label className="flex items-start gap-2 text-sm" data-testid="finding-repaired-toggle">
            <input
              type="checkbox"
              checked={repairedInField}
              onChange={(e) => setRepairedInField(e.target.checked)}
              className="h-4 w-4 mt-0.5"
            />
            <span>
              <span className="font-medium">Mark complete — wet check work completed in field</span>
              <span className="block text-xs text-gray-500">
                {autoBillEnabled
                  ? "Will auto-bill on submit. Leave unchecked to send to the manager for routing."
                  : "Marks this finding as wet check work completed in the field. Leave unchecked to send to the manager for routing."}
              </span>
            </span>
          </label>

          {/* Task #464 — labor-only confirmation. Only meaningful while
              the finding is being marked complete with no part chosen
              (e.g. clearing a clogged nozzle, tightening a fitting).
              Picking a part automatically clears this. */}
          {repairedInField && !hasPartSelected && (
            <label
              className="flex items-start gap-2 text-sm rounded border border-amber-200 bg-amber-50 p-2"
              data-testid="finding-no-part-needed-toggle"
            >
              <input
                type="checkbox"
                checked={noPartNeeded}
                onChange={(e) => setNoPartNeeded(e.target.checked)}
                className="h-4 w-4 mt-0.5"
                data-testid="finding-no-part-needed-checkbox"
              />
              <span>
                <span className="font-medium">No part needed (labor only)</span>
                <span className="block text-xs text-gray-700">
                  Confirm this is a labor-only fix — the billing line will be labor only with no part charge.
                </span>
              </span>
            </label>
          )}

          <Button
            className="w-full min-h-[48px]"
            size="lg"
            disabled={saveMut.isPending || (mode === "create" && !zoneRecordId && !(isOfflineQueueEnabled() && zoneRecordClientId))}
            onClick={() => saveMut.mutate()}
            data-testid="finding-save"
          >
            {saveMut.isPending
              ? <Loader2 className="animate-spin" />
              : mode === "edit" ? "Save Changes" : "Save Finding"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Page entry ───────────────────────────────────────────────────────────────

export default function WetChecksPage() {
  const [matchByClientId, clientIdParams] = useRoute<{ clientId: string }>("/wet-checks/c/:clientId");
  const [matchDetail, params] = useRoute<{ id: string }>("/wet-checks/:id");
  if (matchByClientId) return <WetCheckDetail clientId={clientIdParams!.clientId} />;
  if (matchDetail) return <WetCheckDetail id={parseInt(params!.id)} />;
  return <WetCheckList />;
}
