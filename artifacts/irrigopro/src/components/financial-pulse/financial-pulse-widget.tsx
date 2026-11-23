// Task #708 — Financial Pulse Slice 5: consolidation & widgetization.
//
// Shared FP widget used across Manager Workspace, Customer Profile,
// and Action Board. Backed by the existing
// /api/financial-pulse/* endpoints (plus the new
// /api/financial-pulse/customer/:id/summary added in this slice) so
// every surface reads from a single source of truth.

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChevronRight, AlertCircle, TrendingUp } from "lucide-react";
import { MetricTile } from "@/components/financial-pulse/metric-tile";
import { adaptiveRefetchInterval } from "@/lib/queryClient";
import { BudgetBar } from "@/components/budget/BudgetBar";
import { cn } from "@/lib/utils";

export type FinancialPulseVariant =
  | "billing-header"
  | "customer-detail"
  | "action-board";

interface BaseProps {
  variant: FinancialPulseVariant;
  className?: string;
}
interface BillingHeaderProps extends BaseProps {
  variant: "billing-header";
}
interface CustomerDetailProps extends BaseProps {
  variant: "customer-detail";
  customerId: number;
}
interface ActionBoardProps extends BaseProps {
  variant: "action-board";
  year?: number;
  month?: number;
  companyId?: number;
}
export type FinancialPulseWidgetProps =
  | BillingHeaderProps
  | CustomerDetailProps
  | ActionBoardProps;

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatCurrency(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return CURRENCY.format(n);
}

// ─── KPIs response (billing-header variant) ───────────────────────────────
interface KpiTile {
  value: number | null;
  deltaPct?: number | null;
  comparedTo?: string;
}
interface KpisResponse {
  billedMtd: KpiTile;
  collectedMtd?: KpiTile;
  outstandingAr: KpiTile;
}

// Task #720 — canonical per-tile captions (matches
// `docs/financial-metrics.md` and the FP page's INFO_TIPS).
const BILLING_HEADER_TIPS = {
  billedMtd:
    "From invoices · month-to-date by createdAt · excludes draft, cancelled, superseded, merged, failed · includes tax and markup.",
  collectedMtd:
    "From invoices · month-to-date by paidAt · excludes draft, cancelled, superseded, merged, failed · includes tax and markup.",
  outstandingAr:
    "From invoices · point-in-time · excludes draft, cancelled, superseded, merged, failed, and paid · live from this app, not QuickBooks.",
} as const;

interface CustomerSummary {
  customerId: number;
  name: string | null;
  billedMtd: number;
  billedYtd: number;
  outstandingAr: number;
  unbilledExposure: number;
  avgDaysToPay: number | null;
  lastInvoiceAt: string | null;
  monthly: BudgetBucket;
  annual: BudgetBucket;
}
interface BudgetBucket {
  cap: number | null;
  spend: number;
  percent: number | null;
  status: "unset" | "healthy" | "approaching" | "over";
}

interface ActionBoardRollup {
  totalAllocation?: number;
  totalInvoiced?: number;
  totalPending?: number;
  seasonTarget?: number;
  seasonSpend?: number;
  overBudgetCount?: number;
  heldWorkOrderCount?: number;
  billedThisMonth?: number;
  seasonLeftToBill?: number;
}
interface ActionBoardResponse {
  rollup?: ActionBoardRollup;
}

// Generic fetch with role-aware soft fail. Returns `null` on 403 so
// the widget can render nothing for roles outside FP's allow-list.
async function fetchFp<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { credentials: "include" });
  if (res.status === 403 || res.status === 401) return null;
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

// ─── Hook ─────────────────────────────────────────────────────────────────

function useFinancialPulseData<T>(url: string) {
  return useQuery<T | null>({
    queryKey: [url],
    queryFn: () => fetchFp<T>(url),
    refetchInterval: adaptiveRefetchInterval(60_000),
    refetchIntervalInBackground: false,
    retry: false,
  });
}

