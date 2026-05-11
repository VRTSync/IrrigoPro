import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import type { WetCheck } from "@workspace/db/schema";
import { WetCheckWizard } from "@/components/manager/wet-check-wizard";

// ─── Inbox ───────────────────────────────────────────────────────────────────
type PendingReviewRow = WetCheck & {
  findingCounts: { quick_fix: number; advanced: number; zone_issue: number; total: number };
  totalBillable: string;
  customerLaborRate: string;
};

function PendingReviewInbox() {
  const [, navigate] = useLocation();
  // Inbox shows every wet check still awaiting full conversion:
  // freshly-submitted, manager-approved (pricing locked, not yet converted),
  // and partially_converted (some findings routed, others still pending).
  const { data: rows = [], isLoading } = useQuery<PendingReviewRow[]>({
    queryKey: ["/api/wet-checks/pending-review"],
  });

  return (
    <div className="max-w-4xl mx-auto py-4 space-y-4">
      <h1 className="text-2xl font-bold">Wet Checks → Pending Review</h1>
      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin" /></div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-6 text-center text-gray-500 text-sm">
          No wet checks awaiting review.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {rows.map(wc => (
            <Card
              key={wc.id}
              className="cursor-pointer hover:bg-gray-50"
              onClick={() => navigate(`/manager/wet-checks/${wc.id}`)}
              data-testid={`wc-row-${wc.id}`}
            >
              <CardContent className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{wc.customerName}</div>
                  <div className="text-xs text-gray-500 truncate">{wc.propertyAddress ?? "—"}</div>
                  <div className="text-xs text-gray-500">
                    Tech: {wc.technicianName} · Submitted{" "}
                    {wc.submittedAt ? new Date(wc.submittedAt).toLocaleString() : "—"}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="text-xs" data-testid={`wc-row-${wc.id}-count-quick_fix`}>
                      Quick fix · {wc.findingCounts.quick_fix}
                    </Badge>
                    <Badge variant="outline" className="text-xs" data-testid={`wc-row-${wc.id}-count-advanced`}>
                      Advanced · {wc.findingCounts.advanced}
                    </Badge>
                    <Badge variant="outline" className="text-xs" data-testid={`wc-row-${wc.id}-count-zone_issue`}>
                      Zone issue · {wc.findingCounts.zone_issue}
                    </Badge>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Badge variant="secondary">{wc.status}</Badge>
                  <Badge className="text-xs" data-testid={`wc-row-${wc.id}-total-billable`}>
                    ${wc.totalBillable}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page entry ──────────────────────────────────────────────────────────────
// Slice 5C — both `/wet-checks/:id/review` (legacy) and the new
// `/manager/wet-checks/:id` route render the wizard. The legacy URL stays
// alive so existing inbound links from other surfaces don't 404.
export default function WetCheckReviewPage() {
  const [matchManager, managerParams] = useRoute<{ id: string }>("/manager/wet-checks/:id");
  const [matchLegacy, legacyParams] = useRoute<{ id: string }>("/wet-checks/:id/review");
  const id = matchManager
    ? parseInt(managerParams!.id)
    : matchLegacy
      ? parseInt(legacyParams!.id)
      : NaN;
  if (Number.isFinite(id)) return <WetCheckWizard id={id} />;
  return <PendingReviewInbox />;
}
