/**
 * admin-wet-checks-auth.test.tsx — rewired to WetChecksListPage (Slice 7)
 *
 * Task #555 regression: a 401 from the list endpoint must NOT render
 * "Authentication required" or "Failed to load wet checks" in the UI.
 * The page degrades silently and redirects to /login.
 *
 * The static guard (no un-escaped apiRequest in queryFn) now targets
 * WetChecksListPage instead of the deleted admin-wet-checks.tsx.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("wouter", async () => {
  const actual = await vi.importActual<typeof import("wouter")>("wouter");
  return {
    ...actual,
    useLocation: () => ["/wet-checks", vi.fn()],
    Link: ({ href, children }: any) => <a href={href}>{children}</a>,
  };
});

const mockGetCurrentUser = vi.fn();
vi.mock("./wet-checks/helpers", () => ({
  getCurrentUser: () => mockGetCurrentUser(),
}));

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>(
    "@/lib/queryClient",
  );
  return {
    ...actual,
    apiRequest: vi.fn(async () => {
      throw new Error('401: {"message":"Authentication required"}');
    }),
  };
});

import WetChecksListPage from "./wet-checks/WetChecksListPage";

describe("WetChecksListPage — 401 degradation (Slice 7, Task #555 regression)", () => {
  let originalLocation: Location;
  beforeEach(() => {
    mockGetCurrentUser.mockReturnValue({ id: 1, role: "company_admin" });
    window.localStorage.clear();
    originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...originalLocation, href: "/wet-checks" } as Location,
    });
  });
  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
    vi.clearAllMocks();
  });

  it("does not render 'Authentication required' when the list endpoint returns 401", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    render(
      <QueryClientProvider client={qc}>
        <WetChecksListPage />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("page-wet-checks-list")).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.queryByText(/Authentication required/i)).toBeNull();
      expect(screen.queryByText(/Failed to load wet checks/i)).toBeNull();
    });
    await waitFor(() => {
      expect(window.location.href).toBe("/login");
    });
  });

  it("WetChecksListPage ships 401 escape hatch in its queryFn (static guard)", () => {
    const file = fs.readFileSync(
      path.resolve(__dirname, "wet-checks/WetChecksListPage.tsx"),
      "utf8",
    );
    if (/queryFn:\s*async/.test(file)) {
      expect(
        /\/\^401:\//.test(file),
        "WetChecksListPage.tsx ships a custom queryFn but is missing the 401 returnNull escape hatch (look for `/^401:/`).",
      ).toBe(true);
    }
  });
});
