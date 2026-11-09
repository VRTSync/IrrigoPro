import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, BadgeCheck, CheckCircle2, Info, Loader2, Plus } from "lucide-react";
import type { DocumentationSite, DocumentationGap } from "@workspace/api-client-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DocFrame } from "./doc-frame";
import { DocChip } from "./doc-chip";
import { backflowTypeLabel, serverMessage } from "./constants";
import { docSiteKey, useInvalidateDocSite } from "./use-doc-site";

type Item = { verified: boolean; gaps: DocumentationGap[] };

export function statusPill(item: Item) {
  if (item.verified) return { label: "Verified", cls: "bg-green-100 text-green-800" };
  if (item.gaps.length === 0) return { label: "Ready to verify", cls: "bg-blue-100 text-blue-800" };
  return { label: "Needs info", cls: "bg-amber-100 text-amber-800" };
}

/**
 * Client mirror of the server's Finish reasons (api-server lib/site-documentation.ts),
 * in the same order. null = every rule passes.
 */
export function finishBlocker(site: DocumentationSite): string | null {
  if (site.controllers.length === 0) return "Add at least one controller.";
  const k = [...site.controllers, ...site.backflows].filter((x) => !x.verified).length;
  if (k > 0) return `${k} ${k === 1 ? "item" : "items"} still to verify before you can finish.`;
  if (site.backflows.length === 0 && !site.site.noBackflowConfirmed) return "Add a backflow, or confirm there isn't one.";
  return null;
}

export type DoneCounts = { controllers: number; zones: number; programs: number; backflows: number };
export function doneCounts(site: DocumentationSite): DoneCounts {
  return {
    controllers: site.controllers.length,
    zones: site.controllers.reduce((n, c) => n + (c.totalZones ?? 0), 0),
    programs: site.controllers.reduce((n, c) => n + c.programs.filter((p) => p.isActive).length, 0),
    backflows: site.backflows.length,
  };
}

function Pill({ item, testId }: { item: Item; testId: string }) {
  const p = statusPill(item);
  return (
    <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", p.cls)} data-testid={testId}>
      {p.label}
    </span>
  );
}

function RowBody({ badge, badgeCls, name, subtitle, subtitleCls, item, pillId }: { badge: string; badgeCls?: string; name: string; subtitle: string; subtitleCls?: string; item: Item; pillId: string }) {
  return (
    <>
      <span className={cn("flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-primary font-bold text-white", badgeCls)}>
        {badge}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-slate-900">{name}</span>
        <span className={cn("block truncate text-sm text-muted-foreground", subtitleCls)}>{subtitle}</span>
      </span>
      <Pill item={item} testId={pillId} />
    </>
  );
}

const ROW = "flex min-h-[68px] w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-left shadow-sm transition-transform active:scale-[0.99]";
const ADD = "flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 text-[15px] font-semibold text-primary";

export interface SiteSummaryProps {
  customerId: number;
  branchName: string;
  site: DocumentationSite;
  subtitle: string;
  flash: string | null;
  onBack: () => void;
  /** Save and leave. */
  onDone: () => void;
  onOpenController: (id: number) => void;
  onAddController: () => void;
  onOpenBackflow: (id: number) => void;
  onAddBackflow: () => void;
  /** Called only after the server accepted Finish. */
  onFinished: (counts: DoneCounts) => void;
  footerOffsetClass?: string;
}

