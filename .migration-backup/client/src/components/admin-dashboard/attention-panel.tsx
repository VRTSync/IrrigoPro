import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Camera,
  Wrench,
  Package,
  Clock,
  Users,
  DollarSign,
  FileWarning,
  Droplets,
  type LucideIcon,
} from "lucide-react";

export interface AttentionRow {
  key: string;
  label: string;
  count: number;
  href: string;
  icon: LucideIcon;
  tone: "amber" | "red" | "blue" | "orange";
  testId?: string;
}

interface AttentionPanelProps {
  rows: AttentionRow[];
  isLoading: boolean;
}

const TONE: Record<AttentionRow["tone"], { bg: string; text: string; badge: string }> = {
  amber:  { bg: "bg-amber-100",  text: "text-amber-700",  badge: "bg-amber-100 text-amber-800 border-amber-200" },
  red:    { bg: "bg-red-100",    text: "text-red-700",    badge: "bg-red-100 text-red-800 border-red-200" },
  blue:   { bg: "bg-blue-100",   text: "text-blue-700",   badge: "bg-blue-100 text-blue-800 border-blue-200" },
  orange: { bg: "bg-orange-100", text: "text-orange-700", badge: "bg-orange-100 text-orange-800 border-orange-200" },
};

export function AttentionPanel({ rows, isLoading }: AttentionPanelProps) {
  const visible = rows.filter((r) => r.count > 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          Needs Your Attention
          {!isLoading && visible.length > 0 && (
            <Badge variant="outline" className="ml-1 text-xs">{visible.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-8 text-gray-500" data-testid="empty-attention">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-green-400" />
            <p className="text-sm font-medium text-gray-700">All clear</p>
            <p className="text-xs text-gray-500 mt-0.5">Nothing needs your attention right now.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {visible.map((row) => {
              const t = TONE[row.tone];
              const Icon = row.icon;
              return (
                <div
                  key={row.key}
                  className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                  data-testid={row.testId ?? `attention-${row.key}`}
                >
                  <div className={`${t.bg} p-2 rounded-lg shrink-0`}>
                    <Icon className={`w-4 h-4 ${t.text}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{row.label}</p>
                  </div>
                  <Badge variant="outline" className={`shrink-0 font-semibold ${t.badge}`}>
                    {row.count > 999 ? "999+" : row.count}
                  </Badge>
                  <Link href={row.href}>
                    <Button size="sm" variant="ghost" className="text-xs gap-1 shrink-0">
                      Review <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Re-export the icons used by the page for convenience
export const AttentionIcons = {
  Camera, Wrench, Package, Clock, Users, DollarSign, FileWarning, Droplets,
};
