import { apiRequest } from "@/lib/queryClient";
import type { DocumentationSite, DocumentationSites } from "@workspace/api-client-react";
import { docSession, getDocSite, getDocSitesList, putDocSite, putDocSitesList } from "./doc-store";
import { docQueueForSite, overlayDocQueue } from "./doc-api";
import { getSyncEngine } from "./engine";

export class OfflineNotDownloadedError extends Error {
  constructor() { super("Not saved — connect to download"); this.name = "OfflineNotDownloadedError"; }
}
export function isDocNetworkError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name));
}
export const docSiteUrl = (customerId: number, branchName: string) =>
  `/api/system-documentation/customers/${customerId}/site?branchName=${encodeURIComponent(branchName)}`;

export async function fetchDoc<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try { return await apiRequest(url, "GET", undefined, controller.signal); }
  finally { clearTimeout(timeout); }
}

async function read<T>(
  url: string,
  get: () => Promise<{ payload: unknown; savedAt: number } | null>,
  put: (payload: T, owner: string) => Promise<void>,
) {
  const owner = docSession();
  let payload: T;
  // Only the network operation belongs in this catch. An IDB failure is
  // never a reason to pretend that the phone has lost connectivity.
  try {
    if (navigator.onLine === false) throw new TypeError("Offline");
    payload = await fetchDoc<T>(url);
  } catch (error) {
    if (!isDocNetworkError(error)) throw error;
    const row = await get();
    if (!row) throw new OfflineNotDownloadedError();
    return { payload: row.payload as T, savedAt: row.savedAt, fromCopy: true };
  }
  await put(payload, owner);
  return { payload, savedAt: Date.now(), fromCopy: false };
}
export async function readDocSite(customerId: number, branchName: string) {
  const result = await read<DocumentationSite>(docSiteUrl(customerId, branchName),
    () => getDocSite(customerId, branchName),
    (payload, owner) => putDocSite(customerId, branchName, payload, owner));
  const queue = docQueueForSite(await getSyncEngine().listMutations(), `${customerId}:${branchName}`);
  return { ...result, payload: overlayDocQueue(result.payload, queue) };
}
export async function readDocSitesList() {
  const result = await read<DocumentationSites>("/api/system-documentation/sites", getDocSitesList, putDocSitesList);
  const all = await getSyncEngine().listMutations();
  const customers = await Promise.all(result.payload.customers.map(async customer => ({
    ...customer,
    sites: await Promise.all(customer.sites.map(async site => {
      const queue = docQueueForSite(all, `${customer.customerId}:${site.branchName}`);
      if (!queue.some(m => m.status === "pending" || m.status === "syncing")) return site;
      const baseline = await getDocSite(customer.customerId, site.branchName);
      if (!baseline) return site;
      const local = overlayDocQueue(baseline.payload as DocumentationSite, queue);
      return { ...site, status: local.site.status, controllerCount: local.controllers.length, backflowCount: local.backflows.length };
    })),
  })));
  return { ...result, payload: { ...result.payload, customers } };
}
