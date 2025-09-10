import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { User, Users, ArrowRight } from "lucide-react";
import type { WorkOrder, User as UserType } from "@shared/schema";

interface AssignmentConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  workOrder: WorkOrder;
  selectedTechnician: UserType | null;
  isLoading?: boolean;
}

export function AssignmentConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  workOrder,
  selectedTechnician,
  isLoading = false
}: AssignmentConfirmationModalProps) {
  // Early return moved after all hooks (none in this component)
  if (!selectedTechnician) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[95vw] max-w-[500px] max-h-[90vh] overflow-y-auto m-2 sm:m-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            Confirm Assignment Change
          </DialogTitle>
          <DialogDescription>
            You are about to reassign this work order to a different technician.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Work Order Info */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <h4 className="font-semibold text-sm text-gray-700 mb-2">Work Order</h4>
            <div className="space-y-1">
              <p className="font-medium">{workOrder.workOrderNumber}</p>
              <p className="text-sm text-gray-600">{workOrder.customerName}</p>
              <p className="text-sm text-gray-600">{workOrder.projectAddress}</p>
            </div>
          </div>

          {/* Assignment Change */}
          <div className="bg-blue-50 p-4 rounded-lg">
            <h4 className="font-semibold text-sm text-blue-700 mb-3">Assignment Change</h4>
            <div className="flex items-center justify-between">
              {/* Current Assignment */}
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-gray-500" />
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Current</p>
                  <p className="font-medium text-sm">{workOrder.assignedTechnicianName || "Unassigned"}</p>
                </div>
              </div>

              {/* Arrow */}
              <ArrowRight className="w-5 h-5 text-blue-600" />

              {/* New Assignment */}
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-blue-600" />
                <div>
                  <p className="text-xs text-blue-600 uppercase tracking-wide">New</p>
                  <p className="font-medium text-sm">{selectedTechnician.name}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Status Impact */}
          {workOrder.status === 'in_progress' && (
            <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                  Status Impact
                </Badge>
              </div>
              <p className="text-sm text-amber-700">
                This work order is currently in progress. Reassigning will transfer responsibility 
                to the new technician who can continue the work.
              </p>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 pt-4">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isLoading}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isLoading}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
          >
            {isLoading ? "Assigning..." : "Confirm Assignment"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}