/**
 * Task #2027 — the client side of one QuickBooks verdict.
 *
 * Three screens used to answer "is QuickBooks working?" three different ways in
 * the same minute: Financial Pulse tested a status string against a set of its
 * own, Manager Workspace read the server's derivation, and the invoices header
 * compared one timestamp to a 24-hour clock. At most one of them could be
 * right, and the bookkeeper had no way to tell which.
 *
 * The verdict is now decided once, on the server, in
 * `api-server/src/routes/quickbooks-health.ts`, and arrives on requests each
 * page already makes. Nothing in this file decides health. It turns the shared
 * verdict into each surface's own words — a one-line banner, a compact pill, a
 * phrase under the strip — which is the one thing the three surfaces are
 * allowed to differ on.
 */

export type QbHealthState = "ok" | "degraded" | "down" | "unknown";

export type QbHealthReason =
  | "healthy"
  | "not_configured"
  | "connection"
  | "sync_backlog"
  | "stale_payment_sync";

/** Exactly the object the three endpoints return. */
export interface QuickBooksHealth {
  state: QbHealthState;
  reason: QbHealthReason;
  connectionStatus: string | null;
  reconnectRequiredReason: string | null;
  lastSyncAt: string | null;
  lastPaymentSyncAt: string | null;
  pendingSync: number;
  recentErrorCount: number;
}

export type QbHealthTone = "ok" | "warn" | "bad" | "neutral";

export function qbHealthTone(health: QuickBooksHealth): QbHealthTone {
  switch (health.state) {
    case "ok":
      return "ok";
    case "degraded":
      return "warn";
    case "down":
      return "bad";
    default:
      return "neutral";
  }
}

/** True when a surface should be showing the reader something is wrong. */
export function qbHealthIsWarning(health: QuickBooksHealth): boolean {
  return health.state === "degraded" || health.state === "down";
}

export function formatQbWhen(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The Financial Pulse banner, one line.
 *
 * It used to assert "invoice totals may be out of date" whatever the cause. A
 * connection that needs reattention, a sync backlog and a stale payment read
 * are three different problems with three different answers, and only two of
 * them touch the totals on that page at all — a backlog means QuickBooks is
 * behind this app, not that this app is wrong.
 *
 * Returns null when there is nothing to warn about, including when QuickBooks
 * has simply never been connected: a banner that is permanently on carries no
 * information, which is how a real outage goes unread.
 */
export function qbHealthBannerMessage(
  health: QuickBooksHealth | null | undefined,
): string | null {
  if (!health || !qbHealthIsWarning(health)) return null;
  const lastSync = formatQbWhen(health.lastSyncAt);

  switch (health.reason) {
    case "connection": {
      // QuickBooks' own reason strings usually end in a full stop, and this one
      // is spliced mid-sentence — left alone it reads "…reauthorize QuickBooks..".
      const reason = health.reconnectRequiredReason?.trim().replace(/[.\s]+$/, "");
      const detail = reason ? ` — ${reason}` : "";
      if (health.state === "down") {
        return `QuickBooks needs reconnecting${detail}. Payments and invoice totals stopped updating${
          lastSync ? ` after the last successful sync on ${lastSync}` : ""
        }.`;
      }
      return `QuickBooks is returning errors${detail}. Invoice totals may be out of date${
        lastSync ? ` — last successful sync ${lastSync}` : ""
      }.`;
    }
    case "sync_backlog": {
      const n = health.pendingSync;
      const errors =
        health.recentErrorCount > 0
          ? `, ${health.recentErrorCount} of them failing`
          : "";
      return `${n} item${n === 1 ? "" : "s"} ${
        n === 1 ? "is" : "are"
      } waiting to reach QuickBooks${errors}. QuickBooks is behind these figures, not ahead of them.`;
    }
    case "stale_payment_sync": {
      // These are two different figures, not two wordings of one. A stale read
      // still shows the balance QuickBooks last reported — old, but a real
      // balance. Only a payment read that never ran makes `isBalanceFallback`
      // true, and only then is the amount owed the invoice total. Saying
      // "falls back to the invoice total" for a stale read misstates what is
      // on screen, which is the failure mode this whole verdict exists to fix.
      const lastRead = formatQbWhen(health.lastPaymentSyncAt);
      return lastRead
        ? `QuickBooks payments were last read on ${lastRead}, more than a day ago. Amounts owed are the balances from that read — any payment taken since is not reflected below.`
        : `QuickBooks payments have never been read for this company, so every amount owed below is the invoice total rather than what is actually owed.`;
    }
    default:
      return null;
  }
}

/** The invoices header pill: compact, same verdict. */
export function qbHealthPillLabel(health: QuickBooksHealth): string {
  switch (health.state) {
    case "ok":
      return "QuickBooks: up to date";
    case "unknown":
      return "QuickBooks: not connected";
    case "down":
      return "QuickBooks: needs reconnecting";
    default:
      break;
  }
  switch (health.reason) {
    case "connection":
      return "QuickBooks: sync errors";
    case "sync_backlog":
      return "QuickBooks: sync behind";
    case "stale_payment_sync":
      return health.lastPaymentSyncAt
        ? "QuickBooks: payments out of date"
        : "QuickBooks: payments never read";
    default:
      return "QuickBooks: needs attention";
  }
}

export function qbHealthPillTitle(health: QuickBooksHealth): string {
  const banner = qbHealthBannerMessage(health);
  if (banner) return banner;
  if (health.state === "unknown") {
    return "No QuickBooks integration is connected for this company, so every amount owed below is the invoice total rather than what is actually owed.";
  }
  const lastRead = formatQbWhen(health.lastPaymentSyncAt);
  return lastRead
    ? `QuickBooks payments last read on ${lastRead}.`
    : "QuickBooks is connected and up to date.";
}

/**
 * The Manager Workspace strip already prints the timestamps and counts; this is
 * the one-clause reason beside them, so the strip says *why* rather than
 * leaving the reader to infer it from a colour.
 */
export function qbHealthReasonPhrase(health: QuickBooksHealth): string | null {
  switch (health.reason) {
    case "healthy":
      return null;
    case "not_configured":
      return "no integration connected";
    case "connection":
      return health.state === "down"
        ? "connection needs reattention"
        : "connection returning errors";
    case "sync_backlog":
      return `${health.pendingSync} waiting to sync`;
    case "stale_payment_sync":
      return health.lastPaymentSyncAt
        ? "payments not read in over a day"
        : "payments never read";
    default:
      return null;
  }
}
