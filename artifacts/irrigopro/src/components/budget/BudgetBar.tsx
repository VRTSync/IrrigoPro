// Task #1866 — Budget Status Page + Manager Workspace Card.
// Task #2009 — the ONE budget renderer in the client.
//
// Every surface that draws "how much of this customer's budget is used"
// renders through this component: the Budget Status page, the Manager
// Workspace card, the crew view, the customer profile's Budget & Alerts
// card, both Financial Pulse widget meters, the Financial Pulse page's
// customer table and the customer form's live preview. There is no second
// budget renderer, no second status→colour map and no second label map.
//
// ── INPUT MODES (exactly one, never both) ──────────────────────────────────
//
//   Amounts     invoicedAmount + pendingAmount + allocation.
//               For a caller that holds the real invoiced / not-yet-billed
//               breakdown. Only this mode draws the segment legend, because
//               only this mode knows which dollars have actually been billed.
//
//   Total       spentAmount + allocation. For a caller whose endpoint returns
//               one aggregate spend figure (invoiced plus worked-but-unbilled)
//               and no breakdown. One segment, no legend — it never claims the
//               total has been invoiced.
//
//   Proportion  fillPercent (0-to-100) — for a caller that has a ratio and
//               no money, such as the crew view, whose endpoint deliberately
//               excludes every monetary field. Pass forcedStatus alongside it
//               so the server's per-customer thresholds are honoured.
//
// Passing both is a developer error and throws outside production rather
// than silently preferring one. Either input arriving null renders "Unset" —
// never zero, never full.
//
// Accessibility: colour is NOT the only differentiator — the pill text
// carries the accessible label for every status. When `hidePercent` is on,
// `aria-valuenow` is OMITTED rather than rounded, because a percentage of a
// deliberately-hidden number is a leak by inference (crew view, Task #1866).

import { cn } from "@/lib/utils";
// Task #2008 — one budget classifier for every surface. It takes spend / cap
// as a RATIO (null when there is no usable allocation) and thresholds as
// 0-to-100 percentages, so this component classifies the underlying ratio
// rather than the 0-to-100 `rawPercent` it uses for the track width.
import { classifyBudgetPercent, type BudgetStatus } from "@workspace/shared";

/**
 * Which vocabulary the pill speaks. Both are deliberate and both live in the
 * one map below:
 *   instruction — "Go / Slow down / Stop": tells someone deciding whether to
 *                 send a crew out today what to do.
 *   analytic    — "Healthy / Approaching / Over": describes a row in a
 *                 revenue table a bookkeeper reads.
 */
export type BudgetBarTone = "instruction" | "analytic";

/** Track height scale. `sm` is the former boolean `thin`. */
export type BudgetBarSize = "sm" | "md";

/**
 * How the parts are arranged.
 *   stacked — label, pill + figures, track, legend on separate rows. The
 *             default, and what every full-width surface uses.
 *   inline  — a fixed-width track with the percentage beside it on one line,
 *             for a dense table cell. No pill, no dollars, no legend; an
 *             unscaled budget renders the tone's "unset" word on its own.
 */
export type BudgetBarLayout = "stacked" | "inline";

export interface BudgetBarProps {
  // ── Amounts mode ─────────────────────────────────────────────────────────
  /** Invoiced (billed) portion of the spend. Amounts mode. */
  invoicedAmount?: number;
  /** Pending / worked-but-not-yet-billed portion. Amounts mode. */
  pendingAmount?: number;
  /** Allocation cap. Pass null for "Unset". Amounts and total modes. */
  allocation?: number | null;

  // ── Total mode ───────────────────────────────────────────────────────────
  /**
   * Aggregate spend (invoiced plus worked-but-not-yet-billed) for a caller
   * whose endpoint returns no breakdown. Draws one segment and no legend, so
   * nothing here claims the whole figure has been invoiced.
   */
  spentAmount?: number | null;

  // ── Proportion mode ──────────────────────────────────────────────────────
  /**
   * Fill as a 0-to-100 PERCENTAGE, for callers that hold a ratio and no
   * money. Pass null for "Unset". Mutually exclusive with the amount props.
   */
  fillPercent?: number | null;

