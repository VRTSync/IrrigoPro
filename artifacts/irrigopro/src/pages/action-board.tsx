import { useMemo, useRef, useState } from "react";
import { Calendar, ClipboardCheck, Send, ShieldAlert } from "lucide-react";
import { generateActionBoardPlan } from "@workspace/shared";
import { copyText } from "@/lib/copy-text";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { BudgetBar } from "@/components/budget/BudgetBar";
import { FinancialPulseWidget } from "@/components/financial-pulse/financial-pulse-widget";
import { Skeleton } from "@/components/ui/skeleton";

type Lane = "clear_to_send" | "over_budget" | "nothing_pending";
interface WorkOrder {
  number?: string;
  workOrderNumber?: string;
  estimatedTotal?: number | string | null;
  total?: number | string | null;
  preApproved?: boolean;
  workType?: string;
}
interface BoardRow {
  customerId: number;
  customerName: string;
  lane: "clear_to_send" | "over_budget_nothing_approved" | "nothing_pending" | string;
  annualGoal?: number | null;
  allocation?: number | null;
  invoicedAmount?: number;
  pendingAmount?: number;
  status?: string;
  doNotExceed?: number;
  headroom?: number;
  wetCheck?: { due?: boolean; inspectionOnly?: boolean; startedAt?: string | null; completed?: boolean };
  wetCheckDue?: boolean;
  inspectionOnly?: boolean;
  newestWetCheck?: { startedAt?: string | null; status?: string };
  openWorkOrders?: WorkOrder[];
  workOrders?: WorkOrder[];
  reason?: string;
  preApproved?: boolean;
}
interface BoardResponse {
  year: number;
  month: number;
  rows: BoardRow[];
  excludedWithoutBudgetGoal: number;
  rollup?: Record<string, number>;
}

