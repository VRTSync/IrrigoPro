import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, AlertTriangle, RefreshCw, Wrench, ShieldCheck, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageContainer, PageContent, PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type AuditSource = "billing_sheet" | "work_order";
type Classification = "standard" | "emergency";

function sourceLabel(source: AuditSource): string {
  return source === "billing_sheet" ? "BS" : "WO";
}

interface AuditRow {
  source: AuditSource;
  parentId: number;
  parentNumber: string;
  customerId: number | null;
  customerName: string;
  workDate: string | null;
  technicianName: string;
  status: string;
  totalHours: string;
  storedLaborRate: string;
  storedLaborSubtotal: string;
  storedPartsSubtotal: string;
  storedTotalAmount: string;
  customerStandardRate: string;
  customerEmergencyRate: string;
  inferredClassification: Classification;
  expectedLaborRate: string;
  expectedLaborSubtotal: string;
  expectedTotalAmount: string;
}

interface AuditResponse {
  companyId: number | null;
  count: number;
  rows: AuditRow[];
}

interface RepairParentSummary {
  source: AuditSource;
  parentId: number;
  parentNumber: string;
  classification: Classification;
  oldLaborRate: string;
  newLaborRate: string;
  oldLaborSubtotal: string;
  newLaborSubtotal: string;
  oldTotalAmount: string;
  newTotalAmount: string;
}

interface RepairResponse {
  dryRun: boolean;
  parentCount: number;
  totalDifference: string;
  parents: RepairParentSummary[];
  skipped: Array<{ source: AuditSource; parentId: number; reason: string }>;
}

function fmtMoney(value: string | number) {
  const n = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(n)) return "$0.00";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

function rowKey(source: AuditSource, parentId: number) {
  return `${source}:${parentId}`;
}

function computeExpected(row: AuditRow, classification: Classification) {
  const rate = parseFloat(
    classification === "emergency" ? row.customerEmergencyRate : row.customerStandardRate,
  );
  const hours = parseFloat(row.totalHours);
  const parts = parseFloat(row.storedPartsSubtotal);
  const laborSubtotal = hours * rate;
  const totalAmount = laborSubtotal + parts;
  return {
    rate: rate.toFixed(2),
    laborSubtotal: laborSubtotal.toFixed(2),
    totalAmount: totalAmount.toFixed(2),
  };
}

