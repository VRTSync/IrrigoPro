import * as React from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Estimate } from "@workspace/db/schema";

// AlertDialogContent's public type omits onPointerDownOutside / onInteractOutside,
// but the underlying primitive still forwards them — re-expose them via a single
// typed alias so we keep the existing close-on-outside-interaction behavior.
type AlertDialogContentExtraProps = {
  onPointerDownOutside?: (event: Event) => void;
  onInteractOutside?: (event: Event) => void;
};
const AlertDialogContentTyped = AlertDialogContent as React.ComponentType<
  React.ComponentProps<typeof AlertDialogContent> & AlertDialogContentExtraProps
>;

interface ResendConfirmDialogProps {
  estimate: Estimate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isResending: boolean;
  // Task #365 — true when the estimate is expired (date reset + new token);
  // false when it's a re-delivery of a non-expired sent estimate (no date reset).
  isExpiredResend?: boolean;
}

export function ResendConfirmDialog({
  estimate,
  open,
  onOpenChange,
  onConfirm,
  isResending,
  isExpiredResend = true,
}: ResendConfirmDialogProps) {
  const email = estimate?.customerEmail?.trim() ?? "";
  const hasEmail = email.length > 0;
  const customerName = estimate?.customerName ?? "this customer";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContentTyped
        onPointerDownOutside={() => onOpenChange(false)}
        onInteractOutside={() => onOpenChange(false)}
      >
        {hasEmail ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Resend estimate?</AlertDialogTitle>
              <AlertDialogDescription>
                {isExpiredResend ? (
                  <>
                    This will email {customerName} at <strong>{email}</strong> with a
                    fresh approval link and reset the 30-day expiration window.
                  </>
                ) : (
                  <>
                    This will re-deliver the approval email to {customerName} at{" "}
                    <strong>{email}</strong>. The estimate date and approval link
                    remain unchanged.
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="resend-dialog-cancel">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                data-testid="resend-dialog-confirm"
                disabled={isResending}
                onClick={(e) => {
                  e.preventDefault();
                  onConfirm();
                }}
              >
                {isResending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Resending…
                  </>
                ) : (
                  "Resend"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>No customer email on file</AlertDialogTitle>
              <AlertDialogDescription>
                {customerName} doesn't have an email address saved, so this
                estimate can't be resent. Add an email to the customer record
                and try again.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="resend-dialog-cancel">
                Cancel
              </AlertDialogCancel>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContentTyped>
    </AlertDialog>
  );
}
