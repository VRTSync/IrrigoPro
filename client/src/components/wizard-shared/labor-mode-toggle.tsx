import { Clock, ListTree } from "lucide-react";

export type LaborMode = "flat" | "per_part";

interface LaborModeToggleProps {
  value: LaborMode;
  onChange: (next: LaborMode) => void;
  disabled?: boolean;
  className?: string;
  testIdPrefix?: string;
}

export function LaborModeToggle({
  value,
  onChange,
  disabled,
  className,
  testIdPrefix = "labor-mode",
}: LaborModeToggleProps) {
  const base =
    "flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1";
  const active = "bg-white text-blue-700 shadow-sm";
  const inactive = "text-gray-600 hover:text-gray-900";
  return (
    <div className={className}>
      <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
        Labor mode
      </div>
      <div
        role="tablist"
        aria-label="Labor mode"
        className="inline-flex items-center gap-1 p-1 rounded-lg bg-gray-100 border w-full max-w-sm"
      >
        <button
          type="button"
          role="tab"
          aria-selected={value === "flat"}
          disabled={disabled}
          onClick={() => onChange("flat")}
          className={`${base} ${value === "flat" ? active : inactive}`}
          data-testid={`${testIdPrefix}-flat`}
        >
          <Clock className="w-3.5 h-3.5" />
          Flat rate
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={value === "per_part"}
          disabled={disabled}
          onClick={() => onChange("per_part")}
          className={`${base} ${value === "per_part" ? active : inactive}`}
          data-testid={`${testIdPrefix}-per-part`}
        >
          <ListTree className="w-3.5 h-3.5" />
          Per part
        </button>
      </div>
      <p className="text-[11px] text-gray-500 mt-1">
        {value === "flat"
          ? "Single Total labor hours field for the whole ticket."
          : "Enter labor hours per line item; totals sum across rows."}
      </p>
    </div>
  );
}