export default function LaborRateAuditPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [classOverrides, setClassOverrides] = useState<Record<string, Classification>>({});
  const [preview, setPreview] = useState<RepairResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<AuditResponse>({
    queryKey: ["/api/admin/labor-rate-audit"],
  });
  const isForbidden = isError && error instanceof Error && /^403[:\s]/.test(error.message);

  const rows = data?.rows ?? [];
  const allSelected = rows.length > 0 && rows.every((r) => selectedKeys.has(rowKey(r.source, r.parentId)));

  function getClassification(row: AuditRow): Classification {
    return classOverrides[rowKey(row.source, row.parentId)] ?? row.inferredClassification;
  }

  const selectedRows = useMemo(
    () => rows.filter((r) => selectedKeys.has(rowKey(r.source, r.parentId))),
    [rows, selectedKeys],
  );
  const totalDelta = useMemo(
    () => rows.reduce((sum, r) => {
      const expected = computeExpected(r, getClassification(r));
      return sum + (parseFloat(expected.totalAmount) - parseFloat(r.storedTotalAmount));
    }, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, classOverrides],
  );
  const selectedDelta = useMemo(
    () => selectedRows.reduce((sum, r) => {
      const expected = computeExpected(r, getClassification(r));
      return sum + (parseFloat(expected.totalAmount) - parseFloat(r.storedTotalAmount));
    }, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedRows, classOverrides],
  );

  function toggle(source: AuditSource, id: number) {
    const key = rowKey(source, id);
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedKeys(next);
  }
  function toggleAll() {
    if (allSelected) setSelectedKeys(new Set());
    else setSelectedKeys(new Set(rows.map((r) => rowKey(r.source, r.parentId))));
  }
  function setClassification(row: AuditRow, classification: Classification) {
    setClassOverrides((prev) => ({ ...prev, [rowKey(row.source, row.parentId)]: classification }));
  }

  async function runRepair(dryRun: boolean) {
    if (dryRun) setPreviewing(true);
    else setApplying(true);
    try {
      const selection = selectedRows.map((r) => ({
        source: r.source,
        parentId: r.parentId,
        classification: getClassification(r),
      }));
      const result = (await apiRequest(
        "/api/admin/labor-rate-audit/repair",
        "POST",
        { selection, dryRun },
      )) as RepairResponse;
      if (dryRun) {
        setPreview(result);
        toast({
          title: "Dry-run complete",
          description: `${result.parentCount} ticket(s), delta ${fmtMoney(result.totalDifference)}.`,
        });
      } else {
        setPreview(null);
        setSelectedKeys(new Set());
        setClassOverrides({});
        toast({
          title: "Repaired",
          description: `${result.parentCount} ticket(s) repriced (${fmtMoney(result.totalDifference)}).${
            result.skipped.length > 0 ? ` ${result.skipped.length} skipped.` : ""
          }`,
        });
        qc.invalidateQueries({ queryKey: ["/api/admin/labor-rate-audit"] });
        qc.invalidateQueries({ queryKey: ["/api/billing-sheets"] });
        qc.invalidateQueries({ queryKey: ["/api/work-orders"] });
      }
    } catch (err: any) {
      toast({
        title: dryRun ? "Dry-run failed" : "Repair failed",
        description: err?.message || "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setPreviewing(false);
      setApplying(false);
    }
  }

  const billingRowCount = rows.filter((r) => r.source === "billing_sheet").length;
  const workOrderRowCount = rows.filter((r) => r.source === "work_order").length;

  return (
    <PageContainer>
      <PageHeader
        title="Labor Rate Audit"
        subtitle="Find and repair un-invoiced work orders and billing sheets whose stored labor rate no longer matches the customer's current rate."
        backHref="/billing-sheets"
      />
      <PageContent>
        <div className="flex items-center justify-between mb-4">
          <Link href="/billing-sheets">
            <Button variant="outline" size="sm" data-testid="button-back-billing-sheets">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Billing Sheets
            </Button>
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-audit"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="py-8 space-y-3">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-6 w-1/2" />
            </CardContent>
          </Card>
        ) : isForbidden ? (
          <Card>
            <CardContent className="py-12 text-center" data-testid="audit-no-access">
              <Lock className="w-12 h-12 text-gray-500 mx-auto mb-3" />
              <h3 className="text-lg font-semibold mb-1">You don't have permission to view this report</h3>
              <p className="text-sm text-gray-600 mb-4">
                The labor rate audit is limited to company admins, billing managers, and super admins.
              </p>
              <Link href="/billing-sheets">
                <Button variant="outline" size="sm" data-testid="button-no-access-back">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Billing Sheets
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : isError ? (
          <Card>
            <CardContent className="py-8 text-center text-red-600">
              Failed to load audit data. Make sure you are signed in with admin or billing manager access.
            </CardContent>
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center" data-testid="audit-empty">
              <ShieldCheck className="w-12 h-12 text-green-600 mx-auto mb-3" />
              <h3 className="text-lg font-semibold mb-1">All labor rates are in sync</h3>
              <p className="text-sm text-gray-600">
                Every un-invoiced work order and billing sheet matches its customer's current labor rate.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="mb-4">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                  {rows.length} mismatched ticket{rows.length === 1 ? "" : "s"}
                  <Badge variant="outline">Billing sheets: {billingRowCount}</Badge>
                  <Badge variant="outline">Work orders: {workOrderRowCount}</Badge>
                  <Badge variant="outline" className="ml-2" data-testid="badge-total-difference">
                    Total delta: {fmtMoney(totalDelta)}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2 items-center">
                  <Button
                    onClick={() => runRepair(true)}
                    disabled={previewing || applying || selectedKeys.size === 0}
                    variant="outline"
                    data-testid="button-dry-run"
                  >
                    {previewing ? "Running…" : `Dry-run preview (${selectedKeys.size})`}
                  </Button>
                  <Button
                    onClick={() => runRepair(false)}
                    disabled={previewing || applying || selectedKeys.size === 0}
                    data-testid="button-apply-repair"
                  >
                    <Wrench className="w-4 h-4 mr-2" />
                    {applying ? "Applying…" : `Apply repair (${selectedKeys.size})`}
                  </Button>
                  <span className="text-sm text-gray-600 ml-2">
                    Selected delta: <strong>{fmtMoney(selectedDelta)}</strong>
                  </span>
                </div>
              </CardContent>
            </Card>

            {preview && (
              <Card className="mb-4 border-amber-300">
                <CardHeader>
                  <CardTitle className="text-base">
                    Dry-run preview — {preview.parentCount} ticket(s), delta {fmtMoney(preview.totalDifference)}
                    {preview.skipped.length > 0 && (
                      <span className="ml-2 text-xs text-red-700">
                        ({preview.skipped.length} skipped)
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 max-h-96 overflow-auto">
                  {preview.parents.map((p) => (
                    <div key={`${p.source}:${p.parentId}`} className="border rounded p-3 bg-amber-50">
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-semibold">
                          <Badge variant="secondary" className="mr-2">{sourceLabel(p.source)}</Badge>
                          <Link
                            href={p.source === 'work_order'
                              ? `/work-orders?openWorkOrder=${p.parentId}`
                              : `/billing-sheets?openSheet=${p.parentId}`}
                          >
                            <a
                              className="underline text-blue-700 hover:text-blue-900"
                              data-testid={`link-preview-${p.source}-${p.parentId}`}
                            >
                              {p.parentNumber}
                            </a>
                          </Link>
                          <Badge variant="outline" className="ml-2 capitalize">{p.classification}</Badge>
                        </span>
                        <span className="text-sm">
                          Total: {fmtMoney(p.oldTotalAmount)} → <strong>{fmtMoney(p.newTotalAmount)}</strong>
                        </span>
                      </div>
                      <div className="text-sm text-gray-700">
                        Labor rate {fmtMoney(p.oldLaborRate)}/hr → <strong>{fmtMoney(p.newLaborRate)}/hr</strong>
                        {" · "}
                        Labor subtotal {fmtMoney(p.oldLaborSubtotal)} → <strong>{fmtMoney(p.newLaborSubtotal)}</strong>
                      </div>
                    </div>
                  ))}
                  {preview.skipped.length > 0 && (
                    <div className="border rounded p-3 bg-red-50 text-sm">
                      <div className="font-semibold mb-1 text-red-800">Skipped</div>
                      <ul className="list-disc pl-5 space-y-0.5">
                        {preview.skipped.map((s) => (
                          <li key={`skip:${s.source}:${s.parentId}`}>
                            <Badge variant="secondary" className="mr-1">{sourceLabel(s.source)}</Badge>
                            #{s.parentId}: {s.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="p-3 text-left">
                          <Checkbox
                            checked={allSelected}
                            onCheckedChange={toggleAll}
                            data-testid="checkbox-select-all"
                          />
                        </th>
                        <th className="p-3 text-left">Type</th>
                        <th className="p-3 text-left">Number</th>
                        <th className="p-3 text-left">Customer</th>
                        <th className="p-3 text-left">Date</th>
                        <th className="p-3 text-right">Hours</th>
                        <th className="p-3 text-right">Stored rate</th>
                        <th className="p-3 text-left">Classification</th>
                        <th className="p-3 text-right">Expected rate</th>
                        <th className="p-3 text-right">Labor subtotal</th>
                        <th className="p-3 text-right">Total</th>
                        <th className="p-3 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const key = rowKey(r.source, r.parentId);
                        const classification = getClassification(r);
                        const expected = computeExpected(r, classification);
                        const delta = parseFloat(expected.totalAmount) - parseFloat(r.storedTotalAmount);
                        return (
                          <tr
                            key={key}
                            className="border-b hover:bg-gray-50"
                            data-testid={`row-audit-ticket-${r.source}-${r.parentId}`}
                          >
                            <td className="p-3">
                              <Checkbox
                                checked={selectedKeys.has(key)}
                                onCheckedChange={() => toggle(r.source, r.parentId)}
                                data-testid={`checkbox-ticket-${r.source}-${r.parentId}`}
                              />
                            </td>
                            <td className="p-3">
                              <Badge variant="secondary">{sourceLabel(r.source)}</Badge>
                            </td>
                            <td className="p-3 font-mono text-xs">
                              <Link
                                href={r.source === 'work_order'
                                  ? `/work-orders?openWorkOrder=${r.parentId}`
                                  : `/billing-sheets?openSheet=${r.parentId}`}
                              >
                                <a
                                  className="underline text-blue-700 hover:text-blue-900"
                                  data-testid={`link-ticket-${r.source}-${r.parentId}`}
                                >
                                  {r.parentNumber}
                                </a>
                              </Link>
                            </td>
                            <td className="p-3">{r.customerName}</td>
                            <td className="p-3">{fmtDate(r.workDate)}</td>
                            <td className="p-3 text-right">{r.totalHours}</td>
                            <td className="p-3 text-right">{fmtMoney(r.storedLaborRate)}</td>
                            <td className="p-3">
                              <Select
                                value={classification}
                                onValueChange={(v) => setClassification(r, v as Classification)}
                              >
                                <SelectTrigger
                                  className="h-8 w-32"
                                  data-testid={`select-classification-${r.source}-${r.parentId}`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="standard">Standard</SelectItem>
                                  <SelectItem value="emergency">Emergency</SelectItem>
                                </SelectContent>
                              </Select>
                            </td>
                            <td className="p-3 text-right">{fmtMoney(expected.rate)}</td>
                            <td className="p-3 text-right">
                              <div className="text-xs text-gray-500 line-through">
                                {fmtMoney(r.storedLaborSubtotal)}
                              </div>
                              <div className="font-semibold">{fmtMoney(expected.laborSubtotal)}</div>
                            </td>
                            <td className="p-3 text-right">
                              <div className="text-xs text-gray-500 line-through">
                                {fmtMoney(r.storedTotalAmount)}
                              </div>
                              <div className="font-semibold">{fmtMoney(expected.totalAmount)}</div>
                              <div className={`text-xs ${delta >= 0 ? "text-amber-700" : "text-emerald-700"}`}>
                                {delta >= 0 ? "+" : ""}{fmtMoney(delta)}
                              </div>
                            </td>
                            <td className="p-3">
                              <Badge variant="outline">{r.status}</Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </PageContent>
    </PageContainer>
  );
}
