import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, AlertTriangle, RefreshCw, Wrench, ShieldCheck, Lock, DollarSign, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer, PageContent, PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type AuditSource = "billing_sheet" | "work_order" | "invoice";

function sourceLabel(source: AuditSource): string {
  switch (source) {
    case "billing_sheet": return "BS";
    case "work_order":    return "WO";
    case "invoice":       return "INV";
  }
}

interface AuditRow {
  source: AuditSource;
  itemId: number;
  parentId: number;
  parentNumber: string;
  customerId: number | null;
  customerName: string;
  workDate: string | null;
  technicianName: string;
  status: string;
  invoiceId: number | null;
  quickbooksInvoiceId: string | null;
  partId: number;
  partName: string;
  quantity: string;
  storedUnitPrice: string;
  storedTotalPrice: string;
  catalogUnitPrice: string;
  expectedTotalPrice: string;
  difference: string;
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
  oldPartsSubtotal: string;
  newPartsSubtotal: string;
  oldTotalAmount: string;
  newTotalAmount: string;
  invoicePaid?: boolean;
  sentToQuickBooks?: boolean;
  updatedItems: Array<{
    itemId: number;
    partName: string;
    oldUnitPrice: string;
    newUnitPrice: string;
    oldTotalPrice: string;
    newTotalPrice: string;
  }>;
}

interface RepairResponse {
  dryRun: boolean;
  parentCount: number;
  itemCount: number;
  totalDifference: string;
  parents: RepairParentSummary[];
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

function selectionKey(source: AuditSource, itemId: number) {
  return `${source}:${itemId}`;
}

export default function BillingZeroPriceAuditPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<RepairResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<AuditResponse>({
    queryKey: ["/api/admin/billing-sheets/zero-price-audit"],
  });
  // The shared fetch helper throws errors formatted as "<status>: <body>".
  // Detect a 403 so we can show a clear "no access" state instead of the
  // generic failure card (Task #163).
  const isForbidden = isError && error instanceof Error && /^403[:\s]/.test(error.message);

  const rows = data?.rows ?? [];
  const allSelected = rows.length > 0 && rows.every((r) => selectedKeys.has(selectionKey(r.source, r.itemId)));
  const selectedRows = useMemo(
    () => rows.filter((r) => selectedKeys.has(selectionKey(r.source, r.itemId))),
    [rows, selectedKeys],
  );
  const totalDifference = useMemo(
    () => rows.reduce((sum, r) => sum + parseFloat(r.difference), 0),
    [rows],
  );
  const selectedDifference = useMemo(
    () => selectedRows.reduce((sum, r) => sum + parseFloat(r.difference), 0),
    [selectedRows],
  );

  function toggle(source: AuditSource, id: number) {
    const key = selectionKey(source, id);
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedKeys(next);
  }
  function toggleAll() {
    if (allSelected) setSelectedKeys(new Set());
    else setSelectedKeys(new Set(rows.map((r) => selectionKey(r.source, r.itemId))));
  }

