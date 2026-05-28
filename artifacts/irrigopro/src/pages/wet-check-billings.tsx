import { useState, useMemo } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { PageContainer, PageContent, PageHeader } from "@/components/ui/page-header";
import { Search, Droplets, Eye, Edit2, ExternalLink, DollarSign } from "lucide-react";
import { useArrayQuery } from "@/lib/queryClient";
import { WetCheckBillingViewModal } from "@/components/wet-check-billings/wet-check-billing-view-modal";
import { WetCheckBillingStatusBadge } from "@/components/wet-check-billings/status-badge";
import { ListRowOverflowMenu } from "@/components/shared/list-row-overflow-menu";
import { ListPageEmptyState } from "@/components/shared/list-page-empty-state";
import type { WetCheckBilling } from "@workspace/db/schema";
import { safeGet } from "@/utils/safeStorage";

// ── Local types ───────────────────────────────────────────────────────────────

type WetCheckBillingListItem = WetCheckBilling & {
  issuesCount: number;
  zonesCount: number;
};

type FilterChipKey = "all" | "submitted" | "pending_manager_review" | "approved_passed_to_billing" | "billed";
type SortKey = "billingNumber" | "customerName" | "technicianName" | "workDate" | "totalAmount" | "status";
type SortDir = "asc" | "desc";

// ── Role helpers ───────────────────────────────────────────────────────────────

function getUserRole(): string | null {
  try {
    const raw = safeGet("user");
    if (!raw) return null;
    return JSON.parse(raw)?.role ?? null;
  } catch {
    return null;
  }
}

function canEditLaborRate(): boolean {
  const role = getUserRole();
  return role === "billing_manager" || role === "company_admin" || role === "super_admin";
}

function canEditZoneLabor(): boolean {
  return canEditLaborRate();
}

function isLocked(item: WetCheckBilling): boolean {
  return item.status === "billed" || item.invoiceId != null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(date: string | Date | null | undefined) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCurrency(val: string | number | null | undefined) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    parseFloat(String(val ?? "0")) || 0,
  );
}

// ── Filter chip ───────────────────────────────────────────────────────────────

const FILTER_CHIPS: { key: FilterChipKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "submitted", label: "Submitted" },
  { key: "pending_manager_review", label: "Pending Review" },
  { key: "approved_passed_to_billing", label: "Approved" },
  { key: "billed", label: "Billed" },
];

