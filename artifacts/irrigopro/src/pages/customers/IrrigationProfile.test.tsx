/**
 * IrrigationProfile.test.tsx — header redesign + permission-matrix regression suite
 *
 * Covers:
 * - Title renders without "— Controllers & Zones" suffix and without wrap
 * - Eyebrow "Irrigation profile" label is present
 * - Stat pills for 0/1/many counts
 * - "Updated by" footer: present when lastUpdated exists, absent otherwise
 * - Report dropdown fires both handlers with correct disabled/loading states
 * - More button hidden for roles where canImport is false (field_tech, billing_manager)
 * - More button visible for roles where canImport is true (company_admin, irrigation_manager, super_admin)
 * - Add Controller regression: renders for canManageControllers roles only (not field_tech or billing_manager)
 * - Role-render matrix: each role sees exactly the intended action buttons
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("wouter", async () => {
  const actual = await vi.importActual<typeof import("wouter")>("wouter");
  return {
    ...actual,
    useParams: () => ({ customerId: "42" }),
    useLocation: () => ["/", vi.fn()],
  };
});
vi.mock("@/utils/safeStorage", () => ({ safeGet: vi.fn(), safeSet: vi.fn(), safeRemove: vi.fn() }));
vi.mock("@/components/customers/irrigation-controller-grid", () => ({
  IrrigationControllerGrid: () => <div data-testid="controller-grid" />,
}));
vi.mock("@/components/customers/IrrigationCsvImportModal", () => ({
  IrrigationCsvImportModal: () => null,
}));
vi.mock("@/components/customers/BackflowSection", () => ({
  BackflowSection: () => <div data-testid="backflow-section" />,
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

const mockSafeGet = safeGet as ReturnType<typeof vi.fn>;

const CUSTOMER = { id: 42, name: "Villas at the Boulders", companyId: 1 };

const makeController = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  customerId: 42,
  name: "Controller A",
  totalZones: 6,
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

  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <IrrigationProfile />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

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

  it("clicking Report opens dropdown with Generate report and Send report items", async () => {
    const user = userEvent.setup();
    setup("company_admin");
    await user.click(screen.getByRole("button", { name: /Report/i }));
    await waitFor(() => {
      expect(screen.getByText("Generate report")).toBeInTheDocument();
      expect(screen.getByText("Send report")).toBeInTheDocument();
    });
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
