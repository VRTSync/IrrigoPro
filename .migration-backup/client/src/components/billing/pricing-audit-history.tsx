import { useQuery } from "@tanstack/react-query";
import { History, ChevronDown, ChevronUp, Tag, Wrench } from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";

type RepricedItem = {
  itemId?: number;
  partName?: string;
  oldUnitPrice?: string;
  newUnitPrice?: string;
  oldTotalPrice?: string;
  newTotalPrice?: string;
};

type CatalogRepriceDetails = {
  oldPartsSubtotal?: string;
  newPartsSubtotal?: string;
  newTotalPartsCost?: string;
  oldTotalAmount?: string;
  newTotalAmount?: string;
  items?: RepricedItem[];
};

type LaborRepriceDetails = {
  classification?: string;
  totalHours?: string | number;
  oldLaborRate?: string;
  newLaborRate?: string;
  oldLaborSubtotal?: string;
  newLaborSubtotal?: string;
  oldTotalAmount?: string;
  newTotalAmount?: string;
};

type PricingAuditEventKind = 'catalog_reprice' | 'labor_rate_reprice';

type PricingAuditEventBase = {
  id: number;
  source: 'billing_sheet' | 'work_order' | 'invoice';
  parentId: number;
  parentNumber: string | null;
  delta: string;
  itemCount: number;
  actorUserId: number | null;
  actorName: string | null;
  createdAt: string;
};

type PricingAuditEvent =
  | (PricingAuditEventBase & { kind: 'catalog_reprice'; details: CatalogRepriceDetails | null })
  | (PricingAuditEventBase & { kind: 'labor_rate_reprice'; details: LaborRepriceDetails | null })
  | (PricingAuditEventBase & { kind: string; details: unknown });

type Resp = {
  source: string;
  parentId: number;
  count: number;
  events: PricingAuditEvent[];
};

const fmtMoney = (val: string | number | null | undefined) => {
  const n = typeof val === "string" ? parseFloat(val) : (val ?? 0);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);
};

const fmtSignedMoney = (val: string | number | null | undefined) => {
  const n = typeof val === "string" ? parseFloat(val) : (val ?? 0);
  const abs = Math.abs(n || 0);
  const sign = (n || 0) >= 0 ? "+" : "−";
  return `${sign}${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(abs)}`;
};

const fmtDateTime = (iso: string) => {
  try {
    return format(new Date(iso), "MMM d, yyyy h:mm a");
  } catch {
    return iso;
  }
};

const kindLabel = (kind: string) =>
  kind === 'catalog_reprice' ? 'Parts catalog reprice'
    : kind === 'labor_rate_reprice' ? 'Labor rate reprice'
    : kind;

const kindIcon = (kind: string) =>
  kind === 'labor_rate_reprice' ? <Wrench className="w-3.5 h-3.5" /> : <Tag className="w-3.5 h-3.5" />;

interface PricingAuditHistoryProps {
  source: 'billing_sheet' | 'work_order';
  parentId: number;
  enabled?: boolean;
}

// Narrowing helpers — keep the discriminated union intact at the call sites
// instead of falling back to `any`. `details` is jsonb on the server, so we
// validate shape conservatively before reading fields.
function isCatalogRepriceDetails(details: unknown): details is CatalogRepriceDetails {
  return typeof details === 'object' && details !== null;
}
function isLaborRepriceDetails(details: unknown): details is LaborRepriceDetails {
  return typeof details === 'object' && details !== null;
}

