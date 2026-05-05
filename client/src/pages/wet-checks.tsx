import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { safeGet } from "@/utils/safeStorage";
import { Loader2, ChevronLeft, Search, CheckCircle2, XCircle, MinusCircle, Trash2, Camera, Pencil } from "lucide-react";
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
} from "@shared/schema";

// UUIDv4 strict — server validators (z.string().uuid()) reject anything else,
// so the fallback path also emits a v4-shaped string when crypto.randomUUID
// is unavailable (older Safari, insecure contexts).
const newClientId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(bytes);
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

// ─── Direct-to-storage photo upload (sign → PUT → finalize) ───────────────────
async function uploadPhotoToStorage(file: File): Promise<string> {
  const signRes = await fetch(`/api/upload/photo?originalName=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: getAuthHeaders(),
    credentials: "include",
  });
  if (!signRes.ok) throw new Error(`Failed to get upload URL (${signRes.status})`);
  const { signedUrl, url } = await signRes.json();

  const putRes = await fetch(signedUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
  if (!putRes.ok) throw new Error(`Upload to storage failed (${putRes.status})`);

  await fetch("/api/upload/photo/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    credentials: "include",
    body: JSON.stringify({ photoId: url }),
  });
  return url as string;
}

// Compact photo capture button. Wraps a file input with camera capture and
// posts the resulting URL to /api/wet-checks/:id/photos with a client-side
// takenAt so true camera time survives offline-then-sync.
function PhotoCaptureButton({
  wetCheckId,
  zoneRecordId,
  findingId,
  onUploaded,
  skipInvalidate,
  testIdSuffix,
}: {
  wetCheckId: number;
  zoneRecordId?: number | null;
  findingId?: number | null;
  onUploaded?: (photo: WetCheckPhoto) => void;
  skipInvalidate?: boolean;
  testIdSuffix?: string;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
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
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPick}
        data-testid={`photo-input-${suffix}`}
      />
      <Button
        size="sm"
        variant="outline"
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        data-testid={`btn-photo-${suffix}`}
      >
        {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Camera className="w-4 h-4 mr-1" />}
        Photo
      </Button>
    </>
  );
}

function PhotoThumb({ photo, canDelete }: { photo: WetCheckPhoto; canDelete: boolean }) {
  const { toast } = useToast();
  // The photoId is stored as "photos/<uuid>"; the public read endpoint serves it.
  const src = `/api/photos/${encodeURIComponent(photo.url)}`;
  const delMut = useMutation({
    mutationFn: () => apiRequest(`/api/wet-checks/photos/${photo.id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks", photo.wetCheckId] });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e?.message, variant: "destructive" }),
  });
  return (
    <div className="relative inline-block w-20 h-20 rounded overflow-hidden border" data-testid={`photo-thumb-${photo.id}`}>
      <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" />
      {canDelete && (
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
      apiRequest("/api/wet-checks", "POST", {
        customerId: input.customerId,
        clientId: newClientId(),
      }),
    onSuccess: (wc: WetCheck) => {
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] });
      navigate(`/wet-checks/${wc.id}`);
    },
    onError: (e: any) => toast({ title: "Failed", description: e?.message ?? "Could not start wet check", variant: "destructive" }),
  });

  return (
    <div className="max-w-3xl mx-auto py-4 space-y-4">
      <h1 className="text-2xl font-bold">Wet Checks</h1>

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
              className="pl-10"
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

function WetCheckDetail({ id }: { id: number }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [activeLetter, setActiveLetter] = useState<string | null>(null);
  const [activeZone, setActiveZone] = useState<number | null>(null);

  const { data: wc, isLoading } = useQuery<WetCheckWithDetails>({
    queryKey: ["/api/wet-checks", id],
    queryFn: () => apiRequest(`/api/wet-checks/${id}`),
  });

  const { data: controllers = [] } = useQuery<PropertyController[]>({
    queryKey: ["/api/properties", wc?.customerId, "controllers"],
    queryFn: () => apiRequest(`/api/properties/${wc!.customerId}/controllers`),
    enabled: !!wc?.customerId,
  });

  const submitMut = useMutation({
    mutationFn: () => apiRequest(`/api/wet-checks/${id}/submit`, "POST", {}),
    onSuccess: () => {
      toast({ title: "Submitted", description: "Wet check sent for manager review." });
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks", id] });
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
      <ZoneScreen
        wetCheckId={id}
        customerId={wc.customerId}
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
      <div className="max-w-3xl mx-auto py-4 space-y-3">
        <Button variant="ghost" onClick={() => setActiveLetter(null)} data-testid="btn-back">
          <ChevronLeft className="w-4 h-4 mr-1" /> Back to Controllers
        </Button>
        <ControllerHeader controller={ctrl} customerId={wc.customerId} readOnly={isReadOnly} />
        <div className="grid grid-cols-10 gap-1">
          {Array.from({ length: ctrl?.zoneCount ?? 100 }, (_, i) => i + 1).map(n => {
            const r = recordsByZone.get(n);
            const cls = r?.status === "checked_ok"
              ? "bg-green-500 text-white"
              : r?.status === "checked_with_issues"
              ? "bg-red-500 text-white"
              : r?.status === "not_applicable"
              ? "bg-gray-400 text-white"
              : "bg-white border border-gray-300";
            return (
              <button
                key={n}
                onClick={() => setActiveZone(n)}
                className={`aspect-square text-xs rounded ${cls}`}
                data-testid={`zone-${activeLetter}-${n}`}
              >
                {n}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Top-level: controllers grid + wet-check level photos
  const wetCheckLevelPhotos = wc.photos.filter(p => !p.zoneRecordId && !p.findingId);
  return (
    <div className="max-w-3xl mx-auto py-4 space-y-4">
      <Button variant="ghost" onClick={() => navigate("/wet-checks")}>
        <ChevronLeft className="w-4 h-4 mr-1" /> All Wet Checks
      </Button>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <CardTitle>{wc.customerName}</CardTitle>
            {!isReadOnly && (
              <PhotoCaptureButton wetCheckId={id} />
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
      <div className="grid grid-cols-2 gap-3">
        {controllers.map(c => {
          const recs = zonesByLetter(c.controllerLetter);
          const ok = recs.filter(r => r.status === "checked_ok").length;
          const issues = recs.filter(r => r.status === "checked_with_issues").length;
          const na = recs.filter(r => r.status === "not_applicable").length;
          return (
            <Card
              key={c.controllerLetter}
              className="cursor-pointer hover:bg-blue-50"
              onClick={() => setActiveLetter(c.controllerLetter)}
              data-testid={`controller-${c.controllerLetter}`}
            >
              <CardContent className="py-4">
                <div className="text-2xl font-bold">Controller {c.controllerLetter}</div>
                <div className="text-xs text-gray-600">{c.zoneCount} zones</div>
                <div className="mt-2 text-xs flex gap-3">
                  <span className="text-green-700">✓ {ok}</span>
                  <span className="text-red-700">! {issues}</span>
                  <span className="text-gray-500">N/A {na}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {!isReadOnly && (
        <Button
          className="w-full"
          size="lg"
          onClick={() => submitMut.mutate()}
          disabled={submitMut.isPending}
          data-testid="btn-submit-wet-check"
        >
          {submitMut.isPending ? <Loader2 className="animate-spin" /> : "Submit for Review"}
        </Button>
      )}
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
            min={1}
            max={100}
            value={zc}
            onChange={(e) => setZc(e.target.value)}
            className="w-20"
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

function ZoneScreen({
  wetCheckId,
  customerId,
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
  customerId: number;
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

  const setStatus = useMutation({
    mutationFn: (status: "checked_ok" | "checked_with_issues" | "not_applicable") =>
      apiRequest(`/api/wet-checks/${wetCheckId}/zone-records`, "POST", {
        controllerLetter: letter,
        zoneNumber,
        status,
        ranSuccessfully: status === "checked_ok" ? true : status === "checked_with_issues" ? false : null,
        // Client-supplied capture timestamp — survives offline-then-sync.
        checkedAt: new Date().toISOString(),
        clientId: zoneRecord?.clientId ?? newClientId(),
      }),
    onSuccess: (_data, status) => {
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks", wetCheckId] });
      // Auto-advance to the next zone unless the tech needs to add findings.
      if (status === "checked_ok" || status === "not_applicable") {
        setTimeout(() => onAdvance(), 250);
      }
    },
    onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }),
  });

  const { data: issueTypes = [] } = useQuery<IssueTypeConfig[]>({
    queryKey: ["/api/wet-checks/issue-types"],
  });

  const deleteFindingMut = useMutation({
    mutationFn: (findingId: number) => apiRequest(`/api/wet-checks/findings/${findingId}`, "DELETE"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/wet-checks", wetCheckId] }),
  });

  return (
    <div className="max-w-2xl mx-auto py-4 space-y-4">
      <Button variant="ghost" onClick={onBack}>
        <ChevronLeft className="w-4 h-4 mr-1" /> Back to Zone Grid
      </Button>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Controller {letter} · Zone {zoneNumber}</CardTitle>
            {!readOnly && zoneRecord && (
              <PhotoCaptureButton wetCheckId={wetCheckId} zoneRecordId={zoneRecord.id} />
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>Status: <Badge>{zoneRecord?.status ?? "not_checked"}</Badge></div>
          {!readOnly && (
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant={zoneRecord?.status === "checked_ok" ? "default" : "outline"}
                className={zoneRecord?.status === "checked_ok" ? "bg-green-600" : ""}
                onClick={() => setStatus.mutate("checked_ok")}
                disabled={setStatus.isPending}
                data-testid="btn-zone-yes"
              >
                <CheckCircle2 className="w-4 h-4 mr-1" /> YES
              </Button>
              <Button
                variant={zoneRecord?.status === "checked_with_issues" ? "default" : "outline"}
                className={zoneRecord?.status === "checked_with_issues" ? "bg-red-600" : ""}
                onClick={() => setStatus.mutate("checked_with_issues")}
                disabled={setStatus.isPending}
                data-testid="btn-zone-no"
              >
                <XCircle className="w-4 h-4 mr-1" /> NO
              </Button>
              <Button
                variant={zoneRecord?.status === "not_applicable" ? "default" : "outline"}
                className={zoneRecord?.status === "not_applicable" ? "bg-gray-500" : ""}
                onClick={() => setStatus.mutate("not_applicable")}
                disabled={setStatus.isPending}
                data-testid="btn-zone-na"
              >
                <MinusCircle className="w-4 h-4 mr-1" /> N/A
              </Button>
            </div>
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
          <CardHeader><CardTitle className="text-base">Add a finding</CardTitle></CardHeader>
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
          <CardHeader><CardTitle className="text-base">Findings on this zone</CardTitle></CardHeader>
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
                      <Badge variant="secondary" className="mt-1">Repaired in field</Badge>
                    )}
                  </div>
                  {!readOnly && f.resolution === "pending" && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setFindingSheet({ open: true, mode: "edit", finding: f })}
                        data-testid={`edit-finding-${f.id}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <PhotoCaptureButton wetCheckId={wetCheckId} zoneRecordId={zoneRecord.id} findingId={f.id} />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteFindingMut.mutate(f.id)}
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
        wetCheckId={wetCheckId}
        customerId={customerId}
        photos={photos}
        readOnly={readOnly}
      />
    </div>
  );
}

// ─── Finding sheet (create or edit; with part picker + qty + hours) ──────────

function FindingSheet({
  state,
  onClose,
  zoneRecordId,
  wetCheckId,
  customerId,
  photos,
  readOnly,
}: {
  state: FindingSheetState;
  onClose: () => void;
  zoneRecordId: number | null;
  wetCheckId: number;
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
  // Photos picked while creating a finding (before save). Uploaded immediately
  // with findingId=null and linked to the new finding once saveMut succeeds.
  const [pendingPhotos, setPendingPhotos] = useState<WetCheckPhoto[]>([]);

  const { data: configs = [] } = useQuery<IssueTypeConfig[]>({ queryKey: ["/api/wet-checks/issue-types"], enabled: open });
  const cfg = configs.find(c => c.issueType === issueType);

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
    } else {
      setSelectedPart(null);
      setPartFromEdit(null);
      setQuantity("1");
      setLaborHours(cfg?.defaultLaborHours ?? "0");
      setNotes("");
      setRepairedInField(false);
      setPendingPhotos([]);
    }
    setSearch("");
  }, [open, editing?.id, cfg?.defaultLaborHours]);

  const { data: partsResp } = useQuery<{ parts: Part[]; recentPartIds: number[] }>({
    queryKey: ["/api/wet-checks/parts/by-issue", issueType, customerId],
    queryFn: () => apiRequest(`/api/wet-checks/parts/by-issue?issueType=${encodeURIComponent(issueType)}&customerId=${customerId}`),
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

  const effectivePart = (): { id: number | null; name: string | null; price: string | null } => {
    if (selectedPart) return { id: selectedPart.id, name: selectedPart.name, price: selectedPart.price };
    if (partFromEdit) return partFromEdit;
    return { id: null, name: null, price: null };
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const p = effectivePart();
      const payload = {
        partId: p.id,
        partName: p.name,
        partPrice: p.price,
        quantity: Math.max(1, parseInt(quantity) || 1),
        laborHours: laborHours || "0",
        notes: notes || null,
        repairedInField,
      };
      if (mode === "edit" && editing) {
        return apiRequest(`/api/wet-checks/findings/${editing.id}`, "PATCH", payload);
      }
      const created: WetCheckFinding = await apiRequest(
        `/api/wet-checks/zone-records/${zoneRecordId}/findings`,
        "POST",
        { ...payload, issueType, clientId: newClientId() },
      );
      // Link any photos the tech queued before saving. We attempt all in
      // parallel and surface a soft warning if any fail — the finding has
      // already been saved either way.
      if (pendingPhotos.length > 0) {
        const results = await Promise.allSettled(
          pendingPhotos.map(p =>
            apiRequest(`/api/wet-checks/photos/${p.id}`, "PATCH", { findingId: created.id }),
          ),
        );
        const failed = results.filter(r => r.status === "rejected").length;
        if (failed > 0) {
          toast({
            title: "Some photos didn't attach",
            description: `${failed} photo(s) couldn't be linked to the finding. You can re-add them by editing it.`,
            variant: "destructive",
          });
        }
      }
      return created;
    },
    onSuccess: () => {
      toast({ title: mode === "edit" ? "Finding updated" : "Finding added" });
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks", wetCheckId] });
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
    const eff = effectivePart();
    const isSel = (selectedPart?.id ?? eff.id) === p.id;
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
      <SheetContent side="bottom" className="h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {mode === "edit" ? "Edit finding · " : ""}
            {cfg?.displayLabel ?? issueType.replace(/_/g, " ")}
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-4 py-4">
          <div>
            <div className="text-sm font-medium mb-1">Part {cfg?.partCategoryFilter ? `(${cfg.partCategoryFilter})` : ""}</div>
            <Input placeholder="Search parts..." value={search} onChange={(e) => setSearch(e.target.value)} data-testid="finding-part-search" />
            <div className="max-h-64 overflow-y-auto mt-2 space-y-2 border rounded p-1">
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
              <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} data-testid="finding-qty" />
            </div>
            <div>
              <div className="text-sm font-medium mb-1">Labor hours</div>
              <Input type="number" step="0.05" min={0} value={laborHours} onChange={(e) => setLaborHours(e.target.value)} data-testid="finding-hours" />
            </div>
          </div>

          <div>
            <div className="text-sm font-medium mb-1">Notes</div>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} data-testid="finding-notes" />
          </div>

          {editing ? (
            <div data-testid="finding-sheet-photos">
              <div className="flex items-center justify-between mb-1">
                <div className="text-sm font-medium">Photos</div>
                {!readOnly && editing.resolution === "pending" && (
                  <PhotoCaptureButton
                    wetCheckId={wetCheckId}
                    zoneRecordId={zoneRecordId}
                    findingId={editing.id}
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
                        canDelete={!readOnly && editing.resolution === "pending"}
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
                  {zoneRecordId && (
                    <PhotoCaptureButton
                      wetCheckId={wetCheckId}
                      zoneRecordId={null}
                      findingId={null}
                      skipInvalidate
                      testIdSuffix="pending"
                      onUploaded={(photo) => setPendingPhotos(prev => [...prev, photo])}
                    />
                  )}
                </div>
                {pendingPhotos.length === 0 ? (
                  <div className="text-xs text-gray-500">
                    {zoneRecordId
                      ? "No photos yet. Photos picked here attach automatically when you save."
                      : "Pick a zone before adding photos."}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2" data-testid="pending-photos">
                    {pendingPhotos.map(p => (
                      <div
                        key={p.id}
                        className="relative inline-block w-20 h-20 rounded overflow-hidden border"
                        data-testid={`pending-photo-${p.id}`}
                      >
                        <img
                          src={`/api/photos/${encodeURIComponent(p.url)}`}
                          alt=""
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                        <button
                          type="button"
                          onClick={() => removePendingPhoto(p.id)}
                          className="absolute top-0 right-0 bg-black/60 text-white p-0.5 rounded-bl"
                          aria-label="Remove queued photo"
                          data-testid={`remove-pending-photo-${p.id}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          )}

          <label className="flex items-center gap-2 text-sm" data-testid="finding-repaired-toggle">
            <input
              type="checkbox"
              checked={repairedInField}
              onChange={(e) => setRepairedInField(e.target.checked)}
              className="h-4 w-4"
            />
            Repaired in field — no follow-up needed
          </label>

          <Button
            className="w-full"
            size="lg"
            disabled={saveMut.isPending || (mode === "create" && !zoneRecordId)}
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
  const [matchDetail, params] = useRoute<{ id: string }>("/wet-checks/:id");
  if (matchDetail) return <WetCheckDetail id={parseInt(params!.id)} />;
  return <WetCheckList />;
}
