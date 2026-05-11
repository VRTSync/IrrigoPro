import type { BillingSheet } from "@workspace/db/schema";
import { CompletedWorkDetailModal } from "./completed-work-detail-modal";

interface BillingSheetViewModalProps {
  sheet: BillingSheet;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BillingSheetViewModal({ sheet, open, onOpenChange }: BillingSheetViewModalProps) {
  return (
    <CompletedWorkDetailModal
      type="billing_sheet"
      id={sheet.id}
      data={sheet}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}
