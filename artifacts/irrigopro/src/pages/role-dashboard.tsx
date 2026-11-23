import { useQuery } from "@tanstack/react-query";
import { DASHBOARD_ROLES, DASHBOARD_TILE_ROLES, type DashboardSectionsResponse } from "@workspace/shared";
import { CommandBand, type DashboardRole } from "@/components/dashboard/command-band";
import { DashboardPreviews } from "@/components/dashboard/dashboard-previews";
import { SectionTiles } from "@/components/dashboard/section-tiles";
import { useJumpTo } from "@/components/layout/jump-to";
import { useNavPins } from "@/components/layout/nav-pins";
import type { AgingSummary } from "@/components/billing/invoice-aging-strip";
import { actionBoardQueryOptions } from "@/lib/action-board-query";
import { useAuth } from "@/lib/auth-context";
import { EMPTY_AR_QUERY, agingSummaryParams, invoiceAgingSummaryKey } from "@/lib/invoice-ar-query";
import { getQueryFn } from "@/lib/queryClient";

type BoardPreview = { rows: { lane: string }[] };

function summarizePlan({ rows }: BoardPreview) {
  const counts = { clear_to_send: 0, over_budget_nothing_approved: 0, nothing_pending: 0 };
  for (const { lane } of rows) {
    if (lane === "clear_to_send" || lane === "over_budget_nothing_approved" || lane === "nothing_pending") {
      counts[lane]++;
    }
  }
  return { counts, isEmpty: rows.length === 0 };
}

export default function RoleDashboard() {
  const { user } = useAuth();
  const role = DASHBOARD_ROLES.find((role) => role === user?.role);
  if (!user || !role) return null;
  return <RoleDashboardContent role={role} userId={user.id} companyId={user.companyId} />;
}

function RoleDashboardContent({ role, userId, companyId }: {
  role: DashboardRole;
  userId: number;
  companyId?: number | null;
}) {
  const now = new Date();
  const { open } = useJumpTo();
  const { pinnedIds } = useNavPins(userId, role);
  const showPlan = role === "company_admin" || role === "irrigation_manager";
  const showAging = DASHBOARD_TILE_ROLES.invoices.includes(role);
  // The existing company-profile GET only serves these two roles. Use the
  // brand fallback on the other dashboards rather than requesting a known 403.
  const company = useQuery<{ name?: string | null }>({
    queryKey: [`/api/company/${companyId}/profile`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: showPlan && !!companyId,
    retry: false,
  });
  const sections = useQuery<DashboardSectionsResponse>({
    queryKey: ["/api/dashboard/sections"],
    queryFn: getQueryFn({ on401: "throw" }),
    staleTime: 0, // The app defaults to Infinity, which would skip focus refetches.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const plan = useQuery({
    ...actionBoardQueryOptions<BoardPreview>(now.getFullYear(), now.getMonth() + 1),
    enabled: showPlan,
    select: summarizePlan,
  });
  const aging = useQuery<AgingSummary>({
    queryKey: invoiceAgingSummaryKey(EMPTY_AR_QUERY),
    queryFn: async ({ signal }) => {
      const params = agingSummaryParams(EMPTY_AR_QUERY);
      const response = await fetch(`/api/invoices/aging-summary${params ? `?${params}` : ""}`, { signal });
      if (!response.ok) throw new Error("Failed to load aging summary");
      return response.json();
    },
    enabled: showAging,
  });
  const data = sections.isError ? undefined : sections.data;

  return (
    <div className="w-full px-4 py-6 lg:px-6 space-y-4" data-testid="role-dashboard">
      <CommandBand
        role={role}
        now={now}
        companyName={showPlan && !company.isError ? company.data?.name : undefined}
        field={data?.field ?? null}
        money={data?.money ?? null}
        pinnedIds={pinnedIds}
        onJumpTo={open}
      />
      <SectionTiles
        role={role}
        now={now}
        tiles={data?.tiles ?? []}
        isLoading={sections.isLoading}
        isError={sections.isError}
        onRetry={() => { void sections.refetch(); }}
      />
      <DashboardPreviews
        role={role}
        plan={{
          data: plan.data,
          monthLabel: new Intl.DateTimeFormat("en-US", { month: "long" }).format(now),
          isLoading: plan.isLoading,
          isError: plan.isError,
        }}
        aging={{ summary: aging.data, isLoading: aging.isLoading, isError: aging.isError }}
      />
    </div>
  );
}
