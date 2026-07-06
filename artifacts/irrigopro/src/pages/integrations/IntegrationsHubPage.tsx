import { useAuth } from "@/lib/auth-context";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Plug, ChevronRight, CheckCircle2, XCircle, AlertCircle, Clock } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AspireCredentialSummary {
  companyId: number;
  connectionStatus: "disconnected" | "connected" | "error" | "reconnect_required";
  syncEnabled: boolean;
  lastHealthCheckAt?: string | null;
}

// ---------------------------------------------------------------------------
// Status badge helper
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "connected":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
          <CheckCircle2 className="h-3 w-3" />
          Connected
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20">
          <XCircle className="h-3 w-3" />
          Error
        </span>
      );
    case "reconnect_required":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">
          <AlertCircle className="h-3 w-3" />
          Reconnect Required
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-500/20">
          <Clock className="h-3 w-3" />
          Not Connected
        </span>
      );
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function IntegrationsHubPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();

  const companyId = user?.companyId;
  const isReadOnly = user?.role === "billing_manager" || user?.role === "irrigation_manager";

  const { data, isLoading } = useQuery<{ credentials: AspireCredentialSummary | null }>({
    queryKey: [`/api/company/${companyId}/integrations/aspire`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: Boolean(companyId),
  });

  const aspireStatus = data?.credentials?.connectionStatus ?? "disconnected";

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto p-6">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600">
              <Plug className="h-5 w-5 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Integrations</h1>
          </div>
          <p className="text-sm text-gray-500">
            Connect IrrigoPro with external services to sync data and streamline your workflow.
          </p>
        </div>

        {/* Integration cards */}
        <div className="space-y-3">
          {/* Aspire CRM card */}
          <div
            className={`group relative flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all duration-150 ${
              isReadOnly ? "cursor-default" : "cursor-pointer hover:border-blue-300 hover:shadow-md"
            }`}
            onClick={() => {
              if (!isReadOnly) navigate("/integrations/aspire");
            }}
          >
            {/* Logo placeholder */}
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-50 ring-1 ring-emerald-100">
              <span className="text-lg font-bold text-emerald-700">A</span>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-semibold text-gray-900 text-sm">Aspire CRM</span>
                {isLoading ? (
                  <span className="inline-block h-4 w-20 animate-pulse rounded bg-gray-100" />
                ) : (
                  <StatusBadge status={aspireStatus} />
                )}
              </div>
              <p className="text-xs text-gray-500 truncate">
                Sync customers, properties, work orders, estimates, and more.
              </p>
              {data?.credentials?.lastHealthCheckAt && (
                <p className="text-xs text-gray-400 mt-1">
                  Last checked:{" "}
                  {new Date(data.credentials.lastHealthCheckAt).toLocaleString()}
                </p>
              )}
            </div>

            {!isReadOnly && (
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5" />
            )}
          </div>

          {/* QuickBooks — read-only info tile */}
          <div className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm opacity-60">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50 ring-1 ring-blue-100">
              <span className="text-lg font-bold text-blue-700">Q</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-semibold text-gray-900 text-sm">QuickBooks Online</span>
                <span className="inline-flex items-center rounded-full bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-500 ring-1 ring-inset ring-gray-500/20">
                  Managed separately
                </span>
              </div>
              <p className="text-xs text-gray-500 truncate">
                Invoice sync available from the QuickBooks page.
              </p>
            </div>
          </div>
        </div>

        {isReadOnly && (
          <p className="mt-4 text-xs text-gray-400 text-center">
            Contact your company admin to configure integrations.
          </p>
        )}
      </div>
    </div>
  );
}
