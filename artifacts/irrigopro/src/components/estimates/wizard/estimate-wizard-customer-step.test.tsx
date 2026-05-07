import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Customer } from "@shared/schema";

// The picker dialog and the map picker pull data we don't need for this
// test; stub them out with tiny components that just expose the shape
// the step relies on. The point of this test is the
// EstimateWizardCustomerStep <-> parent <-> react-hook-form interaction
// when a customer is picked, not the picker UI itself.
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
  // The Customer type has many more fields; the step only reads a small
  // subset, so cast through unknown for the test fixture.
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
  workLocation: null,
  controllerLetter: null,
  zoneNumber: null,
};

function Harness({
  onChangeSpy,
}: {
  onChangeSpy?: (next: CustomerStepValue) => void;
}) {
  const [value, setValue] = useState<CustomerStepValue>(EMPTY_VALUE);
  return (
    <EstimateWizardCustomerStep
      value={value}
      onChange={(next) => {
        onChangeSpy?.(next);
        setValue(next);
      }}
      onContinue={() => {}}
      onCancel={() => {}}
    />
  );
}

function renderHarness(onChangeSpy?: (next: CustomerStepValue) => void) {
  // A brand-new QueryClient per test keeps the controllers query
  // isolated. We don't supply a network mock — the step renders the
  // controller card in a "Loading…" state, which is fine for these
  // assertions.
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        // The controllers query in the step doesn't matter for what
        // we're asserting — give it a no-op queryFn so the test logs
        // aren't full of "No queryFn" warnings from react-query.
        queryFn: async () => [],
      },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <Harness onChangeSpy={onChangeSpy} />
    </QueryClientProvider>,
  );
}

describe("EstimateWizardCustomerStep — one-click customer selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("commits the customer, closes the picker, and fills the address after a single click", async () => {
    const user = userEvent.setup();
    renderHarness();

    // Sanity: the picker (mocked) is shown because no customer is
    // selected yet, and the customer summary card is not.
    const pickerRow = await screen.findByTestId("mock-customer-row");
    expect(pickerRow).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-customer-name")).not.toBeInTheDocument();

    // ONE click — not two.
    await user.click(pickerRow);

    // Customer summary card appears with the picked customer's name.
    const summary = await screen.findByTestId("wizard-customer-name");
    expect(summary).toHaveTextContent(FIXTURE_CUSTOMER.name);

    // The picker has been swapped out for the summary; the mock row is
    // no longer in the tree.
    expect(screen.queryByTestId("mock-customer-row")).not.toBeInTheDocument();

    // The "Project Details" card is now revealed (gated on customer)
    // and the project address input is populated from the customer
    // record. This is the field that the previous bug would leave blank
    // because the parent state update was clobbered by the stale
    // form.watch callback.
    const addressInput = (await screen.findByDisplayValue(
      FIXTURE_CUSTOMER.address!,
    )) as HTMLInputElement;
    expect(addressInput).toBeInTheDocument();
    expect(addressInput.readOnly).toBe(true);

    // Email and phone defaults from the customer record also flowed
    // through the same single onChange.
    const emailInput = screen.getByTestId(
      "wizard-customer-email",
    ) as HTMLInputElement;
    const phoneInput = screen.getByTestId(
      "wizard-customer-phone",
    ) as HTMLInputElement;
    expect(emailInput.value).toBe(FIXTURE_CUSTOMER.email);
    expect(phoneInput.value).toBe(FIXTURE_CUSTOMER.phone);
  });

  it("does not require a second click — the customer sticks on the first onChange", async () => {
    // This is the explicit regression guard. If anyone re-introduces an
    // inline form.setValue("projectAddress", ...) inside
    // handleSelectCustomer, the synchronous form.watch callback will
    // fire with a stale valueRef.current (customer still null) and
    // clobber the customer-setting onChange. The first click would then
    // leave value.customer === null and the picker would still be
    // showing.
    const user = userEvent.setup();
    const onChangeCalls: CustomerStepValue[] = [];
    renderHarness((next) => {
      onChangeCalls.push(next);
    });

    const pickerRow = await screen.findByTestId("mock-customer-row");
    await user.click(pickerRow);

    // After a single click, every onChange that fired must agree that a
    // customer was picked — no stale call may overwrite it back to null.
    await waitFor(() => {
      expect(onChangeCalls.length).toBeGreaterThan(0);
    });
    const finalValue = onChangeCalls[onChangeCalls.length - 1]!;
    expect(finalValue.customer?.id).toBe(FIXTURE_CUSTOMER.id);
    expect(finalValue.projectAddress).toBe(FIXTURE_CUSTOMER.address);
    expect(finalValue.useDifferentAddress).toBe(false);

    // Critically: no later onChange may revert customer back to null
    // (the previous bug's fingerprint).
    const sawNullAfterPick = onChangeCalls
      .slice(onChangeCalls.findIndex((v) => v.customer?.id === FIXTURE_CUSTOMER.id))
      .some((v) => v.customer === null);
    expect(sawNullAfterPick).toBe(false);
  });

  it("toggles to a custom address and back to the customer address without a stale clobber", async () => {
    // Same race could re-appear in handleToggleAddress if someone calls
    // form.setValue inline. After toggling once we should land on a
    // blank custom address; toggling back should restore the customer
    // address — both with a single click each.
    const user = userEvent.setup();
    renderHarness();

    await user.click(await screen.findByTestId("mock-customer-row"));
    await screen.findByTestId("wizard-customer-name");

    const toggle = screen.getByTestId("wizard-toggle-address");

    await user.click(toggle);
    await waitFor(() => {
      // After flipping to "use a different address", the address field
      // is editable (no longer the read-only customer address).
      const inputs = screen.getAllByPlaceholderText(
        "123 Main St, City, State 12345",
      ) as HTMLInputElement[];
      expect(inputs[0]!.readOnly).toBe(false);
    });

    await user.click(toggle);
    // And back to the customer's address, in one click.
    expect(
      await screen.findByDisplayValue(FIXTURE_CUSTOMER.address!),
    ).toBeInTheDocument();
  });
});
