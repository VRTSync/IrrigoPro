import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, Clock } from "lucide-react";

export interface WetCheckCardData {
  id: number;
  customerName: string;
  propertyAddress: string | null;
  technicianName: string;
  submittedAt: string | Date | null;
  autoBilledCount: number;
  autoBilledTotal: string;
  pendingCount: number;
  pendingTotal: string;
  dispositionCounts?: { completed_in_field: number; needs_review: number };
}

const AGING_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function formatRelative(when: Date): string {
  const diff = Date.now() - when.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatMoney(value: string | number): string {
  const n = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(n)) return "$0";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function WetCheckCard({ wc }: { wc: WetCheckCardData }) {
  const submittedAt = wc.submittedAt ? new Date(wc.submittedAt) : null;
  const isAging =
    !!submittedAt && Date.now() - submittedAt.getTime() > AGING_THRESHOLD_MS;

  return (
    <Link href={`/manager/wet-checks/${wc.id}`}>
      <Card
        className="cursor-pointer hover:shadow-md transition-shadow"
        data-testid={`manager-wc-card-${wc.id}`}
      >
        <CardContent className="py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-gray-900 truncate" data-testid={`manager-wc-card-${wc.id}-customer`}>
                  {wc.customerName}
                </h3>
                {isAging && (
                  <Badge
                    variant="outline"
                    className="bg-red-50 text-red-700 border-red-200 text-xs"
                    data-testid={`manager-wc-card-${wc.id}-aging`}
                  >
                    <Clock className="w-3 h-3 mr-1" />
                    Aging
                  </Badge>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-0.5 truncate">
                {wc.propertyAddress ?? "—"}
              </p>
              <p className="text-xs text-gray-500 mt-0.5 truncate">
                Tech: {wc.technicianName}
                {submittedAt && (
                  <>
                    <span className="mx-1.5 text-gray-300">·</span>
                    Submitted {formatRelative(submittedAt)}
                  </>
                )}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge
                  variant="outline"
                  className="bg-green-50 text-green-700 border-green-200 text-xs"
                  data-testid={`manager-wc-card-${wc.id}-auto-billed`}
                >
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  {wc.autoBilledCount} auto-billed · {formatMoney(wc.autoBilledTotal)}
                </Badge>
                <Badge
                  variant="outline"
                  className="bg-amber-50 text-amber-700 border-amber-200 text-xs"
                  data-testid={`manager-wc-card-${wc.id}-pending`}
                >
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  {wc.pendingCount} to decide
                </Badge>
                {wc.dispositionCounts && wc.dispositionCounts.completed_in_field > 0 && (
                  <Badge
                    variant="outline"
                    className="bg-green-50 text-green-700 border-green-200 text-xs"
                    data-testid={`manager-wc-card-${wc.id}-tech-completed`}
                  >
                    {wc.dispositionCounts.completed_in_field} tech-completed
                  </Badge>
                )}
                {wc.dispositionCounts && wc.dispositionCounts.needs_review > 0 && (
                  <Badge
                    variant="outline"
                    className="bg-amber-50 text-amber-800 border-amber-300 text-xs"
                    data-testid={`manager-wc-card-${wc.id}-tech-review`}
                  >
                    {wc.dispositionCounts.needs_review} flagged by tech
                  </Badge>
                )}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xs text-gray-500">Pending est.</div>
              <div
                className="text-lg font-bold text-gray-900"
                data-testid={`manager-wc-card-${wc.id}-pending-total`}
              >
                {formatMoney(wc.pendingTotal)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
