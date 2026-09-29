import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const configs = [{
  id: 1, issueType: "head_replacement", issueGroup: "quick_fix",
  displayLabel: "Head replacement", defaultLaborHours: "0.25", laborOnly: true,
  isActive: true,
}];
vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  authedPhotoSrc: (u: string) => u,
  asArray: (v: unknown) => Array.isArray(v) ? v : [],
  useArrayQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === "/api/wet-checks/issue-types" ? configs : [],
    isLoading: false, isError: false, isSuccess: true, error: null, refetch: vi.fn(),
  }),
  queryClient: { invalidateQueries: vi.fn(), cancelQueries: vi.fn(), getQueryData: vi.fn(), setQueryData: vi.fn() },
}));
vi.mock("@/lib/offline/engine", () => ({ isOfflineQueueEnabled: () => false }));
vi.mock("@/lib/offline/api", () => ({
  cachedApiRequest: vi.fn(async () => []),
  isProbablyOffline: () => false,
  isOfflinePhotosEnabled: () => false,
  ensurePersistentStorage: vi.fn(),
  queuePhotoUpload: vi.fn(),
  createWetCheck: vi.fn(),
  submitWetCheck: vi.fn(),
  upsertZoneRecord: vi.fn(),
  createFinding: vi.fn(),
  updateFinding: vi.fn(),
  deleteFinding: vi.fn(),
  enqueueZoneRevertCascade: vi.fn(),
  linkPhotoToFinding: vi.fn(),
  warmWetCheckMirror: vi.fn(),
  readWetCheckFromMirror: vi.fn(),
  readWetCheckByClientId: vi.fn(),
}));
vi.mock("@/lib/photo-prep", () => ({ preparePhotoForUpload: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/utils/safeStorage", () => ({ safeGet: () => null }));
vi.mock("@/components/offline/sync-ui", () => ({ OfflineStrip: () => null, OfflineSyncUI: () => null }));

import { ZoneScreen } from "./ZoneScreen";

function mount(mode: "service" | "inspection", findings: any[] = []) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: async () => ({ enabled: true }) } } })}>
      <ZoneScreen
        wetCheckId={42} wetCheckClientId="wc-client" customerId={1}
        customerName="Test Customer" propertyAddress="1 Main St"
        letter="A" zoneNumber={1} zoneCount={12}
        zoneRecord={{
          id: 1001, clientId: "zr-client", wetCheckId: 42, controllerLetter: "A",
          zoneNumber: 1, status: "checked_with_issues", ranSuccessfully: false,
          findings,
        } as any}
        photos={[]} readOnly={false} wetCheckMode={mode}
        onBack={() => {}} onAdvance={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe("inline finding catalog hours", () => {
  it("shows multiplication instantly in service mode without a finding labor stepper", async () => {
    const user = userEvent.setup();
    mount("service");
    await user.click(screen.getByTestId("chip-head_replacement"));
    expect(screen.getByTestId("inline-finding-labor-derived")).toHaveTextContent("0.25");
    await user.clear(screen.getByTestId("inline-finding-qty"));
    await user.type(screen.getByTestId("inline-finding-qty"), "3");
    expect(screen.getByTestId("inline-finding-labor-derived")).toHaveTextContent("0.75");
    expect(screen.getByTestId("inline-finding-labor-formula")).toHaveTextContent("0.25 × 3");
    expect(screen.getByTestId("inline-finding-labor").querySelector("button")).toBeNull();
  });

  it("leaves inspection estimated labor editable", async () => {
    const user = userEvent.setup();
    mount("inspection");
    await user.click(screen.getByTestId("chip-head_replacement"));
    expect(screen.queryByTestId("inline-finding-labor-derived")).toBeNull();
    expect(screen.getByTestId("inline-finding-labor")).toHaveTextContent("Est. labor hrs");
    expect(screen.getByTestId("inline-finding-labor").querySelector("button")).not.toBeNull();
  });

  it("reopens a saved service finding with derived hours and recalculates on edit", async () => {
    const user = userEvent.setup();
    mount("service", [{
      id: 41, issueType: "head_replacement", quantity: 3, laborHours: "0.75",
      resolution: "repaired_in_field", partId: null, partName: null, partPrice: null,
      noPartNeeded: true, notes: null,
    }]);
    expect(screen.getByTestId("finding-41")).toHaveTextContent("qty 3 · 0.75h");
    await user.click(screen.getByTestId("edit-finding-41"));
    expect(screen.getByTestId("inline-finding-labor-derived")).toHaveTextContent("0.75");
    await user.clear(screen.getByTestId("inline-finding-qty"));
    await user.type(screen.getByTestId("inline-finding-qty"), "5");
    expect(screen.getByTestId("inline-finding-labor-derived")).toHaveTextContent("1.25");
    expect(screen.getByTestId("inline-finding-labor-formula")).toHaveTextContent("0.25 × 5");
  });
});