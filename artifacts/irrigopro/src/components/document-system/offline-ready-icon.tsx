import { Cloud, CloudCheck, CloudDownload } from "lucide-react";
import { cn } from "@/lib/utils";

/** Readiness of the local copy, not connectivity or verification status. */
export function OfflineReadyIcon({ savedCount, total = 1, testId }: {
  savedCount: number | null;
  total?: number;
  testId?: string;
}) {
  const ready = savedCount !== null && total > 0 && savedCount === total;
  const partial = !ready && savedCount !== null && savedCount > 0;
  const label = savedCount === null ? "Offline readiness not confirmed"
    : ready ? "Offline ready — saved on this phone"
    : partial ? `Partly offline — ${savedCount} of ${total} branches saved on this phone`
    : "Not saved offline — connect to download";
  const Icon = ready ? CloudCheck : partial ? CloudDownload : Cloud;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("mt-0.5 inline-flex shrink-0", ready ? "text-emerald-600" : partial ? "text-amber-600" : "text-slate-400")}
      data-testid={testId}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </span>
  );
}
