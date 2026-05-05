import { Loader2, type LucideIcon } from "lucide-react";

export interface DecisionCardProps {
  testId: string;
  accent: "blue" | "purple" | "gray";
  icon: LucideIcon;
  title: string;
  helper: string;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}

const ACCENTS: Record<DecisionCardProps["accent"], { border: string; bg: string; text: string; ring: string }> = {
  blue:   { border: "border-blue-300",   bg: "bg-blue-50",   text: "text-blue-700",   ring: "hover:ring-2 hover:ring-blue-300" },
  purple: { border: "border-purple-300", bg: "bg-purple-50", text: "text-purple-700", ring: "hover:ring-2 hover:ring-purple-300" },
  gray:   { border: "border-gray-300",   bg: "bg-gray-50",   text: "text-gray-700",   ring: "hover:ring-2 hover:ring-gray-300" },
};

export function DecisionCard({ testId, accent, icon: Icon, title, helper, disabled, loading, onClick }: DecisionCardProps) {
  const a = ACCENTS[accent];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={`text-left rounded-lg border-2 ${a.border} ${a.bg} p-4 transition-all ${a.ring} disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      <div className={`flex items-center gap-2 font-semibold ${a.text}`}>
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Icon className="w-5 h-5" />}
        <span>{title}</span>
      </div>
      <p className="mt-1 text-xs text-gray-600">{helper}</p>
    </button>
  );
}
