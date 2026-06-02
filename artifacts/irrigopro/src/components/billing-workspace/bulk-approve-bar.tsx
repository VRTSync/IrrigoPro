import { Loader2, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BulkApproveBarProps {
  selectedCount: number;
  approving: boolean;
  onApprove: () => void;
  onClear: () => void;
}

export function BulkApproveBar({
  selectedCount,
  approving,
  onApprove,
  onClear,
}: BulkApproveBarProps) {
  if (selectedCount === 0) return null;
  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-white border border-gray-200 shadow-lg rounded-full px-4 py-2"
      data-testid="bulk-approve-bar"
    >
      <span className="text-sm font-medium text-gray-800">
        {selectedCount} selected
      </span>
      <Button
        size="sm"
        onClick={onApprove}
        disabled={approving}
        className="rounded-full"
        data-testid="bulk-approve-button"
      >
        {approving ? (
          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
        ) : (
          <CheckCircle2 className="w-4 h-4 mr-1" />
        )}
        Approve {selectedCount} selected
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onClear}
        disabled={approving}
        className="rounded-full"
        data-testid="bulk-approve-clear"
      >
        <X className="w-4 h-4 mr-1" />
        Clear selection
      </Button>
    </div>
  );
}
