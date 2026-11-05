import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import QuickBooksPage from "./quickbooks";

vi.mock("@/components/quickbooks/quickbooks-integration", () => ({
  QuickBooksIntegration: () => <div>Connection controls</div>,
}));

function show(value?: { held: number; unlinked: number }, fail = false) {
  const client = new QueryClient({ defaultOptions: { queries: {
    retry: false, staleTime: Infinity,
    queryFn: () => fail ? Promise.reject(new Error("400: Company context is required.")) : new Promise(() => {}),
  } } });
  if (value) client.setQueryData(["/api/customer-review/summary"], value);
  render(<QueryClientProvider client={client}><QuickBooksPage /></QueryClientProvider>);
  return client;
}

describe("QuickBooks customer review entry", () => {
  it("appends counts and a wouter link without removing the existing cards", () => {
    show({ held: 2, unlinked: 3 });
    expect(screen.getByText("2 held by the sync · 3 not linked to QuickBooks")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open customer review" }).getAttribute("href")).toBe("/customer-review");
    for (const title of ["Connection Settings", "Integration Features", "How to Use QuickBooks Integration"]) {
      expect(screen.getByText(title)).toBeTruthy();
    }
  });
  it("shows zero counts as Nothing to review with no link", () => {
    show({ held: 0, unlinked: 0 });
    expect(screen.getByText("Nothing to review.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open customer review" })).toBeNull();
  });
  it("renders no review card while loading", () => {
    show();
    expect(screen.queryByText("Customer review")).toBeNull();
  });
  it("renders no review card after a no-company read failure", async () => {
    const client = show(undefined, true);
    await waitFor(() => expect(client.getQueryState(["/api/customer-review/summary"])?.status).toBe("error"));
    expect(screen.queryByText("Customer review")).toBeNull();
  });
});
