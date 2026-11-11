import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { getSyncEngine } from "@/lib/offline/engine";
import { docQueueForSite } from "@/lib/offline/doc-api";
import { listDocSites } from "@/lib/offline/doc-store";
import { useSyncEngineState } from "@/components/offline/sync-ui";
import { docSiteKey } from "@/components/document-system/use-doc-site";
import { useLocation, useParams, useSearch } from "wouter";
import { AlertCircle, Check } from "lucide-react";
import { format } from "date-fns";
import type { DocumentationSiteStatus } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BranchPicker } from "@/components/customers/property-picker";
import { DocFrame } from "@/components/document-system/doc-frame";
import { SiteSummary, type DoneCounts } from "@/components/document-system/site-summary";
import { BackflowFlow } from "@/components/document-system/backflow-flow";
import { ControllerFlow } from "@/components/document-system/controller-flow";
import { useDocSite, useDocSites } from "@/components/document-system/use-doc-site";
import { DocOfflineContext, useDocOffline } from "@/components/document-system/doc-offline-context";

const SITE_PILL: Record<DocumentationSiteStatus, { label: string; cls: string }> = {
  verified: { label: "Verified", cls: "bg-green-100 text-green-800" },
  not_verified: { label: "Not verified", cls: "bg-amber-100 text-amber-800" },
  nothing_on_file: { label: "Nothing on file", cls: "bg-slate-100 text-slate-600" },
};

function SkeletonFrame() {
  return (
    <div className="mx-auto w-full max-w-[480px] px-4 pt-3 pb-4 flex flex-col gap-4" data-testid="doc-loading" aria-busy="true">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-xl skeleton-shimmer" />
        <div className="flex-1 space-y-2"><div className="h-5 w-40 skeleton-shimmer" /><div className="h-4 w-28 skeleton-shimmer" /></div>
      </div>
      {[0, 1, 2].map((i) => <div key={i} className="h-[68px] rounded-2xl skeleton-shimmer" />)}
    </div>
  );
}

export type DocumentSystemVariant = "staff" | "documenter";

export default function DocumentSystemPage({ variant = "staff" }: { variant?: DocumentSystemVariant; params?: unknown } = {}) {
  const params = useParams<{ customerId: string }>();
  const customerId = Number(params.customerId);
  const branchParam = new URLSearchParams(useSearch()).get("branch");
  // Keyed so flow/flash state can never outlive a customer or branch change.
  return <DocumentSystemOfflineScreen key={`${customerId}|${branchParam ?? ""}`} customerId={customerId} branchParam={branchParam} variant={variant} />;
}

