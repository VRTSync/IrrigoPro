import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type WizardAccent = "blue" | "orange";

export interface WizardHeaderProps {
  /** Icon shown in the leading chip (e.g. FileText). */
  icon: LucideIcon;
  /** Short wizard kind label ("Estimate", "Work Order", "Billing Sheet"). */
  kindLabel: string;
  /** Whether the wizard is creating a new record or editing one. */
  mode: "new" | "edit";
  /** Optional identifier shown when editing (e.g. "#42" or "Acme Co · 5/12"). */
  recordIdentifier?: string | null;
  /** 1-based current step number. */
  currentStep: number;
  /** Total number of steps. */
  totalSteps: number;
  /** Human-readable step titles, length === totalSteps. */
  stepTitles: string[];
  /** Optional secondary context line (customer, branch, date, total). */
  contextLine?: string | null;
  /** Show a small inline loading indicator next to the title. */
  loading?: boolean;
  /** Label shown next to the loading spinner. Defaults to "Loading…". */
  loadingLabel?: string;
  /** Theme accent color. Defaults to "blue". */
  accent?: WizardAccent;
  /** Optional leading slot, typically a mobile back button. */
  leading?: ReactNode;
}

const ACCENT: Record<
  WizardAccent,
  {
    iconBg: string;
    iconText: string;
    chipActiveBg: string;
    chipActiveText: string;
    chipActiveRing: string;
    chipDoneBg: string;
    chipDoneText: string;
    bar: string;
  }
> = {
  blue: {
    iconBg: "bg-blue-50 dark:bg-blue-950/40",
    iconText: "text-blue-600 dark:text-blue-300",
    chipActiveBg: "bg-blue-600",
    chipActiveText: "text-white",
    chipActiveRing: "ring-2 ring-blue-200 dark:ring-blue-900",
    chipDoneBg: "bg-blue-100 dark:bg-blue-900/40",
    chipDoneText: "text-blue-700 dark:text-blue-200",
    bar: "bg-blue-600",
  },
  orange: {
    iconBg: "bg-orange-50 dark:bg-orange-950/40",
    iconText: "text-orange-600 dark:text-orange-300",
    chipActiveBg: "bg-orange-600",
    chipActiveText: "text-white",
    chipActiveRing: "ring-2 ring-orange-200 dark:ring-orange-900",
    chipDoneBg: "bg-orange-100 dark:bg-orange-900/40",
    chipDoneText: "text-orange-700 dark:text-orange-200",
    bar: "bg-orange-600",
  },
};

export function WizardHeader({
  icon: Icon,
  kindLabel,
  mode,
  recordIdentifier,
  currentStep,
  totalSteps,
  stepTitles,
  contextLine,
  loading = false,
  loadingLabel = "Loading…",
  accent = "blue",
  leading,
}: WizardHeaderProps) {
  const colors = ACCENT[accent];
  const stepIdx = Math.min(Math.max(currentStep, 1), totalSteps);
  const stepTitle = stepTitles[stepIdx - 1] ?? "";
  const progressPct = Math.round((stepIdx / totalSteps) * 100);

  const titleText =
    mode === "edit"
      ? `Edit ${kindLabel}${recordIdentifier ? ` ${recordIdentifier}` : ""}`
      : `New ${kindLabel}`;

  return (
    <div
      className="sticky top-0 z-20 bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800"
      data-testid="wizard-header"
    >
      <div className="px-4 py-3 sm:py-3.5">
        <div className="flex items-start gap-2.5">
          {leading}
          <div
            className={cn(
              "hidden sm:flex shrink-0 p-2 rounded-md items-center justify-center",
              colors.iconBg,
            )}
          >
            <Icon className={cn("w-4 h-4", colors.iconText)} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wide font-medium text-gray-500 dark:text-gray-400">
              {kindLabel} · Step {stepIdx} of {totalSteps}
              <span className="hidden sm:inline"> — {stepTitle}</span>
            </div>
            <div className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 truncate flex items-center gap-2">
              <span className="truncate">{titleText}</span>
              {loading && (
                <span className="inline-flex items-center gap-1 text-xs font-normal text-gray-500 dark:text-gray-400">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {loadingLabel}
                </span>
              )}
            </div>
            <div className="sm:hidden text-xs text-gray-600 dark:text-gray-400 truncate mt-0.5">
              {stepTitle}
            </div>
            {contextLine && (
              <div
                className="text-xs text-gray-600 dark:text-gray-400 truncate mt-1"
                data-testid="wizard-header-context"
              >
                {contextLine}
              </div>
            )}
          </div>
        </div>

        {/* Compact horizontal stepper, md+ only */}
        <ol
          className="hidden md:flex items-center gap-1.5 mt-3 overflow-x-auto"
          aria-label="Wizard progress"
        >
          {stepTitles.map((label, i) => {
            const num = i + 1;
            const isActive = num === stepIdx;
            const isDone = num < stepIdx;
            return (
              <li key={num} className="flex items-center gap-1.5 shrink-0">
                <div
                  className={cn(
                    "flex items-center gap-1.5 rounded-full pl-1 pr-2.5 py-1 text-xs font-medium transition-colors",
                    isActive
                      ? cn(colors.chipActiveBg, colors.chipActiveText, colors.chipActiveRing)
                      : isDone
                      ? cn(colors.chipDoneBg, colors.chipDoneText)
                      : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400",
                  )}
                  aria-current={isActive ? "step" : undefined}
                >
                  <span
                    className={cn(
                      "inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold",
                      isActive
                        ? "bg-white/20 text-white"
                        : isDone
                        ? "bg-white/70 dark:bg-gray-950/40"
                        : "bg-white dark:bg-gray-900",
                    )}
                  >
                    {isDone ? <Check className="w-3 h-3" /> : num}
                  </span>
                  <span className="whitespace-nowrap">{label}</span>
                </div>
                {num < stepTitles.length && (
                  <span
                    className={cn(
                      "h-px w-4 shrink-0",
                      isDone ? colors.bar : "bg-gray-200 dark:bg-gray-800",
                    )}
                    aria-hidden
                  />
                )}
              </li>
            );
          })}
        </ol>
      </div>
      <div
        className="h-1 bg-gray-100 dark:bg-gray-800"
        role="progressbar"
        aria-valuenow={progressPct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn("h-1 transition-all", colors.bar)}
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}
