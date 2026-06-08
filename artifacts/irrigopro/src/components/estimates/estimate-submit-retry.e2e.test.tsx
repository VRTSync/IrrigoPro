// Task #610 — End-to-end retry test for the wizard's atomic submit.
//
// Task #606 collapsed the wizard's old PUT-then-/transition pair into
// a single POST /api/estimates/:id/submit-for-review. Unit tests
// (`estimate-wizard-submit.test.ts`) pin the call-graph of the helper,
// and a server-side parity test (`estimate-pending-parity.test.ts`)
// pins that the admin "Pending Approval" list and the manager
// "Pending Review" bucket agree on which estimates show up. What was
// missing — and what this file adds — is a browser-level rehearsal
// of the full round trip the user actually performs:
//
//   1. The wizard opens on an existing draft.
//   2. The user walks the three steps and clicks Submit for Approval.
//   3. The server returns 500 mid-submit.
//   4. The wizard stays open with the user's work intact, and only
//      one API call was attempted — no partial PUT, no half-flipped
//      status, no duplicate retry.
//   5. The user clicks Submit again, the server accepts, the wizard
//      closes, and the estimate now appears in both the admin
//      "Pending Approval" list (`/api/estimates/pending-approval`)
//      and the manager "Pending Review" lifecycle bucket (the
//      lifecycle helper that drives the manager board).
//
// We mock `fetch` with a tiny in-memory "server" that mirrors the
// real `POST /submit-for-review` semantics: only drafts may be
// submitted, and the status flip lives in the same transaction as
// the content update so a failure leaves nothing behind. The fake
// also wires up `GET /api/estimates/:id`, `GET /api/customers/:id`,
// `GET /api/estimates`, and `GET /api/estimates/pending-approval`
// so both the wizard and the admin list page can be driven by the
// same backing store, exactly as in production.
//
// The repo does not run Playwright/Cypress, so we use Vitest +
// React Testing Library to mount the real components and drive
// them through the same network surface. This is the closest the
// suite can get to a true browser-level test without adding a new
// runner.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { PointerEventsCheckLevel } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { EstimateWizard } from "./estimate-wizard";
import EstimatesPendingApproval from "@/pages/estimates-pending-approval";
import { EstimateBoard } from "./board/estimate-board";
import { getQueryFn } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { computeLifecycleStatus } from "@workspace/shared";

// ---------------------------------------------------------------
// In-memory fake server
// ---------------------------------------------------------------

interface FakeItem {
  id: number;
  partId: number;
  partName: string;
  partPrice: string;
  quantity: number;
  laborHours: string;
  totalPrice: string;
  description: string;
  sortOrder: number;
}

interface FakeEstimate {
  id: number;
  companyId: number;
  estimateNumber: string;
  customerId: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  projectName: string;
  projectAddress: string;
  locationNotes: string;
  accessInstructions: string;
  workDescription: string;
  status: string;
  internalStatus: string;
  partsSubtotal: string;
  laborSubtotal: string;
  totalAmount: string;
  laborRate: string;
  appliedLaborRate: string;
  laborMode: "flat" | "per_part";
  totalLaborHours: string;
  photos: string[];
  attachments: string[];
  workLocationLat: string | null;
  workLocationLng: string | null;
  workLocationAddress: string | null;
  controllerLetter: string | null;
  zoneNumber: number | null;
  createdBy: string;
  createdAt: string;
  estimateDate: string;
  items: FakeItem[];
}

interface FakeServer {
  estimates: Map<number, FakeEstimate>;
  customers: Map<number, { id: number; name: string; email: string; phone: string; address: string; laborRate: string | null }>;
  /** Counter for each method/url so the test can assert exact call counts. */
  calls: Array<{ url: string; method: string; status: number }>;
  /** If >0, the next N POST /submit-for-review requests fail with 500. */
  forceSubmitFailures: number;
}

