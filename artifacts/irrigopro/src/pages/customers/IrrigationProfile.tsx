import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { safeGet } from "@/utils/safeStorage";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Plus,
  FileText,
  Loader2,
  X,
  Mail,
  Download,
  Upload,
} from "lucide-react";
import type {
  IrrigationController,
  Customer,
} from "@workspace/db/schema";
import { IrrigationControllerGrid } from "@/components/customers/irrigation-controller-grid";
import { IrrigationCsvImportModal } from "@/components/customers/IrrigationCsvImportModal";

// ── Add controller form ──────────────────────────────────────────────────────

function AddControllerForm({
  customerId,
  onAdded,
  onCancel,
}: {
  customerId: number;
  onAdded: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({
    name: "",
    location: "",
    brand: "",
    model: "",
    totalZones: "",
    notes: "",
  });

  const mutation = useMutation({
    mutationFn: (data: typeof draft) =>
      apiRequest(`/api/customers/${customerId}/controllers-profile`, "POST", {
        name: data.name,
        location: data.location || null,
        brand: data.brand || null,
        model: data.model || null,
        totalZones: data.totalZones ? parseInt(data.totalZones) : null,
        notes: data.notes || null,
        isActive: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/customers/${customerId}/controllers-profile`],
      });
      toast({ title: "Controller added" });
      onAdded();
    },
    onError: (err: any) => {
      toast({
        title: "Failed to add controller",
        description: err?.message ?? "Try again",
        variant: "destructive",
      });
    },
  });

  return (
    <Card className="border-green-300 bg-green-50/20">
      <CardContent className="pt-4 space-y-3">
        <p className="font-medium text-sm text-green-800">New Controller</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Name *</Label>
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="h-8 text-sm mt-1"
              placeholder="e.g. Controller A"
              autoFocus
            />
          </div>
          <div>
            <Label className="text-xs">Location</Label>
            <Input
              value={draft.location}
              onChange={(e) => setDraft({ ...draft, location: e.target.value })}
              className="h-8 text-sm mt-1"
              placeholder="e.g. 4521 Woodglen Dr"
            />
          </div>
          <div>
            <Label className="text-xs">Brand</Label>
            <Input
              value={draft.brand}
              onChange={(e) => setDraft({ ...draft, brand: e.target.value })}
              className="h-8 text-sm mt-1"
              placeholder="e.g. Rainbird"
            />
          </div>
          <div>
            <Label className="text-xs">Model</Label>
            <Input
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              className="h-8 text-sm mt-1"
              placeholder="e.g. ESP-Me"
            />
          </div>
          <div>
            <Label className="text-xs">Total Zones</Label>
            <Input
              type="number"
              min={0}
              value={draft.totalZones}
              onChange={(e) => setDraft({ ...draft, totalZones: e.target.value })}
              className="h-8 text-sm mt-1"
            />
          </div>
        </div>
        <div>
          <Label className="text-xs">Notes</Label>
          <Textarea
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            className="text-sm mt-1 resize-none"
            rows={2}
          />
        </div>
        <div className="flex gap-2 border-t pt-2">
          <Button
            size="sm"
            disabled={mutation.isPending || !draft.name}
            onClick={() => mutation.mutate(draft)}
            className="gap-1.5"
          >
            {mutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            Add Controller
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel} className="gap-1.5">
            <X className="w-3.5 h-3.5" /> Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

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

// ── Main page ────────────────────────────────────────────────────────────────

export default function IrrigationProfile() {
  const { customerId } = useParams();
  const [, setLocation] = useLocation();
  const [showAddController, setShowAddController] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [sendLoading, setSendLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const { toast } = useToast();

  const { data: customer, isLoading: customerLoading } = useQuery<Customer>({
    queryKey: [`/api/customers/${customerId}`],
    enabled: !!customerId,
  });

  const {
    data: controllers = [],
    isLoading: controllersLoading,
    refetch: refetchControllers,
  } = useQuery<IrrigationController[]>({
    queryKey: [`/api/customers/${customerId}/controllers-profile`],
    enabled: !!customerId,
  });

  const [userRole, setUserRole] = useState("");
  useEffect(() => {
    const saved = safeGet("user");
    if (saved) {
      try {
        setUserRole(JSON.parse(saved).role ?? "");
      } catch {}
    }
  }, []);

  const canWrite =
    userRole === "company_admin" ||
    userRole === "super_admin" ||
    userRole === "irrigation_manager" ||
    userRole === "field_tech";

  // CSV import is manager/admin-only — field_tech and billing_manager cannot import
  const canImport =
    userRole === "company_admin" ||
    userRole === "super_admin" ||
    userRole === "irrigation_manager";

  const totalZoneCount = controllers.reduce((sum, c) => sum + (c.totalZones ?? 0), 0);
  const lastUpdated = controllers
    .filter((c) => c.lastUpdatedAt)
    .sort(
      (a, b) =>
        new Date(b.lastUpdatedAt!).getTime() - new Date(a.lastUpdatedAt!).getTime(),
    )[0];

  const isLoading = customerLoading || controllersLoading;

  async function handleExportCsv() {
    if (!customerId) return;
    setExportLoading(true);
    try {
      const response = await fetch(
        `/api/customers/${customerId}/irrigation-profile/export-csv`,
        { credentials: "include" },
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.message ?? "Failed to export CSV");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeCustomer = (customer?.name ?? "customer")
        .replace(/[/\\:*?"<>|]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const date = new Date().toISOString().slice(0, 10);
      a.download = `${safeCustomer} - Irrigation Profile - ${date}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "CSV exported" });
    } catch (err: any) {
      toast({
        title: "Export failed",
        description: err?.message ?? "Please try again",
        variant: "destructive",
      });
    } finally {
      setExportLoading(false);
    }
  }

  async function handleGenerateReport() {
    if (!customerId) return;
    setReportLoading(true);
    try {
      const response = await fetch(
        `/api/customers/${customerId}/irrigation-profile/report-pdf?download=1`,
        { credentials: "include" },
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.message ?? "Failed to generate report");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeCustomer = (customer?.name ?? "customer")
        .replace(/[/\\:*?"<>|]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const date = new Date().toISOString().slice(0, 10);
      a.download = `${safeCustomer} - Irrigation Profile - ${date}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Report downloaded" });
    } catch (err: any) {
      toast({
        title: "Report generation failed",
        description: err?.message ?? "Please try again",
        variant: "destructive",
      });
    } finally {
      setReportLoading(false);
    }
  }

  async function handleSendReport() {
    if (!customerId) return;
    setSendLoading(true);
    try {
      const response = await fetch(
        `/api/customers/${customerId}/irrigation-profile/report/send`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.message ?? "Failed to send report");
      }
      toast({
        title: "Report sent",
        description: body.to ? `Emailed to ${body.to}` : "Report emailed to customer",
      });
    } catch (err: any) {
      toast({
        title: "Failed to send report",
        description: err?.message ?? "Please try again",
        variant: "destructive",
      });
    } finally {
      setSendLoading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="container mx-auto p-4 max-w-4xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 max-w-4xl space-y-4">
      {/* Back button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setLocation(`/customers/${customerId}/profile`)}
        className="gap-1.5"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to {customer?.name ?? "Customer"}
      </Button>

      {/* Property header */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-gray-900">
                {customer?.name ?? "Customer"} — Controllers &amp; Zones
              </h1>
              <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-gray-600">
                <span>
                  <span className="font-medium">{controllers.length}</span>{" "}
                  {controllers.length === 1 ? "controller" : "controllers"}
                </span>
                {totalZoneCount > 0 && (
                  <span>
                    <span className="font-medium">{totalZoneCount}</span>{" "}
                    {totalZoneCount === 1 ? "zone" : "zones"}
                  </span>
                )}
                {lastUpdated && (
                  <span className="text-gray-400 text-xs">
                    Updated {fmtDateTime(lastUpdated.lastUpdatedAt)}
                    {lastUpdated.lastUpdatedByName
                      ? ` by ${lastUpdated.lastUpdatedByName}`
                      : ""}
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-2 shrink-0 flex-wrap">
              {canWrite && (
                <Button
                  size="sm"
                  onClick={() => setShowAddController(true)}
                  disabled={showAddController}
                  className="gap-1.5"
                >
                  <Plus className="w-4 h-4" /> Add Controller
                </Button>
              )}
              {canImport && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleExportCsv}
                    disabled={exportLoading || controllers.length === 0}
                    className="gap-1.5"
                  >
                    {exportLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    Export CSV
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowImportModal(true)}
                    className="gap-1.5"
                  >
                    <Upload className="w-4 h-4" /> Import CSV
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={handleGenerateReport}
                disabled={reportLoading || controllers.length === 0}
                className="gap-1.5"
              >
                {reportLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                Generate Report
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleSendReport}
                disabled={sendLoading || controllers.length === 0}
                className="gap-1.5"
              >
                {sendLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Mail className="w-4 h-4" />
                )}
                Send Report
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Add controller form */}
      {showAddController && (
        <AddControllerForm
          customerId={parseInt(customerId!)}
          onAdded={() => {
            setShowAddController(false);
            refetchControllers();
          }}
          onCancel={() => setShowAddController(false)}
        />
      )}

      {/* Irrigation CSV import modal */}
      <IrrigationCsvImportModal
        open={showImportModal}
        onOpenChange={setShowImportModal}
        customerId={parseInt(customerId!)}
        branches={customer?.branches as string[] | null | undefined}
      />

      {/* Controller list — empty state */}
      {controllers.length === 0 && !showAddController && (
        <div className="text-center py-12 text-gray-500">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No controllers yet</p>
          <p className="text-sm mt-1">
            {canWrite
              ? "Add a controller to start building this property's irrigation profile."
              : "No controllers have been added to this property's irrigation profile yet."}
          </p>
          {(canWrite || canImport) && (
            <div className="flex justify-center gap-2 mt-4">
              {canWrite && (
                <Button className="gap-1.5" onClick={() => setShowAddController(true)}>
                  <Plus className="w-4 h-4" /> Add Controller
                </Button>
              )}
              {canImport && (
                <Button variant="outline" className="gap-1.5" onClick={() => setShowImportModal(true)}>
                  <Upload className="w-4 h-4" /> Import CSV
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Controller grid — shared component */}
      {controllers.length > 0 && (
        <IrrigationControllerGrid
          controllers={controllers}
          customerId={parseInt(customerId!)}
          canEdit={canWrite}
          onRefreshList={() => refetchControllers()}
        />
      )}
    </div>
  );
}
