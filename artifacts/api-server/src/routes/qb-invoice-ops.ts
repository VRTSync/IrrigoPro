// QuickBooks invoice sync — only the stored invoice ID can authorize an UPDATE.
// Verify its customer and number first. Unlinked/deleted IDs use a customer-scoped
// number search only to refuse collisions, never to adopt another app's invoice.
//
// These functions are pulled out of routes.ts so they can be unit-tested with
// a stubbed `makeRequest` + `lookupServiceItem` (no real QB calls). Routes.ts
// wires in the real helpers; tests inject stubs.
//
// QB fault code reference:
//   5010 — Object Not Found / stale SyncToken (optimistic-lock conflict).
//         Self-healing: re-fetch the current token from QB, retry once.

import type { QbInvoice, QbInvoiceCreateResponse } from "../types/quickbooks";

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

export type QbInvoiceRead =
  | { kind: "found"; id: string; syncToken: string; docNumber: string | null; customerRef: string | null }
  | { kind: "not_found" }
  | { kind: "auth_error" };

export type QbSyncOutcome =
  | { outcome: "updated"; quickbooksId: string; quickbooksSyncToken?: string }
  | { outcome: "created"; quickbooksId?: string; qbDocNumber?: string; quickbooksSyncToken?: string }
  | { outcome: "refused"; httpStatus: 401 | 409 | 502; message: string };

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

/** Only GET 404 or GET 400/fault 610 means missing. All other failures stop sync. */
export async function getQbInvoiceById(
  makeRequest: QbMakeRequestFn,
  apiBase: string,
  integration: { realmId: string; accessToken: string },
  qbInvoiceId: string,
): Promise<QbInvoiceRead> {
  const resp = await makeRequest(
    `${apiBase}/v3/company/${integration.realmId}/invoice/${encodeURIComponent(qbInvoiceId)}?minorversion=73`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${integration.accessToken}`,
        Accept: "application/json",
      },
    },
    "QB stored invoice read",
    integration.realmId,
  );

  if (resp.status === 401) return { kind: "auth_error" };
  if (resp.status === 404) return { kind: "not_found" };
  if (!resp.ok) {
    const body = await resp.text();
    if (resp.status === 400 && extractQbFaultCode(body) === "610") return { kind: "not_found" };
    throw qbReadError(resp, "invoice read");
  }
  const data = (await resp.json()) as { Invoice?: QbInvoice & { CustomerRef?: { value?: string } } };
  if (!data.Invoice?.Id || data.Invoice.Id !== qbInvoiceId) {
    throw new Error("QuickBooks invoice read returned an invalid invoice. Retry the sync.");
  }
  return {
    kind: "found", id: data.Invoice.Id, syncToken: data.Invoice.SyncToken ?? "0",
    docNumber: data.Invoice.DocNumber ?? null, customerRef: data.Invoice.CustomerRef?.value ?? null,
  };
}

/** Refuse-only customer-scoped search. Never use a match as an update target. */
export async function findQbInvoicesByDocNumberForCustomer(
  makeRequest: QbMakeRequestFn,
  apiBase: string,
  integration: { realmId: string; accessToken: string },
  docNumber: string,
  qbCustomerId: string,
): Promise<Array<{ id: string; docNumber: string; customerRef: string }> | "auth_error"> {
  const escape = (v: string) => v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const query = encodeURIComponent(`SELECT Id, DocNumber, CustomerRef FROM Invoice WHERE DocNumber = '${escape(docNumber)}' AND CustomerRef = '${escape(qbCustomerId)}'`);
  const resp = await makeRequest(
    `${apiBase}/v3/company/${integration.realmId}/query?query=${query}&minorversion=73`,
    { method: "GET", headers: { Authorization: `Bearer ${integration.accessToken}`, Accept: "application/json" } },
    "QB customer-scoped DocNumber guard", integration.realmId,
  );
  if (resp.status === 401) return "auth_error";
  if (!resp.ok) throw qbReadError(resp, "customer-scoped invoice query");
  const data = (await resp.json()) as {
    QueryResponse?: { Invoice?: Array<{ Id: string; DocNumber: string; CustomerRef?: { value: string } }> };
  };
  return (data.QueryResponse?.Invoice ?? [])
    .filter((row) => row.CustomerRef?.value === qbCustomerId)
    .map((row) => ({ id: row.Id, docNumber: row.DocNumber, customerRef: qbCustomerId }));
}

export async function syncAppInvoiceToQb(
  makeRequest: QbMakeRequestFn,
  lookupServiceItem: QbLookupServiceItemFn,
  params: {
    apiBase: string; integration: { realmId: string; accessToken: string };
    customer: { quickbooksId?: string | null; name?: string };
    docNumber: string; qbLines: QbLineInput[]; serviceItemName: string;
    storedQbInvoiceId: string | null;
    txnDate: Date | string; dueDate: Date | string | null;
  },
): Promise<QbSyncOutcome> {
  const { apiBase, integration, customer, docNumber, storedQbInvoiceId } = params;
  if (!customer.quickbooksId) {
    throw new Error(
      `Customer "${customer.name ?? "Unknown"}" has not been synced to QuickBooks. ` +
      "Please sync this customer in the Customers section and try again.",
    );
  }
  const authError: QbSyncOutcome = {
    outcome: "refused", httpStatus: 401,
    message: "QuickBooks session expired. Please reconnect QuickBooks and retry the sync.",
  };
  if (storedQbInvoiceId) {
    const read = await getQbInvoiceById(makeRequest, apiBase, integration, storedQbInvoiceId);
    if (read.kind === "auth_error") return authError;
    if (read.kind === "found") {
      if (read.customerRef !== customer.quickbooksId) return {
        outcome: "refused", httpStatus: 409,
        message: `QuickBooks invoice ${read.id} belongs to a different QuickBooks customer (${read.customerRef ?? "none"}), not ${customer.name} (${customer.quickbooksId}). IrrigoPro did not change it.`,
      };
      if (read.docNumber !== docNumber) return {
        outcome: "refused", httpStatus: 409,
        message: `QuickBooks invoice ${read.id} is numbered ${read.docNumber ?? "(blank)"} in QuickBooks but #${docNumber} in IrrigoPro. IrrigoPro did not change it.`,
      };
      const result = await updateQbInvoiceInPlace(makeRequest, lookupServiceItem, {
        ...params, quickbooksInvoiceId: read.id, quickbooksSyncToken: read.syncToken,
        operation: "Invoice In-Place Update (stored id)",
      });
      if (result.quickbooksError) return { outcome: "refused", httpStatus: 502, message: result.quickbooksError };
      return { outcome: "updated", quickbooksId: read.id, quickbooksSyncToken: result.quickbooksSyncToken };
    }
    console.warn(`[QB] stored invoice ${storedQbInvoiceId} not found in QuickBooks; treating as unlinked`);
  }
  const matches = await findQbInvoicesByDocNumberForCustomer(makeRequest, apiBase, integration, docNumber, customer.quickbooksId);
  if (matches === "auth_error") return authError;
  if (matches.length) return {
    outcome: "refused", httpStatus: 409,
    message: `QuickBooks already has invoice #${docNumber} for this customer (QuickBooks id ${matches.map((row) => row.id).join(", ")}) that IrrigoPro is not linked to. IrrigoPro will not take it over or create a duplicate. Delete or renumber that QuickBooks invoice, then sync again.`,
  };
  const result = await buildAndPostQbInvoice(makeRequest, lookupServiceItem, { ...params, operation: "Invoice Sync Creation" });
  if (result.quickbooksError) return { outcome: "refused", httpStatus: 502, message: result.quickbooksError };
  return { outcome: "created", quickbooksId: result.quickbooksId, qbDocNumber: result.qbDocNumber, quickbooksSyncToken: result.quickbooksSyncToken };
}

