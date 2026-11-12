import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { downloadAllDocSites, observeDocDownloads } from "@/lib/offline/doc-download";
import { listDocSites, docOwner } from "@/lib/offline/doc-store";
import { QueueView, useSyncEngineState } from "@/components/offline/sync-ui";
import { useLocation } from "wouter";
import { AlertCircle, Info } from "lucide-react";
import type { DocumentationPickerCustomer } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useUnauthenticatedReads } from "@/lib/queryClient";
import { SessionExpiredEmptyState } from "@/components/auth/session-expired-banner";
import { CustomerCard } from "@/components/customers/property-picker";
import { DocChip } from "@/components/document-system/doc-chip";
import { useDocSites } from "@/components/document-system/use-doc-site";
import { OfflineReadyIcon } from "@/components/document-system/offline-ready-icon";

type Filter = "not_verified" | "all";

const isFullyVerified = (c: DocumentationPickerCustomer) =>
  c.sites.length > 0 && c.sites.every((s) => s.status === "verified");

/** Badge precedence (Slice 7): all verified, then partial, then not verified, else nothing on file. */
export function badgeFor(c: DocumentationPickerCustomer): { label: string; cls: string } {
  const n = c.sites.length;
  const v = c.sites.filter((s) => s.status === "verified").length;
  if (n > 0 && v === n) return { label: "Verified", cls: "bg-green-100 text-green-800" };
  if (n > 1 && v > 0) return { label: `${v} of ${n} verified`, cls: "bg-amber-100 text-amber-800" };
  if (c.sites.some((s) => s.status === "not_verified")) return { label: "Not verified", cls: "bg-amber-100 text-amber-800" };
  return { label: "Nothing on file", cls: "bg-slate-100 text-slate-700" };
}

export default function DocPropertyPickerPage() {
  const sync = useSyncEngineState();
  const [queueOpen, setQueueOpen] = useState(false);
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("not_verified");
  const unauthenticated = useUnauthenticatedReads();
  const sites = useDocSites();
  const [saved, setSaved] = useState<Set<string> | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState(false);
  const refreshSaved = () => listDocSites().then((rows) => setSaved(new Set(rows.map((row) => row.key))));
  useEffect(() => observeDocDownloads((done, total) => {
    setProgress(total ? `Saving ${done} of ${total}…` : null);
    if (!total) void refreshSaved().catch(() => {});
  }), []);
  useEffect(() => { void refreshSaved().catch(() => {}); }, [sites.data, progress]);
  const update = async () => {
    setDownloadError(false);
    setProgress("Saving 0 of 0…");
    try {
      await downloadAllDocSites({ onProgress: (done, total) => setProgress(`Saving ${done} of ${total}…`) });
      await sites.refetch();
      await refreshSaved();
    } catch { setDownloadError(true); }
    finally { setProgress(null); }
  };

  const sorted = useMemo(
    () => [...(sites.data?.customers ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [sites.data],
  );
  // Counts ignore the search text on purpose.
  const notVerified = useMemo(() => sorted.filter((c) => !isFullyVerified(c)), [sorted]);
  const q = search.trim().toLowerCase();
  const shown = (filter === "all" ? sorted : notVerified).filter((c) => !q || c.name.toLowerCase().includes(q));

  return (
    <div className="mx-auto w-full max-w-[480px] px-4 py-4 flex flex-col gap-4" data-testid="doc-property-picker">
      <div>
        <h1 className="text-[22px] font-bold text-slate-900">Which property?</h1>
        <p className="text-sm text-muted-foreground">Pick the property you're standing on.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="doc-property-search" className="text-sm font-medium text-slate-800">Search</label>
        <input
          id="doc-property-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Property name"
          className="h-[50px] w-full rounded-xl border border-slate-300 bg-white px-3.5 text-base focus:outline-none focus:ring-2 focus:ring-primary"
          data-testid="input-property-search"
        />
      </div>

      <div className="flex gap-2">
        <DocChip selected={filter === "not_verified"} onClick={() => setFilter("not_verified")} testId="chip-filter-not-verified">
          Not verified ({notVerified.length})
        </DocChip>
        <DocChip selected={filter === "all"} onClick={() => setFilter("all")} testId="chip-filter-all">
          All ({sorted.length})
        </DocChip>
      </div>
      <div className="text-xs text-muted-foreground" role="status">
        {progress ?? (sites.savedAt ? `${sites.fromCopy ? "Offline — showing the copy saved" : "Offline copy updated"} ${formatDistanceToNow(sites.savedAt, { addSuffix: true })}` : "Offline copy not downloaded")}
        {!sites.fromCopy && <button className="ml-2 min-h-11 font-semibold text-primary" disabled={!!progress} onClick={() => void update()}>Update now</button>}
        {downloadError && <p role="alert">Couldn't update the offline copy. Try again.</p>}
      </div>

      {sites.isLoading ? (
        <div className="flex flex-col gap-3" data-testid="picker-skeleton" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="h-[84px] rounded-xl skeleton-shimmer" data-testid="picker-skeleton-card" />)}
        </div>
      ) : unauthenticated ? (
        <SessionExpiredEmptyState message="Your session expired — sign in again to load properties." />
      ) : sites.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" data-testid="picker-error">
          <span className="flex items-center gap-2 font-semibold"><AlertCircle className="h-4 w-4" />Couldn't load properties.</span>
          <Button variant="outline" className="h-11" onClick={() => void sites.refetch()} data-testid="button-picker-retry">Retry</Button>
        </div>
      ) : shown.length === 0 ? (
        <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-3 text-sm text-blue-900" data-testid="text-picker-empty">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          No properties match. Try another name, or switch to All.
        </div>
      ) : (
        <div className="flex flex-col gap-3" data-testid="picker-list">
          {shown.map((c) => {
            const b = badgeFor(c);
            const branches = c.branches.length ? c.branches : [""];
            const savedCount = branches.filter((branch) => saved?.has(`${c.customerId}:${branch}`)).length;
            const hasCopy = savedCount > 0;
            const failures = sync.mutations.filter(m => m.docOwner === docOwner() && m.siteKey?.startsWith(`${c.customerId}:`) && (m.status === "failed" || m.docRefused)).length;
            return (
              <div key={c.customerId}>
              <CustomerCard
                key={c.customerId}
                name={c.name}
                disabled={(sites.fromCopy || navigator.onLine === false) && !hasCopy}
                trailing={
                  <OfflineReadyIcon savedCount={saved === null ? null : savedCount} total={branches.length} testId={`icon-offline-status-${c.customerId}`} />
                }
                address={c.address}
                branchCount={c.branches.length}
                badge={<span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", b.cls)} data-testid={`badge-property-${c.customerId}`}>{b.label}</span>}
                onClick={() => setLocation(`/customers/${c.customerId}/document-system`)}
                testId={`card-property-${c.customerId}`}
              />
              {failures > 0 && <button className="min-h-11 text-sm text-red-700 underline" onClick={() => setQueueOpen(true)}>{failures} change{failures === 1 ? "" : "s"} didn't sync</button>}
              </div>
            );
          })}
        </div>
      )}
      <QueueView open={queueOpen} onOpenChange={setQueueOpen} />
    </div>
  );
}
