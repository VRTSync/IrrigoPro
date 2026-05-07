import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import type { LucideIcon } from "lucide-react";

interface KpiTileProps {
  label: string;
  value: number | string | null;
  icon: LucideIcon;
  href?: string;
  isLoading?: boolean;
  isError?: boolean;
  helper?: string;
  accent?: "blue" | "green" | "amber" | "purple" | "rose" | "teal";
  testId?: string;
}

const ACCENTS: Record<NonNullable<KpiTileProps["accent"]>, { bg: string; text: string; border: string }> = {
  blue:   { bg: "bg-blue-50",   text: "text-blue-600",   border: "border-l-blue-500" },
  green:  { bg: "bg-green-50",  text: "text-green-600",  border: "border-l-green-500" },
  amber:  { bg: "bg-amber-50",  text: "text-amber-600",  border: "border-l-amber-500" },
  purple: { bg: "bg-purple-50", text: "text-purple-600", border: "border-l-purple-500" },
  rose:   { bg: "bg-rose-50",   text: "text-rose-600",   border: "border-l-rose-500" },
  teal:   { bg: "bg-teal-50",   text: "text-teal-600",   border: "border-l-teal-500" },
};

export function KpiTile({
  label,
  value,
  icon: Icon,
  href,
  isLoading,
  isError,
  helper,
  accent = "blue",
  testId,
}: KpiTileProps) {
  const a = ACCENTS[accent];

  const inner = (
    <Card
      className={`border-l-4 ${a.border} h-full ${href ? "cursor-pointer hover:shadow-md transition-shadow" : ""}`}
      data-testid={testId}
    >
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-medium text-gray-500 truncate">{label}</p>
            <div className="mt-1">
              {isLoading ? (
                <Skeleton className="h-7 w-20" />
              ) : isError ? (
                <p className="text-2xl font-bold text-gray-300">—</p>
              ) : (
                <p className="text-2xl font-bold text-gray-900">{value ?? 0}</p>
              )}
            </div>
            {helper && !isLoading && (
              <p className="text-xs text-gray-400 mt-1 truncate">{helper}</p>
            )}
          </div>
          <div className={`${a.bg} p-2 rounded-lg shrink-0`}>
            <Icon className={`w-5 h-5 ${a.text}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (href) return <Link href={href}>{inner}</Link>;
  return inner;
}
