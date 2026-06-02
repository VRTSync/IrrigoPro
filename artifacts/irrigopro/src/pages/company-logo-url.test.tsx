// Regression tests — company logo display routes through the public
// /api/company-logo/:id endpoint, not a raw object-storage URL.
//
// Both Navigation and CompanyLogoBanner derive their logo src via a
// useMemo that extracts the company-logos/<id> segment and rewrites
// it to `/api/company-logo/<id>`.  A future refactor that reverts
// either component to pointing directly at the raw storage URL would
// break the img load for customers whose storage bucket is not
// publicly accessible.  These tests lock that down.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Shared mocks — must be hoisted before any component imports
// ---------------------------------------------------------------------------

const safeStorageState: Record<string, string | null> = {};
vi.mock("@/utils/safeStorage", () => ({
  safeGet: (k: string) => safeStorageState[k] ?? null,
  safeSet: vi.fn(),
  safeRemove: vi.fn(),
}));

// apiRequest is used by Navigation's company profile queryFn.
// We expose it as a configurable mock so individual tests can
// control what it returns for the company profile URL.
const mockApiRequest = vi.fn(async (_url: string) => ({}));
vi.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  adaptiveRefetchInterval: (ms: number) => ms,
  clearSessionAndLogout: vi.fn(),
  getQueryFn: vi.fn(() => async () => null),
  queryClient: {
    removeQueries: vi.fn(),
    setQueryData: vi.fn(),
    getQueryData: vi.fn(() => null),
  },
  markUnauthenticatedRead: vi.fn(),
  clearUnauthenticatedRead: vi.fn(),
  useUnauthenticatedReads: vi.fn(() => false),
  useArrayQuery: vi.fn(),
  asArray: (v: unknown) => (Array.isArray(v) ? v : []),
}));

vi.mock("@/components/notifications/notification-system", () => ({
  NotificationSystem: () => null,
}));

vi.mock("@/components/offline/sync-ui", () => ({
  OfflineStrip: () => null,
  OfflineSyncUI: () => null,
}));

// Silence console.error noise from components with missing context.
vi.spyOn(console, "error").mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Navigation component
// ---------------------------------------------------------------------------
// Navigation queries the company profile with staleTime: 0 and
// refetchOnMount: true, so it ALWAYS fires apiRequest on mount.
// We configure the mock to return the profile data for the right URL
// and assert the img src is the rewritten /api/company-logo/:id value.