function seedServer(): FakeServer {
  const customer = {
    id: 1,
    name: "Acme Orchards",
    email: "ops@acme.example",
    phone: "555-0100",
    address: "1 Orchard Way",
    laborRate: "55.00",
  };
  const estimate: FakeEstimate = {
    id: 1,
    companyId: 1,
    estimateNumber: "EST-0001",
    customerId: 1,
    customerName: customer.name,
    customerEmail: customer.email,
    customerPhone: customer.phone,
    projectName: "North field controller",
    projectAddress: customer.address,
    locationNotes: "",
    accessInstructions: "",
    workDescription: "Install new controller",
    status: "pending",
    internalStatus: "draft",
    partsSubtotal: "100.00",
    laborSubtotal: "55.00",
    totalAmount: "155.00",
    laborRate: "55.00",
    appliedLaborRate: "55.00",
    laborMode: "flat",
    totalLaborHours: "1.00",
    photos: [],
    attachments: [],
    workLocationLat: null,
    workLocationLng: null,
    workLocationAddress: null,
    controllerLetter: null,
    zoneNumber: null,
    createdBy: "Manager Mae",
    createdAt: new Date().toISOString(),
    estimateDate: new Date().toISOString(),
    items: [
      {
        id: 1,
        partId: 1,
        partName: "Controller",
        partPrice: "100.00",
        quantity: 1,
        laborHours: "0.00",
        totalPrice: "100.00",
        description: "",
        sortOrder: 0,
      },
    ],
  };
  return {
    estimates: new Map([[estimate.id, estimate]]),
    customers: new Map([[customer.id, customer]]),
    calls: [],
    forceSubmitFailures: 0,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetch(server: FakeServer): void {
  const fakeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const record = (status: number) => server.calls.push({ url, method, status });

    // GET /api/estimates/pending-approval — must be tested BEFORE the
    // `/api/estimates/:id` matcher so the literal path wins.
    if (method === "GET" && url === "/api/estimates/pending-approval") {
      const rows = Array.from(server.estimates.values()).filter(
        (e) =>
          e.internalStatus === "pending_approval" ||
          e.internalStatus === "approved_internal",
      );
      record(200);
      return jsonResponse(rows);
    }
    if (method === "GET" && url === "/api/estimates") {
      record(200);
      return jsonResponse(Array.from(server.estimates.values()));
    }
    const estIdMatch = /^\/api\/estimates\/(\d+)$/.exec(url);
    if (method === "GET" && estIdMatch) {
      const e = server.estimates.get(Number(estIdMatch[1]));
      if (!e) {
        record(404);
        return jsonResponse({ message: "not found" }, 404);
      }
      record(200);
      return jsonResponse(e);
    }
    const custIdMatch = /^\/api\/customers\/(\d+)$/.exec(url);
    if (method === "GET" && custIdMatch) {
      const c = server.customers.get(Number(custIdMatch[1]));
      if (!c) {
        record(404);
        return jsonResponse({ message: "not found" }, 404);
      }
      record(200);
      return jsonResponse(c);
    }

    const submitMatch = /^\/api\/estimates\/(\d+)\/submit-for-review$/.exec(url);
    if (method === "POST" && submitMatch) {
      const id = Number(submitMatch[1]);
      const e = server.estimates.get(id);
      if (!e) {
        record(404);
        return jsonResponse({ message: "Estimate not found" }, 404);
      }
      if (e.internalStatus !== "draft") {
        // Mirrors the real server's 409: only drafts may transition.
        // If the wizard ever fired this twice in a row by mistake, the
        // second call would land here — the test asserts this never
        // happens.
        record(409);
        return jsonResponse(
          { message: "Estimate is not a draft", internalStatus: e.internalStatus },
          409,
        );
      }
      if (server.forceSubmitFailures > 0) {
        server.forceSubmitFailures -= 1;
        // The atomicity contract: NEITHER the content write NOR the
        // status flip happens when the submit fails. We deliberately
        // do NOT mutate `e` here.
        record(500);
        return jsonResponse({ message: "Database write failed" }, 500);
      }
      // Apply the request payload (just the fields the wizard cares
      // about for retrying) and flip status in one shot.
      try {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (body?.estimate?.workDescription !== undefined) {
          e.workDescription = String(body.estimate.workDescription);
        }
      } catch {
        // ignore — the wizard always sends JSON
      }
      e.internalStatus = "pending_approval";
      record(200);
      return jsonResponse(e);
    }

    // PUT /api/estimates/:id — the test must NEVER see this hit while
    // a draft is being submitted (the atomicity contract). We still
    // implement it so an accidental call shows up as a recorded miss
    // we can assert against.
    if (method === "PUT" && estIdMatch) {
      const id = Number(estIdMatch[1]);
      const e = server.estimates.get(id);
      if (!e) {
        record(404);
        return jsonResponse({ message: "not found" }, 404);
      }
      record(200);
      return jsonResponse(e);
    }

    // Anything else (e.g. notification poller, /api/health probes
    // triggered by other module init) — answer with an empty payload
    // so the wizard isn't blocked by an unrelated 404.
    record(200);
    return jsonResponse([]);
  });
  // jsdom's `fetch` is undefined; assign directly.
  (globalThis as unknown as { fetch: typeof fakeFetch }).fetch = fakeFetch;
}

