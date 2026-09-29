import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WetCheckModeSelectorPage from "./WetCheckModeSelectorPage";

const navigate = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/wet-checks/new", navigate],
}));

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <WetCheckModeSelectorPage />
    </QueryClientProvider>,
  );
}

describe("WetCheckModeSelectorPage over-budget notice", () => {
  beforeEach(() => {
    navigate.mockReset();
    sessionStorage.clear();
    sessionStorage.setItem("wc_pending_customer_id", "42");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      mode: "inspection",
      forcedByBudget: true,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
  });

  it("warns before start, prevents service, and stashes inspection mode", async () => {
    renderPage();

    expect(await screen.findByTestId("over-budget-inspection-notice")).toHaveTextContent(
      "Document issues, do not make repairs",
    );
    expect(screen.getByTestId("mode-btn-service")).toBeDisabled();
    expect(screen.getByTestId("mode-btn-inspection")).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByTestId("mode-continue-btn"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/wet-checks/c/42/new"));
    expect(sessionStorage.getItem("wc_pending_mode")).toBe("inspection");
  });
});