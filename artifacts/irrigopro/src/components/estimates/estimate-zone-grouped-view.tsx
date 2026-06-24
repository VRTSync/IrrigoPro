/**
 * EstimateZoneGroupedView — shared zone-grouped estimate renderer.
 *
 * Used by:
 *  - estimate-detail-modal.tsx (inspection-origin estimate detail)
 *  - CombinedReviewSurface.tsx (inspection Estimate Review section)
 *
 * Both surfaces must show the same zone-grouped layout to avoid drift
 * from the estimate PDF. Any structural change here automatically applies
 * to both callers.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  groupEstimateItemsByZone,
  humanizeIssueType,
  type EstimateItemLike,
  type EstimateZoneGroup,
} from "@/lib/estimate-zone-grouping";

// ── Currency helper ──────────────────────────────────────────────────────────

function fmtUSD(amount: number | string): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

// ── ZoneDetailBlock ───────────────────────────────────────────────────────────

function ZoneDetailBlock({
  group,
  laborRate,
  canSeePricing,
}: {
  group: EstimateZoneGroup;
  laborRate: number;
  canSeePricing: boolean;
}) {
  const zoneLaborAmt = group.laborHrs * laborRate;

  return (
    <div className="rounded-lg border border-blue-100 overflow-hidden">
      {/* Zone header row */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-blue-600 text-white">
        <span className="font-semibold text-sm tracking-wide">{group.zoneLabel}</span>
        {canSeePricing && (
          <span className="font-bold text-sm tabular-nums">{fmtUSD(group.zoneTotal)}</span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-blue-700 text-white text-xs uppercase tracking-wide">
              <th className="py-1.5 px-3 text-left font-semibold">Work / Finding</th>
              {canSeePricing && (
                <>
                  <th className="py-1.5 px-2 text-right font-semibold">Qty</th>
                  <th className="py-1.5 px-2 text-right font-semibold">Unit $</th>
                  <th className="py-1.5 px-2 text-right font-semibold">Parts Total</th>
                  <th className="py-1.5 px-2 text-right font-semibold">Zone Total</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {group.items.map((item, idx) => {
              const partPrice = parseFloat(String(item.partPrice ?? 0)) || 0;
              const qty = item.quantity ?? 0;
              const partsTotal = parseFloat(String(item.totalPrice ?? 0)) || 0;
              const issueLabel = humanizeIssueType(item.issueType);
              const isLaborOnly = partPrice === 0;

              return (
                <tr
                  key={item.id ?? idx}
                  className={idx % 2 === 1 ? "bg-gray-50" : "bg-white"}
                >
                  <td className="py-2 px-3 align-top">
                    <div className="font-medium text-gray-900">{issueLabel}</div>
                    {item.partName && item.partName !== issueLabel && (
                      <div className="text-xs text-gray-500 mt-0.5">{item.partName}</div>
                    )}
                    {isLaborOnly && (
                      <span className="inline-block mt-1 rounded-full bg-sky-100 text-sky-700 text-[10px] font-semibold px-2 py-0.5 uppercase tracking-wide">
                        labor only
                      </span>
                    )}
                  </td>
                  {canSeePricing && (
                    <>
                      <td className="py-2 px-2 text-right text-gray-700">
                        {isLaborOnly ? <span className="text-gray-400">—</span> : qty}
                      </td>
                      <td className="py-2 px-2 text-right text-gray-700">
                        {isLaborOnly ? <span className="text-gray-400">—</span> : fmtUSD(partPrice)}
                      </td>
                      <td className="py-2 px-2 text-right text-gray-700">
                        {isLaborOnly ? <span className="text-gray-400">—</span> : fmtUSD(partsTotal)}
                      </td>
                      <td className="py-2 px-2 text-right text-gray-700">
                        {isLaborOnly ? <span className="text-gray-400">—</span> : fmtUSD(partsTotal)}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}

            {/* Labor row — only shown when pricing is visible */}
            {canSeePricing && (
              <tr className="border-t border-dashed border-gray-200 bg-gray-50 text-xs italic text-gray-600">
                <td colSpan={4} className="py-2 px-3">
                  Zone labor · {group.laborHrs.toFixed(2)} hrs × {fmtUSD(laborRate)}/hr
                </td>
                <td className="py-2 px-2 text-right font-medium text-gray-800">
                  {fmtUSD(zoneLaborAmt)}
                </td>
              </tr>
            )}

            {/* Subtotal row — only shown when pricing is visible */}
            {canSeePricing && (
              <tr className="border-t-2 border-blue-200 bg-blue-50">
                <td colSpan={4} className="py-2 px-3 text-sm font-semibold text-blue-900">
                  {group.zoneLabel} Subtotal
                </td>
                <td className="py-2 px-2 text-right font-bold text-blue-900 tabular-nums">
                  {fmtUSD(group.zoneTotal)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── EstimateZoneGroupedView ──────────────────────────────────────────────────

export interface EstimateZoneGroupedViewProps {
  items: EstimateItemLike[];
  laborRate: number;
  partsSubtotal: number;
  laborSubtotal: number;
  totalAmount: number;
  totalLaborHours: number;
  canSeePricing: boolean;
  /**
   * When true (default), renders the grand-totals footer (parts + labor + grand total)
   * inside this component. Set to false when the caller provides its own totals block.
   */
  showTotalsFooter?: boolean;
}

export function EstimateZoneGroupedView({
  items,
  laborRate,
  partsSubtotal,
  laborSubtotal,
  totalAmount,
  totalLaborHours,
  canSeePricing,
  showTotalsFooter = true,
}: EstimateZoneGroupedViewProps) {
  const groups = groupEstimateItemsByZone(items, laborRate);
  const grandTotal = groups.reduce((s, g) => s + g.zoneTotal, 0) || totalAmount;
  const totalRepairs = groups.reduce((s, g) => s + g.items.length, 0);
  const totalLaborHrsCalc = groups.reduce((s, g) => s + g.laborHrs, 0);

  return (
    <div className="space-y-4" data-testid="estimate-zone-grouped-view">
      {/* Repairs Summary Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Repairs Summary by Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="zone-summary-table">
              <thead>
                <tr className="border-b text-left text-gray-700 bg-gray-50">
                  <th className="py-2 pr-3 pl-2 font-semibold">Zone</th>
                  <th className="py-2 px-2 text-right font-semibold">Repairs</th>
                  {canSeePricing && (
                    <th className="py-2 px-2 text-right font-semibold">Parts</th>
                  )}
                  <th className="py-2 px-2 text-right font-semibold">Labor hrs</th>
                  {canSeePricing && (
                    <th className="py-2 pl-2 text-right font-semibold">Zone Total</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {groups.map((g, idx) => (
                  <tr
                    key={g.zoneKey}
                    className={`border-b ${idx % 2 === 1 ? "bg-gray-50" : ""}`}
                    data-testid="zone-summary-row"
                  >
                    <td className="py-2 pr-3 pl-2 font-semibold text-gray-900">{g.zoneLabel}</td>
                    <td className="py-2 px-2 text-right text-gray-700">{g.items.length}</td>
                    {canSeePricing && (
                      <td className="py-2 px-2 text-right text-gray-700">{fmtUSD(g.partsTotal)}</td>
                    )}
                    <td className="py-2 px-2 text-right text-gray-700">{g.laborHrs.toFixed(2)}</td>
                    {canSeePricing && (
                      <td className="py-2 pl-2 text-right font-semibold text-gray-900 tabular-nums">{fmtUSD(g.zoneTotal)}</td>
                    )}
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-300 bg-blue-50">
                  <td className="py-2 pr-3 pl-2 font-bold text-gray-900">Totals</td>
                  <td className="py-2 px-2 text-right font-bold text-gray-900">{totalRepairs}</td>
                  {canSeePricing && (
                    <td className="py-2 px-2 text-right font-bold text-gray-900">{fmtUSD(partsSubtotal)}</td>
                  )}
                  <td className="py-2 px-2 text-right font-bold text-gray-900">
                    {totalLaborHrsCalc.toFixed(2)}
                  </td>
                  {canSeePricing && (
                    <td className="py-2 pl-2 text-right font-bold text-blue-900 tabular-nums">{fmtUSD(grandTotal)}</td>
                  )}
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Per-Zone Detail Blocks */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Zone Detail</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {groups.map((group) => (
            <ZoneDetailBlock
              key={group.zoneKey}
              group={group}
              laborRate={laborRate}
              canSeePricing={canSeePricing}
            />
          ))}

          {/* Grand totals footer — shown only when canSeePricing and showTotalsFooter */}
          {canSeePricing && showTotalsFooter && (
            <div className="flex justify-end pt-2">
              <div className="w-full max-w-xs space-y-1.5 text-sm">
                <div className="flex justify-between text-gray-600">
                  <span>Parts Subtotal</span>
                  <span className="font-medium tabular-nums">{fmtUSD(partsSubtotal)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>
                    Labor ({totalLaborHours.toFixed(2)}h × {fmtUSD(laborRate)}/hr)
                  </span>
                  <span className="font-medium tabular-nums">{fmtUSD(laborSubtotal)}</span>
                </div>
                <div className="flex justify-between items-center border-t border-gray-200 pt-1.5">
                  <span className="font-bold text-gray-900">Grand Total</span>
                  <span className="font-bold text-lg text-blue-900 tabular-nums">{fmtUSD(grandTotal)}</span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
