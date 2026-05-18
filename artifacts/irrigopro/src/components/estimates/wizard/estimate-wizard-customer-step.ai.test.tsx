// Task #665 — regression coverage for the "Enhance with AI" button on
// Step 1's Scope of Work card in the estimate wizard. The button +
// suggestion card are shared with the billing-sheet wizard
// (`AiExpandButton` / `AiSuggestionCard` from
// `components/ui/ai-expand-button.tsx`), and a future refactor of
// either the wizard or the shared components could silently regress
// the accept/dismiss behavior on estimates. These tests pin down:
//
//   1. The button is disabled when Scope of Work is empty.
//   2. The button becomes enabled once the user types something.
//   3. Clicking it calls `POST /api/ai/expand-description` with the
//      raw description (we mock `apiRequest`, no live OpenAI call).
//   4. Clicking "Use this" on the returned suggestion replaces the
//      textarea contents with the expanded text.
//   5. Clicking "Dismiss" leaves the textarea contents unchanged.

import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Customer } from "@workspace/db/schema";

// Mock the picker + map the same way the sibling test does — we don't
// need either of them to exercise the AI button.
vi.mock("@/components/ui/customer-selector", () => ({
  CustomerSelector: ({
    onSelectCustomer,
  }: {
    onSelectCustomer: (c: Customer) => void;
  }) => (
    <button
      type="button"
      data-testid="mock-customer-row"
      onClick={() => onSelectCustomer(FIXTURE_CUSTOMER)}
    >
      Pick {FIXTURE_CUSTOMER.name}
    </button>
  ),
}));

vi.mock("@/components/ui/location-picker", () => ({
  LocationPicker: () => <div data-testid="mock-location-picker" />,
}));

// Mock `apiRequest` so we never hit the real `/api/ai/expand-description`
// endpoint (no live OpenAI call). `vi.importActual` keeps the rest of
// the queryClient module intact for any other consumers in the tree.
const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>(
    "@/lib/queryClient",
  );
  return {
    ...actual,
    apiRequest: (...args: unknown[]) => apiRequestMock(...args),
  };
});

import {
  EstimateWizardCustomerStep,
  type CustomerStepValue,
} from "./estimate-wizard-customer-step";

const FIXTURE_CUSTOMER: Customer = {
  id: "cust-1",
  name: "Acme Landscapes",
  email: "ops@acme.example",
  phone: "(555) 123-4567",
  address: "123 Main St, Springfield, IL 62701",
} as unknown as Customer;

const EMPTY_VALUE: CustomerStepValue = {
  customer: null,
  customerEmail: "",
  customerPhone: "",
  projectName: "",
  projectAddress: "",
  useDifferentAddress: false,
  locationNotes: "",
  accessInstructions: "",
  workDescription: "",
  workLocation: null,
  controllerLetter: null,
  zoneNumber: null,
};

function Harness({ initialCustomer = true }: { initialCustomer?: boolean }) {
  const [value, setValue] = useState<CustomerStepValue>(
    initialCustomer
      ? {
          ...EMPTY_VALUE,
          customer: FIXTURE_CUSTOMER,
          customerEmail: FIXTURE_CUSTOMER.email ?? "",
          customerPhone: FIXTURE_CUSTOMER.phone ?? "",
          projectAddress: FIXTURE_CUSTOMER.address ?? "",
        }
      : EMPTY_VALUE,
  );
  return (
    <EstimateWizardCustomerStep
      value={value}
      onChange={setValue}
      onContinue={() => {}}
      onCancel={() => {}}
    />
  );
}

function renderHarness() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        queryFn: async () => [],
      },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

function getEnhanceButton() {
  return screen.getByRole("button", { name: /Enhance with AI/i });
}

describe("EstimateWizardCustomerStep — Enhance with AI", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  it("disables the Enhance button when Scope of Work is empty and enables it after the user types", async () => {
    const user = userEvent.setup();
    renderHarness();

    // Customer is pre-selected so the Scope of Work card is rendered
    // immediately (it's gated on `value.customer`).
    const textarea = (await screen.findByTestId(
      "wizard-work-description",
    )) as HTMLTextAreaElement;
    expect(textarea.value).toBe("");

    const enhance = getEnhanceButton();
    expect(enhance).toBeDisabled();

    await user.type(textarea, "Replace 3 broken heads in zone 2");

    await waitFor(() => {
      expect(getEnhanceButton()).not.toBeDisabled();
    });
  });

  it("Use this replaces the textarea with the mocked AI suggestion", async () => {
    const user = userEvent.setup();
    apiRequestMock.mockResolvedValueOnce({
      expanded:
        "Replace three broken Hunter Pro spray heads on zone 2 of controller A, including new risers and a full system flush.",
    });
    renderHarness();

    const textarea = (await screen.findByTestId(
      "wizard-work-description",
    )) as HTMLTextAreaElement;
    await user.type(textarea, "Replace 3 broken heads in zone 2");
    const originalText = textarea.value;

    await user.click(getEnhanceButton());

    // The button calls POST /api/ai/expand-description with the
    // trimmed raw description — no live OpenAI call.
    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledTimes(1);
    });
    const [url, method, body] = apiRequestMock.mock.calls[0]!;
    expect(url).toBe("/api/ai/expand-description");
    expect(method).toBe("POST");
    expect(body).toEqual({ rawDescription: originalText });

    // Suggestion card renders with the mocked expansion.
    const useThis = await screen.findByRole("button", { name: /Use this/i });
    expect(
      screen.getByText(
        /Replace three broken Hunter Pro spray heads on zone 2/i,
      ),
    ).toBeInTheDocument();

    await user.click(useThis);

    // Textarea is replaced with the suggestion and the suggestion
    // card is dismissed.
    await waitFor(() => {
      expect(
        (screen.getByTestId("wizard-work-description") as HTMLTextAreaElement)
          .value,
      ).toMatch(/Replace three broken Hunter Pro spray heads on zone 2/i);
    });
    expect(
      screen.queryByRole("button", { name: /Use this/i }),
    ).not.toBeInTheDocument();
  });

  it("Dismiss leaves the original Scope of Work text intact", async () => {
    const user = userEvent.setup();
    apiRequestMock.mockResolvedValueOnce({
      expanded: "A much fancier AI-written description.",
    });
    renderHarness();

    const textarea = (await screen.findByTestId(
      "wizard-work-description",
    )) as HTMLTextAreaElement;
    const original = "Replace 3 broken heads in zone 2";
    await user.type(textarea, original);

    await user.click(getEnhanceButton());

    const dismiss = await screen.findByRole("button", { name: /Dismiss/i });
    await user.click(dismiss);

    // Textarea value is exactly the user's original text — the
    // suggestion was discarded.
    expect(
      (screen.getByTestId("wizard-work-description") as HTMLTextAreaElement)
        .value,
    ).toBe(original);
    // And the suggestion card is gone.
    expect(
      screen.queryByRole("button", { name: /Use this/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Dismiss/i }),
    ).not.toBeInTheDocument();
  });
});
