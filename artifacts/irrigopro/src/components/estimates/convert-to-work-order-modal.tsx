import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowRight, User } from "lucide-react";
import { useState } from "react";
import { useArrayQuery } from "@/lib/queryClient";
import type { User as UserType } from "@workspace/db/schema";

interface ConvertToWorkOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the chosen technician id once the user confirms. */
  onConfirm: (assignedTechnicianId: number) => void;
  isLoading?: boolean;
}

/**
 * Pops when a manager converts an approved estimate to a work order.
 * Requires picking a technician before the work order is created so the
 * conversion + assignment happen in a single request (see the
 * convert-to-work-order endpoint's optional `assignedTechnicianId`).
 */
export function ConvertToWorkOrderModal({
  isOpen,
  onClose,
  onConfirm,
  isLoading = false,
}: ConvertToWorkOrderModalProps) {
  const [selectedTechnicianId, setSelectedTechnicianId] = useState<string>("");

  // Same assignable-users source the work-order reassignment flow uses.
  const { data: technicians = [] } = useArrayQuery<UserType>({
    queryKey: ["/api/users/field-techs"],
  });

  const handleClose = () => {
    setSelectedTechnicianId("");
    onClose();
  };

  const handleConfirm = () => {
    if (!selectedTechnicianId) return;
    onConfirm(parseInt(selectedTechnicianId, 10));
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent className="w-[95vw] max-w-[500px] max-h-[90vh] overflow-y-auto m-2 sm:m-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRight className="w-5 h-5 text-green-600" />
            Convert to Work Order
          </DialogTitle>
          <DialogDescription>
            Assign a technician to create and schedule this work order in one step.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">Technician</label>
          <Select
            value={selectedTechnicianId}
            onValueChange={setSelectedTechnicianId}
            disabled={isLoading}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a technician..." />
            </SelectTrigger>
            <SelectContent>
              {technicians.map((tech) => (
                <SelectItem key={tech.id} value={tech.id.toString()}>
                  <span className="flex items-center gap-2">
                    <User className="w-4 h-4 text-gray-500" />
                    {tech.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {technicians.length === 0 && (
            <p className="text-sm text-amber-600">
              No assignable technicians found.
            </p>
          )}
        </div>

        <div className="flex gap-3 pt-4">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isLoading}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isLoading || !selectedTechnicianId}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white"
          >
            {isLoading ? "Converting..." : "Convert to Work Order"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
