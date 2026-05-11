// QuickBooks Online API response shapes.
//
// These types replace the per-call `as { ... }` inline casts that used to live
// next to every `await response.json()` call in routes.ts. They are
// intentionally narrow: only the fields we actually read are typed, and most
// fields are marked optional because the real QB payloads are sparse and the
// account / item / customer shape varies by tenant configuration.
//
// The types below cover both the OAuth token endpoint and the v3 entity
// endpoints (Customer, Item, Invoice, CompanyInfo) that the API server talks
// to. See ../routes/routes.ts for the call sites.

// ─── OAuth token endpoint (oauth.platform.intuit.com) ───────────────────────

/** Raw response shape from POST /oauth2/v1/tokens/bearer. */
export interface QbTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  /** Populated by `exchangeCodeForTokens` after a follow-up CompanyInfo call. */
  companyName?: string;
  [key: string]: unknown;
}

/**
 * `QbTokenResponse` after we've validated `access_token` / `refresh_token` are
 * present. Returned from the refresh helper to make the non-null contract
 * explicit at call sites.
 */
export interface QbTokenResponseValidated {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  companyName?: string;
  [key: string]: unknown;
}

// ─── v3 entity endpoints (`/v3/company/{realmId}/...`) ──────────────────────

/** Common QueryResponse envelope returned by /query and entity GETs. */
export interface QbQueryResponse<TKey extends string, TItem> {
  QueryResponse?: Partial<Record<TKey, TItem[]>>;
}

/** Minimal Item shape — we only ever read Id / Name from queries. */
export interface QbItem {
  Id?: string;
  Name?: string;
  Sku?: string;
  Description?: string;
  UnitPrice?: number;
  Type?: string;
  Active?: boolean;
  [key: string]: unknown;
}

/** Minimal Customer shape — sparse on purpose; QB tenants vary widely. */
export interface QbCustomer {
  Id?: string;
  DisplayName?: string;
  CompanyName?: string;
  Name?: string;
  PrimaryEmailAddr?: { Address?: string };
  PrimaryPhone?: { FreeFormNumber?: string };
  BillAddr?: {
    Line1?: string;
    City?: string;
    CountrySubDivisionCode?: string;
    PostalCode?: string;
  };
  [key: string]: unknown;
}

/** Minimal Invoice shape — we only persist Id and DocNumber back. */
export interface QbInvoice {
  Id?: string;
  DocNumber?: string;
  [key: string]: unknown;
}

/** Minimal CompanyInfo shape — we only read CompanyName. */
export interface QbCompanyInfo {
  CompanyName?: string;
  [key: string]: unknown;
}

// ─── Concrete JSON envelopes ────────────────────────────────────────────────

export type QbItemQueryResponse = QbQueryResponse<"Item", QbItem>;
export type QbCustomerQueryResponse = QbQueryResponse<"Customer", QbCustomer>;
export type QbCompanyInfoQueryResponse = QbQueryResponse<
  "CompanyInfo",
  QbCompanyInfo
>;

/**
 * Response shape for POST /invoice. QB returns the created `Invoice` directly,
 * but a few legacy code paths also see a `QueryResponse.Invoice[]` envelope
 * (e.g. from a /query that ran immediately after the create), so we model both.
 */
export interface QbInvoiceCreateResponse {
  Invoice?: QbInvoice;
  QueryResponse?: { Invoice?: QbInvoice[] };
}
