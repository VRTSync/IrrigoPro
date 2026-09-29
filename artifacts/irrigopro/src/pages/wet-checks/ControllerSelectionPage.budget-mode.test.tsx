import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ControllerSelectionPage } from "./ControllerSelectionPage";

const navigate = vi.fn();
vi.mock("wouter", () => ({ useLocation: () => ["/wet-checks/c/42/new", navigate] }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ControllerSelectionPage customerId={42} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  navigate.mockReset();
});

describe("controller selection budget notice", () => {
  it("warns and posts inspection even when the stashed mode is unavailable", async () => {
    const posts: unknown[] = [];
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
      const path = String(url);
      let body: unknown = [];
      if (path === "/api/customers/42") body = { id: 42, name: "HOA", address: "1 Main" };
      if (path.endsWith("/create-mode")) body = { mode: "inspection", forcedByBudget: true };
      if (options?.method === "POST" && path === "/api/wet-checks") {
        posts.push(JSON.parse(String(options.body)));
        body = { id: 900, mode: "inspection" };
      }
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    renderPage();
    expect(await screen.findByTestId("over-budget-inspection-notice")).toHaveTextContent("do not make repairs");
    const start = screen.getByTestId("btn-blank-start");
    await waitFor(() => expect(start).toBeEnabled());
    await userEvent.click(start);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ customerId: 42, blankStart: true, mode: "inspection" });
  });

  it("blocks blank start when the mode check fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = String(url);
      if (path.endsWith("/create-mode")) {
        return new Response(JSON.stringify({ message: "Unavailable" }), { status: 503, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify(path === "/api/customers/42" ? { id: 42, name: "HOA" } : []), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Retry before starting");
    expect(screen.getByTestId("btn-blank-start")).toBeDisabled();
  });
});