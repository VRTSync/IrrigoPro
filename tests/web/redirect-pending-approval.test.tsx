// Task #683 — Mount the redirect shim and confirm wouter navigates
// from /estimates/pending-approval to /estimates/command-center.
// This guards the "tile click from a stale notification still lands
// on the new Command Center" path the migration depends on.

import { describe, it, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import React from "react";

import RedirectPendingApprovalToCC from "../../artifacts/irrigopro/src/components/estimates/redirect-to-command-center";

function LocationProbe() {
  const [loc] = useLocation();
  return <div data-testid="loc">{loc}</div>;
}

describe("RedirectPendingApprovalToCC", () => {
  it("navigates from /estimates/pending-approval to /estimates/command-center", async () => {
    const { hook, history } = memoryLocation({
      path: "/estimates/pending-approval",
      record: true,
    });
    const { getByTestId } = render(
      <Router hook={hook}>
        <RedirectPendingApprovalToCC />
        <LocationProbe />
      </Router>,
    );
    await waitFor(() => {
      expect(getByTestId("loc").textContent).toBe("/estimates/command-center");
    });
    // The latest history entry should be the command-center route.
    expect(history[history.length - 1]).toBe("/estimates/command-center");
  });
});
