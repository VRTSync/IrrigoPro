// Task #1425 — Merge duplicate monthly invoices for the same customer.
//
// Pure, DB-free helpers for validating a merge request and computing the
// combined totals. Kept separate from storage / routes so the rules can be
// unit-tested without a database and reused by both the route (for clear
// 4xx errors) and the storage transaction (defensive re-validation).

export type MergeErrorCode =
  | "too_few"
  | "not_found"
  | "cross_company"
  | "mixed_customer"
  | "mixed_period"
  | "contains_cancelled";

export class InvoiceMergeError extends Error {
  code: MergeErrorCode;
  httpStatus: number;
  constructor(code: MergeErrorCode, message: string, httpStatus = 400) {
    super(message);
    this.name = "InvoiceMergeError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

// Minimal shape needed to validate + sum. Both the Drizzle row and a test
// fixture satisfy it.
export interface MergeCandidate {
  id: number;
  invoiceNumber: string;
  customerId: number | null;
  companyId: number | null;
  invoiceMonth: number | null;
  invoiceYear: number | null;
  status: string;
  partsSubtotal: string | null;
  laborSubtotal: string | null;
  totalAmount: string | null;
}

export interface ValidatedMerge {
  surviving: MergeCandidate;
  merged: MergeCandidate[];
  // Distinct ids of the invoices that are being folded into the survivor
  // (i.e. everything except the surviving id).
  mergedIds: number[];
  // All distinct participating ids (surviving + merged).
  allIds: number[];
}

export interface MergedTotals {
  partsSubtotal: string;
  laborSubtotal: string;
  totalAmount: string;
}

function toCents(raw: string | null | undefined): number {
  if (raw == null) return 0;
  const n = parseFloat(String(raw));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

// Sum parts / labor / total across every participating invoice. The
// surviving invoice keeps its own line items, so the combined total is the
// sum across the whole set (surviving + merged).
export function computeMergedTotals(candidates: MergeCandidate[]): MergedTotals {
  let parts = 0;
  let labor = 0;
  let total = 0;
  for (const c of candidates) {
    parts += toCents(c.partsSubtotal);
    labor += toCents(c.laborSubtotal);
    total += toCents(c.totalAmount);
  }
  return {
    partsSubtotal: fromCents(parts),
    laborSubtotal: fromCents(labor),
    totalAmount: fromCents(total),
  };
}

// Validate a merge request against the fetched invoice rows. `candidates`
// must be the rows actually found in the DB for the requested ids — any
// requested id missing from this list yields a `not_found`.
export function validateMerge(
  candidates: MergeCandidate[],
  survivingId: number,
  mergedIds: number[],
  callerCompanyId: number | null,
): ValidatedMerge {
  const allIds = Array.from(new Set([survivingId, ...mergedIds]));

  if (allIds.length < 2) {
    throw new InvoiceMergeError(
      "too_few",
      "Select at least two distinct invoices to merge.",
    );
  }

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const missing = allIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new InvoiceMergeError(
      "not_found",
      `Invoice(s) not found or not accessible: ${missing.join(", ")}.`,
      404,
    );
  }

  const rows = allIds.map((id) => byId.get(id)!);

  // Tenant scope — when the caller is company-bound, every invoice must
  // belong to that company. (super_admin is already blocked by the route
  // guard, so callerCompanyId is non-null in practice; the null branch is
  // a defensive allow-all.)
  if (callerCompanyId !== null) {
    const offending = rows.filter((r) => r.companyId !== callerCompanyId);
    if (offending.length > 0) {
      throw new InvoiceMergeError(
        "cross_company",
        "All invoices must belong to your company.",
        403,
      );
    }
  }

  const surviving = byId.get(survivingId)!;

  const customerId = surviving.customerId;
  if (rows.some((r) => r.customerId !== customerId)) {
    throw new InvoiceMergeError(
      "mixed_customer",
      "All invoices must belong to the same customer.",
    );
  }

  const { invoiceMonth, invoiceYear } = surviving;
  if (
    rows.some(
      (r) => r.invoiceMonth !== invoiceMonth || r.invoiceYear !== invoiceYear,
    )
  ) {
    throw new InvoiceMergeError(
      "mixed_period",
      "All invoices must be in the same billing period (month and year).",
    );
  }

  const cancelled = rows.filter((r) => r.status === "cancelled");
  if (cancelled.length > 0) {
    throw new InvoiceMergeError(
      "contains_cancelled",
      "Cancelled invoices cannot be merged.",
    );
  }

  const mergedOnlyIds = allIds.filter((id) => id !== survivingId);
  const merged = mergedOnlyIds.map((id) => byId.get(id)!);

  return { surviving, merged, mergedIds: mergedOnlyIds, allIds };
}