const months = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmt = (value: number | null | undefined) => value == null ? "—" : money.format(value);
function numericTotal(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
const laneInfo: Record<Lane, { title: string; subtitle: string; icon: typeof Send }> = {
  clear_to_send: { title: "Clear to send", subtitle: "Something to do, and either budget or an approval to do it with.", icon: Send },
  over_budget: { title: "Over budget — nothing approved", subtitle: "Work exists, but it exceeds available headroom and has no approval.", icon: ShieldAlert },
  nothing_pending: { title: "Nothing pending", subtitle: "No open work order, and this month's wet check is already done.", icon: ClipboardCheck },
};

function dateLabel(date?: string | null) {
  if (!date) return null;
  return new Date(date).toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

function Row({ row }: { row: BoardRow }) {
  const orders = row.openWorkOrders ?? row.workOrders ?? [];
  const wet = row.wetCheck ?? {};
  const due = row.wetCheckDue ?? wet.due ?? false;
  const inspection = row.inspectionOnly ?? wet.inspectionOnly ?? false;
  const startedAt = row.newestWetCheck?.startedAt ?? wet.startedAt;
  const values = orders.map((o) => numericTotal(o.estimatedTotal ?? o.total));
  const knownTotal = values.every((v) => v != null) ? values.reduce((sum, v) => sum + (v ?? 0), 0) : null;
  const orderNumbers = orders.map((o) => o.number ?? o.workOrderNumber).filter(Boolean).join(", ");
  const wetText = due
    ? `${inspection ? "Due — inspection only" : "Due"}${startedAt ? ` · last ${dateLabel(startedAt)}` : ""}`
    : wet.completed === false ? "Due" : "Done" + (startedAt ? ` ${dateLabel(startedAt)}` : "");
  return (
    <tr data-testid={`row-action-board-${row.customerId}`} className="border-t border-slate-100 align-top">
      <td className="p-4 min-w-[230px]">
        <Link href={`/customers/${row.customerId}/profile?tab=billing#budget-and-alerts`} className="font-semibold text-slate-900 hover:text-blue-600" data-testid={`link-action-board-customer-${row.customerId}`}>{row.customerName}</Link>
        <p className="mt-1 text-xs text-slate-500">Annual goal {fmt(row.annualGoal)} · {fmt(row.allocation)} this month</p>
        <BudgetBar allocation={row.allocation ?? null} invoicedAmount={row.invoicedAmount ?? 0} pendingAmount={row.pendingAmount ?? 0} size="sm" tone="instruction" showPercent data-testid={`budget-bar-action-board-${row.customerId}`} />
      </td>
      <td className="p-4 text-sm text-slate-700 min-w-[180px]">
        {orders.length ? <><strong>{orders.length} · {knownTotal == null ? "no estimate" : fmt(knownTotal)}</strong>{(row.preApproved || orders.some((o) => o.preApproved)) && <span className="ml-1 text-xs text-emerald-700">pre-approved</span>}<br /><span className="text-xs text-slate-500">{orderNumbers}</span></> : <span className="text-slate-400">None open</span>}
        {row.reason && <p className="mt-1 text-xs text-amber-700">{row.reason}</p>}
      </td>
      <td className="p-4 text-sm min-w-[180px]"><span className={due ? "font-semibold text-amber-700" : "text-emerald-700"}>{wetText}</span></td>
      <td className="p-4 text-sm font-semibold text-slate-800 whitespace-nowrap">{fmt(row.doNotExceed ?? row.headroom)}{orders.some((o) => o.preApproved) ? " + pre-approved" : ""}</td>
    </tr>
  );
}

export default function ActionBoardPage() {
  const now = new Date();
  const [selection, setSelection] = useState(`${now.getFullYear()}-${now.getMonth() + 1}`);
  const [year, month] = selection.split("-").map(Number);
  const { data, isLoading, error } = useQuery<BoardResponse>({
    queryKey: [`/api/action-board?year=${year}&month=${month}`],
    queryFn: async () => {
      const response = await fetch(`/api/action-board?year=${year}&month=${month}`, { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load Action Board");
      return response.json();
    },
    staleTime: 30_000,
  });
  const grouped: Record<Lane, BoardRow[]> = { clear_to_send: [], over_budget: [], nothing_pending: [] };
  for (const row of data?.rows ?? []) {
    const lane = (row.lane === "over_budget_nothing_approved" ? "over_budget" : row.lane) as Lane;
    if (grouped[lane]) grouped[lane].push(row);
  }
  const generatedPlan = useMemo(
    () => data ? generateActionBoardPlan(data.rows, new Date()) : "",
    [data],
  );
  // Keep edits local. A month switch presents its own generated plan; a refetch
  // never silently overwrites a manager's draft for the same month.
  const [draft, setDraft] = useState<{ selection: string; text: string } | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const planText = draft?.selection === selection ? draft.text : generatedPlan;
  const hasEdits = draft?.selection === selection && draft.text !== generatedPlan;
  const handleCopyPlan = async () => {
    // Start the clipboard operation in this click gesture, before any async work.
    try {
      await copyText(planText);
      setCopyStatus("Copied today's plan");
    } catch {
      editorRef.current?.focus();
      editorRef.current?.select();
      setCopyStatus("Copy failed. Plan selected — copy it manually.");
    }
  };
  const options = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    return { value: `${date.getFullYear()}-${date.getMonth() + 1}`, label: `${months[date.getMonth() + 1]} ${date.getFullYear()}` };
  });
  return (
    <main className="max-w-7xl mx-auto py-6 px-4 space-y-6" data-testid="action-board-page">
      <section className="rounded-2xl p-6 text-white bg-gradient-to-br from-slate-900 via-blue-900 to-cyan-700">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div><p className="text-sm text-blue-100">Action Board</p><h1 className="text-3xl font-bold mt-1">{months[month]} allocation</h1><p className="text-blue-100 mt-2">Where crews go today, and why.</p></div>
          <div className="flex items-center gap-2"><Calendar className="w-4 h-4" /><select value={selection} onChange={(event) => setSelection(event.target.value)} className="rounded-md bg-white/15 border border-white/30 px-3 py-2 text-sm" data-testid="action-board-month-selector">{options.map((option) => <option className="text-slate-900" key={option.value} value={option.value}>{option.label}</option>)}</select></div>
        </div>
      </section>
      <FinancialPulseWidget variant="action-board" year={year} month={month} />
      {isLoading && <Skeleton className="h-48 w-full" />}
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" data-testid="action-board-error">Action Board is temporarily unavailable.</p>}
      {data && <p className="text-sm text-slate-500" data-testid="action-board-excluded">{data.excludedWithoutBudgetGoal} customers excluded — no budget goal set.</p>}
      {data && data.rows.length === 0 && <p className="rounded-xl border border-dashed p-8 text-center text-slate-600" data-testid="action-board-empty">No customers have a budget goal for {months[month]} — set one on the customer profile.</p>}
      {(Object.keys(laneInfo) as Lane[]).map((lane) => {
        const info = laneInfo[lane]; const Icon = info.icon;
        return <section key={lane} className="rounded-xl border bg-white overflow-hidden" data-testid={`action-board-lane-${lane}`}><div className="p-4 bg-slate-50 border-b"><h2 className="font-bold flex items-center gap-2"><Icon className="w-4 h-4 text-blue-700" />{info.title} <span className="text-sm font-normal text-slate-500">({grouped[lane].length})</span></h2><p className="text-xs text-slate-500 mt-1">{info.subtitle}</p></div>{grouped[lane].length ? <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="text-[11px] uppercase tracking-wide text-slate-500"><th className="p-4">Customer · budget</th><th className="p-4">Open work orders</th><th className="p-4">Wet check</th><th className="p-4">{lane === "clear_to_send" ? "Do not exceed" : lane === "over_budget" ? "Headroom" : "Unused"}</th></tr></thead><tbody>{grouped[lane].map((row) => <Row key={row.customerId} row={row} />)}</tbody></table></div> : <p className="p-6 text-sm text-slate-400">No customers in this lane.</p>}</section>;
      })}
      {data && (
        <section className="rounded-xl border bg-white overflow-hidden" data-testid="action-board-plan">
          <div className="flex flex-wrap items-center gap-3 border-b bg-slate-50 px-4 py-3">
            <h2 className="font-semibold text-slate-900">Today's plan</h2>
            <span className="text-xs text-slate-500">Edit before copying; changes are not saved.</span>
            <div className="flex flex-wrap gap-2 sm:ml-auto">
              <button
                type="button"
                onClick={() => {
                  if (hasEdits && !window.confirm("Regenerate the plan and replace your edits?")) return;
                  setDraft({ selection, text: generatedPlan });
                  setCopyStatus("");
                }}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
                data-testid="button-regenerate-plan"
              >Regenerate (replaces edits)</button>
              <button type="button" onClick={handleCopyPlan}
                className="rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white"
                data-testid="button-copy-plan"
              >Copy today's plan</button>
            </div>
          </div>
          {copyStatus && <p className="px-4 pt-3 text-sm text-blue-700" role="status" data-testid="status-copy-plan">{copyStatus}</p>}
          <textarea
            ref={editorRef}
            aria-label="Today's plan text"
            data-testid="input-action-board-plan"
            value={planText}
            onChange={(event) => { setDraft({ selection, text: event.target.value }); setCopyStatus(""); }}
            spellCheck={false}
            className="block w-full min-h-[24rem] resize-y bg-white p-4 font-mono text-xs leading-relaxed text-slate-800 outline-none focus:ring-2 focus:ring-inset focus:ring-blue-600"
          />
        </section>
      )}
    </main>
  );
}