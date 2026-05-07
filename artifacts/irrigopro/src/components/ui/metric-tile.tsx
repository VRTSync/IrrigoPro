import * as React from "react";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

type MetricVariant = "default" | "primary" | "success" | "warning" | "danger";

interface MetricTileProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  variant?: MetricVariant;
  trend?: {
    value: string;
    isPositive: boolean;
  };
  onClick?: () => void;
  className?: string;
  testId?: string;
}

const variantStyles: Record<MetricVariant, string> = {
  default: "bg-white",
  primary: "metric-tile-primary",
  success: "bg-gradient-to-br from-emerald-50 to-emerald-25 border border-emerald-100",
  warning: "bg-gradient-to-br from-amber-50 to-amber-25 border border-amber-100",
  danger: "bg-gradient-to-br from-red-50 to-red-25 border border-red-100",
};

const iconColors: Record<MetricVariant, string> = {
  default: "text-slate-400",
  primary: "text-sky-500",
  success: "text-emerald-500",
  warning: "text-amber-500",
  danger: "text-red-500",
};

export function MetricTile({
  label,
  value,
  icon: Icon,
  variant = "default",
  trend,
  onClick,
  className,
  testId,
}: MetricTileProps) {
  const Component = onClick ? "button" : "div";

  return (
    <Component
      onClick={onClick}
      className={cn(
        "metric-tile text-left w-full",
        variantStyles[variant],
        onClick && "cursor-pointer transition-transform duration-150 active:scale-[0.98]",
        className
      )}
      data-testid={testId}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-500 mb-1">{label}</p>
          <p className="text-3xl font-bold text-slate-900 tracking-tight">
            {value}
          </p>
          {trend && (
            <div className="flex items-center gap-1 mt-2">
              <span
                className={cn(
                  "text-xs font-medium",
                  trend.isPositive ? "text-emerald-600" : "text-red-600"
                )}
              >
                {trend.isPositive ? "↑" : "↓"} {trend.value}
              </span>
            </div>
          )}
        </div>
        {Icon && (
          <div className={cn("p-2 rounded-xl bg-white/50", iconColors[variant])}>
            <Icon className="w-6 h-6" />
          </div>
        )}
      </div>
    </Component>
  );
}

interface MetricTileSkeletonProps {
  className?: string;
}

export function MetricTileSkeleton({ className }: MetricTileSkeletonProps) {
  return (
    <div className={cn("metric-tile", className)}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="skeleton-shimmer h-4 w-20 mb-2" />
          <div className="skeleton-shimmer h-9 w-16" />
        </div>
        <div className="skeleton-shimmer h-10 w-10 rounded-xl" />
      </div>
    </div>
  );
}

interface MetricGridProps {
  children: React.ReactNode;
  className?: string;
}

export function MetricGrid({ children, className }: MetricGridProps) {
  return (
    <div className={cn(
      "grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4",
      className
    )}>
      {children}
    </div>
  );
}
