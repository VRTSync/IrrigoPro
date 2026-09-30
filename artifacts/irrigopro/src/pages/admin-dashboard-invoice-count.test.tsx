import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { id: 1, name: "Admin", companyId: 1, role: "admin" } }),
}));
vi.mock("@/components/financial-pulse/financial-pulse-widget", () => ({
  FinancialPulseWidget: () => null,
  useFinancialPulseData: () => ({ data: null, isLoading: false, isError: false }),
}));

import AdminDashboard from "./admin-dashboard";

describe("Admin Dashboard monthly invoice count", () => {
  it("uses the full server count on both surfaces, not the 25-row activity fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/invoices/this-month-count") {
        return new Response(JSON.stringify({ count: 31 }), { status: 200 });
      }
      if (url === "/api/invoices?limit=25") {
        return new Response(JSON.stringify(
          Array.from({ length: 25 }, (_, id) => ({
            id, invoiceNumber: `D-${id}`, customerName: "Draft", status: "draft",
            createdAt: new Date().toISOString(),
          })),
        ), { status: 200 });
      }
      if (url === "/api/dashboard/stats") {
        return new Response(JSON.stringify({ activeUsers: 1, openWorkOrders: 0, activeCustomers: 0 }), { status: 200 });
      }
      if (url.includes("/profile")) return new Response(JSON.stringify({ name: "Company" }), { status: 200 });
      return new Response("[]", { status: 200 });
    });
    try {
      const client = new QueryClient({ defaultOptions: { queries: {
        queryFn: getQueryFn({ on401: "throw" }), retry: false, refetchOnWindowFocus: false,
      } } });
      render(<QueryClientProvider client={client}><AdminDashboard /></QueryClientProvider>);
      await waitFor(() => expect(screen.getByTestId("kpi-invoices-month")).toHaveTextContent("31"));
      await waitFor(() => expect(screen.getByTestId("pipeline-invoices")).toHaveTextContent("31"));
      expect(fetchSpy).toHaveBeenCalledWith("/api/invoices?limit=25", expect.anything());
      expect(fetchSpy).toHaveBeenCalledWith("/api/invoices/this-month-count", expect.anything());
    } finally {
      fetchSpy.mockRestore();
    }
  });
});