import { and, eq } from "drizzle-orm";
import { customerBudgetMonths } from "@workspace/db/schema";
import { db } from "./db";
import { computeCustomerSpend } from "./budget-spend";
import { resolveWetCheckMode, type WetCheckMode } from "./routes/wet-check-create-gate";

function parseAmount(raw: unknown): number | null {
  if (raw == null) return null;
  const amount = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
  return Number.isFinite(amount) ? amount : null;
}

export type MonthlyWetCheckBudget = {
  allocation: number | null;
  spend: number;
  headroom: number | null;
};

/** Resolve the current-month budget using the customer's server-owned tenant. */
export async function resolveMonthlyWetCheckBudget(
  customerId: number,
  companyId: number,
  now = new Date(),
): Promise<MonthlyWetCheckBudget> {
  const window = {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
  };
  const [row] = await db
    .select({ amount: customerBudgetMonths.amount })
    .from(customerBudgetMonths)
    .where(and(
      eq(customerBudgetMonths.companyId, companyId),
      eq(customerBudgetMonths.customerId, customerId),
      eq(customerBudgetMonths.year, now.getFullYear()),
      eq(customerBudgetMonths.month, now.getMonth() + 1),
    ))
    .limit(1);
  const allocation = row ? parseAmount(row.amount) : null;
  if (allocation === null) return { allocation: null, spend: 0, headroom: null };
  const spend = (await computeCustomerSpend(customerId, companyId, window)).total;
  return { allocation, spend, headroom: allocation - spend };
}

export async function resolveWetCheckCreateMode(
  customerId: number,
  companyId: number,
  requestedMode: WetCheckMode,
  loadBudget: typeof resolveMonthlyWetCheckBudget = resolveMonthlyWetCheckBudget,
) {
  const budget = await loadBudget(customerId, companyId);
  const mode = resolveWetCheckMode(budget.headroom, requestedMode);
  return { ...budget, mode, forced: mode !== requestedMode };
}