  async function runRepair(dryRun: boolean) {
    if (dryRun) setPreviewing(true);
    else setApplying(true);
    try {
      const selection = Array.from(selectedKeys).map((k) => {
        const [source, idStr] = k.split(":");
        return { source: source as AuditSource, itemId: parseInt(idStr) };
      });
      const result = (await apiRequest(
        "/api/admin/billing-sheets/zero-price-audit/repair",
        "POST",
        { selection, dryRun },
      )) as RepairResponse;
      if (dryRun) {
        setPreview(result);
        toast({
          title: "Dry-run complete",
          description: `${result.parentCount} record(s), ${result.itemCount} item(s), delta ${fmtMoney(result.totalDifference)}.`,
        });
      } else {
        setPreview(null);
        setSelectedKeys(new Set());
        toast({
          title: "Repaired",
          description: `${result.parentCount} record(s), ${result.itemCount} item(s) repriced (${fmtMoney(result.totalDifference)}).`,
        });
        qc.invalidateQueries({ queryKey: ["/api/admin/billing-sheets/zero-price-audit"] });
        qc.invalidateQueries({ queryKey: ["/api/billing-sheets"] });
        qc.invalidateQueries({ queryKey: ["/api/work-orders"] });
        qc.invalidateQueries({ queryKey: ["/api/invoices"] });
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
  const invoiceRowCount = rows.filter((r) => r.source === "invoice").length;

  return (
    <PageContainer>
      <PageHeader
        title="Catalog $0 Price Audit"
        subtitle="Find and repair billing sheet, work order, AND invoice line items saved at $0 for catalog parts that should have a non-zero price."
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
                The catalog $0 price audit is limited to company admins, billing managers, and super admins.
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
            <CardContent className="py-12 text-center">
              <ShieldCheck className="w-12 h-12 text-green-600 mx-auto mb-3" />
              <h3 className="text-lg font-semibold mb-1">All clear</h3>
              <p className="text-sm text-gray-600">
                No billing sheet, work order, or invoice line items have a $0 unit price for a catalog part.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="mb-4">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                  {rows.length} affected line item{rows.length === 1 ? "" : "s"}
                  <Badge variant="outline">Billing sheets: {billingRowCount}</Badge>
                  <Badge variant="outline">Work orders: {workOrderRowCount}</Badge>
                  <Badge variant="outline">Invoices: {invoiceRowCount}</Badge>
                  <Badge variant="outline" className="ml-2" data-testid="badge-total-difference">
                    Total under-billed: {fmtMoney(totalDifference)}
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
                    Selected delta: <strong>{fmtMoney(selectedDifference)}</strong>
                  </span>
                </div>
              </CardContent>
            </Card>

            {preview && (
              <Card className="mb-4 border-amber-300">
                <CardHeader>
                  <CardTitle className="text-base">
                    Dry-run preview — {preview.parentCount} record(s), {preview.itemCount} item(s), delta {fmtMoney(preview.totalDifference)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 max-h-96 overflow-auto">
                  {preview.parents.map((p) => (
                    <div key={`${p.source}:${p.parentId}`} className="border rounded p-3 bg-amber-50">
                      <div className="flex justify-between items-center mb-2 gap-2 flex-wrap">
                        <span className="font-semibold flex items-center gap-1 flex-wrap">
                          <Badge variant="secondary" className="mr-1">{sourceLabel(p.source)}</Badge>
                          {p.parentNumber}
                          {p.invoicePaid && (
                            <Badge
                              variant="destructive"
                              className="bg-amber-600 hover:bg-amber-600"
                              data-testid={`preview-badge-paid-${p.parentId}`}
                            >
                              <DollarSign className="w-3 h-3 mr-0.5" />
                              paid
                            </Badge>
                          )}
                          {p.sentToQuickBooks && (
                            <Badge
                              variant="destructive"
                              className="bg-blue-700 hover:bg-blue-700"
                              data-testid={`preview-badge-qbo-${p.parentId}`}
                            >
                              <ExternalLink className="w-3 h-3 mr-0.5" />
                              sent to QuickBooks
                            </Badge>
                          )}
                        </span>
                        <span className="text-sm">
                          Total: {fmtMoney(p.oldTotalAmount)} → <strong>{fmtMoney(p.newTotalAmount)}</strong>
                        </span>
                      </div>
                      {(p.invoicePaid || p.sentToQuickBooks) && (
                        <p
                          className="text-xs text-amber-800 mb-2 flex items-start gap-1"
                          data-testid={`preview-warning-note-${p.parentId}`}
                        >
                          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                          <span>
                            Heads up: this invoice is{" "}
                            {p.invoicePaid && <strong>already paid</strong>}
                            {p.invoicePaid && p.sentToQuickBooks && " and "}
                            {p.sentToQuickBooks && <strong>already in QuickBooks</strong>}
                            . Applying this repair will change the invoice total in IrrigoPro — you'll likely also need to adjust the invoice in QuickBooks so the customer-facing copy matches.
                          </span>
                        </p>
                      )}
                      <ul className="text-sm space-y-1">
                        {p.updatedItems.map((it) => (
                          <li key={it.itemId} className="flex justify-between">
                            <span>{it.partName}</span>
                            <span>
                              {fmtMoney(it.oldTotalPrice)} → {fmtMoney(it.newTotalPrice)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
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
                        <th className="p-3 text-left">Technician</th>
                        <th className="p-3 text-left">Part</th>
                        <th className="p-3 text-right">Qty</th>
                        <th className="p-3 text-right">Stored unit</th>
                        <th className="p-3 text-right">Catalog unit</th>
                        <th className="p-3 text-right">Δ Total</th>
                        <th className="p-3 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const key = selectionKey(r.source, r.itemId);
                        return (
                          <tr
                            key={key}
                            className="border-b hover:bg-gray-50"
                            data-testid={`row-audit-item-${r.source}-${r.itemId}`}
                          >
                            <td className="p-3">
                              <Checkbox
                                checked={selectedKeys.has(key)}
                                onCheckedChange={() => toggle(r.source, r.itemId)}
                                data-testid={`checkbox-item-${r.source}-${r.itemId}`}
                              />
                            </td>
                            <td className="p-3">
                              <Badge variant="secondary">{sourceLabel(r.source)}</Badge>
                            </td>
                            <td className="p-3 font-mono text-xs">{r.parentNumber}</td>
                            <td className="p-3">{r.customerName}</td>
                            <td className="p-3">{fmtDate(r.workDate)}</td>
                            <td className="p-3">{r.technicianName}</td>
                            <td className="p-3">{r.partName}</td>
                            <td className="p-3 text-right">{r.quantity}</td>
                            <td className="p-3 text-right">{fmtMoney(r.storedUnitPrice)}</td>
                            <td className="p-3 text-right">{fmtMoney(r.catalogUnitPrice)}</td>
                            <td className="p-3 text-right font-semibold text-amber-700">
                              +{fmtMoney(r.difference)}
                            </td>
                            <td className="p-3">
                              <div className="flex flex-wrap gap-1 items-center">
                                <Badge variant="outline">{r.status}</Badge>
                                {r.invoiceId && (
                                  <Badge variant="secondary">invoiced</Badge>
                                )}
                                {r.source === "invoice" && r.status?.toLowerCase() === "paid" && (
                                  <Badge
                                    variant="destructive"
                                    className="bg-amber-600 hover:bg-amber-600"
                                    data-testid={`badge-paid-${r.itemId}`}
                                    title="This invoice is already marked paid. Repairing it will silently change the total — you may also need to adjust the customer copy."
                                  >
                                    <DollarSign className="w-3 h-3 mr-0.5" />
                                    paid
                                  </Badge>
                                )}
                                {r.source === "invoice" && r.quickbooksInvoiceId && (
                                  <Badge
                                    variant="destructive"
                                    className="bg-blue-700 hover:bg-blue-700"
                                    data-testid={`badge-qbo-${r.itemId}`}
                                    title={`Sent to QuickBooks (id ${r.quickbooksInvoiceId}). Also adjust the invoice in QuickBooks to keep the customer-facing copy in sync.`}
                                  >
                                    <ExternalLink className="w-3 h-3 mr-0.5" />
                                    sent to QuickBooks
                                  </Badge>
                                )}
                              </div>
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
