import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { navForRole } from "./nav-config";
import { NAV_PIN_LIMIT, navPinsKey, useNavPins } from "./nav-pins";

const companyAdmin = "company_admin";
beforeEach(() => localStorage.clear());

describe("device-local navigation pins", () => {
  it("round-trips in insertion order, and removes a toggled pin", () => {
    const first = renderHook(() => useNavPins(7, companyAdmin));
    act(() => {
      first.result.current.toggle("invoices");
      first.result.current.toggle("work-orders");
    });
    expect(localStorage.getItem(navPinsKey(7))).toBe('["invoices","work-orders"]');
    first.unmount();

    const second = renderHook(() => useNavPins(7, companyAdmin));
    expect(second.result.current.pinnedIds).toEqual(["invoices", "work-orders"]);
    expect(second.result.current.isPinned("work-orders")).toBe(true);
    act(() => second.result.current.toggle("invoices"));
    expect(localStorage.getItem(navPinsKey(7))).toBe('["work-orders"]');
  });

  it.each(["not-json", '{"invoices":true}', "null"])("ignores invalid storage: %s", (stored) => {
    localStorage.setItem(navPinsKey(7), stored);
    const { result } = renderHook(() => useNavPins(7, companyAdmin));
    expect(result.current.pinnedIds).toEqual([]);
  });

  it("filters inaccessible, duplicate and unknown ids while keeping stored order", () => {
    localStorage.setItem(navPinsKey(7), JSON.stringify(["customers", "work-orders", "invoices", "invoices", "obsolete"]));
    const { result } = renderHook(() => useNavPins(7, "bookkeeper"));
    expect(result.current.pinnedIds).toEqual(["customers", "invoices"]);
    act(() => result.current.toggle("work-orders"));
    expect(result.current.pinnedIds).toEqual(["customers", "invoices"]);
  });

  it("refuses a ninth pin even when several updates are batched", () => {
    const ids = navForRole(companyAdmin).flatMap(({ pages }) => pages.map(({ id }) => id)).filter((id) => id !== "dashboard");
    const { result } = renderHook(() => useNavPins(7, companyAdmin));
    act(() => ids.slice(0, NAV_PIN_LIMIT + 1).forEach((id) => result.current.toggle(id)));
    expect(result.current.pinnedIds).toEqual(ids.slice(0, NAV_PIN_LIMIT));
    expect(result.current.atLimit).toBe(true);
    act(() => result.current.toggle(ids[0]));
    expect(result.current.atLimit).toBe(false);
  });

  it("separates accounts and makes toggling a no-op without a user id", () => {
    localStorage.setItem(navPinsKey(7), '["work-orders"]');
    localStorage.setItem(navPinsKey(8), '["invoices"]');
    const { result, rerender } = renderHook(
      ({ userId }: { userId?: number }) => useNavPins(userId, companyAdmin),
      { initialProps: { userId: 7 } },
    );
    expect(result.current.pinnedIds).toEqual(["work-orders"]);
    rerender({ userId: 8 });
    expect(result.current.pinnedIds).toEqual(["invoices"]);
    rerender({ userId: undefined });
    act(() => result.current.toggle("customers"));
    expect(result.current.pinnedIds).toEqual([]);
    expect(localStorage.length).toBe(2);
  });
});