// ─── Card shell ───────────────────────────────────────────────────────────

function WidgetCard({
  title,
  href,
  children,
  className,
  testId,
}: {
  title: string;
  href: string;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <Card className={cn(className)} data-testid={testId}>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-gray-500" />
          {title}
        </CardTitle>
        <Link href={href}>
          <a
            className="text-xs text-blue-600 hover:underline flex items-center gap-0.5"
            data-testid={testId ? `${testId}-link` : undefined}
          >
            View on Financial Pulse <ChevronRight className="w-3.5 h-3.5" />
          </a>
        </Link>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ErrorState({ testId }: { testId?: string }) {
  return (
    <div
      className="flex items-center gap-2 text-sm text-gray-500 py-2"
      data-testid={testId ? `${testId}-error` : undefined}
    >
      <AlertCircle className="w-4 h-4 text-amber-500" />
      Financial Pulse data is temporarily unavailable.
    </div>
  );
}

// ─── Variant: billing-header ──────────────────────────────────────────────
//
function BillingHeaderVariant({ className }: { className?: string }) {
  const url = "/api/financial-pulse/kpis?period=mtd";
  const { data, isLoading, error, refetch } =
    useFinancialPulseData<KpisResponse>(url);
  // 403 → render nothing for field techs, the only role excluded from FP.
  if (!isLoading && data == null && !error) return null;

  const serverCollected = data?.collectedMtd?.value;
  const hasServerCollected =
    typeof serverCollected === "number" && Number.isFinite(serverCollected);

  return (
    <div
      className={cn(
        "rounded-md px-3 py-2",
        className,
      )}
      style={{
        background: "hsl(var(--primary)/0.05)",
        borderBottom: "1px solid hsl(var(--primary)/0.15)",
      }}
      data-testid="fp-widget-billing-header"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">
          <TrendingUp className="w-3.5 h-3.5 text-gray-500" />
          Financial Pulse
        </div>
        <Link href="/financial-pulse">
          <a
            className="text-xs text-blue-600 hover:underline flex items-center gap-0.5"
            data-testid="fp-widget-billing-header-link"
          >
            View Financial Pulse <ChevronRight className="w-3.5 h-3.5" />
          </a>
        </Link>
      </div>
      {error ? (
        <div
          className="flex items-center gap-2"
          data-testid="fp-widget-billing-header-error"
        >
          <div className="grid grid-cols-3 gap-3 flex-1">
            <MetricTile
              label="Billed MTD"
              value={null}
              format="currency"
              isError
              testId="fp-tile-billing-header-billed-mtd"
            />
            <MetricTile
              label="Collected MTD"
              value={null}
              format="currency"
              isError
              testId="fp-tile-billing-header-collected-mtd"
            />
            <MetricTile
              label="Money Owed"
              value={null}
              format="currency"
              isError
              testId="fp-tile-billing-header-outstanding-ar"
            />
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="text-xs text-blue-600 hover:underline shrink-0"
            data-testid="fp-widget-billing-header-retry"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <MetricTile
            label="Billed MTD"
            value={data?.billedMtd.value ?? null}
            format="currency"
            deltaPct={data?.billedMtd.deltaPct ?? null}
            deltaLabel="vs prev month"
            isLoading={isLoading}
            testId="fp-tile-billing-header-billed-mtd"
            windowBadge="MTD"
            infoTip={BILLING_HEADER_TIPS.billedMtd}
          />
          <MetricTile
            label="Collected MTD"
            value={hasServerCollected ? serverCollected : null}
            format="currency"
            deltaPct={hasServerCollected ? (data?.collectedMtd?.deltaPct ?? null) : null}
            deltaLabel="vs prev month"
            isLoading={isLoading}
            isError={!isLoading && !hasServerCollected}
            testId="fp-tile-billing-header-collected-mtd"
            windowBadge="MTD"
            infoTip={BILLING_HEADER_TIPS.collectedMtd}
          />
          <MetricTile
            label="Money Owed"
            value={data?.outstandingAr.value ?? null}
            format="currency"
            deltaPct={data?.outstandingAr.deltaPct ?? null}
            deltaLabel="vs prev month"
            deltaGoodDirection="down"
            isLoading={isLoading}
            testId="fp-tile-billing-header-outstanding-ar"
            infoTip={BILLING_HEADER_TIPS.outstandingAr}
          />
        </div>
      )}
    </div>
  );
}

// ─── Variant: customer-detail ─────────────────────────────────────────────
//
// Task #1003 — audit + fix: "Billed MTD" and "Billed YTD" renamed to
// "Invoiced MTD" / "Invoiced YTD" so the label matches the underlying
// formula (invoice createdAt window, not cash collected). infoTips added
// to all four tiles so first-time viewers can understand each number.

const CUSTOMER_DETAIL_TIPS = {
  invoicedMtd:
    "Invoices created for this customer this month · anchored on invoice date · excludes draft and cancelled · includes tax and markup · includes uninvoiced wet-check billings by work date.",
  invoicedYtd:
    "Invoices created for this customer this calendar year · anchored on invoice date · excludes draft and cancelled · includes uninvoiced wet-check billings by work date.",
  moneyOwed:
    "Unpaid invoices for this customer · point-in-time balance · excludes draft, cancelled, and paid invoices · accuracy depends on QuickBooks payment sync.",
  avgTimeToPay:
    "Average days from invoice creation to payment · measured over the last 90 days · shows '—' when no paid invoices exist in that window.",
} as const;

function CustomerDetailVariant({ customerId }: { customerId: number }) {
  const url = `/api/financial-pulse/customer/${customerId}/summary`;
  const { data, isLoading, error } = useFinancialPulseData<CustomerSummary>(url);
  if (!isLoading && data == null && !error) return null;
  return (
    <WidgetCard
      title="Financial Pulse"
      href={`/financial-pulse?customerId=${customerId}`}
      testId="fp-widget-customer-detail"
    >
      {error ? (
        <ErrorState testId="fp-widget-customer-detail" />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricTile
              label="Invoiced MTD"
              value={data?.billedMtd ?? null}
              format="currency"
              isLoading={isLoading}
              testId="fp-tile-cust-billed-mtd"
              accent="blue"
              windowBadge="MTD"
              infoTip={CUSTOMER_DETAIL_TIPS.invoicedMtd}
            />
            <MetricTile
              label="Invoiced YTD"
              value={data?.billedYtd ?? null}
              format="currency"
              isLoading={isLoading}
              testId="fp-tile-cust-billed-ytd"
              accent="blue"
              windowBadge="YTD"
              infoTip={CUSTOMER_DETAIL_TIPS.invoicedYtd}
            />
            <MetricTile
              label="Money Owed"
              value={data?.outstandingAr ?? null}
              format="currency"
              isLoading={isLoading}
              testId="fp-tile-cust-outstanding-ar"
              accent="amber"
              infoTip={CUSTOMER_DETAIL_TIPS.moneyOwed}
            />
            <MetricTile
              label="Avg. Time to Get Paid"
              value={data?.avgDaysToPay ?? null}
              format="days"
              isLoading={isLoading}
              testId="fp-tile-cust-avg-days-to-pay"
              infoTip={CUSTOMER_DETAIL_TIPS.avgTimeToPay}
            />
          </div>
          {/* Task #2009 — the one shared budget renderer. The profile page
              shows this widget beside its own Budget & Alerts card; both now
              draw the same customer's month through BudgetBar, so they can no
              longer disagree on colour or wording. The server already
              classified with this customer's thresholds, which the widget
              does not receive, so the status is forced rather than
              re-derived. */}
          {data?.monthly &&
            (data.monthly.status === "unset" || data.monthly.cap == null ? (
              <div
                className="text-xs text-gray-500"
                data-testid="fp-widget-budget-meter-unset"
              >
                No monthly budget set
              </div>
            ) : (
              <BudgetBar
                label="This month"
                spentAmount={data.monthly.spend}
                allocation={data.monthly.cap}
                forcedStatus={data.monthly.status}
                size="md"
                showPercent
                data-testid="fp-widget-budget-meter"
              />
            ))}
        </div>
      )}
    </WidgetCard>
  );
}

function ActionBoardVariant({ year, month, companyId, className }: { year?: number; month?: number; companyId?: number; className?: string }) {
  const now = new Date();
  const selectedYear = year ?? now.getFullYear();
  const selectedMonth = month ?? now.getMonth() + 1;
  const url = `/api/action-board?year=${selectedYear}&month=${selectedMonth}${companyId ? `&companyId=${companyId}` : ""}`;
  const { data, isLoading, error } = useFinancialPulseData<ActionBoardResponse>(url);
  const rollup = data?.rollup;
  const billed = rollup?.billedThisMonth ?? rollup?.totalInvoiced ?? null;
  const allocation = rollup?.totalAllocation ?? null;
  const seasonTarget = rollup?.seasonTarget ?? null;
  const seasonSpend = rollup?.seasonSpend ?? null;
  const leftToBill = rollup?.seasonLeftToBill ?? (seasonTarget != null && seasonSpend != null ? Math.max(0, seasonTarget - seasonSpend) : null);
  const billedPercent = allocation && billed != null ? Math.round((billed / allocation) * 100) : null;
  const paceDelta = seasonTarget != null && seasonSpend != null ? seasonTarget - seasonSpend : null;
  const held = rollup?.heldWorkOrderCount;
  return (
    <div className={cn("grid grid-cols-2 lg:grid-cols-4 gap-3", className)} data-testid="fp-widget-action-board">
      {error ? (
        <ErrorState testId="fp-widget-action-board" />
      ) : (
        <>
          <MetricTile label={`Billed in ${new Intl.DateTimeFormat("en-US", { month: "long" }).format(new Date(selectedYear, selectedMonth - 1, 1))}`} value={billed} format="currency" helper={allocation != null ? `${formatCurrency(allocation)} allocated${billedPercent != null ? ` · ${billedPercent}%` : ""}` : undefined} isLoading={isLoading} testId="fp-tile-action-board-billed" />
          <MetricTile label="Season pace" value={seasonSpend} format="currency" helper={paceDelta == null ? undefined : paceDelta >= 0 ? `${formatCurrency(paceDelta)} behind target` : `${formatCurrency(Math.abs(paceDelta))} ahead of target`} isLoading={isLoading} testId="fp-tile-action-board-pace" />
          <MetricTile label="Left to bill this season" value={leftToBill} format="currency" helper="Remaining season allocation" isLoading={isLoading} testId="fp-tile-action-board-left" />
          <MetricTile label="Over budget" value={rollup?.overBudgetCount ?? null} format="number" helper={held == null ? undefined : `${held} work orders held`} isLoading={isLoading} testId="fp-tile-action-board-over-budget" />
          {allocation != null && billed != null && (
            <span className="sr-only">{formatCurrency(billed)} of {formatCurrency(allocation)} allocated</span>
          )}
        </>
      )}
    </div>
  );
}

// ─── Public component ────────────────────────────────────────────────────

export function FinancialPulseWidget(props: FinancialPulseWidgetProps) {
  switch (props.variant) {
    case "billing-header":
      return <BillingHeaderVariant className={props.className} />;
    case "customer-detail":
      return <CustomerDetailVariant customerId={props.customerId} />;
    case "action-board":
      return <ActionBoardVariant year={props.year} month={props.month} companyId={props.companyId} className={props.className} />;
  }
}
