import type { QbSyncSummary } from "./qb-customer-sync";
import { logger } from "./logger";

export const QB_CUSTOMER_PULL_INTERVAL_MS = 15 * 60 * 1000;
export const QB_CDC_MAX_AGE_MS = 29 * 24 * 60 * 60 * 1000;
export const QB_CDC_OVERLAP_MS = 5 * 60 * 1000;
export const QB_CUSTOMER_PULL_AUTH_ERROR = "QuickBooks authorization failed; reconnect QuickBooks.";
export const QB_CUSTOMER_PULL_BUSY = "A customer sync is already running. Try again in a minute.";

export type PullMode = "incremental" | "full" | "manual";
export type PullSummary = {
  mode: PullMode; added: number; updated: number; unchanged: number;
  heldForReview: number; skippedDeleted: number; unmappedTerms: string[];
  hiddenByQuickbooks: number; unhiddenByQuickbooks: number;
};
export type PullState = {
  lastAttemptAt: Date | null; lastSuccessAt: Date | null;
  lastError: string | null; lastSummary: PullSummary | null;
};
export type Integration = {
  realmId: string; companyId: string; accessToken: string;
  connectionStatus: string; customerPullLastSuccessAt: Date | null;
};
export type FetchResult = { ok: true; customers: Record<string, unknown>[] } |
  { ok: false; status: number; message: string; needsReconnection?: boolean };
export type PullTerms = { termNames: Map<string, string> | null; termsError?: string };
export type PullDeps = {
  withRealmLock<T>(realmId: string, fn: () => Promise<T>): Promise<{ acquired: true; value: T } | { acquired: false }>;
  fetchFull(integration: Integration): Promise<FetchResult>;
  fetchChanged(integration: Integration, changedSince: string): Promise<FetchResult>;
  fetchTerms(integration: Integration): Promise<PullTerms>;
  apply(companyId: number, rows: Record<string, unknown>[], terms: PullTerms): Promise<QbSyncSummary>;
  saveState(realmId: string, state: Partial<PullState>): Promise<void>;
  now(): Date;
};
export type PullOutcome = { status: "busy" } |
  { status: "success"; summary: QbSyncSummary; mode: PullMode; skippedDeleted: number } |
  { status: "error"; httpStatus: number; message: string; needsReconnection?: boolean };

export function choosePullMode(lastSuccessAt: Date | null, now: Date):
  { mode: "incremental"; changedSince: string } | { mode: "full" } {
  if (lastSuccessAt && Number.isFinite(lastSuccessAt.getTime()) &&
      now.getTime() - lastSuccessAt.getTime() < QB_CDC_MAX_AGE_MS) {
    return { mode: "incremental", changedSince: new Date(lastSuccessAt.getTime() - QB_CDC_OVERLAP_MS).toISOString() };
  }
  return { mode: "full" };
}

export function filterUsableQbCustomers(rows: Record<string, unknown>[]) {
  const usable = rows.filter(row => row.status !== "Deleted");
  return { usable, skipped: rows.length - usable.length };
}

/** No DB or transport knowledge here: manual and scheduled calls share this orchestration. */
export async function runCustomerPull(integration: Integration, mode: PullMode, deps: PullDeps): Promise<PullOutcome> {
  try {
    const locked = await deps.withRealmLock<PullOutcome>(integration.realmId, async () => {
      try {
        const companyId = Number(integration.companyId);
        if (!Number.isInteger(companyId) || companyId <= 0) throw new Error("Invalid integration company context.");
        const startedAt = deps.now();
        await deps.saveState(integration.realmId, { lastAttemptAt: startedAt });
        const chosen = mode === "manual" ? { mode: "manual" as const }
          : choosePullMode(integration.customerPullLastSuccessAt, startedAt);
        const fetched = chosen.mode === "incremental"
          ? await deps.fetchChanged(integration, chosen.changedSince) : await deps.fetchFull(integration);
        if (!fetched.ok) {
          const unauthorized = fetched.status === 401 || fetched.status === 403;
          await deps.saveState(integration.realmId, {
            lastError: unauthorized ? QB_CUSTOMER_PULL_AUTH_ERROR : fetched.message,
          });
          return { status: "error", httpStatus: unauthorized ? 403 : fetched.status,
            message: fetched.message, ...(unauthorized || fetched.needsReconnection ? { needsReconnection: true } : {}) };
        }
        const { usable, skipped } = filterUsableQbCustomers(fetched.customers);
        const terms = await deps.fetchTerms(integration);
        const summary = await deps.apply(companyId, usable, terms);
        await deps.saveState(integration.realmId, {
          lastSuccessAt: startedAt, lastError: null,
          lastSummary: { mode: chosen.mode, added: summary.customersAdded, updated: summary.customersUpdated,
            unchanged: summary.customersUnchanged, heldForReview: summary.heldForReview,
            skippedDeleted: skipped, unmappedTerms: summary.unmappedTerms,
            hiddenByQuickbooks: summary.hiddenByQuickbooks, unhiddenByQuickbooks: summary.unhiddenByQuickbooks },
        });
        return { status: "success", summary, mode: chosen.mode, skippedDeleted: skipped };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await deps.saveState(integration.realmId, { lastError: message });
        return { status: "error", httpStatus: 500, message: "Failed to sync customers from QuickBooks" };
      }
    });
    return locked.acquired ? locked.value : { status: "busy" };
  } catch (error) {
    logger.error({ realmId: integration.realmId }, "[QB customer pull] Lock or state operation failed");
    return { status: "error", httpStatus: 500, message: "Failed to sync customers from QuickBooks" };
  }
}

/** Delayed first tick; one sweep at a time, and one realm at a time within a sweep. */
export function startQbCustomerPullJob(
  listIntegrations: () => Promise<Integration[]>, deps: PullDeps,
  intervalMs = QB_CUSTOMER_PULL_INTERVAL_MS,
): NodeJS.Timeout {
  let running = false;
  return setInterval(async () => {
    if (running) return;
    running = true;
    try {
      for (const integration of await listIntegrations()) {
        if (integration.connectionStatus !== "connected") continue;
        const companyId = Number(integration.companyId);
        if (!Number.isInteger(companyId) || companyId <= 0) {
          logger.warn({ realmId: integration.realmId }, "[QB customer pull] Invalid company; skipping integration");
          continue;
        }
        try {
          const result = await runCustomerPull(integration, "incremental", deps);
          const context = { realmId: integration.realmId, companyId, status: result.status,
            ...(result.status === "success" ? { mode: result.mode, added: result.summary.customersAdded,
              updated: result.summary.customersUpdated, unchanged: result.summary.customersUnchanged,
              heldForReview: result.summary.heldForReview, ignored: result.summary.ignored,
              skippedDeleted: result.skippedDeleted,
              hiddenByQuickbooks: result.summary.hiddenByQuickbooks,
              unhiddenByQuickbooks: result.summary.unhiddenByQuickbooks } : {}) };
          if (result.status === "error") logger.error({ ...context, message: result.message }, "[QB customer pull] Realm failed");
          else logger.info(context, "[QB customer pull] Realm finished");
        } catch {
          logger.error({ realmId: integration.realmId, companyId }, "[QB customer pull] Unexpected realm failure");
        }
      }
    } catch {
      logger.error("[QB customer pull] Failed to load connected integrations");
    } finally {
      running = false;
    }
  }, intervalMs);
}
