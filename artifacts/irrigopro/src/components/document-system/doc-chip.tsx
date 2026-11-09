import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface DocChipProps {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  testId?: string;
  disabled?: boolean;
}

export function DocChip({ selected, onClick, children, testId, disabled }: DocChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "min-h-11 px-3.5 rounded-xl border border-slate-300 bg-white text-[15px] font-medium text-slate-800 transition-colors active:scale-[0.98] disabled:opacity-50",
        selected && "border-2 border-primary bg-primary/10 text-primary-dark font-semibold px-[13px]",
      )}
    >
      {children}
    </button>
  );
}
