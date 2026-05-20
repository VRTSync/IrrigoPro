import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

const STEP = 0.25;

function fmt(v: number): string {
  return v.toFixed(2);
}

export function LaborHoursStepper({
  value,
  onChange,
  min = "0.25",
  max,
  disabled = false,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  label?: string;
}) {
  const num = parseFloat(value) || 0;
  const minNum = parseFloat(min);
  const maxNum = max !== undefined ? parseFloat(max) : Infinity;

  const decrement = () => {
    const next = Math.round((num - STEP) * 4) / 4;
    if (next >= minNum) onChange(fmt(next));
  };

  const increment = () => {
    const next = Math.round((num + STEP) * 4) / 4;
    if (next <= maxNum) onChange(fmt(next));
  };

  const atMin = num <= minNum;
  const atMax = max !== undefined && num >= maxNum;

  return (
    <div className="flex flex-col gap-1">
      {label && <div className="text-sm font-medium">{label}</div>}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11 w-11 p-0 shrink-0"
          onClick={decrement}
          disabled={disabled || atMin}
          aria-label="Decrease labor hours"
          data-testid="labor-stepper-minus"
        >
          <Minus className="w-4 h-4" />
        </Button>
        <div
          className="flex-1 text-center text-base font-mono tabular-nums select-none"
          aria-live="polite"
          aria-label={`${fmt(num)} hours`}
          data-testid="labor-stepper-display"
        >
          {fmt(num)} hrs
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11 w-11 p-0 shrink-0"
          onClick={increment}
          disabled={disabled || atMax}
          aria-label="Increase labor hours"
          data-testid="labor-stepper-plus"
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
