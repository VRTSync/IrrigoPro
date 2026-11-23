export type DashboardTileKey =
  | "wet-checks" | "estimates" | "work-orders" | "billing-sheets"
  | "approvals" | "ready-to-bill" | "invoices" | "parts";

export const DASHBOARD_TILE_ORDER: readonly DashboardTileKey[] = [
  "wet-checks", "estimates", "work-orders", "billing-sheets",
  "approvals", "ready-to-bill", "invoices", "parts",
];

export const DASHBOARD_ROLES = [
  "company_admin", "irrigation_manager", "billing_manager", "bookkeeper",
] as const;

export const DASHBOARD_TILE_ROLES: Record<DashboardTileKey, readonly string[]> = {
  "wet-checks":     ["company_admin", "irrigation_manager", "billing_manager"],
  "estimates":      ["company_admin", "irrigation_manager", "billing_manager"],
  "work-orders":    ["company_admin", "irrigation_manager", "billing_manager"],
  "billing-sheets": ["company_admin", "irrigation_manager", "billing_manager"],
  "approvals":      ["company_admin", "irrigation_manager", "billing_manager"],
  "ready-to-bill":  ["company_admin", "billing_manager"],
  "invoices":       ["company_admin", "billing_manager", "bookkeeper"],
  "parts":          ["company_admin", "billing_manager"],
};

/** Days after which an item counts as overdue. Ready-to-bill and invoices use separate rules. */
export const DASHBOARD_OVERDUE_DAYS = {
  "wet-checks": 2, "estimates": 14, "work-orders": 30,
  "billing-sheets": 3, "approvals": 3, "parts": 7,
} as const;

export type DashboardOldestVerb =
  "Submitted" | "Sent" | "Created" | "Opened" | "Started" | "Waiting since" | "Worked" | "Due" | "Added";

export interface DashboardTile {
  key: DashboardTileKey;
  total: number;
  overdue: number;
  /** `at` is an ISO timestamp. */
  oldest: { label: string; verb: DashboardOldestVerb; at: string } | null;
}

export interface DashboardSectionsResponse {
  generatedAt: string;
  tiles: DashboardTile[];
  field: { workOrdersInProgress: number; wetChecksInProgress: number; techsOnActiveWork: number } | null;
  money: { openInvoiceBalance: string; pastDueBalance: string; readyToBillCount: number | null } | null;
}
