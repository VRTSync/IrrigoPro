/**
 * IrrigationProfile.test.tsx — header redesign + permission-matrix regression suite
 *
 * Covers:
 * - Title renders without "— Controllers & Zones" suffix and without wrap
 * - Eyebrow "Irrigation profile" label is present
 * - Stat pills for 0/1/many counts
 * - "Updated by" footer: present when lastUpdated exists, absent otherwise
 * - Report dropdown opens the customer email preview without sending
 * - More button hidden for roles where canImport is false (field_tech, billing_manager)
 * - More button visible for roles where canImport is true (company_admin, irrigation_manager, super_admin)
 * - Add Controller regression: renders for canManageControllers roles only (not field_tech or billing_manager)
 * - Role-render matrix: each role sees exactly the intended action buttons
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { toast, route } = vi.hoisted(() => ({ toast: vi.fn(), route: { search: "" } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("wouter", async () => {
  const actual = await vi.importActual<typeof import("wouter")>("wouter");
  return {
    ...actual,
    useParams: () => ({ customerId: "42" }),
    useLocation: () => ["/", vi.fn()],
    useSearch: () => route.search,
  };
});
vi.mock("@/utils/safeStorage", () => ({ safeGet: vi.fn(), safeSet: vi.fn(), safeRemove: vi.fn() }));
vi.mock("@/components/customers/irrigation-controller-grid", () => ({
  IrrigationControllerGrid: vi.fn(() => <div data-testid="controller-grid" />),
}));
vi.mock("@/components/customers/IrrigationCsvImportModal", () => ({
  IrrigationCsvImportModal: () => null,
}));
vi.mock("@/components/customers/BackflowSection", () => ({
  BackflowSection: vi.fn(() => <div data-testid="backflow-section" />),
}));
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>(
    "@/lib/queryClient",
  );
  return { ...actual, apiRequest: vi.fn(async () => ({})) };
});

import { safeGet } from "@/utils/safeStorage";
import { AuthProvider } from "@/lib/auth-context";
import IrrigationProfile from "./IrrigationProfile";
import { IrrigationControllerGrid } from "@/components/customers/irrigation-controller-grid";
import { BackflowSection } from "@/components/customers/BackflowSection";
import { apiRequest } from "@/lib/queryClient";

const mockSafeGet = safeGet as ReturnType<typeof vi.fn>;

const CUSTOMER = { id: 42, name: "Villas at the Boulders", companyId: 1 };

const makeController = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  customerId: 42,
  name: "Controller A",
  letter: "A",
  branchName: "",
  totalZones: 6,
  zones: Array.from({ length: Number(overrides.totalZones ?? 6) }, (_, i) => ({
    id: i + 1, zoneNumber: i + 1, name: `Zone ${i + 1}`, zoneType: "other", isActive: true, setUp: false,
  })),
  retiredZoneCount: 0,
  isActive: true,
  lastUpdatedAt: "2026-06-01T10:00:00Z",
  lastUpdatedByName: "Jane Smith",
  ...overrides,
});

function setup(role: string, controllers: unknown[] = [makeController()]) {
  // AuthProvider reads from safeGet("user") via readUserFromStorage — the mock
  // injects the test role so useAuth() in IrrigationProfile receives it.
  mockSafeGet.mockReturnValue(JSON.stringify({ id: 1, role, isActive: true, name: "Test", email: "t@t.com", username: "t" }));

  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  qc.setQueryData(["/api/customers/42"], CUSTOMER);
  qc.setQueryData(["/api/customers/42/controllers-profile"], controllers);

  const view = render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <IrrigationProfile />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...view, qc };
}

describe("IrrigationProfile — re-letter clocks", () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset().mockResolvedValue({});
    toast.mockClear();
    route.search = "";
  });
  const clocks = () => [
    makeController(), makeController({ id: 2, letter: "B", name: "Controller B" }),
    makeController({ id: 3, letter: "C", name: "Controller C" }),
    makeController({ id: 4, letter: "A", branchName: "North" }),
    makeController({ id: 5, letter: "Z", isActive: false }),
  ];
  it.each(["super_admin", "company_admin", "irrigation_manager"])("shows the action for %s", role => {
    setup(role, clocks());
    expect(screen.getByTestId("button-reletter")).toBeEnabled();
  });
  it.each(["field_tech", "system_documenter", "billing_manager", "bookkeeper"])("hides the action for %s", role => {
    setup(role, clocks());
    expect(screen.queryByTestId("button-reletter")).toBeNull();
  });
  it("requires at least two active clocks in the current location", () => {
    setup("company_admin", [makeController(), makeController({ id: 2, branchName: "North" }), makeController({ id: 3, isActive: false })]);
    expect(screen.getByTestId("button-reletter")).toBeDisabled();
  });
  it("shows arrows and count, sends the complete location once, invalidates caches and closes", async () => {
    const { qc } = setup("irrigation_manager", clocks());
    vi.mocked(apiRequest).mockResolvedValueOnce({ changed: 2, controllers: [] });
    const invalidate = vi.spyOn(qc, "invalidateQueries").mockResolvedValue();
    fireEvent.click(screen.getByTestId("button-reletter"));
    expect(screen.getByTestId("button-save-letters")).toBeDisabled();
    expect(screen.queryByTestId("select-letter-4")).toBeNull();
    expect(screen.queryByTestId("select-letter-5")).toBeNull();
    fireEvent.change(screen.getByTestId("select-letter-1"), { target: { value: "B" } });
    fireEvent.change(screen.getByTestId("select-letter-2"), { target: { value: "A" } });
    expect(screen.getByText("→ B")).toBeInTheDocument();
    expect(screen.getByText("→ A")).toBeInTheDocument();
    expect(screen.getByText("2 clocks will be renamed")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-save-letters"));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/api/customers/42/controllers/letters", "PUT", {
      branchName: "", letters: [
        { controllerId: 1, letter: "B" }, { controllerId: 2, letter: "A" }, { controllerId: 3, letter: "C" },
      ],
    }));
    expect(apiRequest).toHaveBeenCalledTimes(1);
    for (const queryKey of [
      ["/api/customers/42/controllers-profile"], ["/api/properties", 42, "controllers"],
      ["/api/irrigation-controllers/1/history"], ["/api/irrigation-controllers/2/history"],
    ]) expect(invalidate).toHaveBeenCalledWith({ queryKey });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["/api/irrigation-controllers/3/history"] });
    await waitFor(() => expect(screen.queryByTestId("button-save-letters")).toBeNull());
    expect(toast).toHaveBeenCalledWith({ title: "2 clocks re-lettered" });
  });
  it("flags both duplicate rows and disables saving", () => {
    setup("company_admin", clocks());
    fireEvent.click(screen.getByTestId("button-reletter"));
    fireEvent.change(screen.getByTestId("select-letter-1"), { target: { value: "B" } });
    expect(screen.getAllByText("Used twice")).toHaveLength(2);
    expect(screen.getByTestId("button-save-letters")).toBeDisabled();
    expect(apiRequest).not.toHaveBeenCalled();
  });
  it("sends only the selected named branch, never clocks from the default location", async () => {
    route.search = "?branchName=North";
    vi.mocked(apiRequest).mockResolvedValueOnce({ changed: 2 });
    const { qc } = setup("company_admin", [...clocks(), makeController({ id: 6, letter: "B", branchName: "North" })]);
    vi.spyOn(qc, "invalidateQueries").mockResolvedValue();
    fireEvent.click(screen.getByTestId("button-reletter"));
    expect(screen.queryByTestId("select-letter-1")).toBeNull();
    fireEvent.change(screen.getByTestId("select-letter-4"), { target: { value: "B" } });
    fireEvent.change(screen.getByTestId("select-letter-6"), { target: { value: "A" } });
    fireEvent.click(screen.getByTestId("button-save-letters"));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/api/customers/42/controllers/letters", "PUT", {
      branchName: "North", letters: [{ controllerId: 4, letter: "B" }, { controllerId: 6, letter: "A" }],
    }));
  });
  it("locks saving while pending; server errors keep selections and expose the server message", async () => {
    let reject!: (e: Error) => void;
    vi.mocked(apiRequest).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    setup("company_admin", clocks());
    fireEvent.click(screen.getByTestId("button-reletter"));
    fireEvent.change(screen.getByTestId("select-letter-1"), { target: { value: "X" } });
    fireEvent.click(screen.getByTestId("button-save-letters"));
    await waitFor(() => expect(screen.getByTestId("button-save-letters")).toBeDisabled());
    expect(screen.getByTestId("select-letter-1")).toBeDisabled();
    reject(new Error('400: {"message":"Every active clock at this location needs a letter"}'));
    expect(await screen.findByRole("alert")).toHaveTextContent("Every active clock at this location needs a letter");
    expect(screen.getByTestId("select-letter-1")).toHaveValue("X");
    expect(screen.getByTestId("button-save-letters")).toBeEnabled();
  });
  it("reinitializes choices when cancelled and reopened", () => {
    setup("company_admin", clocks());
    fireEvent.click(screen.getByTestId("button-reletter"));
    fireEvent.change(screen.getByTestId("select-letter-1"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }));
    fireEvent.click(screen.getByTestId("button-reletter"));
    expect(screen.getByTestId("select-letter-1")).toHaveValue("A");
  });
});

describe("IrrigationProfile header — title block", () => {
  it("renders property name without '— Controllers & Zones' suffix", () => {
    setup("company_admin");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Villas at the Boulders",
    );
    expect(screen.queryByText(/Controllers & Zones/i)).toBeNull();
    expect(screen.queryByText(/Controllers &amp; Zones/i)).toBeNull();
  });

  it("shows eyebrow label 'Irrigation profile'", () => {
    setup("company_admin");
    expect(screen.getByText("Irrigation profile")).toBeInTheDocument();
  });

  it("h1 has truncate class so it cannot wrap", () => {
    setup("company_admin");
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.className).toMatch(/truncate/);
  });
});

describe("IrrigationProfile header — stat pills", () => {
  it("shows 0 controllers pill when list is empty", () => {
    setup("company_admin", []);
    expect(screen.getByText(/0 controllers/i)).toBeInTheDocument();
  });

  it("uses singular 'controller' for exactly 1", () => {
    setup("company_admin", [makeController({ totalZones: 0 })]);
    expect(screen.getByText(/1 controller\b/i)).toBeInTheDocument();
  });

  it("uses plural 'controllers' for 2+", () => {
    setup("company_admin", [makeController(), makeController({ id: 2 })]);
    expect(screen.getByText(/2 controllers/i)).toBeInTheDocument();
  });

  it("shows zone pill when totalZoneCount > 0", () => {
    setup("company_admin", [makeController({ totalZones: 6 })]);
    expect(screen.getByText(/6 zones/i)).toBeInTheDocument();
  });

  it("omits zone pill when totalZoneCount is 0", () => {
    setup("company_admin", [makeController({ totalZones: 0 })]);
    expect(screen.queryByText(/zone/i)).toBeNull();
  });

  it("uses singular 'zone' for exactly 1", () => {
    setup("company_admin", [makeController({ totalZones: 1 })]);
    expect(screen.getByText(/1 zone\b/i)).toBeInTheDocument();
  });

  it("pill elements have bg-blue-50 and text-blue-700 classes", () => {
    setup("company_admin", [makeController({ totalZones: 3 })]);
    const pills = document.querySelectorAll(".bg-blue-50.text-blue-700");
    expect(pills.length).toBeGreaterThanOrEqual(2);
  });
});

describe("IrrigationProfile header — Updated by footer", () => {
  it("renders updated footer when lastUpdatedAt is present", () => {
    setup("company_admin");
    expect(screen.getByText(/Updated/i)).toBeInTheDocument();
    expect(screen.getByText(/Jane Smith/i)).toBeInTheDocument();
  });

  it("omits footer entirely when no controller has lastUpdatedAt", () => {
    setup("company_admin", [makeController({ lastUpdatedAt: null })]);
    expect(screen.queryByText(/Updated/i)).toBeNull();
  });

  it("omits footer when controller list is empty", () => {
    setup("company_admin", []);
    expect(screen.queryByText(/Updated/i)).toBeNull();
  });

  it("omits the 'by name' portion when lastUpdatedByName is absent", () => {
    setup("company_admin", [makeController({ lastUpdatedByName: null })]);
    expect(screen.queryByText(/Jane Smith/i)).toBeNull();
  });
});

describe("IrrigationProfile header — Report dropdown", () => {
  it("Report trigger button is present for company_admin", () => {
    setup("company_admin");
    expect(screen.getByRole("button", { name: /Report/i })).toBeInTheDocument();
  });

  it("Report trigger is disabled when controllers list is empty", () => {
    setup("company_admin", []);
    expect(screen.getByRole("button", { name: /Report/i })).toBeDisabled();
  });

  it("offers report generation and opens an email review without sending", async () => {
    const user = userEvent.setup();
    const requests: string[] = [];
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = String(input);
      if (!url.includes("/api/outgoing-email/")) return Response.json([]);
      requests.push(url);
      return Response.json({
        kind: "irrigation_profile_report", id: 42,
        from: { email: "office@example.com", name: "Example Irrigation" },
        replyTo: "office@example.com", usingCompanyAddress: true,
        to: "customer@example.com", cc: [], bcc: [], subject: "Your Irrigation System Profile",
        note: "", html: "<p>Your report is attached.</p>", text: "Your report is attached.",
        attachments: [{ filename: "Irrigation Profile.pdf", viewUrl: "/api/customers/42/irrigation-profile/report-pdf" }],
        options: {}, optionDefs: [], variant: null, variantDefs: [], warnings: [],
        confirmationToken: "review-token", expiresAt: "2026-11-19T12:15:00Z",
      });
    });
    try {
      setup("company_admin");
      await user.click(screen.getByRole("button", { name: /Report/i }));
      expect(await screen.findByRole("menuitem", { name: "Generate report" })).toBeInTheDocument();
      await user.click(screen.getByRole("menuitem", { name: "Email report" }));
      expect(await screen.findByRole("dialog", { name: "Email irrigation system profile" })).toBeInTheDocument();
      expect(await screen.findByText("Irrigation Profile.pdf")).toBeInTheDocument();
      expect(requests).toEqual(["/api/outgoing-email/irrigation_profile_report/42/preview"]);
    } finally {
      fetch.mockRestore();
    }
  });
});

describe("IrrigationProfile header — More dropdown (canImport gate)", () => {
  const importRoles = ["company_admin", "super_admin", "irrigation_manager"] as const;
  const noImportRoles = ["field_tech", "billing_manager"] as const;

  for (const role of importRoles) {
    it(`More button is visible for role: ${role}`, () => {
      setup(role);
      expect(screen.getByRole("button", { name: /More actions/i })).toBeInTheDocument();
    });
  }

  for (const role of noImportRoles) {
    it(`More button is hidden for role: ${role}`, () => {
      setup(role);
      expect(screen.queryByRole("button", { name: /More actions/i })).toBeNull();
    });
  }

  it("More dropdown contains Export CSV and Import CSV", async () => {
    const user = userEvent.setup();
    setup("company_admin");
    await user.click(screen.getByRole("button", { name: /More actions/i }));
    await waitFor(() => {
      expect(screen.getByText("Export CSV")).toBeInTheDocument();
      expect(screen.getByText("Import CSV")).toBeInTheDocument();
    });
  });
});

describe("IrrigationProfile header — Add Controller gate", () => {
  // canManageControllers = company_admin | super_admin | irrigation_manager
  const managerRoles = ["company_admin", "super_admin", "irrigation_manager"] as const;
  const nonManagerRoles = ["field_tech", "billing_manager"] as const;

  for (const role of managerRoles) {
    it(`Add Controller button is present for role: ${role}`, () => {
      setup(role);
      expect(
        screen.getByRole("button", { name: /Add Controller/i }),
      ).toBeInTheDocument();
    });
  }

  for (const role of nonManagerRoles) {
    it(`Add Controller button is absent for role: ${role}`, () => {
      setup(role);
      expect(
        screen.queryByRole("button", { name: /Add Controller/i }),
      ).toBeNull();
    });
  }
});

// ── Role-render matrix ─────────────────────────────────────────────────────────
// Each describe block asserts exactly the buttons that should be visible for
// that role per the intended permission matrix:
//
//   | Action                   | field_tech | billing_mgr | irrig_mgr | admin |
//   |--------------------------|------------|-------------|-----------|-------|
//   | Add Controller           |     ❌     |     ❌      |    ✅     |   ✅  |
//   | Report dropdown          |     ❌     |     ✅      |    ✅     |   ✅  |
//   | More (Import/Export)     |     ❌     |     ❌      |    ✅     |   ✅  |

describe("IrrigationProfile — role-render matrix: field_tech", () => {
  it("does NOT see Add Controller button", () => {
    setup("field_tech");
    expect(screen.queryByRole("button", { name: /Add Controller/i })).toBeNull();
  });

  it("does NOT see Report dropdown button", () => {
    setup("field_tech");
    expect(screen.queryByRole("button", { name: /Report/i })).toBeNull();
  });

  it("does NOT see More (Import/Export) button", () => {
    setup("field_tech");
    expect(screen.queryByRole("button", { name: /More actions/i })).toBeNull();
  });
});

describe("IrrigationProfile — role-render matrix: billing_manager", () => {
  it("does NOT see Add Controller button", () => {
    setup("billing_manager");
    expect(screen.queryByRole("button", { name: /Add Controller/i })).toBeNull();
  });

  it("DOES see Report dropdown button", () => {
    setup("billing_manager");
    expect(screen.getByRole("button", { name: /Report/i })).toBeInTheDocument();
  });

  it("does NOT see More (Import/Export) button", () => {
    setup("billing_manager");
    expect(screen.queryByRole("button", { name: /More actions/i })).toBeNull();
  });
});

describe("IrrigationProfile — role-render matrix: irrigation_manager", () => {
  it("DOES see Add Controller button", () => {
    setup("irrigation_manager");
    expect(screen.getByRole("button", { name: /Add Controller/i })).toBeInTheDocument();
  });

  it("DOES see Report dropdown button", () => {
    setup("irrigation_manager");
    expect(screen.getByRole("button", { name: /Report/i })).toBeInTheDocument();
  });

  it("DOES see More (Import/Export) button", () => {
    setup("irrigation_manager");
    expect(screen.getByRole("button", { name: /More actions/i })).toBeInTheDocument();
  });
});

// ── Prop-flow matrix ───────────────────────────────────────────────────────────
//
// Verifies that the capability flags computed in IrrigationProfile are passed
// correctly into the child component boundaries. These complement the header-
// button checks above: a flag could be correct in the header but wrong in the
// prop passed to the grid / backflow section.
//
// IrrigationControllerGrid and BackflowSection are already mocked as vi.fn()
// so we can inspect their most-recent call arguments.

const MockGrid = IrrigationControllerGrid as unknown as ReturnType<typeof vi.fn>;
const MockSection = BackflowSection as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  MockGrid.mockClear();
  MockSection.mockClear();
});

describe("IrrigationProfile — prop flow: field_tech", () => {
  it("passes canEditZones=true to IrrigationControllerGrid", () => {
    setup("field_tech");
    const props = MockGrid.mock.calls[MockGrid.mock.calls.length - 1]?.[0] ?? {};
    expect(props.canEditZones).toBe(true);
  });

  it("passes canManageControllers=false to IrrigationControllerGrid", () => {
    setup("field_tech");
    const props = MockGrid.mock.calls[MockGrid.mock.calls.length - 1]?.[0] ?? {};
    expect(props.canManageControllers).toBe(false);
  });

  it("passes canLogTest=true to BackflowSection", () => {
    setup("field_tech");
    const props = MockSection.mock.calls[MockSection.mock.calls.length - 1]?.[0] ?? {};
    expect(props.canLogTest).toBe(true);
  });

  it("passes canManage=false to BackflowSection", () => {
    setup("field_tech");
    const props = MockSection.mock.calls[MockSection.mock.calls.length - 1]?.[0] ?? {};
    expect(props.canManage).toBe(false);
  });
});

describe("IrrigationProfile — prop flow: billing_manager", () => {
  it("passes canLogTest=false to BackflowSection (billing_manager cannot log tests)", () => {
    setup("billing_manager");
    const props = MockSection.mock.calls[MockSection.mock.calls.length - 1]?.[0] ?? {};
    expect(props.canLogTest).toBe(false);
  });

  it("passes canManage=false to BackflowSection", () => {
    setup("billing_manager");
    const props = MockSection.mock.calls[MockSection.mock.calls.length - 1]?.[0] ?? {};
    expect(props.canManage).toBe(false);
  });

  it("passes canEditZones=false to IrrigationControllerGrid", () => {
    setup("billing_manager");
    const props = MockGrid.mock.calls[MockGrid.mock.calls.length - 1]?.[0] ?? {};
    expect(props.canEditZones).toBe(false);
  });
});

describe("IrrigationProfile — prop flow: irrigation_manager", () => {
  it("passes canEditZones=true to IrrigationControllerGrid", () => {
    setup("irrigation_manager");
    const props = MockGrid.mock.calls[MockGrid.mock.calls.length - 1]?.[0] ?? {};
    expect(props.canEditZones).toBe(true);
  });

  it("passes canManageControllers=true to IrrigationControllerGrid", () => {
    setup("irrigation_manager");
    const props = MockGrid.mock.calls[MockGrid.mock.calls.length - 1]?.[0] ?? {};
    expect(props.canManageControllers).toBe(true);
  });

  it("passes canLogTest=true to BackflowSection", () => {
    setup("irrigation_manager");
    const props = MockSection.mock.calls[MockSection.mock.calls.length - 1]?.[0] ?? {};
    expect(props.canLogTest).toBe(true);
  });
});

describe("IrrigationProfile — Add Controller letter picker", () => {
  it("has no Name input; submit stays disabled until a letter is picked; body carries letter and no confirmLetter", async () => {
    const { apiRequest } = await import("@/lib/queryClient");
    const spy = apiRequest as unknown as ReturnType<typeof vi.fn>;
    spy.mockClear();
    setup("company_admin", [makeController({ letter: "A", branchName: "" })]);
    fireEvent.click(screen.getByRole("button", { name: /Add Controller/i }));
    expect(screen.queryByText("Name *")).toBeNull();
    const submit = () => { const all = screen.getAllByRole("button", { name: /Add Controller/i }); return all[all.length - 1]; };
    expect(submit()).toBeDisabled();
    expect(screen.getByTestId("letter-A")).toHaveAttribute("aria-label", expect.stringContaining("used by Controller A"));
    fireEvent.click(screen.getByTestId("letter-C"));
    expect(submit()).not.toBeDisabled();
    fireEvent.click(submit());
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const [url, method, body] = spy.mock.calls.find(([u, m]) => m === "POST")!;
    expect(url).toBe("/api/customers/42/controllers-profile");
    expect(method).toBe("POST");
    expect(body).toMatchObject({ letter: "C" });
    expect(body).not.toHaveProperty("confirmLetter");
    expect(body).not.toHaveProperty("name");
  });
});
