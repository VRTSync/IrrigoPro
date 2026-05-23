import { Loader2, type LucideIcon } from "lucide-react";

export interface DecisionCardProps {
  testId: string;
  accent: "blue" | "purple" | "gray" | "green";
  icon: LucideIcon;
  title: string;
  helper: string;
  /** Optional hint shown next to the title — e.g. the keyboard shortcut "1". */
  shortcutLabel?: string;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}

const ACCENTS: Record<DecisionCardProps["accent"], { border: string; bg: string; text: string; ring: string; chip: string }> = {
  blue:   { border: "border-blue-300",   bg: "bg-blue-50",   text: "text-blue-700",   ring: "hover:ring-2 hover:ring-blue-300 focus-visible:ring-2 focus-visible:ring-blue-500",   chip: "bg-white text-blue-700 border-blue-300" },
  purple: { border: "border-purple-300", bg: "bg-purple-50", text: "text-purple-700", ring: "hover:ring-2 hover:ring-purple-300 focus-visible:ring-2 focus-visible:ring-purple-500", chip: "bg-white text-purple-700 border-purple-300" },
  gray:   { border: "border-gray-300",   bg: "bg-gray-50",   text: "text-gray-700",   ring: "hover:ring-2 hover:ring-gray-300 focus-visible:ring-2 focus-visible:ring-gray-500",   chip: "bg-white text-gray-700 border-gray-300" },
  green:  { border: "border-green-300",  bg: "bg-green-50",  text: "text-green-700",  ring: "hover:ring-2 hover:ring-green-300 focus-visible:ring-2 focus-visible:ring-green-500",  chip: "bg-white text-green-700 border-green-300" },
};

export function DecisionCard({
  testId, accent, icon: Icon, title, helper, shortcutLabel, disabled, loading, onClick,
}: DecisionCardProps) {
  const a = ACCENTS[accent];
  return (
    <button
      type="button"
      role="button"
      tabIndex={0}
      onClick={onClick}
      disabled={disabled}
      aria-label={shortcutLabel ? `${title} (shortcut ${shortcutLabel})` : title}
      data-testid={testId}
      className={`text-left rounded-lg border-2 ${a.border} ${a.bg} p-4 min-h-[88px] transition-all outline-none ${a.ring} disabled:opacity-50 disabled:cursor-not-allowed w-full`}
    >
      <div className={`flex items-center gap-2 font-semibold ${a.text}`}>
        {loading ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> : <Icon className="w-5 h-5" aria-hidden="true" />}
        <span className="flex-1">{title}</span>
        {shortcutLabel && (
          <span
            aria-hidden="true"
            className={`hidden sm:inline-flex items-center justify-center text-xs font-mono border rounded px-1.5 py-0.5 ${a.chip}`}
          >
            {shortcutLabel}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-gray-700">{helper}</p>
    </button>
  );
}