function qbReadError(resp: Response, operation: string): Error {
  const tid = resp.headers.get("intuit_tid");
  return new Error(`QuickBooks ${operation} failed: ${resp.status} ${resp.statusText}${tid ? ` [TID: ${tid}]` : ""}. Retry the sync.`);
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
 *
 * `txnDate` — the invoice date to stamp on the QB `TxnDate` field. Should be
 *   the earliest-revision `createdAt` for corrected invoices so a recreate
 *   preserves the original QB date. Defaults to today only as a last resort.
 * `dueDate`  — the QB `DueDate`. Defaults to `txnDate` + 30 days (net-30).
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
    /** Original invoice date (earliest-revision createdAt). Defaults to today. */
    txnDate?: Date | string;
    /** Due date. Defaults to txnDate + 30 days (net-30). */
    dueDate?: Date | string | null;
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

  // Resolve TxnDate: use the caller-supplied date (original invoice date) or fall
  // back to today only as a last resort (should not happen for a real invoice).
  const txnDateObj = params.txnDate ? new Date(params.txnDate) : new Date();
  const txnDateStr = txnDateObj.toISOString().split("T")[0];

  // Resolve DueDate: use stored due date if provided, otherwise net-30 off txnDate.
  const dueDateStr = params.dueDate
    ? new Date(params.dueDate).toISOString().split("T")[0]
    : new Date(txnDateObj.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const invoiceData = {
    Line: qbLineItems,
    CustomerRef: { value: customer.quickbooksId },
    DocNumber: docNumber,
    TxnDate: txnDateStr,
    DueDate: dueDateStr,
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
