import { Minus, Plus } from "lucide-react";
import { computeMarkup, materialPriceChecks, type MarkupTier } from "@workspace/shared";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addLastTier,
  formatMoney,
  lowerBoundFor,
  MARKUP_EXAMPLE_COSTS,
  removeLastTier,
  type TierDraft,
} from "@/lib/markup-tier-form";

interface TierEditorProps {
  idPrefix: string;
  drafts: TierDraft[];
  onChange?: (next: TierDraft[]) => void;
  readOnly?: boolean;
}

export function TierEditor({ idPrefix, drafts, onChange, readOnly = false }: TierEditorProps) {
  const update = (i: number, patch: Partial<TierDraft>) => {
    onChange?.(drafts.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm" data-testid={`table-tiers-${idPrefix}`}>
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">Tier</th>
              <th scope="col" className="px-3 py-2 font-semibold">From ($)</th>
              <th scope="col" className="px-3 py-2 font-semibold">To ($)</th>
              <th scope="col" className="px-3 py-2 font-semibold">Markup (%)</th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((d, i) => {
              const isLast = i === drafts.length - 1;
              return (
                <tr key={i} className="border-t border-gray-100" data-testid={`row-tier-${idPrefix}-${i + 1}`}>
                  <td className="px-3 py-2 font-medium text-gray-700">{i + 1}</td>
                  <td className="px-3 py-2 tabular-nums text-gray-600">{lowerBoundFor(drafts, i)}</td>
                  <td className="px-3 py-2">
                    {isLast ? (
                      <span className="text-gray-500">and above</span>
                    ) : readOnly ? (
                      <span className="tabular-nums">{d.maxCost}</span>
                    ) : (
                      <Input
                        aria-label={`Tier ${i + 1} upper bound`}
                        type="number"
                        step="0.01"
                        min="0.01"
                        inputMode="decimal"
                        className="h-9 w-32"
                        value={d.maxCost}
                        onChange={(e) => update(i, { maxCost: e.target.value })}
                        data-testid={`input-tier-max-${idPrefix}-${i + 1}`}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {readOnly ? (
                      <span className="tabular-nums">{d.markupPercent}%</span>
                    ) : (
                      <Input
                        aria-label={`Tier ${i + 1} markup percent`}
                        type="number"
                        step="0.01"
                        min="0"
                        max="999.99"
                        inputMode="decimal"
                        className="h-9 w-28"
                        value={d.markupPercent}
                        onChange={(e) => update(i, { markupPercent: e.target.value })}
                        data-testid={`input-tier-percent-${idPrefix}-${i + 1}`}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange?.(addLastTier(drafts))}
            disabled={drafts.length >= 100}
            data-testid={`button-add-tier-${idPrefix}`}
          >
            <Plus className="mr-1 h-4 w-4" /> Add Tier
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange?.(removeLastTier(drafts))}
            disabled={drafts.length <= 1}
            data-testid={`button-remove-tier-${idPrefix}`}
          >
            <Minus className="mr-1 h-4 w-4" /> Remove Last Tier
          </Button>
        </div>
      )}
    </div>
  );
}

export function MinimumMarkupInput({ value, onChange, idPrefix }: { value: string; onChange: (value: string) => void; idPrefix: string }) {
  return <div className="max-w-md">
    <Label htmlFor={`${idPrefix}-minimum`}>Minimum markup ($)</Label>
    <Input id={`${idPrefix}-minimum`} type="number" min="0" max="99999999.99" step="0.01" inputMode="decimal"
      value={value} onChange={e => onChange(e.target.value)} data-testid={`input-minimum-${idPrefix}`} />
    <p className="mt-1 text-xs text-gray-500">Minimum dollar markup added to each eligible part’s cost.</p>
  </div>;
}

export function MarkupExamples({ tiers, minimumMarkupDollars, error, idPrefix }: { tiers: MarkupTier[]; minimumMarkupDollars: number; error: string | null; idPrefix: string }) {
  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-4" aria-live="polite">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-blue-900">Live examples</p>
      {error ? (
        <p className="text-sm text-gray-600">Examples appear once the tiers and minimum are valid.</p>
      ) : (
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {MARKUP_EXAMPLE_COSTS.map((cost) => {
            const schedule = { tiers, minimumMarkupDollars };
            const markup = computeMarkup(cost, schedule);
            const checks = materialPriceChecks(cost, schedule);
            const price = checks.price;
            return (
              <div key={cost} className="rounded-md bg-white p-3 shadow-sm" data-testid={`example-${idPrefix}-${cost}`}>
                <dt className="text-xs text-gray-500">Cost {formatMoney(cost)}</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums text-gray-900">{formatMoney(price)}</dd>
                <dd className="text-xs text-gray-500 tabular-nums">
                  +{formatMoney(markup)} ({((markup / cost) * 100).toFixed(1)}% effective)
                </dd>
                <dd className="mt-2 text-xs text-gray-600">
                  Flat-tier: {formatMoney(checks.flatPrice)}<br />
                  Minimum check: {formatMoney(checks.minimumPrice)}<br />
                  Never-less check: {formatMoney(checks.neverLessPrice)}<br />
                  Highest wins.
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
}