function FilterChip({
  label,
  active,
  count,
  onClick,
}: {
  label: string;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
        active
          ? "bg-blue-600 text-white border-blue-600"
          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
      }`}
      data-testid={`filter-chip-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      {label}
      <span
        className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${
          active ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-600"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

// ── Sort header ───────────────────────────────────────────────────────────────

function SortTh({
  label,
  col,
  sort,
  onSort,
  className,
}: {
  label: string;
  col: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (col: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === col;
  return (
    <th
      className={`px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide cursor-pointer select-none whitespace-nowrap hover:text-gray-800 ${className ?? ""}`}
      onClick={() => onSort(col)}
      data-testid={`sort-header-${col}`}
    >
      {label}
      {active && (
        <span className="ml-1 text-gray-400">{sort.dir === "asc" ? "↑" : "↓"}</span>
      )}
    </th>
  );
}

// ── Table row ─────────────────────────────────────────────────────────────────

function WcbRow({
  item,
  onRowClick,
  onOpenModal,
}: {
  item: WetCheckBillingListItem;
  onRowClick: (item: WetCheckBillingListItem) => void;
  onOpenModal: (id: number, action?: "labor-rate" | "zone-labor") => void;
}) {
  const locked = isLocked(item);
  const showEditLabor = canEditLaborRate() && !locked;
  const showEditZone = canEditZoneLabor() && !locked;

  const actions = [
    {
      label: "View",
      icon: <Eye className="w-3.5 h-3.5" />,
      onClick: () => onOpenModal(item.id),
    },
    {
      label: "Edit labor rate",
      icon: <Edit2 className="w-3.5 h-3.5" />,
      onClick: () => onOpenModal(item.id, "labor-rate"),
      hidden: !showEditLabor,
      "data-testid": `action-edit-labor-rate-${item.id}`,
    },
    {
      label: "Edit zone labor",
      icon: <DollarSign className="w-3.5 h-3.5" />,
      onClick: () => onOpenModal(item.id, "zone-labor"),
      hidden: !showEditZone,
    },
    {
      label: "Open in QuickBooks",
      icon: <ExternalLink className="w-3.5 h-3.5" />,
      onClick: () => {
        if (item.invoiceId) {
          window.open(`/invoices?openInvoice=${item.invoiceId}`, "_blank", "noopener");
        }
      },
      hidden: !item.invoiceId,
      separator: true,
    },
  ];

  return (
    <tr
      className="border-b last:border-0 hover:bg-gray-50 cursor-pointer transition-colors"
      onClick={() => onRowClick(item)}
      data-testid={`wcb-row-${item.id}`}
    >
      {/* WC # */}
      <td className="px-4 py-3 whitespace-nowrap">
        <Link
          href={`/wet-checks/${item.wetCheckId}?from=wet-check-billings`}
          onClick={(e) => e.stopPropagation()}
          data-testid={`wcb-wc-link-${item.id}`}
        >
          <span className="text-blue-600 hover:underline text-sm font-mono">
            WC-{item.wetCheckId}
          </span>
        </Link>
      </td>
      {/* Billing # */}
      <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-gray-900">
        {item.billingNumber}
      </td>
      {/* Customer */}
      <td className="px-4 py-3 text-sm text-gray-900 max-w-[160px] truncate">
        {item.customerName}
      </td>
      {/* Property */}
      <td className="px-4 py-3 text-sm text-gray-600 max-w-[160px] truncate">
        {item.propertyAddress}
      </td>
      {/* Technician */}
      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
        {item.technicianName}
      </td>
      {/* Work Date */}
      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
        {formatDate(item.workDate)}
      </td>
      {/* Issues */}
      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap" data-testid={`wcb-issues-${item.id}`}>
        {item.issuesCount} across {item.zonesCount} zone{item.zonesCount !== 1 ? "s" : ""}
      </td>
      {/* Status */}
      <td className="px-4 py-3 whitespace-nowrap">
        <WetCheckBillingStatusBadge status={item.status} />
      </td>
      {/* Total */}
      <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap text-right">
        {formatCurrency(item.totalAmount)}
      </td>
      {/* Overflow menu */}
      <td
        className="px-2 py-3 whitespace-nowrap text-right"
        onClick={(e) => e.stopPropagation()}
      >
        <ListRowOverflowMenu
          actions={actions}
          triggerTestId={`wcb-overflow-menu-${item.id}`}
        />
      </td>
    </tr>
  );
}

// ── Sorting ───────────────────────────────────────────────────────────────────

function compareItems(a: WetCheckBillingListItem, b: WetCheckBillingListItem, key: SortKey, dir: SortDir): number {
  let aVal: string | number = "";
  let bVal: string | number = "";

  switch (key) {
    case "billingNumber":
      aVal = a.billingNumber ?? "";
      bVal = b.billingNumber ?? "";
      break;
    case "customerName":
      aVal = a.customerName ?? "";
      bVal = b.customerName ?? "";
      break;
    case "technicianName":
      aVal = a.technicianName ?? "";
      bVal = b.technicianName ?? "";
      break;
    case "workDate":
      aVal = a.workDate ? new Date(a.workDate).getTime() : 0;
      bVal = b.workDate ? new Date(b.workDate).getTime() : 0;
      break;
    case "totalAmount":
      aVal = parseFloat(String(a.totalAmount ?? "0")) || 0;
      bVal = parseFloat(String(b.totalAmount ?? "0")) || 0;
      break;
    case "status":
      aVal = a.status ?? "";
      bVal = b.status ?? "";
      break;
  }

  if (aVal < bVal) return dir === "asc" ? -1 : 1;
  if (aVal > bVal) return dir === "asc" ? 1 : -1;
  return 0;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function WetCheckBillings() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterChipKey>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "workDate", dir: "desc" });
  const [modalId, setModalId] = useState<number | null>(null);
  const [modalInitialAction, setModalInitialAction] = useState<"labor-rate" | "zone-labor" | undefined>(undefined);

  const { data: billings = [], isLoading } = useArrayQuery<WetCheckBillingListItem>({
    queryKey: ["/api/wet-check-billings"],
  });

  function handleOpenModal(id: number, action?: "labor-rate" | "zone-labor") {
    setModalInitialAction(action);
    setModalId(id);
  }

  const matchesSearch = (item: WetCheckBillingListItem) => {
    const q = searchQuery.toLowerCase();
    return (
      (item.billingNumber ?? "").toLowerCase().includes(q) ||
      (item.customerName ?? "").toLowerCase().includes(q) ||
      (item.propertyAddress ?? "").toLowerCase().includes(q) ||
      (item.technicianName ?? "").toLowerCase().includes(q)
    );
  };

  const chipCounts = useMemo(() => {
    const searched = billings.filter(matchesSearch);
    return {
      all: searched.length,
      submitted: searched.filter((b) => b.status === "submitted").length,
      pending_manager_review: searched.filter((b) => b.status === "pending_manager_review").length,
      approved_passed_to_billing: searched.filter((b) => b.status === "approved_passed_to_billing").length,
      billed: searched.filter((b) => b.status === "billed").length,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billings, searchQuery]);

  const filtered = useMemo(() => {
    let rows = billings.filter(matchesSearch);
    if (activeFilter !== "all") {
      rows = rows.filter((b) => b.status === activeFilter);
    }
    return [...rows].sort((a, b) => compareItems(a, b, sort.key, sort.dir));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billings, searchQuery, activeFilter, sort]);

  function handleSort(col: SortKey) {
    setSort((prev) =>
      prev.key === col
        ? { key: col, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key: col, dir: "asc" },
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Wet Check Billings"
        subtitle="Auto-generated from wet check submissions"
      />

      <PageContent className="space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
          <Input
            placeholder="Search wet check billings..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-12"
            data-testid="input-search-wcb"
          />
        </div>

        {/* Filter chips */}
        {!isLoading && (
          <div className="flex flex-wrap gap-2" data-testid="filter-chips">
            {FILTER_CHIPS.map((chip) => (
              <FilterChip
                key={chip.key}
                label={chip.label}
                active={activeFilter === chip.key}
                count={chipCounts[chip.key]}
                onClick={() => setActiveFilter(chip.key)}
              />
            ))}
          </div>
        )}

        {/* Loading */}
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <Card key={i}>
                <CardContent className="p-6">
                  <Skeleton className="h-5 w-1/3 mb-2" />
                  <Skeleton className="h-4 w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <ListPageEmptyState
            icon={Droplets}
            title="No wet check billings found"
            description={
              searchQuery || activeFilter !== "all"
                ? "Try adjusting your search or filter."
                : "Wet check billings are auto-generated when wet checks are submitted."
            }
            testId="wcb-empty-state"
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="wcb-table">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap w-24">
                        WC #
                      </th>
                      <SortTh label="Billing #" col="billingNumber" sort={sort} onSort={handleSort} className="w-36" />
                      <SortTh label="Customer" col="customerName" sort={sort} onSort={handleSort} className="w-40" />
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap w-40">
                        Property
                      </th>
                      <SortTh label="Technician" col="technicianName" sort={sort} onSort={handleSort} className="w-36" />
                      <SortTh label="Work Date" col="workDate" sort={sort} onSort={handleSort} className="w-28" />
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap w-32">
                        Issues
                      </th>
                      <SortTh label="Status" col="status" sort={sort} onSort={handleSort} className="w-32" />
                      <SortTh label="Total" col="totalAmount" sort={sort} onSort={handleSort} className="w-24 text-right" />
                      <th className="px-2 py-2.5 w-10" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filtered.map((item) => (
                      <WcbRow
                        key={item.id}
                        item={item}
                        onRowClick={(i) => handleOpenModal(i.id)}
                        onOpenModal={handleOpenModal}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </PageContent>

      {modalId != null && (
        <WetCheckBillingViewModal
          wetCheckBillingId={modalId}
          open={modalId != null}
          onOpenChange={(open) => {
            if (!open) {
              setModalId(null);
              setModalInitialAction(undefined);
            }
          }}
          initialAction={modalInitialAction}
        />
      )}
    </PageContainer>
  );
}