describe("Navigation — logoApiUrl routes through /api/company-logo/:id", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
    // Default: return an empty profile so unrelated queries don't blow up.
    mockApiRequest.mockResolvedValue({});
  });

  it("renders <img src=/api/company-logo/…> when logo is in company-logos/<id> format", async () => {
    const COMPANY_ID = 42;
    const LOGO_KEY = "abc123.png";
    const rawLogo = `company-logos/${LOGO_KEY}`;

    safeStorageState.user = JSON.stringify({
      id: 1,
      companyId: COMPANY_ID,
      role: "company_admin",
    });

    // Return the company profile with logo when Navigation fetches it.
    mockApiRequest.mockImplementation(async (url: string) => {
      if (url === `/api/company/${COMPANY_ID}/profile`) {
        return { id: COMPANY_ID, name: "Acme Irrigation", logo: rawLogo };
      }
      return {};
    });

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // Seed badge queries so the other useQuery calls resolve immediately.
    qc.setQueryData(["/api/parts/pending-approval"], []);
    qc.setQueryData(["/api/manual-part-reviews"], []);
    qc.setQueryData(["/api/estimates/pending-approval"], []);

    const { Router } = await import("wouter");
    const { memoryLocation } = await import("wouter/memory-location");
    const { hook } = memoryLocation({ path: "/" });
    const Navigation = (await import("@/components/layout/navigation")).default;

    render(
      <QueryClientProvider client={qc}>
        <Router hook={hook}>
          <Navigation />
        </Router>
      </QueryClientProvider>,
    );

    // Wait for the company logo banner img to appear.
    await waitFor(() => {
      const imgs = screen
        .getAllByRole("img")
        .filter((el) => el.getAttribute("alt") === "Company Logo");
      expect(imgs.length).toBeGreaterThan(0);
    });

    const logoImgs = screen
      .getAllByRole("img")
      .filter((el) => el.getAttribute("alt") === "Company Logo");

    for (const img of logoImgs) {
      const src = img.getAttribute("src");
      // Must route through the public API endpoint.
      expect(src).toBe(`/api/company-logo/${LOGO_KEY}`);
      // Must NOT expose the raw object-storage path.
      expect(src).not.toContain("company-logos/");
    }
  });

  it("does not render a company logo img when the profile has no logo", async () => {
    const COMPANY_ID = 43;

    safeStorageState.user = JSON.stringify({
      id: 2,
      companyId: COMPANY_ID,
      role: "company_admin",
    });

    // Profile returns an empty logo.
    mockApiRequest.mockImplementation(async (url: string) => {
      if (url === `/api/company/${COMPANY_ID}/profile`) {
        return { id: COMPANY_ID, name: "No Logo Co", logo: "" };
      }
      return {};
    });

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    qc.setQueryData(["/api/parts/pending-approval"], []);
    qc.setQueryData(["/api/manual-part-reviews"], []);
    qc.setQueryData(["/api/estimates/pending-approval"], []);

    const { Router } = await import("wouter");
    const { memoryLocation } = await import("wouter/memory-location");
    const { hook } = memoryLocation({ path: "/" });
    const Navigation = (await import("@/components/layout/navigation")).default;

    render(
      <QueryClientProvider client={qc}>
        <Router hook={hook}>
          <Navigation />
        </Router>
      </QueryClientProvider>,
    );

    // Allow the profile query to settle.
    await waitFor(() => {
      expect(
        mockApiRequest.mock.calls.some(([url]) =>
          (url as string).includes(`/api/company/${COMPANY_ID}/profile`),
        ),
      ).toBe(true);
    });

    // Extra tick so any re-renders triggered by the resolved query flush.
    await new Promise((r) => setTimeout(r, 20));

    const logoImgs = screen
      .queryAllByRole("img")
      .filter((el) => el.getAttribute("alt") === "Company Logo");

    expect(logoImgs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// CompanyLogoBanner component
// ---------------------------------------------------------------------------
// CompanyLogoBanner uses the default queryFn (no custom queryFn on the
// useQuery call) with staleTime: 60000.  Pre-seeding the QueryClient
// satisfies the query without any fetch — as long as we don't use
// gcTime: 0 which would GC the data before the useEffect subscribes.

describe("CompanyLogoBanner — logoApiUrl routes through /api/company-logo/:id", () => {
  it("renders <img src=/api/company-logo/…> when logo is in company-logos/<id> format", async () => {
    const COMPANY_ID = 7;
    const LOGO_KEY = "logo-file-xyz.jpg";
    const rawLogo = `company-logos/${LOGO_KEY}`;

    safeStorageState.user = JSON.stringify({
      id: 10,
      companyId: COMPANY_ID,
      role: "company_admin",
    });

    // Use default gcTime (5 min) so the seeded entry survives until the
    // useEffect fires and the component subscribes to the query key.
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    qc.setQueryData([`/api/company/${COMPANY_ID}/profile`], {
      id: COMPANY_ID,
      name: "Sprinkler Co",
      logo: rawLogo,
    });

    const { CompanyLogoBanner } = await import(
      "@/components/ui/company-logo-banner"
    );

    render(
      <QueryClientProvider client={qc}>
        <CompanyLogoBanner />
      </QueryClientProvider>,
    );

    // CompanyLogoBanner reads the user via useEffect, so the query key
    // only becomes active after the first render.  Wait for the img.
    await waitFor(
      () => {
        const imgs = screen.queryAllByRole("img");
        expect(imgs.length).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );

    const imgs = screen.getAllByRole("img");
    expect(imgs).toHaveLength(1);

    const src = imgs[0].getAttribute("src");
    // Must route through the public API endpoint.
    expect(src).toBe(`/api/company-logo/${LOGO_KEY}`);
    // Must NOT expose the raw object-storage path.
    expect(src).not.toContain("company-logos/");
  });

  it("shows the upload prompt when the logo field is absent", async () => {
    const COMPANY_ID = 8;

    safeStorageState.user = JSON.stringify({
      id: 11,
      companyId: COMPANY_ID,
      role: "company_admin",
    });

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    qc.setQueryData([`/api/company/${COMPANY_ID}/profile`], {
      id: COMPANY_ID,
      name: "No Logo Co",
      logo: null,
    });

    const { CompanyLogoBanner } = await import(
      "@/components/ui/company-logo-banner"
    );

    render(
      <QueryClientProvider client={qc}>
        <CompanyLogoBanner />
      </QueryClientProvider>,
    );

    // The no-logo fallback copy should appear.
    await waitFor(() => {
      expect(screen.queryByText(/Upload company logo/i)).toBeTruthy();
    });

    // No logo img should be present.
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });
});