function DocumentSystemOfflineScreen(props: { customerId: number; branchParam: string | null; variant: DocumentSystemVariant }) {
  const sites = useDocSites();
  const branches = sites.data?.customers.find((c) => c.customerId === props.customerId)?.branches ?? [];
  // A shared query key means this observer and the screen share one read.
  const site = useDocSite(props.customerId, props.branchParam ?? "", props.branchParam !== null || (sites.isSuccess && branches.length === 0));
  const siteKey = `${props.customerId}:${props.branchParam ?? ""}`;
  const snap = useSyncEngineState();
  const queue = docQueueForSite(snap.mutations, siteKey);
  const qc = useQueryClient();
  const { toast } = useToast();
  useEffect(() => getSyncEngine().on(event => {
    if (event.type !== "doc-refresh" || event.siteKey !== siteKey) return;
    void qc.invalidateQueries({ queryKey: docSiteKey(props.customerId, props.branchParam ?? "") });
    if (event.message) toast({ title: "A change didn't sync.", description: event.message, variant: "destructive" });
  }), [siteKey, props.customerId, props.branchParam, qc, toast]);
  return <DocOfflineContext.Provider value={{ fromCopy: site.fromCopy, savedAt: site.savedAt, siteKey,
    online: snap.online && navigator.onLine !== false,
    queuedCount: queue.filter(m => m.status === "pending" || m.status === "syncing").length,
    failedCount: queue.filter(m => m.status === "failed" || m.docRefused).length }}>
    <DocumentSystemScreen {...props} />
  </DocOfflineContext.Provider>;
}
function DocumentSystemScreen({ customerId, branchParam, variant }: { customerId: number; branchParam: string | null; variant: DocumentSystemVariant }) {
  const offline = useDocOffline();
  const [savedBranches, setSavedBranches] = useState<Set<string>>(new Set());
  useEffect(() => {
    void listDocSites().then(rows => setSavedBranches(new Set(rows.filter(row => row.customerId === customerId).map(row => row.branchName)))).catch(() => {});
  }, [customerId]);
  const [, setLocation] = useLocation();
  const documenter = variant === "documenter";
  // Staff exits go to the customer profile; the documenter app has no profile screen.
  const profileUrl = documenter ? "/" : `/customers/${customerId}/profile`;
  // Documenter has no bottom nav, so sticky footers sit flush (Slice 7).
  const footerOffsetClass = documenter ? "bottom-0" : undefined;

  const [flash, setFlash] = useState<string | null>(null);
  const [flow, setFlow] = useState<null | { kind: "controller" | "backflow"; id: number | null; key: number }>(null);
  // Done is screen state, not a route; it only appears after the server accepted Finish.
  const [done, setDone] = useState<null | { counts: DoneCounts; at: Date }>(null);

  const sites = useDocSites();
  const entry = sites.data?.customers.find((c) => c.customerId === customerId) ?? null;
  const listBranches = entry?.branches ?? [];
  const siteEnabled = branchParam !== null || (sites.isSuccess && listBranches.length === 0);
  const branchName = branchParam ?? "";
  const site = useDocSite(customerId, branchName, siteEnabled);

  const branches = listBranches.length ? listBranches : (site.data?.customer.branches ?? []);
  const name = entry?.name ?? site.data?.customer.name ?? "";

  if (branchParam === null && sites.isError) {
    return (
      <DocFrame title="Document System" footerOffsetClass={footerOffsetClass} onBack={() => setLocation(profileUrl)}>
        <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" data-testid="doc-sites-error">
          <span className="flex items-center gap-2 font-semibold"><AlertCircle className="h-4 w-4" />Couldn't load this customer's locations.</span>
          <Button variant="outline" className="h-11" onClick={() => void sites.refetch()} data-testid="button-sites-retry">Retry</Button>
        </div>
      </DocFrame>
    );
  }

  if (branchParam === null && branches.length > 0) {
    return (
      <div className="mx-auto w-full max-w-[480px]">
        <BranchPicker
          title="Which location?"
          intro={`${name} has ${branches.length} locations. Each one is documented and verified on its own.`}
          branches={branches}
          disabledFor={b => (sites.fromCopy || navigator.onLine === false) && !savedBranches.has(b)}
          footerFor={b => sites.fromCopy || navigator.onLine === false ? <p className="text-xs text-amber-800">{savedBranches.has(b) ? "Saved for offline" : "Not saved — connect to download"}</p> : null}
          customerName={name}
          customerAddress={entry?.address ?? site.data?.customer.address ?? null}
          backLabel={documenter ? "Back to properties" : "Back to customer"}
          badgeFor={(b) => {
            const s = entry?.sites.find((x) => x.branchName === b);
            if (!s) return null;
            const p = SITE_PILL[s.status];
            return <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", p.cls)} data-testid={`status-branch-${b}`}>{p.label}</span>;
          }}
          onSelect={(b) => setLocation(`/customers/${customerId}/document-system?branch=${encodeURIComponent(b)}`)}
          onBack={() => setLocation(profileUrl)}
        />
      </div>
    );
  }

  if ((branchParam === null && sites.isLoading) || !siteEnabled || site.isLoading) return <SkeletonFrame />;

  if (site.isError || !site.data) {
    return (
      <DocFrame title="Document System" subtitle={name || null} footerOffsetClass={footerOffsetClass} onBack={() => setLocation(profileUrl)}>
        <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" data-testid="doc-load-error">
          <span className="flex items-center gap-2 font-semibold"><AlertCircle className="h-4 w-4" />Couldn't load this location.</span>
          <Button variant="outline" className="h-11" onClick={() => void site.refetch()} data-testid="button-load-retry">Retry</Button>
        </div>
      </DocFrame>
    );
  }

  const data = site.data;
  const subtitle = branchName ? `${data.customer.name}, ${branchName}` : data.customer.name;
  // Documenter summary exits: back to the location step when the customer has branches, else home.
  const summaryExitUrl = documenter
    ? (branches.length > 0 ? `/customers/${customerId}/document-system` : "/")
    : profileUrl;

  if (done) {
    const rows: [string, number][] = [
      ["Controllers", done.counts.controllers], ["Zones", done.counts.zones],
      ["Programs", done.counts.programs], ["Backflows", done.counts.backflows],
    ];
    return (
      <DocFrame
        title="Document System"
        subtitle={subtitle}
        onBack={() => setDone(null)}
        footerOffsetClass={footerOffsetClass}
        footer={documenter
          ? <Button className="h-12 w-full text-base" onClick={() => setLocation("/")} data-testid="button-back-to-properties">Back to properties</Button>
          : <Button className="h-12 w-full text-base" onClick={() => setLocation(profileUrl)} data-testid="button-back-to-customer">Back to customer</Button>}
      >
        <section className="flex flex-col items-center gap-3 pt-4 text-center" data-testid="doc-done">
          <span className="flex h-[88px] w-[88px] items-center justify-center rounded-full bg-green-100 text-green-700 animate-fade-in">
            <Check className="h-11 w-11" strokeWidth={2.5} aria-hidden />
          </span>
          <h2 className="text-[22px] font-bold text-slate-900" data-testid="text-done-title">System documented</h2>
          <p className="text-[15px] text-slate-700" data-testid="text-done-line">
            {subtitle}, verified in the field by you on {format(done.at, "MMM d, yyyy")}.
          </p>
        </section>
        <dl className="divide-y rounded-2xl border border-slate-200 bg-white">
          {rows.map(([label, n]) => (
            <div key={label} className="flex min-h-11 items-center justify-between px-3.5 py-3">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="text-[17px] font-semibold tabular-nums text-slate-900" data-testid={`text-done-${label.toLowerCase()}`}>{n}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-muted-foreground">{offline.failedCount
          ? "A change didn't sync. Review the failed changes before this location can be verified."
          : offline.queuedCount || !offline.online
            ? "Saved on this phone. The office will see this location as verified after its changes sync."
            : "The office now sees this location as verified, and billing can tie every line to a controller and zone."}</p>
      </DocFrame>
    );
  }

  const exitFlow = (msg: string | null) => { setFlow(null); setFlash(msg); };

  if (flow?.kind === "backflow") {
    const snapshot = flow.id == null ? null : data.backflows.find((b) => b.id === flow.id) ?? null;
    return (
      <BackflowFlow
        key={flow.key}
        customerId={customerId}
        branchName={branchName}
        site={data}
        backflow={snapshot}
        draftName={`Backflow ${data.backflows.length + 1}`}
        onExit={exitFlow}
        footerOffsetClass={footerOffsetClass}
      />
    );
  }

  if (flow) {
    const snapshot = flow.id == null ? null : data.controllers.find((c) => c.id === flow.id) ?? null;
    return (
      <ControllerFlow
        key={flow.key}
        customerId={customerId}
        branchName={branchName}
        site={data}
        controller={snapshot}
        onExit={exitFlow}
        footerOffsetClass={footerOffsetClass}
      />
    );
  }

  return (
    <SiteSummary
      customerId={customerId}
      branchName={branchName}
      site={data}
      subtitle={subtitle}
      flash={flash}
      onBack={() => setLocation(summaryExitUrl)}
      onDone={() => setLocation(summaryExitUrl)}
      footerOffsetClass={footerOffsetClass}
      onOpenController={(id) => { setFlash(null); setFlow({ kind: "controller", id, key: Date.now() }); }}
      onAddController={() => { setFlash(null); setFlow({ kind: "controller", id: null, key: Date.now() }); }}
      onOpenBackflow={(id) => { setFlash(null); setFlow({ kind: "backflow", id, key: Date.now() }); }}
      onAddBackflow={() => { setFlash(null); setFlow({ kind: "backflow", id: null, key: Date.now() }); }}
      onFinished={(counts) => { setFlash(null); setDone({ counts, at: new Date() }); }}
    />
  );
}
