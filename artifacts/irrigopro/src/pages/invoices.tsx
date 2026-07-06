import { useState, useMemo, useEffect } from "react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Search,
  Calendar,
  FileText,
  CheckCircle2,
  RefreshCw,
  Loader2,
  AlertCircle,
  ChevronLeft,
  DollarSign,
  ClipboardList,
  Download,
  GitMerge,
  X,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
  MoreHorizontal,
  Edit3,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { InvoicePdfPreviewModal } from "@/components/billing/invoice-pdf-preview-modal";
import { InvoiceAuditModal } from "@/components/billing/invoice-audit-modal";
import { FinancialPulseWidget } from "@/components/financial-pulse/financial-pulse-widget";
import { exportSingleInvoiceCsv } from "@/lib/invoice-csv";
import { safeGet } from "@/utils/safeStorage";
import { InvoiceCorrectionFlow } from "@/pages/invoices/InvoiceCorrectionFlow";

const CSV_EXPORT_ROLES = new Set([
  "company_admin",
  "billing_manager",
]);

// Task #1425 — merging duplicate monthly invoices is restricted to the same
// billing-capable roles as monthly invoice creation (requireBillingAccess).
const MERGE_ROLES = new Set([
  "company_admin",
  "billing_manager",
]);

function getCurrentUserRole(): string | null {
  try {
    const raw = safeGet("user");
    if (!raw) return null;
    const u = JSON.parse(raw);
    return typeof u?.role === "string" ? u.role : null;
  } catch {
    return null;
  }
}

