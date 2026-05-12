import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Search, ChevronRight } from "lucide-react";
import { buildAuthHeaders, formatRelative } from "./shared";
import { UserDetailDrawer } from "./user-detail-drawer";

export type UserStatus = "active" | "offline" | "stuck" | "locked" | "syncing";

export type UserHealth = {
  id: number;
  name: string;
  username: string;
  email: string | null;
  role: string;
  companyId: number | null;
  companyName: string | null;
  isActive: boolean;
  lastSeenMobile: string | null;
  activeMobile: number;
  errorsLast30m: number;
  errors24h: number;
  stuckLastHour: number;
  syncingLast5m: number;
  conflicts24h: number;
  failedUploads24h: number;
  deviceName: string | null;
  os: string | null;
  appVersion: string | null;
  versionLag: boolean;
  status: UserStatus;
};
type UsersResponse = { users: UserHealth[]; total: number };

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "all",     label: "All statuses" },
  { value: "active",  label: "Active" },
  { value: "syncing", label: "Syncing" },
  { value: "stuck",   label: "Stuck" },
  { value: "offline", label: "Offline" },
  { value: "locked",  label: "Locked" },
];

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "all",             label: "All roles" },
  { value: "super_admin",     label: "Super admin" },
  { value: "company_admin",   label: "Company admin" },
  { value: "manager",         label: "Manager" },
  { value: "field_tech",      label: "Field tech" },
  { value: "billing_manager", label: "Billing manager" },
];

export function UsersTab({
  onOpenCrash,
  onOpenAudit,
}: {
  onOpenCrash?: (fingerprint: string) => void;
  onOpenAudit?: (actorUserId: number) => void;
} = {}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [role, setRole] = useState("all");
  const [companyId, setCompanyId] = useState("");
  const [openUserId, setOpenUserId] = useState<number | null>(null);

  const PAGE = 100;
  const baseParams = new URLSearchParams();
  if (q.trim()) baseParams.set("q", q.trim());
  if (status !== "all") baseParams.set("status", status);
  if (role !== "all") baseParams.set("role", role);
  if (companyId.trim()) baseParams.set("company_id", companyId.trim());

  const {
    data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery<UsersResponse, Error>({
    queryKey: ["/api/admin/app-health/users", baseParams.toString()],
    queryFn: async ({ pageParam = 0 }) => {
      const usp = new URLSearchParams(baseParams);
      usp.set("limit", String(PAGE));
      usp.set("offset", String(pageParam));
      const res = await fetch(`/api/admin/app-health/users?${usp}`, {
        credentials: "include",
        headers: buildAuthHeaders(),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + (p.users?.length ?? 0), 0);
      return loaded < (lastPage.total ?? 0) ? loaded : undefined;
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const users = data?.pages.flatMap((p) => p.users ?? []) ?? [];
  const total = data?.pages[0]?.total ?? 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-3 px-4 grid grid-cols-1 sm:grid-cols-12 gap-2 sm:items-center">
          <div className="relative sm:col-span-5">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, username, email"
              className="pl-8"
              data-testid="users-search"
            />
          </div>
          <Input
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="Company ID"
            inputMode="numeric"
            className="sm:col-span-2"
            data-testid="users-company-filter"
          />
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="sm:col-span-2" data-testid="users-role-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="sm:col-span-3" data-testid="users-status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-16 flex items-center justify-center text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : isError ? (
            <div className="py-16 text-center text-sm text-red-600">Couldn't load users.</div>
          ) : users.length === 0 ? (
            <div className="py-16 text-center text-sm text-gray-500">No users matching these filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="text-left font-medium px-4 py-2">User</th>
                    <th className="text-left font-medium px-4 py-2">Company</th>
                    <th className="text-left font-medium px-4 py-2">Role</th>
                    <th className="text-left font-medium px-4 py-2">Status</th>
                    <th className="text-left font-medium px-4 py-2">Device / OS</th>
                    <th className="text-left font-medium px-4 py-2">App version</th>
                    <th className="text-right font-medium px-4 py-2">Errors 24h</th>
                    <th className="text-right font-medium px-4 py-2">Conflicts 24h</th>
                    <th className="text-right font-medium px-4 py-2">Failed uploads 24h</th>
                    <th className="text-left font-medium px-4 py-2">Last mobile</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody data-testid="users-table">
                  {users.map((u) => (
                    <tr
                      key={u.id}
                      onClick={() => setOpenUserId(u.id)}
                      className="border-t hover:bg-gray-50 cursor-pointer"
                      data-testid={`user-row-${u.id}`}
                    >
                      <td className="px-4 py-2">
                        <div className="font-medium text-gray-900">{u.name}</div>
                        <div className="text-[11px] text-gray-500">{u.username}</div>
                      </td>
                      <td className="px-4 py-2 text-gray-700">{u.companyName ?? "—"}</td>
                      <td className="px-4 py-2 text-gray-700">{u.role.replace(/_/g, " ")}</td>
                      <td className="px-4 py-2"><StatusBadge status={u.status} /></td>
                      <td className="px-4 py-2 text-gray-700">
                        {u.deviceName || u.os ? (
                          <div className="flex flex-col">
                            <span className="text-xs">{u.deviceName ?? "—"}</span>
                            {u.os ? <span className="text-[10px] text-gray-500">{u.os}</span> : null}
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {u.appVersion ? (
                          <span className="font-mono text-[11px] text-gray-700">
                            {u.appVersion.slice(0, 12)}
                            {u.versionLag && (
                              <Badge variant="destructive" className="ml-1.5 align-middle">old</Badge>
                            )}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{u.errors24h}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{u.conflicts24h}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{u.failedUploads24h}</td>
                      <td className="px-4 py-2 text-gray-600">{formatRelative(u.lastSeenMobile)}</td>
                      <td className="px-4 py-2 text-gray-300"><ChevronRight className="h-4 w-4" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {users.length > 0 && (
        <div className="flex items-center justify-between text-xs text-gray-500 px-1">
          <span data-testid="users-count">
            Showing {users.length.toLocaleString()} of {total.toLocaleString()}
          </span>
          {hasNextPage ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              data-testid="users-load-more"
            >
              {isFetchingNextPage ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : null}
              Load more
            </Button>
          ) : null}
        </div>
      )}

      <UserDetailDrawer
        userId={openUserId}
        onClose={() => setOpenUserId(null)}
        onOpenCrash={(fp) => { setOpenUserId(null); onOpenCrash?.(fp); }}
        onOpenAudit={(uid) => { setOpenUserId(null); onOpenAudit?.(uid); }}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: UserStatus }) {
  switch (status) {
    case "stuck":
      return <Badge className="bg-amber-500 hover:bg-amber-500 text-white">Stuck</Badge>;
    case "syncing":
      return <Badge className="bg-blue-500 hover:bg-blue-500 text-white">Syncing</Badge>;
    case "active":
      return <Badge className="bg-emerald-500 hover:bg-emerald-500 text-white">Active</Badge>;
    case "locked":
      return <Badge variant="destructive">Locked</Badge>;
    case "offline":
    default:
      return <Badge variant="secondary">Offline</Badge>;
  }
}
