// Task #658 — Frontend Delete-button visibility matrix.
//
// Pins the role × lifecycle gate the user sees:
//   * EstimateListRow renders `list-row-delete-${id}` only when
//     `canDeleteEstimateAs(role, estimate)` returns true.
//   * EstimateDetailModal renders `detail-modal-delete` under the
//     same predicate.
//
// The server is the authoritative gate, but if these tests drift
// from `canDeleteEstimateAs` we'd surface a Delete control that
// 403s/409s on click — bad UX. Lock both call sites to the same
// matrix here.

import { afterEach, describe, expect, it } from "vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { EstimateListRow } from "./list/estimate-list-row";
import { EstimateDetailModal } from "./estimate-detail-modal";
import { computeLifecycleStatus, type LifecycleStatus } from "@/lib/lifecycle";
import type { Estimate } from "@workspace/db/schema";

function setRole(role: string | null): void {
  if (role == null) {
    window.localStorage.removeItem("user");
    return;
  }
  window.localStorage.setItem(
    "user",
    JSON.stringify({ id: 1, role, companyId: 1, name: "Test" }),
  );
}

type Fixture = {
  id: number;
  status: string;
  internalStatus: string;
  estimateDate?: string;
};

function pending(id = 100): Fixture {
  return { id, status: "pending", internalStatus: "pending_approval" };
}
function draft(id = 110): Fixture {
  return { id, status: "draft", internalStatus: "draft" };
}
function sent(id = 120): Fixture {
  return {
    id,
    status: "pending",
    internalStatus: "sent_to_customer",
    estimateDate: new Date().toISOString(),
  };
}
function approved(id = 130): Fixture {
  return { id, status: "approved", internalStatus: "sent_to_customer" };
}
function rejected(id = 140): Fixture {
  return { id, status: "rejected", internalStatus: "sent_to_customer" };
}
function expired(id = 150): Fixture {
  // 60 days old + sent_to_customer + pending == lifecycle "expired"
  const d = new Date();
  d.setDate(d.getDate() - 60);
  return {
    id,
    status: "pending",
    internalStatus: "sent_to_customer",
    estimateDate: d.toISOString(),
  };
}

function asEstimate(f: Fixture): Estimate {
  return {
    id: f.id,
    estimateNumber: `EST-${f.id}`,
    status: f.status,
    internalStatus: f.internalStatus,
    customerName: "Acme",
    customerEmail: "a@example.com",
    projectName: "Visibility",
    workDescription: "",
    items: [],
    photos: [],
    attachments: [],
    partsSubtotal: "0.00",
    laborSubtotal: "0.00",
    totalAmount: "0.00",
    laborRate: "75.00",
    appliedLaborRate: "75.00",
    estimateDate: f.estimateDate ?? new Date().toISOString(),
    deletedAt: null,
    deletedBy: null,
  } as unknown as Estimate;
}

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

function makeModalClient(estimate: Estimate): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
        queryFn: async ({ queryKey }) => {
          const path = String(queryKey[0]);
          if (path === "/api/estimates" && queryKey[1] === estimate.id)
            return estimate;
          return null;
        },
      },
      mutations: { retry: false },
    },
  });
}

function renderRow(estimate: Estimate, lifecycle: LifecycleStatus) {
  const client = makeClient();
  return render(
    <QueryClientProvider client={client}>
      <table>
        <tbody>
          <EstimateListRow
            estimate={estimate}
            lifecycle={lifecycle}
            onOpen={() => {}}
            onEdit={() => {}}
          />
        </tbody>
      </table>
    </QueryClientProvider>,
  );
}

function renderModal(estimate: Estimate) {
  const client = makeModalClient(estimate);
  return render(
    <QueryClientProvider client={client}>
      <EstimateDetailModal
        open={true}
        onOpenChange={() => {}}
        estimateId={estimate.id}
      />
    </QueryClientProvider>,
  );
}

// Matrix: (role, fixtureFactory) → expected Delete visibility.
// `field_tech` can only delete drafts; manager-class roles can delete
// drafts AND pending_review; nobody can delete sent/approved/rejected/
// expired. Logged-out (`null`) sees nothing actionable.
type Case = {
  role: string | null;
  fixture: () => Fixture;
  label: string;
  expectDelete: boolean;
};

const MANAGER_ROLES = [
  "super_admin",
  "company_admin",
  "irrigation_manager",
  "billing_manager",
] as const;

const CASES: Case[] = [];
for (const role of MANAGER_ROLES) {
  CASES.push({ role, fixture: draft, label: "draft", expectDelete: true });
  CASES.push({
    role,
    fixture: pending,
    label: "pending_review",
    expectDelete: true,
  });
  CASES.push({ role, fixture: sent, label: "sent", expectDelete: false });
  CASES.push({
    role,
    fixture: approved,
    label: "approved",
    expectDelete: false,
  });
  CASES.push({
    role,
    fixture: rejected,
    label: "rejected",
    expectDelete: false,
  });
  CASES.push({
    role,
    fixture: expired,
    label: "expired",
    expectDelete: false,
  });
}
// field_tech: drafts only.
CASES.push({
  role: "field_tech",
  fixture: draft,
  label: "draft",
  expectDelete: true,
});
CASES.push({
  role: "field_tech",
  fixture: pending,
  label: "pending_review",
  expectDelete: false,
});
CASES.push({
  role: "field_tech",
  fixture: sent,
  label: "sent",
  expectDelete: false,
});
// Logged-out: never.
CASES.push({
  role: null,
  fixture: draft,
  label: "draft",
  expectDelete: false,
});
CASES.push({
  role: null,
  fixture: pending,
  label: "pending_review",
  expectDelete: false,
});

describe("EstimateListRow — Delete visibility (Task #658)", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  for (const c of CASES) {
    it(`role=${c.role ?? "anon"} lifecycle=${c.label} → ${
      c.expectDelete ? "shows" : "hides"
    } list-row-delete`, () => {
      setRole(c.role);
      const fixture = c.fixture();
      const estimate = asEstimate(fixture);
      const lifecycle = computeLifecycleStatus(estimate);
      const { container } = renderRow(estimate, lifecycle);

      // The Delete item lives inside a Radix DropdownMenu — content
      // is only mounted while open. Open the menu by clicking the
      // row's trigger (aria-haspopup="menu") before asserting.
      const menuTrigger = container.querySelector<HTMLElement>(
        '[aria-haspopup="menu"]',
      );
      expect(menuTrigger, "row menu trigger must exist").not.toBeNull();
      fireEvent.pointerDown(menuTrigger!, {
        ctrlKey: false,
        button: 0,
      });
      fireEvent.click(menuTrigger!);

      const trigger = screen.queryByTestId(`list-row-delete-${fixture.id}`);
      expect(!!trigger).toBe(c.expectDelete);
    });
  }
});

describe("EstimateDetailModal — Delete visibility (Task #658)", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  for (const c of CASES) {
    it(`role=${c.role ?? "anon"} lifecycle=${c.label} → ${
      c.expectDelete ? "shows" : "hides"
    } detail-modal-delete`, async () => {
      setRole(c.role);
      const fixture = c.fixture();
      const estimate = asEstimate(fixture);
      renderModal(estimate);

      // Wait until the modal's footer has rendered (queries resolved).
      await screen.findByTestId("detail-modal-footer");

      const trigger = screen.queryByTestId("detail-modal-delete");
      expect(!!trigger).toBe(c.expectDelete);
    });
  }
});