interface Invoice {
  id: number;
  invoiceNumber: string;
  customerId: number;
  customerName: string;
  customerEmail: string;
  totalAmount: string;
  partsSubtotal?: string;
  laborSubtotal?: string;
  periodStart: string;
  periodEnd: string;
  invoiceMonth: number;
  invoiceYear: number;
  status: string;
  createdAt: string;
  sentAt?: string | null;
  dueDate?: string | null;
  quickbooksInvoiceId?: string;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function generateMonthOptions() {
  const months = [];
  const currentDate = new Date();
  for (let i = 0; i < 24; i++) {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const label = `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
    months.push({ value, label });
  }
  return months;
}

function formatCurrency(amount: string | number) {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num);
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function toIsoDate(value: string | null | undefined) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function csvEscape(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // Neutralize CSV/spreadsheet formula injection: prefix risky leading chars
  // so Excel/Sheets/Numbers do not evaluate them as formulas.
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildInvoicesCsv(invoices: Invoice[]) {
  const headers = [
    "Billing Period",
    "Invoice Number",
    "Customer",
    "Status",
    "QuickBooks Sync Status",
    "Subtotal",
    "Tax",
    "Total",
    "Issued Date",
    "Due Date",
  ];
  const rows = invoices.map((inv) => {
    const period = `${inv.invoiceYear}-${String(inv.invoiceMonth).padStart(2, "0")}`;
    const total = parseFloat(inv.totalAmount) || 0;
    const parts = parseFloat(inv.partsSubtotal ?? "0") || 0;
    const labor = parseFloat(inv.laborSubtotal ?? "0") || 0;
    const subtotal = parts + labor;
    const tax = Math.max(0, +(total - subtotal).toFixed(2));
    const issued = toIsoDate(inv.sentAt ?? inv.createdAt);
    const due = toIsoDate(inv.dueDate);
    const qbStatus = inv.quickbooksInvoiceId ? "Synced" : "Not synced";
    return [
      period,
      inv.invoiceNumber,
      inv.customerName,
      inv.status,
      qbStatus,
      subtotal.toFixed(2),
      tax.toFixed(2),
      total.toFixed(2),
      issued,
      due,
    ].map(csvEscape).join(",");
  });
  return [headers.join(","), ...rows].join("\r\n") + "\r\n";
}

function getStatusBadge(status: string) {
  switch (status.toLowerCase()) {
    case "generated":
      return <Badge className="bg-blue-100 text-blue-800">Generated</Badge>;
    case "sent":
      return <Badge className="bg-green-100 text-green-800">Sent</Badge>;
    case "paid":
      return <Badge className="bg-emerald-100 text-emerald-800">Paid</Badge>;
    case "overdue":
      return <Badge className="bg-red-100 text-red-800">Overdue</Badge>;
    default:
      return <Badge className="bg-gray-100 text-gray-800">{status}</Badge>;
  }
}

function groupByBillingPeriod(invoices: Invoice[]) {
  const groups: Record<string, Invoice[]> = {};
  for (const invoice of invoices) {
    const key = `${invoice.invoiceYear}-${String(invoice.invoiceMonth).padStart(2, "0")}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(invoice);
  }
  const sorted = Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  return sorted.map(([key, items]) => {
    const [year, month] = key.split("-");
    return {
      key,
      label: `${MONTH_NAMES[parseInt(month) - 1]} ${year}`,
      invoices: items,
    };
  });
}

type SortKey = "customer" | "invoiceNumber" | "status" | "quickbooks" | "amount" | "period";
type SortDir = "asc" | "desc";
interface SortState {
  key: SortKey;
  dir: SortDir;
}

function compareInvoices(a: Invoice, b: Invoice, key: SortKey): number {
  switch (key) {
    case "customer":
      return a.customerName.localeCompare(b.customerName, undefined, { sensitivity: "base" });
    case "invoiceNumber":
      return a.invoiceNumber.localeCompare(b.invoiceNumber, undefined, { numeric: true, sensitivity: "base" });
    case "status":
      return a.status.localeCompare(b.status, undefined, { sensitivity: "base" });
    case "quickbooks":
      return Number(!!a.quickbooksInvoiceId) - Number(!!b.quickbooksInvoiceId);
    case "amount":
      return (parseFloat(a.totalAmount) || 0) - (parseFloat(b.totalAmount) || 0);
    case "period":
      return new Date(a.periodStart).getTime() - new Date(b.periodStart).getTime();
  }
}

function sortInvoices(invoices: Invoice[], sort: SortState | null): Invoice[] {
  if (!sort) return invoices;
  const sorted = [...invoices].sort((a, b) => {
    const cmp = compareInvoices(a, b, sort.key);
    return sort.dir === "asc" ? cmp : -cmp;
  });
  return sorted;
}

function SortableHeader({
  sortKey,
  label,
  sort,
  onSort,
  align = "left",
}: {
  sortKey: SortKey;
  label: string;
  sort: SortState | null;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort?.key === sortKey;
  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 whitespace-nowrap font-medium hover:text-gray-900 ${
          active ? "text-gray-900" : "text-muted-foreground"
        } ${align === "right" ? "flex-row-reverse" : ""}`}
        data-testid={`sort-${sortKey}`}
        aria-sort={active ? (sort?.dir === "asc" ? "ascending" : "descending") : "none"}
      >
        {label}
        {active ? (
          sort?.dir === "asc" ? (
            <ArrowUp className="w-3.5 h-3.5" />
          ) : (
            <ArrowDown className="w-3.5 h-3.5" />
          )
        ) : (
          <ChevronsUpDown className="w-3.5 h-3.5 opacity-40" />
        )}
      </button>
    </TableHead>
  );
}

// Task #708 — A/R aging filter values mirror the
// `/api/financial-pulse/ar-aging` bucket keys (with `days90Plus`
// matching the inclusive 90+ bucket). The mapping lives here so the
// widget can deep-link via `?aging=`.
type AgingFilter = "all" | "current" | "days30" | "days60" | "days90Plus";
const AGING_OPTIONS: { value: AgingFilter; label: string }[] = [
  { value: "all", label: "All ages" },
  { value: "current", label: "Current (0–29 days)" },
  { value: "days30", label: "30–59 days" },
  { value: "days60", label: "60–89 days" },
  { value: "days90Plus", label: "90+ days" },
];

function parseAging(search: string): AgingFilter {
  const v = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("aging");
  if (v === "current" || v === "days30" || v === "days60" || v === "days90Plus") {
    return v;
  }
  return "all";
}

function readAgingFromUrl(): AgingFilter {
  if (typeof window === "undefined") return "all";
  return parseAging(window.location.search);
}

// Same exclusion set as `computeOutstandingAr` — paid / draft /
// cancelled invoices are not part of A/R aging.
function isOpenAr(inv: Invoice): boolean {
  if (inv.status === "draft" || inv.status === "cancelled" || inv.status === "paid") {
    return false;
  }
  // The server's `computeOutstandingAr` also excludes any invoice
  // with a non-null paidAt. We mirror that here.
  return !inv.sentAt || true; // keep all non-terminal statuses; paidAt check below
}

function ageInDays(inv: Invoice, now: Date): number {
  const d = new Date(inv.createdAt);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.floor((now.getTime() - d.getTime()) / 86_400_000);
}

function matchesAging(inv: Invoice, filter: AgingFilter, now: Date): boolean {
  if (filter === "all") return true;
  if (!isOpenAr(inv)) return false;
  // `paidAt` may or may not be on the wire — guard it.
  if ((inv as unknown as { paidAt?: string | null }).paidAt) return false;
  const days = ageInDays(inv, now);
  switch (filter) {
    case "current":
      return days < 30;
    case "days30":
      return days >= 30 && days < 60;
    case "days60":
      return days >= 60 && days < 90;
    case "days90Plus":
      return days >= 90;
  }
}

export default function InvoicesPage() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [monthFilter, setMonthFilter] = useState("all");
  // Task #708 — deep-linked A/R aging filter, driven by `?aging=` in
  // the URL when arriving from the FP A/R Aging widget. The
  // `useSearch()` hook from wouter is reactive to query-string
  // changes (including `setLocation('/invoices?aging=…')` from the
  // FP widget on the same mounted page), so an in-page bucket click
  // re-applies the filter immediately. We still keep local state so
  // the `<Select>` control can override the URL without triggering a
  // navigation. The effect below resyncs state whenever the URL
  // changes underneath us.
  const search = useSearch();
  const [agingFilter, setAgingFilter] = useState<AgingFilter>(() => readAgingFromUrl());
  useEffect(() => {
    const next = parseAging(search ?? "");
    setAgingFilter((prev) => (prev === next ? prev : next));
  }, [search]);
  const [sort, setSort] = useState<SortState | null>(null);
  const toggleSort = (key: SortKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  };
  const [pdfModal, setPdfModal] = useState<{ id: number; number: string; email: string } | null>(null);
  const [auditInvoice, setAuditInvoice] = useState<{ id: number; label: string; total: string } | null>(null);
  const [exportingInvoiceId, setExportingInvoiceId] = useState<number | null>(null);
  const userRole = getCurrentUserRole();
  const canExportSingleCsv = !!userRole && CSV_EXPORT_ROLES.has(userRole);
  const canMerge = !!userRole && MERGE_ROLES.has(userRole);
  // Task #1438 — same billing-capable role set as merge/export.
  const canMarkSent = !!userRole && MERGE_ROLES.has(userRole);

  // Task #1425 — invoice merge selection. `selectedIds` holds the invoices
  // ticked for merging; `survivingId` is the chosen survivor in the confirm
  // dialog; `mergeConfirmOpen` toggles that dialog.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [mergeConfirmOpen, setMergeConfirmOpen] = useState(false);
  const [survivingId, setSurvivingId] = useState<number | null>(null);
  // Task #1443 — invoice queued for a confirmed QuickBooks re-sync (it already
  // carries a quickbooksInvoiceId, so this forces a fresh QB invoice).
  const [resyncInvoice, setResyncInvoice] = useState<Invoice | null>(null);
  // Task #1710 — Invoice Correction & Reissue.
  const [correctionInvoice, setCorrectionInvoice] = useState<Invoice | null>(null);
  const canCorrect = !!userRole && MERGE_ROLES.has(userRole);

  const handleExportSingleCsv = async (invoice: Invoice) => {
    if (!canExportSingleCsv) return;
    setExportingInvoiceId(invoice.id);
    try {
      await exportSingleInvoiceCsv(invoice);
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Unable to export CSV",
        variant: "destructive",
      });
    } finally {
      setExportingInvoiceId(null);
    }
  };

  // Task #532 — switched from useQuery(limit=500) to useInfiniteQuery
  // with 50-row pages. First paint shows 50 invoices instead of waiting
  // for up to 500. Driven by the X-Total-Count header set by the
  // server's `paginate()` helper.
  const PAGE_SIZE = 50;
  const {
    data: invoicePages,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<{ rows: Invoice[]; total: number; nextOffset: number | null }>({
    queryKey: ["/api/invoices", { paginated: true, pageSize: PAGE_SIZE }],
    initialPageParam: 0,
    queryFn: async ({ pageParam = 0 }) => {
      const offset = Number(pageParam) || 0;
      const res = await fetch(`/api/invoices?limit=${PAGE_SIZE}&offset=${offset}`);
      if (!res.ok) throw new Error("Failed to fetch invoices");
      const rows = (await res.json()) as Invoice[];
      const total = Number(res.headers.get("X-Total-Count") ?? rows.length);
      const consumed = offset + rows.length;
      return { rows, total, nextOffset: consumed < total ? consumed : null };
    },
    getNextPageParam: (last) => last.nextOffset,
  });
  const invoices = useMemo<Invoice[]>(
    () => invoicePages?.pages.flatMap((p) => p.rows) ?? [],
    [invoicePages],
  );

  // Task #1443 — sync/re-sync a single invoice to QuickBooks. A re-sync
  // (existing quickbooksInvoiceId) must pass force:true; the server rejects a
  // non-forced double-create. A fresh sync (null id) omits force.
  const syncMutation = useMutation({
    mutationFn: (vars: { id: number; force?: boolean }) =>
      apiRequest(`/api/invoices/${vars.id}/sync-quickbooks`, "POST", { force: vars.force }),
    onSuccess: () => {
      toast({ title: "Invoice synced to QuickBooks successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    },
    onError: (err: Error) => {
      toast({ title: "QuickBooks sync failed", description: err.message, variant: "destructive" });
    },
  });

  // Task #1438 — record/undo manual delivery of an invoice. mark-sent flips
  // a draft → sent (stamping sentAt); mark-unsent reverts a sent → draft.
  // No email is sent; this only records delivery state.
  const markSentMutation = useMutation({
    mutationFn: (invoiceId: number) => apiRequest(`/api/invoices/${invoiceId}/mark-sent`, "POST"),
    onSuccess: () => {
      toast({ title: "Invoice marked as sent" });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't mark invoice as sent", description: err.message, variant: "destructive" });
    },
  });

  const markUnsentMutation = useMutation({
    mutationFn: (invoiceId: number) => apiRequest(`/api/invoices/${invoiceId}/mark-unsent`, "POST"),
    onSuccess: () => {
      toast({ title: "Invoice marked unsent" });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't mark invoice unsent", description: err.message, variant: "destructive" });
    },
  });

  // Task #1425 — merge mutation. Body is the surviving id plus the rest of
  // the selected ids as the merged set. On success the merged invoices are
  // cancelled (kept for audit) and the survivor carries the combined total.
  const mergeMutation = useMutation({
    mutationFn: (vars: { survivingInvoiceId: number; mergedInvoiceIds: number[] }) =>
      apiRequest(`/api/invoices/merge`, "POST", vars),
    onSuccess: (data: any) => {
      const count = data?.cancelledInvoiceNumbers?.length ?? 0;
      toast({
        title: "Invoices merged",
        description:
          data?.survivingInvoiceNumber
            ? `${count} invoice${count !== 1 ? "s" : ""} merged into ${data.survivingInvoiceNumber}.`
            : "Selected invoices were merged.",
      });
      setMergeConfirmOpen(false);
      setSelectedIds(new Set());
      setSurvivingId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    },
    onError: (err: Error) => {
      toast({ title: "Merge failed", description: err.message, variant: "destructive" });
    },
  });

  const filteredInvoices = useMemo(() => {
    let result = [...invoices];

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      result = result.filter(
        (inv) =>
          inv.customerName.toLowerCase().includes(q) ||
          inv.invoiceNumber.toLowerCase().includes(q)
      );
    }

    if (monthFilter !== "all") {
      const [filterYear, filterMonth] = monthFilter.split("-").map(Number);
      result = result.filter(
        (inv) => inv.invoiceYear === filterYear && inv.invoiceMonth === filterMonth
      );
    }

    if (agingFilter !== "all") {
      const now = new Date();
      result = result.filter((inv) => matchesAging(inv, agingFilter, now));
    }

    return result;
  }, [invoices, searchTerm, monthFilter, agingFilter]);

  const groups = useMemo(() => groupByBillingPeriod(filteredInvoices), [filteredInvoices]);

  // Sorting is applied within each month group so the outer
  // most-recent-first month structure stays intact (Task #1423).
  const sortedInvoices = (items: Invoice[]) => sortInvoices(items, sort);

  const totalBilled = filteredInvoices.reduce((sum, inv) => sum + parseFloat(inv.totalAmount), 0);

  const monthOptions = generateMonthOptions();

  // Task #1425 — an invoice is mergeable only when it isn't already cancelled.
  const isMergeable = (inv: Invoice) => inv.status !== "cancelled";

  const selectedInvoices = useMemo(
    () => filteredInvoices.filter((inv) => selectedIds.has(inv.id)),
    [filteredInvoices, selectedIds],
  );

  // A selection is valid for merge when 2+ invoices share the SAME customer
  // and the SAME billing period (month + year). This mirrors the server's
  // validateMerge guard so the UI never offers an action the API will reject.
  const mergeValidation = useMemo(() => {
    if (selectedInvoices.length < 2) {
      return { ok: false as const, reason: "Select at least two invoices to merge." };
    }
    const first = selectedInvoices[0];
    const sameCustomer = selectedInvoices.every((inv) => inv.customerId === first.customerId);
    if (!sameCustomer) {
      return { ok: false as const, reason: "All selected invoices must belong to the same customer." };
    }
    const samePeriod = selectedInvoices.every(
      (inv) => inv.invoiceMonth === first.invoiceMonth && inv.invoiceYear === first.invoiceYear,
    );
    if (!samePeriod) {
      return { ok: false as const, reason: "All selected invoices must be from the same billing period." };
    }
    return { ok: true as const, reason: "" };
  }, [selectedInvoices]);

  const selectedTotal = selectedInvoices.reduce(
    (sum, inv) => sum + (parseFloat(inv.totalAmount) || 0),
    0,
  );

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const openMergeConfirm = () => {
    if (!mergeValidation.ok) return;
    // Default survivor: the lowest invoice id (earliest created) in the set.
    const defaultSurvivor = selectedInvoices.reduce(
      (min, inv) => (inv.id < min ? inv.id : min),
      selectedInvoices[0].id,
    );
    setSurvivingId(defaultSurvivor);
    setMergeConfirmOpen(true);
  };

  const confirmMerge = () => {
    if (!mergeValidation.ok || survivingId == null) return;
    const mergedInvoiceIds = selectedInvoices
      .map((inv) => inv.id)
      .filter((id) => id !== survivingId);
    mergeMutation.mutate({ survivingInvoiceId: survivingId, mergedInvoiceIds });
  };

  const handleExportCsv = () => {
    if (filteredInvoices.length === 0) return;
    try {
      const csv = buildInvoicesCsv(filteredInvoices);
      const today = new Date().toISOString().slice(0, 10);
      const filename =
        monthFilter !== "all"
          ? `monthly-invoices-${monthFilter}.csv`
          : `monthly-invoices-${today}.csv`;
      const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Unable to generate CSV",
        variant: "destructive",
      });
    }
  };

  // Task #1439 — compact presentation helpers shared by the desktop
  // table and the mobile card fallback.
  const periodLabelOf = (inv: Invoice) =>
    `${MONTH_NAMES[inv.invoiceMonth - 1]} ${inv.invoiceYear}`;
  const periodRangeOf = (inv: Invoice) =>
    `${formatDate(inv.periodStart)} – ${formatDate(inv.periodEnd)}`;

  const renderQbIcon = (inv: Invoice) => (
    <span
      className="inline-flex"
      title={inv.quickbooksInvoiceId ? "Synced to QuickBooks" : "Not synced to QuickBooks"}
    >
      <CheckCircle2
        className={`w-3.5 h-3.5 ${inv.quickbooksInvoiceId ? "text-emerald-600" : "text-gray-300"}`}
        aria-label={inv.quickbooksInvoiceId ? "Synced to QuickBooks" : "Not synced to QuickBooks"}
      />
    </span>
  );

  const renderActionsMenu = (invoice: Invoice) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          data-testid={`button-invoice-actions-${invoice.id}`}
        >
          <span className="sr-only">Open actions for invoice {invoice.invoiceNumber}</span>
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          onSelect={() =>
            setAuditInvoice({
              id: invoice.id,
              label: `${periodLabelOf(invoice)} · #${invoice.invoiceNumber}`,
              total: formatCurrency(invoice.totalAmount),
            })
          }
        >
          <ClipboardList className="w-3.5 h-3.5 mr-2" />
          Audit
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            setPdfModal({
              id: invoice.id,
              number: invoice.invoiceNumber,
              email: invoice.customerEmail,
            })
          }
        >
          <FileText className="w-3.5 h-3.5 mr-2" />
          View PDF
        </DropdownMenuItem>
        {canMarkSent && invoice.status === "draft" && (
          <DropdownMenuItem
            disabled={markSentMutation.isPending && markSentMutation.variables === invoice.id}
            onSelect={(e) => {
              e.preventDefault();
              markSentMutation.mutate(invoice.id);
            }}
            data-testid={`button-mark-sent-invoice-${invoice.id}`}
          >
            {markSentMutation.isPending && markSentMutation.variables === invoice.id ? (
              <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 mr-2" />
            )}
            Mark sent
          </DropdownMenuItem>
        )}
        {canMarkSent && invoice.status === "sent" && (
          <DropdownMenuItem
            disabled={markUnsentMutation.isPending && markUnsentMutation.variables === invoice.id}
            onSelect={(e) => {
              e.preventDefault();
              markUnsentMutation.mutate(invoice.id);
            }}
            data-testid={`button-mark-unsent-invoice-${invoice.id}`}
          >
            {markUnsentMutation.isPending && markUnsentMutation.variables === invoice.id ? (
              <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
            ) : (
              <X className="w-3.5 h-3.5 mr-2" />
            )}
            Mark unsent
          </DropdownMenuItem>
        )}
        {canExportSingleCsv && (
          <DropdownMenuItem
            disabled={exportingInvoiceId === invoice.id}
            onSelect={(e) => {
              e.preventDefault();
              handleExportSingleCsv(invoice);
            }}
            data-testid={`button-export-invoice-csv-${invoice.id}`}
          >
            {exportingInvoiceId === invoice.id ? (
              <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5 mr-2" />
            )}
            Export CSV
          </DropdownMenuItem>
        )}
        {!invoice.quickbooksInvoiceId ? (
          <DropdownMenuItem
            disabled={syncMutation.isPending}
            onSelect={(e) => {
              e.preventDefault();
              syncMutation.mutate({ id: invoice.id });
            }}
          >
            {syncMutation.isPending && syncMutation.variables?.id === invoice.id ? (
              <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 mr-2" />
            )}
            Sync to QuickBooks
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            disabled={syncMutation.isPending}
            onSelect={(e) => {
              e.preventDefault();
              setResyncInvoice(invoice);
            }}
          >
            {syncMutation.isPending && syncMutation.variables?.id === invoice.id ? (
              <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 mr-2" />
            )}
            Re-sync to QuickBooks
          </DropdownMenuItem>
        )}
        {/* Task #1710 — Correct / Reissue. Only available on issued invoices. */}
        {canCorrect && ["sent", "paid", "overdue"].includes(invoice.status) && (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setCorrectionInvoice(invoice);
            }}
            data-testid={`button-correct-invoice-${invoice.id}`}
          >
            <Edit3 className="w-3.5 h-3.5 mr-2" />
            Correct / Reissue
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-64 p-8">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
        <span className="ml-2 text-gray-600">Loading invoices...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-8 text-center">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-red-600" />
            <p className="text-gray-600">Failed to load invoices. Please try again.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto p-4 lg:p-6">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <Link href="/">
              <Button variant="ghost" size="sm" className="text-gray-500 hover:text-gray-700 p-1 h-auto">
                <ChevronLeft className="w-4 h-4 mr-1" />
                Dashboard
              </Button>
            </Link>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <FileText className="w-6 h-6 text-blue-600" />
                Monthly Invoices
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">All invoices sent across all customers</p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportCsv}
                disabled={filteredInvoices.length === 0}
                data-testid="button-export-csv"
              >
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
              {filteredInvoices.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-right">
                  <div className="text-xs text-blue-600 font-medium">Total Billed</div>
                  <div className="text-lg font-bold text-blue-800">{formatCurrency(totalBilled)}</div>
                  <div className="text-xs text-blue-500">{filteredInvoices.length} invoice{filteredInvoices.length !== 1 ? "s" : ""}</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Task #708 — A/R Aging widget. Bucket clicks deep-link
            back to this page with `?aging=<key>`, which hydrates the
            aging filter below. */}
        <div className="mb-6">
          <FinancialPulseWidget variant="ar-aging" />
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search by customer name or invoice number..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={monthFilter} onValueChange={setMonthFilter}>
            <SelectTrigger className="w-full sm:w-52">
              <Calendar className="w-4 h-4 mr-2 text-gray-400" />
              <SelectValue placeholder="All months" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Months</SelectItem>
              {monthOptions.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={agingFilter}
            onValueChange={(v) => setAgingFilter(v as AgingFilter)}
          >
            <SelectTrigger
              className="w-full sm:w-52"
              data-testid="invoices-aging-filter"
            >
              <AlertCircle className="w-4 h-4 mr-2 text-gray-400" />
              <SelectValue placeholder="All ages" />
            </SelectTrigger>
            <SelectContent>
              {AGING_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Empty state */}
        {groups.length === 0 && (
          <Card>
            <CardContent className="p-12 text-center">
              <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="font-medium text-gray-500">No invoices found</p>
              <p className="text-sm text-gray-400 mt-1">
                {searchTerm || monthFilter !== "all"
                  ? "Try adjusting your filters."
                  : "Invoices will appear here once they are generated."}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Grouped invoice list */}
        <div className="space-y-8">
          {groups.map((group) => {
            const groupTotal = group.invoices.reduce((s, inv) => s + parseFloat(inv.totalAmount), 0);
            return (
              <div key={group.key}>
                {/* Month Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-blue-600" />
                    <h2 className="text-base font-semibold text-gray-800">{group.label}</h2>
                    <Badge variant="secondary" className="text-xs">
                      {group.invoices.length} invoice{group.invoices.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                  <span className="text-sm font-semibold text-gray-700">{formatCurrency(groupTotal)}</span>
                </div>

                {/* Invoice Table — desktop (Task #1439: compacted to
                    fit one view; QuickBooks folded into a status icon,
                    period shortened, row actions in a ⋯ menu). */}
                <div className="hidden md:block rounded-lg border border-gray-200 bg-white overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-50 hover:bg-gray-50">
                        {canMerge && <TableHead className="w-8" />}
                        <SortableHeader sortKey="customer" label="Customer" sort={sort} onSort={toggleSort} />
                        <SortableHeader sortKey="invoiceNumber" label="Invoice #" sort={sort} onSort={toggleSort} />
                        <SortableHeader sortKey="status" label="Status" sort={sort} onSort={toggleSort} />
                        <SortableHeader sortKey="amount" label="Amount" sort={sort} onSort={toggleSort} align="right" />
                        <SortableHeader sortKey="period" label="Period" sort={sort} onSort={toggleSort} />
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedInvoices(group.invoices).map((invoice) => (
                        <TableRow key={invoice.id} className="hover:bg-gray-50">
                          {canMerge && (
                            <TableCell className="w-8">
                              {isMergeable(invoice) && (
                                <Checkbox
                                  checked={selectedIds.has(invoice.id)}
                                  onCheckedChange={() => toggleSelected(invoice.id)}
                                  aria-label={`Select invoice ${invoice.invoiceNumber} for merge`}
                                  data-testid={`checkbox-merge-invoice-${invoice.id}`}
                                />
                              )}
                            </TableCell>
                          )}
                          <TableCell className="font-medium text-gray-900 whitespace-nowrap max-w-[200px] truncate">
                            {invoice.customerName}
                          </TableCell>
                          <TableCell className="text-gray-600 whitespace-nowrap">
                            #{invoice.invoiceNumber}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              {getStatusBadge(invoice.status)}
                              {renderQbIcon(invoice)}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-bold text-gray-900 whitespace-nowrap">
                            {formatCurrency(invoice.totalAmount)}
                          </TableCell>
                          <TableCell
                            className="text-xs text-gray-600 whitespace-nowrap"
                            title={periodRangeOf(invoice)}
                          >
                            {periodLabelOf(invoice)}
                          </TableCell>
                          <TableCell className="text-right">
                            {renderActionsMenu(invoice)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Invoice cards — mobile fallback (Task #1439) so the
                    list never overflows on narrow screens. */}
                <div className="md:hidden space-y-3">
                  {sortedInvoices(group.invoices).map((invoice) => (
                    <Card key={invoice.id} className="border-gray-200">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {canMerge && isMergeable(invoice) && (
                              <Checkbox
                                checked={selectedIds.has(invoice.id)}
                                onCheckedChange={() => toggleSelected(invoice.id)}
                                aria-label={`Select invoice ${invoice.invoiceNumber} for merge`}
                                data-testid={`checkbox-merge-invoice-mobile-${invoice.id}`}
                              />
                            )}
                            <div className="min-w-0">
                              <p className="font-medium text-gray-900 truncate">
                                {invoice.customerName}
                              </p>
                              <p className="text-xs text-gray-500">#{invoice.invoiceNumber}</p>
                            </div>
                          </div>
                          {renderActionsMenu(invoice)}
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            {getStatusBadge(invoice.status)}
                            {renderQbIcon(invoice)}
                          </div>
                          <span className="font-bold text-gray-900">
                            {formatCurrency(invoice.totalAmount)}
                          </span>
                        </div>
                        <div
                          className="mt-2 text-xs text-gray-500"
                          title={periodRangeOf(invoice)}
                        >
                          {periodLabelOf(invoice)}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Task #532 — Load more pagination control */}
        {hasNextPage && (
          <div className="flex justify-center pt-2">
            <Button
              variant="outline"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              data-testid="button-load-more-invoices"
            >
              {isFetchingNextPage ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Loading more invoices…
                </>
              ) : (
                <>Load more invoices</>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* PDF Preview Modal */}
      {pdfModal && (
        <InvoicePdfPreviewModal
          invoiceId={pdfModal.id}
          invoiceNumber={pdfModal.number}
          customerEmail={pdfModal.email}
          open={!!pdfModal}
          onOpenChange={(open) => { if (!open) setPdfModal(null); }}
          onExportCsv={
            canExportSingleCsv
              ? async () => {
                  const inv = invoices.find((i) => i.id === pdfModal.id);
                  if (inv) await handleExportSingleCsv(inv);
                }
              : undefined
          }
          isExportingCsv={exportingInvoiceId === pdfModal.id}
        />
      )}

      {/* Audit Modal */}
      {auditInvoice && (
        <InvoiceAuditModal
          open={!!auditInvoice}
          onClose={() => setAuditInvoice(null)}
          invoiceId={auditInvoice.id}
          invoiceLabel={auditInvoice.label}
          invoiceTotal={auditInvoice.total}
        />
      )}

      {/* Task #1425 — merge selection action bar */}
      {canMerge && selectedIds.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white shadow-lg">
          <div className="max-w-6xl mx-auto px-4 lg:px-6 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Button
                variant="ghost"
                size="sm"
                className="text-gray-500"
                onClick={clearSelection}
                data-testid="button-clear-merge-selection"
              >
                <X className="w-4 h-4 mr-1" />
                Clear
              </Button>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">
                  {selectedIds.size} selected · {formatCurrency(selectedTotal)}
                </p>
                {!mergeValidation.ok && (
                  <p className="text-xs text-amber-600 truncate">{mergeValidation.reason}</p>
                )}
              </div>
            </div>
            <Button
              onClick={openMergeConfirm}
              disabled={!mergeValidation.ok}
              data-testid="button-merge-invoices"
            >
              <GitMerge className="w-4 h-4 mr-2" />
              Merge invoices
            </Button>
          </div>
        </div>
      )}

      {/* Task #1425 — merge confirmation dialog */}
      <Dialog open={mergeConfirmOpen} onOpenChange={(open) => { if (!open) setMergeConfirmOpen(false); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Merge invoices</DialogTitle>
            <DialogDescription>
              Choose the invoice to keep. The others will be combined into it and
              marked cancelled (kept for audit). This does not touch QuickBooks.
            </DialogDescription>
          </DialogHeader>

          {mergeValidation.ok && (
            <div className="space-y-4">
              <RadioGroup
                value={survivingId != null ? String(survivingId) : undefined}
                onValueChange={(v) => setSurvivingId(Number(v))}
              >
                <p className="text-sm font-medium text-gray-700">Keep this invoice</p>
                {selectedInvoices.map((inv) => (
                  <label
                    key={inv.id}
                    htmlFor={`survivor-${inv.id}`}
                    className="flex items-center justify-between gap-3 rounded-md border border-gray-200 p-3 cursor-pointer hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <RadioGroupItem
                        value={String(inv.id)}
                        id={`survivor-${inv.id}`}
                        data-testid={`radio-survivor-${inv.id}`}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          #{inv.invoiceNumber}
                        </p>
                        <p className="text-xs text-gray-500 truncate">{inv.customerName}</p>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-gray-700 flex-shrink-0">
                      {formatCurrency(inv.totalAmount)}
                    </span>
                  </label>
                ))}
              </RadioGroup>

              <div className="flex items-center justify-between rounded-md bg-blue-50 border border-blue-200 px-4 py-2">
                <span className="text-sm text-blue-700">Combined total</span>
                <span className="text-base font-bold text-blue-800">
                  {formatCurrency(selectedTotal)}
                </span>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMergeConfirmOpen(false)}
              disabled={mergeMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmMerge}
              disabled={!mergeValidation.ok || survivingId == null || mergeMutation.isPending}
              data-testid="button-confirm-merge"
            >
              {mergeMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Merging…
                </>
              ) : (
                <>
                  <GitMerge className="w-4 h-4 mr-2" />
                  Merge {selectedInvoices.length} invoices
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Task #1443 — confirm a QuickBooks re-sync. The invoice already points
          at a QB invoice; this creates a brand-new QB invoice and overwrites
          the link. The old QB invoice is NOT touched, so warn the user to
          delete it by hand first to avoid a duplicate in QuickBooks. */}
      <Dialog
        open={resyncInvoice != null}
        onOpenChange={(open) => {
          if (!open) setResyncInvoice(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Re-sync to QuickBooks</DialogTitle>
            <DialogDescription>
              {resyncInvoice
                ? `Invoice ${resyncInvoice.invoiceNumber} is already linked to a QuickBooks invoice. Re-syncing creates a brand-new invoice in QuickBooks with the current totals — it does not update or remove the existing one.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Delete the old invoice in QuickBooks first, otherwise you'll
                have two invoices for this customer.
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResyncInvoice(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={syncMutation.isPending}
              onClick={() => {
                if (!resyncInvoice) return;
                syncMutation.mutate(
                  { id: resyncInvoice.id, force: true },
                  { onSettled: () => setResyncInvoice(null) },
                );
              }}
            >
              {syncMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Re-syncing…
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Create new QuickBooks invoice
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Task #1710 — Invoice Correction & Reissue flow */}
      {correctionInvoice && (
        <InvoiceCorrectionFlow
          invoice={correctionInvoice}
          open={correctionInvoice != null}
          onClose={() => setCorrectionInvoice(null)}
        />
      )}
    </div>
  );
}
