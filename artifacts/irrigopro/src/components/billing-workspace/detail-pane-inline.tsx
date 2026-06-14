/**
 * DetailPaneInline — Task #1093
 *
 * Extends the existing billing-workspace DetailPane with:
 *  - RateModeToggle (billing_manager+ on unlocked BS / WO / WCB)
 *  - LineItemsEditor (billing_manager+ on unlocked BS / WO)
 *
 * The component owns a secondary detail fetch so it can read the full
 * record (rateMode, customer rates, items) without coupling the queue
 * page to the expanded payload.  Falls back gracefully when the fetch
 * is loading or errors.
 *
 * All approval/kickback/save/flag props are passed through to the
 * original DetailPane rendering at the bottom of the panel.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { RateModeToggle } from "./rate-mode-toggle";
import { LineItemsEditor, type InlineItem } from "./line-items-editor";
import { ActivityFeed } from "./activity-feed";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";

type QueueItemType = "billing_sheet" | "work_order" | "wet_check_billing" | "part" | "manual_review";
type RateMode = "normal" | "emergency";

interface QueueItem {
  id: string;
  type: QueueItemType;
  refId: number;
  status: string;
  invoiceId?: number | null;
}

interface DetailPaneInlineProps {
  item: QueueItem;
  userRole: string;
  children: ReactNode;
}

// Items from the detail endpoint
interface CustomerRates {
  laborRate?: string | null;
  emergencyLaborRate?: string | null;
}

interface DetailRecord {
  rateMode?: RateMode | string;
  status?: string;
  invoiceId?: number | null;
  items?: InlineItem[];
  // BS / WO: customer nested directly on the record
  customer?: CustomerRates | null;
  // WCB: customer lives at top level of the response envelope
  wetCheckBilling?: {
    rateMode?: RateMode | string;
    status?: string;
    invoiceId?: number | null;
  };
}

const EDITABLE_ROLES = ["billing_manager", "company_admin", "super_admin", "irrigation_manager"];

function isLocked(record: DetailRecord | undefined, type: QueueItemType): boolean {
  if (!record) return true;
  const rec = type === "wet_check_billing" ? record.wetCheckBilling : record;
  if (!rec) return true;
  return rec.status === "billed" || rec.invoiceId != null;
}

function getEntityPath(type: QueueItemType): "billing-sheets" | "work-orders" | "wet-check-billings" | null {
  if (type === "billing_sheet") return "billing-sheets";
  if (type === "work_order") return "work-orders";
  if (type === "wet_check_billing") return "wet-check-billings";
  return null;
}

function getDetailUrl(type: QueueItemType, refId: number): string | null {
  const path = getEntityPath(type);
  return path ? `/api/${path}/${refId}` : null;
}

export function DetailPaneInline({ item, userRole, children }: DetailPaneInlineProps) {
  const canEdit = EDITABLE_ROLES.includes(userRole);
  const detailUrl = getDetailUrl(item.type, item.refId);
  const detailQueryKey = detailUrl ? [detailUrl] : ["__no_detail__"];

  const { data: detail, isLoading } = useQuery<DetailRecord>({
    queryKey: detailQueryKey,
    enabled: !!detailUrl && canEdit,
  });

  const entityPath = getEntityPath(item.type);

  // Resolve the record root.
  // BS/WO: detail is the record. WCB: detail.wetCheckBilling is the record;
  // customer rates live at detail.customer (top-level envelope field).
  const rec = item.type === "wet_check_billing" ? detail?.wetCheckBilling : detail;
  const locked = isLocked(detail, item.type);
  const rateMode = (rec?.rateMode ?? "normal") as RateMode;
  // Both BS/WO (customer spread at record top-level) and WCB (customer at
  // envelope top-level) land on detail?.customer — shapes are consistent.
  const customerRates = detail?.customer;

  // Show controls even on locked records — they render as disabled/read-only
  // with a lock affordance so billing_manager can see the current config.
  const hasRateToggle =
    canEdit &&
    !!entityPath &&
    !!customerRates;

  const hasItemsEditor =
    canEdit &&
    (item.type === "billing_sheet" || item.type === "work_order") &&
    !!entityPath;

  const itemsForEditor: InlineItem[] = Array.isArray(detail?.items) ? detail!.items : [];

  return (
    <div className="space-y-4" data-testid="detail-pane-inline">
      {/* Approval / kickback / flag row — original content */}
      {children}

      {/* ── Inline edit section ─────────────────────────────────── */}
      {canEdit && (item.type === "billing_sheet" || item.type === "work_order" || item.type === "wet_check_billing") ? (
        <div
          className="pt-3 border-t border-gray-100 space-y-3"
          data-testid="inline-edit-section"
        >
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Inline edit
            </p>
            {locked && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500 border border-gray-200">
                <Lock className="w-3 h-3" />
                Locked
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            <>
              {hasRateToggle && entityPath && (
                <RateModeToggle
                  entityPath={entityPath as "billing-sheets" | "work-orders" | "wet-check-billings"}
                  entityId={item.refId}
                  currentMode={rateMode}
                  normalRate={customerRates?.laborRate ?? null}
                  emergencyRate={customerRates?.emergencyLaborRate ?? null}
                  detailQueryKey={detailQueryKey}
                  disabled={locked}
                />
              )}

              {hasItemsEditor && entityPath && (
                <LineItemsEditor
                  entityPath={entityPath as "billing-sheets" | "work-orders"}
                  entityId={item.refId}
                  initialItems={itemsForEditor}
                  detailQueryKey={detailQueryKey}
                  disabled={locked}
                />
              )}
            </>
          )}
        </div>
      ) : null}

      {/* Task #1097 — Activity feed for auditable entity types */}
      <ActivityFeed
        url={
          item.type === "billing_sheet"
            ? `/api/billing-sheets/${item.refId}/activity`
            : item.type === "work_order"
              ? `/api/work-orders/${item.refId}/activity`
              : item.type === "wet_check_billing"
                ? `/api/wet-check-billings/${item.refId}/activity`
                : null
        }
      />
    </div>
  );
}
