import {
  classifyBudgetPercent,
  type BudgetStatus,
} from "@workspace/shared/budget-status";
import { generateActionBoardPlan } from "@workspace/shared/action-board-plan";

export const ACTION_BOARD_ROLES = new Set([
  "irrigation_manager",
  "company_admin",
  "super_admin",
]);

export type ActionBoardLane = "clear_to_send" | "over_budget_nothing_approved" | "nothing_pending";

export type ActionBoardRow = {
  customerId: number;
  customerName: string;
  allocation: number | null;
  doNotExceed?: number | null;
  headroom: number | null;
  totalSpend: number;
  softThresholdPercent: number;
  hardThresholdPercent: number;
  openWorkOrders: Array<{ id?: number | string; number?: string | null; workOrderNumber?: string | null; preApproved?: boolean }>;
  wetCheck: { startedAt?: string | null; status?: string } | null;
  wetCheckDue: boolean;
  lane: ActionBoardLane;
  inspectionOnly: boolean;
};

export type ActionBoardResponse = {
  year: number;
  month: number;
  excludedWithoutBudgetGoal: number;
  rollup: { seasonPaceTarget: number; seasonPaceSpend: number };
  rows: ActionBoardRow[];
};

export type BoardViewState =
  | "ready"
  | "no-allocations"
  | "offline-no-cache"
  | "error"
  | "empty";

export function canViewActionBoard(role: string | null | undefined): boolean {
  return !!role && ACTION_BOARD_ROLES.has(role);
}

export function groupActionBoardRows(rows: ActionBoardRow[]) {
  return {
    clear_to_send: rows.filter((row) => row.lane === "clear_to_send"),
    over_budget_nothing_approved: rows.filter((row) => row.lane === "over_budget_nothing_approved"),
    nothing_pending: rows.filter((row) => row.lane === "nothing_pending"),
  };
}

export function formatCurrency(amount: number | null): string {
  if (amount == null) return "Not set";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDoNotExceed(amount: number | null): string {
  return amount == null ? "DNE not set" : `DNE ${formatCurrency(amount)}`;
}

export function formatWorkOrders(row: ActionBoardRow): string {
  if (row.openWorkOrders.length === 0) return "No open work orders";
  const numbers = row.openWorkOrders.map((workOrder) =>
    workOrder.number ?? workOrder.workOrderNumber ?? `WO-${workOrder.id ?? "—"}`,
  );
  return `${numbers.length} open · ${numbers.join(", ")}`;
}

export function formatWetCheck(row: ActionBoardRow): string {
  const startedAt = row.wetCheck?.startedAt;
  const ageDays = startedAt ? Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 86_400_000)) : null;
  const age = ageDays != null && Number.isFinite(ageDays) ? ` · ${ageDays} ${ageDays === 1 ? "day" : "days"}` : "";
  if (row.wetCheckDue) return `${row.inspectionOnly ? "Due — inspection only" : "Wet check due"}${age}`;
  return `Wet check done${age}`;
}

export function budgetStatus(row: ActionBoardRow): BudgetStatus {
  const ratio =
    row.allocation != null && row.allocation > 0
      ? row.totalSpend / row.allocation
      : null;
  return classifyBudgetPercent(
    ratio,
    row.softThresholdPercent,
    row.hardThresholdPercent,
  );
}

export function resolveBoardViewState(input: {
  data: ActionBoardResponse | undefined;
  online: boolean;
  isError: boolean;
}): BoardViewState {
  if (!input.data && !input.online) return "offline-no-cache";
  if (!input.data && input.isError) return "error";
  if (!input.data) return "empty";
  if (input.data.rows.length === 0 && input.data.excludedWithoutBudgetGoal > 0) {
    return "no-allocations";
  }
  if (input.data.rows.length === 0) return "empty";
  return "ready";
}

export function summaryForBoard(rows: ActionBoardRow[]) {
  const grouped = groupActionBoardRows(rows);
  const checksDue = rows.filter((row) => row.wetCheckDue).length;
  const inspectionOnly = rows.filter((row) => row.inspectionOnly).length;
  return {
    total: rows.length,
    clear: grouped.clear_to_send.length,
    blocked: grouped.over_budget_nothing_approved.length,
    idle: grouped.nothing_pending.length,
    checksDue,
    inspectionOnly,
  };
}

export function planTextForBoard(board: ActionBoardResponse): string {
  return generateActionBoardPlan(board.rows, new Date());
}

/** The returned function is installed as the button's onPress handler. */
export function createCopyPlanPressHandler(
  text: string,
  writeText: (text: string) => Promise<boolean | void>,
  onSuccess: () => void,
  onError: () => void,
): () => Promise<void> {
  return async () => {
    try {
      const copied = await writeText(text);
      if (copied === false) throw new Error("Clipboard write failed");
      onSuccess();
    } catch {
      onError();
    }
  };
}