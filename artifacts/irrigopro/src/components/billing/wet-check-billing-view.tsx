/**
 * WC Billing Slice 5 — Zone-grouped billing view component
 *
 * Renders the WetCheckBillingView payload from
 * GET /api/billing-sheets/:id/wet-check-view in a structured
 * zone-grouped layout:
 *   Repairs Summary → per-zone sections → Inspection section → totals footer
 *
 * Suppression rule: $0.00 non-labor-only line items are hidden.
 * Labor-only items (noPartNeeded === true) are always shown.
 */

import { format } from "date-fns";
import { Wrench, MapPin, ClipboardList, DollarSign, CloudSun } from "lucide-react";
import { Separator } from "@/components/ui/separator";

// ─── Mirrored types (match artifacts/api-server/src/wet-check-billing-view.ts) ─

export interface WcvLineItem {
  findingId: number;
  issueType: string;
  /** Human-readable label from issueTypeConfigs; title-cased fallback */
  issueDisplayLabel: string;
  partName: string | null;
  quantity: number;
  unitPrice: string;
  partsTotal: string;
  laborHours: string;
  laborTotal: string;
  lineTotal: string;
  /** True when the finding is labor-only (no part required). Always shown. */
  noPartNeeded: boolean;
  notes: string | null;
}

export interface WcvZone {
  controllerLetter: string;
  zoneNumber: number;
  /** Formatted label e.g. "A-1" */
  zoneLabel: string;
  /** Authoritative zone-level repair labor hours (Slice 4 Option B) */
  repairLaborHours: string;
  lineItems: WcvLineItem[];
  zonePartsSubtotal: string;
  zoneLaborSubtotal: string;
  zoneTotal: string;
}

export interface WcvInspection {
  wetCheckId: number;
  technicianName: string;
  inspectionDate: string;
  propertyAddress: string | null;
  weather: string | null;
  notes: string | null;
}

export interface WetCheckBillingView {
  billingSheetId: number;
  billingNumber: string;
  customerId: number;
  customerName: string;
  workDate: string;
  laborRate: string;
  inspection: WcvInspection;
  /** Zones already sorted by controllerLetter ASC, zoneNumber ASC */
  zones: WcvZone[];
  /** e.g. "3 repairs across 2 zones" */
  repairsSummary: string;
  partsSubtotal: string;
  laborSubtotal: string;
  grandTotal: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toNum(s: string | null | undefined): number {
  const n = parseFloat(s ?? "0");
  return isNaN(n) ? 0 : n;
}

const currency = (val: number | string | null | undefined) => {
  const n = typeof val === "string" ? parseFloat(val) : (val ?? 0);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(isNaN(n) ? 0 : n);
};

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  try { return format(new Date(iso), "MMM d, yyyy"); } catch { return "—"; }
};

/**
 * A line item is suppressed when:
 *   - lineTotal is $0.00 (or effectively zero), AND
 *   - the item is NOT labor-only (noPartNeeded === false)
 * Labor-only items are always shown regardless of amount.
 */
