// Extracted QuickBooks invoice operations — CREATE and in-place UPDATE.
//
// These functions are pulled out of routes.ts so they can be unit-tested with
// a stubbed `makeRequest` + `lookupServiceItem` (no real QB calls). Routes.ts
// wires in the real helpers; tests inject stubs.
//
// QB fault code reference:
//   5010 — Object Not Found / stale SyncToken (optimistic-lock conflict).
//         Self-healing: re-fetch the current token from QB, retry once.

import type { QbInvoice, QbInvoiceCreateResponse, QbItemQueryResponse } from "../types/quickbooks";

// ─── Dependency types ────────────────────────────────────────────────────────

export type QbMakeRequestFn = (
  url: string,
  options?: RequestInit,
  operation?: string,
  realmId?: string,
) => Promise<Response>;

export type QbLookupServiceItemFn = (
  apiBase: string,
  realmId: string,
  accessToken: string,
) => Promise<{ id: string; name: string } | null>;

// ─── I/O shapes ──────────────────────────────────────────────────────────────

export interface QbLineInput {
  amount: number;
  description: string;
}

export interface QbBuildResult {
  quickbooksId?: string;
  qbDocNumber?: string;
  quickbooksSyncToken?: string;
  quickbooksError?: string;
}

export interface QbUpdateResult {
  quickbooksId?: string;
  quickbooksSyncToken?: string;
  quickbooksError?: string;
}

/**
 * Result of looking up a QB invoice by DocNumber.
 *  - `{ id, syncToken }` — found; use these for an in-place update
 *  - `null`              — not found; fall through to create
 *  - `"auth_error"`     — 401 / expired token; caller must prompt reconnect
 */
export type QbDocNumberLookupResult =
  | { id: string; syncToken: string }
  | null
  | "auth_error";

// ─── QB Fault helper ─────────────────────────────────────────────────────────

