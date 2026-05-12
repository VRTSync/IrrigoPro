import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, Search, Building2 } from "lucide-react";
import { buildAuthHeaders, formatRelative } from "./shared";
import { HealthScoreBar, bucketLabel, type HealthBucket } from "./health-score-bar";
import { CompanyDetailDrawer } from "./company-detail-drawer";

export type CompanyHealth = {
  id: number;
  name: string;
  plan: string | null;
  activeNow: number;
  totalUsers: number;
  errors24h: number;
  syncQueue: number | null;
  photoUploadPct: number | null;
  storageBytes: number | null;
  appVersion: string | null;
  lastActivityAt: string | null;
  healthScore: number;
  healthBucket: HealthBucket;
};

type ListResponse = { companies: CompanyHealth[] };

export function CompaniesTab({
  windowKey: _windowKey,
  onOpenCrash,
}: {
  windowKey: string;
  onOpenCrash?: (fingerprint: string) => void;
}) {
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data, isLoading, isError } = useQuery<ListResponse>({
    queryKey: ["/api/admin/app-health/companies"],
    queryFn: async () => {
      const res = await fetch("/api/admin/app-health/companies", {
        credentials: "include",
        headers: buildAuthHeaders(),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const companies = data?.companies ?? [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return companies;
    return companies.filter((c) => c.name.toLowerCase().includes(needle));
  }, [companies, q]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-3 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Filter companies"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-8"
              data-testid="filter-companies"
            />
          </div>
          <div className="text-xs text-gray-500">
            {filtered.length} of {companies.length} tenants — sorted by health score (worst first)
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {isLoading ? (
            <div className="py-16 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : isError ? (
            <div className="py-12 text-center text-sm text-red-600">Couldn't load companies.</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">
              <Building2 className="h-6 w-6 text-gray-300 mx-auto mb-2" />
              No companies match your filter.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b">
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-3 py-2 font-medium">Plan</th>
                  <th className="px-3 py-2 font-medium text-right">Users</th>
                  <th className="px-3 py-2 font-medium">Health</th>
                  <th className="px-3 py-2 font-medium text-right">Active now</th>
                  <th className="px-3 py-2 font-medium text-right">Errors 24h</th>
                  <th className="px-3 py-2 font-medium text-right">Sync queue</th>
                  <th className="px-3 py-2 font-medium text-right">Photo upload</th>
                  <th className="px-3 py-2 font-medium text-right">Storage</th>
                  <th className="px-3 py-2 font-medium">App version</th>
                  <th className="px-3 py-2 font-medium">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className="border-b last:border-b-0 hover:bg-gray-50 cursor-pointer"
                    data-testid={`company-row-${c.id}`}
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-gray-900">{c.name}</div>
                      <div className="text-[11px] text-gray-500">
                        {sizeBucket(c.totalUsers)} • —
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-gray-700 capitalize">{c.plan ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{c.totalUsers}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col gap-1">
                        <HealthScoreBar score={c.healthScore} bucket={c.healthBucket} />
                        <span className="text-[10px] uppercase tracking-wide text-gray-500">
                          {bucketLabel(c.healthBucket)}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{c.activeNow}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${c.errors24h > 0 ? "text-red-700 font-semibold" : ""}`}>
                      {c.errors24h}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${(c.syncQueue ?? 0) > 0 ? "text-amber-700 font-semibold" : "text-gray-400"}`}>
                      {c.syncQueue == null ? "—" : c.syncQueue}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {c.photoUploadPct == null ? "—" : `${c.photoUploadPct.toFixed(1)}%`}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                      {formatBytes(c.storageBytes)}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 font-mono text-[11px]">{c.appVersion ?? "—"}</td>
                    <td className="px-3 py-2.5 text-gray-600">{formatRelative(c.lastActivityAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <CompanyDetailDrawer
        companyId={selectedId}
        onClose={() => setSelectedId(null)}
        onOpenCrash={onOpenCrash}
      />
    </div>
  );
}

function sizeBucket(n: number): string {
  if (n <= 0) return "empty";
  if (n < 5) return "small";
  if (n < 25) return "medium";
  if (n < 100) return "large";
  return "enterprise";
}

function formatBytes(b: number | null): string {
  if (b == null) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
