// Task #2027 — one QuickBooks verdict, shared by every surface that shows one.
//
// Three screens used to answer "is QuickBooks working?" three different ways in
// the same minute:
//
//   Financial Pulse   flat set-membership over /api/quickbooks/connection
//   Manager Workspace loadQbSyncStatus (this file)
//   Invoices header   a 24-hour clock over one timestamp
//
// The first one asked the connection endpoint, which resolves the *caller's own*
// company — and a super_admin has none, so it answered `disconnected` forever
// while the strip read the cross-tenant rollup and correctly said ok. See the
// step-1 diagnosis in .local/tasks/task-2027.md.
//
// Everything below is the single derivation. A surface may render more or less
// of it, but no surface derives health from a status string, a row count or a
// clock of its own. `deriveQbHealth` is pure and is where the rules live;
// `loadQbSyncStatus` only gathers the facts it needs.

import { and, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import {
  customers,
  estimates,
  invoices,
  quickbooksIntegration,
  quickbooksSync,
} from "@workspace/db/schema";
import { db } from "../db";

// ── Wire + internal shapes ──────────────────────────────────────────────────

export interface QbSyncError {
  id: number;
  estimateId: number | null;
  errorMessage: string;
  occurredAt: string | null;
  source: "estimate_sync" | "integration";
}

export type QbHealthState = "ok" | "degraded" | "down" | "unknown";

/**
 * Why the state is what it is. The banner, the pill and the strip each phrase
 * this differently, but none of them may infer it: a broken connection, a sync
 * backlog and a stale payment read are three different problems and used to
 * share one sentence.
 */
export type QbHealthReason =
  | "healthy"
  | "not_configured"
  | "connection"
  | "sync_backlog"
  | "stale_payment_sync";

export interface QbSyncStatus {
  state: QbHealthState;
  reason: QbHealthReason;
  connectionStatus: string | null;
  reconnectRequiredReason: string | null;
  lastSyncAt: string | null;
  /**
   * The company's newest `invoices.payment_synced_at`. Since #2013 the balance
   * rule falls back to the invoice total when this is absent, so it is a cause
   * of "totals may be out of date", not a side fact about one page.
   */
  lastPaymentSyncAt: string | null;
  pendingSync: number;
  recentErrors: QbSyncError[];
}

/**
 * The projection every surface puts on the wire. Three endpoints returning this
 * same object is the contract this ticket exists to create — a surface that
 * wants more detail adds fields beside it, never a second verdict.
 */
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

export function toQuickBooksHealth(status: QbSyncStatus): QuickBooksHealth {
  return {
    state: status.state,
    reason: status.reason,
    connectionStatus: status.connectionStatus,
    reconnectRequiredReason: status.reconnectRequiredReason,
    lastSyncAt: status.lastSyncAt,
    lastPaymentSyncAt: status.lastPaymentSyncAt,
    pendingSync: status.pendingSync,
    recentErrorCount: status.recentErrors.length,
  };
}

// ── The derivation ──────────────────────────────────────────────────────────

/** A payment read older than this stops backing the balances it feeds. */
export const QB_PAYMENT_SYNC_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Connection statuses, worst last. The rank is severity order, so the
 * super_admin rollup's "worst wins" and the state mapping below cannot
 * disagree — they used to: `disconnected` ranked *below* `error` yet mapped to
 * the worse state, so one fully disconnected tenant beside one erroring tenant
 * reported the milder of the two.
 *
 * `expired` is here because the flat client-side set treated it as unhealthy
 * and this table did not, which is the regression that surfaced the ticket. No
 * writer persists it today; ranking it means the day one does, the strip and
 * the banner move together.
 */
export const QB_CONNECTION_RANK: Record<string, number> = {
  connected: 0,
  error: 1,
  disconnected: 2,
  expired: 3,
  reconnect_required: 4,
};

/**
 * An unrecognised status is not evidence of health. It ranks with `error`
 * (degraded, visible) rather than with `connected` — falling back to 0 is how
 * `expired` became invisible.
 */
export const QB_UNKNOWN_STATUS_RANK = QB_CONNECTION_RANK.error;

export function qbConnectionRank(status: string | null | undefined): number {
  if (!status) return QB_UNKNOWN_STATUS_RANK;
  const known = QB_CONNECTION_RANK[status];
  return known === undefined ? QB_UNKNOWN_STATUS_RANK : known;
}

/** The worst connection status across the integrations in scope. */
export function worstConnectionStatus<T extends { connectionStatus: string | null }>(
  integrations: readonly T[],
): T | null {
  let worst: T | null = null;
  for (const intg of integrations) {
    if (worst === null || qbConnectionRank(intg.connectionStatus) > qbConnectionRank(worst.connectionStatus)) {
      worst = intg;
    }
  }
  return worst;
}

/** Statuses that mean QuickBooks cannot be reached until a human reconnects. */
const DOWN_STATUSES = new Set(["disconnected", "expired", "reconnect_required"]);

export interface QbHealthFacts {
  /** How many integration rows are in scope. Zero is "not configured". */
  integrationCount: number;
  /** The worst status across those rows. */
  connectionStatus: string | null;
  failedSyncCount: number;
  /** Queued invoices + pending sync rows. */
  pendingSync: number;
  lastPaymentSyncAt: string | null;
  now: Date;
}

/**
 * The one place QuickBooks health is decided.
 *
 * Severity order is deliberate and is the whole point of the reason field: a
 * connection that needs reattention outranks a backlog, which outranks a stale
 * payment read. The mildest input can only move an otherwise-healthy company to
 * `degraded`, never mask a worse one.
 */
export function deriveQbHealth(
  facts: QbHealthFacts,
): { state: QbHealthState; reason: QbHealthReason } {
  if (facts.integrationCount === 0) {
    // No integration row is not a failure — nobody has connected QuickBooks.
    // Reporting it as a failure is how a banner stays on forever and stops
    // being read. The surfaces render this as "not connected", not as a fault.
    return { state: "unknown", reason: "not_configured" };
  }

  const status = facts.connectionStatus;
  if (status && DOWN_STATUSES.has(status)) {
    return { state: "down", reason: "connection" };
  }
  if (qbConnectionRank(status) > QB_CONNECTION_RANK.connected) {
    // `error`, or a status this build does not recognise.
    return { state: "degraded", reason: "connection" };
  }

  if (facts.failedSyncCount > 0 || facts.pendingSync > 0) {
    return { state: "degraded", reason: "sync_backlog" };
  }

  if (isPaymentSyncStale(facts.lastPaymentSyncAt, facts.now)) {
    return { state: "degraded", reason: "stale_payment_sync" };
  }

  return { state: "ok", reason: "healthy" };
}

/** Never-synced counts as stale: the balances are invoice totals either way. */
export function isPaymentSyncStale(
  lastPaymentSyncAt: string | null | undefined,
  now: Date,
): boolean {
  if (!lastPaymentSyncAt) return true;
  const at = new Date(lastPaymentSyncAt).getTime();
  if (!Number.isFinite(at)) return true;
  return now.getTime() - at > QB_PAYMENT_SYNC_STALE_AFTER_MS;
}

// ── Tenant scope ────────────────────────────────────────────────────────────

/**
 * One scoping rule for the verdict, resolved here rather than at each caller.
 *
 * `all` is the cross-tenant rollup a super_admin has always had from the
 * Manager Workspace strip. A scoped caller is pinned to her own company and a
 * `companyId` override from her is ignored, so the parameter can never widen a
 * view — the callers that pass one (the invoice list, Financial Pulse) have
 * already resolved it through their own scope contract, and passing it through
 * is what keeps the verdict describing the same population as the numbers
 * printed beside it.
 */
export type QbScope =
  | { kind: "all" }
  | { kind: "company"; companyId: number }
  | { kind: "none" };

export interface QbHealthOptions {
  /**
   * Company the calling surface has already resolved. `null` means "every
   * company" and is honoured for a super_admin only. Omit it to use the
   * caller's own company.
   */
  companyId?: number | null;
  /**
   * The newest `payment_synced_at` the caller has already computed over the
   * same population. Supplied by the invoice aggregate so the pill and the
   * `lastPaymentSyncAt` it prints cannot come from two different reads.
   */
  lastPaymentSyncAt?: string | null;
  now?: Date;
}

export function resolveQbScope(req: any, opts: QbHealthOptions = {}): QbScope {
  if (req?.authenticatedUserRole === "super_admin") {
    if ("companyId" in opts) {
      return opts.companyId == null ? { kind: "all" } : { kind: "company", companyId: opts.companyId };
    }
    return { kind: "all" };
  }
  const cid: number | null = req?.authenticatedUserCompanyId ?? null;
  return cid == null ? { kind: "none" } : { kind: "company", companyId: cid };
}

// ── Fact gathering ──────────────────────────────────────────────────────────

async function getScopedQbIntegrations(
  scope: QbScope,
): Promise<Array<typeof quickbooksIntegration.$inferSelect>> {
  if (scope.kind === "none") return [];
  if (scope.kind === "all") return await db.select().from(quickbooksIntegration);
  return await db
    .select()
    .from(quickbooksIntegration)
    .where(eq(quickbooksIntegration.companyId, String(scope.companyId)));
}

/**
 * "Queued" = finalized invoice in scope that has not yet been pushed to
 * QuickBooks. Draft / cancelled / paid don't belong on the queue.
 */
async function countQueuedInvoices(
  scope: QbScope,
  integratedCompanyIds: readonly number[] = [],
): Promise<number> {
  if (scope.kind === "none") return 0;
  const FINAL_STATUSES = ["sent", "pending", "overdue", "partial"];
  if (scope.kind === "all") {
    // Only tenants that actually have an integration have a queue. An invoice
    // at a company nobody connected has nowhere to go and is not waiting on
    // anything, so counting it would report a backlog that no reconnection or
    // sync run could ever clear.
    if (integratedCompanyIds.length === 0) return 0;
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(invoices)
      .innerJoin(customers, eq(invoices.customerId, customers.id))
      .where(
        and(
          inArray(customers.companyId, integratedCompanyIds as number[]),
          isNull(invoices.quickbooksInvoiceId),
          inArray(invoices.status, FINAL_STATUSES),
        ),
      );
    return Number(rows[0]?.n ?? 0);
  }
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(invoices)
    .innerJoin(customers, eq(invoices.customerId, customers.id))
    .where(
      and(
        eq(customers.companyId, scope.companyId),
        isNull(invoices.quickbooksInvoiceId),
        inArray(invoices.status, FINAL_STATUSES),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

export async function getScopedSyncRows(
  scope: QbScope,
  syncStatus: "failed" | "pending",
  limit?: number,
): Promise<Array<typeof quickbooksSync.$inferSelect>> {
  if (scope.kind === "none") return [];
  if (scope.kind === "all") {
    const q = db
      .select()
      .from(quickbooksSync)
      .where(eq(quickbooksSync.syncStatus, syncStatus))
      .orderBy(desc(quickbooksSync.createdAt));
    return limit ? await q.limit(limit) : await q;
  }
  const q = db
    .select({
      id: quickbooksSync.id,
      estimateId: quickbooksSync.estimateId,
      quickbooksEstimateId: quickbooksSync.quickbooksEstimateId,
      quickbooksCustomerId: quickbooksSync.quickbooksCustomerId,
      syncStatus: quickbooksSync.syncStatus,
      syncedAt: quickbooksSync.syncedAt,
      errorMessage: quickbooksSync.errorMessage,
      createdAt: quickbooksSync.createdAt,
    })
    .from(quickbooksSync)
    .innerJoin(estimates, eq(quickbooksSync.estimateId, estimates.id))
    .where(
      and(
        eq(quickbooksSync.syncStatus, syncStatus),
        eq(estimates.companyId, scope.companyId),
      ),
    )
    .orderBy(desc(quickbooksSync.createdAt));
  const rows = limit ? await q.limit(limit) : await q;
  return rows as Array<typeof quickbooksSync.$inferSelect>;
}

async function getLastSyncedRowAt(scope: QbScope): Promise<Date | null> {
  if (scope.kind === "none") return null;
  const rows =
    scope.kind === "all"
      ? await db
          .select({ syncedAt: quickbooksSync.syncedAt })
          .from(quickbooksSync)
          .where(eq(quickbooksSync.syncStatus, "synced"))
          .orderBy(desc(quickbooksSync.syncedAt))
          .limit(1)
      : await db
          .select({ syncedAt: quickbooksSync.syncedAt })
          .from(quickbooksSync)
          .innerJoin(estimates, eq(quickbooksSync.estimateId, estimates.id))
          .where(
            and(
              eq(quickbooksSync.syncStatus, "synced"),
              eq(estimates.companyId, scope.companyId),
            ),
          )
          .orderBy(desc(quickbooksSync.syncedAt))
          .limit(1);
  return rows[0]?.syncedAt ?? null;
}

/**
 * The newest payment read for the scope. Same population the invoice aggregate
 * sums — every invoice in scope, before any filter — because a search that
 * excluded the most recently synced invoice must not report a healthy read as
 * stale.
 *
 * The cross-tenant rollup is the *worst* tenant's read, not a global maximum.
 * Payment sync runs per company, so one tenant syncing five minutes ago would
 * otherwise mask a tenant that has not synced in a week — a false green on the
 * exact signal that says whether the balances can be trusted. This is the same
 * worst-wins rule the connection status already follows; the two must not
 * disagree about which tenant decides the verdict.
 *
 * Only companies that actually have an integration count. A company nobody
 * connected has no payment read to be stale, and letting it drag the rollup
 * down would put a permanent warning in front of every super_admin.
 */
async function loadLastPaymentSyncAt(
  scope: QbScope,
  integratedCompanyIds: readonly number[] = [],
): Promise<Date | null> {
  if (scope.kind === "none") return null;

  if (scope.kind === "all") {
    if (integratedCompanyIds.length === 0) return null;
    const rows = await db
      .select({ companyId: customers.companyId, at: max(invoices.paymentSyncedAt) })
      .from(invoices)
      .innerJoin(customers, eq(invoices.customerId, customers.id))
      .where(inArray(customers.companyId, integratedCompanyIds as number[]))
      .groupBy(customers.companyId);

    const newestPerCompany = new Map<number, number>();
    for (const r of rows) {
      const cid = Number(r.companyId);
      const t = r.at == null ? NaN : new Date(r.at as any).getTime();
      if (!Number.isFinite(t)) continue;
      const prev = newestPerCompany.get(cid);
      if (prev === undefined || t > prev) newestPerCompany.set(cid, t);
    }

    let oldest: number | null = null;
    for (const cid of integratedCompanyIds) {
      const t = newestPerCompany.get(cid);
      // A connected tenant with no payment read at all is the worst case there
      // is, and `null` is exactly how the derivation spells "never synced".
      if (t === undefined) return null;
      if (oldest === null || t < oldest) oldest = t;
    }
    return oldest === null ? null : new Date(oldest);
  }

  const rows = await db
    .select({ at: max(invoices.paymentSyncedAt) })
    .from(invoices)
    .innerJoin(customers, eq(invoices.customerId, customers.id))
    .where(eq(customers.companyId, scope.companyId));
  const at = rows[0]?.at ?? null;
  return at == null ? null : new Date(at as any);
}

// ── The loader every surface calls ──────────────────────────────────────────

export async function loadQbSyncStatus(
  req: any,
  opts: QbHealthOptions = {},
): Promise<QbSyncStatus> {
  const scope = resolveQbScope(req, opts);
  const now = opts.now ?? new Date();
  const integrations = await getScopedQbIntegrations(scope);

  // Most recent successful sync across integrations (token refresh) and
  // per-estimate sync rows.
  let lastSyncMs: number | null = null;
  const considerTs = (v: any): void => {
    if (!v) return;
    const t = new Date(v).getTime();
    if (!Number.isFinite(t)) return;
    if (lastSyncMs == null || t > lastSyncMs) lastSyncMs = t;
  };

  for (const intg of integrations) considerTs(intg.lastRefreshSuccess);

  // Which tenants the rollup is actually answering for. Used to keep the
  // cross-tenant payment-freshness read worst-wins rather than global-max.
  const integratedCompanyIds = Array.from(
    new Set(
      integrations
        .map((i) => Number(i.companyId))
        .filter((n) => Number.isFinite(n)),
    ),
  );

  const worst = worstConnectionStatus(integrations);
  const connectionStatus = worst?.connectionStatus ?? null;
  const reconnectRequiredReason = worst?.reconnectRequiredReason ?? null;

  // A caller-supplied payment read describes one population, so it is only
  // usable when the verdict describes one company too. The cross-tenant rollup
  // has to group per tenant and take the worst — a caller's figure there is a
  // global maximum, and a global maximum is exactly the false green this
  // function exists to prevent.
  const useSuppliedPaymentRead = "lastPaymentSyncAt" in opts && scope.kind !== "all";

  const [failedRows, pendingSyncRows, queuedInvoices, lastSyncedRowAt, paymentSyncFromDb] =
    await Promise.all([
      getScopedSyncRows(scope, "failed", 10),
      getScopedSyncRows(scope, "pending"),
      countQueuedInvoices(scope, integratedCompanyIds),
      getLastSyncedRowAt(scope),
      useSuppliedPaymentRead
        ? Promise.resolve(null)
        : loadLastPaymentSyncAt(scope, integratedCompanyIds),
    ]);

  // syncedAt is set when a row eventually flips to synced, but we still surface
  // the most recent createdAt for the failed rows so the timeline isn't blank
  // on a brand-new tenant.
  for (const r of failedRows) considerTs(r.createdAt);
  considerTs(lastSyncedRowAt);

  const lastPaymentSyncAtDate = useSuppliedPaymentRead
    ? opts.lastPaymentSyncAt
      ? new Date(opts.lastPaymentSyncAt)
      : null
    : paymentSyncFromDb;
  const lastPaymentSyncAt =
    lastPaymentSyncAtDate && Number.isFinite(lastPaymentSyncAtDate.getTime())
      ? lastPaymentSyncAtDate.toISOString()
      : null;

  const pendingSync = queuedInvoices + pendingSyncRows.length;

  const recentErrors: QbSyncError[] = failedRows.map((r) => ({
    id: r.id,
    estimateId: r.estimateId,
    errorMessage: r.errorMessage ?? "Unknown sync error",
    occurredAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
    source: "estimate_sync",
  }));
  if (reconnectRequiredReason) {
    recentErrors.unshift({
      id: -1,
      estimateId: null,
      errorMessage: reconnectRequiredReason,
      occurredAt: null,
      source: "integration",
    });
  }

  const { state, reason } = deriveQbHealth({
    integrationCount: integrations.length,
    connectionStatus,
    failedSyncCount: failedRows.length,
    pendingSync,
    lastPaymentSyncAt,
    now,
  });

  return {
    state,
    reason,
    connectionStatus,
    reconnectRequiredReason,
    lastSyncAt: lastSyncMs ? new Date(lastSyncMs).toISOString() : null,
    lastPaymentSyncAt,
    pendingSync,
    recentErrors,
  };
}

/**
 * Best-effort verdict for a surface that must still render if QuickBooks state
 * cannot be read. Returns null rather than a fabricated `ok`: an absent verdict
 * shows nothing, a fabricated one would be a fourth answer.
 */
export async function loadQuickBooksHealth(
  req: any,
  opts: QbHealthOptions = {},
): Promise<QuickBooksHealth | null> {
  try {
    return toQuickBooksHealth(await loadQbSyncStatus(req, opts));
  } catch (err) {
    req?.log?.error?.({ err }, "loadQuickBooksHealth failed");
    return null;
  }
}
