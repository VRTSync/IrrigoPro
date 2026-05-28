import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { PageContainer, PageContent, PageHeader } from "@/components/ui/page-header";
import { Search, ChevronDown, ChevronRight } from "lucide-react";
import { useArrayQuery } from "@/lib/queryClient";
import { BilledBadge } from "@/components/ui/billed-indicator";
import { WetCheckBillingViewModal } from "@/components/wet-check-billings/wet-check-billing-view-modal";
import { WetCheckBillingStatusBadge } from "@/components/wet-check-billings/status-badge";
import type { WetCheckBilling } from "@workspace/db/schema";

// ── Local types ───────────────────────────────────────────────────────────────

type WetCheckBillingListItem = WetCheckBilling & {
  issuesCount: number;
  zonesCount: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(date: string | Date | null | undefined) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}


function isBilled(wcb: WetCheckBilling): boolean {
  return wcb.status === "billed" || wcb.invoiceId != null;
}

// ── Table row ─────────────────────────────────────────────────────────────────

function WcbRow({
  item,
  onRowClick,
}: {
  item: WetCheckBillingListItem;
  onRowClick: (item: WetCheckBillingListItem) => void;
}) {
  return (
    <tr
      className="border-b last:border-0 hover:bg-gray-50 cursor-pointer transition-colors"
      onClick={() => onRowClick(item)}
      data-testid={`wcb-row-${item.id}`}
    >
      {/* WC # — navigates; stops row click propagation */}
      <td className="px-4 py-3 whitespace-nowrap">
        <Link
          href={`/wet-checks/${item.wetCheckId}?from=wet-check-billings`}
          onClick={(e) => e.stopPropagation()}
          data-testid={`wcb-wc-link-${item.id}`}
        >
          <span className="text-blue-600 hover:underline text-sm font-medium">
            WC-{item.wetCheckId}
          </span>
        </Link>
      </td>
      {/* Billing # */}
      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
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
      <td className="px-4 py-3 whitespace-nowrap"><WetCheckBillingStatusBadge status={item.status} /></td>
      {/* Billed */}
      <td className="px-4 py-3 whitespace-nowrap">
        {isBilled(item) ? <BilledBadge /> : null}
      </td>
      {/* Total */}
      <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap text-right">
        {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
          parseFloat(String(item.totalAmount ?? "0")),
        )}
      </td>
    </tr>
  );
}

// ── Section (collapsible card with table) ─────────────────────────────────────

function Section({
  title,
  items,
  expanded,
  onToggle,
  emptyText,
  onRowClick,
}: {
  title: string;
  items: WetCheckBillingListItem[];
  expanded: boolean;
  onToggle: () => void;
  emptyText: string;
  onRowClick: (item: WetCheckBillingListItem) => void;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <button
          type="button"
          className="w-full flex items-center justify-between px-5 py-4 text-left"
          onClick={onToggle}
          data-testid={`section-toggle-${title.replace(/\s+/g, "-").toLowerCase()}`}
        >
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900">{title}</span>
            <Badge variant="outline" className="text-xs">{items.length}</Badge>
          </div>
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-500" />
          )}
        </button>

        {expanded && (
          items.length === 0 ? (
            <div className="px-5 pb-5 text-sm text-gray-500 italic" data-testid={`empty-${title.replace(/\s+/g, "-").toLowerCase()}`}>
              {emptyText}
            </div>
          ) : (
            <div className="overflow-x-auto border-t border-gray-100">
              <table className="w-full text-sm" data-testid={`table-${title.replace(/\s+/g, "-").toLowerCase()}`}>
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">WC #</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Billing #</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Customer</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Property</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Technician</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Work Date</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Issues</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Billed</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.map((item) => (
                    <WcbRow key={item.id} item={item} onRowClick={onRowClick} />
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function WetCheckBillings() {
  const [searchQuery, setSearchQuery] = useState("");
  const [awaitingExpanded, setAwaitingExpanded] = useState(true);
  const [billedExpanded, setBilledExpanded] = useState(false);
  const [modalId, setModalId] = useState<number | null>(null);

  const { data: billings = [], isLoading } = useArrayQuery<WetCheckBillingListItem>({
    queryKey: ["/api/wet-check-billings"],
  });

  const matchesSearch = (item: WetCheckBillingListItem) => {
    const q = searchQuery.toLowerCase();
    return (
      (item.billingNumber ?? "").toLowerCase().includes(q) ||
      (item.customerName ?? "").toLowerCase().includes(q) ||
      (item.propertyAddress ?? "").toLowerCase().includes(q) ||
      (item.technicianName ?? "").toLowerCase().includes(q)
    );
  };

  const filtered = billings.filter(matchesSearch);

  const awaitingInvoice = filtered.filter((b) => !isBilled(b));
  const billedItems = filtered.filter((b) => isBilled(b));

  return (
    <PageContainer>
      <PageHeader
        title="Wet Check Billings"
        subtitle="Auto-generated from wet check submissions"
      />

      <PageContent className="space-y-5">
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

        {/* Loading */}
        {isLoading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Card key={i}>
                <CardContent className="p-6">
                  <Skeleton className="h-6 w-1/3 mb-3" />
                  <Skeleton className="h-4 w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <>
            <Section
              title="Awaiting Invoice"
              items={awaitingInvoice}
              expanded={awaitingExpanded}
              onToggle={() => setAwaitingExpanded((v) => !v)}
              emptyText="No wet check billings awaiting invoice."
              onRowClick={(item) => setModalId(item.id)}
            />
            <Section
              title="Billed"
              items={billedItems}
              expanded={billedExpanded}
              onToggle={() => setBilledExpanded((v) => !v)}
              emptyText="No billed wet check billings."
              onRowClick={(item) => setModalId(item.id)}
            />
          </>
        )}
      </PageContent>

      {modalId != null && (
        <WetCheckBillingViewModal
          wetCheckBillingId={modalId}
          open={modalId != null}
          onOpenChange={(open) => { if (!open) setModalId(null); }}
        />
      )}
    </PageContainer>
  );
}
