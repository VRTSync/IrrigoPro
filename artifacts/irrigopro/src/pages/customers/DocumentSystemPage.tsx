import { useState } from "react";
import { useLocation, useParams, useSearch } from "wouter";
import { AlertCircle } from "lucide-react";
import type { DocumentationSiteStatus } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BranchPicker } from "@/components/customers/property-picker";
import { DocFrame } from "@/components/document-system/doc-frame";
import { SiteSummary } from "@/components/document-system/site-summary";
import { ControllerFlow } from "@/components/document-system/controller-flow";
import { useDocSite, useDocSites } from "@/components/document-system/use-doc-site";

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

export default function DocumentSystemPage() {
  const params = useParams<{ customerId: string }>();
  const customerId = Number(params.customerId);
  const branchParam = new URLSearchParams(useSearch()).get("branch");
  // Keyed so flow/flash state can never outlive a customer or branch change.
  return <DocumentSystemScreen key={`${customerId}|${branchParam ?? ""}`} customerId={customerId} branchParam={branchParam} />;
}

function DocumentSystemScreen({ customerId, branchParam }: { customerId: number; branchParam: string | null }) {
  const [, setLocation] = useLocation();
  const profileUrl = `/customers/${customerId}/profile`;

  const [flash, setFlash] = useState<string | null>(null);
  const [flow, setFlow] = useState<null | { id: number | null; key: number }>(null);

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
      <DocFrame title="Document System" onBack={() => setLocation(profileUrl)}>
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
          customerName={name}
          customerAddress={entry?.address ?? site.data?.customer.address ?? null}
          backLabel="Back to customer"
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
      <DocFrame title="Document System" subtitle={name || null} onBack={() => setLocation(profileUrl)}>
        <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" data-testid="doc-load-error">
          <span className="flex items-center gap-2 font-semibold"><AlertCircle className="h-4 w-4" />Couldn't load this location.</span>
          <Button variant="outline" className="h-11" onClick={() => void site.refetch()} data-testid="button-load-retry">Retry</Button>
        </div>
      </DocFrame>
    );
  }

  const data = site.data;
  const subtitle = branchName ? `${data.customer.name}, ${branchName}` : data.customer.name;

  if (flow) {
    const snapshot = flow.id == null ? null : data.controllers.find((c) => c.id === flow.id) ?? null;
    return (
      <ControllerFlow
        key={flow.key}
        customerId={customerId}
        branchName={branchName}
        site={data}
        controller={snapshot}
        onExit={(msg) => { setFlow(null); setFlash(msg); }}
      />
    );
  }

  return (
    <SiteSummary
      customerId={customerId}
      site={data}
      subtitle={subtitle}
      flash={flash}
      onBack={() => setLocation(profileUrl)}
      onDone={() => setLocation(profileUrl)}
      onOpenController={(id) => { setFlash(null); setFlow({ id, key: Date.now() }); }}
      onAddController={() => { setFlash(null); setFlow({ id: null, key: Date.now() }); }}
    />
  );
}
