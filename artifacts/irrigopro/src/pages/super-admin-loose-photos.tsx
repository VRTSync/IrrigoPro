import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { safeGet } from "@/utils/safeStorage";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, ExternalLink, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type LoosePhotoRow = {
  wetCheckId: number;
  customerId: number;
  customerName: string;
  propertyAddress: string | null;
  status: string;
  loosePhotoCount: number;
};

type LoosePhotosResponse = {
  rows: LoosePhotoRow[];
  total: number;
};

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  in_progress: { label: "In Progress", className: "bg-blue-50 text-blue-700" },
  submitted: { label: "Submitted", className: "bg-amber-50 text-amber-700" },
  approved: { label: "Approved", className: "bg-green-50 text-green-700" },
  partially_converted: { label: "Partial", className: "bg-purple-50 text-purple-700" },
  converted: { label: "Converted", className: "bg-gray-50 text-gray-600" },
};

function readUserRole(): string | undefined {
  try {
    return JSON.parse(safeGet("user") || "{}").role as string | undefined;
  } catch {
    return undefined;
  }
}

function buildAuthHeaders(): Record<string, string> {
  try {
    const raw = safeGet("user");
    if (!raw) return {};
    const u = JSON.parse(raw) as { id?: number; role?: string; companyId?: number };
    const headers: Record<string, string> = {};
    if (u?.role) headers["x-user-role"] = u.role;
    if (u?.id != null) headers["x-user-id"] = String(u.id);
    if (u?.companyId != null) headers["x-user-company-id"] = String(u.companyId);
    return headers;
  } catch {
    return {};
  }
}

const PAGE_SIZE = 50;

function PurgeButton({
  row,
  onPurged,
}: {
  row: LoosePhotoRow;
  onPurged: () => void;
}) {
  const { toast } = useToast();
  const purgeMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/wet-checks/${row.wetCheckId}/loose-photos`, {
        method: "DELETE",
        credentials: "include",
        headers: buildAuthHeaders(),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json() as Promise<{ deleted: number }>;
    },
    onSuccess: (data) => {
      const n = data.deleted;
      toast({ title: `Purged ${n} loose photo${n === 1 ? "" : "s"} from WC-${row.wetCheckId}` });
      onPurged();
    },
    onError: (e: any) => {
      toast({
        title: "Purge failed",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="destructive"
          size="sm"
          className="gap-1.5"
          disabled={purgeMut.isPending}
          data-testid={`purge-loose-photos-${row.wetCheckId}`}
        >
          {purgeMut.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
          Purge
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Purge all loose photos?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete all {row.loosePhotoCount} loose photo{row.loosePhotoCount === 1 ? "" : "s"} from wet check WC-{new Date().getFullYear()}-{String(row.wetCheckId).padStart(4, "0")} ({row.customerName}). This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => purgeMut.mutate()}
            data-testid={`purge-loose-photos-${row.wetCheckId}-confirm`}
          >
            Purge {row.loosePhotoCount} photo{row.loosePhotoCount === 1 ? "" : "s"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function SuperAdminLoosePhotosPage() {
  const role = readUserRole();
  const allowed = role === "super_admin";
  const [companyId, setCompanyId] = useState("");
  const [page, setPage] = useState(0);

  const params = new URLSearchParams();
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(page * PAGE_SIZE));
  if (companyId.trim()) params.set("companyId", companyId.trim());

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<LoosePhotosResponse>({
    queryKey: ["/api/admin/wet-checks/loose-photos", params.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/admin/wet-checks/loose-photos?${params}`, {
        credentials: "include",
        headers: buildAuthHeaders(),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    staleTime: 30_000,
    enabled: allowed,
  });

  if (!allowed) {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-amber-500 mb-3" />
        <h1 className="text-xl font-semibold mb-2">Super admin access required</h1>
        <p className="text-gray-600">
          You don't have permission to view the loose photos audit.
        </p>
      </div>
    );
  }

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="max-w-5xl mx-auto py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Loose Photos Audit</h1>
          <p className="text-sm text-gray-600 mt-1">
            Wet checks with photos that are not linked to any finding. Ops can open each
            wet check and use the "Attach to finding" picker to resolve the backlog, or
            use "Purge" to delete all loose photos for a wet check at once.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Company ID"
            value={companyId}
            onChange={(e) => { setCompanyId(e.target.value); setPage(0); }}
            className="w-32"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-16 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : isError ? (
            <div className="py-12 text-center text-red-600 text-sm">
              Couldn't load data
              {error instanceof Error ? `: ${error.message}` : ""}
            </div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-gray-500 text-sm">
              No wet checks with loose photos found.
              {companyId && " Try removing the company filter."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Wet Check</th>
                    <th className="px-4 py-2 text-left">Customer</th>
                    <th className="px-4 py-2 text-left">Property</th>
                    <th className="px-4 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-right">Loose Photos</th>
                    <th className="px-4 py-2 text-left"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((row) => {
                    const statusMeta = STATUS_LABELS[row.status] ?? {
                      label: row.status,
                      className: "bg-gray-50 text-gray-600",
                    };
                    return (
                      <tr key={row.wetCheckId} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono text-xs text-gray-700">
                          WC-{new Date().getFullYear()}-{String(row.wetCheckId).padStart(4, "0")}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {row.customerName}
                        </td>
                        <td className="px-4 py-3 text-gray-600 max-w-[220px] truncate">
                          {row.propertyAddress ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusMeta.className}`}
                          >
                            {statusMeta.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Badge variant="destructive" className="tabular-nums">
                            {row.loosePhotoCount}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Link href={`/manager/wet-checks/${row.wetCheckId}`}>
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5"
                                data-testid={`view-wc-${row.wetCheckId}`}
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                View
                              </Button>
                            </Link>
                            <PurgeButton row={row} onPurged={() => refetch()} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>
            {total} wet check{total === 1 ? "" : "s"} total
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              Previous
            </Button>
            <span>
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