function shouldShowLineItem(item: WcvLineItem): boolean {
  if (item.noPartNeeded) return true;
  return toNum(item.lineTotal) !== 0;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ZoneSection({
  zone,
  canSeePricing,
}: {
  zone: WcvZone;
  canSeePricing: boolean;
}) {
  const visibleItems = zone.lineItems.filter(shouldShowLineItem);
  const repairLaborNum = toNum(zone.repairLaborHours);

  return (
    <div
      className="border border-gray-200 rounded-lg overflow-hidden"
      data-testid={`zone-section-${zone.zoneLabel}`}
    >
      {/* Zone header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-blue-50 border-b border-blue-100">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-blue-600" />
          <span className="text-sm font-semibold text-blue-900">
            Zone {zone.zoneLabel}
          </span>
        </div>
        {canSeePricing && (
          <span className="text-sm font-semibold text-blue-800">
            {currency(zone.zoneTotal)}
          </span>
        )}
      </div>

      <div className="p-3 space-y-2">
        {/* Line items */}
        {visibleItems.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid={`zone-items-table-${zone.zoneLabel}`}>
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left pb-1.5 font-medium text-gray-500 pr-3 text-xs uppercase tracking-wide">
                    Repair
                  </th>
                  {canSeePricing && (
                    <>
                      <th className="text-center pb-1.5 font-medium text-gray-500 px-2 text-xs uppercase tracking-wide whitespace-nowrap">
                        Qty
                      </th>
                      <th className="text-right pb-1.5 font-medium text-gray-500 px-2 text-xs uppercase tracking-wide whitespace-nowrap">
                        Unit $
                      </th>
                      <th className="text-right pb-1.5 font-medium text-gray-500 pl-2 text-xs uppercase tracking-wide whitespace-nowrap">
                        Parts
                      </th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {visibleItems.map((item) => (
                  <tr key={item.findingId} className="hover:bg-gray-50">
                    <td className="py-2 pr-3">
                      <p
                        className="font-medium text-gray-900 text-sm"
                        data-testid={`line-item-label-${item.findingId}`}
                      >
                        {item.issueDisplayLabel}
                        {item.noPartNeeded && (
                          <span className="ml-1.5 text-xs font-normal text-amber-600 bg-amber-50 border border-amber-200 rounded px-1 py-0.5">
                            Labor Only
                          </span>
                        )}
                      </p>
                      {item.partName && !item.noPartNeeded && (
                        <p className="text-xs text-gray-500 mt-0.5">{item.partName}</p>
                      )}
                      {item.notes && (
                        <p className="text-xs text-gray-400 mt-0.5 italic">{item.notes}</p>
                      )}
                    </td>
                    {canSeePricing && (
                      <>
                        <td className="py-2 px-2 text-center text-gray-700 text-sm">
                          {item.noPartNeeded ? "—" : item.quantity}
                        </td>
                        <td className="py-2 px-2 text-right text-gray-700 text-sm">
                          {item.noPartNeeded ? "—" : currency(item.unitPrice)}
                        </td>
                        <td className="py-2 pl-2 text-right font-medium text-gray-900 text-sm">
                          {item.noPartNeeded ? "—" : currency(item.partsTotal)}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic">No billable parts for this zone.</p>
        )}

        {/* Zone labor row */}
        {canSeePricing && repairLaborNum > 0 && (
          <div className="flex items-center justify-between pt-1 border-t border-dashed border-gray-200 mt-1">
            <span className="text-xs text-gray-500">
              Repair labor ({repairLaborNum.toFixed(2)} hr{repairLaborNum !== 1 ? "s" : ""})
            </span>
            <span className="text-sm font-medium text-gray-700">
              {currency(zone.zoneLaborSubtotal)}
            </span>
          </div>
        )}

        {/* Zone subtotal */}
        {canSeePricing && (
          <div className="flex items-center justify-between pt-1 border-t border-gray-200 mt-1">
            <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Zone Subtotal</span>
            <span className="text-sm font-bold text-gray-900">{currency(zone.zoneTotal)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface WetCheckBillingViewProps {
  view: WetCheckBillingView;
  canSeePricing: boolean;
}

export function WetCheckBillingViewComponent({
  view,
  canSeePricing,
}: WetCheckBillingViewProps) {
  const totalFindings = view.zones.reduce((s, z) => s + z.lineItems.length, 0);

  return (
    <div className="space-y-4" data-testid="wet-check-billing-view">

      {/* Repairs Summary table */}
      <div className="border border-gray-100 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-100">
          <Wrench className="w-4 h-4 text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-800">
            Repairs Summary
          </h3>
          <span className="ml-auto text-xs text-gray-500">{view.repairsSummary}</span>
        </div>
        <div className="p-4">
          {view.zones.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="repairs-summary-table">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left pb-2 font-medium text-gray-600 pr-3">Zone</th>
                    <th className="text-center pb-2 font-medium text-gray-600 px-2 whitespace-nowrap">Repairs</th>
                    {canSeePricing && (
                      <>
                        <th className="text-right pb-2 font-medium text-gray-600 px-2 whitespace-nowrap">Parts</th>
                        <th className="text-right pb-2 font-medium text-gray-600 px-2 whitespace-nowrap">Repair Hrs</th>
                        <th className="text-right pb-2 font-medium text-gray-600 pl-2 whitespace-nowrap">Zone Total</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {view.zones.map((zone) => (
                    <tr key={zone.zoneLabel} className="hover:bg-gray-50">
                      <td
                        className="py-2.5 pr-3 font-medium text-gray-900"
                        data-testid={`summary-zone-label-${zone.zoneLabel}`}
                      >
                        Zone {zone.zoneLabel}
                      </td>
                      <td className="py-2.5 px-2 text-center text-gray-700">
                        {zone.lineItems.length}
                      </td>
                      {canSeePricing && (
                        <>
                          <td className="py-2.5 px-2 text-right text-gray-700">
                            {currency(zone.zonePartsSubtotal)}
                          </td>
                          <td className="py-2.5 px-2 text-right text-gray-700">
                            {toNum(zone.repairLaborHours).toFixed(2)}
                          </td>
                          <td className="py-2.5 pl-2 text-right font-semibold text-gray-900">
                            {currency(zone.zoneTotal)}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
                {canSeePricing && (
                  <tfoot>
                    <tr className="border-t border-gray-200">
                      <td className="pt-2 font-semibold text-gray-700" colSpan={2}>
                        Total
                      </td>
                      <td className="pt-2 text-right font-semibold text-gray-700">
                        {currency(view.partsSubtotal)}
                      </td>
                      <td className="pt-2 text-right font-semibold text-gray-700">
                        {view.zones.reduce((s, z) => s + toNum(z.repairLaborHours), 0).toFixed(2)}
                      </td>
                      <td className="pt-2 text-right font-bold text-blue-700">
                        {currency(view.grandTotal)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-500 text-center py-2">No repair zones found.</p>
          )}
        </div>
      </div>

      {/* Per-zone sections */}
      {view.zones.length > 0 && (
        <div className="border border-gray-100 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-100">
            <MapPin className="w-4 h-4 text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-800">
              Zone Details
            </h3>
            <span className="ml-auto text-xs text-gray-500">
              {totalFindings} finding{totalFindings !== 1 ? "s" : ""} across {view.zones.length} zone{view.zones.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="p-4 space-y-3">
            {view.zones.map((zone) => (
              <ZoneSection
                key={zone.zoneLabel}
                zone={zone}
                canSeePricing={canSeePricing}
              />
            ))}
          </div>
        </div>
      )}

      {/* Inspection section */}
      <div
        className="border border-gray-100 rounded-xl overflow-hidden"
        data-testid="inspection-section"
      >
        <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-100">
          <ClipboardList className="w-4 h-4 text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-800">Inspection</h3>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-0.5">Technician</p>
            <p className="text-gray-900">{view.inspection.technicianName}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-0.5">Inspection Date</p>
            <p className="text-gray-900">{fmtDate(view.inspection.inspectionDate)}</p>
          </div>
          {view.inspection.propertyAddress && (
            <div className="sm:col-span-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-0.5">Property Address</p>
              <p className="text-gray-900">{view.inspection.propertyAddress}</p>
            </div>
          )}
          {view.inspection.weather && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-0.5 flex items-center gap-1">
                <CloudSun className="w-3 h-3" /> Weather
              </p>
              <p className="text-gray-900">{view.inspection.weather}</p>
            </div>
          )}
          {view.inspection.notes && (
            <div className="sm:col-span-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-0.5">Inspection Notes</p>
              <p className="text-gray-800 bg-gray-50 rounded-lg p-3 leading-relaxed whitespace-pre-wrap text-sm">
                {view.inspection.notes}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Totals footer */}
      {canSeePricing && (
        <div className="border border-gray-100 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-100">
            <DollarSign className="w-4 h-4 text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-800">WC Sheet Totals</h3>
          </div>
          <div className="p-4 space-y-2">
            <div className="flex justify-between text-sm text-gray-600">
              <span>Parts Subtotal</span>
              <span className="font-medium text-gray-900">{currency(view.partsSubtotal)}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-600">
              <span>Repair Labor Subtotal</span>
              <span className="font-medium text-gray-900">{currency(view.laborSubtotal)}</span>
            </div>
            <Separator className="my-2" />
            <div className="flex justify-between items-center">
              <span className="text-base font-semibold text-gray-900">Grand Total</span>
              <span className="text-xl font-bold text-blue-700" data-testid="wc-grand-total">
                {currency(view.grandTotal)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
