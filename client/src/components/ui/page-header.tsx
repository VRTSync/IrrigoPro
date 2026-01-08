import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";
import { useLocation } from "wouter";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  backHref?: string;
  actions?: React.ReactNode;
  className?: string;
  sticky?: boolean;
}

export function PageHeader({
  title,
  subtitle,
  backHref,
  actions,
  className,
  sticky = true,
}: PageHeaderProps) {
  const [, setLocation] = useLocation();

  return (
    <header
      className={cn(
        "px-5 py-4 bg-white/90 backdrop-blur-lg border-b border-slate-100",
        sticky && "sticky top-0 z-30",
        className
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {backHref && (
            <button
              onClick={() => setLocation(backHref)}
              className="p-2 -ml-2 rounded-xl hover:bg-slate-100 active:bg-slate-200 transition-colors touch-target"
              data-testid="page-header-back"
            >
              <ChevronLeft className="w-6 h-6 text-slate-600" />
            </button>
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-slate-900 truncate tracking-tight">
              {title}
            </h1>
            {subtitle && (
              <p className="text-sm text-slate-500 truncate mt-0.5">{subtitle}</p>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex items-center gap-2 flex-shrink-0">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}

interface PageContainerProps {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}

export function PageContainer({
  children,
  className,
  padded = true,
}: PageContainerProps) {
  return (
    <div
      className={cn(
        "min-h-screen bg-slate-50",
        padded && "pb-32",
        className
      )}
    >
      {children}
    </div>
  );
}

interface PageContentProps {
  children: React.ReactNode;
  className?: string;
}

export function PageContent({ children, className }: PageContentProps) {
  return (
    <div className={cn("px-5 py-4", className)}>
      {children}
    </div>
  );
}
