import { Link } from "wouter";
import { Search } from "lucide-react";
import { formatCurrency } from "@/lib/format-currency";
import { navForRole } from "@/components/layout/nav-config";
import { IRRIGATION_SEASON, type DASHBOARD_ROLES, type DashboardSectionsResponse } from "@workspace/shared";
import { localDayNumber } from "./dashboard-dates";

export type DashboardRole = (typeof DASHBOARD_ROLES)[number];

export interface CommandBandProps {
  role: DashboardRole;
  now: Date;
  companyName?: string | null;
  field: DashboardSectionsResponse["field"];
  money: DashboardSectionsResponse["money"];
  pinnedIds: readonly string[];
  onJumpTo: () => void;
}

const QUICK_ACTIONS: Record<DashboardRole, { label: string; href: string }[]> = {
  company_admin: [
    { label: "Open Action Board", href: "/action-board" },
    { label: "Command Center", href: "/billing/command-center" },
    { label: "Estimates", href: "/estimates/command-center" },
  ],
  irrigation_manager: [
    { label: "Open Action Board", href: "/action-board" },
    { label: "Start a Wet Check", href: "/wet-checks/new" },
    { label: "Work Orders", href: "/work-orders" },
  ],
  billing_manager: [
    { label: "Open Command Center", href: "/billing/command-center" },
    { label: "Start a Wet Check", href: "/wet-checks/new" },
    { label: "Invoices", href: "/invoices" },
  ],
  bookkeeper: [
    { label: "Open Invoices", href: "/invoices" },
    { label: "QuickBooks", href: "/quickbooks" },
  ],
};

const BAND_ROW = "flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-white/[.12] pt-3.5";
const ACT = "inline-flex min-h-10 items-center gap-2 rounded-[10px] border px-3.5 text-sm font-semibold";

function seasonChipText(now: Date): string {
  const y = now.getFullYear();
  const today = localDayNumber(now);
  const start = localDayNumber(new Date(y, IRRIGATION_SEASON.firstMonth - 1, IRRIGATION_SEASON.firstDay));
  const end = localDayNumber(new Date(y, IRRIGATION_SEASON.lastMonth - 1, IRRIGATION_SEASON.lastDay));
  if (today >= start && today <= end) {
    const week = Math.min(31, Math.ceil((today - start + 1) / 7));
    return `Irrigation season · week ${week} / 31`;
  }
  const next = today < start ? start
    : localDayNumber(new Date(y + 1, IRRIGATION_SEASON.firstMonth - 1, IRRIGATION_SEASON.firstDay));
  return `Off season · next season opens Apr 1 (${next - today} days)`;
}

function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

export function CommandBand({ role, now, companyName, field, money, pinnedIds, onJumpTo }: CommandBandProps) {
  const eyebrow = `${(companyName?.trim() || "IrrigoPro").toUpperCase()} · IRRIGATION`;
  const dateText = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const pages = navForRole(role).flatMap((s) => s.pages);
  const pins = pinnedIds.flatMap((id) => pages.filter((p) => p.id === id).slice(0, 1));
  const pastDue = money ? Number(money.pastDueBalance) > 0 : false;

  return (
    <section aria-label="Today" className="nav-rail-brand flex flex-col gap-4 rounded-[14px] px-6 py-6 shadow-[0_10px_25px_rgba(14,58,108,.2)] sm:px-7" data-testid="dashboard-command-band">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="break-words text-[11px] font-bold uppercase tracking-[0.18em] text-[#bad5f0]/80" data-testid="text-dashboard-eyebrow">
            {eyebrow}
          </p>
          <h1 className="mt-1.5 break-words text-[34px] font-extrabold leading-[1.05] tracking-[-.02em] text-white" data-testid="text-dashboard-date">
            {dateText} <span className="font-normal text-[#e2f0fd]/60">{now.getFullYear()}</span>
          </h1>
        </div>
        <button
          type="button"
          onClick={onJumpTo}
          className={`${ACT} border-white/[.22] hover:bg-white/10 hover:text-white`}
          data-testid="button-jump-to"
        >
          <Search className="h-[18px] w-[18px] shrink-0" aria-hidden />
          Jump to a page
          <kbd className="rounded-md bg-white/[.14] px-1.5 py-0.5 text-[11px]">{isMac() ? "Cmd K" : "Ctrl K"}</kbd>
        </button>
      </div>

      <div className={BAND_ROW}>
        <span className="rounded-full border border-white/[.18] bg-white/[.08] px-3 py-1.5 text-xs" data-testid="text-season-chip">
          {seasonChipText(now)}
        </span>
      </div>

      {field && (
        <p className={`${BAND_ROW} block text-[13px] text-[#e2f0fd]/[.82]`} data-testid="text-field-line">
          <strong className="text-white">{field.techsOnActiveWork}</strong> techs on active work ·{" "}
          <strong className="text-white">{field.workOrdersInProgress}</strong> work orders in progress ·{" "}
          <strong className="text-white">{field.wetChecksInProgress}</strong> wet checks in progress
        </p>
      )}
      {money && (
        <p className={`${BAND_ROW} block text-[13px] text-[#e2f0fd]/[.82]`} data-testid="text-money-line">
          {money.readyToBillCount !== null && <><strong className="text-white">{money.readyToBillCount}</strong> items ready to bill ·{" "}</>}
          <strong className="text-white">{formatCurrency(money.openInvoiceBalance)}</strong> open invoices ·{" "}
          <span className={pastDue ? "font-semibold" : undefined} style={pastDue ? { color: "#fecaca" } : undefined} data-testid="text-past-due">
            <strong className={pastDue ? "font-semibold" : "text-white"}>{formatCurrency(money.pastDueBalance)}</strong> past due
          </span>
        </p>
      )}

      <nav aria-label="Quick actions" className={`${BAND_ROW} gap-y-2`}>
        {QUICK_ACTIONS[role].map((a, idx) => (
          <Link
            key={a.href}
            href={a.href}
            className={
              idx === 0
                ? `${ACT} border-transparent bg-[linear-gradient(135deg,hsl(199_95%_52%),hsl(188_90%_48%)_50%,hsl(174_80%_45%))] text-[#04212e] hover:brightness-110`
                : `${ACT} border-white/[.22] hover:bg-white/10 hover:text-white`
            }
            data-testid={`link-quick-action-${idx}`}
          >
            {a.label}
          </Link>
        ))}
      </nav>

      {pins.length > 0 && (
        <div className={`${BAND_ROW} gap-y-2`} data-testid="dashboard-pinned">
          <span className="text-xs text-[#bad5f0]/80">Pinned:</span>
          {pins.map((p) => (
            <Link key={p.id} href={p.href} className="rounded-full border border-white/[.18] bg-white/[.08] px-3 py-1.5 text-xs hover:bg-white/[.16]" data-testid={`link-pin-${p.id}`}>
              {p.label}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