function extractQbFaultCode(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { Fault?: { Error?: Array<{ code?: string }> } };
    return parsed?.Fault?.Error?.[0]?.code;
  } catch {
    return undefined;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Look up a QB invoice by DocNumber using the QB query API.
 *
 * Returns:
 *   `{ id, syncToken }` — invoice found; use these values for an in-place update.
 *   `null`              — invoice not found in QB (empty QueryResponse); caller should create.
 *   `"auth_error"`      — 401 response; QB token is expired; caller must prompt reconnect.
 *
 * Throws on any non-401 HTTP error (5xx, 429, etc.) or network failure.
 * This prevents a transient QB outage from silently falling through to a duplicate-create path.
 * The caller is responsible for surfacing the thrown error as a retryable failure.
 */
export async function lookupQbInvoiceByDocNumber(
  makeRequest: QbMakeRequestFn,
  apiBase: string,
  integration: { realmId: string; accessToken: string },
  docNumber: string,
): Promise<QbDocNumberLookupResult> {
  const query = encodeURIComponent(`SELECT Id, SyncToken FROM Invoice WHERE DocNumber = '${docNumber}'`);
  // Network errors thrown by makeRequest propagate to the caller — do not swallow them.
  const resp = await makeRequest(
    `${apiBase}/v3/company/${integration.realmId}/query?query=${query}&minorversion=73`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${integration.accessToken}`,
        Accept: "application/json",
      },
    },
    "QB DocNumber lookup",
    integration.realmId,
  );

  if (resp.status === 401) {
    return "auth_error";
  }

  if (resp.status === 404) {
    // 404 is an explicit "this invoice does not exist in QB" response — fall through to create.
    return null;
  }

  if (!resp.ok) {
    // Non-401, non-404 HTTP error (5xx, 429, etc.): do NOT treat as "not found".
    // Silently falling through to create would risk duplicating the QB invoice.
    // Throw so the caller can surface a retryable error instead.
    const errorText = await resp.text().catch(() => "");
    const intuitTid = resp.headers.get("intuit_tid");
    console.warn(
      `[QB] DocNumber lookup failed with ${resp.status} — aborting sync to avoid duplicate invoice` +
        (intuitTid ? ` [TID: ${intuitTid}]` : ""),
      errorText.slice(0, 200),
    );
    throw new Error(
      `QuickBooks DocNumber lookup failed: ${resp.status} ${resp.statusText}` +
        (intuitTid ? ` [TID: ${intuitTid}]` : "") +
        ". Retry the sync.",
    );
  }

  const data = (await resp.json()) as {
    QueryResponse?: { Invoice?: Array<{ Id?: string; SyncToken?: string }> };
  };
  const first = data?.QueryResponse?.Invoice?.[0];
  if (!first?.Id) {
    return null;
  }
  return { id: first.Id, syncToken: first.SyncToken ?? "0" };
}

/**
 * Fetch the current SyncToken for an existing QB invoice.
 * Returns null when the GET fails or the invoice is not found.
 */
export async function fetchQbSyncToken(
  makeRequest: QbMakeRequestFn,
  apiBase: string,
  integration: { realmId: string; accessToken: string },
  invoiceId: string,
): Promise<string | null> {
  try {
    const resp = await makeRequest(
      `${apiBase}/v3/company/${integration.realmId}/invoice/${invoiceId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${integration.accessToken}`,
          Accept: "application/json",
        },
      },
      "Fetch Invoice SyncToken",
      integration.realmId,
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as { Invoice?: QbInvoice };
    return (data?.Invoice?.SyncToken as string | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Build and POST a new QB invoice (create path).
 * Returns `quickbooksSyncToken` alongside `quickbooksId` and `qbDocNumber`.
 */
export async function buildAndPostQbInvoice(
  makeRequest: QbMakeRequestFn,
  lookupServiceItem: QbLookupServiceItemFn,
  params: {
    apiBase: string;
    integration: { realmId: string; accessToken: string };
    customer: { quickbooksId?: string | null; name?: string };
    docNumber: string;
    qbLines: QbLineInput[];
    operation: string;
    serviceItemName: string;
  },
): Promise<QbBuildResult> {
  const { apiBase, integration, customer, docNumber, qbLines, operation, serviceItemName } = params;

  const qbServiceItem = await lookupServiceItem(apiBase, integration.realmId, integration.accessToken);
  if (!qbServiceItem) {
    throw new Error(
      `Could not find the QuickBooks item "${serviceItemName}". ` +
        `Please create an active Service-type item with that exact name in QuickBooks and try again.`,
    );
  }

  if (!customer.quickbooksId) {
    throw new Error(
      `Customer "${customer.name ?? "Unknown"}" has not been synced to QuickBooks. ` +
        "Please sync this customer in the Customers section and try again.",
    );
  }

  const qbLineItems = buildQbLineItems(qbLines, qbServiceItem);

  const currentDate = new Date();
  const invoiceData = {
    Line: qbLineItems,
    CustomerRef: { value: customer.quickbooksId },
    DocNumber: docNumber,
    TxnDate: currentDate.toISOString().split("T")[0],
    DueDate: new Date(currentDate.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
  };

  const resp = await makeRequest(
    `${apiBase}/v3/company/${integration.realmId}/invoice`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${integration.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(invoiceData),
    },
    operation,
    integration.realmId,
  );

  if (resp.ok) {
    const result = (await resp.json()) as QbInvoiceCreateResponse;
    const quickbooksId =
      result?.QueryResponse?.Invoice?.[0]?.Id || result?.Invoice?.Id;
    const qbDocNumber = result?.Invoice?.DocNumber as string | undefined;
    const quickbooksSyncToken = result?.Invoice?.SyncToken as string | undefined;
    return {
      quickbooksId: quickbooksId ? quickbooksId.toString() : undefined,
      qbDocNumber,
      quickbooksSyncToken,
    };
  }

  const errorText = await resp.text();
  const intuitTid = resp.headers.get("intuit_tid");
  if (errorText.includes("InvalidRef") || errorText.includes("Customer")) {
    return {
      quickbooksError: `Customer not found in QuickBooks. Please sync this customer first.${intuitTid ? ` [TID: ${intuitTid}]` : ""}`,
    };
  }
  return {
    quickbooksError: `QuickBooks API Error: ${resp.status} ${resp.statusText}${intuitTid ? ` [TID: ${intuitTid}]` : ""}`,
  };
}

/**
 * Update an existing QB invoice in-place (sparse update).
 *
 * - If `quickbooksSyncToken` is null/undefined (legacy invoice), fetches the
 *   current token from QB before updating.
 * - On a stale-token fault (code 5010), re-fetches the token and retries once.
 * - Never falls back to creating a duplicate; surfaces a retryable error instead.
 */
export async function updateQbInvoiceInPlace(
  makeRequest: QbMakeRequestFn,
  lookupServiceItem: QbLookupServiceItemFn,
  params: {
    apiBase: string;
    integration: { realmId: string; accessToken: string };
    customer: { quickbooksId?: string | null; name?: string };
    docNumber: string;
    qbLines: QbLineInput[];
    operation: string;
    serviceItemName: string;
    quickbooksInvoiceId: string;
    quickbooksSyncToken: string | null | undefined;
  },
): Promise<QbUpdateResult> {
  const {
    apiBase,
    integration,
    customer,
    docNumber,
    qbLines,
    operation,
    serviceItemName,
    quickbooksInvoiceId,
  } = params;
  let syncToken = params.quickbooksSyncToken ?? null;

  const qbServiceItem = await lookupServiceItem(apiBase, integration.realmId, integration.accessToken);
  if (!qbServiceItem) {
    throw new Error(
      `Could not find the QuickBooks item "${serviceItemName}". ` +
        `Please create an active Service-type item with that exact name in QuickBooks and try again.`,
    );
  }

  if (!customer.quickbooksId) {
    throw new Error(
      `Customer "${customer.name ?? "Unknown"}" has not been synced to QuickBooks. ` +
        "Please sync this customer in the Customers section and try again.",
    );
  }

  // Legacy invoice: no stored token — fetch current one from QB first.
  if (syncToken === null) {
    const fetched = await fetchQbSyncToken(makeRequest, apiBase, integration, quickbooksInvoiceId);
    if (fetched === null) {
      return {
        quickbooksError: `Could not fetch current SyncToken for QB invoice ${quickbooksInvoiceId}. Retry the sync.`,
      };
    }
    syncToken = fetched;
  }

  const qbLineItems = buildQbLineItems(qbLines, qbServiceItem);

  const performUpdate = async (token: string): Promise<Response> =>
    makeRequest(
      `${apiBase}/v3/company/${integration.realmId}/invoice`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${integration.accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          Id: quickbooksInvoiceId,
          SyncToken: token,
          sparse: true,
          DocNumber: docNumber,
          Line: qbLineItems,
        }),
      },
      operation,
      integration.realmId,
    );

  let updateResp = await performUpdate(syncToken);

  // Handle stale-token conflict (QB fault 5010): re-fetch + single retry.
  if (!updateResp.ok) {
    const errorText = await updateResp.text();
    const faultCode = extractQbFaultCode(errorText);

    if (faultCode === "5010") {
      const freshToken = await fetchQbSyncToken(makeRequest, apiBase, integration, quickbooksInvoiceId);
      if (!freshToken) {
        return {
          quickbooksError: `Stale SyncToken for QB invoice ${quickbooksInvoiceId} and re-fetch failed. Retry the sync.`,
        };
      }
      updateResp = await performUpdate(freshToken);
      if (!updateResp.ok) {
        const retryErrorText = await updateResp.text();
        const intuitTid = updateResp.headers.get("intuit_tid");
        console.error("[QB] Invoice update failed after token refresh:", updateResp.status, retryErrorText);
        return {
          quickbooksError: `QuickBooks update conflict after token refresh: ${updateResp.status}${intuitTid ? ` [TID: ${intuitTid}]` : ""}. Retry the sync.`,
        };
      }
    } else {
      const intuitTid = updateResp.headers.get("intuit_tid");
      console.error("[QB] Invoice update failed:", updateResp.status, updateResp.statusText);
      console.error("[QB] Full error body:", errorText);
      if (intuitTid) console.error("[QB] TID:", intuitTid);
      if (errorText.includes("InvalidRef") || errorText.includes("Customer")) {
        return {
          quickbooksError: `Customer not found in QuickBooks. Please sync this customer first.${intuitTid ? ` [TID: ${intuitTid}]` : ""}`,
        };
      }
      return {
        quickbooksError: `QuickBooks API Error: ${updateResp.status} ${updateResp.statusText}${intuitTid ? ` [TID: ${intuitTid}]` : ""}`,
      };
    }
  }

  const result = (await updateResp.json()) as QbInvoiceCreateResponse;
  const newSyncToken = result?.Invoice?.SyncToken as string | undefined;
  const newId = (result?.Invoice?.Id as string | undefined) ?? quickbooksInvoiceId;
  return {
    quickbooksId: newId,
    quickbooksSyncToken: newSyncToken,
  };
}

// ─── Private helpers ─────────────────────────────────────────────────────────

function buildQbLineItems(
  qbLines: QbLineInput[],
  serviceItem: { id: string; name: string },
) {
  return qbLines.map((line) => ({
    Amount: line.amount,
    DetailType: "SalesItemLineDetail",
    SalesItemLineDetail: {
      ItemRef: { value: serviceItem.id, name: serviceItem.name },
      UnitPrice: line.amount,
      Qty: 1,
    },
    Description: line.description,
  }));
}
