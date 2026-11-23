import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "@/lib/queryClient";
import { CombinedReviewSurface } from "./CombinedReviewSurface";

vi.mock("@/lib/queryClient", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/queryClient")>(),
  apiRequest: vi.fn(),
}));

// The estimate editor and triage wizard are not exercised by this mount test.
vi.mock("@/components/estimates/estimate-detail-modal", () => ({ EstimateDetailModal: () => null }));
vi.mock("@/components/manager/wet-check-wizard", () => ({ WetCheckWizard: () => null }));

const wetCheckUrl = "/api/wet-checks/7";
const estimateUrl = `${wetCheckUrl}/inspection-estimate`;
const buildUrl = `${wetCheckUrl}/build-inspection-estimate`;
const estimate = {
  id: 42,
  estimateNumber: "EST-0042",
  originWetCheckId: 7,
  internalStatus: "pending_approval",
  items: [],
  totalAmount: "25.00",
};
const mockRequest = vi.mocked(apiRequest);

function openReview(mode: "inspection" | "service", existingEstimate: typeof estimate | null = null) {
  let completeBuild!: (value: typeof estimate) => void;
  const buildResult = new Promise<typeof estimate>((resolve) => { completeBuild = resolve; });
  mockRequest.mockImplementation(async (url, method = "GET") => {
    if (url === wetCheckUrl && method === "GET") {
      return { id: 7, customerName: "Test Customer", mode, status: "submitted", zoneRecords: [] };
    }
    if (url === estimateUrl && method === "GET") return { estimate: existingEstimate };
    if (url === buildUrl && method === "POST") return buildResult;
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { queryFn: async () => [], retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(["/api/estimates"], []);
  render(
    <QueryClientProvider client={queryClient}>
      <CombinedReviewSurface wetCheckId={7} />
    </QueryClientProvider>,
  );
  return { queryClient, completeBuild };
}

function writes() {
  return mockRequest.mock.calls.filter(([, method = "GET"]) => method !== "GET");
}

describe("opening wet-check review", () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  it("reads without writing, then builds once on click and displays the result", async () => {
    const { queryClient, completeBuild } = openReview("inspection");
    const panel = await screen.findByTestId("crs-inspection-no-estimate");
    expect(panel).toHaveTextContent("No estimate has been built from this inspection yet.");
    expect(mockRequest).toHaveBeenCalledWith(estimateUrl, "GET");
    expect(writes()).toEqual([]);

    const button = screen.getByTestId("crs-inspection-build-estimate");
    expect(button).toHaveTextContent("Build estimate");
    fireEvent.click(button);
    expect(await screen.findByRole("button", { name: "Building..." })).toBeDisabled();
    expect(writes()).toEqual([[buildUrl, "POST", {}]]);

    completeBuild(estimate);
    expect(await screen.findByText("EST-0042")).toBeVisible();
    expect(screen.queryByTestId("crs-inspection-no-estimate")).not.toBeInTheDocument();
    expect(screen.getByTestId("crs-inspection-approve-button")).toBeVisible();
    expect(screen.getByTestId("crs-inspection-edit-estimate-button")).toBeVisible();
    expect(queryClient.getQueryState(["/api/estimates"])?.isInvalidated).toBe(true);
    expect(mockRequest.mock.calls.filter(([url]) => url === estimateUrl)).toEqual([[estimateUrl, "GET"]]);
    expect(writes()).toEqual([[buildUrl, "POST", {}]]);
  });

  it("shows an existing estimate without building it", async () => {
    openReview("inspection", estimate);
    expect(await screen.findByText("EST-0042")).toBeVisible();
    expect(screen.queryByTestId("crs-inspection-build-estimate")).not.toBeInTheDocument();
    expect(writes()).toEqual([]);
  });

  it("does not request either inspection endpoint for service mode", async () => {
    openReview("service");
    expect(await screen.findByTestId("crs-snapshot-card")).toBeVisible();
    expect(mockRequest.mock.calls.some(([url]) => url === estimateUrl || url === buildUrl)).toBe(false);
  });
});
