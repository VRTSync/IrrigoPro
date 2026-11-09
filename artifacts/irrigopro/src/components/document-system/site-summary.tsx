import { Link } from "wouter";
import { CheckCircle2, Info, Plus, ShieldCheck } from "lucide-react";
import type { DocumentationSite, DocumentationGap } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DocFrame } from "./doc-frame";

type Item = { verified: boolean; gaps: DocumentationGap[] };

export function statusPill(item: Item) {
  if (item.verified) return { label: "Verified", cls: "bg-green-100 text-green-800" };
  if (item.gaps.length === 0) return { label: "Ready to verify", cls: "bg-blue-100 text-blue-800" };
  return { label: "Needs info", cls: "bg-amber-100 text-amber-800" };
}

function Pill({ item, testId }: { item: Item; testId: string }) {
  const p = statusPill(item);
  return (
    <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", p.cls)} data-testid={testId}>
      {p.label}
    </span>
  );
}

function RowBody({ badge, name, subtitle, item, pillId }: { badge: string; name: string; subtitle: string; item: Item; pillId: string }) {
  return (
    <>
      <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-primary text-white font-bold">
        {badge}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-slate-900">{name}</span>
        <span className="block truncate text-sm text-muted-foreground">{subtitle}</span>
      </span>
      <Pill item={item} testId={pillId} />
    </>
  );
}

export interface SiteSummaryProps {
  customerId: number;
  site: DocumentationSite;
  subtitle: string;
  flash: string | null;
  onBack: () => void;
  onDone: () => void;
  onOpenController: (id: number) => void;
  onAddController: () => void;
  footerOffsetClass?: string;
}

export function SiteSummary({
  customerId, site, subtitle, flash, onBack, onDone, onOpenController, onAddController, footerOffsetClass,
}: SiteSummaryProps) {
  const empty = site.controllers.length === 0 && site.backflows.length === 0;
  return (
    <DocFrame
      title="Document System"
      subtitle={subtitle}
      onBack={onBack}
      footerOffsetClass={footerOffsetClass}
      footer={
        <Button variant="outline" className="h-12 w-full text-base" onClick={onDone} data-testid="button-doc-done">
          Done
        </Button>
      }
    >
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
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Controllers</h3>
        {site.controllers.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onOpenController(c.id)}
            className="flex min-h-[68px] w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-left shadow-sm transition-transform active:scale-[0.99]"
            data-testid={`row-controller-${c.id}`}
          >
            <RowBody
              badge={c.letter ?? "?"}
              name={c.name?.trim() ? c.name : "Unnamed controller"}
              subtitle={`${[c.brand, c.model].filter(Boolean).join(" ") || "Brand not set"} · ${c.totalZones ? `${c.totalZones} zones` : "zones not set"}`}
              item={c}
              pillId={`status-controller-${c.id}`}
            />
          </button>
        ))}
        <button
          type="button"
          onClick={onAddController}
          className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 text-[15px] font-semibold text-primary"
          data-testid="button-add-controller"
        >
          <Plus className="h-5 w-5" aria-hidden /> Add controller
        </button>
      </section>

      <section className="flex flex-col gap-2" aria-label="Backflows">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Backflows</h3>
        {site.backflows.map((b, i) => (
          <div
            key={b.id}
            className="flex min-h-[68px] w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2.5"
            data-testid={`row-backflow-${b.id}`}
          >
            <RowBody
              badge={String(i + 1)}
              name={b.name?.trim() ? b.name : "Unnamed backflow"}
              subtitle={`${[b.brand, b.model].filter(Boolean).join(" ") || "Brand not set"} · ${b.size ?? "size not set"}`}
              item={b}
              pillId={`status-backflow-${b.id}`}
            />
          </div>
        ))}
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            Backflow capture is coming to this screen. Until then, edit backflows in{" "}
            <Link href={`/customers/${customerId}/irrigation-profile`} className="font-medium text-primary underline" data-testid="link-controllers-zones">
              Controllers &amp; Zones
            </Link>
          </span>
        </p>
      </section>
    </DocFrame>
  );
}
