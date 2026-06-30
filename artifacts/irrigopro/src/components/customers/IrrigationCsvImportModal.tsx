import { useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Papa from "papaparse";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { safeGet } from "@/utils/safeStorage";
import {
  Upload,
  Download,
  FileText,
  AlertCircle,
  CheckCircle2,
  Loader2,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

// ── CSV template ──────────────────────────────────────────────────────────────

const TEMPLATE_HEADERS = [
  "Controller",
  "Location",
  "Brand",
  "Model",
  "Program",
  "Watering Days",
  "Start Time",
  "Seasonal %",
  "Zone #",
  "Zone Name",
  "Zone Type",
  "Run Time (min)",
];

const TEMPLATE_ROWS = [
  [
    "Controller A",
    "4521 Woodglenn Dr",
    "Hunter",
    "Pro-C",
    "A",
    "Mon,Wed,Fri",
    "06:00",
    "100",
    "1",
    "Front Lawn",
    "rotor",
    "15",
  ],
  [
    "Controller A",
    "4521 Woodglenn Dr",
    "Hunter",
    "Pro-C",
    "A",
    "Mon,Wed,Fri",
    "06:00",
    "100",
    "2",
    "Side Yard",
    "pop-up spray",
    "10",
  ],
  [
    "Controller A",
    "4521 Woodglenn Dr",
    "Hunter",
    "Pro-C",
    "B",
    "Tue,Thu,Sat",
    "07:00",
    "100",
    "3",
    "Back Lawn Drip",
    "drip",
    "20",
  ],
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface RowError {
  row: number;
  field: string;
  message: string;
}

interface ZoneDiff {
  action: "create" | "update" | "no_change";
  zoneNumber: number;
  zoneName: string;
  zoneType: string;
  runTimeMinutes: number;
  changes: Array<{ field: string; from: string | number | null; to: string | number | null }>;
}

interface ProgramDiff {
  programName: string;
  action: "create" | "update" | "no_change";
  changes: Array<{ field: string; from: unknown; to: unknown }>;
}

interface ControllerDiff {
  controllerName: string;
  action: "create" | "update";
  location: string | null;
  brand: string | null;
  model: string | null;
  programs: ProgramDiff[];
  zones: ZoneDiff[];
}

interface ImportResult {
  mode: "preview" | "commit";
  controllers: ControllerDiff[];
  rowErrors?: RowError[];
  summary: {
    controllersCreated: number;
    controllersUpdated: number;
    zonesAdded: number;
    zonesUpdated: number;
    programsCreated: number;
    programsUpdated: number;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ZONE_TYPE_ALIASES: Record<string, string> = {
  "pop-up spray": "pop_up_spray",
  "pop up spray": "pop_up_spray",
  popup_spray: "pop_up_spray",
  pop_up_spray: "pop_up_spray",
  rotor: "rotor",
  drip: "drip",
  netafim: "netafim",
  bubbler: "bubbler",
  other: "other",
};

const VALID_ZONE_TYPES = new Set([
  "pop_up_spray",
  "rotor",
  "drip",
  "netafim",
  "bubbler",
  "other",
]);

const DAY_ABBR: Record<string, string> = {
  M: "Mon",
  T: "Tue",
  W: "Wed",
  Th: "Thu",
  F: "Fri",
  Sa: "Sat",
  Su: "Sun",
  Mon: "Mon",
  Tue: "Tue",
  Wed: "Wed",
  Thu: "Thu",
  Fri: "Fri",
  Sat: "Sat",
  Sun: "Sun",
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
  Sunday: "Sun",
};

function parseDays(raw: string): string[] | null {
  if (!raw?.trim()) return null;
  // Try comma/semicolon split first
  const parts = raw.trim().split(/[,;|\s]+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1 || DAY_ABBR[parts[0]]) {
    return parts.map((p) => DAY_ABBR[p] ?? p).filter((p) => p.length > 0);
  }
  // Try compact abbreviation pattern like "MWF" or "MTuWThFSaSu"
  const compact = raw.trim();
  const result: string[] = [];
  let i = 0;
  while (i < compact.length) {
    if (compact.slice(i, i + 2) === "Th") { result.push("Thu"); i += 2; }
    else if (compact.slice(i, i + 2) === "Sa") { result.push("Sat"); i += 2; }
    else if (compact.slice(i, i + 2) === "Su") { result.push("Sun"); i += 2; }
    else if (compact.slice(i, i + 2) === "Tu") { result.push("Tue"); i += 2; }
    else if (compact[i] === "M") { result.push("Mon"); i++; }
    else if (compact[i] === "W") { result.push("Wed"); i++; }
    else if (compact[i] === "F") { result.push("Fri"); i++; }
    else { i++; }
  }
  return result.length > 0 ? result : null;
}

function parseTimes(raw: string): string[] | null {
  if (!raw?.trim()) return null;
  const parts = raw.trim().split(/[;,]+/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : null;
}

function normalizeZoneType(raw: string): string | null {
  const lower = raw.trim().toLowerCase();
  return ZONE_TYPE_ALIASES[lower] ?? null;
}

function downloadTemplate() {
  const rows = [TEMPLATE_HEADERS, ...TEMPLATE_ROWS];
  const csv = rows.map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "irrigation-profile-template.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function getAuthHeaders(): Record<string, string> {
  try {
    const raw = safeGet("user");
    if (!raw) return {};
    const user = JSON.parse(raw);
    return {
      "x-user-role": user.role ?? "",
      "x-user-id": String(user.id ?? ""),
      "x-user-name": user.name ?? "",
      "x-user-company-id": String(user.companyId ?? ""),
    };
  } catch {
    return {};
  }
}

// ── Parse + validate CSV client-side ─────────────────────────────────────────

interface ParsedRow {
  controllerName: string;
  location: string | null;
  brand: string | null;
  model: string | null;
  programName: string | null;
  wateringDays: string[] | null;
  startTimes: string[] | null;
  seasonalAdjustPct: number;
  zoneNumber: number;
  zoneName: string;
  zoneType: string;
  runTimeMinutes: number;
}

interface ParseResult {
  rows: ParsedRow[];
  errors: RowError[];
}

const REQUIRED_HEADERS = [
  "Controller",
  "Zone #",
  "Zone Name",
  "Zone Type",
  "Run Time (min)",
];

function parseCsv(text: string): ParseResult {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const headers = result.meta.fields ?? [];
  const missingRequired = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missingRequired.length > 0) {
    return {
      rows: [],
      errors: [
        {
          row: 0,
          field: "headers",
          message: `Missing required columns: ${missingRequired.join(", ")}`,
        },
      ],
    };
  }

  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];

  result.data.forEach((raw, i) => {
    const rowNum = i + 2; // 1-indexed, +1 for header row

    const ctrlName = (raw["Controller"] ?? "").trim();
    if (!ctrlName) {
      errors.push({ row: rowNum, field: "Controller", message: "Controller name is required" });
      return;
    }

    const zoneNumStr = (raw["Zone #"] ?? "").trim();
    const zoneNum = parseInt(zoneNumStr, 10);
    if (!zoneNumStr || isNaN(zoneNum) || zoneNum < 1) {
      errors.push({ row: rowNum, field: "Zone #", message: "Zone # must be a positive integer" });
      return;
    }

    const zoneName = (raw["Zone Name"] ?? "").trim();
    if (!zoneName) {
      errors.push({ row: rowNum, field: "Zone Name", message: "Zone Name is required" });
      return;
    }

    const rawZoneType = (raw["Zone Type"] ?? "").trim();
    const zoneType = normalizeZoneType(rawZoneType);
    if (!zoneType) {
      errors.push({
        row: rowNum,
        field: "Zone Type",
        message: `Unknown zone type "${rawZoneType}". Valid values: pop-up spray, rotor, drip, netafim, bubbler, other`,
      });
      return;
    }

    const runTimeStr = (raw["Run Time (min)"] ?? "").trim();
    const runTimeMinutes = parseInt(runTimeStr, 10);
    if (runTimeStr && (isNaN(runTimeMinutes) || runTimeMinutes < 0)) {
      errors.push({ row: rowNum, field: "Run Time (min)", message: "Run Time must be a non-negative integer" });
      return;
    }

    const seasonalStr = (raw["Seasonal %"] ?? "100").trim();
    const seasonalAdjustPct = parseInt(seasonalStr, 10);
    if (seasonalStr && (isNaN(seasonalAdjustPct) || seasonalAdjustPct < 0 || seasonalAdjustPct > 500)) {
      errors.push({ row: rowNum, field: "Seasonal %", message: "Seasonal % must be 0–500" });
      return;
    }

    const rawStartTime = raw["Start Time"] ?? "";
    const startTimes = parseTimes(rawStartTime);
    if (startTimes) {
      const badTime = startTimes.find((t) => !/^\d{1,2}:\d{2}$/.test(t));
      if (badTime) {
        errors.push({ row: rowNum, field: "Start Time", message: `Invalid start time format "${badTime}". Use HH:MM (e.g. 06:00)` });
        return;
      }
    }

    rows.push({
      controllerName: ctrlName,
      location: (raw["Location"] ?? "").trim() || null,
      brand: (raw["Brand"] ?? "").trim() || null,
      model: (raw["Model"] ?? "").trim() || null,
      programName: (raw["Program"] ?? "").trim() || null,
      wateringDays: parseDays(raw["Watering Days"] ?? ""),
      startTimes,
      seasonalAdjustPct: isNaN(seasonalAdjustPct) ? 100 : seasonalAdjustPct,
      zoneNumber: zoneNum,
      zoneName,
      zoneType,
      runTimeMinutes: isNaN(runTimeMinutes) ? 0 : runTimeMinutes,
    });
  });

  return { rows, errors };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ControllerPreviewCard({ diff }: { diff: ControllerDiff }) {
  const [expanded, setExpanded] = useState(true);
  const newZones = diff.zones.filter((z) => z.action === "create").length;
  const updatedZones = diff.zones.filter((z) => z.action === "update").length;

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-sm truncate">{diff.controllerName}</span>
          <Badge
            variant={diff.action === "create" ? "default" : "secondary"}
            className={`text-xs shrink-0 ${diff.action === "create" ? "bg-green-600" : "bg-blue-600 text-white"}`}
          >
            {diff.action === "create" ? "NEW" : "UPDATE"}
          </Badge>
        </div>
        <div className="flex items-center gap-2 ml-2 shrink-0">
          <span className="text-xs text-gray-500">
            {diff.zones.length} zone{diff.zones.length !== 1 ? "s" : ""}
            {newZones > 0 && `, ${newZones} new`}
            {updatedZones > 0 && `, ${updatedZones} updated`}
          </span>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="divide-y">
          {diff.programs.length > 0 && (
            <div className="px-3 py-2 bg-indigo-50/60">
              <p className="text-xs font-medium text-indigo-700 mb-1">Programs</p>
              <div className="flex flex-wrap gap-1.5">
                {diff.programs.map((p) => (
                  <span key={p.programName} className="inline-flex items-center gap-1 text-xs">
                    <Badge
                      variant="outline"
                      className={`text-xs ${p.action === "create" ? "border-green-500 text-green-700" : p.action === "update" ? "border-blue-500 text-blue-700" : "border-gray-300 text-gray-500"}`}
                    >
                      {p.action === "create" ? "+" : p.action === "update" ? "~" : "="}
                      {p.programName}
                    </Badge>
                    {p.changes.map((ch) => (
                      <span key={ch.field} className="text-xs text-gray-500">
                        {ch.field}: {String(ch.from ?? "—")} → {String(ch.to ?? "—")}
                      </span>
                    ))}
                  </span>
                ))}
              </div>
            </div>
          )}

          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-gray-500">
                <th className="text-left px-3 py-1.5 font-medium w-8">#</th>
                <th className="text-left px-3 py-1.5 font-medium">Zone Name</th>
                <th className="text-left px-3 py-1.5 font-medium hidden sm:table-cell">Type</th>
                <th className="text-right px-3 py-1.5 font-medium hidden sm:table-cell">Min</th>
                <th className="text-left px-3 py-1.5 font-medium w-20">Status</th>
              </tr>
            </thead>
            <tbody>
              {diff.zones.map((z) => (
                <tr
                  key={z.zoneNumber}
                  className={`border-t ${z.action === "create" ? "bg-green-50/50" : z.action === "update" ? "bg-blue-50/50" : ""}`}
                >
                  <td className="px-3 py-1.5 text-gray-500">{z.zoneNumber}</td>
                  <td className="px-3 py-1.5">
                    <div>{z.zoneName}</div>
                    {z.changes.map((ch) => (
                      <div key={ch.field} className="text-gray-400 text-xs">
                        {ch.field}: {String(ch.from ?? "—")} → {String(ch.to ?? "—")}
                      </div>
                    ))}
                  </td>
                  <td className="px-3 py-1.5 text-gray-500 hidden sm:table-cell">
                    {z.zoneType.replace(/_/g, " ")}
                  </td>
                  <td className="px-3 py-1.5 text-right text-gray-500 hidden sm:table-cell">
                    {z.runTimeMinutes}
                  </td>
                  <td className="px-3 py-1.5">
                    {z.action === "create" ? (
                      <Badge className="text-xs bg-green-600 text-white">NEW</Badge>
                    ) : z.action === "update" ? (
                      <Badge className="text-xs bg-blue-600 text-white">UPDATE</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-gray-400">no change</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main modal ─────────────────────────────────────────────────────────────────

interface IrrigationCsvImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: number;
  branchName?: string;
}

type Step = "upload" | "preview" | "done";

export function IrrigationCsvImportModal({
  open,
  onOpenChange,
  customerId,
  branchName = "",
}: IrrigationCsvImportModalProps) {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [rowErrors, setRowErrors] = useState<RowError[]>([]);
  const [previewResult, setPreviewResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [commitResult, setCommitResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  function reset() {
    setStep("upload");
    setFile(null);
    setRowErrors([]);
    setPreviewResult(null);
    setCommitResult(null);
    setImporting(false);
    setPreviewing(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleClose() {
    reset();
    onOpenChange(false);
  }

  function readAndPreview(f: File) {
    setFile(f);
    setPreviewing(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result as string;
      const { rows, errors } = parseCsv(text);
      setRowErrors(errors);
      if (errors.length > 0 && rows.length === 0) {
        setPreviewing(false);
        return;
      }

      try {
        const res = await fetch(
          `/api/customers/${customerId}/irrigation-profile/import-csv`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...getAuthHeaders(),
            },
            credentials: "include",
            body: JSON.stringify({ mode: "preview", rows, branchName }),
          },
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.message ?? "Preview failed");
        setPreviewResult({ ...body, rowErrors: errors });
        setStep("preview");
      } catch (err: any) {
        toast({
          title: "Preview failed",
          description: err?.message ?? "Could not validate CSV",
          variant: "destructive",
        });
      } finally {
        setPreviewing(false);
      }
    };
    reader.readAsText(f);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.endsWith(".csv")) {
      toast({ title: "Invalid file", description: "Please upload a .csv file", variant: "destructive" });
      return;
    }
    readAndPreview(f);
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (!f) return;
    if (!f.name.endsWith(".csv")) {
      toast({ title: "Invalid file", description: "Please drop a .csv file", variant: "destructive" });
      return;
    }
    readAndPreview(f);
  }, [customerId, branchName]);

  async function handleImport() {
    if (!previewResult || !file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const { rows, errors } = parseCsv(text);
      if (errors.length > 0 && rows.length === 0) {
        toast({ title: "Import failed", description: "Fix CSV errors before importing", variant: "destructive" });
        return;
      }

      const res = await fetch(
        `/api/customers/${customerId}/irrigation-profile/import-csv`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders(),
          },
          credentials: "include",
          body: JSON.stringify({ mode: "commit", rows, branchName }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message ?? "Import failed");

      setCommitResult(body);
      setStep("done");
      queryClient.invalidateQueries({
        queryKey: [`/api/customers/${customerId}/controllers-profile`],
      });
      toast({ title: "Import successful", description: `${body.summary?.zonesAdded ?? 0} zones added, ${body.summary?.zonesUpdated ?? 0} updated` });
    } catch (err: any) {
      toast({
        title: "Import failed",
        description: err?.message ?? "Could not import CSV",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  }

  const summary = commitResult?.summary ?? previewResult?.summary;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Irrigation Profile from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV to populate controllers, programs, and zones. Existing data is updated — nothing is deleted.
          </DialogDescription>
        </DialogHeader>

        {/* ── Upload step ── */}
        {step === "upload" && (
          <div className="space-y-4">
            {/* Download template */}
            <div className="flex items-center justify-between rounded-lg border px-4 py-3 bg-gray-50">
              <div>
                <p className="text-sm font-medium">Download Template</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Controller, Location, Brand, Model, Program, Watering Days, Start Time, Seasonal %, Zone #, Zone Name, Zone Type, Run Time (min)
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={downloadTemplate} className="gap-1.5 shrink-0 ml-3">
                <Download className="w-4 h-4" /> Template
              </Button>
            </div>

            {/* Drop zone */}
            <div
              onDragEnter={() => setIsDragging(true)}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${isDragging ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-gray-400"}`}
            >
              {previewing ? (
                <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin text-gray-400" />
              ) : (
                <Upload className="w-8 h-8 mx-auto mb-2 text-gray-400" />
              )}
              <p className="text-sm font-medium text-gray-700">
                {previewing ? "Validating…" : "Click or drag & drop your CSV file"}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {file ? file.name : ".csv files only"}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileInput}
              />
            </div>

            {/* Row errors from parse */}
            {rowErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription>
                  <p className="font-medium mb-1">
                    {rowErrors[0].row === 0 ? "File error" : `${rowErrors.length} row error${rowErrors.length !== 1 ? "s" : ""} found — fix and re-upload`}
                  </p>
                  <ul className="text-xs space-y-0.5">
                    {rowErrors.slice(0, 8).map((e, i) => (
                      <li key={i}>
                        {e.row > 0 ? `Row ${e.row}, ${e.field}: ` : ""}{e.message}
                      </li>
                    ))}
                    {rowErrors.length > 8 && <li>… and {rowErrors.length - 8} more</li>}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <div className="text-xs text-gray-400 space-y-0.5">
              <p className="font-medium text-gray-500">Zone Type values:</p>
              <p>pop-up spray · rotor · drip · netafim · bubbler · other</p>
              <p className="mt-1 font-medium text-gray-500">Watering Days examples:</p>
              <p>Mon,Wed,Fri · MWF · Mon Wed Fri</p>
            </div>
          </div>
        )}

        {/* ── Preview step ── */}
        {step === "preview" && previewResult && (
          <div className="space-y-4">
            {/* Row-level errors (still importable valid rows) */}
            {previewResult.rowErrors && previewResult.rowErrors.length > 0 && (
              <Alert variant="destructive" className="py-2">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription className="text-xs">
                  <p className="font-medium mb-1">{previewResult.rowErrors.length} row(s) have errors and will be skipped:</p>
                  <ul className="space-y-0.5">
                    {previewResult.rowErrors.slice(0, 5).map((e, i) => (
                      <li key={i}>Row {e.row}, {e.field}: {e.message}</li>
                    ))}
                    {previewResult.rowErrors.length > 5 && <li>… and {previewResult.rowErrors.length - 5} more</li>}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {/* Summary strip */}
            <div className="flex flex-wrap gap-2">
              {previewResult.summary.controllersCreated > 0 && (
                <Badge className="bg-green-600 text-white">{previewResult.summary.controllersCreated} controller{previewResult.summary.controllersCreated !== 1 ? "s" : ""} NEW</Badge>
              )}
              {previewResult.summary.controllersUpdated > 0 && (
                <Badge className="bg-blue-600 text-white">{previewResult.summary.controllersUpdated} controller{previewResult.summary.controllersUpdated !== 1 ? "s" : ""} updated</Badge>
              )}
              {previewResult.summary.zonesAdded > 0 && (
                <Badge className="bg-green-600 text-white">{previewResult.summary.zonesAdded} zone{previewResult.summary.zonesAdded !== 1 ? "s" : ""} NEW</Badge>
              )}
              {previewResult.summary.zonesUpdated > 0 && (
                <Badge className="bg-blue-600 text-white">{previewResult.summary.zonesUpdated} zone{previewResult.summary.zonesUpdated !== 1 ? "s" : ""} updated</Badge>
              )}
              {previewResult.summary.programsCreated > 0 && (
                <Badge className="bg-green-600 text-white">{previewResult.summary.programsCreated} program{previewResult.summary.programsCreated !== 1 ? "s" : ""} NEW</Badge>
              )}
              {previewResult.controllers.length === 0 && (
                <Badge variant="outline">No changes detected</Badge>
              )}
            </div>

            {/* Controller diff cards */}
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {previewResult.controllers.map((diff) => (
                <ControllerPreviewCard key={diff.controllerName} diff={diff} />
              ))}
            </div>

            <div className="flex gap-2 border-t pt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setStep("upload"); setPreviewResult(null); setRowErrors([]); }}
                className="gap-1.5"
              >
                <X className="w-4 h-4" /> Change File
              </Button>
              <Button
                size="sm"
                onClick={handleImport}
                disabled={importing || previewResult.controllers.length === 0}
                className="gap-1.5 ml-auto"
              >
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {importing ? "Importing…" : "Import"}
              </Button>
            </div>
          </div>
        )}

        {/* ── Done step ── */}
        {step === "done" && commitResult && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle2 className="w-5 h-5" />
              <span className="font-medium">Import complete</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {commitResult.summary.controllersCreated > 0 && (
                <Badge className="bg-green-600 text-white">{commitResult.summary.controllersCreated} controller{commitResult.summary.controllersCreated !== 1 ? "s" : ""} created</Badge>
              )}
              {commitResult.summary.controllersUpdated > 0 && (
                <Badge className="bg-blue-600 text-white">{commitResult.summary.controllersUpdated} controller{commitResult.summary.controllersUpdated !== 1 ? "s" : ""} updated</Badge>
              )}
              {commitResult.summary.zonesAdded > 0 && (
                <Badge className="bg-green-600 text-white">{commitResult.summary.zonesAdded} zone{commitResult.summary.zonesAdded !== 1 ? "s" : ""} added</Badge>
              )}
              {commitResult.summary.zonesUpdated > 0 && (
                <Badge className="bg-blue-600 text-white">{commitResult.summary.zonesUpdated} zone{commitResult.summary.zonesUpdated !== 1 ? "s" : ""} updated</Badge>
              )}
              {commitResult.summary.programsCreated > 0 && (
                <Badge className="bg-green-600 text-white">{commitResult.summary.programsCreated} program{commitResult.summary.programsCreated !== 1 ? "s" : ""} created</Badge>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button size="sm" variant="outline" onClick={reset} className="gap-1.5">
                <Upload className="w-4 h-4" /> Import Another
              </Button>
              <Button size="sm" onClick={handleClose}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
