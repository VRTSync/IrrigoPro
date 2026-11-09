import { cn } from "@/lib/utils";

export type TakenLetter = { letter: string; controllerId: number; label: string };

const LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));

/** Shared A-Z picker. Taken letters stay tappable; the caller decides whether to offer a swap. */
export function LetterPicker({ value, onPick, taken, suggested, disabled }: {
  value: string | null;
  onPick: (letter: string) => void;
  taken: TakenLetter[];
  suggested?: string | null;
  disabled?: boolean;
}) {
  const sel = value?.toUpperCase() ?? null;
  const sug = suggested?.toUpperCase() ?? null;
  return (
    <div className="grid grid-cols-6 sm:grid-cols-9 gap-2" role="group" aria-label="Controller letter" data-testid="letter-picker">
      {LETTERS.map((l) => {
        const holder = taken.find((t) => t.letter.toUpperCase() === l);
        const selected = sel === l;
        const isSuggested = !selected && !holder && sug === l;
        const label = `Letter ${l}${holder ? `, used by ${holder.label}` : ""}${isSuggested ? ", suggested" : ""}`;
        return (
          <button
            key={l}
            type="button"
            disabled={disabled}
            aria-label={label}
            aria-pressed={selected}
            onClick={() => onPick(l)}
            data-testid={`letter-${l}`}
            className={cn(
              "flex h-12 flex-col items-center justify-center rounded-xl border text-lg font-bold leading-none disabled:opacity-50",
              selected ? "bg-primary text-white border-primary"
                : holder ? "bg-slate-100 text-slate-500 border-slate-200"
                : "bg-white border-slate-300",
              isSuggested && "border-2 border-dashed border-primary",
            )}
          >
            {l}
            {holder && !selected && <span className="mt-0.5 text-[11px] font-normal">in use</span>}
          </button>
        );
      })}
    </div>
  );
}
