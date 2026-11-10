import { useId } from "react";

export function DocNotesField({ value, onChange, placeholder, testId }:
  { value: string; onChange: (v: string) => void; placeholder: string; testId: string }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">Notes (optional)</label>
      <textarea id={id} rows={3} maxLength={1000}
        className="w-full min-w-0 rounded-xl border border-slate-300 px-3.5 py-3 text-base"
        value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} data-testid={testId} />
      {value.length > 800 && (
        <p aria-live="polite" className="text-xs text-muted-foreground text-right">{value.length} / 1000</p>
      )}
    </div>
  );
}
