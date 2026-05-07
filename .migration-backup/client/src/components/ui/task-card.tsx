import * as React from "react";
import { cn } from "@/lib/utils";
import { Calendar, MapPin, Clock, User, ChevronRight } from "lucide-react";

type TaskStatus = "pending" | "active" | "in_progress" | "complete" | "completed" | "urgent" | "draft";

interface TaskCardProps {
  title: string;
  subtitle?: string;
  status: TaskStatus;
  statusLabel?: string;
  address?: string;
  date?: string;
  time?: string;
  assignee?: string;
  onClick?: () => void;
  actionButton?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  testId?: string;
}

const statusConfig: Record<TaskStatus, { border: string; badge: string; label: string }> = {
  pending: {
    border: "task-card-pending",
    badge: "badge-pending",
    label: "Pending",
  },
  active: {
    border: "task-card-active",
    badge: "badge-active",
    label: "Active",
  },
  in_progress: {
    border: "task-card-active",
    badge: "badge-active",
    label: "In Progress",
  },
  complete: {
    border: "task-card-complete",
    badge: "badge-complete",
    label: "Complete",
  },
  completed: {
    border: "task-card-complete",
    badge: "badge-complete",
    label: "Completed",
  },
  urgent: {
    border: "task-card-urgent",
    badge: "badge-urgent",
    label: "Urgent",
  },
  draft: {
    border: "",
    badge: "badge-draft",
    label: "Draft",
  },
};

export function TaskCard({
  title,
  subtitle,
  status,
  statusLabel,
  address,
  date,
  time,
  assignee,
  onClick,
  actionButton,
  children,
  className,
  testId,
}: TaskCardProps) {
  const config = statusConfig[status] || statusConfig.pending;
  const displayLabel = statusLabel || config.label;

  const CardWrapper = onClick ? "button" : "div";

  return (
    <CardWrapper
      onClick={onClick}
      className={cn(
        "task-card w-full text-left",
        config.border,
        onClick && "cursor-pointer",
        className
      )}
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={cn("badge-status", config.badge)}>
              {displayLabel}
            </span>
          </div>
          <h3 className="text-lg font-semibold text-slate-900 truncate">
            {title}
          </h3>
          {subtitle && (
            <p className="text-sm text-slate-500 truncate mt-0.5">{subtitle}</p>
          )}
        </div>
        {onClick && (
          <ChevronRight className="w-5 h-5 text-slate-400 flex-shrink-0 mt-1" />
        )}
      </div>

      <div className="mt-4 space-y-2">
        {address && (
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <MapPin className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <span className="truncate">{address}</span>
          </div>
        )}
        
        <div className="flex flex-wrap items-center gap-4">
          {date && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Calendar className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <span>{date}</span>
            </div>
          )}
          {time && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Clock className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <span>{time}</span>
            </div>
          )}
          {assignee && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <User className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <span className="truncate">{assignee}</span>
            </div>
          )}
        </div>
      </div>

      {children && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          {children}
        </div>
      )}

      {actionButton && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          {actionButton}
        </div>
      )}
    </CardWrapper>
  );
}

interface TaskCardSkeletonProps {
  className?: string;
}

export function TaskCardSkeleton({ className }: TaskCardSkeletonProps) {
  return (
    <div className={cn("task-card", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="skeleton-shimmer h-6 w-20 mb-2" />
          <div className="skeleton-shimmer h-6 w-48 mb-1" />
          <div className="skeleton-shimmer h-4 w-32" />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <div className="skeleton-shimmer h-4 w-56" />
        <div className="flex gap-4">
          <div className="skeleton-shimmer h-4 w-24" />
          <div className="skeleton-shimmer h-4 w-20" />
        </div>
      </div>
    </div>
  );
}
