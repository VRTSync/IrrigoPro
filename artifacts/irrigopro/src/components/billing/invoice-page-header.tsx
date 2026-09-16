/**
 * The invoice page header (Task #1942).
 *
 * Answers the two questions a bookkeeper opens this page with — how much is
 * outstanding, and is QuickBooks telling us the truth — before she scrolls.
 *
 * THE DOLLAR TOTAL IS NOT SUMMED FROM THE LOADED ROWS. The list is an
 * infinite query paginated at 50, so summing what is on screen reports the
 * first page's balance and calls it the filter's balance. It comes from
 * `/api/invoices/aging-summary`, which sums the whole filtered set on the
 * server; the count comes from the list's own post-filter total header.
 */

import type { ReactNode } from "react";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, ChevronLeft, FileText, Loader2, MinusCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format-currency";
import {
  qbHealthIsWarning,
  qbHealthPillLabel,
  qbHealthPillTitle,
  type QuickBooksHealth,
} from "@/lib/quickbooks-health";

// Task #2027 — the pill no longer decides company-level QuickBooks health.
//
// It used to run its own 24-hour clock over `lastPaymentSyncAt` and render the
// result as "QuickBooks: out of date" — a verdict on QuickBooks, from a field
// no other surface consulted, while Financial Pulse and the Manager Workspace
// strip read the connection and could say the opposite in the same minute. The
// inverse was worse: a dead token with a recent payment sweep read green.
//
// Payment-sync recency is now an input to the shared verdict rather than a
// second definition of it (see api-server/src/routes/quickbooks-health.ts), so
// the pill renders what the other two screens are showing, in fewer words. The
// per-row "Stale sync" flags are untouched — those are per-invoice facts.

export function InvoicePageHeader({
  outstandingBalance,
  invoiceCount,
  summaryLoading,
  canSeeQuickBooksStatus,
  canRunPaymentSync,
  quickBooksHealth,
  onRunPaymentSync,
  isSyncing,
  actions,
}: {
  /** Server-computed, for the whole filtered set. Null while it is loading. */
  outstandingBalance: string | null;
  /** The list response's post-filter total. */
  invoiceCount: number | null;
  summaryLoading: boolean;
  canSeeQuickBooksStatus: boolean;
  canRunPaymentSync: boolean;
  /** The shared verdict from `/api/invoices/aging-summary`. */
  quickBooksHealth: QuickBooksHealth | null;
  onRunPaymentSync: () => void;
  isSyncing: boolean;
  actions?: ReactNode;
}) {
  const warn = quickBooksHealth ? qbHealthIsWarning(quickBooksHealth) : false;
  const bad = quickBooksHealth?.state === "down";
  const unknown = !quickBooksHealth || quickBooksHealth.state === "unknown";

  return (
    <div className="mb-6" data-testid="invoice-page-header">
      <div className="mb-1 flex items-center gap-3">
        <Link href="/">
          <Button variant="ghost" size="sm" className="h-auto p-1 text-gray-500 hover:text-gray-700">
            <ChevronLeft className="mr-1 h-4 w-4" />
            Dashboard
          </Button>
        </Link>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <FileText className="h-6 w-6 text-blue-600" />
            Invoices
          </h1>
          <p className="mt-0.5 text-sm text-gray-600" data-testid="invoice-header-summary">
            <span className="font-semibold text-gray-900" data-testid="invoice-header-outstanding">
              {outstandingBalance == null
                ? summaryLoading
                  ? "…"
                  : "—"
                : formatCurrency(outstandingBalance)}
            </span>{" "}
            outstanding ·{" "}
            <span data-testid="invoice-header-count">
              {invoiceCount == null ? "…" : invoiceCount}
            </span>{" "}
            open invoice{invoiceCount === 1 ? "" : "s"} in this view
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Gated by absence, not by disabling: a role that cannot manage the
              QuickBooks connection is not shown its health either. */}
          {canSeeQuickBooksStatus && quickBooksHealth && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                bad
                  ? "border-red-300 bg-red-50 text-red-800"
                  : warn
                    ? "border-amber-300 bg-amber-50 text-amber-800"
                    : unknown
                      ? "border-gray-200 bg-gray-50 text-gray-600"
                      : "border-emerald-200 bg-emerald-50 text-emerald-800"
              }`}
              data-testid="qb-sync-pill"
              data-qb-state={quickBooksHealth.state}
              data-qb-reason={quickBooksHealth.reason}
              title={qbHealthPillTitle(quickBooksHealth)}
            >
              {warn ? (
                <AlertTriangle className="h-3.5 w-3.5" />
              ) : unknown ? (
                <MinusCircle className="h-3.5 w-3.5" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              {qbHealthPillLabel(quickBooksHealth)}
            </span>
          )}
          {canRunPaymentSync && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRunPaymentSync}
              disabled={isSyncing}
              data-testid="button-refresh-payment-status"
              title="Refresh payment status from QuickBooks"
            >
              {isSyncing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Sync payments
            </Button>
          )}
          {actions}
        </div>
      </div>
    </div>
  );
}
