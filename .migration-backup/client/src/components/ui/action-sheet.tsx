import * as React from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

interface ActionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  title?: string;
  description?: string;
  className?: string;
}

export function ActionSheet({
  open,
  onOpenChange,
  children,
  title,
  description,
  className,
}: ActionSheetProps) {
  React.useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm animate-fade-in"
        onClick={() => onOpenChange(false)}
        data-testid="action-sheet-overlay"
      />
      <div
        className={cn(
          "action-sheet animate-slide-up",
          className
        )}
        data-testid="action-sheet-content"
      >
        <div className="action-sheet-handle" />
        
        {(title || description) && (
          <div className="px-5 pb-4 border-b border-slate-100">
            <div className="flex items-start justify-between">
              <div>
                {title && (
                  <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
                )}
                {description && (
                  <p className="text-sm text-slate-500 mt-1">{description}</p>
                )}
              </div>
              <button
                onClick={() => onOpenChange(false)}
                className="p-2 -mr-2 rounded-full hover:bg-slate-100 transition-colors touch-target"
                data-testid="action-sheet-close"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
          </div>
        )}
        
        <div className="px-5 py-4 overflow-y-auto max-h-[calc(90vh-120px)]">
          {children}
        </div>
      </div>
    </>
  );
}

interface ActionSheetItemProps {
  children: React.ReactNode;
  onClick?: () => void;
  icon?: React.ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  className?: string;
}

export function ActionSheetItem({
  children,
  onClick,
  icon,
  destructive = false,
  disabled = false,
  className,
}: ActionSheetItemProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full flex items-center gap-4 px-4 py-4 rounded-xl text-left transition-all duration-150 touch-target",
        "hover:bg-slate-50 active:bg-slate-100 active:scale-[0.98]",
        destructive && "text-red-600 hover:bg-red-50 active:bg-red-100",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
      data-testid="action-sheet-item"
    >
      {icon && (
        <span className={cn(
          "flex-shrink-0",
          destructive ? "text-red-500" : "text-slate-500"
        )}>
          {icon}
        </span>
      )}
      <span className="text-base font-medium">{children}</span>
    </button>
  );
}

interface ActionSheetSectionProps {
  children: React.ReactNode;
  title?: string;
}

export function ActionSheetSection({ children, title }: ActionSheetSectionProps) {
  return (
    <div className="py-2">
      {title && (
        <p className="px-4 pb-2 text-xs font-medium text-slate-400 uppercase tracking-wider">
          {title}
        </p>
      )}
      <div className="space-y-1">{children}</div>
    </div>
  );
}
