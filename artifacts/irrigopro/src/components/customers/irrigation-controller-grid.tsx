import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Camera,
  ImageIcon,
  History,
  AlertTriangle,
  Loader2,
  Trash2,
  Save,
  X,
  Eye,
  Clock,
  ArrowLeft,
  Minus,
  Cpu,
  Check,
  AlertCircle,
} from "lucide-react";
import type {
  IrrigationController,
  IrrigationProgram,
  IrrigationProfileZone,
  IrrigationProfileHistory,
} from "@workspace/db/schema";
import {
  computeRunSchedule,
  isPlaceholderZone,
  minutesToTime,
  type ScheduleInputProgram,
  type ScheduleInputZone,
  type ProgramSchedule,
} from "@workspace/shared";
import { uploadPhotoToStorage } from "@/pages/wet-checks/helpers";
import { apiRequest, parseApiError } from "@/lib/queryClient";

// ── Constants ────────────────────────────────────────────────────────────────

const MIN_ZONES = 1;
const MAX_ZONES = 100;

// ── Types ────────────────────────────────────────────────────────────────────

export type ZoneSummary = Pick<IrrigationProfileZone, "id" | "zoneNumber" | "name" | "zoneType" | "isActive"> & { setUp: boolean };
export type ControllerWithZones = IrrigationController & { zones: ZoneSummary[]; retiredZoneCount: number };
type ZoneFocus = { id: number; token: number };
type ControllerWithDetail = IrrigationController & {
  programs: IrrigationProgram[];
  zones: IrrigationProfileZone[];
  retiredZones: IrrigationProfileZone[];
};

type HistoryEntry = IrrigationProfileHistory & {
  snapshotJson: {
    controller: IrrigationController;
    programs: IrrigationProgram[];
    zones: IrrigationProfileZone[];
  };
};

const ZONE_TYPES = [
  { value: "pop_up_spray", label: "Pop-up Spray" },
  { value: "rotor", label: "Rotor" },
  { value: "drip", label: "Drip" },
  { value: "netafim", label: "Netafim" },
  { value: "bubbler", label: "Bubbler" },
  { value: "other", label: "Other" },
];

const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDateTime(val: string | Date | null | undefined): string {
  if (!val) return "—";
  const d = new Date(val as string);
  if (isNaN(d.getTime())) return String(val);
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
    " " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  );
}

function zoneTypeLabel(t: string): string {
  return ZONE_TYPES.find((z) => z.value === t)?.label ?? t;
}

function setupWording(count: number, setUp: number, heading = false): string {
  if (!count) return heading ? "Zones (0)" : "No zones yet — use + to add";
  return `${heading ? `Zones (${count})` : `${count} ${count === 1 ? "zone" : "zones"}`} · ${setUp === count ? "all set up" : `${setUp} set up`}`;
}

// ── Day pill selector ────────────────────────────────────────────────────────

function DayPillSelector({
  value,
  onChange,
}: {
  value: string[];
  onChange: (days: string[]) => void;
}) {
  const toggle = (day: string) => {
    onChange(value.includes(day) ? value.filter((d) => d !== day) : [...value, day]);
  };
  return (
    <div className="flex flex-wrap gap-1">
      {DAYS_OF_WEEK.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => toggle(d)}
          className={`text-xs px-2 py-1 rounded-full border transition-colors ${
            value.includes(d)
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
          }`}
        >
          {d}
        </button>
      ))}
    </div>
  );
}

// ── Start times multi-input ──────────────────────────────────────────────────

function StartTimesInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (times: string[]) => void;
}) {
  const add = () => onChange([...value, "06:00"]);
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const update = (i: number, v: string) => {
    const copy = [...value];
    copy[i] = v;
    onChange(copy);
  };
  return (
    <div className="space-y-1">
      {value.map((t, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="time"
            value={t}
            onChange={(e) => update(i, e.target.value)}
            className="text-sm border rounded px-2 py-1 w-28"
          />
          {value.length > 1 && (
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-gray-400 hover:text-red-500"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="text-xs text-blue-600 hover:underline flex items-center gap-1"
      >
        <Plus className="w-3 h-3" /> Add start time
      </button>
    </div>
  );
}

// ── Run-schedule panel ───────────────────────────────────────────────────────

function RunSchedulePanel({
  programs,
  zones,
}: {
  programs: IrrigationProgram[];
  zones: IrrigationProfileZone[];
}) {
  const schedulePrograms: ScheduleInputProgram[] = programs.map((p) => ({
    id: p.id,
    name: p.name,
    wateringDays: p.wateringDays,
    startTimes: p.startTimes,
    seasonalAdjustPct: p.seasonalAdjustPct,
    isActive: p.isActive,
    sortOrder: p.sortOrder,
  }));

  const scheduleZones: ScheduleInputZone[] = zones.map((z) => ({
    id: z.id,
    programId: z.programId,
    zoneNumber: z.zoneNumber,
    name: z.name,
    zoneType: z.zoneType,
    runTimeMinutes: z.runTimeMinutes,
    zoneOrder: z.zoneOrder,
    isActive: z.isActive,
    overrideStartTime: z.overrideStartTime,
    overrideDays: z.overrideDays,
  }));

  const schedule: ProgramSchedule[] = useMemo(
    () => computeRunSchedule(schedulePrograms, scheduleZones),
    [schedulePrograms, scheduleZones],
  );

  if (schedule.length === 0) {
    return (
      <div className="text-sm text-gray-500 italic">
        No active programs with zones assigned. Add programs and zones to see the run schedule.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {schedule.map((ps, pi) => (
        <div key={`${ps.programId}-${ps.startTime}-${pi}`}>
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-blue-500" />
            <span className="font-medium text-sm">
              Program {ps.programName} — Start {ps.startTime}
            </span>
            {ps.wateringDays.length > 0 && (
              <span className="text-xs text-gray-500">
                ({ps.wateringDays.join(", ")})
              </span>
            )}
          </div>
          {ps.entries.length === 0 ? (
            <p className="text-xs text-gray-400 ml-6">No active zones in this program.</p>
          ) : (
            <div className="ml-6 overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left px-2 py-1 border border-gray-200 font-medium text-gray-600">Zone #</th>
                    <th className="text-left px-2 py-1 border border-gray-200 font-medium text-gray-600">Name</th>
                    <th className="text-left px-2 py-1 border border-gray-200 font-medium text-gray-600">Type</th>
                    <th className="text-right px-2 py-1 border border-gray-200 font-medium text-gray-600">Start</th>
                    <th className="text-right px-2 py-1 border border-gray-200 font-medium text-gray-600">End</th>
                    <th className="text-right px-2 py-1 border border-gray-200 font-medium text-gray-600">Runtime</th>
                    <th className="text-center px-2 py-1 border border-gray-200 font-medium text-gray-600">Override</th>
                  </tr>
                </thead>
                <tbody>
                  {ps.entries.map((entry) => (
                    <tr key={entry.zoneId} className={entry.isOverride ? "bg-amber-50" : "bg-white"}>
                      <td className="px-2 py-1 border border-gray-200">{entry.zoneNumber}</td>
                      <td className="px-2 py-1 border border-gray-200">{entry.zoneName}</td>
                      <td className="px-2 py-1 border border-gray-200 text-gray-500">
                        {zoneTypeLabel(entry.zoneType)}
                      </td>
                      <td className="px-2 py-1 border border-gray-200 text-right font-mono">
                        {minutesToTime(entry.expectedStartMinutes)}
                      </td>
                      <td className="px-2 py-1 border border-gray-200 text-right font-mono">
                        {minutesToTime(entry.expectedEndMinutes)}
                      </td>
                      <td className="px-2 py-1 border border-gray-200 text-right">
                        {entry.adjustedRunTimeMinutes} min
                      </td>
                      <td className="px-2 py-1 border border-gray-200 text-center">
                        {entry.isOverride ? (
                          <span className="text-amber-600 font-medium">Override</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── History drawer ───────────────────────────────────────────────────────────

function HistoryDrawer({ controllerId }: { controllerId: number }) {
  const [open, setOpen] = useState(false);
  const [snapshotEntry, setSnapshotEntry] = useState<HistoryEntry | null>(null);

  const { data: history = [], isLoading } = useQuery<HistoryEntry[]>({
    queryKey: [`/api/irrigation-controllers/${controllerId}/history`],
    enabled: open,
  });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <History className="w-4 h-4" />
          View History
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Change History</SheetTitle>
        </SheetHeader>
        {snapshotEntry ? (
          <div className="mt-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSnapshotEntry(null)}
              className="mb-4"
            >
              <ArrowLeft className="w-4 h-4 mr-1" /> Back to history
            </Button>
            <div className="text-xs text-gray-500 mb-3">
              Snapshot from {fmtDateTime(snapshotEntry.changedAt)} by{" "}
              {snapshotEntry.changedByName ?? "Unknown"}
            </div>
            <SnapshotView
              controller={snapshotEntry.snapshotJson.controller}
              programs={snapshotEntry.snapshotJson.programs ?? []}
              zones={snapshotEntry.snapshotJson.zones ?? []}
            />
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {isLoading && (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            )}
            {!isLoading && history.length === 0 && (
              <p className="text-sm text-gray-500">No history recorded yet.</p>
            )}
            {history.map((entry) => (
              <div key={entry.id} className="border rounded-lg p-3 bg-gray-50 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800">
                      {entry.changedByName ?? "Unknown"}
                    </p>
                    <p className="text-xs text-gray-500">{fmtDateTime(entry.changedAt)}</p>
                    {entry.summary && (
                      <p className="text-xs text-gray-600 mt-1">{entry.summary}</p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 text-xs gap-1"
                    onClick={() => setSnapshotEntry(entry)}
                  >
                    <Eye className="w-3 h-3" />
                    View snapshot
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Snapshot read-only view ──────────────────────────────────────────────────

function SnapshotView({
  controller,
  programs,
  zones,
}: {
  controller: IrrigationController;
  programs: IrrigationProgram[];
  zones: IrrigationProfileZone[];
}) {
  return (
    <div className="space-y-4 text-sm">
      <div className="border rounded-lg p-3 bg-white space-y-2">
        <p className="font-semibold">{controller.name}</p>
        {controller.location && <p className="text-gray-600">📍 {controller.location}</p>}
        {controller.brand && <p className="text-gray-600">Brand: {controller.brand}</p>}
        {controller.model && <p className="text-gray-600">Model: {controller.model}</p>}
        {!controller.isActive && (
          <Badge className="bg-amber-100 text-amber-800 border-amber-200">Inactive</Badge>
        )}
      </div>
      {programs.map((prog) => {
        const progZones = zones.filter((z) => z.programId === prog.id);
        return (
          <div key={prog.id} className="border rounded-lg p-3 bg-white space-y-2">
            <div className="flex items-center gap-2">
              <p className="font-medium">Program {prog.name}</p>
              {!prog.isActive && (
                <Badge variant="outline" className="text-xs">Inactive</Badge>
              )}
            </div>
            {(prog.wateringDays ?? []).length > 0 && (
              <p className="text-xs text-gray-500">
                Days: {(prog.wateringDays ?? []).join(", ")}
              </p>
            )}
            {(prog.startTimes ?? []).length > 0 && (
              <p className="text-xs text-gray-500">
                Start: {(prog.startTimes ?? []).join(", ")}
              </p>
            )}
            <p className="text-xs text-gray-500">Seasonal: {prog.seasonalAdjustPct}%</p>
            {progZones.length > 0 && (
              <table className="w-full text-xs border-collapse mt-2">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left px-2 py-1 border border-gray-200">#</th>
                    <th className="text-left px-2 py-1 border border-gray-200">Name</th>
                    <th className="text-right px-2 py-1 border border-gray-200">Runtime</th>
                  </tr>
                </thead>
                <tbody>
                  {progZones
                    .sort((a, b) => a.zoneOrder - b.zoneOrder)
                    .map((z) => (
                      <tr key={z.id}>
                        <td className="px-2 py-1 border border-gray-200">{z.zoneNumber}</td>
                        <td className="px-2 py-1 border border-gray-200">{z.name}</td>
                        <td className="px-2 py-1 border border-gray-200 text-right">
                          {z.runTimeMinutes} min
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Settings photo section ───────────────────────────────────────────────────

function SettingsPhoto({
  controller,
  onUploaded,
  canUploadPhoto,
}: {
  controller: ControllerWithDetail;
  onUploaded: (url: string) => void;
  canUploadPhoto: boolean;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setBusy(true);
    try {
      const url = await uploadPhotoToStorage(file);
      await apiRequest(`/api/irrigation-controllers/${controller.id}/photo`, "POST", { url });
      queryClient.invalidateQueries({
        queryKey: [`/api/irrigation-controllers/${controller.id}`],
      });
      onUploaded(url);
      toast({ title: "Photo saved" });
    } catch (err: any) {
      toast({
        title: "Photo upload failed",
        description: err?.message ?? "Try again",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {controller.settingsPhotoUrl ? (
        <div className="relative">
          <img
            src={controller.settingsPhotoUrl}
            alt="Controller settings"
            className="w-full max-w-xs h-40 object-cover rounded-lg border"
          />
        </div>
      ) : (
        <div className="w-full max-w-xs h-32 flex items-center justify-center bg-gray-50 border-2 border-dashed border-gray-200 rounded-lg">
          <p className="text-xs text-gray-400">No photo yet</p>
        </div>
      )}
      {canUploadPhoto && (
        <>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={onPick}
          />
          <input ref={libraryRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" type="button" disabled={busy} className="gap-1.5">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                {controller.settingsPhotoUrl ? "Replace Photo" : "Add Photo"}
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
        </>
      )}
    </div>
  );
}

// ── Program card ─────────────────────────────────────────────────────────────

function ProgramCard({
  program,
  controllerId,
  onSaved,
  onDeleted,
  onDraftChange,
  canManagePrograms,
}: {
  program: IrrigationProgram;
  controllerId: number;
  onSaved: () => void;
  onDeleted: () => void;
  onDraftChange?: (draft: IrrigationProgram) => void;
  canManagePrograms: boolean;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState({ ...program });
  const queryClient = useQueryClient();

  useEffect(() => {
    if (editing) onDraftChange?.(draft as IrrigationProgram);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, editing]);

  const saveMutation = useMutation({
    mutationFn: (data: Partial<IrrigationProgram>) =>
      apiRequest(`/api/irrigation-programs/${program.id}`, "PUT", data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/irrigation-controllers/${controllerId}`],
      });
      setEditing(false);
      toast({ title: "Program saved" });
      onSaved();
    },
    onError: (err: any) => {
      toast({
        title: "Save failed",
        description: err?.message ?? "Try again",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest(`/api/irrigation-programs/${program.id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/irrigation-controllers/${controllerId}`],
      });
      toast({ title: "Program deleted" });
      onDeleted();
    },
    onError: (err: any) => {
      toast({
        title: "Delete failed",
        description: err?.message ?? "Try again",
        variant: "destructive",
      });
    },
  });

  if (!editing || !canManagePrograms) {
    return (
      <div
        className={`border rounded-lg p-3 space-y-2 ${
          !program.isActive ? "bg-amber-50 border-amber-200" : "bg-white"
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-blue-700">Program {program.name}</span>
            {!program.isActive && (
              <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs gap-1">
                <AlertTriangle className="w-3 h-3" /> Needs attention
              </Badge>
            )}
          </div>
          {canManagePrograms && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft({ ...program });
                setEditing(true);
              }}
            >
              Edit
            </Button>
          )}
        </div>
        <div className="text-xs text-gray-600 space-y-0.5">
          {(program.wateringDays ?? []).length > 0 && (
            <p>Days: {(program.wateringDays ?? []).join(", ")}</p>
          )}
          {(program.startTimes ?? []).length > 0 && (
            <p>Start: {(program.startTimes ?? []).join(", ")}</p>
          )}
          <p>Seasonal: {program.seasonalAdjustPct}%</p>
        </div>
      </div>
    );
  }

  return (
    <div className="border-2 border-blue-300 rounded-lg p-3 space-y-3 bg-blue-50/30">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Program Name</Label>
          <Input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="h-8 text-sm mt-1"
          />
        </div>
        <div>
          <Label className="text-xs">Seasonal Adjust %</Label>
          <div className="flex items-center gap-2 mt-1">
            <Slider
              value={[draft.seasonalAdjustPct]}
              min={0}
              max={200}
              step={5}
              onValueChange={([v]) => setDraft({ ...draft, seasonalAdjustPct: v })}
              className="flex-1"
            />
            <span className="text-sm font-medium w-10 text-right">{draft.seasonalAdjustPct}%</span>
          </div>
        </div>
      </div>
      <div>
        <Label className="text-xs">Watering Days</Label>
        <div className="mt-1">
          <DayPillSelector
            value={draft.wateringDays ?? []}
            onChange={(days) => setDraft({ ...draft, wateringDays: days })}
          />
        </div>
      </div>
      <div>
        <Label className="text-xs">Start Times</Label>
        <div className="mt-1">
          <StartTimesInput
            value={draft.startTimes ?? []}
            onChange={(times) => setDraft({ ...draft, startTimes: times })}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          checked={draft.isActive}
          onCheckedChange={(v) => setDraft({ ...draft, isActive: v })}
          id={`prog-active-${program.id}`}
        />
        <Label htmlFor={`prog-active-${program.id}`} className="text-xs">Active</Label>
      </div>
      <div className="flex items-center gap-2 pt-1 border-t">
        <Button
          size="sm"
          disabled={saveMutation.isPending}
          onClick={() =>
            saveMutation.mutate({
              name: draft.name,
              wateringDays: draft.wateringDays ?? [],
              startTimes: draft.startTimes ?? [],
              seasonalAdjustPct: draft.seasonalAdjustPct,
              isActive: draft.isActive,
            })
          }
          className="gap-1.5"
        >
          {saveMutation.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)} className="gap-1.5">
          <X className="w-3.5 h-3.5" /> Cancel
        </Button>
        {canManagePrograms && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-red-600 hover:text-red-700 hover:bg-red-50 gap-1.5"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </Button>
        )}
      </div>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Program {program.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the program and unassign all its zones. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteMutation.mutate()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Zone row ──────────────────────────────────────────────────────────────────

function ZoneSheetRow({
  zone,
  programs,
  controllerId,
  customerId,
  index,
  selected,
  onSelect,
  disabled,
  onBusy,
  onDraftChange,
  canEditZone,
  focus,
  onFocusConsumed,
}: {
  zone: IrrigationProfileZone;
  programs: IrrigationProgram[];
  controllerId: number;
  customerId: number;
  index: number;
  selected: boolean;
  onSelect: (shift: boolean) => void;
  disabled: boolean;
  onBusy: (id: number, busy: boolean) => void;
  onDraftChange?: (draft: IrrigationProfileZone) => void;
  canEditZone: boolean;
  focus?: ZoneFocus | null;
  onFocusConsumed: (token: number) => void;
}) {
  const [draft, setDraft] = useState({ ...zone });
  const saved = useRef({ ...zone });
  const draftRef = useRef(draft);
  const dirty = useRef(new Set<keyof IrrigationProfileZone>());
  const queued = useRef(new Map<string, Partial<IrrigationProfileZone>>());
  const running = useRef<Partial<IrrigationProfileZone> | null>(null);
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const errorsRef = useRef(errors);
  const failed = useRef<string | null>(null);
  const [emptyName, setEmptyName] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipBlur = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const rowRef = useRef<HTMLTableRowElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [highlighted, setHighlighted] = useState(false);
  const appliedFocus = useRef<number | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!focus || appliedFocus.current === focus.token) return;
    appliedFocus.current = focus.token;
    if (canEditZone) { nameRef.current?.focus(); nameRef.current?.select(); }
    rowRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    setHighlighted(true);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlighted(false), 2000);
    onFocusConsumed(focus.token);
  }, [focus, canEditZone, zone, onFocusConsumed]);
  useEffect(() => () => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    timers.current.forEach(clearTimeout);
    if (successTimer.current) clearTimeout(successTimer.current);
  }, []);

  useEffect(() => {
    const next = { ...zone };
    for (const field of dirty.current) Object.assign(next, { [field]: draftRef.current[field] });
    saved.current = { ...zone };
    draftRef.current = next;
    setDraft(next);
  }, [zone]);
  useEffect(() => { onDraftChange?.(draft); }, [draft, onDraftChange]);

  const change = (field: keyof IrrigationProfileZone, value: unknown) => {
    dirty.current.add(field);
    draftRef.current = { ...draftRef.current, [field]: value };
    setDraft(draftRef.current);
  };
  const setFieldErrors = (next: Record<string, string>) => { errorsRef.current = next; setErrors(next); };

  const saveMutation = useMutation({
    mutationFn: (data: Partial<IrrigationProfileZone>): Promise<IrrigationProfileZone> =>
      apiRequest(`/api/irrigation-zones/${zone.id}`, "PUT", data),
  });

  // Serialize each row's requests. A Map coalesces repeated commits while a
  // different field is in flight; synchronous refs also deduplicate Enter+blur.
  const drain = async () => {
    if (running.current || !queued.current.size) return;
    setPending(true); setSuccess(false); onBusy(zone.id, true);
    while (queued.current.size) {
      const [key, patch] = queued.current.entries().next().value!;
      queued.current.delete(key); running.current = patch;
      try {
        const response = await saveMutation.mutateAsync(patch);
        const next = { ...response };
        const nextErrors = { ...errorsRef.current };
        for (const field of Object.keys(patch) as (keyof IrrigationProfileZone)[]) {
          if (JSON.stringify(draftRef.current[field]) === JSON.stringify(patch[field])) dirty.current.delete(field);
          delete nextErrors[field];
        }
        for (const field of dirty.current) Object.assign(next, { [field]: draftRef.current[field] });
        saved.current = response; draftRef.current = next; setDraft(next);
        setFieldErrors(nextErrors);
        failed.current = Object.keys(nextErrors).at(-1) ?? null;
        queryClient.setQueryData<ControllerWithDetail>([`/api/irrigation-controllers/${controllerId}`], old => old ? { ...old, zones: old.zones.map(z => z.id === zone.id ? response : z) } : old);
        queryClient.setQueryData<ControllerWithZones[]>([`/api/customers/${customerId}/controllers-profile`], old => old?.map(c => c.id === controllerId ? { ...c, zones: c.zones.map(z => z.id === zone.id ? { id: response.id, zoneNumber: response.zoneNumber, name: response.name, zoneType: response.zoneType, isActive: response.isActive, setUp: !isPlaceholderZone(response) } : z) } : c));
        queryClient.invalidateQueries({ queryKey: [`/api/irrigation-controllers/${controllerId}/history`] });
        setSuccess(true);
        if (successTimer.current) clearTimeout(successTimer.current);
        successTimer.current = setTimeout(() => setSuccess(false), 1500);
      } catch (error) {
        const message = parseApiError(error, "Could not save zone — please retry");
        const nextErrors = { ...errorsRef.current };
        for (const field of Object.keys(patch)) nextErrors[field] = message;
        setFieldErrors(nextErrors); failed.current = key;
      } finally { running.current = null; }
    }
    setPending(false); onBusy(zone.id, false);
  };
  const commit = (field: keyof IrrigationProfileZone) => {
    const value = draftRef.current[field];
    if (field === "name" && !String(value).trim()) {
      change("name", saved.current.name); dirty.current.delete("name");
      setEmptyName(true); timers.current.push(setTimeout(() => setEmptyName(false), 2000));
      return;
    }
    if (running.current && field in running.current) {
      if (JSON.stringify(running.current[field]) === JSON.stringify(value)) { queued.current.delete(field); return; }
    } else if (JSON.stringify(value) === JSON.stringify(saved.current[field]) && !errorsRef.current[field]) {
      queued.current.delete(field); return;
    }
    queued.current.set(field, { [field]: value });
    void drain();
  };
  const input = (field: "name" | "runTimeMinutes" | "zoneOrder" | "notes", label: string) => (
    <Input ref={field === "name" ? nameRef : undefined} aria-label={`Zone ${zone.zoneNumber} ${label}`} data-testid={`input-zone-${field}-${zone.id}`}
      data-zone-row={index} data-col={field} disabled={disabled} type={field === "runTimeMinutes" || field === "zoneOrder" ? "number" : "text"} min={0}
      value={draft[field] ?? ""} title={field === "name" && emptyName ? "A zone needs a name" : errors[field]}
      className={`h-8 text-sm ${field === "name" ? "min-w-32" : field === "notes" ? "min-w-28" : "w-20"} ${errors[field] || (field === "name" && emptyName) ? "border-red-400" : ""}`}
      onChange={e => change(field, field === "runTimeMinutes" || field === "zoneOrder" ? Number(e.target.value) : e.target.value)}
      onBlur={() => { if (skipBlur.current === field) { skipBlur.current = null; return; } commit(field); }}
      onKeyDown={e => {
        if (e.key === "Escape") {
          e.preventDefault(); queued.current.delete(field); change(field, saved.current[field]); dirty.current.delete(field);
          skipBlur.current = field; e.currentTarget.blur();
        } else if (e.key === "Enter") {
          e.preventDefault(); commit(field);
          const next = rowRef.current?.closest("table")?.querySelector<HTMLInputElement>(`input[data-zone-row="${index + (e.shiftKey ? -1 : 1)}"][data-col="${field}"]`);
          next?.focus(); next?.select();
        }
      }} />
  );
  const cell = "px-2 py-2 border border-gray-200";
  return <tr ref={rowRef} data-testid={`zone-row-${zone.id}`} className={`${!draft.isActive ? "bg-amber-50" : ""} ${highlighted ? "ring-2 ring-blue-400" : ""}`}>
    {canEditZone && <td className={cell}><Checkbox aria-label={`Select Zone ${zone.zoneNumber}`} data-testid={`select-zone-${zone.id}`} checked={selected} disabled={disabled} onClick={e => onSelect(e.shiftKey)} /></td>}
    <td className={cell}>{zone.zoneNumber}</td>
    <td className={cell}>{canEditZone ? input("name", "Name") : zone.name}</td>
    <td className={cell}>{canEditZone ? <Select value={draft.programId == null ? "none" : String(draft.programId)} disabled={disabled} onValueChange={v => { change("programId", v === "none" ? null : Number(v)); commit("programId"); }}>
      <SelectTrigger aria-label={`Zone ${zone.zoneNumber} Program`} className={`h-8 min-w-28 ${errors.programId ? "border-red-400" : ""}`}><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="none">— None —</SelectItem>{programs.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
    </Select> : programs.find(p => p.id === zone.programId)?.name ?? "—"}</td>
    <td className={cell}>{canEditZone ? <Select value={draft.zoneType} disabled={disabled} onValueChange={v => { change("zoneType", v); commit("zoneType"); }}>
      <SelectTrigger aria-label={`Zone ${zone.zoneNumber} Type`} className={`h-8 min-w-32 ${errors.zoneType ? "border-red-400" : ""}`}><SelectValue /></SelectTrigger>
      <SelectContent>{ZONE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
    </Select> : zoneTypeLabel(zone.zoneType)}</td>
    <td className={cell}><div className="flex items-center gap-1">{canEditZone ? input("runTimeMinutes", "Runtime") : zone.runTimeMinutes}<span className="text-xs">min</span></div></td>
    <td className={cell}>{canEditZone ? input("zoneOrder", "Order") : zone.zoneOrder}</td>
    <td className={cell}>{canEditZone ? <Switch aria-label={`Zone ${zone.zoneNumber} Status`} title={draft.isActive ? "Active" : "Needs attention"} checked={draft.isActive} disabled={disabled} className={errors.isActive ? "border-red-400" : ""} onCheckedChange={v => { change("isActive", v); commit("isActive"); }} /> : zone.isActive ? "Active" : "Needs attention"}</td>
    <td className={cell}>{canEditZone ? input("notes", "Notes") : zone.notes || "—"}</td>
    <td className={cell}>{canEditZone ? <Popover><PopoverTrigger asChild><Button variant="ghost" size="sm" disabled={disabled}>Override</Button></PopoverTrigger>
      <PopoverContent className="space-y-3"><Label>Override Start</Label><Input type="time" aria-label={`Zone ${zone.zoneNumber} Override Start`} value={draft.overrideStartTime ?? ""} onChange={e => change("overrideStartTime", e.target.value || null)} className={errors.overrideStartTime ? "border-red-400" : ""} />
        <Label>Override Days</Label><DayPillSelector value={draft.overrideDays ?? []} onChange={v => change("overrideDays", v)} />
        <Button disabled={pending || disabled} onClick={() => { queued.current.set("overrideStartTime", { overrideStartTime: draftRef.current.overrideStartTime, overrideDays: draftRef.current.overrideDays }); void drain(); }}>Save</Button>
      </PopoverContent></Popover> : zone.overrideStartTime ? `${zone.overrideStartTime} ${(zone.overrideDays ?? []).join(", ")}` : "—"}</td>
    <td className={`${cell} w-8`} data-testid={`zone-state-${zone.id}`}>{pending ? <Loader2 className="w-4 h-4 animate-spin" /> : Object.keys(errors).length ? <button type="button" aria-label={`Retry Zone ${zone.zoneNumber}`} title={errors[failed.current ?? ""] ?? Object.values(errors)[0]} onClick={() => {
      const field = failed.current as keyof IrrigationProfileZone;
      if (field === "overrideStartTime" || field === "overrideDays") {
        queued.current.set("overrideStartTime", { overrideStartTime: draftRef.current.overrideStartTime, overrideDays: draftRef.current.overrideDays }); void drain();
      } else commit(field);
    }}><AlertCircle className="w-4 h-4 text-red-600" /></button> : success ? <Check className="w-4 h-4 text-green-600" aria-label="Saved" /> : null}</td>
  </tr>;
}

// ── Add zone row ──────────────────────────────────────────────────────────────

function AddZoneRow({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: () => void;
}) {
  return (
      <tr>
        <td colSpan={9} className="px-2 py-2 border border-gray-200 border-t-0">
          <Button
            variant="ghost"
            size="sm"
            className="text-blue-600 gap-1.5"
            disabled={disabled}
            onClick={onAdd}
          >
            <Plus className="w-4 h-4" /> Add Zone
          </Button>
        </td>
      </tr>
  );
}

// ── Controller grid tile (collapsed + expandable) ────────────────────────────

interface ControllerGridTileProps {
  controller: ControllerWithZones;
  customerId: number;
  canManageControllers: boolean;
  canEditZones: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onRefreshList: () => void;
  focus: ZoneFocus | null;
  onOpenZone: (id: number) => void;
  onFocusConsumed: (token: number) => void;
  onExpand: () => void;
}

function ControllerGridTile({
  controller,
  customerId,
  canManageControllers,
  canEditZones,
  isExpanded,
  onToggle,
  onRefreshList,
  focus,
  onOpenZone,
  onFocusConsumed,
  onExpand,
}: ControllerGridTileProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingDetails, setEditingDetails] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [retireZone, setRetireZone] = useState<ZoneSummary | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  const countLock = useRef(false);
  const [draft, setDraft] = useState<Partial<IrrigationController>>({});

  const [draftPrograms, setDraftPrograms] = useState<IrrigationProgram[]>([]);
  const [draftZones, setDraftZones] = useState<IrrigationProfileZone[]>([]);
  const previousZones = useRef<IrrigationProfileZone[]>([]);
  const [selectedZones, setSelectedZones] = useState<Set<number>>(new Set());
  const lastSelected = useRef<number | null>(null);
  const [bulkType, setBulkType] = useState("");
  const [bulkProgram, setBulkProgram] = useState("");
  const [bulkRuntime, setBulkRuntime] = useState("");
  const [busyRows, setBusyRows] = useState<Set<number>>(new Set());
  const bulkLock = useRef(false);
  const onBusy = useCallback((id: number, busy: boolean) => setBusyRows(prev => {
    const next = new Set(prev); if (busy) next.add(id); else next.delete(id); return next;
  }), []);
  const clearBulk = () => { setSelectedZones(new Set()); setBulkType(""); setBulkProgram(""); setBulkRuntime(""); lastSelected.current = null; };
  useEffect(() => { if (!isExpanded) clearBulk(); }, [isExpanded]);
  const bulkMutation = useMutation({
    mutationFn: ({ ids, patch }: { ids: number[]; patch: { zoneType?: string; programId?: number | null; runTimeMinutes?: number } }) =>
      apiRequest(`/api/irrigation-controllers/${controller.id}/zones/bulk`, "PUT", { zoneIds: ids, patch }),
    onSuccess: async (_rows, variables) => {
      toast({ title: `Updated ${variables.ids.length} zones` });
      clearBulk();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [`/api/irrigation-controllers/${controller.id}`] }),
        queryClient.invalidateQueries({ queryKey: [`/api/customers/${customerId}/controllers-profile`] }),
        queryClient.invalidateQueries({ queryKey: [`/api/irrigation-controllers/${controller.id}/history`] }),
      ]);
    },
    onError: error => toast({ title: "Update failed", description: parseApiError(error, "Could not update zones — please retry"), variant: "destructive" }),
    onSettled: () => { bulkLock.current = false; },
  });

  const { data: detail, isLoading: detailLoading } = useQuery<ControllerWithDetail>({
    queryKey: [`/api/irrigation-controllers/${controller.id}`],
    enabled: isExpanded,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (detail) {
      setDraftPrograms(detail.programs ?? []);
      const before = previousZones.current;
      setDraftZones(prev => (detail.zones ?? []).map(z => {
        const old = before.find(v => v.id === z.id), local = prev.find(v => v.id === z.id);
        if (!old || !local) return z;
        const next = { ...z };
        for (const field of Object.keys(local) as (keyof IrrigationProfileZone)[]) {
          if (JSON.stringify(local[field]) !== JSON.stringify(old[field])) Object.assign(next, { [field]: local[field] });
        }
        return next;
      }));
      previousZones.current = detail.zones ?? [];
    }
  }, [detail]);

  const handleProgramDraftChange = useCallback((updated: IrrigationProgram) => {
    setDraftPrograms((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }, []);

  const handleZoneDraftChange = useCallback((updated: IrrigationProfileZone) => {
    setDraftZones((prev) => prev.map((z) => (z.id === updated.id ? updated : z)));
  }, []);

  // Use the stored letter (Task #1856). Fall back to first character of name for
  // pre-backfill rows that have letter IS NULL.
  const letter = controller.letter ?? controller.name.slice(0, 1).toUpperCase();
  const zoneCount = controller.zones.length;
  const setUpCount = controller.zones.filter(z => z.setUp).length;

  const updateZoneCount = useMutation({
    mutationFn: async (next: number) =>
      apiRequest(`/api/irrigation-controllers/${controller.id}/zone-count`, "PUT", { totalZones: next }),
    onSuccess: async (_result, next) => {
      const detailRefresh = queryClient.invalidateQueries({
        queryKey: [`/api/irrigation-controllers/${controller.id}`],
      });
      await Promise.all([detailRefresh, queryClient.invalidateQueries({
        queryKey: [`/api/customers/${customerId}/controllers-profile`],
      })]);
      toast({ title: "Zone count updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/properties", customerId, "controllers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/irrigation-controllers/${controller.id}/history`] });
      onRefreshList();
      if (next > zoneCount) {
        // Fetch after reconciliation; the identity may be restored, not newly created.
        const refreshed = await queryClient.fetchQuery<ControllerWithDetail>({
          queryKey: [`/api/irrigation-controllers/${controller.id}`],
          staleTime: 0,
        });
        const top = refreshed.zones.reduce<IrrigationProfileZone | null>((a, z) => !a || z.zoneNumber > a.zoneNumber ? z : a, null);
        if (top) onOpenZone(top.id);
      }
    },
    onError: (err: any) => {
      toast({
        title: "Could not update zone count",
        description: parseApiError(err, "Try again in a moment."),
        variant: "destructive",
      });
    },
    onSettled: () => { countLock.current = false; },
  });

  const increment = () => {
    if (retireZone || countLock.current || updateZoneCount.isPending || zoneCount >= MAX_ZONES) return;
    countLock.current = true;
    onExpand();
    updateZoneCount.mutate(zoneCount + 1);
  };
  const decrement = () => {
    if (!canManageControllers || countLock.current || updateZoneCount.isPending || zoneCount <= MIN_ZONES) return;
    const top = controller.zones.reduce((a, z) => z.zoneNumber > a.zoneNumber ? z : a);
    if (top.setUp) setRetireZone(top);
    else {
      countLock.current = true;
      updateZoneCount.mutate(zoneCount - 1);
    }
  };

  const saveMutation = useMutation({
    mutationFn: (data: Partial<IrrigationController>) =>
      apiRequest(`/api/irrigation-controllers/${controller.id}`, "PUT", data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/irrigation-controllers/${controller.id}`],
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/customers/${customerId}/controllers-profile`],
      });
      setEditingDetails(false);
      queryClient.invalidateQueries({ queryKey: [`/api/irrigation-controllers/${controller.id}/history`] });
      queryClient.invalidateQueries({ queryKey: ["/api/properties", customerId, "controllers"] });
      toast({ title: "Controller saved" });
      onRefreshList();
    },
    onError: (err: any) => {
      toast({
        title: "Save failed",
        description: parseApiError(err, "Try again"),
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest(`/api/irrigation-controllers/${controller.id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/customers/${customerId}/controllers-profile`],
      });
      toast({ title: "Controller deleted" });
      onRefreshList();
    },
    onError: (err: any) => {
      toast({
        title: "Delete failed",
        description: err?.message ?? "Try again",
        variant: "destructive",
      });
    },
  });

  const addProgramMutation = useMutation({
    mutationFn: (name: string) =>
      apiRequest(`/api/irrigation-controllers/${controller.id}/programs`, "POST", {
        name,
        wateringDays: [],
        startTimes: ["06:00"],
        seasonalAdjustPct: 100,
        isActive: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/irrigation-controllers/${controller.id}`],
      });
      toast({ title: "Program added" });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to add program",
        description: err?.message ?? "Try again",
        variant: "destructive",
      });
    },
  });

  const programs = detail?.programs ?? [];
  const zones = detail?.zones ?? [];

  const suggestNextProgramName = () => {
    const existing = new Set(programs.map((p) => p.name.toUpperCase()));
    for (const l of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      if (!existing.has(l)) return l;
    }
    return `${programs.length + 1}`;
  };

  const startEditDetails = () => {
    setDraft({
      name: controller.name,
      location: controller.location,
      brand: controller.brand,
      model: controller.model,
      notes: controller.notes,
      isActive: controller.isActive,
    });
    setEditingDetails(true);
  };

  return (
    <div
      className={`rounded-xl border bg-gradient-to-br from-blue-50/40 to-white overflow-hidden ${
        !controller.isActive ? "border-amber-200" : "border-gray-200"
      }`}
      data-testid={`controller-tile-${letter}`}
    >
      {/* ── Tile header — always visible ── */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            className="flex items-center gap-2 flex-1 min-w-0 text-left"
            onClick={onToggle}
          >
            <div className="w-9 h-9 rounded-lg bg-blue-600 text-white font-bold flex items-center justify-center shadow-sm shrink-0">
              {letter}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 flex items-center gap-1.5 flex-wrap">
                {controller.name}
                {!controller.isActive && (
                  <Badge className="bg-amber-100 text-amber-800 border-amber-200 gap-1 text-xs">
                    <AlertTriangle className="w-3 h-3" /> Needs attention
                  </Badge>
                )}
              </p>
              <p className="text-xs text-gray-500 flex items-center gap-1">
                <Cpu className="w-3 h-3" />
                {setupWording(zoneCount, setUpCount)}
                {controller.location && (
                  <span className="ml-1 truncate">· 📍 {controller.location}</span>
                )}
              </p>
            </div>
          </button>

          <div className="flex items-center gap-1.5 shrink-0">
            {canManageControllers && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  onClick={(e) => {
                    e.stopPropagation();
                    decrement();
                  }}
                  disabled={!!retireZone || updateZoneCount.isPending || zoneCount <= MIN_ZONES}
                  data-testid={`button-zone-decrement-${letter}`}
                >
                  <Minus className="w-3 h-3" />
                </Button>
                <span className="w-8 text-center text-sm font-medium tabular-nums">{zoneCount}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  onClick={(e) => {
                    e.stopPropagation();
                    increment();
                  }}
                  disabled={!!retireZone || updateZoneCount.isPending || zoneCount >= MAX_ZONES}
                  data-testid={`button-zone-increment-${letter}`}
                >
                  <Plus className="w-3 h-3" />
                </Button>
                {updateZoneCount.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                )}
              </>
            )}
            <button
              type="button"
              onClick={onToggle}
              className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              aria-label={isExpanded ? "Collapse" : "Expand"}
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {/* Zone number chips */}
        {!isExpanded && (
          <div className="flex flex-wrap gap-1.5">
            {controller.zones.map((zone) => (
              <button
                type="button"
                key={zone.id}
                onClick={() => onOpenZone(zone.id)}
                title={!zone.isActive ? `Zone ${zone.zoneNumber} · ${zone.name} · needs attention` : !zone.setUp ? `Zone ${zone.zoneNumber} · not set up yet` : `Zone ${zone.zoneNumber} · ${zone.name} · ${zoneTypeLabel(zone.zoneType)}`}
                className={`inline-flex items-center justify-center min-w-[28px] h-7 px-1.5 rounded-md text-xs font-medium ${!zone.isActive ? "bg-amber-50 border border-amber-300 text-amber-800" : zone.setUp ? "bg-white border border-blue-200 text-blue-900 shadow-sm" : "bg-gray-50 border border-dashed border-gray-300 text-gray-500"}`}
                data-testid={`zone-chip-${letter}-${zone.zoneNumber}`}
                data-state={!zone.isActive ? "attention" : zone.setUp ? "set-up" : "placeholder"}
              >
                {zone.zoneNumber}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Expanded detail section ── */}
      {isExpanded && (
        <div className="border-t border-gray-200 px-4 pb-4 pt-3 space-y-6 bg-white">
          {detailLoading ? (
            <div className="space-y-3 py-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (
            <>
              {/* ── Controller details ── */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-sm text-gray-700">Controller Details</h3>
                  <div className="flex gap-2">
                    {canManageControllers && !editingDetails && (
                      <Button variant="outline" size="sm" onClick={startEditDetails}>
                        Edit Details
                      </Button>
                    )}
                    <HistoryDrawer controllerId={controller.id} />
                    {canManageControllers && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-red-600 hover:bg-red-50 hover:text-red-700"
                        onClick={() => setConfirmDelete(true)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>

                {editingDetails ? (
                  <div className="space-y-3 p-3 border rounded-lg bg-blue-50/20">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Name *</Label>
                        <Input
                          value={draft.name ?? ""}
                          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                          className="h-8 text-sm mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Location</Label>
                        <Input
                          value={draft.location ?? ""}
                          onChange={(e) =>
                            setDraft({ ...draft, location: e.target.value || null })
                          }
                          className="h-8 text-sm mt-1"
                          placeholder="e.g. 4521 Woodglen Dr"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Brand</Label>
                        <Input
                          value={draft.brand ?? ""}
                          onChange={(e) => setDraft({ ...draft, brand: e.target.value || null })}
                          className="h-8 text-sm mt-1"
                          placeholder="e.g. Rainbird"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Model</Label>
                        <Input
                          value={draft.model ?? ""}
                          onChange={(e) => setDraft({ ...draft, model: e.target.value || null })}
                          className="h-8 text-sm mt-1"
                          placeholder="e.g. ESP-Me"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Notes</Label>
                      <Textarea
                        value={draft.notes ?? ""}
                        onChange={(e) => setDraft({ ...draft, notes: e.target.value || null })}
                        className="text-sm mt-1 resize-none"
                        rows={2}
                        placeholder="Any notes about this controller…"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={draft.isActive ?? true}
                        onCheckedChange={(v) => setDraft({ ...draft, isActive: v })}
                        id={`ctrl-active-${controller.id}`}
                      />
                      <Label htmlFor={`ctrl-active-${controller.id}`} className="text-xs">
                        {draft.isActive ? "Active" : "Inactive — Needs attention"}
                      </Label>
                    </div>
                    <div className="flex gap-2 border-t pt-2">
                      <Button
                        size="sm"
                        disabled={saveMutation.isPending || !draft.name}
                        onClick={() => saveMutation.mutate(draft)}
                        className="gap-1.5"
                      >
                        {saveMutation.isPending ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Save className="w-3.5 h-3.5" />
                        )}
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingDetails(false)}
                        className="gap-1.5"
                      >
                        <X className="w-3.5 h-3.5" /> Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-sm">
                    {controller.location && (
                      <>
                        <span className="text-gray-500 text-xs">Location</span>
                        <span className="col-span-2 sm:col-span-2 text-gray-800">
                          {controller.location}
                        </span>
                      </>
                    )}
                    {controller.brand && (
                      <>
                        <span className="text-gray-500 text-xs">Brand</span>
                        <span className="text-gray-800">{controller.brand}</span>
                      </>
                    )}
                    {controller.model && (
                      <>
                        <span className="text-gray-500 text-xs">Model</span>
                        <span className="text-gray-800">{controller.model}</span>
                      </>
                    )}
                    {controller.notes && (
                      <div className="col-span-2 sm:col-span-3">
                        <span className="text-gray-500 text-xs block">Notes</span>
                        <span className="text-gray-800 whitespace-pre-wrap text-sm">
                          {controller.notes}
                        </span>
                      </div>
                    )}
                    {controller.lastUpdatedAt && (
                      <div className="col-span-2 sm:col-span-3 text-xs text-gray-400 mt-1">
                        Last updated {fmtDateTime(controller.lastUpdatedAt)}
                        {controller.lastUpdatedByName
                          ? ` by ${controller.lastUpdatedByName}`
                          : ""}
                      </div>
                    )}
                    {!controller.location &&
                      !controller.brand &&
                      !controller.model &&
                      !controller.notes && (
                        <p className="col-span-3 text-xs text-gray-400 italic">
                          No details on file. Click "Edit Details" to add.
                        </p>
                      )}
                  </div>
                )}
              </section>

              {/* ── Settings photo ── */}
              <section>
                <h3 className="font-medium text-sm text-gray-700 mb-2">Settings Photo</h3>
                {detail && (
                  <SettingsPhoto
                    controller={detail}
                    canUploadPhoto={canEditZones}
                    onUploaded={() => {
                      queryClient.invalidateQueries({
                        queryKey: [`/api/customers/${customerId}/controllers-profile`],
                      });
                    }}
                  />
                )}
              </section>

              {/* ── Programs ── */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-sm text-gray-700">Programs</h3>
                  {canManageControllers && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={addProgramMutation.isPending}
                      onClick={() => addProgramMutation.mutate(suggestNextProgramName())}
                      className="gap-1.5"
                    >
                      {addProgramMutation.isPending ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Plus className="w-3.5 h-3.5" />
                      )}
                      Add Program
                    </Button>
                  )}
                </div>
                {programs.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">
                    No programs yet. Add a program to define watering schedules.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {programs.map((prog) => (
                      <ProgramCard
                        key={prog.id}
                        program={prog}
                        controllerId={controller.id}
                        onSaved={() => {}}
                        onDeleted={() => {}}
                        onDraftChange={handleProgramDraftChange}
                        canManagePrograms={canManageControllers}
                      />
                    ))}
                  </div>
                )}
              </section>

              {/* ── Zones table ── */}
              <section>
                <h3 className="font-medium text-sm text-gray-700 mb-3">{setupWording(zones.length, zones.filter(z => !isPlaceholderZone(z)).length, true)}</h3>
                {canEditZones && selectedZones.size > 0 && <div className="sticky top-0 z-10 bg-white border rounded-md p-2 flex flex-wrap gap-2 items-center" data-testid={`bulk-zone-bar-${controller.id}`}>
                  <span>{selectedZones.size} zones selected</span>
                  <Select value={bulkType} onValueChange={setBulkType} disabled={bulkMutation.isPending}><SelectTrigger aria-label="Bulk Type" className="w-36 h-8"><SelectValue placeholder="Type…" /></SelectTrigger><SelectContent>{ZONE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent></Select>
                  <Select value={bulkProgram} onValueChange={setBulkProgram} disabled={bulkMutation.isPending}><SelectTrigger aria-label="Bulk Program" className="w-36 h-8"><SelectValue placeholder="Program…" /></SelectTrigger><SelectContent><SelectItem value="none">— None —</SelectItem>{programs.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent></Select>
                  <Input aria-label="Bulk Runtime" type="number" min={0} max={999} placeholder="Runtime (min)" value={bulkRuntime} disabled={bulkMutation.isPending} onChange={e => setBulkRuntime(e.target.value)} className="w-36 h-8" />
                  <Button size="sm" disabled={bulkMutation.isPending || busyRows.size > 0 || (!bulkType && !bulkProgram && bulkRuntime === "") || (bulkRuntime !== "" && (!Number.isInteger(Number(bulkRuntime)) || Number(bulkRuntime) < 0 || Number(bulkRuntime) > 999))} onClick={() => {
                    if (bulkLock.current || busyRows.size) return;
                    bulkLock.current = true;
                    const patch: { zoneType?: string; programId?: number | null; runTimeMinutes?: number } = {};
                    if (bulkType) patch.zoneType = bulkType;
                    if (bulkProgram) patch.programId = bulkProgram === "none" ? null : Number(bulkProgram);
                    if (bulkRuntime !== "") patch.runTimeMinutes = Number(bulkRuntime);
                    bulkMutation.mutate({ ids: zones.filter(z => selectedZones.has(z.id)).map(z => z.id), patch });
                  }}>Apply</Button>
                  <Button size="sm" variant="ghost" disabled={bulkMutation.isPending} onClick={clearBulk}>Clear</Button>
                </div>}
                {zones.length === 0 && (
                  <p className="text-sm text-gray-400 italic mb-2">No zones yet. Use + above to add the first zone.</p>
                )}
                {(zones.length > 0 || canEditZones) && (
                  <div className="overflow-x-auto -mx-1">
                    <table className="w-full text-sm border-collapse min-w-[700px]">
                      <thead>
                        <tr className="bg-gray-50">
                          {canEditZones && <th className="px-2 border border-gray-200"><Checkbox aria-label="Select all zones" disabled={bulkMutation.isPending} checked={selectedZones.size === zones.length && zones.length > 0 ? true : selectedZones.size ? "indeterminate" : false} onCheckedChange={checked => setSelectedZones(checked ? new Set(zones.map(z => z.id)) : new Set())} /></th>}
                          <th className="text-center px-2 py-1.5 border border-gray-200 text-xs font-medium text-gray-600 w-12">#</th>
                          <th className="text-left px-2 py-1.5 border border-gray-200 text-xs font-medium text-gray-600">Name</th>
                          <th className="text-left px-2 py-1.5 border border-gray-200 text-xs font-medium text-gray-600">Program</th>
                          <th className="text-left px-2 py-1.5 border border-gray-200 text-xs font-medium text-gray-600">Type</th>
                          <th className="text-right px-2 py-1.5 border border-gray-200 text-xs font-medium text-gray-600">Runtime</th>
                          <th className="text-center px-2 py-1.5 border border-gray-200 text-xs font-medium text-gray-600">Order</th>
                          <th className="text-center px-2 py-1.5 border border-gray-200 text-xs font-medium text-gray-600">Status</th>
                          <th className="text-left px-2 py-1.5 border border-gray-200 text-xs font-medium text-gray-600">Notes</th>
                          <th className="w-16 border border-gray-200">Override</th>
                          <th className="w-8 border border-gray-200"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {zones.map((zone, index) => (
                          <ZoneSheetRow
                            key={zone.id}
                            zone={zone}
                            programs={programs}
                            controllerId={controller.id}
                            customerId={customerId}
                            index={index}
                            disabled={bulkMutation.isPending}
                            onBusy={onBusy}
                            selected={selectedZones.has(zone.id)}
                            onSelect={shift => {
                              const start = shift && lastSelected.current !== null ? Math.min(index, lastSelected.current) : index;
                              const end = shift && lastSelected.current !== null ? Math.max(index, lastSelected.current) : index;
                              const selecting = !selectedZones.has(zone.id);
                              setSelectedZones(prev => { const next = new Set(prev); for (let i = start; i <= end; i++) { if (selecting) next.add(zones[i].id); else next.delete(zones[i].id); } return next; });
                              lastSelected.current = index;
                            }}
                            onDraftChange={handleZoneDraftChange}
                            canEditZone={canEditZones}
                            focus={focus?.id === zone.id ? focus : null}
                            onFocusConsumed={onFocusConsumed}
                          />
                        ))}
                        {canEditZones && (
                          <AddZoneRow
                            disabled={updateZoneCount.isPending || zoneCount >= MAX_ZONES || !!retireZone}
                            onAdd={increment}
                          />
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
                {!!detail?.retiredZones.length && (
                  <div className="mt-3">
                    <Button variant="ghost" size="sm" onClick={() => setShowRetired(v => !v)}>
                      {showRetired ? "Hide retired zones" : `Show ${detail.retiredZones.length} retired zones`}
                    </Button>
                    {showRetired && (
                      <div data-testid={`retired-zones-${letter}`} className="text-xs text-gray-500 space-y-2 mt-2">
                        {detail.retiredZones.map(z => (
                          <p key={z.id}>Zone {z.zoneNumber} · {z.name} · {zoneTypeLabel(z.zoneType)} — retired {fmtDateTime(z.retiredAt)} by {z.retiredByName ?? "Unknown"}</p>
                        ))}
                        <p>Raise the zone count to bring these back.</p>
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* ── Run-time schedule ── */}
              {(draftPrograms.length > 0 || draftZones.length > 0) && (
                <section>
                  <h3 className="font-medium text-sm text-gray-700 mb-3">Auto Run-Time Schedule</h3>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <RunSchedulePanel programs={draftPrograms} zones={draftZones} />
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      )}

      {canManageControllers && (
        <AlertDialog open={!!retireZone} onOpenChange={open => { if (!open) setRetireZone(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Retire Zone {retireZone?.zoneNumber}?</AlertDialogTitle>
              <AlertDialogDescription>
                "{retireZone?.name}" drops out of pickers and wet checks. Its details and history are kept, and raising the count brings it back.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction disabled={updateZoneCount.isPending} onClick={() => {
                if (!countLock.current && zoneCount > MIN_ZONES) {
                  countLock.current = true;
                  updateZoneCount.mutate(zoneCount - 1);
                }
              }}>Retire zone</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {/* Delete confirmation */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Controller "{controller.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this controller, all its programs, zones, and history
              snapshots. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteMutation.mutate()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── IrrigationControllerGrid (exported shared component) ─────────────────────

export interface IrrigationControllerGridProps {
  controllers: ControllerWithZones[];
  customerId: number;
  canManageControllers: boolean;
  canEditZones: boolean;
  onRefreshList?: () => void;
}

export function IrrigationControllerGrid({
  controllers,
  customerId,
  canManageControllers,
  canEditZones,
  onRefreshList,
}: IrrigationControllerGridProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [focusZone, setFocusZone] = useState<(ZoneFocus & { controllerId: number }) | null>(null);
  const focusToken = useRef(0);
  const consumeFocus = useCallback((token: number) => {
    setFocusZone(prev => prev?.token === token ? null : prev);
  }, []);

  const handleToggle = (id: number) => {
    setFocusZone(null);
    setExpandedId((prev) => (prev === id ? null : id));
  };

  if (controllers.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {controllers.map((ctrl) => (
        <div
          key={ctrl.id}
          className={expandedId === ctrl.id ? "md:col-span-2" : ""}
        >
          <ControllerGridTile
            controller={ctrl}
            customerId={customerId}
            canManageControllers={canManageControllers}
            canEditZones={canEditZones}
            isExpanded={expandedId === ctrl.id}
            onToggle={() => handleToggle(ctrl.id)}
            onExpand={() => setExpandedId(ctrl.id)}
            onOpenZone={id => {
              setExpandedId(ctrl.id);
              setFocusZone({ id, controllerId: ctrl.id, token: ++focusToken.current });
            }}
            focus={focusZone?.controllerId === ctrl.id ? focusZone : null}
            onFocusConsumed={consumeFocus}
            onRefreshList={onRefreshList ?? (() => {})}
          />
        </div>
      ))}
    </div>
  );
}
