// Task #555 — regression for the irrigation manager landing on
// /wet-checks/admin and seeing a red "Authentication required" card in
// place of the wet-checks list. Two angles are covered here:
//
//  1. A 401 from the list endpoint must NOT render the
//     "Authentication required" / "Failed to load wet checks" card.
//     Instead the page degrades like every other list (silently empty)
//     and routes the user through the normal re-login flow. This is
//     the same returnNull contract the rest of the app uses.
//  2. A static guard against the previous regression: the page must
//     not ship a custom queryFn that calls `apiRequest` without a 401
//     escape hatch — otherwise the raw server message would leak back
//     into the UI on a transient session lapse.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/utils/safeStorage", () => ({ safeGet: () => null }));

// Stub `apiRequest` to throw the exact `${status}: ${json}` shape the
// real fetch wrapper produces on a 401 — mirroring the production
// crash payload. Keep `asArray`, `parseApiError`, and `queryClient`
// from the real module so the page logic is otherwise untouched.
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

import AdminWetChecksPage from "./admin-wet-checks";

describe("Task #555 — admin wet checks page degrades on 401", () => {
  let originalLocation: Location;
  beforeEach(() => {
    originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...originalLocation, href: "/wet-checks/admin" } as Location,
    });
  });
  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it("does not render an 'Authentication required' card when the list endpoint returns 401", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    render(
      <QueryClientProvider client={qc}>
        <AdminWetChecksPage />
      </QueryClientProvider>,
    );
    // Wait for the query to settle so the page picks a render branch.
    await waitFor(() => {
      expect(screen.getByTestId("page-admin-wet-checks")).toBeTruthy();
    });
    // The exact regression: the red card from `parseApiError(error,
    // "Failed to load wet checks.")` rendering "Authentication
    // required" verbatim must NOT appear, and neither should the
    // generic fallback that the previous version of this page would
    // surface on the same 401.
    await waitFor(() => {
      expect(screen.queryByText(/Authentication required/i)).toBeNull();
      expect(screen.queryByText(/Failed to load wet checks/i)).toBeNull();
    });
    // The re-login redirect should have been kicked off by the
    // useEffect that watches for `data === null`.
    await waitFor(() => {
      expect(window.location.href).toBe("/login");
    });
  });

  it("does not call apiRequest from a queryFn without a 401 escape hatch (static guard)", () => {
    const file = fs.readFileSync(
      path.resolve(__dirname, "admin-wet-checks.tsx"),
      "utf8",
    );
    // The previous regression was a queryFn that did
    // `return await apiRequest(url, "GET")` with no try/catch — any
    // 401 thrown by apiRequest would land in `isError` and the page
    // would render the server's "Authentication required" message
    // verbatim. Make sure the queryFn either has a try/catch around
    // apiRequest OR the file doesn't ship a queryFn at all.
    if (/queryFn:\s*async/.test(file)) {
      expect(
        /\/\^401:\//.test(file),
        "admin-wet-checks.tsx ships a custom queryFn but is missing the 401 returnNull escape hatch (look for `/^401:/`).",
      ).toBe(true);
    }
  });
});
