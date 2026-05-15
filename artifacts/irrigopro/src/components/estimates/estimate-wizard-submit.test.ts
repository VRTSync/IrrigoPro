// Task #606 — Wizard submit-for-review must be a single atomic call.
// The previous flow did PUT then POST /transition; if the second call
// failed, the draft kept its new content but the status was never
// flipped, so the manager's "Pending Review" bucket and the admin's
// "Pending Approval" list disagreed. This file pins down:
//
//  1. Draft + submit → single POST /api/estimates/:id/submit-for-review,
//     no separate /transition leg.
//  2. New estimate → POST /api/estimates (unchanged).
//  3. Save-as-draft on an existing estimate → PUT, no transition.
//  4. Non-draft edit + submit → PUT, no transition.
//  5. Network failure mid-submit propagates as a rejection (the wizard's
//     mutation onError keeps the dialog open and shows a retry toast).
//     Crucially, only one API call is attempted — there is no PUT that
//     could leave the estimate half-submitted.

import { describe, it, expect } from "vitest";
import { submitEstimate, type ApiRequest } from "./estimate-wizard-submit";

interface Call {
  url: string;
  method: string;
  body?: unknown;
}

function recorder(
  handler?: (call: Call) => unknown,
): { calls: Call[]; apiRequest: ApiRequest } {
  const calls: Call[] = [];
  const apiRequest: ApiRequest = async (url, method, body) => {
    const call: Call = { url, method, body };
    calls.push(call);
    return handler ? await handler(call) : { id: 42 };
  };
  return { calls, apiRequest };
}

describe("submitEstimate — atomic wizard submit (Task #606)", () => {
  it("draft + submit makes a single POST to /submit-for-review (no PUT, no /transition)", async () => {
    const { calls, apiRequest } = recorder(() => ({ id: 7, internalStatus: "pending_approval" }));
    const result = await submitEstimate(
      { estimate: {}, items: [] },
      "submit",
      { isEdit: true, isDraftEdit: true, estimateId: 7 },
      apiRequest,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("/api/estimates/7/submit-for-review");
    expect(result.id).toBe(7);
    expect(result.mode).toBe("submit");
  });

  it("new estimate uses POST /api/estimates (creation already atomic)", async () => {
    const { calls, apiRequest } = recorder(() => ({ id: 100 }));
    const result = await submitEstimate(
      { estimate: {}, items: [] },
      "submit",
      { isEdit: false, isDraftEdit: false, estimateId: null },
      apiRequest,
    );
    expect(calls).toEqual([
      { url: "/api/estimates", method: "POST", body: { estimate: {}, items: [] } },
    ]);
    expect(result.id).toBe(100);
  });

  it("draft + save-as-draft uses PUT (no status transition)", async () => {
    const { calls, apiRequest } = recorder();
    await submitEstimate(
      { estimate: {}, items: [] },
      "draft",
      { isEdit: true, isDraftEdit: true, estimateId: 8 },
      apiRequest,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].url).toBe("/api/estimates/8");
  });

  it("non-draft edit + submit uses PUT (no submit-for-review)", async () => {
    const { calls, apiRequest } = recorder();
    await submitEstimate(
      { estimate: {}, items: [] },
      "submit",
      { isEdit: true, isDraftEdit: false, estimateId: 9 },
      apiRequest,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].url).toBe("/api/estimates/9");
  });

  it("propagates a network failure on submit-for-review without making any other API call", async () => {
    // Simulate the connection dropping mid-submit. Previously the wizard
    // would have a successful PUT followed by a failed /transition,
    // leaving the draft with new content but stale status. With the
    // atomic endpoint there is exactly one call, it fails, and the
    // wizard's mutation onError will keep the dialog open for retry —
    // there is no partial write to clean up.
    const { calls, apiRequest } = recorder(() => {
      throw new Error("Network request failed");
    });
    await expect(
      submitEstimate(
        { estimate: {}, items: [] },
        "submit",
        { isEdit: true, isDraftEdit: true, estimateId: 11 },
        apiRequest,
      ),
    ).rejects.toThrow("Network request failed");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/estimates/11/submit-for-review");
  });
});
