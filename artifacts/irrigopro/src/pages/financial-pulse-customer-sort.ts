// Task #692 — Pure sort helpers for the Financial Pulse "By Customer"
// drill-down table. Extracted from `financial-pulse.tsx` so it can be
// unit-tested without React / DOM.

export type CustomerSortKey =
  | "name"
  | "revenue"
  | "monthlyUsedPct"
  | "annualUsedPct"
  | "avgDaysToPay"
  | "lastInvoiceAt";
export type SortDir = "asc" | "desc";

export interface SortableCustomer {
  name: string;
  revenue: number;
  monthlyUsedPct: number | null;
  annualUsedPct: number | null;
  avgDaysToPay: number | null;
  lastInvoiceAt: string | null;
}

export function compareCustomers<T extends SortableCustomer>(
  a: T,
  b: T,
  key: CustomerSortKey,
  dir: SortDir,
): number {
  const mult = dir === "desc" ? -1 : 1;
  const nullLast = (av: unknown, bv: unknown): number | null => {
    const an = av == null;
    const bn = bv == null;
    if (an && bn) return 0;
    if (an) return 1; // nulls always last regardless of dir
    if (bn) return -1;
    return null;
  };
  switch (key) {
    case "name":
      return a.name.localeCompare(b.name) * mult;
    case "revenue":
      return (a.revenue - b.revenue) * mult;
    case "monthlyUsedPct": {
      const r = nullLast(a.monthlyUsedPct, b.monthlyUsedPct);
      if (r != null) return r;
      return ((a.monthlyUsedPct ?? 0) - (b.monthlyUsedPct ?? 0)) * mult;
    }
    case "annualUsedPct": {
      const r = nullLast(a.annualUsedPct, b.annualUsedPct);
      if (r != null) return r;
      return ((a.annualUsedPct ?? 0) - (b.annualUsedPct ?? 0)) * mult;
    }
    case "avgDaysToPay": {
      const r = nullLast(a.avgDaysToPay, b.avgDaysToPay);
      if (r != null) return r;
      return ((a.avgDaysToPay ?? 0) - (b.avgDaysToPay ?? 0)) * mult;
    }
    case "lastInvoiceAt": {
      const r = nullLast(a.lastInvoiceAt, b.lastInvoiceAt);
      if (r != null) return r;
      const ad = new Date(a.lastInvoiceAt as string).getTime();
      const bd = new Date(b.lastInvoiceAt as string).getTime();
      return (ad - bd) * mult;
    }
  }
}

export function sortCustomers<T extends SortableCustomer>(
  rows: T[],
  key: CustomerSortKey,
  dir: SortDir,
): T[] {
  const copy = [...rows];
  copy.sort((a, b) => compareCustomers(a, b, key, dir));
  return copy;
}
