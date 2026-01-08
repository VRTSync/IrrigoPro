import * as React from "react";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";

interface FABProps {
  onClick: () => void;
  icon?: React.ReactNode;
  label?: string;
  className?: string;
  testId?: string;
}

export function FAB({
  onClick,
  icon,
  label,
  className,
  testId = "fab-button",
}: FABProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "fab",
        label && "w-auto px-5 gap-2",
        className
      )}
      data-testid={testId}
    >
      {icon || <Plus className="w-7 h-7" />}
      {label && <span className="font-semibold text-base">{label}</span>}
    </button>
  );
}

interface FABExtendedProps {
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
  className?: string;
  testId?: string;
}

export function FABExtended({
  onClick,
  icon,
  label,
  className,
  testId = "fab-extended-button",
}: FABExtendedProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "fixed z-40 flex items-center justify-center gap-3 px-6 h-14 rounded-2xl text-white font-semibold transition-all duration-200",
        "right-5 bottom-24",
        "bg-gradient-to-r from-sky-500 to-sky-600",
        "shadow-lg shadow-sky-500/30",
        "active:scale-95",
        className
      )}
      data-testid={testId}
    >
      {icon || <Plus className="w-5 h-5" />}
      <span>{label}</span>
    </button>
  );
}