  // ── Classification ───────────────────────────────────────────────────────
  /** Percent at which status becomes "Slow down" / "Approaching". Default 75. */
  softThresholdPercent?: number;
  /** Percent at which status becomes "Stop" / "Over". Default 100. */
  hardThresholdPercent?: number;
  /**
   * Override the computed status entirely. Used where the server already
   * classified with each customer's custom thresholds and the client holds
   * no thresholds to re-derive it with.
   */
  forcedStatus?: BudgetStatus;

  // ── Presentation ─────────────────────────────────────────────────────────
  /** Track height scale. Default "md". */
  size?: BudgetBarSize;
  /** Arrangement. Default "stacked". */
  layout?: BudgetBarLayout;
  /**
   * Show the usage percentage as a figure — beside the dollars when they are
   * shown, on its own when they are not. The surfaces that printed a
   * percentage before the consolidation (customer profile, both Financial
   * Pulse meters, the customer form preview) pass this so their numbers are
   * unchanged. Suppressed by `hidePercent`.
   */
  showPercent?: boolean;
  /** Label vocabulary. Default "instruction". */
  tone?: BudgetBarTone;
  /** Optional caption rendered above the pill row. */
  label?: string;
  /** Render only the status pill — no track, no dollars, no legend. */
  pillOnly?: boolean;
  /** Hide the status pill (bar width only). */
  hideLabel?: boolean;
  /** Hide the dollar amounts row and the segment legend. */
  hideDollars?: boolean;
  /**
   * With no allocation, print the spend ("Spent $1,200 — no cap set") instead
   * of the bare "No allocation". For the surfaces that reported spend against
   * an uncapped period before the consolidation.
   */
  showSpendWhenUnset?: boolean;
  /**
   * Hide every percentage — the pill's "— 116%" suffix AND `aria-valuenow`.
   * Defaults to `hideDollars`, which is what hiding dollars has always
   * implied for the visible percentage.
   */
  hidePercent?: boolean;
  /** Extra CSS on the outermost wrapper. */
  className?: string;
  /** Test hook on the outermost wrapper. */
  "data-testid"?: string;
}

// ── The one label map ───────────────────────────────────────────────────────
// Two vocabularies, one place to change a word.
const STATUS_LABELS: Record<BudgetBarTone, Record<BudgetStatus, string>> = {
  instruction: {
    healthy:     "Go",
    approaching: "Slow down",
    over:        "Stop",
    unset:       "Unset",
  },
  analytic: {
    healthy:     "Healthy",
    approaching: "Approaching",
    over:        "Over",
    unset:       "—",
  },
};

// ── The one colour map ──────────────────────────────────────────────────────
// Task #2009 — semantic tokens registered in Task #2008 replace the three
// hardcoded palette maps. Pill = a 10% tint of the base token with the
// matching ink text and a 30% border; solid segment = the base token;
// pending segment = the base token at 30%. `unset` sits on the muted tokens.
const STATUS_PILL_CLASSES: Record<BudgetStatus, string> = {
  healthy:     "bg-success/10 text-success-ink border border-success/30",
  approaching: "bg-warning/10 text-warning-ink border border-warning/30",
  over:        "bg-destructive/10 text-destructive-ink border border-destructive/30",
  unset:       "bg-muted text-muted-foreground border border-border",
};

const INVOICED_TRACK_CLASSES: Record<BudgetStatus, string> = {
  healthy:     "bg-success",
  approaching: "bg-warning",
  over:        "bg-destructive",
  unset:       "bg-muted-foreground/40",
};

const PENDING_TRACK_CLASSES: Record<BudgetStatus, string> = {
  healthy:     "bg-success/30",
  approaching: "bg-warning/30",
  over:        "bg-destructive/30",
  unset:       "bg-muted-foreground/20",
};

const fmtCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function fmt(n: number) { return fmtCurrency.format(n); }

/** True outside a production build — where a props contract breach must shout. */
function isDevBuild(): boolean {
  try {
    return !import.meta.env?.PROD;
  } catch {
    return false;
  }
}

