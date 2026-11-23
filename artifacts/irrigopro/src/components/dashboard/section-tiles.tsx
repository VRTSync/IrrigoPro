import { Link } from "wouter";
import {
  ClipboardCheck, ClipboardList, DollarSign, Droplets, FileText, Package, Receipt, Wrench, type LucideIcon,
} from "lucide-react";
import { navForRole } from "@/components/layout/nav-config";
import {
  DASHBOARD_OVERDUE_DAYS, DASHBOARD_TILE_ORDER, DASHBOARD_TILE_ROLES,
  type DashboardTile, type DashboardTileKey,
} from "@workspace/shared";
import type { DashboardRole } from "./command-band";
import { relativeDays } from "./dashboard-dates";

export interface SectionTilesProps {
  role: DashboardRole;
  now: Date;
  tiles: readonly DashboardTile[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

const D = DASHBOARD_OVERDUE_DAYS;
const TILE_META: Record<DashboardTileKey, { name: string; icon: LucideIcon; pageId: string; rule: string }> = {
  "wet-checks": { name: "Wet Checks", icon: Droplets, pageId: "wet-check-reviews", rule: `Counts submitted wet checks waiting for triage and approval. Overdue after ${D["wet-checks"]} days.` },
  "estimates": { name: "Estimates", icon: FileText, pageId: "estimates", rule: `Counts estimates in the approval queue. Overdue after ${D.estimates} days from sending for approval, or creation if not sent.` },
  "work-orders": { name: "Work Orders", icon: Wrench, pageId: "work-orders", rule: `Counts open work orders (pending, assigned or in progress). Overdue ${D["work-orders"]} days after being opened.` },
  "billing-sheets": { name: "Billing Sheets", icon: ClipboardList, pageId: "billing-sheets", rule: `Counts billing sheets still in draft. Overdue ${D["billing-sheets"]} days after being started.` },
  "approvals": { name: "Approvals", icon: ClipboardCheck, pageId: "manager-workspace", rule: `Counts work orders and billing sheets waiting for manager approval. Overdue after waiting ${D.approvals} days.` },
  "ready-to-bill": { name: "Ready to Bill", icon: DollarSign, pageId: "command-center", rule: "Counts approved work orders, billing sheets and wet checks not yet invoiced. Overdue when the work was done before this month." },
  "invoices": { name: "Invoices", icon: Receipt, pageId: "invoices", rule: "Counts open invoices with a balance due. Overdue once past the effective due date." },
  "parts": { name: "Parts", icon: Package, pageId: "parts-pending", rule: `Counts field-added parts and manual part reviews waiting for approval. Overdue after ${D.parts} days.` },
};

const CARD = "min-w-0 grid-rows-[20px_44px_20px_42px] gap-y-1 rounded-[14px] border border-slate-200 px-4 py-3.5 transition-colors";

export function SectionTiles({ role, now, tiles, isLoading, isError, onRetry }: SectionTilesProps) {
  const pages = navForRole(role).flatMap((s) => s.pages);
  const byKey = new Map(tiles.map((t) => [t.key, t]));

  return (
    <section aria-label="Sections" className="space-y-3">
      {isError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="dashboard-sections-error">
          <span>Section counts could not be loaded.</span>
          <button type="button" onClick={onRetry} className="min-h-9 rounded-md border border-red-300 bg-white px-3 font-medium hover:bg-red-100" data-testid="button-dashboard-retry">
            Retry
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {DASHBOARD_TILE_ORDER.map((key) => {
          if (!DASHBOARD_TILE_ROLES[key].includes(role)) {
            return <div key={key} aria-hidden="true" className={`${CARD} invisible hidden sm:grid`} data-testid={`dashboard-slot-${key}`} />;
          }
          const meta = TILE_META[key];
          const Icon = meta.icon;
          const tile = isError || isLoading ? undefined : byKey.get(key);
          const ready = !!tile;
          const empty = ready && tile.total === 0;
          const overdue = ready && tile.overdue > 0;
          const page = pages.find((p) => p.id === meta.pageId);
          if (!page) console.error(`Dashboard tile "${key}": no nav page "${meta.pageId}" for role ${role}`);

          const label = ready
            ? `Open ${meta.name}: ${tile.total} waiting, ${overdue ? `${tile.overdue} overdue` : "none overdue"}`
            : `Open ${meta.name}`;

          const body = (
            <>
              <div className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[.06em] ${empty ? "text-muted-foreground" : "text-slate-900"}`}>
                <Icon className="h-[15px] w-[15px] shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{meta.name}</span>
              </div>
              <div className="flex items-center">
                {isLoading && !isError ? (
                  <span className="h-8 w-14 animate-pulse rounded-md bg-slate-200" aria-hidden />
                ) : (
                  <span
                    className={`text-[36px] font-semibold leading-none tabular-nums ${empty ? "text-muted-foreground" : "text-slate-900"}`}
                    style={overdue ? { color: "#b91c1c" } : undefined}
                    data-testid={`dashboard-count-${key}`}
                  >
                    {ready ? tile.total : "—"}
                  </span>
                )}
              </div>
              <p className="text-[13px]">
                {ready ? (
                  overdue
                    ? <span className="font-medium" style={{ color: "#b91c1c" }}>{tile.overdue} overdue</span>
                    : <span className="text-muted-foreground">none overdue</span>
                ) : <span className="text-muted-foreground">&nbsp;</span>}
              </p>
              <div className="min-w-0 border-t border-slate-200 pt-1 text-xs text-muted-foreground">
                {empty ? (
                  <span>Nothing waiting</span>
                ) : tile?.oldest ? (
                  <>
                    <p className="truncate text-slate-900" title={`Oldest: ${tile.oldest.label}`}>Oldest: {tile.oldest.label}</p>
                    <p>{tile.oldest.verb} {relativeDays(tile.oldest.at, now)}</p>
                  </>
                ) : null}
              </div>
            </>
          );

          const cls = `grid ${CARD} ${empty ? "bg-transparent" : "bg-white"} ${page ? "hover:border-[#1e5c99]/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1e5c99]" : ""}`;
          return page ? (
            <Link key={key} href={page.href} title={meta.rule} aria-label={label} className={cls} data-testid={`dashboard-tile-${key}`}>
              {body}
            </Link>
          ) : (
            <div key={key} title={meta.rule} aria-label={label} className={cls} data-testid={`dashboard-tile-${key}`}>
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}
