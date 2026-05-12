import { cn } from "@/lib/utils";

export type HealthBucket = "ok" | "warn" | "bad" | "crit";

export function bucketColor(bucket: HealthBucket): string {
  switch (bucket) {
    case "ok": return "bg-emerald-500";
    case "warn": return "bg-amber-500";
    case "bad": return "bg-orange-500";
    case "crit": return "bg-red-600";
  }
}

export function bucketLabel(bucket: HealthBucket): string {
  switch (bucket) {
    case "ok": return "Healthy";
    case "warn": return "Watch";
    case "bad": return "At risk";
    case "crit": return "Critical";
  }
}

export function HealthScoreBar({
  score,
  bucket,
  className,
}: {
  score: number;
  bucket: HealthBucket;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, score));
  return (
    <div className={cn("flex items-center gap-2 min-w-[140px]", className)}>
      <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={cn("h-full transition-all", bucketColor(bucket))}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="text-xs font-semibold text-gray-700 w-7 text-right tabular-nums">
        {clamped}
      </span>
    </div>
  );
}