export function SiteSummary({
  customerId, branchName, site, subtitle, flash, onBack, onDone, onOpenController, onAddController,
  onOpenBackflow, onAddBackflow, onFinished, footerOffsetClass,
}: SiteSummaryProps) {
  const qc = useQueryClient();
  const invalidate = useInvalidateDocSite(customerId, branchName);
  const empty = site.controllers.length === 0 && site.backflows.length === 0;
  const busyRef = useRef(false);
  const [busy, setBusy] = useState<null | "chip" | "finish">(null);
  const [error, setError] = useState<{ message: string; retry: () => void } | null>(null);
  const blocker = finishBlocker(site);
  const confirmed = site.site.noBackflowConfirmed;

  async function guard(kind: "chip" | "finish", fn: () => Promise<void>, retry: () => void) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    setError(null);
    try { await fn(); } catch (e) { setError({ message: serverMessage(e), retry }); } finally { busyRef.current = false; setBusy(null); }
  }

  function toggleNoBackflow(next: boolean) {
    void guard("chip", async () => {
      const res = await apiRequest(`/api/system-documentation/customers/${customerId}/site/no-backflow`, "POST", { branchName, confirmed: next });
      qc.setQueryData<DocumentationSite>(docSiteKey(customerId, branchName), (old) =>
        old ? { ...old, site: res && typeof res === "object" && "status" in res ? { ...old.site, ...res } : { ...old.site, noBackflowConfirmed: next } } : old);
      void invalidate();
    }, () => toggleNoBackflow(next));
  }

  function finish() {
    const counts = doneCounts(site);
    void guard("finish", async () => {
      await apiRequest(`/api/system-documentation/customers/${customerId}/site/verify`, "POST", { branchName });
      void invalidate();
      onFinished(counts);
    }, finish);
  }

  return (
    <DocFrame
      title="Document System"
      subtitle={subtitle}
      onBack={onBack}
      footerOffsetClass={footerOffsetClass}
      footer={
        <>
          {error && (
            <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800" data-testid="text-summary-error">
              <span className="min-w-0">{error.message}</span>
              <Button type="button" size="sm" variant="outline" className="h-11 shrink-0 border-red-300 text-red-800" onClick={error.retry} data-testid="button-summary-retry">Retry</Button>
            </div>
          )}
          <p
            className={cn("flex items-start gap-2 text-sm font-medium", blocker ? "text-amber-800" : "text-green-800")}
            data-testid="text-finish-status"
          >
            {blocker ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
            {blocker ?? "Every item is verified."}
          </p>
          <Button className="h-12 w-full text-base" disabled={!!blocker || busy !== null} onClick={finish} data-testid="button-finish">
            {busy === "finish" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Finish documentation
          </Button>
          <Button variant="outline" className="h-12 w-full text-base" onClick={onDone} disabled={busy !== null} data-testid="button-save-leave">
            Save and leave
          </Button>
        </>
      }
    >
      {site.site.status === "verified" && (
        <div className="flex items-start gap-2 rounded-xl border border-green-200 bg-green-50 px-3.5 py-3 text-sm font-medium text-green-800" data-testid="text-site-verified">
          <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            Verified in the field on {site.site.verifiedAt ? format(new Date(site.site.verifiedAt), "MMM d, yyyy") : "an unknown date"} by {site.site.verifiedByName ?? "an unknown user"}.
          </span>
        </div>
      )}

      {flash && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-green-200 bg-green-50 px-3.5 py-3 text-sm font-medium text-green-800" data-testid="status-doc-flash">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{flash}</span>
        </div>
      )}

      <div>
        <h2 className="text-base font-semibold text-slate-900">What's on file</h2>
        <p className="text-sm text-muted-foreground">Tap an item to confirm it, or add anything that isn't listed.</p>
      </div>

      {empty && (
        <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-3 text-sm text-blue-900" data-testid="text-doc-empty">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>Nothing is on file for this location yet. Add each controller and backflow you find.</span>
        </div>
      )}

      <section className="flex flex-col gap-2" aria-label="Controllers">
        {[...site.controllers].sort((a, b) => (a.letter ?? "").localeCompare(b.letter ?? "") || a.id - b.id).map((c) => (
          <button key={c.id} type="button" onClick={() => onOpenController(c.id)} disabled={busy !== null} className={ROW} data-testid={`row-controller-${c.id}`}>
            <RowBody
              badge={c.letter ?? "?"}
              name={c.letter ? `Controller ${c.letter}` : "Controller"}
              subtitle={`${c.letterConfirmed ? "" : "Letter not confirmed · "}${[c.brand, c.model].filter(Boolean).join(" ") || "Brand not set"} · ${c.totalZones ? `${c.totalZones} zones` : "zones not set"}`}
              subtitleCls={c.letterConfirmed ? undefined : "text-amber-800"}
              item={c}
              pillId={`status-controller-${c.id}`}
            />
          </button>
        ))}
        <button type="button" onClick={onAddController} disabled={busy !== null} className={ADD} data-testid="button-add-controller">
          <Plus className="h-5 w-5" aria-hidden /> Add controller
        </button>
      </section>

      <section className="flex flex-col gap-2" aria-label="Backflows">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Backflows</h3>
        {site.backflows.map((b) => (
          <button key={b.id} type="button" onClick={() => onOpenBackflow(b.id)} disabled={busy !== null} className={ROW} data-testid={`row-backflow-${b.id}`}>
            <RowBody
              badge="BF"
              badgeCls="bg-[hsl(var(--primary-dark))] text-sm"
              name={b.name?.trim() ? b.name : "Unnamed backflow"}
              subtitle={`${`${backflowTypeLabel(b.deviceType)} ${b.size ?? ""}`.trim()}, ${b.serialNumber?.trim() ? `SN ${b.serialNumber}` : "no serial"}`}
              item={b}
              pillId={`status-backflow-${b.id}`}
            />
          </button>
        ))}
        <button type="button" onClick={onAddBackflow} disabled={busy !== null} className={ADD} data-testid="button-add-backflow">
          <Plus className="h-5 w-5" aria-hidden /> Add backflow
        </button>
        {site.backflows.length === 0 && (
          <div>
            <DocChip selected={confirmed} disabled={busy !== null} onClick={() => toggleNoBackflow(!confirmed)} testId="chip-no-backflow">
              {confirmed ? "Confirmed: no backflow at this location" : "There is no backflow at this location"}
            </DocChip>
          </div>
        )}
      </section>
    </DocFrame>
  );
}
