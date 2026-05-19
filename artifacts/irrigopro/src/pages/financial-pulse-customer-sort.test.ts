// Task #692 — Unit tests for the Financial Pulse "By Customer" sort.

import { describe, it, expect } from "vitest";
import {
  compareCustomers,
  sortCustomers,
  type SortableCustomer,
} from "./financial-pulse-customer-sort";

const A: SortableCustomer = {
  name: "Alpha",
  revenue: 1000,
  monthlyUsedPct: 0.25,
  annualUsedPct: 0.10,
  avgDaysToPay: 14,
  lastInvoiceAt: "2026-05-15T00:00:00Z",
};
const B: SortableCustomer = {
  name: "Bravo",
  revenue: 5000,
  monthlyUsedPct: 0.95,
  annualUsedPct: 0.40,
  avgDaysToPay: 30,
  lastInvoiceAt: "2026-05-18T00:00:00Z",
};
const C: SortableCustomer = {
  name: "Charlie",
  revenue: 300,
  monthlyUsedPct: null,
  annualUsedPct: null,
  avgDaysToPay: null,
  lastInvoiceAt: null,
};

describe("compareCustomers", () => {
  it("sorts revenue desc by default", () => {
    const out = sortCustomers([A, B, C], "revenue", "desc");
    expect(out.map((r) => r.name)).toEqual(["Bravo", "Alpha", "Charlie"]);
  });

  it("revenue asc reverses", () => {
    const out = sortCustomers([A, B, C], "revenue", "asc");
    expect(out.map((r) => r.name)).toEqual(["Charlie", "Alpha", "Bravo"]);
  });

  it("name sort is case-insensitive lexicographic", () => {
    const out = sortCustomers([B, A, C], "name", "asc");
    expect(out.map((r) => r.name)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("monthlyUsedPct desc places nulls last", () => {
    const out = sortCustomers([A, C, B], "monthlyUsedPct", "desc");
    expect(out.map((r) => r.name)).toEqual(["Bravo", "Alpha", "Charlie"]);
  });

  it("monthlyUsedPct asc also places nulls last", () => {
    const out = sortCustomers([B, A, C], "monthlyUsedPct", "asc");
    expect(out.map((r) => r.name)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("avgDaysToPay asc places nulls last", () => {
    const out = sortCustomers([C, B, A], "avgDaysToPay", "asc");
    expect(out.map((r) => r.name)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("lastInvoiceAt desc places nulls last and compares dates", () => {
    const out = sortCustomers([A, C, B], "lastInvoiceAt", "desc");
    expect(out.map((r) => r.name)).toEqual(["Bravo", "Alpha", "Charlie"]);
  });

  it("annualUsedPct desc places nulls last", () => {
    const out = sortCustomers([C, A, B], "annualUsedPct", "desc");
    expect(out.map((r) => r.name)).toEqual(["Bravo", "Alpha", "Charlie"]);
  });

  it("is pure — does not mutate the input array", () => {
    const input = [A, B, C];
    sortCustomers(input, "revenue", "asc");
    expect(input.map((r) => r.name)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("compareCustomers returns sign convention compatible with Array#sort", () => {
    // desc: bigger revenue comes first → compare(a,b) < 0 when a.revenue > b.revenue
    expect(compareCustomers(B, A, "revenue", "desc")).toBeLessThan(0);
    expect(compareCustomers(A, B, "revenue", "desc")).toBeGreaterThan(0);
  });
});
