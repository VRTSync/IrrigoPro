import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getQueryFn } from "@/lib/queryClient";
import AdminClientErrorsPage from "./admin-client-errors";

const reportUrl = "/api/admin/client-errors";

function renderPage(role: string) {
  localStorage.setItem("user", JSON.stringify({ role }));
  const client = new QueryClient({
    defaultOptions: { queries: { queryFn: getQueryFn({ on401: "returnNull" }), retry: false } },
  });
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({ windowDays: 30, total: 0, groups: [] }),
  );
  render(
    <QueryClientProvider client={client}>
      <AdminClientErrorsPage />
    </QueryClientProvider>,
  );
  return fetchMock;
}

afterEach(() => {
  cleanup();
  localStorage.removeItem("user");
  vi.restoreAllMocks();
});

describe("Crash reports access", () => {
  it("shows company admins the forbidden state without fetching reports", () => {
    const fetchMock = renderPage("company_admin");

    expect(screen.getByRole("heading", { name: "Admin access required" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(reportUrl, expect.anything());
  });

  it("fetches and displays the report for super admins", async () => {
    const fetchMock = renderPage("super_admin");

    expect(await screen.findByText("No crash reports in the last 30 days.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(reportUrl, expect.anything());
  });

  it("does not register the crash reports route for company admins", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/company-admin-app.tsx"), "utf8");

    expect(source).not.toContain('"/admin/client-errors"');
  });
});