export function PricingAuditHistory({ source, parentId, enabled = true }: PricingAuditHistoryProps) {
  const endpoint = source === 'billing_sheet'
    ? `/api/billing-sheets/${parentId}/pricing-audit-events`
    : `/api/work-orders/${parentId}/pricing-audit-events`;

  const { data, isLoading, error } = useQuery<Resp, Error>({
    queryKey: [endpoint],
    enabled: enabled && Number.isFinite(parentId),
    retry: false,
  });

  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="text-xs text-gray-500">Loading reprice history…</div>
    );
  }

  // Surface real errors instead of pretending "no history". The server gates
  // these endpoints to manager/admin roles + same-company; a 403 here means
  // the caller's role/company doesn't match, NOT that history is empty.
  if (error) {
    const msg = error.message || '';
    const isForbidden = /^403/.test(msg) || /forbidden/i.test(msg) || /access denied/i.test(msg);
    return (
      <p className="text-sm text-amber-700">
        {isForbidden
          ? 'You do not have permission to view reprice history for this record.'
          : 'Could not load reprice history. Please try again later.'}
      </p>
    );
  }

  const events = data?.events ?? [];
  if (events.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No automatic reprice activity recorded for this {source === 'billing_sheet' ? 'billing sheet' : 'work order'}.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {events.map((evt) => {
        const isOpen = expandedId === evt.id;
        const delta = parseFloat(evt.delta || '0');
        const hasDetails = evt.details != null && typeof evt.details === 'object';

        return (
          <li key={evt.id} className="border border-gray-100 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setExpandedId(isOpen ? null : evt.id)}
              className="w-full text-left flex items-center gap-3 px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <span className="text-gray-500">{kindIcon(evt.kind)}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-900">{kindLabel(evt.kind)}</span>
                  {evt.kind === 'catalog_reprice' && evt.itemCount > 0 && (
                    <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
                      {evt.itemCount} item{evt.itemCount === 1 ? '' : 's'}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-gray-500 truncate">
                  {fmtDateTime(evt.createdAt)} · {evt.actorName || 'system'}
                </p>
              </div>
              <span
                className={`text-sm font-semibold tabular-nums ${
                  delta > 0 ? 'text-green-700' : delta < 0 ? 'text-red-700' : 'text-gray-700'
                }`}
              >
                {fmtSignedMoney(evt.delta)}
              </span>
              <span className="text-gray-400">
                {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </span>
            </button>

            {isOpen && hasDetails && evt.kind === 'labor_rate_reprice' && isLaborRepriceDetails(evt.details) && (
              <div className="px-3 py-2 bg-white border-t border-gray-100 text-xs text-gray-700 space-y-2">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <div>
                    <span className="text-gray-500">Classification:</span>{' '}
                    <span className="font-medium capitalize">{evt.details.classification ?? '—'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Total hours:</span>{' '}
                    <span className="font-medium">{evt.details.totalHours ?? '—'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Old labor rate:</span>{' '}
                    <span className="font-medium">{fmtMoney(evt.details.oldLaborRate)}/hr</span>
                  </div>
                  <div>
                    <span className="text-gray-500">New labor rate:</span>{' '}
                    <span className="font-medium">{fmtMoney(evt.details.newLaborRate)}/hr</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Old labor subtotal:</span>{' '}
                    <span className="font-medium">{fmtMoney(evt.details.oldLaborSubtotal)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">New labor subtotal:</span>{' '}
                    <span className="font-medium">{fmtMoney(evt.details.newLaborSubtotal)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Old total:</span>{' '}
                    <span className="font-medium">{fmtMoney(evt.details.oldTotalAmount)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">New total:</span>{' '}
                    <span className="font-medium">{fmtMoney(evt.details.newTotalAmount)}</span>
                  </div>
                </div>
              </div>
            )}

            {isOpen && hasDetails && evt.kind === 'catalog_reprice' && isCatalogRepriceDetails(evt.details) && (
              <div className="px-3 py-2 bg-white border-t border-gray-100 text-xs text-gray-700 space-y-2">
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {evt.details.oldPartsSubtotal != null && (
                      <div>
                        <span className="text-gray-500">Old parts subtotal:</span>{' '}
                        <span className="font-medium">{fmtMoney(evt.details.oldPartsSubtotal)}</span>
                      </div>
                    )}
                    {(evt.details.newPartsSubtotal ?? evt.details.newTotalPartsCost) != null && (
                      <div>
                        <span className="text-gray-500">New parts subtotal:</span>{' '}
                        <span className="font-medium">
                          {fmtMoney(evt.details.newPartsSubtotal ?? evt.details.newTotalPartsCost)}
                        </span>
                      </div>
                    )}
                    {evt.details.oldTotalAmount != null && (
                      <div>
                        <span className="text-gray-500">Old total:</span>{' '}
                        <span className="font-medium">{fmtMoney(evt.details.oldTotalAmount)}</span>
                      </div>
                    )}
                    {evt.details.newTotalAmount != null && (
                      <div>
                        <span className="text-gray-500">New total:</span>{' '}
                        <span className="font-medium">{fmtMoney(evt.details.newTotalAmount)}</span>
                      </div>
                    )}
                  </div>

                  {Array.isArray(evt.details.items) && evt.details.items.length > 0 && (
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Items repriced</p>
                      <div className="border border-gray-100 rounded">
                        <table className="w-full text-[11px]">
                          <thead className="bg-gray-50 text-gray-500">
                            <tr>
                              <th className="text-left px-2 py-1 font-medium">Part</th>
                              <th className="text-right px-2 py-1 font-medium">Old unit</th>
                              <th className="text-right px-2 py-1 font-medium">New unit</th>
                              <th className="text-right px-2 py-1 font-medium">Old total</th>
                              <th className="text-right px-2 py-1 font-medium">New total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {evt.details.items.map((it: RepricedItem, idx: number) => (
                              <tr key={`${it.itemId ?? idx}`} className="border-t border-gray-100">
                                <td className="px-2 py-1 text-gray-800 truncate max-w-[160px]">{it.partName ?? '—'}</td>
                                <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(it.oldUnitPrice)}</td>
                                <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(it.newUnitPrice)}</td>
                                <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(it.oldTotalPrice)}</td>
                                <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(it.newTotalPrice)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

PricingAuditHistory.Icon = History;