export function BudgetBar({
  invoicedAmount,
  pendingAmount,
  allocation,
  spentAmount,
  fillPercent,
  softThresholdPercent = 75,
  hardThresholdPercent = 100,
  forcedStatus,
  size = "md",
  layout = "stacked",
  showPercent = false,
  tone = "instruction",
  label,
  pillOnly = false,
  hideLabel = false,
  hideDollars = false,
  hidePercent = hideDollars,
  showSpendWhenUnset = false,
  className,
  "data-testid": testId,
}: BudgetBarProps) {
  const hasBreakdownInput =
    invoicedAmount !== undefined || pendingAmount !== undefined;
  const hasTotalInput = spentAmount !== undefined;
  const hasProportionInput = fillPercent !== undefined;
  const modeCount =
    Number(hasBreakdownInput) + Number(hasTotalInput) + Number(hasProportionInput);

  if (
    isDevBuild() &&
    (modeCount > 1 || (hasProportionInput && allocation !== undefined))
  ) {
    throw new Error(
      "BudgetBar: pass EXACTLY ONE input mode — amounts (invoicedAmount / " +
        "pendingAmount), a total (spentAmount) or a proportion (fillPercent). " +
        "Received more than one, which means one of them is a lie about the " +
        "same budget.",
    );
  }

  // Amounts mode wins if — against the contract above — a production build is
  // handed more than one, because it is the mode carrying the most figures.
  const isProportionMode =
    hasProportionInput && !hasBreakdownInput && !hasTotalInput;
  const isTotalMode = hasTotalInput && !hasBreakdownInput;
  /** Only a caller with the real split may claim which dollars were invoiced. */
  const hasBreakdown = !isProportionMode && !isTotalMode;

  const invoiced = isTotalMode ? spentAmount ?? 0 : invoicedAmount ?? 0;
  const pending = isTotalMode ? 0 : pendingAmount ?? 0;
  const cap = allocation ?? null;
  const totalSpend = invoiced + pending;

  // rawPercent: the TRUE 0-to-100 usage, unclamped — it drives the pill text.
  // usageRatio: the same quantity in the shared classifier's unit (1 === 100%).
  // The segment widths are clamped to the track; the status never is.
  let rawPercent: number | null = null;
  let usageRatio: number | null = null;
  let invoicedPct = 0;
  let pendingPct = 0;
  /** Whether there is a cap to mark — the track's 100% reference exists. */
  let hasScale = false;

  if (isProportionMode) {
    hasScale = fillPercent !== null && fillPercent !== undefined;
    if (fillPercent != null) {
      rawPercent = fillPercent;
      usageRatio = fillPercent / 100;
      invoicedPct = Math.min(Math.max(fillPercent, 0), 100);
    }
  } else {
    hasScale = cap !== null;
    if (cap !== null && cap > 0) {
      usageRatio = totalSpend / cap;
      rawPercent = usageRatio * 100;
      const clampedTotal = Math.min(totalSpend, cap);
      invoicedPct = Math.min((invoiced / cap) * 100, 100);
      // Pending fills up to the cap; cannot push total beyond track width.
      const pendingCapped = Math.max(0, clampedTotal - invoiced);
      pendingPct = (pendingCapped / cap) * 100;
    }
  }

  // forcedStatus overrides the locally-computed status. Surfaces that hold no
  // thresholds (crew view, Financial Pulse widget) pass the server-derived
  // status so each customer's custom soft/hard thresholds are honoured.
  const status =
    forcedStatus ??
    classifyBudgetPercent(usageRatio, softThresholdPercent, hardThresholdPercent);

  // Pill label: for "over", append the TRUE (unclamped) percentage — unless
  // percentages are suppressed on this surface.
  const labels = STATUS_LABELS[tone];
  let pillLabel = labels[status];
  if (status === "over" && rawPercent !== null && !hidePercent) {
    pillLabel = `${labels.over} — ${Math.round(rawPercent)}%`;
  }

  const pill = (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold leading-none",
        STATUS_PILL_CLASSES[status],
      )}
      aria-label={`Budget status: ${pillLabel}`}
    >
      {pillLabel}
    </span>
  );

  if (pillOnly) {
    return (
      <span className={className} data-testid={testId}>
        {pill}
      </span>
    );
  }

  const trackHeight = size === "sm" ? "h-1.5" : "h-3";
  // Dollars only exist in amounts mode — proportion mode has no money at all.
  const showDollars = !hideDollars && !isProportionMode;
  // The TRUE (unclamped) percentage, so 116% reads 116% wherever a surface
  // printed a percentage before. Suppressed with every other percentage.
  const percentText =
    !hidePercent && rawPercent !== null ? `${Math.round(rawPercent)}%` : null;

  const track = (widthClass: string) => (
    <div
      className={cn(
        "relative rounded-full overflow-hidden bg-gray-100",
        widthClass,
        trackHeight,
      )}
      role="progressbar"
      aria-valuenow={
        !hidePercent && rawPercent !== null
          ? Math.round(Math.min(rawPercent, 100))
          : undefined
      }
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Budget usage: ${pillLabel}`}
    >
      {/* Invoiced segment (solid) */}
      {invoicedPct > 0 && (
        <div
          className={cn(
            "absolute left-0 top-0 h-full transition-all duration-300",
            INVOICED_TRACK_CLASSES[status],
          )}
          style={{ width: `${invoicedPct}%` }}
        />
      )}
      {/* Pending segment (lighter tint, starts right after invoiced) */}
      {pendingPct > 0 && (
        <div
          className={cn(
            "absolute top-0 h-full transition-all duration-300",
            PENDING_TRACK_CLASSES[status],
          )}
          style={{
            left: `${invoicedPct}%`,
            width: `${pendingPct}%`,
          }}
        />
      )}
      {/* Cap marker at 100% — always visible on scaled tracks */}
      {hasScale && (
        <div
          className="absolute top-0 h-full w-0.5 bg-gray-400 opacity-60"
          style={{ left: "100%" }}
          aria-hidden="true"
        />
      )}
    </div>
  );

  // Inline: a dense table cell — fixed-width track, percentage beside it.
  if (layout === "inline") {
    if (!hasScale) {
      return (
        <span
          className={cn("text-sm text-gray-400", className)}
          data-testid={testId}
        >
          {labels.unset}
        </span>
      );
    }
    return (
      <div
        className={cn("flex items-center gap-2 min-w-[120px]", className)}
        data-testid={testId}
      >
        {track("w-24")}
        {showPercent && percentText && (
          <span className="text-xs text-gray-600 tabular-nums">
            {percentText}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={cn("space-y-1", className)} data-testid={testId}>
      {label && (
        <p className="text-xs font-medium text-gray-700 truncate">{label}</p>
      )}

      {/* Status pill + (optional) dollar amounts and percentage */}
      {(!hideLabel || showDollars || (showPercent && percentText)) && (
        <div className="flex items-center justify-between gap-2 min-h-[18px]">
          {!hideLabel && pill}
          {hideLabel && <span />}
          {showDollars && cap !== null && (
            <span className="text-[10px] text-gray-500 shrink-0">
              {fmt(totalSpend)} / {fmt(cap)}
              {showPercent && percentText && ` (${percentText})`}
            </span>
          )}
          {showDollars && cap === null && showSpendWhenUnset && (
            <span className="text-[10px] text-gray-500 shrink-0">
              Spent {fmt(totalSpend)} — no cap set
            </span>
          )}
          {showDollars && cap === null && !showSpendWhenUnset && (
            <span className="text-[10px] text-gray-400 italic shrink-0">No allocation</span>
          )}
          {!showDollars && showPercent && percentText && (
            <span className="text-[10px] text-gray-500 shrink-0 tabular-nums">
              {percentText}
            </span>
          )}
        </div>
      )}

      {/* Track */}
      {track("w-full")}

      {/* Segment legend — only where the caller holds the real invoiced /
          not-yet-billed split. A total-only caller draws no legend rather
          than relabelling its aggregate as invoiced. */}
      {hasBreakdown && size !== "sm" && showDollars && cap !== null && (invoiced > 0 || pending > 0) && (
        <div className="flex items-center gap-3 text-[10px] text-gray-500">
          {invoiced > 0 && (
            <span className="flex items-center gap-1">
              <span className={cn("inline-block w-2 h-2 rounded-sm", INVOICED_TRACK_CLASSES[status])} />
              Invoiced {fmt(invoiced)}
            </span>
          )}
          {pending > 0 && (
            <span className="flex items-center gap-1">
              <span className={cn("inline-block w-2 h-2 rounded-sm", PENDING_TRACK_CLASSES[status])} />
              Pending {fmt(pending)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