// ---------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------

function makeQueryClient(): QueryClient {
  // Mirror the production defaults (notably the default `queryFn` from
  // `getQueryFn`), otherwise `useQuery({ queryKey: [...] })` calls
  // without an explicit queryFn — like the wizard's existing-estimate
  // hydration query — never fire.
  return new QueryClient({
    defaultOptions: {
      queries: {
        queryFn: getQueryFn({ on401: "throw" }),
        retry: false,
        gcTime: 0,
        staleTime: 0,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}

function renderWizard(queryClient: QueryClient) {
  function Host() {
    const [open, setOpen] = React.useState(true);
    return (
      <>
        <EstimateWizard
          open={open}
          onOpenChange={setOpen}
          estimateId={1}
        />
        <Toaster />
        <div data-testid="wizard-open">{open ? "open" : "closed"}</div>
      </>
    );
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <Host />
    </QueryClientProvider>,
  );
}

function renderPendingApproval(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <EstimatesPendingApproval />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------
// Tests
// ---------------------------------------------------------------

describe("Wizard submit retry — full round trip (Task #610)", () => {
  let server: FakeServer;

  beforeEach(() => {
    server = seedServer();
    installFetch(server);
    // The wizard's apiRequest and getQueryFn both stamp user headers
    // from localStorage.user; the fake server ignores them but the
    // client code paths assume the value parses as JSON.
    window.localStorage.clear();
    window.localStorage.setItem(
      "user",
      JSON.stringify({ id: 7, role: "billing_manager", name: "Manager Mae", companyId: 1 }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("retries a 500 mid-submit without partial state, then makes the estimate visible in both the admin Pending Approval list and the manager Pending Review bucket", async () => {
    // Radix Dialog leaves a `pointer-events: none` on the body while
    // the dialog is open; userEvent's default pointer-events check
    // would refuse to click. Disable the check — we're driving the
    // dialog programmatically and the production browser flow is
    // already exercised by manual QA.
    const user = userEvent.setup({
      pointerEventsCheck: PointerEventsCheckLevel.Never,
    });
    server.forceSubmitFailures = 1; // first submit fails, second succeeds

    const queryClient = makeQueryClient();
    renderWizard(queryClient);

    // Wait for the wizard to hydrate from GET /api/estimates/1 +
    // GET /api/customers/1. Once hydration completes, the header's
    // context line gets stamped with the customer + project name
    // (`Acme Orchards · North field controller`) — that's our cue
    // the wizard now has the existing estimate's data loaded.
    await waitFor(() =>
      expect(screen.getByTestId("wizard-header-context").textContent).toMatch(
        /Acme Orchards/,
      ),
    );

    // Step 1 → 2 → 3. The continue buttons are enabled because the
    // hydrated customer step already has a customer + project name,
    // and step 2 already has the seeded line item.
    await waitFor(() =>
      expect(screen.getByTestId("wizard-continue-1")).not.toBeDisabled(),
    );
    await user.click(screen.getByTestId("wizard-continue-1"));
    await waitFor(() =>
      expect(screen.getByTestId("wizard-continue-2")).not.toBeDisabled(),
    );
    await user.click(screen.getByTestId("wizard-continue-2"));

    const submitButton = await screen.findByTestId("wizard-submit");

    // First submit click — server returns 500.
    await user.click(submitButton);

    // The error toast appears and the wizard stays open. The atomic
    // endpoint either fully landed or rolled back, so the user's
    // changes are still here.
    await screen.findByText(/Couldn't submit for review/i);
    expect(screen.getByTestId("wizard-open").textContent).toBe("open");

    // Atomicity: exactly one submit-for-review attempt, no PUT, no
    // /transition. Server-side, the estimate is still a draft.
    const submitAttempts = server.calls.filter(
      (c) => c.method === "POST" && c.url === "/api/estimates/1/submit-for-review",
    );
    expect(submitAttempts).toHaveLength(1);
    expect(submitAttempts[0].status).toBe(500);
    expect(
      server.calls.some(
        (c) => c.method === "PUT" && c.url === "/api/estimates/1",
      ),
    ).toBe(false);
    expect(
      server.calls.some((c) => c.url.includes("/transition")),
    ).toBe(false);
    expect(server.estimates.get(1)!.internalStatus).toBe("draft");

    // Click Submit again — server accepts, wizard closes.
    await user.click(await screen.findByTestId("wizard-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("wizard-open").textContent).toBe("closed");
    });

    // Second attempt landed and the only POSTs we ever made were the
    // failed retry + the successful retry. No PUT slipped in.
    const allSubmits = server.calls.filter(
      (c) => c.method === "POST" && c.url === "/api/estimates/1/submit-for-review",
    );
    expect(allSubmits.map((c) => c.status)).toEqual([500, 200]);
    expect(
      server.calls.filter(
        (c) => c.method === "PUT" && c.url === "/api/estimates/1",
      ),
    ).toHaveLength(0);
    expect(server.estimates.get(1)!.internalStatus).toBe("pending_approval");

    // Manager "Pending Review" parity — the same lifecycle helper
    // the manager board uses must put this estimate in pending_review.
    const lifecycle = computeLifecycleStatus(server.estimates.get(1)!);
    expect(lifecycle).toBe("pending_review");

    // And actually mount the manager board with the persisted estimate
    // and confirm the card lands in the Pending Review column, not
    // just that the lifecycle helper agrees.
    const boardClient = makeQueryClient();
    const persisted = server.estimates.get(1)!;
    render(
      <QueryClientProvider client={boardClient}>
        <EstimateBoard
          estimates={[persisted as any]}
          isLoading={false}
          isError={false}
          onCardClick={() => {}}
          onRefresh={() => {}}
          onNewEstimate={() => {}}
        />
      </QueryClientProvider>,
    );
    const pendingColumn = await screen.findByTestId(
      "board-column-pending_review",
    );
    expect(
      within(pendingColumn).getByTestId(`board-card-${persisted.id}`),
    ).toBeInTheDocument();
    boardClient.clear();

    // Now mount the admin "Pending Approval" page against the same
    // fake backend and assert the row shows up. Use a fresh
    // QueryClient so we hit the real `/api/estimates/pending-approval`
    // endpoint instead of any stale wizard cache.
    const adminClient = makeQueryClient();
    renderPendingApproval(adminClient);

    const table = await screen.findByRole("table");
    await within(table).findByText("EST-0001");
    expect(within(table).getByText("Acme Orchards")).toBeInTheDocument();
    expect(within(table).getByText("North field controller")).toBeInTheDocument();

    // And the page actually loaded its data from our fake server.
    expect(
      server.calls.some(
        (c) =>
          c.method === "GET" &&
          c.url === "/api/estimates/pending-approval" &&
          c.status === 200,
      ),
    ).toBe(true);

    adminClient.clear();
    queryClient.clear();
  });
});
