import { Link } from "wouter";
import { AGING_BUCKET_LABELS, type AgingBucketKey } from "@workspace/shared";
import { formatCurrency } from "@/lib/format-currency";
import { BUCKET_TO_AGING_VALUE } from "@/lib/invoice-ar-query";
import type { AgingSummary } from "@/components/billing/invoice-aging-strip";
import type { DashboardRole } from "./command-band";

export interface DashboardPreviewsProps {
  role: DashboardRole;
  plan: {
    data?: {
      counts: { clear_to_send: number; over_budget_nothing_approved: number; nothing_pending: number };
      isEmpty: boolean;
    };
    monthLabel: string;
    isLoading: boolean;
    isError: boolean;
  };
  aging: { summary?: AgingSummary; isLoading: boolean; isError: boolean };
}

const BUCKETS: Record<AgingBucketKey, string> = {
  current: "#16a34a", days30: "#f59e0b", days60: "#ea580c", days90: "#dc2626",
};
const PLAN_ROWS = [
  { key: "clear_to_send", label: "Clear to send", color: "#16a34a" },
  { key: "over_budget_nothing_approved", label: "Over budget, nothing approved", color: "#dc2626" },
  { key: "nothing_pending", label: "Nothing pending", color: "#94a3b8" },
] as const;

function Marker({ color }: { color: string }) {
  return <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: color }} />;
}

function Card({ title, href, cta, testId, children }: { title: string; href: string; cta: string; testId: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white px-5 py-[18px] shadow-sm" data-testid={testId}>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <h2 className="text-[15px] font-bold text-slate-900">{title}</h2>
        <Link href={href} className="text-[13px] font-semibold text-[#1e5c99] hover:underline" data-testid={`link-${testId}-open`}>
          {cta}
        </Link>
      </div>
      {children}
    </section>
  );
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <ul aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex min-h-10 items-center justify-between border-b last:border-0">
          <span className="h-3 w-32 animate-pulse rounded bg-slate-200" />
          <span className="h-3 w-12 animate-pulse rounded bg-slate-200" />
        </li>
      ))}
    </ul>
  );
}

function ErrorLine({ text }: { text: string }) {
  return <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{text}</p>;
}

export function DashboardPreviews({ role, plan, aging }: DashboardPreviewsProps) {
  const showPlan = role === "company_admin" || role === "irrigation_manager";
  const showAging = role === "company_admin" || role === "billing_manager" || role === "bookkeeper";
  const { data: planData } = plan;
  const { summary } = aging;

  return (
    <div className={showPlan && showAging ? "grid grid-cols-1 gap-4 lg:grid-cols-2" : undefined}>
      {showPlan && (
        <Card title="Today's plan" href="/action-board" cta="Open Action Board" testId="dashboard-preview-plan">
          {plan.isError ? <ErrorLine text="Today's plan could not be loaded." />
            : plan.isLoading || !planData ? <Skeleton rows={3} />
            : planData.isEmpty ? (
              <div className="space-y-1 py-2.5 text-sm" data-testid="dashboard-plan-no-budgets">
                <p>No customer budgets for {plan.monthLabel} yet.</p>
                <p className="text-muted-foreground">Today's plan fills in once monthly budgets are set.</p>
              </div>
            )
            : (
              <ul>
                {PLAN_ROWS.map((r) => (
                  <li key={r.key} className="flex min-h-10 items-center gap-2.5 border-t border-slate-200 py-2.5 text-sm first:border-t-0">
                    <Marker color={r.color} />
                    <span>{r.label}</span>
                    <span className="ml-auto font-bold tabular-nums" data-testid={`text-plan-${r.key}`}>{planData.counts[r.key]}</span>
                  </li>
                ))}
              </ul>
            )}
        </Card>
      )}
      {showAging && (
        <Card title="Invoice aging" href="/invoices" cta="Open Invoices" testId="dashboard-preview-aging">
          {aging.isError ? <ErrorLine text="Invoice aging could not be loaded." />
            : aging.isLoading || !summary ? <Skeleton rows={4} />
            : (
              <ul>
                {(Object.keys(BUCKETS) as AgingBucketKey[]).map((key) => {
                  const bucket = summary.buckets.find((x) => x.key === key);
                  return (
                    <li key={key} className="border-t border-slate-200 first:border-t-0">
                      <Link href={`/invoices?aging=${BUCKET_TO_AGING_VALUE[key]}`} className="flex min-h-10 items-center gap-2.5 py-2.5 text-sm hover:text-[#1e5c99] hover:underline" data-testid={`link-aging-${key}`}>
                        <Marker color={BUCKETS[key]} />
                        <span>{AGING_BUCKET_LABELS[key]}</span>
                        <span className="ml-auto font-bold tabular-nums">{bucket ? formatCurrency(bucket.balanceDue) : "—"}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
        </Card>
      )}
    </div>
  );
}
