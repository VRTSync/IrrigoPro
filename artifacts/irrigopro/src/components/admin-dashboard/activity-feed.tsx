import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Activity, FileText, Wrench, Receipt, ClipboardList, ChevronRight, type LucideIcon } from "lucide-react";

export interface ActivityItem {
  key: string;
  label: string;
  detail?: string;
  href: string;
  date: Date;
  icon: LucideIcon;
  iconClass: string;
}

interface ActivityFeedProps {
  items: ActivityItem[];
  isLoading: boolean;
  limit?: number;
}

function formatRelative(date: Date) {
  const diff = Date.now() - date.getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ActivityFeed({ items, isLoading, limit = 15 }: ActivityFeedProps) {
  const visible = items.slice(0, limit);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
          <Activity className="w-4 h-4 text-gray-500" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : visible.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-6">No recent activity</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {visible.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.key}>
                  <Link href={item.href}>
                    <div
                      className="flex items-center gap-3 py-2 hover:bg-gray-50 -mx-2 px-2 rounded transition-colors cursor-pointer"
                      data-testid={`activity-${item.key}`}
                    >
                      <div className={`p-1.5 rounded ${item.iconClass} shrink-0`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 truncate">{item.label}</p>
                        {item.detail && (
                          <p className="text-xs text-gray-500 truncate">{item.detail}</p>
                        )}
                      </div>
                      <span className="text-xs text-gray-400 shrink-0">{formatRelative(item.date)}</span>
                      <ChevronRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export const ActivityIcons = { FileText, Wrench, Receipt, ClipboardList };
