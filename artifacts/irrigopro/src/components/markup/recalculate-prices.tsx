import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import {
  usePreviewMarkupRecalculation,
  useRecalculateMarkupPrices,
  type MarkupRecalculationPreview,
  type MarkupRecalculationResult,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorMessage } from "@/lib/markup-tier-form";

export function recalculationConfirmText(eligible: number): string {
  return `This will update the customer price for all ${eligible} parts with a recorded cost, using the current markup schedule. Rentals, Services, and Labor parts are excluded. Existing billing documents are not affected. Continue?`;
}

interface Props {
  params: { companyId: number } | undefined;
  /** Only enabled when the company has an active schedule. */
  hasActiveSchedule: boolean;
}

/**
 * Task #2173 Tier 3 — deliberate catalog recalculation. A server-issued preview
 * token is required; batches of at most 100 run sequentially from the server's
 * own cumulative `processed` count. Counts shown are exactly what the server
 * returned. Any failure stops the run; a new preview is required to continue.
 */
export function RecalculatePrices({ params, hasActiveSchedule }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const preview = usePreviewMarkupRecalculation();
  const recalc = useRecalculateMarkupPrices();
  const [pending, setPending] = useState<MarkupRecalculationPreview | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<MarkupRecalculationResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const busy = running || preview.isPending;

  const invalidateCatalog = () =>
    qc.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey[0];
        return typeof k === "string" && (k.startsWith("/api/parts") || k.includes("pricing-audit"));
      },
    });

  const start = () => {
    setRunError(null);
    preview.mutate(
      { params },
      {
        onSuccess: (p) => setPending(p),
        onError: (e) => toast({ title: "Could not prepare recalculation", description: errorMessage(e, "Please try again."), variant: "destructive" }),
      },
    );
  };

  const run = async () => {
    const token = pending?.confirmationToken;
    if (!token) return;
    setPending(null);
    setRunning(true);
    setResult(null);
    setRunError(null);
    let offset = 0;
    let last: MarkupRecalculationResult | null = null;
    try {
      for (;;) {
        const res = await recalc.mutateAsync({ data: { confirmationToken: token, offset }, params });
        last = res;
        setResult(res);
        await invalidateCatalog();
        if (res.done) break;
        if (res.processed <= offset) throw new Error("The server reported no progress. Preview again to continue.");
        offset = res.processed;
      }
      toast({
        title: last.errors.length ? "Recalculation finished with errors" : "Recalculation complete",
        description: `Done — ${last.updated} prices updated, ${last.unchanged} unchanged, ${last.excluded} excluded${last.errors.length ? `, ${last.errors.length} failed. Review errors below and preview again.` : ""}`,
        ...(last.errors.length ? { variant: "destructive" as const } : {}),
      });
    } catch (e) {
      const msg = errorMessage(e, "Recalculation stopped.");
      setRunError(msg);
      toast({ title: "Recalculation stopped", description: msg, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card data-testid="card-recalculate">
      <CardHeader>
        <CardTitle className="text-lg">Catalog Prices</CardTitle>
        <CardDescription>
          Schedule changes never reprice the catalog automatically. Run this deliberately to apply the active schedule to every part with a recorded cost.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          onClick={start}
          disabled={!hasActiveSchedule || busy}
          data-testid="button-recalculate-prices"
        >
          <RefreshCw className={`mr-1 h-4 w-4 ${running ? "animate-spin" : ""}`} aria-hidden />
          Recalculate All Catalog Prices
        </Button>
        {!hasActiveSchedule && (
          <p className="text-sm text-gray-500">Activate a schedule before recalculating.</p>
        )}

        {running && (
          <p role="status" aria-live="polite" className="text-sm text-gray-700" data-testid="status-recalc-progress">
            Recalculating... {result?.updated ?? 0} parts updated
            {result ? ` (${result.processed} of ${result.total} processed)` : ""}
          </p>
        )}

        {!running && result && (
          <div className="rounded-md border border-gray-200 bg-gray-50 p-4 text-sm" data-testid="panel-recalc-result">
            <p className="font-medium text-gray-900">
              {result.done ? "Recalculation complete" : "Recalculation incomplete"}: {result.processed} of {result.total} processed
            </p>
            <dl className="mt-2 grid grid-cols-3 gap-2 tabular-nums">
              <div><dt className="text-xs text-gray-500">Updated</dt><dd data-testid="text-recalc-updated">{result.updated}</dd></div>
              <div><dt className="text-xs text-gray-500">Unchanged</dt><dd data-testid="text-recalc-unchanged">{result.unchanged}</dd></div>
              <div><dt className="text-xs text-gray-500">Excluded</dt><dd data-testid="text-recalc-excluded">{result.excluded}</dd></div>
            </dl>
            {result.errors.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold text-red-800">{result.errors.length} errors</p>
                <ul className="mt-1 list-disc pl-5 text-red-800" data-testid="list-recalc-errors">
                  {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        {runError && !running && (
          <p role="alert" className="text-sm text-red-700" data-testid="text-recalc-error">
            {runError} Start a new preview to try again.
          </p>
        )}
      </CardContent>

      <Dialog open={pending !== null} onOpenChange={(o) => { if (!o) setPending(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recalculate All Catalog Prices</DialogTitle>
            <DialogDescription data-testid="text-recalc-confirm">
              {pending ? recalculationConfirmText(pending.eligible) : ""}
            </DialogDescription>
          </DialogHeader>
          {pending && (
            <p className="text-xs text-gray-500">Schedule: {pending.scheduleName}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} data-testid="button-recalc-cancel">Cancel</Button>
            <Button onClick={run} data-testid="button-recalc-confirm">Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
