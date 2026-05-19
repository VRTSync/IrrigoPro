// Task #688 — regression guard for the QuickBooks "unhealthy" banner
// detection on /financial-pulse. The bug fixed here was a mismatch
// against the actual `/api/quickbooks/connection-status` payload
// shape: previous logic looked at `connected` / `status`, but the
// real endpoint returns `isConnected` / `connectionStatus`, and the
// canonical unhealthy state — `connectionStatus: 'reconnect_required'`
// — was not covered at all.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isQbUnhealthy } from "./financial-pulse";

describe("Task #688 — isQbUnhealthy", () => {
  it("returns false for a healthy connected payload", () => {
    assert.equal(
      isQbUnhealthy({ isConnected: true, connectionStatus: "connected" }),
      false,
    );
  });

  it("returns true when isConnected is explicitly false", () => {
    assert.equal(isQbUnhealthy({ isConnected: false }), true);
  });

  it("returns true for connectionStatus='reconnect_required'", () => {
    assert.equal(
      isQbUnhealthy({
        isConnected: false,
        connectionStatus: "reconnect_required",
        reconnectRequiredReason: "Token refresh failed",
      }),
      true,
    );
  });

  it("returns true for connectionStatus='error'", () => {
    assert.equal(
      isQbUnhealthy({ isConnected: true, connectionStatus: "error" }),
      true,
    );
  });

  it("returns true for legacy connectionStatus values (disconnected, expired)", () => {
    assert.equal(isQbUnhealthy({ connectionStatus: "disconnected" }), true);
    assert.equal(isQbUnhealthy({ connectionStatus: "expired" }), true);
  });

  it("returns false for an empty / undefined payload (fetch errors fall here)", () => {
    assert.equal(isQbUnhealthy(undefined), false);
    assert.equal(isQbUnhealthy({}), false);
  });

  it("does not flip on a missing connectionStatus when isConnected is true", () => {
    assert.equal(isQbUnhealthy({ isConnected: true }), false);
  });
});
