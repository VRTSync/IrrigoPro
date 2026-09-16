/**
 * Task #2027 — the client's share of one QuickBooks verdict.
 *
 * Replaces `pages/financial-pulse-qb-banner.test.ts`, which tested
 * `isQbUnhealthy` — a second definition of health that lived in the page and
 * could contradict the server's. That function is gone; what is left on the
 * client is wording, and wording is what this file tests.
 *
 * The banner's old copy asserted "invoice totals may be out of date" whatever
 * the cause, so the two assertions that matter are: nothing warns when nothing
 * is wrong, and when something is wrong the sentence names *that* thing.
 */

import { describe, it, expect } from "vitest";
import {
  formatQbWhen,
  qbHealthBannerMessage,
  qbHealthIsWarning,
  qbHealthPillLabel,
  qbHealthReasonPhrase,
  qbHealthTone,
  type QuickBooksHealth,
} from "./quickbooks-health";

function health(over: Partial<QuickBooksHealth> = {}): QuickBooksHealth {
  return {
    state: "ok",
    reason: "healthy",
    connectionStatus: "connected",
    reconnectRequiredReason: null,
    lastSyncAt: "2026-09-15T08:25:04.000Z",
    lastPaymentSyncAt: "2026-09-15T08:25:04.000Z",
    pendingSync: 0,
    recentErrorCount: 0,
    ...over,
  };
}

describe("Task #2027 — the Financial Pulse banner", () => {
  it("says nothing when QuickBooks is healthy", () => {
    expect(qbHealthBannerMessage(health())).toBeNull();
    expect(qbHealthIsWarning(health())).toBe(false);
  });

  it("says nothing when no integration has ever been connected", () => {
    // A warning that is permanently on carries no information, which is how
    // warnings get trained out of people.
    const unset = health({ state: "unknown", reason: "not_configured" });
    expect(qbHealthBannerMessage(unset)).toBeNull();
    expect(qbHealthTone(unset)).toBe("neutral");
  });

  it("says nothing at all when the verdict could not be read", () => {
    expect(qbHealthBannerMessage(null)).toBeNull();
    expect(qbHealthBannerMessage(undefined)).toBeNull();
  });

  it("names the backlog, and does not blame the connection for it", () => {
    const msg = qbHealthBannerMessage(
      health({ state: "degraded", reason: "sync_backlog", pendingSync: 12 }),
    )!;
    expect(msg).toContain("12 items");
    expect(msg).toMatch(/waiting to reach QuickBooks/);
    // A backlog means QuickBooks is behind this app, not that this app is wrong.
    expect(msg).not.toMatch(/reconnect/i);
  });

  it("names the reconnect reason when the connection is down", () => {
    const msg = qbHealthBannerMessage(
      health({
        state: "down",
        reason: "connection",
        connectionStatus: "reconnect_required",
        reconnectRequiredReason: "Refresh token revoked",
      }),
    )!;
    expect(msg).toMatch(/needs reconnecting/);
    expect(msg).toContain("Refresh token revoked");
  });

  it("splices QuickBooks' own reason in without doubling its full stop", () => {
    // Intuit's live string ends in a period and is spliced mid-sentence.
    const msg = qbHealthBannerMessage(
      health({
        state: "down",
        reason: "connection",
        connectionStatus: "reconnect_required",
        reconnectRequiredReason:
          "Refresh token expired (invalid_grant). Please reauthorize QuickBooks.",
      }),
    )!;
    expect(msg).not.toMatch(/\.\./);
    expect(msg).toContain("needs reconnecting — Refresh token expired");
    expect(msg).toContain("Please reauthorize QuickBooks. Payments");
  });

  it("names the last successful sync — the strip showed it and the banner did not", () => {
    const msg = qbHealthBannerMessage(
      health({
        state: "down",
        reason: "connection",
        connectionStatus: "disconnected",
        lastSyncAt: "2026-09-14T13:25:04.000Z",
      }),
    )!;
    expect(msg).toContain(formatQbWhen("2026-09-14T13:25:04.000Z")!);
  });

  it("names the stale payment read, and what it does to the money on the page", () => {
    const msg = qbHealthBannerMessage(
      health({
        state: "degraded",
        reason: "stale_payment_sync",
        lastPaymentSyncAt: "2026-09-12T13:25:04.000Z",
      }),
    )!;
    expect(msg).toMatch(/payments were last read/i);
    // A stale read still shows a real QuickBooks balance, just an old one.
    // `isBalanceFallback` is false while `paymentSyncedAt` is present, so the
    // banner must not claim the figures reverted to invoice totals.
    expect(msg).toMatch(/not reflected/i);
    expect(msg).not.toMatch(/invoice total/i);
  });

  it("only a payment read that never ran is described as falling back to totals", () => {
    const msg = qbHealthBannerMessage(
      health({ state: "degraded", reason: "stale_payment_sync", lastPaymentSyncAt: null }),
    )!;
    expect(msg).toMatch(/never been read/i);
    expect(msg).toMatch(/invoice total/i);
  });
});

describe("Task #2027 — the invoices pill and the strip render the same verdict", () => {
  it("a healthy company reads up to date, not just green", () => {
    expect(qbHealthPillLabel(health())).toMatch(/up to date/);
    expect(qbHealthReasonPhrase(health())).toBeNull();
  });

  it("the pill no longer says a bare 'out of date' for a live connection", () => {
    // The observed defect: the header read "QuickBooks: out of date" off one
    // timestamp while two other screens read the connection and said ok.
    const stale = health({
      state: "degraded",
      reason: "stale_payment_sync",
      lastPaymentSyncAt: "2026-09-12T13:25:04.000Z",
    });
    expect(qbHealthPillLabel(stale)).toBe("QuickBooks: payments out of date");
    expect(qbHealthReasonPhrase(stale)).toMatch(/payments not read/);
  });

  it("a down connection reads as needing reconnection on both surfaces", () => {
    const down = health({
      state: "down",
      reason: "connection",
      connectionStatus: "expired",
    });
    expect(qbHealthPillLabel(down)).toMatch(/needs reconnecting/);
    expect(qbHealthReasonPhrase(down)).toMatch(/needs reattention/);
    expect(qbHealthTone(down)).toBe("bad");
  });

  it("a backlog reads as a backlog on both surfaces", () => {
    const backlog = health({ state: "degraded", reason: "sync_backlog", pendingSync: 4 });
    expect(qbHealthPillLabel(backlog)).toBe("QuickBooks: sync behind");
    expect(qbHealthReasonPhrase(backlog)).toBe("4 waiting to sync");
    expect(qbHealthTone(backlog)).toBe("warn");
  });

  it("an unconnected company reads as not connected, not as broken", () => {
    const none = health({ state: "unknown", reason: "not_configured" });
    expect(qbHealthPillLabel(none)).toBe("QuickBooks: not connected");
    expect(qbHealthIsWarning(none)).toBe(false);
  });
});
